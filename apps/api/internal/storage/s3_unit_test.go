package storage

import (
	"bytes"
	"io"
	"strings"
	"testing"
	"time"
)

func validS3Options() S3Options {
	return S3Options{
		Endpoint:        "http://127.0.0.1:9000",
		Region:          "us-east-1",
		AccessKeyID:     "key",
		SecretAccessKey: "secret",
		UsePathStyle:    true,
		PublicBucket:    "deco-public",
		PrivateBucket:   "deco-private",
		DefaultTTL:      5 * time.Minute,
	}
}

// Misconfiguration must surface when the backend is built — at boot — not on
// the first upload.
func TestNewS3BackendRejectsBadOptions(t *testing.T) {
	cases := map[string]func(*S3Options){
		"no access key":            func(o *S3Options) { o.AccessKeyID = "" },
		"no secret key":            func(o *S3Options) { o.SecretAccessKey = "" },
		"same bucket twice":        func(o *S3Options) { o.PrivateBucket = o.PublicBucket },
		"empty public bucket":      func(o *S3Options) { o.PublicBucket = "" },
		"bucket with a slash":      func(o *S3Options) { o.PublicBucket = "deco/public" },
		"bucket with an at sign":   func(o *S3Options) { o.PrivateBucket = "deco@private" },
		"uppercase bucket":         func(o *S3Options) { o.PrivateBucket = "DecoPrivate" },
		"endpoint with no scheme":  func(o *S3Options) { o.Endpoint = "127.0.0.1:9000" },
		"ttl beyond the maximum":   func(o *S3Options) { o.DefaultTTL = MaxPresignTTL + time.Minute },
		"no endpoint and no base ": func(o *S3Options) { o.Endpoint = ""; o.PublicBaseURL = "" },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			opts := validS3Options()
			mutate(&opts)
			if _, err := NewS3Backend(opts); err == nil {
				t.Fatalf("NewS3Backend() accepted options that should be rejected: %s", name)
			}
		})
	}
}

func TestNewS3BackendDerivesPublicBaseURL(t *testing.T) {
	t.Run("path style", func(t *testing.T) {
		opts := validS3Options()
		opts.UsePathStyle = true
		backend, err := NewS3Backend(opts)
		if err != nil {
			t.Fatalf("NewS3Backend() error = %v", err)
		}
		want := "http://127.0.0.1:9000/deco-public/avatars/a.png"
		if got := backend.PublicURL("avatars/a.png"); got != want {
			t.Errorf("PublicURL = %q, want %q", got, want)
		}
	})

	t.Run("virtual host style", func(t *testing.T) {
		opts := validS3Options()
		opts.UsePathStyle = false
		opts.Endpoint = "https://s3.example.com"
		backend, err := NewS3Backend(opts)
		if err != nil {
			t.Fatalf("NewS3Backend() error = %v", err)
		}
		want := "https://deco-public.s3.example.com/avatars/a.png"
		if got := backend.PublicURL("avatars/a.png"); got != want {
			t.Errorf("PublicURL = %q, want %q", got, want)
		}
	})

	t.Run("explicit base wins", func(t *testing.T) {
		opts := validS3Options()
		opts.PublicBaseURL = "https://media.example.com/"
		backend, err := NewS3Backend(opts)
		if err != nil {
			t.Fatalf("NewS3Backend() error = %v", err)
		}
		want := "https://media.example.com/avatars/a.png"
		if got := backend.PublicURL("avatars/a.png"); got != want {
			t.Errorf("PublicURL = %q, want %q", got, want)
		}
	})
}

func TestS3BackendBucketNameMapping(t *testing.T) {
	backend, err := NewS3Backend(validS3Options())
	if err != nil {
		t.Fatalf("NewS3Backend() error = %v", err)
	}

	if name, err := backend.BucketName(BucketPublic); err != nil || name != "deco-public" {
		t.Errorf("BucketName(public) = %q, %v; want deco-public, nil", name, err)
	}
	if name, err := backend.BucketName(BucketPrivate); err != nil || name != "deco-private" {
		t.Errorf("BucketName(private) = %q, %v; want deco-private, nil", name, err)
	}
	if _, err := backend.BucketName(Bucket("other")); err == nil {
		t.Error("BucketName with an unknown bucket returned no error")
	}
}

// The public bucket policy must allow reading objects and nothing else. A
// stray s3:ListBucket would let anyone enumerate every avatar in the system.
func TestPublicReadPolicy(t *testing.T) {
	policy := publicReadPolicy("deco-public")

	if !strings.Contains(policy, `"s3:GetObject"`) {
		t.Errorf("policy does not grant s3:GetObject: %s", policy)
	}
	if strings.Contains(policy, "ListBucket") {
		t.Errorf("policy grants bucket listing: %s", policy)
	}
	if strings.Contains(policy, "PutObject") || strings.Contains(policy, "DeleteObject") {
		t.Errorf("policy grants writes: %s", policy)
	}
	if !strings.Contains(policy, "arn:aws:s3:::deco-public/*") {
		t.Errorf("policy does not scope to the bucket's objects: %s", policy)
	}

	// The policy this code writes must be recognised as public by the same
	// check that guards the private bucket, otherwise that check is asleep.
	public, err := policyAllowsAnonymousAccess(policy)
	if err != nil {
		t.Fatalf("policyAllowsAnonymousAccess() error = %v", err)
	}
	if !public {
		t.Fatal("the public-read policy was not detected as anonymous access")
	}
}

func TestPolicyAllowsAnonymousAccess(t *testing.T) {
	cases := []struct {
		name   string
		policy string
		want   bool
	}{
		{
			name:   "wildcard AWS principal in an array",
			policy: `{"Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"]}]}`,
			want:   true,
		},
		{
			name:   "bare wildcard principal",
			policy: `{"Statement":[{"Effect":"Allow","Principal":"*","Action":["s3:GetObject"]}]}`,
			want:   true,
		},
		{
			name:   "wildcard AWS principal as a string",
			policy: `{"Statement":[{"Effect":"Allow","Principal":{"AWS":"*"},"Action":["s3:GetObject"]}]}`,
			want:   true,
		},
		{
			name:   "wildcard only on a Deny statement",
			policy: `{"Statement":[{"Effect":"Deny","Principal":{"AWS":["*"]},"Action":["s3:GetObject"]}]}`,
			want:   false,
		},
		{
			name:   "named principal",
			policy: `{"Statement":[{"Effect":"Allow","Principal":{"AWS":["arn:aws:iam::1:user/deco"]},"Action":["s3:GetObject"]}]}`,
			want:   false,
		},
		{
			name:   "wildcard hidden behind an allowed statement",
			policy: `{"Statement":[{"Effect":"Allow","Principal":{"AWS":["arn:aws:iam::1:user/deco"]}},{"Effect":"Allow","Principal":{"AWS":["*"]}}]}`,
			want:   true,
		},
		{
			name:   "no statements",
			policy: `{"Statement":[]}`,
			want:   false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := policyAllowsAnonymousAccess(tc.policy)
			if err != nil {
				t.Fatalf("policyAllowsAnonymousAccess() error = %v", err)
			}
			if got != tc.want {
				t.Errorf("policyAllowsAnonymousAccess(%s) = %v, want %v", tc.policy, got, tc.want)
			}
		})
	}
}

// An unreadable principal must not be treated as safe.
func TestPrincipalIsWildcardFailsClosedOnGarbage(t *testing.T) {
	if !principalIsWildcard([]byte("{not json")) {
		t.Fatal("an unparseable principal was treated as not-wildcard; it must fail closed")
	}
}

func TestSpool(t *testing.T) {
	t.Run("known size and a seekable reader passes through", func(t *testing.T) {
		payload := bytes.Repeat([]byte("a"), 100)
		body, size, cleanup, err := spool(bytes.NewReader(payload), int64(len(payload)), 1000)
		defer cleanup()
		if err != nil {
			t.Fatalf("spool() error = %v", err)
		}
		if size != 100 {
			t.Errorf("size = %d, want 100", size)
		}
		got, _ := io.ReadAll(body)
		if !bytes.Equal(got, payload) {
			t.Error("spooled bytes differ from the input")
		}
	})

	t.Run("unknown size is measured", func(t *testing.T) {
		payload := bytes.Repeat([]byte("b"), 5000)
		body, size, cleanup, err := spool(io.NopCloser(bytes.NewReader(payload)), 0, 1<<20)
		defer cleanup()
		if err != nil {
			t.Fatalf("spool() error = %v", err)
		}
		if size != 5000 {
			t.Errorf("size = %d, want 5000", size)
		}
		got, _ := io.ReadAll(body)
		if !bytes.Equal(got, payload) {
			t.Error("spooled bytes differ from the input")
		}
	})

	t.Run("declared size above the limit is refused", func(t *testing.T) {
		_, _, cleanup, err := spool(bytes.NewReader([]byte("x")), 10_000, 100)
		defer cleanup()
		if err == nil {
			t.Fatal("spool() accepted a body larger than the limit")
		}
	})

	t.Run("undeclared size above the limit is refused", func(t *testing.T) {
		payload := bytes.Repeat([]byte("c"), 5000)
		_, _, cleanup, err := spool(io.NopCloser(bytes.NewReader(payload)), 0, 100)
		defer cleanup()
		if err == nil {
			t.Fatal("spool() accepted a streamed body larger than the limit")
		}
	})
}
