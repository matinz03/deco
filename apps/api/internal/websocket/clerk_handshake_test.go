package websocket

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/matinz03/deco/internal/config"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"go.uber.org/zap"
)

// The WebSocket handshake shares ValidateToken with the REST path. These tests
// exist to catch the failure mode where the REST middleware is migrated and the
// `?token=` path silently keeps its own, older rules.
//
// Scope note: the handshake cannot be driven to a real upgrade here, because a
// successful upgrade needs a live Hub and a live *pgxpool.Pool. What is asserted
// is the authentication decision — the part this change touches.

const (
	wsInternalUUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"
	wsClerkID      = "user_wsTESTsubject"
	wsAudience     = "deco-api"
)

type wsFakeIssuer struct {
	key    *rsa.PrivateKey
	kid    string
	server *httptest.Server
}

func newWSFakeIssuer(t *testing.T) *wsFakeIssuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	fi := &wsFakeIssuer{key: key, kid: "ws-test-kid"}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		pub := fi.key.Public().(*rsa.PublicKey)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kty": "RSA", "use": "sig", "alg": "RS256", "kid": fi.kid,
				"n": base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
			}},
		})
	})
	fi.server = httptest.NewServer(mux)
	t.Cleanup(fi.server.Close)
	return fi
}

func (f *wsFakeIssuer) mint(t *testing.T, expired bool) string {
	t.Helper()
	now := time.Now()
	exp := now.Add(time.Minute)
	iat := now.Add(-time.Minute)
	if expired {
		iat = now.Add(-2 * time.Hour)
		exp = now.Add(-time.Hour)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": wsClerkID,
		"iss": f.server.URL,
		"aud": wsAudience,
		"iat": iat.Unix(),
		"exp": exp.Unix(),
	})
	tok.Header["kid"] = f.kid
	s, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func (f *wsFakeIssuer) authenticator() *appmiddleware.Authenticator {
	return appmiddleware.NewAuthenticator(appmiddleware.AuthenticatorOptions{
		Clerk: config.ClerkConfig{
			Enabled:                true,
			Issuer:                 f.server.URL,
			Audience:               wsAudience,
			JWKSURL:                f.server.URL + "/.well-known/jwks.json",
			JWKSCacheTTL:           10 * time.Minute,
			JWKSMinRefreshInterval: time.Minute,
			JWKSRequestTimeout:     2 * time.Second,
			UserMapCacheTTL:        time.Minute,
		},
		JWTSecret: "unused-hs256-secret",
		Mapper:    wsStubMapper{},
	})
}

// wsStubMapper maps the one test identity to the one internal UUID.
type wsStubMapper struct{}

func (wsStubMapper) InternalUserID(_ context.Context, clerkUserID string) (string, error) {
	if clerkUserID == wsClerkID {
		return wsInternalUUID, nil
	}
	return "", appmiddleware.ErrProfileRequired
}

func wsRequest(t *testing.T, h http.HandlerFunc, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/ws?token="+token, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// Intended behaviour: a valid managed-identity token passes the handshake's
// authentication step. It must not be rejected as unauthorized.
func TestHandshakeAcceptsValidClerkToken(t *testing.T) {
	fi := newWSFakeIssuer(t)
	logger, _ := zap.NewDevelopment()
	cfg := &config.Config{JWTSecret: "unused-hs256-secret"}

	h := Handler(nil, nil, cfg, logger, fi.authenticator())
	rec := wsRequest(t, h, fi.mint(t, false))

	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("expected the handshake to authenticate, got 401 (body %q)", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "unauthorized") {
		t.Errorf("expected no unauthorized body, got %q", rec.Body.String())
	}
}

// Intended behaviour: an expired token is rejected at the handshake with 401,
// exactly as on the REST path.
func TestHandshakeRejectsExpiredClerkToken(t *testing.T) {
	fi := newWSFakeIssuer(t)
	logger, _ := zap.NewDevelopment()
	cfg := &config.Config{JWTSecret: "unused-hs256-secret"}

	h := Handler(nil, nil, cfg, logger, fi.authenticator())
	rec := wsRequest(t, h, fi.mint(t, true))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for an expired token, got %d", rec.Code)
	}
}

// Intended behaviour: a verified token with no profile row does not open a
// socket. The connection identity is the internal UUID, and there isn't one.
func TestHandshakeRejectsTokenWithoutProfileRow(t *testing.T) {
	fi := newWSFakeIssuer(t)
	logger, _ := zap.NewDevelopment()
	cfg := &config.Config{JWTSecret: "unused-hs256-secret"}

	a := appmiddleware.NewAuthenticator(appmiddleware.AuthenticatorOptions{
		Clerk: config.ClerkConfig{
			Enabled:                true,
			Issuer:                 fi.server.URL,
			Audience:               wsAudience,
			JWKSURL:                fi.server.URL + "/.well-known/jwks.json",
			JWKSCacheTTL:           10 * time.Minute,
			JWKSMinRefreshInterval: time.Minute,
			JWKSRequestTimeout:     2 * time.Second,
			UserMapCacheTTL:        time.Minute,
		},
		JWTSecret: "unused-hs256-secret",
		// No mapper: nothing can resolve to an internal UUID.
	})

	h := Handler(nil, nil, cfg, logger, a)
	rec := wsRequest(t, h, fi.mint(t, false))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when no profile row exists, got %d", rec.Code)
	}
}

// Intended behaviour: with no authenticator supplied the handshake keeps its
// existing HS256 behaviour. The legacy path is still the default.
func TestHandshakeLegacyPathUnchanged(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	cfg := &config.Config{JWTSecret: "legacy-secret-value"}
	h := Handler(nil, nil, cfg, logger)

	legacy := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": wsInternalUUID,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	token, err := legacy.SignedString([]byte("legacy-secret-value"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	if rec := wsRequest(t, h, token); rec.Code == http.StatusUnauthorized {
		t.Errorf("expected the legacy HS256 handshake to still authenticate, got 401")
	}

	expired := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": wsInternalUUID,
		"exp": time.Now().Add(-time.Hour).Unix(),
	})
	expiredToken, err := expired.SignedString([]byte("legacy-secret-value"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if rec := wsRequest(t, h, expiredToken); rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for an expired legacy token, got %d", rec.Code)
	}
}
