package middleware

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// Errors surfaced by the JWKS cache. They are deliberately coarse: every one of
// them must end up as a 401 at the edge, never as a 500 and never as a bypass.
var (
	// ErrJWKSUnavailable means the key set could not be (re)fetched and no
	// unexpired cached copy exists. Requests MUST fail closed on this.
	ErrJWKSUnavailable = errors.New("jwks unavailable")

	// ErrUnknownKID means the token's `kid` is absent from the current key
	// set, after at most one rate-limited refresh attempt.
	ErrUnknownKID = errors.New("unknown jwks key id")
)

// maxJWKSBody bounds how much we will read from the JWKS endpoint. The endpoint
// is a remote party; an unbounded body is a memory DoS.
const maxJWKSBody = 1 << 20 // 1 MiB

// jwk is the subset of RFC 7517 we accept: RSA signing keys only.
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwkSet struct {
	Keys []jwk `json:"keys"`
}

// jwksCache fetches and caches an issuer's RSA public keys.
//
// Two separate clocks matter here and they are not the same thing:
//
//   - fetchedAt + ttl decides whether the cached set is still trusted. Past it,
//     the set is considered stale and is NOT used; a failed refresh then fails
//     closed rather than serving keys of unknown currency.
//   - lastAttempt + minRefreshInterval rate-limits refreshes. Without it, a
//     stream of tokens carrying forged `kid` values would drive one outbound
//     fetch per request, i.e. an amplification channel pointed at the issuer.
type jwksCache struct {
	url                string
	client             *http.Client
	ttl                time.Duration
	minRefreshInterval time.Duration
	now                func() time.Time

	mu          sync.Mutex
	keys        map[string]*rsa.PublicKey
	fetchedAt   time.Time
	lastAttempt time.Time
}

func newJWKSCache(url string, ttl, minRefreshInterval, requestTimeout time.Duration) *jwksCache {
	return &jwksCache{
		url:                url,
		client:             &http.Client{Timeout: requestTimeout},
		ttl:                ttl,
		minRefreshInterval: minRefreshInterval,
		now:                time.Now,
	}
}

// keyForKID returns the RSA public key for kid, refreshing the set at most once
// (and no more often than minRefreshInterval) when the kid is unknown or the
// cached set has expired.
func (c *jwksCache) keyForKID(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	fresh := !c.fetchedAt.IsZero() && c.now().Sub(c.fetchedAt) < c.ttl
	if fresh {
		if key, ok := c.keys[kid]; ok {
			return key, nil
		}
	}

	// Either the set is stale or the kid is unknown. Try exactly one refresh,
	// subject to the cooldown.
	refreshErr := c.refreshLocked(ctx)

	if !c.fetchedAt.IsZero() && c.now().Sub(c.fetchedAt) < c.ttl {
		if key, ok := c.keys[kid]; ok {
			return key, nil
		}
		// The set is current and simply does not contain this kid. Do not
		// refresh again — that is the loop this guard exists to prevent.
		return nil, ErrUnknownKID
	}

	if refreshErr != nil {
		return nil, fmt.Errorf("%w: %v", ErrJWKSUnavailable, refreshErr)
	}
	// No usable, unexpired key set. Fail closed.
	return nil, ErrJWKSUnavailable
}

// refreshLocked fetches the key set. Caller must hold c.mu.
func (c *jwksCache) refreshLocked(ctx context.Context) error {
	now := c.now()
	if !c.lastAttempt.IsZero() && now.Sub(c.lastAttempt) < c.minRefreshInterval {
		return errors.New("jwks refresh suppressed by cooldown")
	}
	c.lastAttempt = now

	keys, err := c.fetch(ctx)
	if err != nil {
		return err
	}

	c.keys = keys
	c.fetchedAt = c.now()
	return nil
}

func (c *jwksCache) fetch(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jwks endpoint returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxJWKSBody))
	if err != nil {
		return nil, err
	}

	var set jwkSet
	if err := json.Unmarshal(body, &set); err != nil {
		return nil, fmt.Errorf("jwks decode: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		// The key set is attacker-reachable data (a compromised or spoofed
		// endpoint). Accept only RSA verification keys and ignore the rest,
		// rather than trusting whatever `alg` the document claims.
		if k.Kty != "RSA" || k.Kid == "" {
			continue
		}
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		if k.Alg != "" && k.Alg != "RS256" {
			continue
		}
		pub, err := parseRSAJWK(k)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}

	if len(keys) == 0 {
		return nil, errors.New("jwks contained no usable RSA signing keys")
	}
	return keys, nil
}

func parseRSAJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("jwk modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("jwk exponent: %w", err)
	}
	if len(nBytes) == 0 || len(eBytes) == 0 {
		return nil, errors.New("jwk has empty modulus or exponent")
	}
	// Reject implausibly small moduli outright (< 2048 bits).
	if len(nBytes) < 256 {
		return nil, errors.New("jwk modulus shorter than 2048 bits")
	}
	if len(eBytes) > 8 {
		return nil, errors.New("jwk exponent too large")
	}

	e := new(big.Int).SetBytes(eBytes)
	if !e.IsInt64() || e.Int64() <= 0 || e.Int64() > 1<<31-1 {
		return nil, errors.New("jwk exponent out of range")
	}

	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: int(e.Int64()),
	}, nil
}
