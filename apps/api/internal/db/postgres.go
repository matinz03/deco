package db

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = time.Hour
	config.MaxConnIdleTime = 30 * time.Minute
	config.HealthCheckPeriod = time.Minute

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}

	return pool, nil
}

func EnsureSchema(pool *pgxpool.Pool) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_enum
				WHERE enumlabel = 'saved'
				  AND enumtypid = 'conversation_type'::regtype
			) THEN
				ALTER TYPE conversation_type ADD VALUE 'saved';
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_enum
				WHERE enumlabel = 'poll'
				  AND enumtypid = 'message_type'::regtype
			) THEN
				ALTER TYPE message_type ADD VALUE 'poll';
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_enum
				WHERE enumlabel = 'sticker'
				  AND enumtypid = 'message_type'::regtype
			) THEN
				ALTER TYPE message_type ADD VALUE 'sticker';
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_enum
				WHERE enumlabel = 'location'
				  AND enumtypid = 'message_type'::regtype
			) THEN
				ALTER TYPE message_type ADD VALUE 'location';
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_enum
				WHERE enumlabel = 'contact'
				  AND enumtypid = 'message_type'::regtype
			) THEN
				ALTER TYPE message_type ADD VALUE 'contact';
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sticker_pack_source') THEN
				CREATE TYPE sticker_pack_source AS ENUM ('deco', 'telegram');
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sticker_format') THEN
				CREATE TYPE sticker_format AS ENUM ('static', 'animated', 'video');
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		ALTER TABLE users
		ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		ALTER TABLE users
		ADD COLUMN IF NOT EXISTS restricted_actions TEXT[] NOT NULL DEFAULT '{}'
	`)
	if err != nil {
		return err
	}

	if err := ensureClerkIdentityColumns(ctx, pool); err != nil {
		return err
	}

	if err := ensureUserOwnership(ctx, pool); err != nil {
		return err
	}

	if err := ensureSavedConversationUniqueness(ctx, pool); err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS user_key_backups (
			user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
			version INTEGER NOT NULL,
			kdf TEXT NOT NULL,
			iterations INTEGER NOT NULL,
			salt TEXT NOT NULL,
			cipher TEXT NOT NULL,
			iv TEXT NOT NULL,
			ciphertext TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_key_backups_updated_at'
			) THEN
				CREATE TRIGGER trg_user_key_backups_updated_at
				  BEFORE UPDATE ON user_key_backups
				  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	// Message-media metadata is needed by both the media registry backfill and
	// every message query below. Add it before reading any of those columns so
	// databases created by older releases can upgrade in one boot.
	_, err = pool.Exec(ctx, `
		ALTER TABLE conversations
		ADD COLUMN IF NOT EXISTS current_group_key_epoch BIGINT NOT NULL DEFAULT 0
	`)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'conversations_group_key_epoch_nonnegative'
			) THEN
				ALTER TABLE conversations ADD CONSTRAINT conversations_group_key_epoch_nonnegative
				CHECK (current_group_key_epoch >= 0);
			END IF;
		END $$
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		ALTER TABLE messages
		ADD COLUMN IF NOT EXISTS media_name TEXT,
		ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
		ADD COLUMN IF NOT EXISTS media_size BIGINT,
		ADD COLUMN IF NOT EXISTS media_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS group_key_epoch BIGINT
	`)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `
		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint WHERE conname = 'messages_group_key_epoch_positive'
			) THEN
				ALTER TABLE messages ADD CONSTRAINT messages_group_key_epoch_positive
				CHECK (group_key_epoch > 0);
			END IF;
		END $$
	`)
	if err != nil {
		return err
	}

	// Media objects bind an unguessable storage path to its uploader. This is
	// the authorization anchor for private message-attachment tickets.
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS media_objects (
			storage_path TEXT PRIMARY KEY,
			owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			kind         TEXT NOT NULL,
			encrypted    BOOLEAN NOT NULL DEFAULT FALSE,
			original_name TEXT NOT NULL DEFAULT '',
			mime_type     TEXT NOT NULL DEFAULT 'application/octet-stream',
			size          BIGINT NOT NULL DEFAULT 0,
			created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	// Versioned, immutable group-key copies preserve historical decryption and
	// make rotations atomic. The legacy group_keys table remains below as a
	// current-key projection for rollback and old readers.
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_key_epochs (
			conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			epoch           BIGINT NOT NULL CHECK (epoch > 0),
			created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (conversation_id, epoch)
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_key_copies (
			conversation_id      UUID NOT NULL,
			epoch                BIGINT NOT NULL,
			user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			encrypted_by         UUID REFERENCES users(id) ON DELETE SET NULL,
			encryptor_public_key TEXT NOT NULL,
			encrypted_key        TEXT NOT NULL,
			created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (conversation_id, epoch, user_id),
			FOREIGN KEY (conversation_id, epoch)
				REFERENCES group_key_epochs(conversation_id, epoch) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_group_key_copies_user
		ON group_key_copies(user_id, conversation_id, epoch)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		ALTER TABLE media_objects
		ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT FALSE,
		ADD COLUMN IF NOT EXISTS original_name TEXT NOT NULL DEFAULT '',
		ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
		ADD COLUMN IF NOT EXISTS size BIGINT NOT NULL DEFAULT 0
	`)
	if err != nil {
		return err
	}

	// Preserve access to existing locally stored message attachments. New
	// uploads are inserted by the upload handler; this only migrates rows that
	// already reference one of the private message directories.
	_, err = pool.Exec(ctx, `
		WITH candidates AS (
			SELECT DISTINCT ON (storage_path)
				storage_path, sender_id, message_type
			FROM (
				SELECT
					regexp_replace(m.media_url, '^.*(messages/(images|videos|audio|files)/[^?]+).*$','\1') AS storage_path,
					m.sender_id,
					m.type::text AS message_type,
					m.sent_at,
					m.id
				FROM messages m
				WHERE m.media_url ~ 'messages/(images|videos|audio|files)/'
			) legacy
			ORDER BY storage_path, sent_at, id
		)
		INSERT INTO media_objects (storage_path, owner_id, kind)
		SELECT storage_path, sender_id, message_type
		FROM candidates
		ON CONFLICT (storage_path) DO NOTHING
	`)
	if err != nil {
		return err
	}

	// Group encryption keys: one encrypted copy of the group key per member.
	// encrypted_key  = group key encrypted with ECDH(encryptor_private, member_public)
	// encrypted_by   = user_id of the person who encrypted this copy (so recipient knows whose public key to use)
	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_keys (
			conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			encrypted_by    UUID NOT NULL REFERENCES users(id),
			encrypted_key   TEXT NOT NULL,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (conversation_id, user_id)
		)
	`)

	if err != nil {
		return err
	}

	// Migrate the mutable legacy projection into immutable epoch 1. Take the
	// conversation lock first and wait for in-flight rotations before locking
	// legacy writes, so no binary can change a copy between snapshot/activation.
	var needsLegacyGroupKeyMigration bool
	if err = pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM conversations c
			JOIN group_keys gk ON gk.conversation_id = c.id
			WHERE c.current_group_key_epoch = 0
		)
	`).Scan(&needsLegacyGroupKeyMigration); err != nil {
		return err
	}
	if needsLegacyGroupKeyMigration {
		if os.Getenv("DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION") != "1" {
			return errors.New("legacy group keys require a drained deployment; stop old API instances, set DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION=1 for one boot, then unset it")
		}
		migrationTx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer migrationTx.Rollback(ctx)
		if _, err = migrationTx.Exec(ctx, `
		LOCK TABLE conversations IN ACCESS EXCLUSIVE MODE;
		LOCK TABLE group_keys IN SHARE MODE;
	`); err != nil {
			return err
		}
		_, err = migrationTx.Exec(ctx, `
		INSERT INTO group_key_epochs (conversation_id, epoch, created_by, created_at)
		SELECT DISTINCT ON (c.id)
			c.id, 1, gk.encrypted_by, gk.created_at
		FROM conversations c
		JOIN group_keys gk ON gk.conversation_id = c.id
		JOIN users distributor ON distributor.id = gk.encrypted_by
		WHERE c.type = 'group'
		  AND c.current_group_key_epoch = 0
		  AND distributor.public_key <> ''
		  AND NOT EXISTS (
			SELECT 1
			FROM members m
			LEFT JOIN group_keys member_key
			  ON member_key.conversation_id = m.conversation_id
			 AND member_key.user_id = m.user_id
			LEFT JOIN users member_distributor ON member_distributor.id = member_key.encrypted_by
			WHERE m.conversation_id = c.id
			  AND (member_key.user_id IS NULL OR member_distributor.public_key = '')
		  )
		ORDER BY c.id, gk.created_at, gk.user_id
		ON CONFLICT (conversation_id, epoch) DO NOTHING
	`)
		if err != nil {
			return err
		}

		_, err = migrationTx.Exec(ctx, `
		INSERT INTO group_key_copies (
			conversation_id, epoch, user_id, encrypted_by,
			encryptor_public_key, encrypted_key, created_at
		)
		SELECT gk.conversation_id, 1, gk.user_id, gk.encrypted_by,
			u.public_key, gk.encrypted_key, gk.created_at
		FROM group_keys gk
		JOIN conversations c
		  ON c.id = gk.conversation_id AND c.current_group_key_epoch = 0
		JOIN members m
		  ON m.conversation_id = gk.conversation_id AND m.user_id = gk.user_id
		JOIN group_key_epochs e
		  ON e.conversation_id = gk.conversation_id AND e.epoch = 1
		JOIN users u ON u.id = gk.encrypted_by
		ON CONFLICT (conversation_id, epoch, user_id) DO NOTHING
	`)
		if err != nil {
			return err
		}

		_, err = migrationTx.Exec(ctx, `
		UPDATE conversations c
		SET current_group_key_epoch = 1
		WHERE current_group_key_epoch = 0
		  AND EXISTS (
			SELECT 1 FROM group_key_epochs e
			WHERE e.conversation_id = c.id AND e.epoch = 1
		  )
		  AND NOT EXISTS (
			SELECT 1
			FROM members m
			LEFT JOIN group_key_copies copy
			  ON copy.conversation_id = m.conversation_id
			 AND copy.epoch = 1
			 AND copy.user_id = m.user_id
			WHERE m.conversation_id = c.id AND copy.user_id IS NULL
		  )
	`)
		if err != nil {
			return err
		}

		_, err = migrationTx.Exec(ctx, `
		UPDATE messages m
		SET group_key_epoch = 1
		FROM conversations c
		WHERE c.id = m.conversation_id
		  AND c.type = 'group'
		  AND c.current_group_key_epoch = 1
		  AND m.type IN ('text', 'image', 'video', 'audio', 'file', 'location', 'contact')
		  AND m.group_key_epoch IS NULL
	`)
		if err != nil {
			return err
		}
		if err = migrationTx.Commit(ctx); err != nil {
			return err
		}
	}
	if err := ensureGroupKeyImmutability(ctx, pool); err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sticker_packs (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			slug TEXT NOT NULL UNIQUE,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			source sticker_pack_source NOT NULL DEFAULT 'deco',
			telegram_set_name TEXT,
			cover_sticker_id UUID,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_sticker_packs_owner_id ON sticker_packs(owner_id)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_sticker_packs_source ON sticker_packs(source)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		DECLARE constraint_name text;
		BEGIN
			SELECT con.conname
			INTO constraint_name
			FROM pg_constraint con
			JOIN pg_class rel ON rel.oid = con.conrelid
			JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
			WHERE rel.relname = 'sticker_packs'
			  AND nsp.nspname = current_schema()
			  AND con.contype = 'u'
			  AND pg_get_constraintdef(con.oid) LIKE '%telegram_set_name%';

			IF constraint_name IS NOT NULL THEN
				EXECUTE format('ALTER TABLE sticker_packs DROP CONSTRAINT %I', constraint_name);
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE UNIQUE INDEX IF NOT EXISTS idx_sticker_packs_owner_set_name
		ON sticker_packs(owner_id, telegram_set_name)
		WHERE telegram_set_name IS NOT NULL
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS stickers (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			pack_id UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			emoji TEXT NOT NULL DEFAULT '',
			asset_url TEXT NOT NULL,
			thumbnail_url TEXT,
			mime_type TEXT NOT NULL,
			format sticker_format NOT NULL DEFAULT 'static',
			width INTEGER,
			height INTEGER,
			telegram_file_id TEXT,
			telegram_unique_file_id TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_stickers_pack_id ON stickers(pack_id, sort_order, created_at)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE UNIQUE INDEX IF NOT EXISTS idx_stickers_pack_sort_order ON stickers(pack_id, sort_order)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sticker_packs_updated_at'
			) THEN
				CREATE TRIGGER trg_sticker_packs_updated_at
				  BEFORE UPDATE ON sticker_packs
				  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS polls (
			message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
			question TEXT NOT NULL,
			allows_multiple BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS poll_options (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			message_id UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
			text TEXT NOT NULL,
			position INTEGER NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_poll_options_message_id ON poll_options(message_id, position)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS poll_votes (
			message_id UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
			option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (message_id, user_id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_poll_votes_option_id ON poll_votes(option_id)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_leadership_cycles (
			conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
			objection_cooldown_until TIMESTAMPTZ,
			election_started_at TIMESTAMPTZ,
			election_ends_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_leadership_objections (
			conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (conversation_id, user_id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS group_leadership_votes (
			conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
			voter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			candidate_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (conversation_id, voter_user_id)
		)
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_leadership_cycles_updated_at'
			) THEN
				CREATE TRIGGER trg_group_leadership_cycles_updated_at
				  BEFORE UPDATE ON group_leadership_cycles
				  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
			END IF;
		END $$;
	`)
	if err != nil {
		return err
	}

	_, err = pool.Exec(ctx, `
		ALTER TABLE messages
		ADD COLUMN IF NOT EXISTS sticker_id UUID
	`)

	return err
}

// ensureUserOwnership persists the platform owner without changing who owns an
// existing installation. The compatibility backfill selects the same
// (created_at, id) row that older binaries computed on every user query.
func ensureUserOwnership(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`); err != nil {
		return err
	}
	var ownershipColumnExisted bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = current_schema()
			  AND table_name = 'users'
			  AND column_name = 'is_owner'
		)
	`).Scan(&ownershipColumnExisted); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		ALTER TABLE users
		ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE
	`); err != nil {
		return err
	}
	if !ownershipColumnExisted {
		if _, err := tx.Exec(ctx, `
			WITH oldest AS (
				SELECT id
				FROM users
				ORDER BY created_at ASC, id ASC
				LIMIT 1
			)
			UPDATE users u
			SET is_owner = TRUE,
			    is_admin = TRUE
			FROM oldest
			WHERE u.id = oldest.id
		`); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner_key
		ON users ((1))
		WHERE is_owner
	`); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'users_owner_must_be_admin'
				  AND conrelid = 'users'::regclass
			) THEN
				ALTER TABLE users
				ADD CONSTRAINT users_owner_must_be_admin
				CHECK (NOT is_owner OR is_admin);
			END IF;
		END $$
	`); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// ValidateClerkOwner fails closed when configured managed identity disagrees
// with persisted ownership. Ownership transfer is never an automatic boot
// migration because that would silently grant platform control.
func ValidateClerkOwner(ctx context.Context, pool *pgxpool.Pool, configuredClerkUserID string) error {
	var persistedClerkUserID *string
	err := pool.QueryRow(ctx, `SELECT clerk_user_id FROM users WHERE is_owner`).Scan(&persistedClerkUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Fresh Clerk databases may contain ordinary users before the configured
		// owner signs in. The verified owner subject is promoted transactionally
		// by profile bootstrap; signup order must never decide ownership.
		return nil
	}
	if err != nil {
		return err
	}
	if persistedClerkUserID == nil || strings.TrimSpace(*persistedClerkUserID) == "" {
		return fmt.Errorf("persisted platform owner is not linked to a Clerk user")
	}
	if *persistedClerkUserID != configuredClerkUserID {
		return fmt.Errorf("CLERK_OWNER_USER_ID does not match the persisted platform owner")
	}
	return nil
}

// ensureClerkIdentityColumns adds the external-identity column and the
// public-key protections that the managed-auth path depends on.
//
// Deliberately NOT done here: anything that touches users.id. The internal UUID
// stays the primary key and stays the target of every foreign key. clerk_user_id
// is a nullable secondary lookup column, so rows created by the legacy
// register/login path keep working with it set to NULL.
func ensureGroupKeyImmutability(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION deco_guard_group_key_epoch_update()
		RETURNS TRIGGER AS $$
		BEGIN
			IF pg_trigger_depth() > 1
			   AND OLD.created_by IS NOT NULL
			   AND NEW.created_by IS NULL
			   AND ROW(NEW.conversation_id, NEW.epoch, NEW.created_at)
			       IS NOT DISTINCT FROM
			       ROW(OLD.conversation_id, OLD.epoch, OLD.created_at) THEN
				RETURN NEW;
			END IF;
			RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
		END;
		$$ LANGUAGE plpgsql;

		CREATE OR REPLACE FUNCTION deco_guard_group_key_copy_update()
		RETURNS TRIGGER AS $$
		BEGIN
			IF pg_trigger_depth() > 1
			   AND OLD.encrypted_by IS NOT NULL
			   AND NEW.encrypted_by IS NULL
			   AND ROW(NEW.conversation_id, NEW.epoch, NEW.user_id,
			           NEW.encryptor_public_key, NEW.encrypted_key, NEW.created_at)
			       IS NOT DISTINCT FROM
			       ROW(OLD.conversation_id, OLD.epoch, OLD.user_id,
			           OLD.encryptor_public_key, OLD.encrypted_key, OLD.created_at) THEN
				RETURN NEW;
			END IF;
			RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
		END;
		$$ LANGUAGE plpgsql;
	`); err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_key_epochs_append_only') THEN
				CREATE TRIGGER trg_group_key_epochs_append_only
				  BEFORE UPDATE ON group_key_epochs
				  FOR EACH ROW EXECUTE FUNCTION deco_guard_group_key_epoch_update();
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_key_epochs_no_direct_delete') THEN
				CREATE TRIGGER trg_group_key_epochs_no_direct_delete
				  BEFORE DELETE ON group_key_epochs
				  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_key_copies_append_only') THEN
				CREATE TRIGGER trg_group_key_copies_append_only
				  BEFORE UPDATE ON group_key_copies
				  FOR EACH ROW EXECUTE FUNCTION deco_guard_group_key_copy_update();
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_group_key_copies_no_direct_delete') THEN
				CREATE TRIGGER trg_group_key_copies_no_direct_delete
				  BEFORE DELETE ON group_key_copies
				  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();
			END IF;
		END $$;
	`); err != nil {
		return err
	}
	return nil
}

func ensureClerkIdentityColumns(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		ALTER TABLE users
		ADD COLUMN IF NOT EXISTS clerk_user_id TEXT
	`); err != nil {
		return err
	}

	// A partial-free UNIQUE index rather than a UNIQUE constraint: ALTER TABLE
	// ... ADD CONSTRAINT has no IF NOT EXISTS, and this must be re-runnable at
	// every boot. NULLs are not compared, so legacy rows are unaffected.
	if _, err := pool.Exec(ctx, `
		CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_key
		ON users (clerk_user_id)
	`); err != nil {
		return err
	}

	// Append-only audit of every public key ever written for a user: no UPDATE,
	// and no direct DELETE (both enforced by triggers below).
	// ON DELETE CASCADE so that deleting a user (users.go admin delete) still
	// works; the guarantee is that no one can rewrite or quietly erase the key
	// history of a user who still exists, not that a user cannot be removed.
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS user_public_key_audit (
			id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			clerk_user_id TEXT,
			public_key    TEXT NOT NULL,
			source        TEXT NOT NULL,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		CREATE INDEX IF NOT EXISTS idx_user_public_key_audit_user_id
		ON user_public_key_audit (user_id, created_at DESC)
	`); err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION deco_reject_row_update()
		RETURNS TRIGGER AS $$
		BEGIN
			RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
		END;
		$$ LANGUAGE plpgsql;
	`); err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_public_key_audit_append_only'
			) THEN
				CREATE TRIGGER trg_user_public_key_audit_append_only
				  BEFORE UPDATE ON user_public_key_audit
				  FOR EACH ROW EXECUTE FUNCTION deco_reject_row_update();
			END IF;
		END $$;
	`); err != nil {
		return err
	}

	// Blocking UPDATE alone left the table's own error message ("is append-only")
	// untrue: a direct DELETE removed audit rows silently, so anyone able to
	// rewrite a public key could also erase the evidence that they had. The
	// depth check distinguishes a direct statement (depth 1) from the FK
	// ON DELETE CASCADE above (depth > 1), so admin user-deletion still works
	// while `DELETE FROM user_public_key_audit` is refused.
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION deco_reject_direct_row_delete()
		RETURNS TRIGGER AS $$
		BEGIN
			IF pg_trigger_depth() <= 1 THEN
				RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
			END IF;
			RETURN OLD;
		END;
		$$ LANGUAGE plpgsql;
	`); err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_public_key_audit_no_delete'
			) THEN
				CREATE TRIGGER trg_user_public_key_audit_no_delete
				  BEFORE DELETE ON user_public_key_audit
				  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();
			END IF;
		END $$;
	`); err != nil {
		return err
	}

	// public_key immutability, enforced by the database rather than by
	// convention. In an E2E product a silently swapped public key is a total
	// compromise of every message sent afterwards, and application-level
	// discipline does not survive the next contributor.
	//
	// This only fires when the value actually changes, so the existing
	// `UPDATE users SET last_seen_at = NOW()` writes are unaffected.
	if _, err := pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION deco_reject_public_key_update()
		RETURNS TRIGGER AS $$
		BEGIN
			IF NEW.public_key IS DISTINCT FROM OLD.public_key THEN
				RAISE EXCEPTION 'users.public_key is immutable (user %)', OLD.id;
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
	`); err != nil {
		return err
	}

	if _, err := pool.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_public_key_immutable'
			) THEN
				CREATE TRIGGER trg_users_public_key_immutable
				  BEFORE UPDATE ON users
				  FOR EACH ROW EXECUTE FUNCTION deco_reject_public_key_update();
			END IF;
		END $$;
	`); err != nil {
		return err
	}

	return nil
}

func ensureSavedConversationUniqueness(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		ALTER TABLE conversations
		ADD COLUMN IF NOT EXISTS saved_for_user_id UUID REFERENCES users(id)
	`); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		WITH saved AS (
			SELECT c.id, m.user_id, c.created_at, COUNT(msg.id) AS message_count
			FROM conversations c
			JOIN members m ON m.conversation_id = c.id
			LEFT JOIN messages msg ON msg.conversation_id = c.id
			WHERE c.type = 'saved'
			GROUP BY c.id, m.user_id, c.created_at
		), ranked AS (
			SELECT id,
				FIRST_VALUE(id) OVER (
					PARTITION BY user_id
					ORDER BY message_count DESC, created_at, id
				) AS canonical_id
			FROM saved
		), duplicates AS (
			SELECT id, canonical_id
			FROM ranked
			WHERE id <> canonical_id
		)
		UPDATE messages msg
		SET conversation_id = duplicates.canonical_id
		FROM duplicates
		WHERE msg.conversation_id = duplicates.id
	`); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		WITH saved AS (
			SELECT c.id, m.user_id, c.created_at, COUNT(msg.id) AS message_count
			FROM conversations c
			JOIN members m ON m.conversation_id = c.id
			LEFT JOIN messages msg ON msg.conversation_id = c.id
			WHERE c.type = 'saved'
			GROUP BY c.id, m.user_id, c.created_at
		), ranked AS (
			SELECT id,
				FIRST_VALUE(id) OVER (
					PARTITION BY user_id
					ORDER BY message_count DESC, created_at, id
				) AS canonical_id
			FROM saved
		), duplicates AS (
			SELECT id
			FROM ranked
			WHERE id <> canonical_id
		)
		DELETE FROM conversations c
		USING duplicates
		WHERE c.id = duplicates.id
	`); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE conversations c
		SET saved_for_user_id = m.user_id
		FROM members m
		WHERE c.id = m.conversation_id
		  AND c.type = 'saved'
		  AND c.saved_for_user_id IS NULL
	`); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'conversations_saved_for_user_id_key'
				  AND conrelid = 'conversations'::regclass
			) THEN
				ALTER TABLE conversations
				ADD CONSTRAINT conversations_saved_for_user_id_key UNIQUE (saved_for_user_id);
			END IF;
		END $$;
	`); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
