# Database Schema

PostgreSQL 17 (`pgvector/pgvector:pg17` image — the `vector` extension is enabled but not currently used by any query; it's reserved for future semantic search). Extensions: `uuid-ossp`, `pgcrypto`, `pg_trgm` (fuzzy search), `vector`.

The schema is defined in two places — see [`ARCHITECTURE.md`](ARCHITECTURE.md#schema-evolution) for why:
- [`infra/compose/init.sql`](../infra/compose/init.sql) — bootstrap, runs once on a fresh Postgres volume.
- `apps/api/internal/db/postgres.go` (`EnsureSchema`) — idempotent migrations, runs on every API boot. This is the only place `group_keys` is created — it's absent from `init.sql`, so a brand-new database only gets it once the API has booted at least once.

## Entities

**`users`** — `username`/`email`/`phone_number` unique, `password_hash` (bcrypt), `public_key` (X25519, for E2E), `is_admin`, `restricted_actions text[]` (subset of `send_messages`/`create_conversations`/`manage_stickers`). No `is_owner` column — computed at query time as the user with the earliest `created_at`. GIN trigram indexes on `username`/`display_name` for fuzzy search.

**`conversations`** — `type` enum `direct | group | channel | saved`, `created_by_id`. Ownership beyond the creator is tracked separately via the leadership tables below, not a column here.

**`members`** — join table, composite PK `(conversation_id, user_id)`, `role` enum `owner | admin | member`, `last_read_at` (drives unread counts / read receipts).

**`messages`** — `type` enum `text | image | video | audio | file | sticker | poll | system`, `encrypted_content` (ciphertext only — the server stores no plaintext), `status` enum `sent | delivered | read`, optional `media_*` columns, `sticker_id`, self-referencing `reply_to_id` for threaded replies, `is_edited`/`is_deleted` flags (soft delete). Indexed on `(conversation_id, sent_at DESC)` — the hot path for loading a conversation's history.

**`reactions`** — composite PK `(message_id, user_id, emoji)`, i.e. one reaction per emoji per user per message (a user can react with multiple different emoji to the same message).

**`polls` / `poll_options` / `poll_votes`** — one poll per message (`polls.message_id` is both PK and FK to `messages`), ordered options (`position`), one vote per user unless `allows_multiple`.

**`sticker_packs` / `stickers`** — `sticker_packs.source` enum `deco | telegram`; a unique index enforces one imported pack per `(owner_id, telegram_set_name)` so re-importing the same Telegram set updates rather than duplicates. `stickers.format` enum `static | animated | video`; unique `(pack_id, sort_order)` for stable ordering, plus original Telegram file IDs retained for re-fetching.

**`group_keys`** — one encrypted copy of a conversation's symmetric key per member: `encrypted_key` (the group key, encrypted with ECDH between `encrypted_by`'s private key and `user_id`'s public key) and `encrypted_by` (whose public key the recipient must use to decrypt it). PK `(conversation_id, user_id)`.

**`user_key_backups`** — one row per user, holding a passphrase-encrypted copy of their private key (`kdf`, `iterations`, `salt`, `cipher`, `iv`, `ciphertext`) for cross-device restore. The server never has the passphrase and cannot decrypt this.

**`group_leadership_cycles` / `_objections` / `_votes`** — the ownership-rotation state machine described in [`ARCHITECTURE.md`](ARCHITECTURE.md#group-leadership-ownership-rotation): a cooldown window, a set of objections against the current owner, and (during an active election) one vote per member for a candidate.

## Triggers

A single `update_updated_at()` plpgsql function, attached via `BEFORE UPDATE` triggers to `users`, `conversations`, `user_key_backups`, `sticker_packs`, and `group_leadership_cycles`, keeps each table's `updated_at` column current automatically — application code never sets `updated_at` directly.

## Relationships at a glance

```
users ──┬─< conversations (created_by_id)
        ├─< members >── conversations
        ├─< messages (sender_id)
        ├─< reactions, poll_votes, group_leadership_objections/votes
        ├─1 user_key_backups
        └─< group_keys (per-conversation encrypted key copies)

conversations ─< members, messages, group_keys, group_leadership_cycles

messages ─< reactions
         ─1 polls ─< poll_options ─< poll_votes
         ─(sticker_id, not a FK)→ stickers

sticker_packs ─< stickers
```
