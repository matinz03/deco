package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"go.uber.org/zap"
)

// maxPublicKeyLen bounds the submitted key. The body is attacker-controlled and
// this value is stored, audited, and later handed to other clients.
const maxPublicKeyLen = 1024

var (
	// ErrPublicKeyMismatch means a profile already exists for this identity
	// with a DIFFERENT public key. This is the attack the immutability rule
	// exists to stop: an identity provider that can mint a token for any user
	// must not thereby be able to replace that user's key.
	ErrPublicKeyMismatch = errors.New("public_key_immutable")

	// ErrUsernameTaken means the requested username belongs to someone else.
	ErrUsernameTaken = errors.New("username_taken")

	// ErrBootstrapRace means a concurrent bootstrap for the same identity won
	// the insert. The caller retries once and then observes the idempotent
	// "already exists" path.
	ErrBootstrapRace = errors.New("bootstrap_race")
)

// BootstrapInput is a verified-identity profile creation request. ClerkUserID
// is never taken from the request body — it comes from the verified token.
type BootstrapInput struct {
	ClerkUserID string
	IsOwner     bool
	PublicKey   string
	Username    string
	DisplayName string
	Email       string
	Phone       string
}

// BootstrapOutcome reports what happened. Created distinguishes the first call
// (201) from an idempotent repeat (200).
type BootstrapOutcome struct {
	User    models.User
	Created bool
}

// profileStore is the persistence seam for bootstrap. It exists so the
// idempotency and key-immutability rules can be exercised without a live
// Postgres, and so the transaction boundary is stated in one place.
type profileStore interface {
	// BootstrapProfile inserts the users row and its public-key audit row in
	// a single transaction, or returns the existing row when one is already
	// mapped to this identity with the same key.
	BootstrapProfile(ctx context.Context, in BootstrapInput) (BootstrapOutcome, error)
}

type ProfileHandler struct {
	store  profileStore
	auth   *middleware.Authenticator
	cfg    *config.Config
	logger *zap.Logger
}

func NewProfileHandler(pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger, auth *middleware.Authenticator) *ProfileHandler {
	return &ProfileHandler{
		store:  &postgresProfileStore{pool: pool},
		auth:   auth,
		cfg:    cfg,
		logger: logger,
	}
}

type bootstrapRequest struct {
	PublicKey   string `json:"public_key"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Phone       string `json:"phone_number"`
}

// Bootstrap creates the local profile row for an already-verified external
// identity. It is the only authenticated route that does not require a profile
// row to already exist.
//
// Idempotent by contract: a repeat with the same public key returns 200 and the
// same user; a repeat with a different public key is refused with 409 and
// writes nothing, audit table included.
func (h *ProfileHandler) Bootstrap(w http.ResponseWriter, r *http.Request) {
	clerkUserID := middleware.GetClerkSubject(r)
	if clerkUserID == "" {
		// Only reachable if the route were mounted without the verifying
		// middleware. Refuse rather than invent an identity.
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req bootstrapRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	in := BootstrapInput{
		ClerkUserID: clerkUserID,
		IsOwner:     h.cfg != nil && clerkUserID == h.cfg.Clerk.OwnerUserID,
		PublicKey:   strings.TrimSpace(req.PublicKey),
		Username:    strings.TrimSpace(req.Username),
		DisplayName: strings.TrimSpace(req.DisplayName),
		Email:       strings.TrimSpace(req.Email),
		Phone:       strings.TrimSpace(req.Phone),
	}

	if in.PublicKey == "" {
		respondError(w, http.StatusBadRequest, "public_key is required")
		return
	}
	if len(in.PublicKey) > maxPublicKeyLen {
		respondError(w, http.StatusBadRequest, "public_key is too long")
		return
	}
	if in.Username == "" {
		respondError(w, http.StatusBadRequest, "username is required")
		return
	}
	if in.DisplayName == "" {
		in.DisplayName = in.Username
	}

	outcome, err := h.store.BootstrapProfile(r.Context(), in)
	if errors.Is(err, ErrBootstrapRace) {
		// A concurrent call for the same identity inserted first. Retry once;
		// the retry takes the idempotent "already exists" branch.
		outcome, err = h.store.BootstrapProfile(r.Context(), in)
	}

	switch {
	case err == nil:
	case errors.Is(err, ErrPublicKeyMismatch):
		respondError(w, http.StatusConflict, "public_key_immutable")
		return
	case errors.Is(err, ErrUsernameTaken):
		respondError(w, http.StatusConflict, "username_taken")
		return
	default:
		if h.logger != nil {
			h.logger.Error("profile bootstrap failed", zap.Error(err))
		}
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if outcome.Created && h.auth != nil {
		// Drop any cached negative/stale mapping so the caller's very next
		// request resolves to the new UUID instead of 409-ing.
		h.auth.InvalidateUserMapping(r.Context(), clerkUserID)
	}

	status := http.StatusOK
	if outcome.Created {
		status = http.StatusCreated
	}
	respondJSON(w, status, map[string]any{"user": outcome.User})
}

// ─── Postgres implementation ─────────────────────────────────────────────────

type postgresProfileStore struct {
	pool *pgxpool.Pool
}

func (s *postgresProfileStore) BootstrapProfile(ctx context.Context, in BootstrapInput) (BootstrapOutcome, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BootstrapOutcome{}, err
	}
	defer tx.Rollback(ctx)
	if in.IsOwner {
		// Serialize configured-owner retries before checking for an existing
		// profile. Database uniqueness remains the final invariant.
		if _, err := tx.Exec(ctx, ownerBootstrapLockSQL); err != nil {
			return BootstrapOutcome{}, err
		}
	}

	// Lock the existing row, if any, for the duration of the transaction.
	var existingID, existingKey string
	err = tx.QueryRow(ctx, `
		SELECT id::text, public_key
		FROM users
		WHERE clerk_user_id = $1
		FOR UPDATE
	`, in.ClerkUserID).Scan(&existingID, &existingKey)

	switch {
	case err == nil:
		if existingKey != in.PublicKey {
			// Rollback via defer. Nothing is written — in particular no
			// audit row, which is what makes "the audit table is unchanged"
			// true rather than merely intended.
			return BootstrapOutcome{}, ErrPublicKeyMismatch
		}
		if in.IsOwner {
			// The configured owner may have created an ordinary profile before a
			// restart or cutover completed. Promote only that verified subject,
			// under the owner advisory lock and the single-owner DB constraint.
			if _, err := tx.Exec(ctx, `
				UPDATE users
				SET is_admin = TRUE, is_owner = TRUE
				WHERE id = $1
			`, existingID); err != nil {
				return BootstrapOutcome{}, err
			}
		}
		var user models.User
		if err := scanUser(tx.QueryRow(ctx, `
			SELECT `+userSelectColumns+`
			FROM users u
			WHERE u.id = $1
		`, existingID), &user); err != nil {
			return BootstrapOutcome{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return BootstrapOutcome{}, err
		}
		return BootstrapOutcome{User: user, Created: false}, nil

	case errors.Is(err, pgx.ErrNoRows):
		// fall through to insert

	default:
		return BootstrapOutcome{}, err
	}

	var user models.User
	// password_hash is '' for externally-authenticated users: bcrypt cannot
	// verify any password against it, so the legacy login path stays closed for
	// them without weakening the column's NOT NULL constraint.
	err = tx.QueryRow(ctx, `
		INSERT INTO users (username, email, phone_number, display_name, password_hash, clerk_user_id, public_key, is_admin, is_owner)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, '', $5, $6, $7, $7)
		RETURNING
			id,
			username,
			COALESCE(email, ''),
			display_name,
			public_key,
			avatar_url,
			bio,
			is_admin,
			is_owner,
			COALESCE(restricted_actions, '{}'::text[]),
			last_seen_at,
			created_at
	`, in.Username, in.Email, in.Phone, in.DisplayName, in.ClerkUserID, in.PublicKey, in.IsOwner).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.DisplayName,
		&user.PublicKey,
		&user.AvatarURL,
		&user.Bio,
		&user.IsAdmin,
		&user.IsOwner,
		&user.RestrictedActions,
		&user.LastSeenAt,
		&user.CreatedAt,
	)
	if err != nil {
		return BootstrapOutcome{}, classifyInsertError(err)
	}
	// Same transaction as the key write: a public key can never exist without
	// its audit row.
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_public_key_audit (user_id, clerk_user_id, public_key, source)
		VALUES ($1, $2, $3, 'profile_bootstrap')
	`, user.ID, in.ClerkUserID, in.PublicKey); err != nil {
		return BootstrapOutcome{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return BootstrapOutcome{}, err
	}
	return BootstrapOutcome{User: user, Created: true}, nil
}

func classifyInsertError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return err
	}
	if strings.Contains(pgErr.ConstraintName, "clerk_user_id") {
		return ErrBootstrapRace
	}
	return ErrUsernameTaken
}
