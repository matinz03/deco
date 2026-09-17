package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DefaultUploadRoot and DefaultPublicUploadBase mirror the historical
// UPLOAD_ROOT / PUBLIC_UPLOAD_BASE defaults.
const (
	DefaultUploadRoot       = "./uploads"
	DefaultPublicUploadBase = "/api/v1/media"
)

// LocalBackend stores objects on the API server's own disk, served by the
// http.FileServer mounted in cmd/server. It reproduces the behaviour and the
// URL shape this repository had before the Backend interface existed.
//
// It is a development and single-host fallback only. It has NO way to sign a
// URL: PresignGet returns the same permanent, unauthenticated URL that Put
// returns, ignoring the TTL, and it does not enforce the public/private split
// — every object under the root is reachable through the file server. Any
// caller that depends on a private object actually being private must run on
// the s3 backend.
type LocalBackend struct {
	root       string
	publicBase string
}

var _ Backend = (*LocalBackend)(nil)

// NewLocalBackend prepares the on-disk root. root and publicBase fall back to
// the historical defaults when empty.
func NewLocalBackend(root, publicBase string) (*LocalBackend, error) {
	if strings.TrimSpace(root) == "" {
		root = DefaultUploadRoot
	}
	if strings.TrimSpace(publicBase) == "" {
		publicBase = DefaultPublicUploadBase
	}

	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("storage: resolving upload root %q: %w", root, err)
	}
	if err := EnsureDirectories(abs); err != nil {
		return nil, fmt.Errorf("storage: preparing upload root %q: %w", abs, err)
	}

	return &LocalBackend{root: abs, publicBase: strings.TrimRight(publicBase, "/")}, nil
}

// Root is the absolute directory objects are written under.
func (b *LocalBackend) Root() string { return b.root }

// PublicBase is the URL prefix objects are served from.
func (b *LocalBackend) PublicBase() string { return b.publicBase }

func (b *LocalBackend) Put(ctx context.Context, ref ObjectRef, in PutInput) (*PutResult, error) {
	if err := ref.Validate(); err != nil {
		return nil, err
	}
	if in.Body == nil {
		return nil, errors.New("storage: nil body")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	absolute, err := b.resolve(ref.Key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
		return nil, err
	}

	file, err := os.Create(absolute)
	if err != nil {
		return nil, err
	}

	written, copyErr := io.Copy(file, in.Body)
	closeErr := file.Close()
	if copyErr != nil {
		// Do not leave a truncated object behind for a URL nobody holds.
		_ = os.Remove(absolute)
		return nil, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(absolute)
		return nil, closeErr
	}

	return &PutResult{
		Bucket: ref.Bucket,
		Key:    ref.Key,
		URL:    joinURL(b.publicBase, ref.Key),
		Size:   written,
	}, nil
}

// PresignGet returns the plain file-server URL. The local backend cannot sign,
// so ttl is ignored and the URL never expires — see the type comment.
func (b *LocalBackend) PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration) (string, error) {
	if err := ref.Validate(); err != nil {
		return "", err
	}
	if ttl > MaxPresignTTL {
		return "", fmt.Errorf("%w: %s > %s", ErrTTLTooLong, ttl, MaxPresignTTL)
	}
	return joinURL(b.publicBase, ref.Key), nil
}

func (b *LocalBackend) Delete(ctx context.Context, ref ObjectRef) error {
	if err := ref.Validate(); err != nil {
		return err
	}
	absolute, err := b.resolve(ref.Key)
	if err != nil {
		return err
	}
	if err := os.Remove(absolute); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// resolve maps an object key onto an absolute path and refuses anything that
// lands outside the root.
func (b *LocalBackend) resolve(key string) (string, error) {
	absolute := filepath.Join(b.root, filepath.FromSlash(key))
	rel, err := filepath.Rel(b.root, absolute)
	if err != nil {
		return "", fmt.Errorf("%w: %s", ErrInvalidKey, key)
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("%w: escapes the upload root", ErrInvalidKey)
	}
	return absolute, nil
}

// EnsureDirectories creates the fixed key prefixes under root at boot so the
// first upload of each kind does not race directory creation.
func EnsureDirectories(root string) error {
	for _, dir := range []string{
		"avatars",
		"messages/images",
		"messages/videos",
		"messages/audio",
		"messages/files",
		"stickers/static",
		"stickers/video",
		"stickers/animated",
	} {
		if err := os.MkdirAll(filepath.Join(root, filepath.FromSlash(dir)), 0o755); err != nil {
			return err
		}
	}
	return nil
}
