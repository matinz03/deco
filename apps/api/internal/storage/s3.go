package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// DefaultMaxSpoolBytes bounds how much of an unknown-length upload the s3
// backend will buffer before refusing it. It is above the largest per-kind
// limit enforced in handlers/uploads.go.
const DefaultMaxSpoolBytes int64 = 256 << 20

// DefaultPresignTTL is used when a caller passes ttl <= 0.
const DefaultPresignTTL = 5 * time.Minute

// S3Options configures the S3-compatible backend. Deco runs MinIO behind it
// in development and in production; any other S3-compatible service works
// through the same code path, differing only in Endpoint, Region and
// UsePathStyle.
type S3Options struct {
	// Endpoint is the S3 API endpoint — http://minio:9000 inside the compose
	// network, http://127.0.0.1:9000 from the host. Empty means AWS S3.
	Endpoint string
	// Region — MinIO ignores it, but SigV4 needs some value to sign with.
	Region string
	// AccessKeyID / SecretAccessKey are static credentials. No ambient AWS
	// credential chain is consulted: the API must never silently pick up an
	// instance role.
	AccessKeyID     string
	SecretAccessKey string
	// UsePathStyle addresses buckets as <endpoint>/<bucket>/<key>. MinIO
	// needs it unless it is fronted by wildcard-DNS virtual hosting.
	UsePathStyle bool

	// PublicBucket / PrivateBucket are the concrete bucket names behind the
	// two logical buckets. They must be different buckets: the private one
	// must have no anonymous read policy.
	PublicBucket  string
	PrivateBucket string

	// PublicBaseURL is the browser-reachable origin public objects are served
	// from — normally the reverse proxy in front of MinIO. When empty it is
	// derived from Endpoint and PublicBucket, which is only correct when the
	// endpoint is itself reachable from the browser.
	PublicBaseURL string
	// PrivateRefBase is the application-relative prefix recorded on database
	// rows for private objects. Private objects have no durable URL, so the
	// row stores a reference the API can later resolve into a presigned GET.
	PrivateRefBase string

	// DefaultTTL is used when PresignGet is called with ttl <= 0.
	DefaultTTL time.Duration
	// MaxSpoolBytes bounds unknown-length bodies. Zero means
	// DefaultMaxSpoolBytes.
	MaxSpoolBytes int64
}

// S3Backend is an S3-compatible Backend. It is safe for concurrent use.
type S3Backend struct {
	client  *s3.Client
	presign *s3.PresignClient
	opts    S3Options
}

var _ Backend = (*S3Backend)(nil)

// NewS3Backend validates the options and builds the client. Any misconfigured
// field is an error here — at boot — rather than on the first upload.
func NewS3Backend(opts S3Options) (*S3Backend, error) {
	if strings.TrimSpace(opts.AccessKeyID) == "" || strings.TrimSpace(opts.SecretAccessKey) == "" {
		return nil, errors.New("storage: s3 backend requires an access key id and secret access key")
	}
	if err := validateBucketName(opts.PublicBucket); err != nil {
		return nil, fmt.Errorf("storage: public bucket: %w", err)
	}
	if err := validateBucketName(opts.PrivateBucket); err != nil {
		return nil, fmt.Errorf("storage: private bucket: %w", err)
	}
	if opts.PublicBucket == opts.PrivateBucket {
		return nil, errors.New("storage: public and private buckets must be different buckets")
	}
	if opts.Region == "" {
		opts.Region = "us-east-1"
	}
	if opts.DefaultTTL <= 0 {
		opts.DefaultTTL = DefaultPresignTTL
	}
	if opts.DefaultTTL > MaxPresignTTL {
		return nil, fmt.Errorf("%w: default ttl %s > %s", ErrTTLTooLong, opts.DefaultTTL, MaxPresignTTL)
	}
	if opts.MaxSpoolBytes <= 0 {
		opts.MaxSpoolBytes = DefaultMaxSpoolBytes
	}
	if strings.TrimSpace(opts.PrivateRefBase) == "" {
		opts.PrivateRefBase = DefaultPublicUploadBase
	}

	if opts.Endpoint != "" {
		parsed, err := url.Parse(opts.Endpoint)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return nil, fmt.Errorf("storage: invalid s3 endpoint %q", opts.Endpoint)
		}
	}

	if strings.TrimSpace(opts.PublicBaseURL) == "" {
		derived, err := derivePublicBaseURL(opts)
		if err != nil {
			return nil, err
		}
		opts.PublicBaseURL = derived
	}
	opts.PublicBaseURL = strings.TrimRight(opts.PublicBaseURL, "/")
	opts.PrivateRefBase = strings.TrimRight(opts.PrivateRefBase, "/")

	awsCfg := aws.Config{
		Region: opts.Region,
		Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{
				AccessKeyID:     opts.AccessKeyID,
				SecretAccessKey: opts.SecretAccessKey,
				Source:          "deco-storage-static",
			}, nil
		}),
		// Restrict checksums to the operations that actually require them.
		// The SDK otherwise adds CRC trailers that several S3-compatible
		// implementations reject outright, which would tie this code to one
		// provider.
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	}

	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if opts.Endpoint != "" {
			o.BaseEndpoint = aws.String(strings.TrimRight(opts.Endpoint, "/"))
		}
		o.UsePathStyle = opts.UsePathStyle
	})

	return &S3Backend{
		client:  client,
		presign: s3.NewPresignClient(client),
		opts:    opts,
	}, nil
}

// Client exposes the underlying S3 client for bucket provisioning and tests.
// Handlers must go through the Backend interface instead.
func (b *S3Backend) Client() *s3.Client { return b.client }

// BucketName maps a logical bucket onto the configured concrete bucket name.
func (b *S3Backend) BucketName(bucket Bucket) (string, error) {
	switch bucket {
	case BucketPublic:
		return b.opts.PublicBucket, nil
	case BucketPrivate:
		return b.opts.PrivateBucket, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidBucket, string(bucket))
	}
}

// PublicURL is the unsigned URL of a public-bucket object.
func (b *S3Backend) PublicURL(key string) string {
	return joinURL(b.opts.PublicBaseURL, key)
}

func (b *S3Backend) Put(ctx context.Context, ref ObjectRef, in PutInput) (*PutResult, error) {
	if err := ref.Validate(); err != nil {
		return nil, err
	}
	if in.Body == nil {
		return nil, errors.New("storage: nil body")
	}
	bucket, err := b.BucketName(ref.Bucket)
	if err != nil {
		return nil, err
	}

	body, size, cleanup, err := spool(in.Body, in.Size, b.opts.MaxSpoolBytes)
	defer cleanup()
	if err != nil {
		return nil, err
	}

	_, err = b.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(bucket),
		Key:           aws.String(ref.Key),
		Body:          body,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(sanitizeContentType(in.MimeType)),
	})
	if err != nil {
		return nil, fmt.Errorf("storage: put %s: %w", ref, err)
	}

	url := joinURL(b.opts.PrivateRefBase, ref.Key)
	if ref.Bucket == BucketPublic {
		url = b.PublicURL(ref.Key)
	}

	return &PutResult{Bucket: ref.Bucket, Key: ref.Key, URL: url, Size: size}, nil
}

func (b *S3Backend) PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration) (string, error) {
	if err := ref.Validate(); err != nil {
		return "", err
	}
	// Public objects are served unsigned. Signing them would attach a
	// pointless expiry to avatars and stickers and defeat CDN caching.
	if ref.Bucket == BucketPublic {
		return b.PublicURL(ref.Key), nil
	}

	bucket, err := b.BucketName(ref.Bucket)
	if err != nil {
		return "", err
	}
	if ttl <= 0 {
		ttl = b.opts.DefaultTTL
	}
	if ttl > MaxPresignTTL {
		return "", fmt.Errorf("%w: %s > %s", ErrTTLTooLong, ttl, MaxPresignTTL)
	}

	req, err := b.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(ref.Key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage: presign %s: %w", ref, err)
	}
	return req.URL, nil
}

func (b *S3Backend) Delete(ctx context.Context, ref ObjectRef) error {
	if err := ref.Validate(); err != nil {
		return err
	}
	bucket, err := b.BucketName(ref.Bucket)
	if err != nil {
		return err
	}
	if _, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(ref.Key),
	}); err != nil {
		return fmt.Errorf("storage: delete %s: %w", ref, err)
	}
	return nil
}

// derivePublicBaseURL builds the unsigned public URL prefix from the endpoint
// when no explicit one is configured. Path-style gives <endpoint>/<bucket>,
// virtual-host style gives <scheme>://<bucket>.<host>.
func derivePublicBaseURL(opts S3Options) (string, error) {
	if opts.Endpoint == "" {
		return "", errors.New("storage: s3 backend needs STORAGE_PUBLIC_BASE_URL when no endpoint is configured")
	}
	parsed, err := url.Parse(strings.TrimRight(opts.Endpoint, "/"))
	if err != nil || parsed.Host == "" {
		return "", fmt.Errorf("storage: cannot derive a public base url from endpoint %q", opts.Endpoint)
	}
	if opts.UsePathStyle {
		return strings.TrimRight(opts.Endpoint, "/") + "/" + opts.PublicBucket, nil
	}
	parsed.Host = opts.PublicBucket + "." + parsed.Host
	return strings.TrimRight(parsed.String(), "/"), nil
}

// spool makes the body seekable with a known length. Multipart uploads and
// Telegram downloads both arrive as non-seekable readers, and an unknown
// Content-Length is not something every S3 implementation accepts.
func spool(r io.Reader, size, max int64) (io.ReadSeeker, int64, func(), error) {
	noop := func() {}

	if size > max {
		return nil, 0, noop, fmt.Errorf("%w: %d bytes > %d", ErrObjectTooLarge, size, max)
	}
	if seeker, ok := r.(io.ReadSeeker); ok && size > 0 {
		return seeker, size, noop, nil
	}

	tmp, err := os.CreateTemp("", "deco-upload-*")
	if err != nil {
		return nil, 0, noop, err
	}
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmp.Name())
	}

	written, err := io.Copy(tmp, io.LimitReader(r, max+1))
	if err != nil {
		return nil, 0, cleanup, err
	}
	if written > max {
		return nil, 0, cleanup, fmt.Errorf("%w: more than %d bytes", ErrObjectTooLarge, max)
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		return nil, 0, cleanup, err
	}
	return tmp, written, cleanup, nil
}

// sanitizeContentType keeps only a well-formed `type/subtype` token. MIME
// types reach here from client multipart headers and from Telegram, so a
// value containing CR/LF or quotes must never be echoed into a response
// header by the storage provider.
func sanitizeContentType(mimeType string) string {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		return "application/octet-stream"
	}
	if idx := strings.IndexByte(mimeType, ';'); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	slash := strings.IndexByte(mimeType, '/')
	if slash <= 0 || slash == len(mimeType)-1 || len(mimeType) > 128 {
		return "application/octet-stream"
	}
	for i := 0; i < len(mimeType); i++ {
		c := mimeType[i]
		if i == slash {
			continue
		}
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '.' || c == '-' || c == '+' || c == '_' {
			continue
		}
		return "application/octet-stream"
	}
	return strings.ToLower(mimeType)
}

// validateBucketName applies the S3 bucket naming rules that matter here: the
// name is interpolated into a URL, so it must not smuggle a path or a host.
func validateBucketName(name string) error {
	if len(name) < 3 || len(name) > 63 {
		return fmt.Errorf("bucket name %q must be 3-63 characters", name)
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' {
			continue
		}
		return fmt.Errorf("bucket name %q contains an invalid character", name)
	}
	if name[0] == '-' || name[0] == '.' || name[len(name)-1] == '-' || name[len(name)-1] == '.' {
		return fmt.Errorf("bucket name %q must start and end with a letter or digit", name)
	}
	return nil
}
