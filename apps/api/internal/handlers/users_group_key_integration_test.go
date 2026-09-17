package handlers

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/matinz03/deco/internal/db"
)

func TestDeleteUserRequiresEncryptedGroupRotation(t *testing.T) {
	databaseURL := os.Getenv("DECO_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DECO_TEST_DATABASE_URL not set; skipping account-deletion integration test")
	}
	pool, err := db.Connect(databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := db.EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}

	ctx := context.Background()
	var ownerID, targetID, conversationID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, display_name, password_hash, public_key)
		VALUES ('delete_rotation_owner', 'Owner', 'x', 'OWNERKEY') RETURNING id
	`).Scan(&ownerID); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (username, display_name, password_hash, public_key)
		VALUES ('delete_rotation_target', 'Target', 'x', 'TARGETKEY') RETURNING id
	`).Scan(&targetID); err != nil {
		t.Fatalf("seed target: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO conversations (type, name, created_by_id, current_group_key_epoch)
		VALUES ('group', 'Deletion rotation', $1, 1) RETURNING id
	`, ownerID).Scan(&conversationID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM conversations WHERE id=$1`, conversationID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, ownerID, targetID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO members (conversation_id, user_id, role)
		VALUES ($1, $2, 'owner'), ($1, $3, 'member')
	`, conversationID, ownerID, targetID); err != nil {
		t.Fatalf("seed members: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_key_epochs (conversation_id, epoch, created_by) VALUES ($1, 1, $2)
	`, conversationID, ownerID); err != nil {
		t.Fatalf("seed epoch: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_key_copies (
			conversation_id, epoch, user_id, encrypted_by, encryptor_public_key, encrypted_key
		) VALUES
			($1, 1, $2, $2, 'OWNERKEY', 'owner-v1'),
			($1, 1, $3, $2, 'OWNERKEY', 'target-v1')
	`, conversationID, ownerID, targetID); err != nil {
		t.Fatalf("seed copies: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_keys (conversation_id, user_id, encrypted_by, encrypted_key) VALUES
			($1, $2, $2, 'owner-v1'), ($1, $3, $2, 'target-v1')
	`, conversationID, ownerID, targetID); err != nil {
		t.Fatalf("seed legacy projection: %v", err)
	}

	handler := &UserHandler{pool: pool}
	request := httptest.NewRequest("DELETE", "/api/v1/admin/users/"+targetID, nil)
	if err := handler.deleteUserAccount(request, targetID); !errors.Is(err, errUserBelongsToEncryptedGroup) {
		t.Fatalf("delete before rotation error = %v, want encrypted-group conflict", err)
	}

	rotation, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin rotation: %v", err)
	}
	defer rotation.Rollback(ctx)
	for _, statement := range []struct {
		query string
		args  []any
	}{
		{`SELECT id FROM conversations WHERE id=$1 FOR UPDATE`, []any{conversationID}},
		{`DELETE FROM members WHERE conversation_id=$1 AND user_id=$2`, []any{conversationID, targetID}},
		{`INSERT INTO group_key_epochs (conversation_id, epoch, created_by) VALUES ($1, 2, $2)`, []any{conversationID, ownerID}},
		{`INSERT INTO group_key_copies (conversation_id, epoch, user_id, encrypted_by, encryptor_public_key, encrypted_key)
		  VALUES ($1, 2, $2, $2, 'OWNERKEY', 'owner-v2')`, []any{conversationID, ownerID}},
		{`DELETE FROM group_keys WHERE conversation_id=$1`, []any{conversationID}},
		{`INSERT INTO group_keys (conversation_id, user_id, encrypted_by, encrypted_key)
		  VALUES ($1, $2, $2, 'owner-v2')`, []any{conversationID, ownerID}},
		{`UPDATE conversations SET current_group_key_epoch=2 WHERE id=$1`, []any{conversationID}},
	} {
		if _, err := rotation.Exec(ctx, statement.query, statement.args...); err != nil {
			t.Fatalf("rotate membership with %q: %v", statement.query, err)
		}
	}
	if err := rotation.Commit(ctx); err != nil {
		t.Fatalf("commit rotation: %v", err)
	}

	if err := handler.deleteUserAccount(request, targetID); err != nil {
		t.Fatalf("delete after rotated removal: %v", err)
	}
	var targetExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id=$1)`, targetID).Scan(&targetExists); err != nil {
		t.Fatalf("inspect deleted target: %v", err)
	}
	if targetExists {
		t.Fatal("target still exists after rotated removal and deletion")
	}
}
