package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// ClerkConfig holds the settings for the RS256/JWKS authentication path.
//
// The path is OFF by default: with CLERK_ENABLED unset the API keeps using the
// existing HS256 tokens minted by handlers/auth.go. Enabling Clerk is an
// explicit cutover: legacy password routes are no longer mounted.
type ClerkConfig struct {
	// Enabled selects the RS256/JWKS verification path instead of HS256.
	Enabled bool

	// OwnerUserID is the exact verified Clerk subject that receives the
	// persisted platform owner role. It is required whenever Clerk is enabled.
	OwnerUserID string

	// Issuer is the exact `iss` claim value that tokens must carry.
	Issuer string

	// Audience, when non-empty, is required to appear in the `aud` claim.
	Audience string

	// JWKSURL is the endpoint serving the issuer's public keys. Defaults to
	// Issuer + "/.well-known/jwks.json" when not set explicitly.
	JWKSURL string

	// JWKSCacheTTL is how long a fetched key set is trusted before it must be
	// refreshed. Refresh failure past the TTL fails closed (401), never open.
	JWKSCacheTTL time.Duration

	// JWKSMinRefreshInterval rate-limits refreshes triggered by an unknown
	// `kid`, so a stream of forged key ids cannot turn into a fetch loop
	// against the issuer.
	JWKSMinRefreshInterval time.Duration

	// JWKSRequestTimeout bounds a single JWKS HTTP fetch.
	JWKSRequestTimeout time.Duration

	// UserMapCacheTTL is how long a verified Clerk-ID -> internal-UUID mapping
	// is cached in Redis. Short, because it is an authorization decision.
	UserMapCacheTTL time.Duration
}

// LoadClerk reads the Clerk settings from the environment.
//
// It panics when the path is enabled but misconfigured: a missing issuer or
// JWKS URL must fail at boot, not on the first authenticated request.
func LoadClerk() ClerkConfig {
	cfg := ClerkConfig{
		Enabled:                getEnvBool("CLERK_ENABLED", false),
		OwnerUserID:            strings.TrimSpace(getEnv("CLERK_OWNER_USER_ID", "")),
		Issuer:                 strings.TrimRight(strings.TrimSpace(getEnv("CLERK_ISSUER", "")), "/"),
		Audience:               strings.TrimSpace(getEnv("CLERK_AUDIENCE", "")),
		JWKSURL:                strings.TrimSpace(getEnv("CLERK_JWKS_URL", "")),
		JWKSCacheTTL:           getEnvDuration("CLERK_JWKS_CACHE_TTL", 10*time.Minute),
		JWKSMinRefreshInterval: getEnvDuration("CLERK_JWKS_MIN_REFRESH_INTERVAL", 1*time.Minute),
		JWKSRequestTimeout:     getEnvDuration("CLERK_JWKS_REQUEST_TIMEOUT", 5*time.Second),
		UserMapCacheTTL:        getEnvDuration("CLERK_USER_MAP_CACHE_TTL", 5*time.Minute),
	}

	if !cfg.Enabled {
		return cfg
	}

	if cfg.Issuer == "" {
		panic("CLERK_ISSUER must be set when CLERK_ENABLED is true")
	}
	if cfg.OwnerUserID == "" {
		panic("CLERK_OWNER_USER_ID must be set when CLERK_ENABLED is true")
	}
	if cfg.JWKSURL == "" {
		cfg.JWKSURL = cfg.Issuer + "/.well-known/jwks.json"
	}
	if !strings.HasPrefix(cfg.JWKSURL, "https://") && !strings.HasPrefix(cfg.JWKSURL, "http://") {
		panic(fmt.Sprintf("CLERK_JWKS_URL must be an absolute http(s) URL, got %q", cfg.JWKSURL))
	}

	return cfg
}

func getEnvBool(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		panic(fmt.Sprintf("%s must be a boolean, got %q", key, raw))
	}
	return v
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := time.ParseDuration(raw)
	if err != nil {
		panic(fmt.Sprintf("%s must be a Go duration (e.g. 10m), got %q", key, raw))
	}
	if v <= 0 {
		panic(fmt.Sprintf("%s must be positive, got %q", key, raw))
	}
	return v
}
