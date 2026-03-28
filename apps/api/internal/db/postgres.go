package db

import (
	"context"
	"time"

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
		ADD COLUMN IF NOT EXISTS media_name TEXT
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
