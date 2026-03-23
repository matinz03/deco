package handlers

import (
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

	var user models.User
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, username, COALESCE(email,''), display_name, public_key,
		       avatar_url, bio, last_seen_at, created_at
		FROM users WHERE id = $1
	`, userID).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName,
		&user.PublicKey, &user.AvatarURL, &user.Bio, &user.LastSeenAt, &user.CreatedAt)

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

	var user models.User
	err := h.pool.QueryRow(r.Context(), `
		UPDATE users
		SET display_name = COALESCE(NULLIF($1,''), display_name),
		    bio          = COALESCE(NULLIF($2,''), bio),
		    avatar_url   = COALESCE(NULLIF($3,''), avatar_url),
		    email        = COALESCE(NULLIF($4,''), email),
		    password_hash = COALESCE($5, password_hash),
		    updated_at   = NOW()
		WHERE id = $6
		RETURNING id, username, COALESCE(email,''), display_name, public_key,
		          avatar_url, bio, last_seen_at, created_at
	`, req.DisplayName, req.Bio, req.AvatarURL, req.Email, nextPasswordHash, userID).
		Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.PublicKey, &user.AvatarURL, &user.Bio, &user.LastSeenAt, &user.CreatedAt)

	if err != nil {
		if strings.Contains(err.Error(), "users_email_key") {
			respondError(w, http.StatusConflict, "email is already taken")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to update user")
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
		SELECT id, username, display_name, public_key, avatar_url, bio, last_seen_at, created_at
		FROM users
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
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.PublicKey,
			&u.AvatarURL, &u.Bio, &u.LastSeenAt, &u.CreatedAt); err == nil {
			users = append(users, u)
		}
	}

	respondJSON(w, http.StatusOK, users)
}

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")

	var user models.User
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, public_key, avatar_url, bio, last_seen_at, created_at
		FROM users WHERE id = $1
	`, userID).Scan(&user.ID, &user.Username, &user.DisplayName, &user.PublicKey,
		&user.AvatarURL, &user.Bio, &user.LastSeenAt, &user.CreatedAt)

	if err != nil {
		respondError(w, http.StatusNotFound, "user not found")
		return
	}

	respondJSON(w, http.StatusOK, user)
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
