package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestRegisterValidation(t *testing.T) {
	h := &AuthHandler{}

	t.Run("Empty Username Returns 400", func(t *testing.T) {
		body, _ := json.Marshal(RegisterRequest{
			Username:    "",
			Password:    "password123",
			DisplayName: "Test User",
			PublicKey:   "pubkey123",
		})
		req := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		h.Register(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 Bad Request, got %d", rec.Code)
		}
	})

	t.Run("Short Password Returns 400", func(t *testing.T) {
		body, _ := json.Marshal(RegisterRequest{
			Username:    "testuser",
			Password:    "short",
			DisplayName: "Test User",
			PublicKey:   "pubkey123",
		})
		req := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		h.Register(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 Bad Request, got %d", rec.Code)
		}
	})

	t.Run("Invalid JSON Body Returns 400", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/v1/auth/register", bytes.NewReader([]byte("invalid-json")))
		rec := httptest.NewRecorder()

		h.Register(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 Bad Request, got %d", rec.Code)
		}
	})
}

func TestLoginValidation(t *testing.T) {
	h := &AuthHandler{}

	t.Run("Missing Password Returns 400", func(t *testing.T) {
		body, _ := json.Marshal(LoginRequest{
			Email:    "test@example.com",
			Password: "",
		})
		req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		h.Login(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 Bad Request, got %d", rec.Code)
		}
	})

	t.Run("Missing Email and Phone Returns 400", func(t *testing.T) {
		body, _ := json.Marshal(LoginRequest{
			Email:    "",
			Phone:    "",
			Password: "validpassword123",
		})
		req := httptest.NewRequest("POST", "/api/v1/auth/login", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		h.Login(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected status 400 Bad Request, got %d", rec.Code)
		}
	})
}

func TestLogoutAndRefresh(t *testing.T) {
	h := &AuthHandler{}

	t.Run("Logout Returns 200", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/v1/auth/logout", nil)
		rec := httptest.NewRecorder()

		h.Logout(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status 200 OK, got %d", rec.Code)
		}
	})

	t.Run("Refresh Returns 501 Not Implemented", func(t *testing.T) {
		req := httptest.NewRequest("POST", "/api/v1/auth/refresh", nil)
		rec := httptest.NewRecorder()

		h.Refresh(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Errorf("expected status 501 Not Implemented, got %d", rec.Code)
		}
	})
}

func TestBcryptPasswordHashing(t *testing.T) {
	password := "my-secret-password-123"
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	err = bcrypt.CompareHashAndPassword(hash, []byte(password))
	if err != nil {
		t.Errorf("expected valid password comparison, got error: %v", err)
	}

	err = bcrypt.CompareHashAndPassword(hash, []byte("wrong-password"))
	if err == nil {
		t.Error("expected error for wrong password comparison, got nil")
	}
}
