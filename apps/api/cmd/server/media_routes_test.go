package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/storage"
)

func TestMediaRoutesRequireTicketsAndPreserveLegacyAlias(t *testing.T) {
	now := time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC)
	root := testMediaRoot(t)
	writeTestMediaFile(t, root, "messages/images/private.png", "private image")
	writeTestMediaFile(t, root, "messages/images/other.png", "other image")
	writeTestMediaFile(t, root, "messages/files/private.pdf", "private file")

	secret := "ticket-secret"
	router := testMediaRouter(root, secret, "/api/v1/media", now)
	imageTicket := mustSignMediaTicket(t, "messages/images/private.png", secret, now)
	fileTicket := mustSignMediaTicket(t, "messages/files/private.pdf", secret, now)
	expiredTicket := mustSignMediaTicket(t, "messages/images/private.png", secret, now.Add(-6*time.Minute))

	tests := []struct {
		name   string
		method string
		path   string
		status int
	}{
		{"anonymous canonical private media", http.MethodGet, "/api/v1/media/messages/images/private.png", http.StatusUnauthorized},
		{"anonymous legacy private media", http.MethodGet, "/uploads/messages/images/private.png", http.StatusUnauthorized},
		{"valid canonical ticket", http.MethodGet, "/api/v1/media/messages/images/private.png?ticket=" + url.QueryEscape(imageTicket), http.StatusOK},
		{"valid legacy ticket", http.MethodGet, "/uploads/messages/images/private.png?ticket=" + url.QueryEscape(imageTicket), http.StatusOK},
		{"tampered ticket", http.MethodGet, "/api/v1/media/messages/images/private.png?ticket=" + url.QueryEscape(imageTicket+"x"), http.StatusUnauthorized},
		{"wrong path", http.MethodGet, "/api/v1/media/messages/images/other.png?ticket=" + url.QueryEscape(imageTicket), http.StatusUnauthorized},
		{"expired ticket", http.MethodGet, "/api/v1/media/messages/images/private.png?ticket=" + url.QueryEscape(expiredTicket), http.StatusUnauthorized},
		{"ticket cannot authorize HEAD", http.MethodHead, "/api/v1/media/messages/images/private.png?ticket=" + url.QueryEscape(imageTicket), http.StatusMethodNotAllowed},
		{"ticket cannot authorize POST", http.MethodPost, "/api/v1/media/messages/images/private.png?ticket=" + url.QueryEscape(imageTicket), http.StatusMethodNotAllowed},
		{"valid ticket for missing file", http.MethodGet, "/api/v1/media/messages/images/missing.png?ticket=" + url.QueryEscape(mustSignMediaTicket(t, "messages/images/missing.png", secret, now)), http.StatusNotFound},
		{"file receives download disposition", http.MethodGet, "/api/v1/media/messages/files/private.pdf?ticket=" + url.QueryEscape(fileTicket), http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d; body = %q", recorder.Code, test.status, recorder.Body.String())
			}
			if test.status == http.StatusOK {
				if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
					t.Fatalf("X-Content-Type-Options = %q, want nosniff", got)
				}
				if got := recorder.Header().Get("Content-Security-Policy"); got != "default-src 'none'" {
					t.Fatalf("Content-Security-Policy = %q", got)
				}
			}
		})
	}

	fileResponse := httptest.NewRecorder()
	router.ServeHTTP(fileResponse, httptest.NewRequest(http.MethodGet, "/api/v1/media/messages/files/private.pdf?ticket="+url.QueryEscape(fileTicket), nil))
	if got := fileResponse.Header().Get("Content-Disposition"); got != "attachment" {
		t.Fatalf("Content-Disposition = %q, want attachment", got)
	}
	if got := fileResponse.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q, want private, no-store", got)
	}
}

func TestMediaRoutesAllowOnlyIntendedPublicAssets(t *testing.T) {
	now := time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC)
	root := testMediaRoot(t)
	for _, relativePath := range []string{
		"avatars/avatar.png",
		"stickers/static/sticker.png",
		"stickers/video/sticker.webm",
		"stickers/animated/sticker.tgs",
	} {
		writeTestMediaFile(t, root, relativePath, relativePath)
	}
	router := testMediaRouter(root, "ticket-secret", "/api/v1/media", now)

	for _, relativePath := range []string{
		"avatars/avatar.png",
		"stickers/static/sticker.png",
		"stickers/video/sticker.webm",
		"stickers/animated/sticker.tgs",
	} {
		t.Run(relativePath, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/media/"+relativePath, nil))
			if recorder.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
			}
		})
	}

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/media/avatars/avatar.png", nil))
	if got := recorder.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("public asset Cache-Control = %q, want empty", got)
	}

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v1/media/avatars/avatar.png", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("public POST status = %d, want %d", recorder.Code, http.StatusMethodNotAllowed)
	}
}

func TestMediaRoutesRejectTraversal(t *testing.T) {
	now := time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC)
	root := testMediaRoot(t)
	writeTestMediaFile(t, root, "avatars/avatar.png", "avatar")
	router := testMediaRouter(root, "ticket-secret", "/api/v1/media", now)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/media/messages/images/%2e%2e/%2e%2e/avatars/avatar.png", nil))
	if recorder.Code == http.StatusOK {
		t.Fatal("traversal request unexpectedly served media")
	}
}

func TestMediaRoutesSupportUploadsAsConfiguredBase(t *testing.T) {
	now := time.Date(2026, time.August, 12, 12, 0, 0, 0, time.UTC)
	root := testMediaRoot(t)
	writeTestMediaFile(t, root, "messages/images/private.png", "private image")
	secret := "ticket-secret"
	router := testMediaRouter(root, secret, "/uploads", now)
	ticket := mustSignMediaTicket(t, "messages/images/private.png", secret, now)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/uploads/messages/images/private.png?ticket="+url.QueryEscape(ticket), nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
}

func testMediaRouter(root, secret, uploadBase string, now time.Time) http.Handler {
	router := chi.NewRouter()
	registerMediaRoutes(router, &config.Config{
		UploadRoot:       root,
		JWTSecret:        secret,
		PublicUploadBase: uploadBase,
	}, func() time.Time { return now })
	return router
}

func testMediaRoot(t *testing.T) string {
	t.Helper()
	return t.TempDir()
}

func writeTestMediaFile(t *testing.T, root, relativePath, contents string) {
	t.Helper()
	absolutePath := filepath.Join(root, filepath.FromSlash(relativePath))
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(absolutePath, []byte(contents), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
}

func mustSignMediaTicket(t *testing.T, relativePath, secret string, now time.Time) string {
	t.Helper()
	ticket, err := storage.SignMediaTicket(http.MethodGet, relativePath, secret, now)
	if err != nil {
		t.Fatalf("SignMediaTicket() error = %v", err)
	}
	return ticket
}
