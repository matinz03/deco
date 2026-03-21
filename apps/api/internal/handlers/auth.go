package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/getdeco/api/internal/config"
	"github.com/getdeco/api/internal/models"
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
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	PublicKey   string `json:"public_key"` // Client-generated E2E public key
}

type LoginRequest struct {
	Email    string `json:"email"`
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

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		h.logger.Error("bcrypt error", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	var user models.User
	err = h.pool.QueryRow(r.Context(), `
		INSERT INTO users (username, email, display_name, password_hash, public_key)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, username, email, display_name, public_key, avatar_url, bio, created_at
	`, req.Username, req.Email, req.DisplayName, string(hash), req.PublicKey).
		Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName,
			&user.PublicKey, &user.AvatarURL, &user.Bio, &user.CreatedAt)

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

	var user models.User
	var passwordHash string
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, username, email, display_name, public_key, avatar_url, bio, password_hash, created_at
		FROM users WHERE email = $1
	`, req.Email).Scan(&user.ID, &user.Username, &user.Email, &user.DisplayName,
		&user.PublicKey, &user.AvatarURL, &user.Bio, &passwordHash, &user.CreatedAt)

	if err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		respondError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	token, err := h.generateToken(user.ID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	respondJSON(w, http.StatusOK, AuthResponse{Token: token, User: user})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	// JWT is stateless; client drops the token.
	// Optionally: add token to a Redis blocklist here for hard revocation.
	respondJSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	// TODO: implement token refresh with sliding expiry
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

// Stub handlers — to be fleshed out in subsequent phases
type UserHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request)         {}
func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request)      {}
func (h *UserHandler) Search(w http.ResponseWriter, r *http.Request)        {}
func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request)       {}

type ConversationHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

func (h *ConversationHandler) List(w http.ResponseWriter, r *http.Request)          {}
func (h *ConversationHandler) Create(w http.ResponseWriter, r *http.Request)        {}
func (h *ConversationHandler) Get(w http.ResponseWriter, r *http.Request)           {}
func (h *ConversationHandler) Update(w http.ResponseWriter, r *http.Request)        {}
func (h *ConversationHandler) ListMembers(w http.ResponseWriter, r *http.Request)   {}
func (h *ConversationHandler) AddMember(w http.ResponseWriter, r *http.Request)     {}
func (h *ConversationHandler) RemoveMember(w http.ResponseWriter, r *http.Request)  {}

type MessageHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

func (h *MessageHandler) List(w http.ResponseWriter, r *http.Request)           {}
func (h *MessageHandler) Send(w http.ResponseWriter, r *http.Request)           {}
func (h *MessageHandler) Edit(w http.ResponseWriter, r *http.Request)           {}
func (h *MessageHandler) Delete(w http.ResponseWriter, r *http.Request)         {}
func (h *MessageHandler) AddReaction(w http.ResponseWriter, r *http.Request)    {}
func (h *MessageHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {}
