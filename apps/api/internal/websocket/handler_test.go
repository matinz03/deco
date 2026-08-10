package websocket

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/matinz03/deco/internal/config"
	"go.uber.org/zap"
)

func TestHandlerUnauthorized(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cfg := &config.Config{JWTSecret: "test-secret"}
	handler := Handler(nil, nil, cfg, logger)

	t.Run("Missing Token Returns 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ws", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", rec.Code)
		}
	})

	t.Run("Invalid Token Query Param Returns 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ws?token=invalid.jwt.token", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", rec.Code)
		}
	})
}

func TestUpgraderCheckOrigin(t *testing.T) {
	req := httptest.NewRequest("GET", "/ws", nil)
	req.Header.Set("Origin", "http://evil-attacker.example.com")

	// Document current behavior (upgrader accepts all origins)
	isAllowed := upgrader.CheckOrigin(req)
	if !isAllowed {
		t.Error("expected current upgrader to allow origin, got false")
	}
}
