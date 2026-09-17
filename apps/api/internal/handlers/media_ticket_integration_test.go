package handlers

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/storage"
	"go.uber.org/zap"
)

const mediaTicketIntegrationSecret = "media-ticket-integration-secret"

const (
	mediaTicketConversationID = "10000000-0000-0000-0000-000000000001"
	mediaTicketSenderID       = "10000000-0000-0000-0000-000000000002"
	mediaTicketMemberID       = "10000000-0000-0000-0000-000000000003"
	mediaTicketOutsiderID     = "10000000-0000-0000-0000-000000000004"
	mediaTicketMessageID      = "10000000-0000-0000-0000-000000000005"
	mediaTicketDeletedID      = "10000000-0000-0000-0000-000000000006"
	mediaTicketUnlinkedID     = "10000000-0000-0000-0000-000000000007"
	mediaTicketWrongOwnerID   = "10000000-0000-0000-0000-000000000008"
)

func TestGetMediaTicketIntegration(t *testing.T) {
	pool := openS1IntegrationPool(t)

	setupMediaTicketIntegrationSchema(t, pool)
	seedMediaTicketIntegrationData(t, pool)

	router := chi.NewRouter()
	authenticator := appmiddleware.NewAuthenticator(appmiddleware.AuthenticatorOptions{
		JWTSecret: mediaTicketIntegrationSecret,
	})
	RegisterMessageRoutes(router, pool, &config.Config{
		JWTSecret:          mediaTicketIntegrationSecret,
		PublicUploadBase:   "/api/v1/media",
		PublicUploadOrigin: "https://api.example.test",
	}, zap.NewNop(), nil, nil, nil, authenticator)

	t.Run("requires authentication", func(t *testing.T) {
		response := requestMediaTicket(router, "", mediaTicketMessageID)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
		}
	})

	t.Run("issues a ticket to an authorized member", func(t *testing.T) {
		response := requestMediaTicket(router, mediaTicketMemberID, mediaTicketMessageID)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		if !strings.Contains(body.URL, "/messages/images/attached.png?ticket=") {
			t.Fatalf("ticket URL = %q", body.URL)
		}
	})

	t.Run("presigns an S3 object after membership authorization", func(t *testing.T) {
		backend := &presignRecordingBackend{url: "https://objects.example.test/private/object?signature=test"}
		s3Router := chi.NewRouter()
		RegisterMessageRoutes(s3Router, pool, &config.Config{
			JWTSecret:          mediaTicketIntegrationSecret,
			UploadRoot:         t.TempDir(),
			PublicUploadBase:   "/api/v1/media",
			PublicUploadOrigin: "https://api.example.test",
		}, zap.NewNop(), nil, backend, &config.StorageConfig{
			Backend:    config.StorageBackendS3,
			PresignTTL: 2 * time.Minute,
		}, authenticator)

		response := requestMediaTicket(s3Router, mediaTicketMemberID, mediaTicketMessageID)
		if response.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d; body = %q", response.Code, http.StatusOK, response.Body.String())
		}
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("Decode() error = %v", err)
		}
		if body.URL != backend.url {
			t.Fatalf("URL = %q, want %q", body.URL, backend.url)
		}
		if backend.ref != (storage.ObjectRef{Bucket: storage.BucketPrivate, Key: "messages/images/attached.png"}) {
			t.Fatalf("PresignGet ref = %#v", backend.ref)
		}
		if backend.ttl != 2*time.Minute {
			t.Fatalf("PresignGet ttl = %s, want 2m", backend.ttl)
		}
	})

	t.Run("denies a non-member", func(t *testing.T) {
		response := requestMediaTicket(router, mediaTicketOutsiderID, mediaTicketMessageID)
		if response.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
		}
	})

	t.Run("rejects deleted messages", func(t *testing.T) {
		response := requestMediaTicket(router, mediaTicketMemberID, mediaTicketDeletedID)
		if response.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})

	t.Run("rejects media without an owned object", func(t *testing.T) {
		response := requestMediaTicket(router, mediaTicketMemberID, mediaTicketUnlinkedID)
		if response.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})

	t.Run("rejects media owned by someone other than the sender", func(t *testing.T) {
		response := requestMediaTicket(router, mediaTicketMemberID, mediaTicketWrongOwnerID)
		if response.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want %d", response.Code, http.StatusNotFound)
		}
	})
}

func setupMediaTicketIntegrationSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE users (id UUID PRIMARY KEY)`,
		`CREATE TABLE conversations (id UUID PRIMARY KEY)`,
		`CREATE TABLE members (
			conversation_id UUID NOT NULL REFERENCES conversations(id),
			user_id UUID NOT NULL REFERENCES users(id),
			PRIMARY KEY (conversation_id, user_id)
		)`,
		`CREATE TABLE messages (
			id UUID PRIMARY KEY,
			conversation_id UUID NOT NULL REFERENCES conversations(id),
			sender_id UUID NOT NULL REFERENCES users(id),
			media_url TEXT,
			is_deleted BOOLEAN NOT NULL DEFAULT FALSE
		)`,
		`CREATE TABLE media_objects (
			storage_path TEXT PRIMARY KEY,
			owner_id UUID NOT NULL REFERENCES users(id),
			kind TEXT NOT NULL DEFAULT 'image',
			encrypted BOOLEAN NOT NULL DEFAULT FALSE,
			original_name TEXT NOT NULL DEFAULT '',
			mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
			size BIGINT NOT NULL DEFAULT 0
		)`,
	} {
		if _, err := pool.Exec(context.Background(), statement); err != nil {
			t.Fatalf("Exec(%q) error = %v", statement, err)
		}
	}
}

func openS1IntegrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL-backed integration tests")
	}
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig() error = %v", err)
	}
	if poolConfig.ConnConfig.Database != "deco_s1_test" {
		t.Fatalf("refusing to run against database %q; use dedicated deco_s1_test", poolConfig.ConnConfig.Database)
	}
	admin, err := pgx.Connect(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("pgx.Connect() error = %v", err)
	}
	randomSuffix := make([]byte, 8)
	if _, err := rand.Read(randomSuffix); err != nil {
		admin.Close(context.Background())
		t.Fatalf("rand.Read() error = %v", err)
	}
	schema := fmt.Sprintf("s1_media_%d_%s", time.Now().UnixNano(), hex.EncodeToString(randomSuffix))
	if _, err := admin.Exec(context.Background(), "CREATE SCHEMA "+schema); err != nil {
		admin.Close(context.Background())
		t.Fatalf("CREATE SCHEMA error = %v", err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("DROP SCHEMA error = %v", err)
		}
		admin.Close(context.Background())
	})
	if poolConfig.ConnConfig.RuntimeParams == nil {
		poolConfig.ConnConfig.RuntimeParams = map[string]string{}
	}
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	poolConfig.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), poolConfig)
	if err != nil {
		t.Fatalf("pgxpool.NewWithConfig() error = %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func seedMediaTicketIntegrationData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id) VALUES ($1), ($2), ($3)`, []any{mediaTicketSenderID, mediaTicketMemberID, mediaTicketOutsiderID}},
		{`INSERT INTO conversations (id) VALUES ($1)`, []any{mediaTicketConversationID}},
		{`INSERT INTO members (conversation_id, user_id) VALUES ($1, $2)`, []any{mediaTicketConversationID, mediaTicketMemberID}},
		{`INSERT INTO messages (id, conversation_id, sender_id, media_url, is_deleted) VALUES ($1, $2, $3, $4, false)`, []any{mediaTicketMessageID, mediaTicketConversationID, mediaTicketSenderID, "/api/v1/media/messages/images/attached.png"}},
		{`INSERT INTO messages (id, conversation_id, sender_id, media_url, is_deleted) VALUES ($1, $2, $3, $4, true)`, []any{mediaTicketDeletedID, mediaTicketConversationID, mediaTicketSenderID, "/api/v1/media/messages/images/deleted.png"}},
		{`INSERT INTO messages (id, conversation_id, sender_id, media_url, is_deleted) VALUES ($1, $2, $3, $4, false)`, []any{mediaTicketUnlinkedID, mediaTicketConversationID, mediaTicketSenderID, "/api/v1/media/messages/images/unlinked.png"}},
		{`INSERT INTO messages (id, conversation_id, sender_id, media_url, is_deleted) VALUES ($1, $2, $3, $4, false)`, []any{mediaTicketWrongOwnerID, mediaTicketConversationID, mediaTicketSenderID, "/api/v1/media/messages/images/wrong-owner.png"}},
		{`INSERT INTO media_objects (storage_path, owner_id) VALUES ($1, $2)`, []any{"messages/images/attached.png", mediaTicketSenderID}},
		{`INSERT INTO media_objects (storage_path, owner_id) VALUES ($1, $2)`, []any{"messages/images/wrong-owner.png", mediaTicketOutsiderID}},
	} {
		if _, err := pool.Exec(context.Background(), statement.query, statement.args...); err != nil {
			t.Fatalf("Exec() error = %v", err)
		}
	}
}

func requestMediaTicket(router http.Handler, userID, messageID string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, "/conversations/"+mediaTicketConversationID+"/messages/"+messageID+"/media-ticket", nil)
	if userID != "" {
		request.Header.Set("Authorization", "Bearer "+mediaTicketIntegrationToken(userID))
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

type presignRecordingBackend struct {
	url string
	ref storage.ObjectRef
	ttl time.Duration
}

func (b *presignRecordingBackend) Put(context.Context, storage.ObjectRef, storage.PutInput) (*storage.PutResult, error) {
	panic("unexpected Put call")
}

func (b *presignRecordingBackend) PresignGet(_ context.Context, ref storage.ObjectRef, ttl time.Duration) (string, error) {
	b.ref = ref
	b.ttl = ttl
	return b.url, nil
}

func (b *presignRecordingBackend) Delete(context.Context, storage.ObjectRef) error {
	panic("unexpected Delete call")
}

func mediaTicketIntegrationToken(userID string) string {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": userID})
	signed, err := token.SignedString([]byte(mediaTicketIntegrationSecret))
	if err != nil {
		panic(err)
	}
	return signed
}
