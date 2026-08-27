package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// These tests exercise the s3 backend against a real S3-compatible server.
// They are not mocked: presigned-URL expiry and per-object signature scope are
// enforced by the storage provider, so asserting them against a fake would
// assert nothing.
//
// Running them:
//
//	docker compose -f infra/compose/docker-compose.yml up -d minio
//	go test ./internal/storage/
//
// They RUN automatically whenever the endpoint below accepts a TCP connection,
// and skip when it does not, so `go test ./...` passes on a machine with no
// MinIO. Set STORAGE_TEST_S3_REQUIRE=1 to turn that skip into a failure — use
// it in CI, where a silent skip would mean the suite never ran at all.
const (
	defaultTestEndpoint  = "http://127.0.0.1:9000"
	defaultTestAccessKey = "deco"
	defaultTestSecretKey = "deco-dev-secret"
	testPublicBucket     = "deco-test-public"
	testPrivateBucket    = "deco-test-private"
)

func testEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// requireS3 skips (or fails, under STORAGE_TEST_S3_REQUIRE=1) when no
// S3-compatible server is listening.
func requireS3(t *testing.T) {
	t.Helper()

	endpoint := testEnv("STORAGE_TEST_S3_ENDPOINT", defaultTestEndpoint)
	if testing.Short() {
		t.Skip("skipping S3 integration test in -short mode")
	}

	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" {
		t.Fatalf("STORAGE_TEST_S3_ENDPOINT=%q is not a URL: %v", endpoint, err)
	}
	host := parsed.Host
	if parsed.Port() == "" {
		if parsed.Scheme == "https" {
			host += ":443"
		} else {
			host += ":80"
		}
	}

	conn, err := net.DialTimeout("tcp", host, 1500*time.Millisecond)
	if err != nil {
		msg := fmt.Sprintf("no S3-compatible server at %s (%v)\n"+
			"start one with: docker compose -f infra/compose/docker-compose.yml up -d minio\n"+
			"set STORAGE_TEST_S3_REQUIRE=1 to make this a failure instead of a skip", endpoint, err)
		if os.Getenv("STORAGE_TEST_S3_REQUIRE") == "1" {
			t.Fatal(msg)
		}
		t.Skip(msg)
	}
	_ = conn.Close()
}

// newTestS3Backend builds a backend against the test server and provisions
// both buckets through the same EnsureBuckets the API runs at boot.
func newTestS3Backend(t *testing.T) *S3Backend {
	t.Helper()
	requireS3(t)

	endpoint := testEnv("STORAGE_TEST_S3_ENDPOINT", defaultTestEndpoint)
	backend, err := NewS3Backend(S3Options{
		Endpoint:        endpoint,
		Region:          testEnv("STORAGE_TEST_S3_REGION", "us-east-1"),
		AccessKeyID:     testEnv("STORAGE_TEST_S3_ACCESS_KEY_ID", defaultTestAccessKey),
		SecretAccessKey: testEnv("STORAGE_TEST_S3_SECRET_ACCESS_KEY", defaultTestSecretKey),
		UsePathStyle:    true,
		PublicBucket:    testPublicBucket,
		PrivateBucket:   testPrivateBucket,
		DefaultTTL:      5 * time.Minute,
	})
	if err != nil {
		t.Fatalf("NewS3Backend() error = %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := backend.EnsureBuckets(ctx); err != nil {
		t.Fatalf("EnsureBuckets() error = %v (are the credentials right? endpoint %s)", err, endpoint)
	}
	return backend
}

func randomPayload(t *testing.T, n int) []byte {
	t.Helper()
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	return buf
}

// putTestObject stores a payload and registers its deletion.
func putTestObject(t *testing.T, backend *S3Backend, kind Kind, name, mimeType string, payload []byte) *SavedFile {
	t.Helper()

	saved, err := Save(context.Background(), backend, kind, name, mimeType, bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("Save(%s) error = %v", kind, err)
	}
	t.Cleanup(func() {
		_ = backend.Delete(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key})
	})
	return saved
}

func fetch(t *testing.T, rawURL string) (int, []byte) {
	t.Helper()

	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(rawURL)
	if err != nil {
		t.Fatalf("GET %s: %v", rawURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		t.Fatalf("reading the response body of %s: %v", rawURL, err)
	}
	return resp.StatusCode, body
}

// Put then PresignGet must round-trip the exact bytes.
func TestS3PutPresignGetRoundTrip(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 64*1024)

	saved := putTestObject(t, backend, KindImage, "holiday.png", "image/png", payload)
	if saved.Bucket != BucketPrivate {
		t.Fatalf("bucket = %q, want %q", saved.Bucket, BucketPrivate)
	}
	if saved.Size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", saved.Size, len(payload))
	}

	presigned, err := backend.PresignGet(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key}, time.Minute)
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}
	if !strings.Contains(presigned, "X-Amz-Signature") {
		t.Fatalf("presigned URL carries no signature: %s", presigned)
	}

	status, body := fetch(t, presigned)
	if status != http.StatusOK {
		t.Fatalf("GET presigned URL = %d, want 200 (body: %s)", status, truncate(body))
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("round-tripped %d bytes, want the %d bytes that were written", len(body), len(payload))
	}
}

// A message attachment must not be readable without a signature. If this fails
// the private bucket is world-readable and presigning is decoration.
func TestS3PrivateObjectIsNotReadableWithoutASignature(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 1024)
	saved := putTestObject(t, backend, KindFile, "secret.pdf", "application/pdf", payload)

	endpoint := strings.TrimRight(testEnv("STORAGE_TEST_S3_ENDPOINT", defaultTestEndpoint), "/")
	unsigned := fmt.Sprintf("%s/%s/%s", endpoint, testPrivateBucket, saved.Key)

	status, body := fetch(t, unsigned)
	if status == http.StatusOK {
		t.Fatalf("unsigned GET of a private object returned 200; the private bucket is publicly readable")
	}
	if bytes.Equal(body, payload) {
		t.Fatalf("unsigned GET of a private object returned the object bytes")
	}
}

// A presigned URL is a bearer credential with an expiry. Once it lapses the
// storage provider — not the API — must refuse it.
func TestS3PresignedURLIsDeniedAfterItsTTL(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 512)
	saved := putTestObject(t, backend, KindImage, "expiring.png", "image/png", payload)

	presigned, err := backend.PresignGet(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key}, time.Second)
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}

	// Valid before it expires — otherwise a permanently broken URL would pass
	// the expiry assertion for the wrong reason.
	if status, body := fetch(t, presigned); status != http.StatusOK {
		t.Fatalf("presigned URL = %d before expiry, want 200 (body: %s)", status, truncate(body))
	}

	time.Sleep(3 * time.Second)

	status, body := fetch(t, presigned)
	if status == http.StatusOK {
		t.Fatalf("presigned URL still returned 200 after its 1s TTL elapsed")
	}
	if bytes.Equal(body, payload) {
		t.Fatalf("expired presigned URL still returned the object bytes")
	}
}

// A signature is scoped to one object. Swapping the key in a URL someone was
// legitimately given must not reach another user's attachment.
func TestS3PresignedURLForOneObjectCannotFetchAnother(t *testing.T) {
	backend := newTestS3Backend(t)

	payloadA := randomPayload(t, 256)
	payloadB := randomPayload(t, 256)
	objectA := putTestObject(t, backend, KindImage, "a.png", "image/png", payloadA)
	objectB := putTestObject(t, backend, KindImage, "b.png", "image/png", payloadB)

	presignedA, err := backend.PresignGet(context.Background(), ObjectRef{Bucket: objectA.Bucket, Key: objectA.Key}, time.Minute)
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}

	swapped := strings.Replace(presignedA, objectA.Key, objectB.Key, 1)
	if swapped == presignedA {
		t.Fatalf("test bug: object A's key %q does not appear in its presigned URL", objectA.Key)
	}

	status, body := fetch(t, swapped)
	if status == http.StatusOK {
		t.Fatalf("a presigned URL for %s fetched %s (status 200)", objectA.Key, objectB.Key)
	}
	if bytes.Equal(body, payloadB) {
		t.Fatalf("a presigned URL for %s returned the bytes of %s", objectA.Key, objectB.Key)
	}
}

// Avatars and stickers are rendered by <img> tags that cannot sign anything.
// They must fetch with no query string at all.
func TestS3PublicObjectFetchesWithNoSignature(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 2048)

	saved := putTestObject(t, backend, KindSticker, "cat.webp", "image/webp", payload)
	if saved.Bucket != BucketPublic {
		t.Fatalf("bucket = %q, want %q", saved.Bucket, BucketPublic)
	}
	if strings.Contains(saved.URL, "?") {
		t.Fatalf("public URL carries a query string: %s", saved.URL)
	}

	status, body := fetch(t, saved.URL)
	if status != http.StatusOK {
		t.Fatalf("unsigned GET of a public object = %d, want 200 (url %s, body: %s)", status, saved.URL, truncate(body))
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("public object returned %d bytes, want the %d bytes that were written", len(body), len(payload))
	}

	// PresignGet on a public object hands back the same unsigned URL rather
	// than attaching an expiry to a CDN-cacheable asset.
	presigned, err := backend.PresignGet(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key}, time.Minute)
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}
	if presigned != saved.URL {
		t.Errorf("PresignGet on a public object = %q, want the plain public URL %q", presigned, saved.URL)
	}
}

// The Telegram sticker import streams a body whose length is unknown.
func TestS3PutWithUnknownSize(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 32*1024)

	saved, err := Save(context.Background(), backend, KindSticker, "stream.webp", "image/webp", io.NopCloser(bytes.NewReader(payload)), 0)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	t.Cleanup(func() {
		_ = backend.Delete(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key})
	})

	if saved.Size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", saved.Size, len(payload))
	}
	status, body := fetch(t, saved.URL)
	if status != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200", saved.URL, status)
	}
	if !bytes.Equal(body, payload) {
		t.Fatalf("streamed object round-tripped %d bytes, want %d", len(body), len(payload))
	}
}

func TestS3DeleteRemovesTheObject(t *testing.T) {
	backend := newTestS3Backend(t)
	payload := randomPayload(t, 128)
	saved := putTestObject(t, backend, KindImage, "gone.png", "image/png", payload)

	ref := ObjectRef{Bucket: saved.Bucket, Key: saved.Key}
	if err := backend.Delete(context.Background(), ref); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	presigned, err := backend.PresignGet(context.Background(), ref, time.Minute)
	if err != nil {
		t.Fatalf("PresignGet() error = %v", err)
	}
	if status, _ := fetch(t, presigned); status == http.StatusOK {
		t.Fatalf("a deleted object still fetched with 200")
	}

	// Deleting again is not an error: retries and cleanup paths repeat it.
	if err := backend.Delete(context.Background(), ref); err != nil {
		t.Fatalf("second Delete() error = %v", err)
	}
}

// EnsureBuckets runs on every boot.
func TestS3EnsureBucketsIsIdempotent(t *testing.T) {
	backend := newTestS3Backend(t)

	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		err := backend.EnsureBuckets(ctx)
		cancel()
		if err != nil {
			t.Fatalf("EnsureBuckets() call %d error = %v", i+1, err)
		}
	}
}

func truncate(body []byte) string {
	const limit = 300
	if len(body) > limit {
		return string(body[:limit]) + "..."
	}
	return string(body)
}

// The boot-time guard that refuses to start when the attachment bucket is
// anonymously readable. Without this test the guard is only exercised by the
// happy path, where it never fires.
func TestS3EnsureBucketsRefusesAPubliclyReadablePrivateBucket(t *testing.T) {
	backend := newTestS3Backend(t)
	ctx := context.Background()

	const wronglyPublic = "deco-test-wrongly-public"
	if err := backend.ensureBucketExists(ctx, wronglyPublic); err != nil {
		t.Fatalf("creating the fixture bucket: %v", err)
	}
	t.Cleanup(func() {
		_, _ = backend.Client().DeleteBucketPolicy(ctx, &s3.DeleteBucketPolicyInput{Bucket: aws.String(wronglyPublic)})
		_, _ = backend.Client().DeleteBucket(ctx, &s3.DeleteBucketInput{Bucket: aws.String(wronglyPublic)})
	})

	// Clean bucket: no policy at all, so the guard must be satisfied.
	if err := backend.assertNotAnonymouslyReadable(ctx, wronglyPublic); err != nil {
		t.Fatalf("a bucket with no policy was reported as public: %v", err)
	}

	if _, err := backend.Client().PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
		Bucket: aws.String(wronglyPublic),
		Policy: aws.String(publicReadPolicy(wronglyPublic)),
	}); err != nil {
		t.Fatalf("applying a public policy to the fixture bucket: %v", err)
	}

	err := backend.assertNotAnonymouslyReadable(ctx, wronglyPublic)
	if err == nil {
		t.Fatal("a bucket with an anonymous-read policy passed the private-bucket guard")
	}
	if !strings.Contains(err.Error(), wronglyPublic) {
		t.Errorf("the error should name the offending bucket, got: %v", err)
	}
}
