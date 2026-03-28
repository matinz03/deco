package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/models"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

type RegisterRequest struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	Phone       string `json:"phone_number"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	PublicKey   string `json:"public_key"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Phone    string `json:"phone_number"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" || req.DisplayName == "" || req.PublicKey == "" {
		respondError(w, http.StatusBadRequest, "username, password, display_name and public_key are required")
		return
	}
	if len(req.Password) < 8 {
		respondError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.logger.Error("bcrypt error", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var existingUsers int
	if err := h.pool.QueryRow(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&existingUsers); err != nil {
		h.logger.Error("failed to count users", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var user models.User
	err = scanUser(h.pool.QueryRow(r.Context(), `
		WITH created_user AS (
			INSERT INTO users (username, email, phone_number, display_name, password_hash, public_key, is_admin)
			VALUES ($1, NULLIF($2,''), NULLIF($3,''), $4, $5, $6, $7)
			RETURNING id
		)
		SELECT `+userSelectColumns+`
		FROM users u
		JOIN created_user ON created_user.id = u.id
	`, req.Username, req.Email, req.Phone, req.DisplayName, string(hash), req.PublicKey, existingUsers == 0), &user)

	if err != nil {
		h.logger.Error("failed to create user", zap.Error(err))
		respondError(w, http.StatusConflict, "username or email already taken")
		return
	}

	token, err := h.generateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	respondJSON(w, http.StatusCreated, AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Password == "" {
		respondError(w, http.StatusBadRequest, "password is required")
		return
	}

	var query string
	var identifier string
	if req.Email != "" {
		query = `SELECT ` + userSelectColumns + `,
			password_hash
			FROM users u WHERE u.email = $1`
		identifier = req.Email
	} else if req.Phone != "" {
		query = `SELECT ` + userSelectColumns + `,
			password_hash
			FROM users u WHERE u.phone_number = $1`
		identifier = req.Phone
	} else {
		respondError(w, http.StatusBadRequest, "email or phone_number is required")
		return
	}

	var user models.User
	var passwordHash string
	err := scanUserWithPassword(h.pool.QueryRow(r.Context(), query, identifier), &user, &passwordHash)
	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	h.pool.Exec(r.Context(), `UPDATE users SET last_seen_at = NOW() WHERE id = $1`, user.ID)

	token, err := h.generateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	respondJSON(w, http.StatusOK, AuthResponse{Token: token, User: user})
}

func scanUserWithPassword(row interface {
	Scan(dest ...any) error
}, user *models.User, passwordHash *string) error {
	return row.Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.DisplayName,
		&user.PublicKey,
		&user.AvatarURL,
		&user.Bio,
		&user.IsAdmin,
		&user.RestrictedActions,
		&user.LastSeenAt,
		&user.CreatedAt,
		&user.IsOwner,
		passwordHash,
	)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	respondError(w, http.StatusNotImplemented, "not yet implemented")
}

func (h *AuthHandler) generateToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(7 * 24 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.cfg.JWTSecret))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, message string) {
	respondJSON(w, status, map[string]string{"error": message})
}
