package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func newLocalBackend(t *testing.T) *LocalBackend {
	t.Helper()
	backend, err := NewLocalBackend(t.TempDir(), DefaultPublicUploadBase)
	if err != nil {
		t.Fatalf("NewLocalBackend() error = %v", err)
	}
	return backend
}

// The URL shape is a compatibility contract: every media URL already stored on
// a message, user or sticker row was produced by the pre-interface code as
// <PUBLIC_UPLOAD_BASE>/<prefix>/<millis>_<hex><ext>. Changing it orphans every
// existing attachment.
func TestLocalBackendPreservesLegacyURLShape(t *testing.T) {
	backend := newLocalBackend(t)
	shape := regexp.MustCompile(`^/api/v1/media/messages/images/[0-9]{10,}_[0-9a-f]{16}\.png$`)

	saved, err := Save(context.Background(), backend, KindImage, "holiday.png", "image/png", strings.NewReader("bytes"), 5)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if !shape.MatchString(saved.URL) {
		t.Fatalf("URL = %q, want a URL matching %s", saved.URL, shape)
	}
	if saved.Bucket != BucketPrivate {
		t.Errorf("bucket = %q, want %q", saved.Bucket, BucketPrivate)
	}
	if saved.Name != "holiday.png" {
		t.Errorf("name = %q, want holiday.png", saved.Name)
	}
	if saved.Size != 5 {
		t.Errorf("size = %d, want 5", saved.Size)
	}
	if saved.URL != joinURL(DefaultPublicUploadBase, saved.Key) {
		t.Errorf("URL %q is not the public base joined with key %q", saved.URL, saved.Key)
	}
}

func TestLocalBackendAvatarURLShape(t *testing.T) {
	backend := newLocalBackend(t)
	shape := regexp.MustCompile(`^/api/v1/media/avatars/[0-9]{10,}_[0-9a-f]{16}\.jpg$`)

	saved, err := Save(context.Background(), backend, KindAvatar, "me.jpg", "image/jpeg", strings.NewReader("x"), 1)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if !shape.MatchString(saved.URL) {
		t.Fatalf("URL = %q, want a URL matching %s", saved.URL, shape)
	}
	if saved.Bucket != BucketPublic {
		t.Errorf("bucket = %q, want %q", saved.Bucket, BucketPublic)
	}
}

func TestLocalBackendWritesTheBytesUnderTheRoot(t *testing.T) {
	root := t.TempDir()
	backend, err := NewLocalBackend(root, DefaultPublicUploadBase)
	if err != nil {
		t.Fatalf("NewLocalBackend() error = %v", err)
	}

	payload := bytes.Repeat([]byte{0x42}, 4096)
	saved, err := Save(context.Background(), backend, KindFile, "report.pdf", "application/pdf", bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Size != int64(len(payload)) {
		t.Fatalf("size = %d, want %d", saved.Size, len(payload))
	}

	onDisk := filepath.Join(root, filepath.FromSlash(saved.Key))
	got, err := os.ReadFile(onDisk)
	if err != nil {
		t.Fatalf("reading %s: %v", onDisk, err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatalf("stored %d bytes, want %d identical bytes", len(got), len(payload))
	}
}

func TestLocalBackendDeleteIsIdempotent(t *testing.T) {
	root := t.TempDir()
	backend, err := NewLocalBackend(root, DefaultPublicUploadBase)
	if err != nil {
		t.Fatalf("NewLocalBackend() error = %v", err)
	}

	saved, err := Save(context.Background(), backend, KindImage, "a.png", "image/png", strings.NewReader("x"), 1)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	ref := ObjectRef{Bucket: saved.Bucket, Key: saved.Key}

	if err := backend.Delete(context.Background(), ref); err != nil {
		t.Fatalf("first Delete() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(saved.Key))); !os.IsNotExist(err) {
		t.Fatalf("object still on disk after Delete: %v", err)
	}
	if err := backend.Delete(context.Background(), ref); err != nil {
		t.Fatalf("deleting a missing object should not be an error, got %v", err)
	}
}

// Keys reach the backend from application code, but the interface is public
// and the local backend turns keys into filesystem paths. It must refuse to
// write outside its root even when handed a hostile key directly.
func TestLocalBackendRejectsTraversalKeys(t *testing.T) {
	root := t.TempDir()
	backend, err := NewLocalBackend(root, DefaultPublicUploadBase)
	if err != nil {
		t.Fatalf("NewLocalBackend() error = %v", err)
	}

	hostile := []string{
		"../escaped.png",
		"messages/../../escaped.png",
		"/etc/passwd",
		"..\\escaped.png",
		"",
	}

	for _, key := range hostile {
		ref := ObjectRef{Bucket: BucketPrivate, Key: key}
		if _, err := backend.Put(context.Background(), ref, PutInput{Body: strings.NewReader("x"), MimeType: "image/png", Size: 1}); err == nil {
			t.Errorf("Put with key %q was accepted, want a rejection", key)
		}
		if _, err := backend.PresignGet(context.Background(), ref, time.Minute); err == nil {
			t.Errorf("PresignGet with key %q was accepted, want a rejection", key)
		}
		if err := backend.Delete(context.Background(), ref); err == nil {
			t.Errorf("Delete with key %q was accepted, want a rejection", key)
		}
	}

	// Nothing escaped into the temp root's parent.
	if _, err := os.Stat(filepath.Join(filepath.Dir(root), "escaped.png")); !os.IsNotExist(err) {
		t.Fatalf("a file escaped the upload root: %v", err)
	}
}

func TestLocalBackendRejectsUnknownBucket(t *testing.T) {
	backend := newLocalBackend(t)
	ref := ObjectRef{Bucket: Bucket("secret"), Key: "avatars/a.png"}

	if _, err := backend.Put(context.Background(), ref, PutInput{Body: strings.NewReader("x"), MimeType: "image/png", Size: 1}); err == nil {
		t.Error("Put with an unknown bucket was accepted, want a rejection")
	}
}

func TestLocalBackendRejectsTTLAboveTheMaximum(t *testing.T) {
	backend := newLocalBackend(t)
	saved, err := Save(context.Background(), backend, KindImage, "a.png", "image/png", strings.NewReader("x"), 1)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}

	if _, err := backend.PresignGet(context.Background(), ObjectRef{Bucket: saved.Bucket, Key: saved.Key}, MaxPresignTTL+time.Second); err == nil {
		t.Fatalf("expected a TTL above %s to be rejected", MaxPresignTTL)
	}
}

func TestEnsureDirectoriesCreatesEveryPrefix(t *testing.T) {
	root := t.TempDir()
	if err := EnsureDirectories(root); err != nil {
		t.Fatalf("EnsureDirectories() error = %v", err)
	}

	for _, dir := range []string{
		"avatars", "messages/images", "messages/videos", "messages/audio",
		"messages/files", "stickers/static", "stickers/video", "stickers/animated",
	} {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(dir)))
		if err != nil {
			t.Errorf("missing directory %s: %v", dir, err)
			continue
		}
		if !info.IsDir() {
			t.Errorf("%s is not a directory", dir)
		}
	}

	// Idempotent — it runs on every boot.
	if err := EnsureDirectories(root); err != nil {
		t.Fatalf("second EnsureDirectories() error = %v", err)
	}
}

// Save must stream a body whose length the caller does not know. Sticker
// imports pass size 0 because the Telegram download reports none.
func TestSaveAcceptsUnknownSize(t *testing.T) {
	backend := newLocalBackend(t)
	payload := strings.Repeat("s", 10_000)

	saved, err := Save(context.Background(), backend, KindSticker, "cat.webp", "image/webp", io.NopCloser(strings.NewReader(payload)), 0)
	if err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if saved.Size != int64(len(payload)) {
		t.Errorf("size = %d, want %d", saved.Size, len(payload))
	}
	if !strings.HasPrefix(saved.Key, "stickers/static/") {
		t.Errorf("key = %q, want the stickers/static prefix", saved.Key)
	}
}
