package handlers

import (
	"bytes"
	"errors"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/matinz03/deco/internal/storage"
)

func TestParseUploadMultipartFormRejectsOversizedRequest(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	file, err := writer.CreateFormFile("file", "oversized.bin")
	if err != nil {
		t.Fatalf("CreateFormFile() error = %v", err)
	}
	if _, err := file.Write(bytes.Repeat([]byte("x"), 2048)); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request := httptest.NewRequest("POST", "/api/v1/uploads", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	err = parseUploadMultipartForm(httptest.NewRecorder(), request, 1024, 256)
	if !errors.Is(err, errUploadRequestTooLarge) {
		t.Fatalf("parseUploadMultipartForm() error = %v, want errUploadRequestTooLarge", err)
	}
}

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

	t.Run("Rejects allowed file extension with unknown MIME type", func(t *testing.T) {
		if isAllowedUpload(storage.KindFile, "application/octet-stream", "document.pdf") {
			t.Error("expected unknown bytes named document.pdf to be rejected")
		}
	})

	t.Run("Rejects mismatched file MIME type and extension", func(t *testing.T) {
		if isAllowedUpload(storage.KindFile, "image/png", "document.pdf") {
			t.Error("expected PNG bytes named document.pdf to be rejected")
		}
	})

	t.Run("Allows ZIP-detected Office documents", func(t *testing.T) {
		if !isAllowedUpload(storage.KindFile, "application/zip", "document.docx") {
			t.Error("expected ZIP-detected document.docx to be allowed")
		}
	})

	t.Run("Allows gzip-detected Telegram stickers", func(t *testing.T) {
		if !isAllowedUpload(storage.KindSticker, "application/x-gzip", "sticker.tgs") {
			t.Error("expected gzip-detected sticker.tgs to be allowed")
		}
	})

	t.Run("Rejects gzip bytes named as a static sticker", func(t *testing.T) {
		if isAllowedUpload(storage.KindSticker, "application/x-gzip", "sticker.png") {
			t.Error("expected gzip bytes named sticker.png to be rejected")
		}
	})

	t.Run("Allows valid PNG upload with kind=image", func(t *testing.T) {
		if !isAllowedUpload(storage.KindImage, "image/png", "photo.png") {
			t.Error("expected photo.png with kind=image to be allowed")
		}
	})
}

func TestValidateEncryptedUpload(t *testing.T) {
	t.Run("allows structurally valid private ciphertext", func(t *testing.T) {
		if err := validateEncryptedUpload(storage.KindImage, "photo.png", "image/png", 16, 16+encryptedAttachmentOverhead); err != nil {
			t.Fatalf("validateEncryptedUpload() error = %v", err)
		}
	})

	t.Run("rejects encryption on public media", func(t *testing.T) {
		if err := validateEncryptedUpload(storage.KindAvatar, "photo.png", "image/png", 16, 16+encryptedAttachmentOverhead); err == nil {
			t.Fatal("validateEncryptedUpload() accepted encrypted avatar")
		}
	})

	t.Run("rejects ciphertext with impossible secretbox length", func(t *testing.T) {
		if err := validateEncryptedUpload(storage.KindImage, "photo.png", "image/png", 16, 55); err == nil {
			t.Fatal("validateEncryptedUpload() accepted mismatched ciphertext length")
		}
	})

	t.Run("rejects ciphertext above the browser-safe MVP limit", func(t *testing.T) {
		originalSize := int64(20<<20) + 1
		if err := validateEncryptedUpload(storage.KindVideo, "video.mp4", "video/mp4", originalSize, originalSize+encryptedAttachmentOverhead); err == nil {
			t.Fatal("validateEncryptedUpload() accepted oversized encrypted video")
		}
	})

	t.Run("rejects disallowed claimed plaintext type", func(t *testing.T) {
		if err := validateEncryptedUpload(storage.KindFile, "exploit.html", "text/html", 16, 16+encryptedAttachmentOverhead); err == nil {
			t.Fatal("validateEncryptedUpload() accepted disallowed original type")
		}
	})
}
