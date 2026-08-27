package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/matinz03/deco/internal/config"
)

// These tests use a locally generated RSA keypair served from an httptest
// server acting as the issuer. There is no Clerk account and no call to any
// real Clerk endpoint; everything except the real-vendor integration is
// exercised here.

const (
	testInternalUUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
	testClerkID      = "user_2abcDEF456"
	testAudience     = "deco-api"
)

// One keypair for the whole package: RSA generation is the slowest thing in
// these tests and the key material is not what varies between them.
var (
	sharedKeyOnce sync.Once
	sharedKey     *rsa.PrivateKey
)

func testRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	sharedKeyOnce.Do(func() {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
		sharedKey = k
	})
	return sharedKey
}

// fakeIssuer serves a JWKS document and counts how many times it was fetched.
// The count is the whole point of the unknown-kid test.
type fakeIssuer struct {
	key     *rsa.PrivateKey
	kid     string
	server  *httptest.Server
	fetches int64
}

func newFakeIssuer(t *testing.T) *fakeIssuer {
	t.Helper()
	fi := &fakeIssuer{key: testRSAKey(t), kid: "test-kid-1"}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/jwks.json", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&fi.fetches, 1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(fi.jwks())
	})
	fi.server = httptest.NewServer(mux)
	t.Cleanup(fi.server.Close)
	return fi
}

func (f *fakeIssuer) jwks() map[string]any {
	pub := f.key.Public().(*rsa.PublicKey)
	return map[string]any{
		"keys": []map[string]string{{
			"kty": "RSA",
			"use": "sig",
			"alg": "RS256",
			"kid": f.kid,
			"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
		}},
	}
}

func (f *fakeIssuer) fetchCount() int64 { return atomic.LoadInt64(&f.fetches) }

func (f *fakeIssuer) jwksURL() string { return f.server.URL + "/.well-known/jwks.json" }

func (f *fakeIssuer) issuer() string { return f.server.URL }

// mint signs a token with the issuer's key. kid overrides the header key id so
// the unknown-kid case can be produced.
func (f *fakeIssuer) mint(t *testing.T, claims jwt.MapClaims, kid string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	s, err := tok.SignedString(f.key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func (f *fakeIssuer) validClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub": testClerkID,
		"iss": f.issuer(),
		"aud": testAudience,
		"iat": now.Add(-time.Minute).Unix(),
		"exp": now.Add(time.Minute).Unix(),
	}
}

func (f *fakeIssuer) clerkConfig() config.ClerkConfig {
	return config.ClerkConfig{
		Enabled:                true,
		Issuer:                 f.issuer(),
		Audience:               testAudience,
		JWKSURL:                f.jwksURL(),
		JWKSCacheTTL:           10 * time.Minute,
		JWKSMinRefreshInterval: time.Minute,
		JWKSRequestTimeout:     2 * time.Second,
		UserMapCacheTTL:        time.Minute,
	}
}

// ─── Fakes for the mapping and the cache ─────────────────────────────────────

type fakeMapper struct {
	mu      sync.Mutex
	byClerk map[string]string
	calls   int
	err     error
}

func newFakeMapper(pairs map[string]string) *fakeMapper {
	m := &fakeMapper{byClerk: map[string]string{}}
	for k, v := range pairs {
		m.byClerk[k] = v
	}
	return m
}

func (m *fakeMapper) InternalUserID(_ context.Context, clerkUserID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.err != nil {
		return "", m.err
	}
	id, ok := m.byClerk[clerkUserID]
	if !ok {
		return "", ErrProfileRequired
	}
	return id, nil
}

func (m *fakeMapper) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

type fakeCache struct {
	mu     sync.Mutex
	values map[string]string
}

func newFakeCache() *fakeCache { return &fakeCache{values: map[string]string{}} }

func (c *fakeCache) GetString(_ context.Context, key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.values[key]
	return v, ok && v != ""
}

func (c *fakeCache) SetString(_ context.Context, key, value string, _ time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if value == "" {
		delete(c.values, key)
		return
	}
	c.values[key] = value
}

// ─── Test scaffolding ────────────────────────────────────────────────────────

// probe records what the protected handler saw, so a test can assert on the
// context value rather than on a status code alone.
type probe struct {
	called bool
	userID string
}

func newAuthenticator(clerk config.ClerkConfig, mapper ClerkUserMapper, cache Cache) *Authenticator {
	return NewAuthenticator(AuthenticatorOptions{
		Clerk:     clerk,
		JWTSecret: "unused-hs256-secret",
		Mapper:    mapper,
		Cache:     cache,
	})
}

func serveWithToken(a *Authenticator, token string) (*httptest.ResponseRecorder, *probe) {
	p := &probe{}
	h := a.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.called = true
		p.userID = GetUserID(r)
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest("GET", "/api/v1/users/me", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec, p
}

// ─── Required tests ──────────────────────────────────────────────────────────

// Intended behaviour: a valid token from the issuer authenticates the request,
// and the context carries the INTERNAL UUID — never the external Clerk id.
// This is the property that lets every handler stay unchanged.
func TestClerkValidTokenPutsInternalUUIDInContext(t *testing.T) {
	fi := newFakeIssuer(t)
	mapper := newFakeMapper(map[string]string{testClerkID: testInternalUUID})
	a := newAuthenticator(fi.clerkConfig(), mapper, newFakeCache())

	rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body %q)", rec.Code, rec.Body.String())
	}
	if !p.called {
		t.Fatal("protected handler was not reached")
	}
	if p.userID != testInternalUUID {
		t.Errorf("expected internal UUID %q in context, got %q", testInternalUUID, p.userID)
	}
	if p.userID == testClerkID {
		t.Error("context carried the Clerk id instead of the internal UUID")
	}
}

// Intended behaviour: the Clerk-ID -> UUID mapping is cached, so neither a
// request burst nor a WebSocket connect storm becomes a database round trip
// each. The second request must not re-query the mapper.
func TestClerkMappingIsCached(t *testing.T) {
	fi := newFakeIssuer(t)
	mapper := newFakeMapper(map[string]string{testClerkID: testInternalUUID})
	a := newAuthenticator(fi.clerkConfig(), mapper, newFakeCache())
	token := fi.mint(t, fi.validClaims(), fi.kid)

	for i := 0; i < 3; i++ {
		if rec, _ := serveWithToken(a, token); rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i, rec.Code)
		}
	}

	if got := mapper.callCount(); got != 1 {
		t.Errorf("expected exactly 1 mapper lookup across 3 requests, got %d", got)
	}
	if got := fi.fetchCount(); got != 1 {
		t.Errorf("expected exactly 1 JWKS fetch across 3 requests, got %d", got)
	}
}

// Intended behaviour: a poisoned cache entry cannot become a user id. The cache
// is a network service; its contents are attacker-reachable data.
func TestClerkRejectsNonUUIDCacheValue(t *testing.T) {
	fi := newFakeIssuer(t)
	mapper := newFakeMapper(map[string]string{testClerkID: testInternalUUID})
	cache := newFakeCache()
	cache.SetString(context.Background(), "deco:clerk_uid:"+testClerkID, "'; DROP TABLE users; --", time.Minute)

	a := newAuthenticator(fi.clerkConfig(), mapper, cache)
	rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected fall-through to the mapper and 200, got %d", rec.Code)
	}
	if p.userID != testInternalUUID {
		t.Errorf("expected the mapper's UUID %q, got %q", testInternalUUID, p.userID)
	}
}

func TestClerkExpiredTokenIsUnauthorized(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	claims := fi.validClaims()
	claims["iat"] = time.Now().Add(-2 * time.Hour).Unix()
	claims["exp"] = time.Now().Add(-time.Hour).Unix()

	rec, p := serveWithToken(a, fi.mint(t, claims, fi.kid))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired token, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on an expired token")
	}
}

func TestClerkWrongIssuerIsUnauthorized(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	claims := fi.validClaims()
	claims["iss"] = "https://evil-issuer.example.com"

	rec, p := serveWithToken(a, fi.mint(t, claims, fi.kid))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for wrong issuer, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on a wrong-issuer token")
	}
}

func TestClerkWrongAudienceIsUnauthorized(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	claims := fi.validClaims()
	claims["aud"] = "some-other-application"

	rec, p := serveWithToken(a, fi.mint(t, claims, fi.kid))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for wrong audience, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on a wrong-audience token")
	}
}

// Intended behaviour: an unsigned token is rejected outright.
func TestClerkAlgNoneIsUnauthorized(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	tok := jwt.NewWithClaims(jwt.SigningMethodNone, fi.validClaims())
	tok.Header["kid"] = fi.kid
	unsigned, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none: %v", err)
	}
	if !strings.Contains(unsigned, ".") {
		t.Fatalf("malformed test token %q", unsigned)
	}

	rec, p := serveWithToken(a, unsigned)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for alg=none, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on an alg=none token")
	}
}

// Intended behaviour: the classic algorithm-confusion attack fails. The token
// is signed HS256 using the issuer's PUBLIC key bytes as the HMAC secret — the
// exact forgery that works against a verifier which picks its algorithm from
// the token header instead of pinning it.
func TestClerkAlgorithmConfusionHS256WithPublicKeyIsUnauthorized(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	pubDER, err := x509.MarshalPKIXPublicKey(fi.key.Public())
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}

	for name, secret := range map[string][]byte{
		"pkix-der": pubDER,
		"modulus":  fi.key.Public().(*rsa.PublicKey).N.Bytes(),
	} {
		t.Run(name, func(t *testing.T) {
			tok := jwt.NewWithClaims(jwt.SigningMethodHS256, fi.validClaims())
			tok.Header["kid"] = fi.kid
			forged, err := tok.SignedString(secret)
			if err != nil {
				t.Fatalf("sign hs256: %v", err)
			}

			rec, p := serveWithToken(a, forged)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("expected 401 for HS256-with-public-key forgery, got %d", rec.Code)
			}
			if p.called {
				t.Error("protected handler ran on a forged HS256 token")
			}
		})
	}
}

// Intended behaviour: an unknown `kid` is rejected after AT MOST one JWKS
// fetch, and repeated unknown-kid tokens do not each cause another fetch.
// Without the cooldown this endpoint becomes an amplification channel aimed at
// the identity provider.
func TestClerkUnknownKIDRefreshesOnceThenFailsClosed(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	for i := 0; i < 5; i++ {
		rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), "kid-that-does-not-exist"))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("request %d: expected 401 for unknown kid, got %d", i, rec.Code)
		}
		if p.called {
			t.Fatalf("request %d: protected handler ran on an unknown-kid token", i)
		}
	}

	if got := fi.fetchCount(); got != 1 {
		t.Errorf("expected exactly 1 JWKS fetch across 5 unknown-kid requests, got %d", got)
	}
}

// Intended behaviour: after the cooldown, a genuinely rotated key is picked up.
// The loop guard must not turn into a permanent outage.
func TestClerkPicksUpRotatedKeyAfterCooldown(t *testing.T) {
	fi := newFakeIssuer(t)
	clerk := fi.clerkConfig()
	clerk.JWKSMinRefreshInterval = time.Millisecond
	a := newAuthenticator(clerk, newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	rec, _ := serveWithToken(a, fi.mint(t, fi.validClaims(), "rotated-kid"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 before rotation, got %d", rec.Code)
	}

	fi.kid = "rotated-kid"
	time.Sleep(5 * time.Millisecond)

	rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), "rotated-kid"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 after rotation, got %d", rec.Code)
	}
	if p.userID != testInternalUUID {
		t.Errorf("expected internal UUID after rotation, got %q", p.userID)
	}
}

// Intended behaviour: if the JWKS endpoint cannot be reached, requests fail
// CLOSED. An identity check that degrades to "allow" under an outage is worse
// than no identity check, because nobody notices.
func TestClerkJWKSUnreachableFailsClosed(t *testing.T) {
	fi := newFakeIssuer(t)
	token := fi.mint(t, fi.validClaims(), fi.kid)
	clerk := fi.clerkConfig()

	// Take the issuer down BEFORE any key was ever fetched.
	fi.server.Close()

	a := newAuthenticator(clerk, newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())
	rec, p := serveWithToken(a, token)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when JWKS is unreachable, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran while JWKS was unreachable — failed OPEN")
	}
}

// Intended behaviour: once the cached key set passes its TTL it is no longer
// trusted, and a failing refresh fails closed rather than serving keys of
// unknown currency.
func TestClerkStaleJWKSFailsClosedAfterTTL(t *testing.T) {
	fi := newFakeIssuer(t)
	clerk := fi.clerkConfig()
	clerk.JWKSCacheTTL = 20 * time.Millisecond
	clerk.JWKSMinRefreshInterval = time.Millisecond

	a := newAuthenticator(clerk, newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	if rec, _ := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid)); rec.Code != http.StatusOK {
		t.Fatalf("expected 200 while the issuer is up, got %d", rec.Code)
	}

	fi.server.Close()
	time.Sleep(40 * time.Millisecond)

	rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 once the cached key set expired, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on an expired key set — failed OPEN")
	}
}

// Intended behaviour: a valid token with no profile row is 409 profile_required
// on a normal endpoint — authenticated, but not yet bootstrapped. It must not
// be a 401 (which would send the client back to sign-in forever) and must not
// be a 200.
func TestClerkNoProfileRowReturns409ProfileRequired(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(nil), newFakeCache())

	rec, p := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid))

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d (body %q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "profile_required") {
		t.Errorf("expected a profile_required error body, got %q", rec.Body.String())
	}
	if p.called {
		t.Error("protected handler ran without a profile row")
	}
}

// Intended behaviour: bootstrap itself stays reachable for exactly that caller,
// and receives the verified external identity — otherwise the 409 above would
// be an unescapable deadlock.
func TestClerkBootstrapRouteReachableWithoutProfileRow(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(nil), newFakeCache())

	var sawSubject string
	var sawUserID string
	h := a.RequireVerifiedToken()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawSubject = GetClerkSubject(r)
		sawUserID = GetUserID(r)
		w.WriteHeader(http.StatusCreated)
	}))

	req := httptest.NewRequest("POST", "/api/v1/profile/bootstrap", nil)
	req.Header.Set("Authorization", "Bearer "+fi.mint(t, fi.validClaims(), fi.kid))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected bootstrap to be reachable, got %d", rec.Code)
	}
	if sawSubject != testClerkID {
		t.Errorf("expected the verified Clerk subject %q, got %q", testClerkID, sawSubject)
	}
	if sawUserID != "" {
		t.Errorf("bootstrap must not receive a user id when no profile exists, got %q", sawUserID)
	}
}

// Intended behaviour: bootstrap is not a hole. An expired token is still 401
// there.
func TestClerkBootstrapRouteRejectsExpiredToken(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(nil), newFakeCache())

	claims := fi.validClaims()
	claims["iat"] = time.Now().Add(-2 * time.Hour).Unix()
	claims["exp"] = time.Now().Add(-time.Hour).Unix()

	called := false
	h := a.RequireVerifiedToken()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))
	req := httptest.NewRequest("POST", "/api/v1/profile/bootstrap", nil)
	req.Header.Set("Authorization", "Bearer "+fi.mint(t, claims, fi.kid))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if called {
		t.Error("bootstrap ran on an expired token")
	}
}

// Intended behaviour: a database failure in the mapping must not be reported as
// "no profile". A 409 would invite the client to re-bootstrap during an outage.
func TestClerkMapperFailureIsUnauthorizedNotProfileRequired(t *testing.T) {
	fi := newFakeIssuer(t)
	mapper := newFakeMapper(map[string]string{testClerkID: testInternalUUID})
	mapper.err = ErrUnauthorized
	a := newAuthenticator(fi.clerkConfig(), mapper, newFakeCache())

	rec, _ := serveWithToken(a, fi.mint(t, fi.validClaims(), fi.kid))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 on mapper failure, got %d", rec.Code)
	}
}

// Intended behaviour: turning the managed path on must not silently accept the
// old locally-signed HS256 tokens. The two paths never share a key.
func TestClerkModeRejectsLegacyHS256Token(t *testing.T) {
	fi := newFakeIssuer(t)
	a := newAuthenticator(fi.clerkConfig(), newFakeMapper(map[string]string{testClerkID: testInternalUUID}), newFakeCache())

	legacy := createTestToken(testInternalUUID, "unused-hs256-secret", false)
	rec, p := serveWithToken(a, legacy)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for a legacy HS256 token in Clerk mode, got %d", rec.Code)
	}
	if p.called {
		t.Error("protected handler ran on a legacy HS256 token in Clerk mode")
	}
}

// ─── Dual path: the legacy path must keep working, unchanged and by default ──

// Intended behaviour: with the managed path disabled (the default), the
// authenticator behaves exactly like the existing HS256 middleware — no JWKS,
// no mapping, no profile gate. There is no cutover yet.
func TestLegacyPathIsTheDefaultAndStillWorks(t *testing.T) {
	a := NewAuthenticator(AuthenticatorOptions{JWTSecret: "super-secret-key-123"})

	if a.ClerkEnabled() {
		t.Fatal("managed identity path must be off by default")
	}

	rec, p := serveWithToken(a, createTestToken(testInternalUUID, "super-secret-key-123", false))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on the legacy path, got %d", rec.Code)
	}
	if p.userID != testInternalUUID {
		t.Errorf("expected %q in context, got %q", testInternalUUID, p.userID)
	}

	rec, _ = serveWithToken(a, createTestToken(testInternalUUID, "wrong-secret", false))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for a wrong-secret token on the legacy path, got %d", rec.Code)
	}

	rec, _ = serveWithToken(a, createTestToken(testInternalUUID, "super-secret-key-123", true))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for an expired token on the legacy path, got %d", rec.Code)
	}
}

// ─── Unit-level guards ───────────────────────────────────────────────────────

func TestIsUUIDRejectsNonUUIDValues(t *testing.T) {
	valid := []string{testInternalUUID, "00000000-0000-0000-0000-000000000000"}
	invalid := []string{
		"", "user_2abcDEF456", testInternalUUID + "x", strings.ReplaceAll(testInternalUUID, "-", ""),
		"6ba7b810_9dad_11d1_80b4_00c04fd430c8", "6ba7b810-9dad-11d1-80b4-00c04fd430cg",
	}
	for _, v := range valid {
		if !isUUID(v) {
			t.Errorf("expected %q to be accepted as a UUID", v)
		}
	}
	for _, v := range invalid {
		if isUUID(v) {
			t.Errorf("expected %q to be rejected as a UUID", v)
		}
	}
}

func TestValidSubjectRejectsHostileValues(t *testing.T) {
	if validSubject("") {
		t.Error("empty subject must be rejected")
	}
	if validSubject(strings.Repeat("a", maxSubjectLen+1)) {
		t.Error("oversized subject must be rejected")
	}
	if validSubject("user_\x00injected") {
		t.Error("control characters must be rejected")
	}
	if !validSubject(testClerkID) {
		t.Errorf("expected %q to be a valid subject", testClerkID)
	}
}

// Intended behaviour: a JWKS document is remote, attacker-reachable data.
// Undersized moduli and non-signing keys must be discarded rather than trusted.
func TestParseRSAJWKRejectsWeakOrMalformedKeys(t *testing.T) {
	small := big.NewInt(65537)
	if _, err := parseRSAJWK(jwk{
		Kty: "RSA", Kid: "k",
		N: base64.RawURLEncoding.EncodeToString(small.Bytes()),
		E: base64.RawURLEncoding.EncodeToString(big.NewInt(65537).Bytes()),
	}); err == nil {
		t.Error("expected a short modulus to be rejected")
	}

	if _, err := parseRSAJWK(jwk{Kty: "RSA", Kid: "k", N: "!!not-base64!!", E: "AQAB"}); err == nil {
		t.Error("expected a non-base64 modulus to be rejected")
	}
}
