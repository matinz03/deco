package db

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

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

func isolatedOwnershipPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	base := testPool(t)
	ctx := context.Background()
	schema := fmt.Sprintf("ownership_test_%d", time.Now().UnixNano())
	if _, err := base.Exec(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create isolated schema: %v", err)
	}
	t.Cleanup(func() {
		_, _ = base.Exec(context.Background(), `DROP SCHEMA IF EXISTS `+schema+` CASCADE`)
	})

	cfg, err := pgxpool.ParseConfig(os.Getenv("DECO_TEST_DATABASE_URL"))
	if err != nil {
		t.Fatalf("parse isolated pool config: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	t.Cleanup(pool.Close)

	if _, err := pool.Exec(ctx, `
		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			clerk_user_id TEXT UNIQUE,
			is_admin BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL
		)
	`); err != nil {
		t.Fatalf("create isolated users table: %v", err)
	}
	return pool
}

func TestEnsureUserOwnershipPreservesOldestUser(t *testing.T) {
	pool := isolatedOwnershipPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users (id, clerk_user_id, is_admin, created_at) VALUES
		('later', 'user_later', FALSE, '2025-01-02T00:00:00Z'),
		('oldest', 'user_owner', FALSE, '2025-01-01T00:00:00Z')
	`); err != nil {
		t.Fatalf("seed legacy users: %v", err)
	}

	for run := 1; run <= 2; run++ {
		if err := ensureUserOwnership(ctx, pool); err != nil {
			t.Fatalf("ensure ownership run %d: %v", run, err)
		}
	}

	var ownerID string
	var ownerIsAdmin bool
	if err := pool.QueryRow(ctx, `SELECT id, is_admin FROM users WHERE is_owner`).Scan(&ownerID, &ownerIsAdmin); err != nil {
		t.Fatalf("read migrated owner: %v", err)
	}
	if ownerID != "oldest" || !ownerIsAdmin {
		t.Fatalf("migrated owner = %q admin=%v, want oldest admin=true", ownerID, ownerIsAdmin)
	}

	if _, err := pool.Exec(ctx, `UPDATE users SET is_owner=TRUE WHERE id='later'`); err == nil {
		t.Fatal("second persisted owner was accepted")
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET is_admin=FALSE WHERE id='oldest'`); err == nil {
		t.Fatal("persisted owner was demoted")
	}
}

func TestEnsureUserOwnershipDoesNotPromoteFreshSchemaUser(t *testing.T) {
	pool := isolatedOwnershipPool(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		ALTER TABLE users ADD COLUMN is_owner BOOLEAN NOT NULL DEFAULT FALSE;
		INSERT INTO users (id, clerk_user_id, is_admin, created_at)
		VALUES ('non-owner', 'user_non_owner', FALSE, NOW())
	`); err != nil {
		t.Fatalf("seed fresh-schema user: %v", err)
	}

	if err := ensureUserOwnership(ctx, pool); err != nil {
		t.Fatalf("ensure ownership: %v", err)
	}

	var ownerCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE is_owner`).Scan(&ownerCount); err != nil {
		t.Fatalf("count owners: %v", err)
	}
	if ownerCount != 0 {
		t.Fatalf("fresh-schema owner count = %d, want 0", ownerCount)
	}
	if err := ValidateClerkOwner(ctx, pool, "user_owner"); err != nil {
		t.Fatalf("ownerless fresh schema rejected before owner bootstrap: %v", err)
	}
}

func TestValidateClerkOwner(t *testing.T) {
	t.Run("empty database may await configured owner", func(t *testing.T) {
		pool := isolatedOwnershipPool(t)
		if err := ensureUserOwnership(context.Background(), pool); err != nil {
			t.Fatalf("ensure ownership: %v", err)
		}
		if err := ValidateClerkOwner(context.Background(), pool, "user_owner"); err != nil {
			t.Fatalf("empty database rejected: %v", err)
		}
	})

	t.Run("matching owner succeeds", func(t *testing.T) {
		pool := isolatedOwnershipPool(t)
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, clerk_user_id, is_admin, created_at) VALUES ('owner', 'user_owner', TRUE, NOW())`); err != nil {
			t.Fatalf("seed owner: %v", err)
		}
		if err := ensureUserOwnership(ctx, pool); err != nil {
			t.Fatalf("ensure ownership: %v", err)
		}
		if err := ValidateClerkOwner(ctx, pool, "user_owner"); err != nil {
			t.Fatalf("matching owner rejected: %v", err)
		}
		if err := ValidateClerkOwner(ctx, pool, "user_someone_else"); err == nil {
			t.Fatal("mismatched configured owner was accepted")
		}
	})

	t.Run("unlinked legacy owner fails closed", func(t *testing.T) {
		pool := isolatedOwnershipPool(t)
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, is_admin, created_at) VALUES ('owner', TRUE, NOW())`); err != nil {
			t.Fatalf("seed owner: %v", err)
		}
		if err := ensureUserOwnership(ctx, pool); err != nil {
			t.Fatalf("ensure ownership: %v", err)
		}
		if err := ValidateClerkOwner(ctx, pool, "user_owner"); err == nil {
			t.Fatal("unlinked legacy owner was accepted")
		}
	})
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

// A legacy group has one mutable key row per member and no epoch metadata.
// Migration must preserve those copies as immutable epoch 1 and tag existing
// encrypted messages so clients can keep decrypting them after later rotation.
func TestEnsureSchemaMigratesCompleteLegacyGroupKeys(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("prepare current schema: %v", err)
	}
	ctx := context.Background()
	ownerID := seedUser(t, pool, "schema_group_epoch_owner")
	memberID := seedUser(t, pool, "schema_group_epoch_member")

	var conversationID, messageID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO conversations (type, name, created_by_id)
		VALUES ('group', 'Epoch migration', $1) RETURNING id
	`, ownerID).Scan(&conversationID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM conversations WHERE id=$1`, conversationID)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO members (conversation_id, user_id, role)
		VALUES ($1, $2, 'owner'), ($1, $3, 'member')
	`, conversationID, ownerID, memberID); err != nil {
		t.Fatalf("seed members: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_keys (conversation_id, user_id, encrypted_by, encrypted_key)
		VALUES ($1, $2, $2, 'owner-copy'), ($1, $3, $2, 'member-copy')
	`, conversationID, ownerID, memberID); err != nil {
		t.Fatalf("seed legacy key copies: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO messages (conversation_id, sender_id, type, encrypted_content)
		VALUES ($1, $2, 'text', 'ciphertext') RETURNING id
	`, conversationID, ownerID).Scan(&messageID); err != nil {
		t.Fatalf("seed legacy message: %v", err)
	}

	t.Setenv("DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION", "0")
	if err := EnsureSchema(pool); err == nil || !strings.Contains(err.Error(), "drained deployment") {
		t.Fatalf("unguarded legacy migration error = %v, want drained-deployment gate", err)
	}
	t.Setenv("DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION", "1")
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("migrate legacy group keys: %v", err)
	}

	var currentEpoch int64
	if err := pool.QueryRow(ctx, `
		SELECT current_group_key_epoch FROM conversations WHERE id=$1
	`, conversationID).Scan(&currentEpoch); err != nil {
		t.Fatalf("read current epoch: %v", err)
	}
	if currentEpoch != 1 {
		t.Fatalf("current epoch = %d, want 1", currentEpoch)
	}

	var copyCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM group_key_copies
		WHERE conversation_id=$1 AND epoch=1 AND encryptor_public_key='ORIGINALKEY'
	`, conversationID).Scan(&copyCount); err != nil {
		t.Fatalf("count migrated key copies: %v", err)
	}
	if copyCount != 2 {
		t.Fatalf("migrated key copies = %d, want 2", copyCount)
	}

	var messageEpoch *int64
	if err := pool.QueryRow(ctx, `
		SELECT group_key_epoch FROM messages WHERE id=$1
	`, messageID).Scan(&messageEpoch); err != nil {
		t.Fatalf("read migrated message epoch: %v", err)
	}
	if messageEpoch == nil || *messageEpoch != 1 {
		t.Fatalf("message epoch = %v, want 1", messageEpoch)
	}

	// Simulate an epoch-2 add and its legacy current-key projection, then boot
	// again. The migration must never copy epoch-2 ciphertext backward into the
	// immutable epoch-1 history.
	newMemberID := seedUser(t, pool, "schema_group_epoch_new_member")
	if _, err := pool.Exec(ctx,
		`INSERT INTO members (conversation_id, user_id, role) VALUES ($1, $2, 'member')`,
		conversationID, newMemberID); err != nil {
		t.Fatalf("seed epoch-2 member: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO group_key_epochs (conversation_id, epoch, created_by) VALUES ($1, 2, $2)`,
		conversationID, ownerID); err != nil {
		t.Fatalf("seed epoch-2 record: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_key_copies (
			conversation_id, epoch, user_id, encrypted_by, encryptor_public_key, encrypted_key
		) VALUES
			($1, 2, $2, $2, 'ORIGINALKEY', 'owner-v2'),
			($1, 2, $3, $2, 'ORIGINALKEY', 'member-v2'),
			($1, 2, $4, $2, 'ORIGINALKEY', 'new-member-v2')
	`, conversationID, ownerID, memberID, newMemberID); err != nil {
		t.Fatalf("seed epoch-2 copies: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM group_keys WHERE conversation_id=$1`, conversationID); err != nil {
		t.Fatalf("replace legacy projection: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_keys (conversation_id, user_id, encrypted_by, encrypted_key) VALUES
			($1, $2, $2, 'owner-v2'),
			($1, $3, $2, 'member-v2'),
			($1, $4, $2, 'new-member-v2')
	`, conversationID, ownerID, memberID, newMemberID); err != nil {
		t.Fatalf("seed epoch-2 legacy projection: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE conversations SET current_group_key_epoch=2 WHERE id=$1`, conversationID); err != nil {
		t.Fatalf("activate epoch 2: %v", err)
	}

	var postRotationLegacyMessageID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO messages (conversation_id, sender_id, type, encrypted_content)
		VALUES ($1, $2, 'text', 'legacy-after-rotation') RETURNING id
	`, conversationID, ownerID).Scan(&postRotationLegacyMessageID); err != nil {
		t.Fatalf("seed post-rotation legacy message: %v", err)
	}
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema after epoch 2: %v", err)
	}

	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM group_key_copies WHERE conversation_id=$1 AND epoch=1
	`, conversationID).Scan(&copyCount); err != nil {
		t.Fatalf("count epoch-1 copies after restart: %v", err)
	}
	if copyCount != 2 {
		t.Fatalf("epoch-1 copies after restart = %d, want 2", copyCount)
	}
	messageEpoch = nil
	if err := pool.QueryRow(ctx, `
		SELECT group_key_epoch FROM messages WHERE id=$1
	`, postRotationLegacyMessageID).Scan(&messageEpoch); err != nil {
		t.Fatalf("read post-rotation legacy message epoch: %v", err)
	}
	if messageEpoch != nil {
		t.Fatalf("post-rotation legacy message was mislabeled epoch %d", *messageEpoch)
	}
}

func TestGroupKeyEpochTablesRejectDirectMutation(t *testing.T) {
	pool := testPool(t)
	if err := EnsureSchema(pool); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	ctx := context.Background()
	ownerID := seedUser(t, pool, "schema_group_immutable_owner")
	distributorID := seedUser(t, pool, "schema_group_immutable_distributor")

	var conversationID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO conversations (type, name, created_by_id, current_group_key_epoch)
		VALUES ('group', 'Immutable epoch', $1, 1) RETURNING id
	`, ownerID).Scan(&conversationID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM conversations WHERE id=$1`, conversationID)
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`,
		conversationID, ownerID); err != nil {
		t.Fatalf("seed owner membership: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO group_key_epochs (conversation_id, epoch, created_by) VALUES ($1, 1, $2)`,
		conversationID, distributorID); err != nil {
		t.Fatalf("seed epoch: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO group_key_copies (
			conversation_id, epoch, user_id, encrypted_by, encryptor_public_key, encrypted_key
		) VALUES ($1, 1, $2, $3, 'ORIGINALKEY', 'ciphertext')
	`, conversationID, ownerID, distributorID); err != nil {
		t.Fatalf("seed epoch copy: %v", err)
	}

	for name, statement := range map[string]string{
		"update epoch": `UPDATE group_key_epochs SET created_at=NOW() WHERE conversation_id=$1 AND epoch=1`,
		"delete epoch": `DELETE FROM group_key_epochs WHERE conversation_id=$1 AND epoch=1`,
		"update copy":  `UPDATE group_key_copies SET encrypted_key='tampered' WHERE conversation_id=$1 AND epoch=1`,
		"delete copy":  `DELETE FROM group_key_copies WHERE conversation_id=$1 AND epoch=1`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := pool.Exec(ctx, statement, conversationID); err == nil {
				t.Fatalf("direct mutation succeeded: %s", statement)
			}
		})
	}

	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, distributorID); err != nil {
		t.Fatalf("FK nulling was blocked by append-only guards: %v", err)
	}
	var epochCreatorCleared, copyEncryptorCleared bool
	if err := pool.QueryRow(ctx, `
		SELECT e.created_by IS NULL, c.encrypted_by IS NULL
		FROM group_key_epochs e
		JOIN group_key_copies c
		  ON c.conversation_id=e.conversation_id AND c.epoch=e.epoch
		WHERE e.conversation_id=$1 AND e.epoch=1
	`, conversationID).Scan(&epochCreatorCleared, &copyEncryptorCleared); err != nil {
		t.Fatalf("read FK-nulled key records: %v", err)
	}
	if !epochCreatorCleared || !copyEncryptorCleared {
		t.Fatalf("FK nulling incomplete: epoch creator=%v copy encryptor=%v", epochCreatorCleared, copyEncryptorCleared)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM conversations WHERE id=$1`, conversationID); err != nil {
		t.Fatalf("conversation cascade was blocked by append-only guards: %v", err)
	}
	var remainingEpochs, remainingCopies int
	if err := pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FROM group_key_epochs WHERE conversation_id=$1),
		  (SELECT count(*) FROM group_key_copies WHERE conversation_id=$1)
	`, conversationID).Scan(&remainingEpochs, &remainingCopies); err != nil {
		t.Fatalf("count cascaded key records: %v", err)
	}
	if remainingEpochs != 0 || remainingCopies != 0 {
		t.Fatalf("cascade left epochs=%d copies=%d", remainingEpochs, remainingCopies)
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
