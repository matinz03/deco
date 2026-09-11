package db

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These exercise the real schema against a real Postgres. They are skipped
// unless DECO_TEST_DATABASE_URL points at a throwaway database, because they
// create and delete rows.
//
//	docker run -d --name deco-test -e POSTGRES_PASSWORD=testpw \
//	  -e POSTGRES_USER=deco -e POSTGRES_DB=deco -p 55432:5432 pgvector/pgvector:pg17
//	DECO_TEST_DATABASE_URL=postgres://deco:testpw@127.0.0.1:55432/deco go test ./internal/db/
//
// The database must already have infra/compose/init.sql applied.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("DECO_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("DECO_TEST_DATABASE_URL not set; skipping schema integration test")
	}
	pool, err := Connect(url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedUser creates a user and returns its id, cleaning up afterwards. The
// cleanup delete also exercises the ON DELETE CASCADE path.
func seedUser(t *testing.T, pool *pgxpool.Pool, username string) string {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE username=$1`, username)

	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO users (username, display_name, password_hash, public_key)
		VALUES ($1, 'Schema Test', 'x', 'ORIGINALKEY') RETURNING id`, username).Scan(&id)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE username=$1`, username)
	})
	return id
}

// EnsureSchema runs on every boot, so applying it twice must be a no-op the
// second time rather than an error.
func TestEnsureSchemaIsIdempotent(t *testing.T) {
	pool := testPool(t)
	for i := 1; i <= 2; i++ {
		if err := EnsureSchema(pool); err != nil {
			t.Fatalf("EnsureSchema run %d: %v", i, err)
		}
	}
}

// Releases before message attachment metadata shipped have none of these
// columns. EnsureSchema must add them before any registry backfill reads the
// messages table. This test deliberately mutates only the configured throwaway
// database and restores the current schema during cleanup.
func TestEnsureSchemaUpgradesLegacyMessageMediaColumns(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("prepare current schema: %v", err)
	}
	t.Cleanup(func() {
		if err := EnsureSchema(pool); err != nil {
			t.Errorf("restore current schema: %v", err)
		}
	})

	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		ALTER TABLE messages
		DROP COLUMN IF EXISTS media_name,
		DROP COLUMN IF EXISTS media_mime_type,
		DROP COLUMN IF EXISTS media_size,
		DROP COLUMN IF EXISTS media_encrypted
	`); err != nil {
		t.Fatalf("simulate legacy messages table: %v", err)
	}

	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema on legacy messages table: %v", err)
	}

	for _, column := range []string{"media_name", "media_mime_type", "media_size", "media_encrypted"} {
		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = current_schema()
				  AND table_name = 'messages'
				  AND column_name = $1
			)
		`, column).Scan(&exists); err != nil {
			t.Fatalf("inspect messages.%s: %v", column, err)
		}
		if !exists {
			t.Errorf("messages.%s was not restored", column)
		}
	}
}

// A public key that can be rewritten defeats end-to-end encryption: swap the
// key, receive everything sent afterwards. The database must refuse it even
// when the caller is the application itself.
func TestPublicKeyIsImmutable(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	ctx := context.Background()
	seedUser(t, pool, "schema_immutable_test")

	_, err := pool.Exec(ctx,
		`UPDATE users SET public_key='ATTACKERKEY' WHERE username='schema_immutable_test'`)
	if err == nil {
		t.Fatal("public_key was rewritten; the immutability trigger did not fire")
	}
	if !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("unexpected error, want an immutability rejection: %v", err)
	}

	var key string
	if err := pool.QueryRow(ctx,
		`SELECT public_key FROM users WHERE username='schema_immutable_test'`).Scan(&key); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if key != "ORIGINALKEY" {
		t.Fatalf("stored key = %q, want ORIGINALKEY", key)
	}
}

// Updating an unrelated column must still work — the trigger fires only when
// public_key actually changes, so ordinary writes like last_seen_at are safe.
func TestUnrelatedColumnUpdateStillWorks(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	seedUser(t, pool, "schema_unrelated_test")

	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET last_seen_at=NOW() WHERE username='schema_unrelated_test'`); err != nil {
		t.Fatalf("unrelated update was rejected: %v", err)
	}
}

// The audit trail is the only way to notice a key substitution after the fact,
// so it must reject both rewriting a row and erasing one. Blocking UPDATE alone
// left DELETE open, which let an attacker remove the evidence.
func TestKeyAuditRejectsUpdateAndDirectDelete(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	ctx := context.Background()
	userID := seedUser(t, pool, "schema_audit_test")

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_public_key_audit (user_id, public_key, source)
		VALUES ($1, 'ORIGINALKEY', 'bootstrap')`, userID); err != nil {
		t.Fatalf("seed audit row: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`UPDATE user_public_key_audit SET public_key='TAMPERED' WHERE user_id=$1`, userID); err == nil {
		t.Fatal("audit row was updated; the append-only trigger did not fire")
	}

	if _, err := pool.Exec(ctx,
		`DELETE FROM user_public_key_audit WHERE user_id=$1`, userID); err == nil {
		t.Fatal("audit row was deleted directly; the append-only guarantee is not enforced")
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_public_key_audit WHERE user_id=$1`, userID).Scan(&count); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("audit rows = %d after tamper attempts, want 1", count)
	}
}

// Deleting a user must still cascade to their audit rows. The delete guard
// distinguishes a direct statement from the foreign key's cascade, so admin
// user-deletion keeps working.
func TestKeyAuditCascadesOnUserDelete(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	ctx := context.Background()
	userID := seedUser(t, pool, "schema_cascade_test")

	if _, err := pool.Exec(ctx, `
		INSERT INTO user_public_key_audit (user_id, public_key, source)
		VALUES ($1, 'ORIGINALKEY', 'bootstrap')`, userID); err != nil {
		t.Fatalf("seed audit row: %v", err)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID); err != nil {
		t.Fatalf("user delete was blocked by the audit delete guard: %v", err)
	}

	var count int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM user_public_key_audit WHERE user_id=$1`, userID).Scan(&count); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("audit rows = %d after user delete, want 0", count)
	}
}
