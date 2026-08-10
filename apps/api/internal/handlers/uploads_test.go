package handlers

import (
	"testing"

	"github.com/matinz03/deco/internal/storage"
)

func TestIsAllowedUploadSecurity(t *testing.T) {
	t.Run("Rejects HTML upload with kind=file", func(t *testing.T) {
		if isAllowedUpload(storage.KindFile, "text/html", "exploit.html") {
			t.Error("expected exploit.html with kind=file to be rejected")
		}
	})

	t.Run("Rejects SVG upload with kind=image", func(t *testing.T) {
		if isAllowedUpload(storage.KindImage, "image/svg+xml", "logo.svg") {
			t.Error("expected logo.svg with kind=image to be rejected")
		}
	})

	t.Run("Rejects JavaScript upload with kind=file", func(t *testing.T) {
		if isAllowedUpload(storage.KindFile, "application/javascript", "script.js") {
			t.Error("expected script.js with kind=file to be rejected")
		}
	})

	t.Run("Allows valid PDF upload with kind=file", func(t *testing.T) {
		if !isAllowedUpload(storage.KindFile, "application/pdf", "document.pdf") {
			t.Error("expected document.pdf with kind=file to be allowed")
		}
	})

	t.Run("Allows valid PNG upload with kind=image", func(t *testing.T) {
		if !isAllowedUpload(storage.KindImage, "image/png", "photo.png") {
			t.Error("expected photo.png with kind=image to be allowed")
		}
	})
}
