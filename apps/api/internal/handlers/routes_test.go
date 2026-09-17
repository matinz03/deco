package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"go.uber.org/zap"
)

func TestLegacyAuthRoutesAreAbsentWhenClerkEnabled(t *testing.T) {
	router := chi.NewRouter()
	RegisterAuthRoutes(router, nil, &config.Config{
		Clerk: config.ClerkConfig{Enabled: true, OwnerUserID: "user_owner"},
	}, zap.NewNop(), nil)

	for _, path := range []string{"/auth/register", "/auth/login", "/auth/logout", "/auth/refresh"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{}`))
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("POST %s status = %d, want 404", path, rec.Code)
		}
	}
}

func TestLegacyAuthRoutesRemainWhenClerkDisabled(t *testing.T) {
	router := chi.NewRouter()
	RegisterAuthRoutes(router, nil, &config.Config{}, zap.NewNop(), nil)

	tests := []struct {
		path       string
		body       string
		wantStatus int
	}{
		{path: "/auth/register", body: `{}`, wantStatus: http.StatusBadRequest},
		{path: "/auth/login", body: `{}`, wantStatus: http.StatusBadRequest},
		{path: "/auth/logout", wantStatus: http.StatusOK},
		{path: "/auth/refresh", wantStatus: http.StatusNotImplemented},
	}

	for _, tt := range tests {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
		router.ServeHTTP(rec, req)
		if rec.Code != tt.wantStatus {
			t.Errorf("POST %s status = %d, want %d", tt.path, rec.Code, tt.wantStatus)
		}
	}
}
