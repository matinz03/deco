package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"go.uber.org/zap"
)

const uploadIntegrationUserID = "20000000-0000-0000-0000-000000000001"

func TestUploadIntegration(t *testing.T) {
	pool := openS1IntegrationPool(t)

	root := t.TempDir()
	setupUploadIntegrationSchema(t, pool)
	router := chi.NewRouter()
	authenticator := appmiddleware.NewAuthenticator(appmiddleware.AuthenticatorOptions{
		JWTSecret: mediaTicketIntegrationSecret,
	})
	RegisterUploadRoutes(router, pool, &config.Config{
		JWTSecret:          mediaTicketIntegrationSecret,
		UploadRoot:         root,
		PublicUploadBase:   "/api/v1/media",
		PublicUploadOrigin: "https://api.example.test",
	}, zap.NewNop(), authenticator)

	t.Run("requires authentication", func(t *testing.T) {
		response := requestUpload(router, "", "image", "photo.png", pngFixture())
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("registers a detected image upload", func(t *testing.T) {
		response := requestUpload(router, uploadIntegrationUserID, "image", "photo.png", pngFixture())
		if response.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusCreated, response.Body.String())
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		storagePath := strings.TrimPrefix(body.URL, "/api/v1/media/")
		if !strings.HasPrefix(storagePath, "messages/images/") {
			t.Fatalf("storage path = %q", storagePath)
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(storagePath))); err != nil {
			t.Fatalf("Stat() error = %v", err)
		}
		var count int
		if err := pool.QueryRow(context.Background(), `SELECT COUNT(*) FROM media_objects WHERE storage_path = $1 AND owner_id = $2`, storagePath, uploadIntegrationUserID).Scan(&count); err != nil {
			t.Fatalf("QueryRow() error = %v", err)
		}
		if count != 1 {
			t.Fatalf("registered object count = %d, want 1", count)
		}
	})

	t.Run("rejects HTML bytes despite a safe filename", func(t *testing.T) {
		response := requestUpload(router, uploadIntegrationUserID, "file", "report.pdf", []byte("<script>alert(1)</script>"))
		if response.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusBadRequest, response.Body.String())
		}
	})

	t.Run("removes an unregistered private file after a definite database rejection", func(t *testing.T) {
		if _, err := pool.Exec(context.Background(), `ALTER TABLE media_objects ADD CONSTRAINT reject_media_objects CHECK (false) NOT VALID`); err != nil {
			t.Fatalf("ALTER TABLE error = %v", err)
		}
		t.Cleanup(func() {
			if _, err := pool.Exec(context.Background(), `ALTER TABLE media_objects DROP CONSTRAINT IF EXISTS reject_media_objects`); err != nil {
				t.Errorf("DROP CONSTRAINT error = %v", err)
			}
		})

		response := requestUpload(router, uploadIntegrationUserID, "image", "rejected.png", pngFixture())
		if response.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusInternalServerError, response.Body.String())
		}
		entries, err := os.ReadDir(filepath.Join(root, "messages", "images"))
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(entries) != 1 {
			t.Fatalf("private upload directory has %d file(s), want only the successful upload", len(entries))
		}
	})
}

func setupUploadIntegrationSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE users (id UUID PRIMARY KEY)`,
		`CREATE TABLE media_objects (
			storage_path TEXT PRIMARY KEY,
			owner_id UUID NOT NULL REFERENCES users(id),
			kind TEXT NOT NULL
		)`,
		`INSERT INTO users (id) VALUES ('20000000-0000-0000-0000-000000000001')`,
	} {
		if _, err := pool.Exec(context.Background(), statement); err != nil {
			t.Fatalf("Exec(%q) error = %v", statement, err)
		}
	}
}

func requestUpload(router http.Handler, userID, kind, filename string, contents []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		panic(err)
	}
	if _, err := part.Write(contents); err != nil {
		panic(err)
	}
	if err := writer.WriteField("kind", kind); err != nil {
		panic(err)
	}
	if err := writer.Close(); err != nil {
		panic(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/uploads/", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if userID != "" {
		request.Header.Set("Authorization", "Bearer "+mediaTicketIntegrationToken(userID))
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

func pngFixture() []byte {
	return []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}
}
