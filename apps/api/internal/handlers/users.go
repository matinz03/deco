package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	user, err := h.loadUserByID(r.Context(), userID)

	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		DisplayName     string `json:"display_name"`
		Bio             string `json:"bio"`
		AvatarURL       string `json:"avatar_url"`
		Email           string `json:"email"`
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Email = strings.TrimSpace(req.Email)

	var nextPasswordHash *string
	if strings.TrimSpace(req.NewPassword) != "" {
		if len(req.NewPassword) < 8 {
			respondError(w, http.StatusBadRequest, "new password must be at least 8 characters")
			return
		}
		if strings.TrimSpace(req.CurrentPassword) == "" {
			respondError(w, http.StatusBadRequest, "current_password is required to change password")
			return
		}

		var passwordHash string
		if err := h.pool.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&passwordHash); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to verify current password")
			return
		}

		if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.CurrentPassword)); err != nil {
			respondError(w, http.StatusUnauthorized, "current password is incorrect")
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to update password")
			return
		}
		hashValue := string(hash)
		nextPasswordHash = &hashValue
	}

	if _, err := h.pool.Exec(r.Context(), `
		UPDATE users
		SET display_name = COALESCE(NULLIF($1,''), display_name),
		    bio          = COALESCE(NULLIF($2,''), bio),
		    avatar_url   = COALESCE(NULLIF($3,''), avatar_url),
		    email        = COALESCE(NULLIF($4,''), email),
		    password_hash = COALESCE($5, password_hash),
		    updated_at   = NOW()
		WHERE id = $6
	`, req.DisplayName, req.Bio, req.AvatarURL, req.Email, nextPasswordHash, userID); err != nil {
		if strings.Contains(err.Error(), "users_email_key") {
			respondError(w, http.StatusConflict, "email is already taken")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	user, err := h.loadUserByID(r.Context(), userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to load updated user")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) Search(w http.ResponseWriter, r *http.Request) {
	requesterID := middleware.GetUserID(r)
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		respondError(w, http.StatusBadRequest, "query must be at least 2 characters")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT `+userSelectColumns+`
		FROM users u
		WHERE id <> $2
		  AND (username ILIKE $1 OR display_name ILIKE $1)
		LIMIT 20
	`, "%"+q+"%", requesterID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "search failed")
		return
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var u models.User
		if err := scanUser(rows, &u); err == nil {
			users = append(users, u)
		}
	}

	respondJSON(w, http.StatusOK, users)
}

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")

	user, err := h.loadUserByID(r.Context(), userID)

	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) ListAdminUsers(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r)

	ok, err := isAdminUser(r.Context(), h.pool, adminID)
	if err != nil || !ok {
		respondError(w, http.StatusForbidden, "admin access is required")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT `+userSelectColumns+`
		FROM users u
		ORDER BY u.created_at ASC, u.username ASC
	`)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to load users")
		return
	}
	defer rows.Close()

	users := []models.User{}
	for rows.Next() {
		var user models.User
		if err := scanUser(rows, &user); err == nil {
			users = append(users, user)
		}
	}

	respondJSON(w, http.StatusOK, users)
}

func (h *UserHandler) UpdateAdminUser(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r)
	targetUserID := chi.URLParam(r, "userID")

	ok, err := isAdminUser(r.Context(), h.pool, adminID)
	if err != nil || !ok {
		respondError(w, http.StatusForbidden, "admin access is required")
		return
	}

	var req struct {
		DisplayName       string   `json:"display_name"`
		Username          string   `json:"username"`
		AvatarURL         string   `json:"avatar_url"`
		IsAdmin           *bool    `json:"is_admin"`
		RestrictedActions []string `json:"restricted_actions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	targetUser, err := h.loadUserByID(r.Context(), targetUserID)
	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}
	if targetUser.IsOwner && req.IsAdmin != nil && !*req.IsAdmin {
		respondError(w, http.StatusBadRequest, "the owner cannot be demoted")
		return
	}

	restrictedActions := normalizeRestrictedActions(req.RestrictedActions)
	isAdminValue := targetUser.IsAdmin
	if req.IsAdmin != nil {
		isAdminValue = *req.IsAdmin
	}
	if targetUser.IsOwner {
		isAdminValue = true
	}

	if _, err := h.pool.Exec(r.Context(), `
		UPDATE users
		SET display_name = COALESCE(NULLIF($1,''), display_name),
		    username = COALESCE(NULLIF($2,''), username),
		    avatar_url = COALESCE(NULLIF($3,''), avatar_url),
		    is_admin = $4,
		    restricted_actions = $5,
		    updated_at = NOW()
		WHERE id = $6
	`, strings.TrimSpace(req.DisplayName), strings.TrimSpace(req.Username), strings.TrimSpace(req.AvatarURL), isAdminValue, restrictedActions, targetUserID); err != nil {
		if strings.Contains(err.Error(), "users_username_key") {
			respondError(w, http.StatusConflict, "username is already taken")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	updatedUser, err := h.loadUserByID(r.Context(), targetUserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to load updated user")
		return
	}

	respondJSON(w, http.StatusOK, updatedUser)
}

func (h *UserHandler) DeleteAdminUser(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r)
	targetUserID := chi.URLParam(r, "userID")

	ok, err := isAdminUser(r.Context(), h.pool, adminID)
	if err != nil || !ok {
		respondError(w, http.StatusForbidden, "admin access is required")
		return
	}
	if adminID == targetUserID {
		respondError(w, http.StatusBadRequest, "you cannot delete your own account here")
		return
	}

	targetUser, err := h.loadUserByID(r.Context(), targetUserID)
	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}
	if targetUser.IsOwner {
		respondError(w, http.StatusBadRequest, "the owner account cannot be deleted")
		return
	}

	if err := h.deleteUserAccount(r, targetUserID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to delete user")
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (h *UserHandler) GetKeyBackup(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var backup models.KeyBackup
	err := h.pool.QueryRow(r.Context(), `
		SELECT user_id, version, kdf, iterations, salt, cipher, iv, ciphertext, created_at, updated_at
		FROM user_key_backups
		WHERE user_id = $1
	`, userID).Scan(
		&backup.UserID,
		&backup.Version,
		&backup.KDF,
		&backup.Iterations,
		&backup.Salt,
		&backup.Cipher,
		&backup.IV,
		&backup.Ciphertext,
		&backup.CreatedAt,
		&backup.UpdatedAt,
	)
	if err != nil {
		if err != pgx.ErrNoRows {
			respondError(w, http.StatusInternalServerError, "failed to load key backup")
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"exists": false})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"exists": true,
		"backup": backup,
	})
}

func (h *UserHandler) PutKeyBackup(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Version    int    `json:"version"`
		KDF        string `json:"kdf"`
		Iterations int    `json:"iterations"`
		Salt       string `json:"salt"`
		Cipher     string `json:"cipher"`
		IV         string `json:"iv"`
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Version <= 0 || req.KDF == "" || req.Iterations <= 0 || req.Salt == "" || req.Cipher == "" || req.IV == "" || req.Ciphertext == "" {
		respondError(w, http.StatusBadRequest, "missing required backup fields")
		return
	}

	var backup models.KeyBackup
	err := h.pool.QueryRow(r.Context(), `
		INSERT INTO user_key_backups (user_id, version, kdf, iterations, salt, cipher, iv, ciphertext)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id) DO UPDATE
		SET version = EXCLUDED.version,
		    kdf = EXCLUDED.kdf,
		    iterations = EXCLUDED.iterations,
		    salt = EXCLUDED.salt,
		    cipher = EXCLUDED.cipher,
		    iv = EXCLUDED.iv,
		    ciphertext = EXCLUDED.ciphertext,
		    updated_at = NOW()
		RETURNING user_id, version, kdf, iterations, salt, cipher, iv, ciphertext, created_at, updated_at
	`, userID, req.Version, req.KDF, req.Iterations, req.Salt, req.Cipher, req.IV, req.Ciphertext).Scan(
		&backup.UserID,
		&backup.Version,
		&backup.KDF,
		&backup.Iterations,
		&backup.Salt,
		&backup.Cipher,
		&backup.IV,
		&backup.Ciphertext,
		&backup.CreatedAt,
		&backup.UpdatedAt,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to store key backup")
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"exists": true,
		"backup": backup,
	})
}

func (h *UserHandler) DeleteKeyBackup(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	if _, err := h.pool.Exec(r.Context(), `DELETE FROM user_key_backups WHERE user_id = $1`, userID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to delete key backup")
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"exists": false})
}

func (h *UserHandler) loadUserByID(ctx context.Context, userID string) (*models.User, error) {
	var user models.User
	err := scanUser(h.pool.QueryRow(ctx, `
		SELECT `+userSelectColumns+`
		FROM users u
		WHERE u.id = $1
	`, userID), &user)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (h *UserHandler) deleteUserAccount(r *http.Request, targetUserID string) error {
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		return err
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), `
		DELETE FROM reactions
		WHERE user_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM poll_votes
		WHERE user_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM group_keys
		WHERE user_id = $1 OR encrypted_by = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM group_leadership_votes
		WHERE voter_user_id = $1 OR candidate_user_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM group_leadership_objections
		WHERE user_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM messages
		WHERE sender_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	rows, err := tx.Query(r.Context(), `
		SELECT conversation_id
		FROM members
		WHERE user_id = $1 AND role = 'owner'
	`, targetUserID)
	if err != nil {
		return err
	}
	ownerConversationIDs := []string{}
	for rows.Next() {
		var conversationID string
		if err := rows.Scan(&conversationID); err == nil {
			ownerConversationIDs = append(ownerConversationIDs, conversationID)
		}
	}
	rows.Close()

	for _, conversationID := range ownerConversationIDs {
		var nextOwnerID string
		err := tx.QueryRow(r.Context(), `
			SELECT user_id
			FROM members
			WHERE conversation_id = $1 AND user_id <> $2
			ORDER BY
				CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
				joined_at ASC,
				user_id ASC
			LIMIT 1
		`, conversationID, targetUserID).Scan(&nextOwnerID)
		if err == nil {
			if _, err := tx.Exec(r.Context(), `
				UPDATE members
				SET role = CASE WHEN role = 'owner' THEN 'admin' ELSE role END
				WHERE conversation_id = $1
			`, conversationID); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `
				UPDATE members
				SET role = 'owner'
				WHERE conversation_id = $1 AND user_id = $2
			`, conversationID, nextOwnerID); err != nil {
				return err
			}
			if _, err := tx.Exec(r.Context(), `
				UPDATE conversations
				SET created_by_id = $2, updated_at = NOW()
				WHERE id = $1
			`, conversationID, nextOwnerID); err != nil {
				return err
			}
			continue
		}
		if err != pgx.ErrNoRows {
			return err
		}

		if _, err := tx.Exec(r.Context(), `
			DELETE FROM conversations
			WHERE id = $1
		`, conversationID); err != nil {
			return err
		}
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM members
		WHERE user_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	_, err = tx.Exec(r.Context(), `
		DELETE FROM conversations
		WHERE created_by_id = $1
	`, targetUserID)
	if err != nil {
		return err
	}

	commandTag, err := tx.Exec(r.Context(), `
		DELETE FROM users
		WHERE id = $1
	`, targetUserID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	return tx.Commit(r.Context())
}
