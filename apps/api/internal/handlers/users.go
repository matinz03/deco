package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
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
		DisplayName string `json:"display_name"`
		Bio         string `json:"bio"`
		AvatarURL   string `json:"avatar_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var user models.User
	err := h.pool.QueryRow(r.Context(), `
		UPDATE users
		SET display_name = COALESCE(NULLIF($1,''), display_name),
		    bio          = COALESCE(NULLIF($2,''), bio),
		    avatar_url   = COALESCE(NULLIF($3,''), avatar_url),
		    updated_at   = NOW()
		WHERE id = $4
		RETURNING id, username, COALESCE(email,''), display_name, public_key,
		          avatar_url, bio, last_seen_at, created_at
	`, req.DisplayName, req.Bio, req.AvatarURL, userID).
		Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.PublicKey, &user.AvatarURL, &user.Bio, &user.LastSeenAt, &user.CreatedAt)

	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to update user")
		return
	}

	respondJSON(w, http.StatusOK, user)
}

func (h *UserHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		respondError(w, http.StatusBadRequest, "query must be at least 2 characters")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT id, username, display_name, public_key, avatar_url, bio, last_seen_at, created_at
		FROM users
		WHERE username ILIKE $1 OR display_name ILIKE $1
		LIMIT 20
	`, "%"+q+"%")
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
