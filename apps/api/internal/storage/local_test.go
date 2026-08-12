package storage

import (
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

func TestRemovePrivate(t *testing.T) {
	root := t.TempDir()
	relativePath := "messages/images/upload.png"
	absolutePath := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(absolutePath, []byte("image"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := RemovePrivate(root, relativePath); err != nil {
		t.Fatalf("RemovePrivate() error = %v", err)
	}
	if _, err := os.Stat(absolutePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat() error = %v, want not exist", err)
	}
}

func TestSaveRemovesPartialFileAfterCopyFailure(t *testing.T) {
	root := t.TempDir()
	_, err := Save(KindImage, root, "/api/v1/media", "partial.png", "image/png", &failingReader{}, 7)
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

func TestRemovePrivateRejectsPublicAndTraversalPaths(t *testing.T) {
	root := t.TempDir()
	for _, relativePath := range []string{
		"avatars/avatar.png",
		"messages/images/../files/upload.pdf",
	} {
		if err := RemovePrivate(root, relativePath); err == nil {
			t.Fatalf("RemovePrivate(%q) unexpectedly succeeded", relativePath)
		}
	}
}
