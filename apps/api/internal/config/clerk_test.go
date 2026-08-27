package config

import (
	"os"
	"testing"
	"time"
)

func clearClerkEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"CLERK_ENABLED", "CLERK_ISSUER", "CLERK_AUDIENCE", "CLERK_JWKS_URL",
		"CLERK_JWKS_CACHE_TTL", "CLERK_JWKS_MIN_REFRESH_INTERVAL",
		"CLERK_JWKS_REQUEST_TIMEOUT", "CLERK_USER_MAP_CACHE_TTL",
	} {
		os.Unsetenv(k)
	}
	t.Cleanup(func() {
		for _, k := range []string{
			"CLERK_ENABLED", "CLERK_ISSUER", "CLERK_AUDIENCE", "CLERK_JWKS_URL",
			"CLERK_JWKS_CACHE_TTL", "CLERK_JWKS_MIN_REFRESH_INTERVAL",
			"CLERK_JWKS_REQUEST_TIMEOUT", "CLERK_USER_MAP_CACHE_TTL",
		} {
			os.Unsetenv(k)
		}
	})
}

// Intended behaviour: the managed identity path is OFF unless explicitly turned
// on. An existing deployment that pulls this change must keep running on the
// HS256 path with no config edits at all.
func TestClerkDisabledByDefault(t *testing.T) {
	clearClerkEnv(t)

	cfg := LoadClerk()

	if cfg.Enabled {
		t.Error("expected the managed identity path to be disabled by default")
	}
	if cfg.JWKSCacheTTL != 10*time.Minute {
		t.Errorf("expected a 10m default JWKS TTL, got %s", cfg.JWKSCacheTTL)
	}
	if cfg.JWKSMinRefreshInterval != time.Minute {
		t.Errorf("expected a 1m default refresh cooldown, got %s", cfg.JWKSMinRefreshInterval)
	}
}

// Intended behaviour: the JWKS URL is derived from the issuer so it cannot
// silently point somewhere else.
func TestClerkDerivesJWKSURLFromIssuer(t *testing.T) {
	clearClerkEnv(t)
	os.Setenv("CLERK_ENABLED", "true")
	os.Setenv("CLERK_ISSUER", "https://example.clerk.accounts.dev/")

	cfg := LoadClerk()

	if cfg.Issuer != "https://example.clerk.accounts.dev" {
		t.Errorf("expected the trailing slash to be trimmed, got %q", cfg.Issuer)
	}
	if want := "https://example.clerk.accounts.dev/.well-known/jwks.json"; cfg.JWKSURL != want {
		t.Errorf("expected %q, got %q", want, cfg.JWKSURL)
	}
}

// Intended behaviour: a half-configured managed path fails at BOOT, not on the
// first authenticated request. A misconfiguration that only surfaces under
// traffic is a misconfiguration nobody catches in staging.
func TestClerkEnabledWithoutIssuerPanicsAtLoad(t *testing.T) {
	clearClerkEnv(t)
	os.Setenv("CLERK_ENABLED", "true")

	defer func() {
		if recover() == nil {
			t.Error("expected LoadClerk to panic when enabled without an issuer")
		}
	}()

	LoadClerk()
}

func TestClerkRejectsNonAbsoluteJWKSURL(t *testing.T) {
	clearClerkEnv(t)
	os.Setenv("CLERK_ENABLED", "true")
	os.Setenv("CLERK_ISSUER", "https://example.clerk.accounts.dev")
	os.Setenv("CLERK_JWKS_URL", "/.well-known/jwks.json")

	defer func() {
		if recover() == nil {
			t.Error("expected LoadClerk to panic on a relative JWKS URL")
		}
	}()

	LoadClerk()
}

func TestClerkRejectsMalformedDurations(t *testing.T) {
	clearClerkEnv(t)
	os.Setenv("CLERK_JWKS_CACHE_TTL", "ten-minutes")

	defer func() {
		if recover() == nil {
			t.Error("expected LoadClerk to panic on an unparseable duration")
		}
	}()

	LoadClerk()
}
