package storage

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectMimeTypeDoesNotTrustMultipartFallback(t *testing.T) {
	if got := DetectMimeType([]byte("not a PDF"), "application/pdf"); got == "application/pdf" {
		t.Fatalf("DetectMimeType() = %q, must not trust multipart fallback", got)
	}
}

func TestLocalBackendRemovesPartialFileAfterCopyFailure(t *testing.T) {
	root := t.TempDir()
	backend, err := NewLocalBackend(root, DefaultPublicUploadBase)
	if err != nil {
		t.Fatalf("NewLocalBackend() error = %v", err)
	}

	_, err = Save(context.Background(), backend, KindImage, "partial.png", "image/png", &failingReader{}, 7)
	if err == nil {
		t.Fatal("Save() unexpectedly succeeded")
	}

	entries, err := os.ReadDir(filepath.Join(root, "messages", "images"))
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("partial upload left %d file(s)", len(entries))
	}
}

type failingReader struct {
	read bool
}

func (r *failingReader) Read(p []byte) (int, error) {
	if r.read {
		return 0, errors.New("read failure")
	}
	r.read = true
	copy(p, "partial")
	return len("partial"), errors.New("read failure")
}
