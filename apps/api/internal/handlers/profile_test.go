package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
)

// These tests drive the bootstrap handler against an in-memory profileStore
// that mirrors the transaction the Postgres implementation performs. They
// exercise the CONTRACT — idempotency, key immutability, and "no audit row on
// rejection". They do not exercise the SQL: that needs a live Postgres and is
// listed as not covered.

const (
	bootstrapClerkID = "user_bootstrapSUBJECT"
	bootstrapUUID    = "1b4e28ba-2fa1-11d2-883f-0016d3cca427"
	keyAlice         = "cHVibGljLWtleS1hbGljZQ=="
	keyMallory       = "cHVibGljLWtleS1tYWxsb3J5"
)

// auditEntry mirrors a row of user_public_key_audit.
type auditEntry struct {
	UserID      string
	ClerkUserID string
	PublicKey   string
	Source      string
}

// memProfileStore implements profileStore with the same ordering guarantees the
// Postgres store must provide: the users row and its audit row are written
// together, or neither is written.
type memProfileStore struct {
	usersByClerkID map[string]*models.User
	audit          []auditEntry
	failWith       error
	calls          int
}

func newMemProfileStore() *memProfileStore {
	return &memProfileStore{usersByClerkID: map[string]*models.User{}}
}

func (s *memProfileStore) BootstrapProfile(_ context.Context, in BootstrapInput) (BootstrapOutcome, error) {
	s.calls++
	if s.failWith != nil {
		return BootstrapOutcome{}, s.failWith
	}

	if existing, ok := s.usersByClerkID[in.ClerkUserID]; ok {
		if existing.PublicKey != in.PublicKey {
			// Reject before writing anything at all — the audit table
			// included. This is the transaction rolling back.
			return BootstrapOutcome{}, ErrPublicKeyMismatch
		}
		return BootstrapOutcome{User: *existing, Created: false}, nil
	}

	user := &models.User{
		ID:                bootstrapUUID,
		Username:          in.Username,
		DisplayName:       in.DisplayName,
		Email:             in.Email,
		PublicKey:         in.PublicKey,
		IsAdmin:           in.IsOwner,
		IsOwner:           in.IsOwner,
		RestrictedActions: []string{},
		LastSeenAt:        time.Now(),
		CreatedAt:         time.Now(),
	}
	s.usersByClerkID[in.ClerkUserID] = user
	s.audit = append(s.audit, auditEntry{
		UserID:      user.ID,
		ClerkUserID: in.ClerkUserID,
		PublicKey:   in.PublicKey,
		Source:      "profile_bootstrap",
	})
	return BootstrapOutcome{User: *user, Created: true}, nil
}

func newTestProfileHandler(store profileStore) *ProfileHandler {
	return &ProfileHandler{
		store: store,
		cfg: &config.Config{Clerk: config.ClerkConfig{
			Enabled:     true,
			OwnerUserID: bootstrapClerkID,
		}},
	}
}

// postBootstrap issues a bootstrap request with the given verified subject
// already placed in the context, i.e. downstream of RequireVerifiedToken.
func postBootstrap(h *ProfileHandler, subject string, body map[string]string) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/api/v1/profile/bootstrap", strings.NewReader(string(raw)))
	if subject != "" {
		req = req.WithContext(context.WithValue(req.Context(), middleware.ClerkSubjectKey, subject))
	}
	rec := httptest.NewRecorder()
	h.Bootstrap(rec, req)
	return rec
}

func decodeUser(t *testing.T, rec *httptest.ResponseRecorder) models.User {
	t.Helper()
	var payload struct {
		User models.User `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response %q: %v", rec.Body.String(), err)
	}
	return payload.User
}

// Intended behaviour: the first call creates the profile and exactly one audit
// row, and the identity comes from the verified token — never from the body.
func TestBootstrapCreatesProfileAndAuditRow(t *testing.T) {
	store := newMemProfileStore()
	h := newTestProfileHandler(store)

	rec := postBootstrap(h, bootstrapClerkID, map[string]string{
		"public_key":   keyAlice,
		"username":     "alice",
		"display_name": "Alice",
	})

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d (body %q)", rec.Code, rec.Body.String())
	}
	user := decodeUser(t, rec)
	if user.ID != bootstrapUUID {
		t.Errorf("expected internal UUID %q, got %q", bootstrapUUID, user.ID)
	}
	if user.PublicKey != keyAlice {
		t.Errorf("expected the submitted public key, got %q", user.PublicKey)
	}
	if len(store.audit) != 1 {
		t.Fatalf("expected exactly 1 audit row, got %d", len(store.audit))
	}
	if store.audit[0].PublicKey != keyAlice || store.audit[0].ClerkUserID != bootstrapClerkID {
		t.Errorf("audit row does not match the write: %+v", store.audit[0])
	}
}

// Intended behaviour: only the explicitly configured Clerk subject becomes
// platform owner/admin. Signup order grants no privilege.
func TestBootstrapOnlyConfiguredSubjectBecomesAdminAndOwner(t *testing.T) {
	store := newMemProfileStore()
	h := newTestProfileHandler(store)

	rec := postBootstrap(h, "user_first_non_owner", map[string]string{
		"public_key": keyAlice,
		"username":   "alice",
	})
	first := decodeUser(t, rec)
	if first.IsAdmin || first.IsOwner {
		t.Errorf("first public signup received privilege: is_admin=%v is_owner=%v", first.IsAdmin, first.IsOwner)
	}

	rec = postBootstrap(h, bootstrapClerkID, map[string]string{
		"public_key": keyMallory,
		"username":   "bob",
	})
	owner := decodeUser(t, rec)
	if !owner.IsAdmin || !owner.IsOwner {
		t.Errorf("configured owner lacks privilege: is_admin=%v is_owner=%v", owner.IsAdmin, owner.IsOwner)
	}
}

// Intended behaviour: bootstrap is idempotent. A repeat with the SAME key
// succeeds (200, not 201) and adds no second audit row — the client retries
// this call after a dropped response and must not be punished for it.
func TestBootstrapTwiceWithSameKeySucceeds(t *testing.T) {
	store := newMemProfileStore()
	h := newTestProfileHandler(store)
	body := map[string]string{"public_key": keyAlice, "username": "alice", "display_name": "Alice"}

	first := postBootstrap(h, bootstrapClerkID, body)
	if first.Code != http.StatusCreated {
		t.Fatalf("expected 201 on first call, got %d", first.Code)
	}

	second := postBootstrap(h, bootstrapClerkID, body)
	if second.Code != http.StatusOK {
		t.Fatalf("expected 200 on the idempotent repeat, got %d (body %q)", second.Code, second.Body.String())
	}
	if got := decodeUser(t, second); got.ID != bootstrapUUID || got.PublicKey != keyAlice {
		t.Errorf("repeat returned a different profile: %+v", got)
	}
	if len(store.audit) != 1 {
		t.Errorf("expected the audit table to still hold 1 row, got %d", len(store.audit))
	}
}

// Intended behaviour: a repeat with a DIFFERENT key is REJECTED, and the audit
// table is unchanged.
//
// This is the attack the whole immutability rule exists for. An identity
// provider that can mint a token for any user must not thereby be able to
// replace that user's public key — that would hand it every message sent
// afterwards.
func TestBootstrapWithDifferentKeyIsRejectedAndAuditUnchanged(t *testing.T) {
	store := newMemProfileStore()
	h := newTestProfileHandler(store)

	if rec := postBootstrap(h, bootstrapClerkID, map[string]string{
		"public_key": keyAlice,
		"username":   "alice",
	}); rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 on first call, got %d", rec.Code)
	}
	auditBefore := append([]auditEntry(nil), store.audit...)

	rec := postBootstrap(h, bootstrapClerkID, map[string]string{
		"public_key": keyMallory,
		"username":   "alice",
	})

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for a different public key, got %d (body %q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "public_key_immutable") {
		t.Errorf("expected a public_key_immutable error, got %q", rec.Body.String())
	}
	if len(store.audit) != len(auditBefore) {
		t.Fatalf("audit table changed on a rejected key: %d rows before, %d after", len(auditBefore), len(store.audit))
	}
	for i := range auditBefore {
		if store.audit[i] != auditBefore[i] {
			t.Errorf("audit row %d was modified: %+v -> %+v", i, auditBefore[i], store.audit[i])
		}
	}
	if stored := store.usersByClerkID[bootstrapClerkID]; stored.PublicKey != keyAlice {
		t.Errorf("stored public key was replaced: %q", stored.PublicKey)
	}
}

// Intended behaviour: the handler refuses to invent an identity if it is ever
// mounted without the verifying middleware in front of it.
func TestBootstrapWithoutVerifiedSubjectIsUnauthorized(t *testing.T) {
	store := newMemProfileStore()
	h := newTestProfileHandler(store)

	rec := postBootstrap(h, "", map[string]string{"public_key": keyAlice, "username": "alice"})

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without a verified subject, got %d", rec.Code)
	}
	if store.calls != 0 {
		t.Errorf("expected the store not to be called, got %d calls", store.calls)
	}
}

// Intended behaviour: a profile without a public key would break the E2E model,
// so it is refused rather than created and fixed up later.
func TestBootstrapRequiresPublicKeyAndUsername(t *testing.T) {
	cases := map[string]map[string]string{
		"missing public_key":  {"username": "alice"},
		"blank public_key":    {"public_key": "   ", "username": "alice"},
		"missing username":    {"public_key": keyAlice},
		"oversized publickey": {"public_key": strings.Repeat("A", maxPublicKeyLen+1), "username": "alice"},
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			store := newMemProfileStore()
			rec := postBootstrap(newTestProfileHandler(store), bootstrapClerkID, body)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d (body %q)", rec.Code, rec.Body.String())
			}
			if store.calls != 0 {
				t.Errorf("expected the store not to be called, got %d calls", store.calls)
			}
		})
	}
}

// Intended behaviour: a concurrent bootstrap that lost the insert race is
// retried once and then observes the idempotent path, rather than surfacing an
// internal error to a caller that did nothing wrong.
func TestBootstrapRetriesOnceOnInsertRace(t *testing.T) {
	store := &raceOnceStore{inner: newMemProfileStore()}
	h := newTestProfileHandler(store)

	rec := postBootstrap(h, bootstrapClerkID, map[string]string{
		"public_key": keyAlice,
		"username":   "alice",
	})

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 after the retry, got %d (body %q)", rec.Code, rec.Body.String())
	}
	if store.attempts != 2 {
		t.Errorf("expected exactly 2 store attempts, got %d", store.attempts)
	}
}

type raceOnceStore struct {
	inner    *memProfileStore
	attempts int
}

func (s *raceOnceStore) BootstrapProfile(ctx context.Context, in BootstrapInput) (BootstrapOutcome, error) {
	s.attempts++
	if s.attempts == 1 {
		return BootstrapOutcome{}, ErrBootstrapRace
	}
	return s.inner.BootstrapProfile(ctx, in)
}

// Intended behaviour: a taken username is a 409 the client can act on, not a
// 500.
func TestBootstrapUsernameTakenIsConflict(t *testing.T) {
	store := newMemProfileStore()
	store.failWith = ErrUsernameTaken
	rec := postBootstrap(newTestProfileHandler(store), bootstrapClerkID, map[string]string{
		"public_key": keyAlice,
		"username":   "alice",
	})
	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "username_taken") {
		t.Errorf("expected a username_taken error, got %q", rec.Body.String())
	}
}

// Intended behaviour: an unexpected store failure is a 500 and never leaks the
// underlying error to the caller.
func TestBootstrapUnexpectedStoreErrorIs500(t *testing.T) {
	store := newMemProfileStore()
	store.failWith = errors.New("connection refused to postgres://secret-host")
	rec := postBootstrap(newTestProfileHandler(store), bootstrapClerkID, map[string]string{
		"public_key": keyAlice,
		"username":   "alice",
	})
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "secret-host") {
		t.Errorf("internal error detail leaked to the client: %q", rec.Body.String())
	}
}
