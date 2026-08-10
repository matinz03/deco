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
	cfg := &config.Config{Env: "production", AllowedOrigins: "https://deco.app"}
	checkOrigin := makeCheckOrigin(cfg)

	t.Run("Rejects foreign origin in production", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ws", nil)
		req.Header.Set("Origin", "http://evil-attacker.example.com")
		if checkOrigin(req) {
			t.Error("expected foreign origin to be rejected, got allowed")
		}
	})

	t.Run("Rejects unlisted localhost in production", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ws", nil)
		req.Header.Set("Origin", "http://localhost:3000")
		if checkOrigin(req) {
			t.Error("expected unlisted localhost origin to be rejected in production, got allowed")
		}
	})

	t.Run("Allows configured production origin", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/ws", nil)
		req.Header.Set("Origin", "https://deco.app")
		if !checkOrigin(req) {
			t.Error("expected https://deco.app origin to be allowed, got rejected")
		}
	})

	t.Run("Allows localhost in development env", func(t *testing.T) {
		devCfg := &config.Config{Env: "development", AllowedOrigins: ""}
		devCheck := makeCheckOrigin(devCfg)
		req := httptest.NewRequest("GET", "/ws", nil)
		req.Header.Set("Origin", "http://localhost:3000")
		if !devCheck(req) {
			t.Error("expected localhost origin to be allowed in development env")
		}
	})
}
