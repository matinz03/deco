package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func createTestToken(userID, secret string, expired bool) string {
	exp := time.Now().Add(1 * time.Hour).Unix()
	if expired {
		exp = time.Now().Add(-1 * time.Hour).Unix()
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"exp": exp,
	})
	str, _ := token.SignedString([]byte(secret))
	return str
}

func TestValidateToken(t *testing.T) {
	secret := "super-secret-key-123"
	validToken := createTestToken("user_abc123", secret, false)
	expiredToken := createTestToken("user_abc123", secret, true)
	wrongSecretToken := createTestToken("user_abc123", "wrong-secret", false)

	t.Run("Valid Token", func(t *testing.T) {
		userID, err := ValidateToken(validToken, secret)
		if err != nil {
			t.Fatalf("expected valid token, got error: %v", err)
		}
		if userID != "user_abc123" {
			t.Errorf("expected user_abc123, got %s", userID)
		}
	})

	t.Run("Expired Token", func(t *testing.T) {
		_, err := ValidateToken(expiredToken, secret)
		if err == nil {
			t.Error("expected error for expired token, got nil")
		}
	})

	t.Run("Wrong Secret Token", func(t *testing.T) {
		_, err := ValidateToken(wrongSecretToken, secret)
		if err == nil {
			t.Error("expected error for wrong secret, got nil")
		}
	})
}

func TestAuthMiddleware(t *testing.T) {
	secret := "super-secret-key-123"
	validToken := createTestToken("user_999", secret, false)

	handler := Auth(secret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := GetUserID(r)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(userID))
	}))

	t.Run("Valid Authorization Header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/v1/protected", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected 200 OK, got %d", rec.Code)
		}
		if rec.Body.String() != "user_999" {
			t.Errorf("expected user_999 in response, got %s", rec.Body.String())
		}
	})

	t.Run("Missing Authorization Header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/v1/protected", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", rec.Code)
		}
	})

	t.Run("Malformed Authorization Header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/v1/protected", nil)
		req.Header.Set("Authorization", "Basic 12345")
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", rec.Code)
		}
	})
}
