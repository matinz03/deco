// Package storage abstracts where uploaded media lives.
//
// Two logical buckets exist and the distinction is part of the Backend
// interface, never implied by the caller:
//
//   - BucketPublic  — avatars and stickers. Plaintext, CDN-cacheable, fetched
//     with no signature.
//   - BucketPrivate — message attachments. Never publicly readable; reads go
//     through Backend.PresignGet with a short TTL, and the caller is
//     responsible for the conversation-membership check first.
//
// Filenames and MIME types reaching this package come from multipart uploads
// and from third-party APIs (Telegram). They are treated as attacker
// controlled: object keys are generated server-side, never derived from the
// supplied name beyond a validated extension.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Bucket is a logical storage bucket. It is not a bucket name — each backend
// maps it onto its own concrete storage (a directory prefix for local, a real
// bucket for s3).
type Bucket string

const (
	// BucketPublic holds objects that are served without authorization:
	// avatars and stickers.
	BucketPublic Bucket = "public"
	// BucketPrivate holds message attachments. Objects here must only be
	// reachable through a presigned URL with a short TTL.
	BucketPrivate Bucket = "private"
)

// Valid reports whether b is one of the two known logical buckets.
func (b Bucket) Valid() bool {
	return b == BucketPublic || b == BucketPrivate
}

// MaxPresignTTL is a hard ceiling on presigned-GET lifetimes. A presigned URL
// is a bearer credential for a single object; long TTLs turn a leaked URL into
// long-lived unauthenticated access. Backends must refuse anything longer.
const MaxPresignTTL = 1 * time.Hour

var (
	// ErrInvalidKey is returned for object keys that are empty, absolute,
	// contain traversal segments, backslashes or control characters.
	ErrInvalidKey = errors.New("storage: invalid object key")
	// ErrInvalidBucket is returned for a Bucket value that is not one of the
	// two logical buckets.
	ErrInvalidBucket = errors.New("storage: invalid bucket")
	// ErrTTLTooLong is returned when a caller asks for a presigned URL that
	// outlives MaxPresignTTL.
	ErrTTLTooLong = errors.New("storage: presign ttl exceeds maximum")
	// ErrObjectTooLarge is returned when a body exceeds the backend's spool
	// limit.
	ErrObjectTooLarge = errors.New("storage: object too large")
)

// ObjectRef identifies one stored object. The bucket is always explicit.
type ObjectRef struct {
	Bucket Bucket
	Key    string
}

// Validate checks the bucket and the key shape.
func (r ObjectRef) Validate() error {
	if !r.Bucket.Valid() {
		return fmt.Errorf("%w: %q", ErrInvalidBucket, string(r.Bucket))
	}
	return ValidateKey(r.Key)
}

// String renders the reference for logs. It never includes credentials.
func (r ObjectRef) String() string {
	return string(r.Bucket) + ":" + r.Key
}

// PutInput carries the bytes and metadata for a single object write.
type PutInput struct {
	// Body is the object content. It is read exactly once.
	Body io.Reader
	// MimeType is the server-detected content type. It is sanitized by the
	// backend before it is sent anywhere.
	MimeType string
	// Size is the content length when known, or 0 when the caller is
	// streaming from a source that does not report one (Telegram downloads).
	Size int64
}

// PutResult describes a stored object.
type PutResult struct {
	Bucket Bucket
	Key    string
	// URL is the reference persisted on the database row. For public objects
	// it is directly fetchable. For private objects it is an application
	// relative reference — never a presigned URL, which would expire while
	// the row lives forever.
	URL string
	// Size is the number of bytes actually written.
	Size int64
}

// Backend is the storage contract. Implementations must be safe for
// concurrent use.
type Backend interface {
	// Put writes an object. The key must already be validated-shaped; the
	// backend re-validates.
	Put(ctx context.Context, ref ObjectRef, in PutInput) (*PutResult, error)

	// PresignGet returns a URL that grants read access to exactly one object
	// for at most ttl. For BucketPublic the returned URL carries no signature
	// and does not expire. ttl <= 0 means "backend default"; ttl greater than
	// MaxPresignTTL is an error.
	PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration) (string, error)

	// Delete removes an object. Deleting an object that does not exist is not
	// an error.
	Delete(ctx context.Context, ref ObjectRef) error
}

// Kind is the upload category supplied by the client. It selects both the key
// prefix and the logical bucket.
type Kind string

const (
	KindAvatar  Kind = "avatar"
	KindImage   Kind = "image"
	KindVideo   Kind = "video"
	KindAudio   Kind = "audio"
	KindFile    Kind = "file"
	KindSticker Kind = "sticker"
)

// BucketForKind maps an upload kind onto a logical bucket.
//
// Avatars and stickers are public by design: sticker packs and avatars are
// rendered by plain <img> tags across the app and gain nothing from being
// private. Everything attached to a message is private.
func BucketForKind(kind Kind) (Bucket, error) {
	switch kind {
	case KindAvatar, KindSticker:
		return BucketPublic, nil
	case KindImage, KindVideo, KindAudio, KindFile:
		return BucketPrivate, nil
	default:
		return "", fmt.Errorf("storage: unsupported upload kind: %q", string(kind))
	}
}

// SavedFile is the handler-facing result of an upload.
type SavedFile struct {
	URL      string
	MimeType string
	Size     int64
	Name     string
	Bucket   Bucket
	Key      string
}

// Save generates a server-side object key for the upload kind, picks the
// logical bucket for that kind, and writes the object through the backend.
//
// The generated key — and therefore the resulting URL for the local backend —
// is byte-identical to the layout used before the Backend interface existed,
// so URLs already stored on message and sticker rows keep resolving.
func Save(ctx context.Context, backend Backend, kind Kind, originalName, mimeType string, data io.Reader, size int64) (*SavedFile, error) {
	if backend == nil {
		return nil, errors.New("storage: nil backend")
	}

	bucket, err := BucketForKind(kind)
	if err != nil {
		return nil, err
	}

	key, err := NewObjectKey(kind, originalName, mimeType)
	if err != nil {
		return nil, err
	}

	ref := ObjectRef{Bucket: bucket, Key: key}
	result, err := backend.Put(ctx, ref, PutInput{Body: data, MimeType: mimeType, Size: size})
	if err != nil {
		return nil, err
	}

	return &SavedFile{
		URL:      result.URL,
		MimeType: mimeType,
		Size:     result.Size,
		Name:     sanitizeFileName(originalName),
		Bucket:   result.Bucket,
		Key:      result.Key,
	}, nil
}

// DetectMimeType trusts only sniffed bytes. Multipart Content-Type comes from
// an untrusted client and must not decide whether an upload is executable.
func DetectMimeType(header []byte, _ string) string {
	return http.DetectContentType(header)
}
