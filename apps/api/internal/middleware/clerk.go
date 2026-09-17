package middleware

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/matinz03/deco/internal/config"
)

// ClerkSubjectKey carries the verified external identity (the `sub` claim of a
// Clerk token). It exists ONLY so the bootstrap endpoint can create the profile
// row for a caller that does not have one yet. No other handler should read it:
// every other handler reads GetUserID, which is and stays the internal UUID.
const ClerkSubjectKey contextKey = "clerkSubject"

var (
	// ErrUnauthorized covers every token-level failure. It is intentionally
	// undifferentiated at the edge so the response cannot be used as an
	// oracle for why a token was rejected.
	ErrUnauthorized = errors.New("unauthorized")

	// ErrProfileRequired means the token verified but no `users` row is
	// mapped to that external identity yet. This is a 409, not a 401: the
	// caller is authenticated, they simply have not bootstrapped a profile.
	ErrProfileRequired = errors.New("profile_required")
)

// maxSubjectLen bounds the `sub` claim. It is attacker-controlled input that
// ends up in a cache key and a SQL parameter; unbounded is not acceptable.
const maxSubjectLen = 255

// ClerkUserMapper resolves a verified external identity to the internal user
// UUID. Implementations must return ErrProfileRequired (not a nil id and nil
// error) when no profile row exists.
type ClerkUserMapper interface {
	InternalUserID(ctx context.Context, clerkUserID string) (string, error)
}

// Cache is the small slice of Redis this package needs. Failures are always
// treated as a miss: the cache is an optimisation and must never be able to
// grant access on its own.
type Cache interface {
	GetString(ctx context.Context, key string) (string, bool)
	SetString(ctx context.Context, key, value string, ttl time.Duration)
}

// AuthenticatorOptions configures NewAuthenticator.
type AuthenticatorOptions struct {
	// Clerk selects and configures the RS256/JWKS path. When Clerk.Enabled
	// is false the authenticator behaves exactly like the legacy HS256 path.
	Clerk config.ClerkConfig

	// JWTSecret is the HS256 secret for the legacy path. It is never used
	// when Clerk.Enabled is true — the two paths never share a key.
	JWTSecret string

	// Mapper and Cache are only consulted on the Clerk path.
	Mapper ClerkUserMapper
	Cache  Cache
}

// Authenticator verifies bearer tokens and resolves them to an internal user
// UUID. One instance is shared by the HTTP middleware and the WebSocket
// `?token=` path, so both stay in lockstep.
type Authenticator struct {
	clerkEnabled bool
	jwtSecret    string
	issuer       string
	audience     string
	mapTTL       time.Duration

	jwks   *jwksCache
	mapper ClerkUserMapper
	cache  Cache
}

// NewAuthenticator builds an Authenticator. With opts.Clerk.Enabled false the
// result is the pre-existing HS256 behaviour, which is the default so that an
// unconfigured deployment keeps working unchanged.
func NewAuthenticator(opts AuthenticatorOptions) *Authenticator {
	a := &Authenticator{
		clerkEnabled: opts.Clerk.Enabled,
		jwtSecret:    opts.JWTSecret,
		issuer:       opts.Clerk.Issuer,
		audience:     opts.Clerk.Audience,
		mapTTL:       opts.Clerk.UserMapCacheTTL,
		mapper:       opts.Mapper,
		cache:        opts.Cache,
	}
	if a.clerkEnabled {
		a.jwks = newJWKSCache(
			opts.Clerk.JWKSURL,
			opts.Clerk.JWKSCacheTTL,
			opts.Clerk.JWKSMinRefreshInterval,
			opts.Clerk.JWKSRequestTimeout,
		)
	}
	if a.mapTTL <= 0 {
		a.mapTTL = 5 * time.Minute
	}
	return a
}

// ClerkEnabled reports whether the RS256/JWKS path is active.
func (a *Authenticator) ClerkEnabled() bool { return a.clerkEnabled }

// VerifySubject verifies the token's signature and claims and returns its
// subject. On the Clerk path that subject is an external Clerk id; on the
// legacy path it is already the internal UUID. It performs no profile lookup,
// so it is what the bootstrap endpoint uses.
func (a *Authenticator) VerifySubject(ctx context.Context, tokenStr string) (string, error) {
	if !a.clerkEnabled {
		sub, err := parseToken(tokenStr, a.jwtSecret)
		if err != nil {
			return "", ErrUnauthorized
		}
		return sub, nil
	}
	return a.verifyClerkToken(ctx, tokenStr)
}

// Authenticate verifies the token and resolves it to the INTERNAL user UUID.
// It returns ErrProfileRequired when the token is good but no profile row is
// mapped to it.
func (a *Authenticator) Authenticate(ctx context.Context, tokenStr string) (string, error) {
	subject, err := a.VerifySubject(ctx, tokenStr)
	if err != nil {
		return "", err
	}
	if !a.clerkEnabled {
		return subject, nil
	}
	return a.resolveInternalUserID(ctx, subject)
}

// ValidateToken is the shared entry point for the WebSocket `?token=` path.
// It returns the internal UUID, exactly like the HTTP middleware puts into the
// request context.
func (a *Authenticator) ValidateToken(ctx context.Context, tokenStr string) (string, error) {
	return a.Authenticate(ctx, tokenStr)
}

func (a *Authenticator) verifyClerkToken(ctx context.Context, tokenStr string) (string, error) {
	opts := []jwt.ParserOption{
		// The single most important line in this file. Pinning the accepted
		// algorithms is what defeats both `alg: none` and the HS256
		// algorithm-confusion attack, where a token is signed with the JWKS
		// public key used as an HMAC secret.
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	}
	if a.issuer != "" {
		opts = append(opts, jwt.WithIssuer(a.issuer))
	}
	if a.audience != "" {
		opts = append(opts, jwt.WithAudience(a.audience))
	}

	parser := jwt.NewParser(opts...)

	var jwksErr error
	token, err := parser.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		// Belt and braces: WithValidMethods already rejects non-RSA, but the
		// key type returned here must never be usable as an HMAC secret.
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		kid, _ := t.Header["kid"].(string)
		if kid == "" || len(kid) > maxSubjectLen {
			return nil, errors.New("missing or oversized kid")
		}
		key, kerr := a.jwks.keyForKID(ctx, kid)
		if kerr != nil {
			jwksErr = kerr
			return nil, kerr
		}
		return key, nil
	})
	if err != nil || !token.Valid {
		if jwksErr != nil {
			// Still a 401 at the edge; the distinction is only for logs.
			return "", fmt.Errorf("%w: %v", ErrUnauthorized, jwksErr)
		}
		return "", ErrUnauthorized
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", ErrUnauthorized
	}
	subject, _ := claims["sub"].(string)
	if !validSubject(subject) {
		return "", ErrUnauthorized
	}
	return subject, nil
}

// resolveInternalUserID maps a verified Clerk id to the internal UUID, using
// Redis as a read-through cache so neither a request nor a WebSocket connect
// costs a database round trip.
func (a *Authenticator) resolveInternalUserID(ctx context.Context, clerkUserID string) (string, error) {
	cacheKey := "deco:clerk_uid:" + clerkUserID

	if a.cache != nil {
		if cached, ok := a.cache.GetString(ctx, cacheKey); ok {
			// The cache is a network service holding an authorization
			// decision. Validate its shape before trusting it; a poisoned
			// value must not become a user id.
			if isUUID(cached) {
				return cached, nil
			}
		}
	}

	if a.mapper == nil {
		return "", ErrProfileRequired
	}

	userID, err := a.mapper.InternalUserID(ctx, clerkUserID)
	if err != nil {
		return "", err
	}
	if !isUUID(userID) {
		return "", ErrUnauthorized
	}

	if a.cache != nil {
		a.cache.SetString(ctx, cacheKey, userID, a.mapTTL)
	}
	return userID, nil
}

// InvalidateUserMapping drops a cached Clerk-ID -> UUID entry. Called after a
// profile is created so the very next request does not wait out a negative
// window, and available for use after a profile is deleted.
func (a *Authenticator) InvalidateUserMapping(ctx context.Context, clerkUserID string) {
	if a.cache == nil {
		return
	}
	a.cache.SetString(ctx, "deco:clerk_uid:"+clerkUserID, "", time.Nanosecond)
}

// Middleware authenticates the request and puts the INTERNAL user UUID into the
// context under UserIDKey — the same key and the same value type the handlers
// already read via GetUserID. Handlers therefore need no changes.
func (a *Authenticator) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, ok := bearerToken(r)
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			userID, err := a.Authenticate(r.Context(), tokenStr)
			if err != nil {
				if errors.Is(err, ErrProfileRequired) {
					writeAuthError(w, http.StatusConflict, "profile_required")
					return
				}
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireVerifiedToken authenticates the request WITHOUT requiring a profile
// row. It is mounted on exactly one route — POST /profile/bootstrap — which is
// the route whose whole job is to create that row.
func (a *Authenticator) RequireVerifiedToken() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, ok := bearerToken(r)
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			subject, err := a.VerifySubject(r.Context(), tokenStr)
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, "unauthorized")
				return
			}

			ctx := context.WithValue(r.Context(), ClerkSubjectKey, subject)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetClerkSubject returns the verified external identity, if the route was
// mounted behind RequireVerifiedToken.
func GetClerkSubject(r *http.Request) string {
	s, _ := r.Context().Value(ClerkSubjectKey).(string)
	return s
}

func bearerToken(r *http.Request) (string, bool) {
	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if token == "" {
		return "", false
	}
	return token, true
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	fmt.Fprintf(w, `{"error":%q}`, message)
}

// validSubject rejects empty, oversized, and structurally suspicious subjects
// before they reach a cache key or a SQL parameter.
func validSubject(sub string) bool {
	if sub == "" || len(sub) > maxSubjectLen {
		return false
	}
	for _, r := range sub {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// isUUID checks the canonical 8-4-4-4-12 hex form. Used to validate values that
// come back from Redis or the database before they are treated as a user id.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			isHex := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
			if !isHex {
				return false
			}
		}
	}
	return true
}
