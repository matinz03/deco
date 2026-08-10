package config

import (
	"os"
	"testing"
)

func TestConfigLoadDefaults(t *testing.T) {
	os.Setenv("API_ENV", "development")
	os.Unsetenv("API_PORT")
	os.Unsetenv("JWT_SECRET")
	defer os.Unsetenv("API_ENV")

	cfg := Load()

	if cfg.Port != "8080" {
		t.Errorf("expected default Port 8080, got %s", cfg.Port)
	}
	if cfg.JWTSecret != "change-me" {
		t.Errorf("expected default JWTSecret change-me, got %s", cfg.JWTSecret)
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("expected default RedisURL redis://localhost:6379, got %s", cfg.RedisURL)
	}
}

func TestConfigLoadOverrides(t *testing.T) {
	os.Setenv("API_ENV", "development")
	os.Setenv("API_PORT", "9999")
	os.Setenv("JWT_SECRET", "custom-secret-key")
	defer func() {
		os.Unsetenv("API_ENV")
		os.Unsetenv("API_PORT")
		os.Unsetenv("JWT_SECRET")
	}()

	cfg := Load()

	if cfg.Port != "9999" {
		t.Errorf("expected overridden Port 9999, got %s", cfg.Port)
	}
	if cfg.JWTSecret != "custom-secret-key" {
		t.Errorf("expected overridden JWTSecret custom-secret-key, got %s", cfg.JWTSecret)
	}
}

func TestConfigLoadPanicsOnInsecureSecretInProduction(t *testing.T) {
	os.Setenv("API_ENV", "production")
	os.Setenv("JWT_SECRET", "change-me")
	defer func() {
		os.Unsetenv("API_ENV")
		os.Unsetenv("JWT_SECRET")
	}()

	defer func() {
		if r := recover(); r == nil {
			t.Errorf("expected Load() to panic in production when JWT_SECRET is change-me")
		}
	}()

	Load()
}
