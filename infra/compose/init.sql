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
  public_key    TEXT NOT NULL,              -- X25519 public key for E2E
  avatar_url    TEXT NOT NULL DEFAULT '',
  bio           TEXT NOT NULL DEFAULT '',
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username_trgm ON users USING gin(username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING gin(display_name gin_trgm_ops);

-- ─── Conversations ────────────────────────────────────────────────────────────
CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel', 'saved');

CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          conversation_type NOT NULL DEFAULT 'direct',
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  created_by_id UUID NOT NULL REFERENCES users(id),
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
CREATE TYPE message_type AS ENUM ('text', 'image', 'video', 'audio', 'file', 'poll', 'system');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read');

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
