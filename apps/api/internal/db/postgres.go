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
		ALTER TABLE messages
		ADD COLUMN IF NOT EXISTS media_name TEXT
	`)

	return err
}
