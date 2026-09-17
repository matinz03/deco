-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- Fast fuzzy text search
CREATE EXTENSION IF NOT EXISTS "vector";     -- pgvector for semantic search (Phase 4)

-- ─── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  phone_number  TEXT UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  clerk_user_id TEXT UNIQUE,                -- external identity; NULL for legacy password users
  public_key    TEXT NOT NULL,              -- X25519 public key for E2E (immutable, see triggers below)
  avatar_url    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  is_owner      BOOLEAN NOT NULL DEFAULT FALSE,
  restricted_actions TEXT[] NOT NULL DEFAULT '{}',
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_owner_must_be_admin CHECK (NOT is_owner OR is_admin)
);

CREATE INDEX idx_users_username_trgm ON users USING gin(username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING gin(display_name gin_trgm_ops);
CREATE UNIQUE INDEX users_single_owner_key ON users ((1)) WHERE is_owner;

-- ─── Conversations ────────────────────────────────────────────────────────────
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel', 'saved');

CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          conversation_type NOT NULL DEFAULT 'direct',
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  created_by_id UUID NOT NULL REFERENCES users(id),
  saved_for_user_id UUID UNIQUE REFERENCES users(id),
  current_group_key_epoch BIGINT NOT NULL DEFAULT 0 CHECK (current_group_key_epoch >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_created_by ON conversations(created_by_id);
CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);

-- ─── Members ─────────────────────────────────────────────────────────────────
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE members (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            member_role NOT NULL DEFAULT 'member',
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_members_user_id ON members(user_id);

-- ─── Messages ─────────────────────────────────────────────────────────────────
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'file', 'sticker', 'poll', 'location', 'contact', 'system');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read');
CREATE TYPE sticker_pack_source AS ENUM ('deco', 'telegram');
CREATE TYPE sticker_format AS ENUM ('static', 'animated', 'video');

CREATE TABLE messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES users(id),
  type              message_type NOT NULL DEFAULT 'text',
  encrypted_content TEXT NOT NULL,   -- Ciphertext only — plaintext never stored
  media_url         TEXT,
  media_name        TEXT,
  media_mime_type   TEXT,
  media_size        BIGINT,
  media_encrypted   BOOLEAN NOT NULL DEFAULT FALSE,
  group_key_epoch   BIGINT CHECK (group_key_epoch > 0),
  sticker_id        UUID,
  reply_to_id       UUID REFERENCES messages(id),
  status            message_status NOT NULL DEFAULT 'sent',
  is_edited         BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at         TIMESTAMPTZ
);

-- Critical indexes for chat performance
CREATE INDEX idx_messages_conversation_sent ON messages(conversation_id, sent_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- ─── Versioned group encryption keys ─────────────────────────────────────────
-- The legacy table remains the current-key compatibility projection. The
-- immutable epoch tables preserve historical keys across membership rotation.
CREATE TABLE group_keys (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_by    UUID NOT NULL REFERENCES users(id),
  encrypted_key   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE group_key_epochs (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  epoch           BIGINT NOT NULL CHECK (epoch > 0),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, epoch)
);

CREATE TABLE group_key_copies (
  conversation_id     UUID NOT NULL,
  epoch               BIGINT NOT NULL,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  encryptor_public_key TEXT NOT NULL,
  encrypted_key       TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, epoch, user_id),
  FOREIGN KEY (conversation_id, epoch)
    REFERENCES group_key_epochs(conversation_id, epoch) ON DELETE CASCADE
);

CREATE INDEX idx_group_key_copies_user ON group_key_copies(user_id, conversation_id, epoch);

-- ─── Reactions ───────────────────────────────────────────────────────────────
CREATE TABLE reactions (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE polls (
  message_id       UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  allows_multiple  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE poll_options (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  position   INTEGER NOT NULL
);

CREATE INDEX idx_poll_options_message_id ON poll_options(message_id, position);

CREATE TABLE poll_votes (
  message_id UUID NOT NULL REFERENCES polls(message_id) ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_poll_votes_option_id ON poll_votes(option_id);

CREATE TABLE sticker_packs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL UNIQUE,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  source             sticker_pack_source NOT NULL DEFAULT 'deco',
  telegram_set_name  TEXT,
  cover_sticker_id   UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sticker_packs_owner_id ON sticker_packs(owner_id);
CREATE INDEX idx_sticker_packs_source ON sticker_packs(source);
CREATE UNIQUE INDEX idx_sticker_packs_owner_set_name ON sticker_packs(owner_id, telegram_set_name) WHERE telegram_set_name IS NOT NULL;

CREATE TABLE stickers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id                  UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  emoji                    TEXT NOT NULL DEFAULT '',
  asset_url                TEXT NOT NULL,
  thumbnail_url            TEXT,
  mime_type                TEXT NOT NULL,
  format                   sticker_format NOT NULL DEFAULT 'static',
  width                    INTEGER,
  height                   INTEGER,
  telegram_file_id         TEXT,
  telegram_unique_file_id  TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stickers_pack_id ON stickers(pack_id, sort_order, created_at);
CREATE UNIQUE INDEX idx_stickers_pack_sort_order ON stickers(pack_id, sort_order);

CREATE TABLE group_leadership_cycles (
  conversation_id            UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  objection_cooldown_until   TIMESTAMPTZ,
  election_started_at        TIMESTAMPTZ,
  election_ends_at           TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_leadership_objections (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE group_leadership_votes (
  conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  voter_user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, voter_user_id)
);

-- Encrypted private-key backups for cross-device restore
CREATE TABLE user_key_backups (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  kdf          TEXT NOT NULL,
  iterations   INTEGER NOT NULL,
  salt         TEXT NOT NULL,
  cipher       TEXT NOT NULL,
  iv           TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_user_key_backups_updated_at
  BEFORE UPDATE ON user_key_backups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sticker_packs_updated_at
  BEFORE UPDATE ON sticker_packs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Public-key audit and immutability ────────────────────────────────────────
-- Append-only record of every public key ever written for a user. Written in
-- the same transaction as the key itself, so a key can never appear without a
-- corresponding audit row.
CREATE TABLE user_public_key_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id TEXT,
  public_key    TEXT NOT NULL,
  source        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_public_key_audit_user_id
  ON user_public_key_audit (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION deco_reject_row_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION deco_reject_direct_row_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
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

CREATE TRIGGER trg_user_public_key_audit_append_only
  BEFORE UPDATE ON user_public_key_audit
  FOR EACH ROW EXECUTE FUNCTION deco_reject_row_update();

CREATE TRIGGER trg_user_public_key_audit_no_delete
  BEFORE DELETE ON user_public_key_audit
  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();

CREATE TRIGGER trg_group_key_epochs_append_only
  BEFORE UPDATE ON group_key_epochs
  FOR EACH ROW EXECUTE FUNCTION deco_guard_group_key_epoch_update();

CREATE TRIGGER trg_group_key_epochs_no_direct_delete
  BEFORE DELETE ON group_key_epochs
  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();

CREATE TRIGGER trg_group_key_copies_append_only
  BEFORE UPDATE ON group_key_copies
  FOR EACH ROW EXECUTE FUNCTION deco_guard_group_key_copy_update();

CREATE TRIGGER trg_group_key_copies_no_direct_delete
  BEFORE DELETE ON group_key_copies
  FOR EACH ROW EXECUTE FUNCTION deco_reject_direct_row_delete();

-- users.public_key is immutable. A new device means a new row in a device/key
-- table, never a mutation of this one. Only fires when the value actually
-- changes, so ordinary updates (last_seen_at, bio, avatar) are unaffected.
CREATE OR REPLACE FUNCTION deco_reject_public_key_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.public_key IS DISTINCT FROM OLD.public_key THEN
    RAISE EXCEPTION 'users.public_key is immutable (user %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_public_key_immutable
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION deco_reject_public_key_update();
