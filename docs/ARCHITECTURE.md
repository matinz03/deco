# Architecture

## Overview

```
┌─────────────┐        HTTPS / WSS        ┌─────────────┐
│  Next.js    │ ────────────────────────▶ │   Go API    │
│  (apps/web) │ ◀──────────────────────── │  (apps/api) │
└─────────────┘                            └──────┬──────┘
                                                    │
                                       ┌────────────┼────────────┐
                                       ▼            ▼            ▼
                                  PostgreSQL      Redis      Local disk
                                  (pgvector)   (pub/sub +   (avatars, media,
                                                presence)     stickers)
```

The Next.js app is a thin, stateful client: it holds the JWT, decrypts messages locally, and talks to the API over REST for everything except realtime events, which arrive over a single WebSocket connection. The Go API is the only thing that talks to Postgres/Redis/disk — there's no separate worker process or queue.

## End-to-end encryption model

The server never has access to plaintext message content or private keys.

- Every user has an X25519 keypair (`packages/crypto`). The public key is stored server-side (`users.public_key`); the private key is generated and kept client-side in IndexedDB only, and is never sent to the server.
- **Direct messages**: the two participants derive a shared secret via ECDH (`deriveSharedSecret`) from their own private key and the other's public key. Messages are encrypted with XSalsa20-Poly1305 (`encryptMessage`/`decryptMessage`) using that shared secret.
- **Groups/channels**: a single symmetric group key is generated once (`generateGroupKey`) and distributed to each member individually, encrypted to that member's public key. Clients cache resolved group keys (`groupKeyCache` in `store/conversations.ts`). Group-key distribution is done via `GET/PUT /conversations/{id}/group-key(s)`.
- **Key backup**: because private keys live only in the browser, a lost device means lost message history unless the user opts into backup. `KeyBackupGate` (web) lets a user encrypt their private key with a passphrase (PBKDF2-SHA256, 250k iterations, AES-GCM) and store the resulting blob server-side (`user_key_backups` table, `GET/PUT/DELETE /users/me/key-backup`) for restore on a new device. The server stores only the encrypted blob — it cannot decrypt it without the passphrase.

What the server *can* see: who is messaging whom, when, message metadata (type, size, reactions), and media files (uploads are not end-to-end encrypted). What it *cannot* see: message text/content, or anyone's private key.

## Realtime (WebSocket)

- Client connects to `GET /ws?token=<jwt>` — the token is passed as a query param (not a header) because browsers can't set custom headers during the WebSocket handshake. `internal/websocket/handler.go` validates it with the same JWT logic as the REST middleware.
- `internal/websocket/hub.go` is a per-process in-memory registry of connected clients (`map[userID][]*Client`), each with a buffered (256-message) outbound channel. If a client can't keep up, it's disconnected rather than allowed to backpressure the hub.
- To support multiple API instances, the hub publishes every event to a Redis pub/sub channel (`deco:events`); every instance's hub subscribes and re-delivers to its own locally-connected clients. This means REST handlers (message send/edit/delete/reaction, read receipts) publish once and don't need to know which instance a recipient is connected to.
- Event types: `message.new`, `message.edited`, `message.deleted`, `message.reaction`, `message.read`, `typing`, `presence`.
- The web client (`lib/websocket.ts`) is a hand-rolled reconnecting client over the native `WebSocket` API — newline-delimited JSON frames, exponential backoff (1s → 30s), reconnect on `focus`/`online`/`visibilitychange`. `socket.io-client` is listed in `package.json` but is dead code; it's not used anywhere.

## Group leadership (ownership rotation)

Most chat apps treat the group creator as permanent owner. Deco instead models ownership as something that can be challenged:

- `group_leadership_cycles` tracks per-conversation cooldown/election windows.
- Any member can file an **objection** to the current owner (`group_leadership_objections`); enough objections within a cooldown window triggers an **election**.
- During an election, members **vote** for a candidate (`group_leadership_votes`); once turnout crosses a threshold, the election is finalized and ownership transfers to the winner (`ConversationHandler.finalizeLeadershipElection` in `conversations.go`).
- Exposed via `GET /conversations/{id}/leadership`, `POST .../leadership/object`, `POST .../leadership/vote`. If you're changing this feature, read the handler and the `LeadershipStatus`/`LeadershipCandidate` types in `packages/types` together — the state machine (cooldown → objection threshold → election → turnout threshold → finalize) spans both.

## Auth

- Registration/login issue a JWT (HS256, `sub`=userID, 7-day expiry, signed with `JWT_SECRET`) — see `AuthHandler.generateToken` in `auth.go`.
- The **first user ever registered** automatically becomes an admin (`is_admin=true`), determined by `COUNT(*) FROM users` at registration time. `is_owner` (shown in the UI, distinct from `is_admin`) is recomputed per-query as "the user with the earliest `created_at`" — see `userSelectColumns` in `admin_helpers.go`.
- Admins can set `restricted_actions` on other users (`send_messages`, `create_conversations`, `manage_stickers`); `requireAllowedAction` enforces these in the relevant handlers. Admins themselves bypass all restrictions.
- `POST /auth/refresh` exists as a route but returns 501 Not Implemented — there is no refresh-token flow yet; clients just hold the 7-day JWT until it expires.

## Storage

Media (avatars, message attachments, stickers) is stored on local disk under `UPLOAD_ROOT`, served back via `http.FileServer` at `PUBLIC_UPLOAD_BASE` (default `/api/v1/media`). Config fields for Cloudflare R2 (`R2_ACCOUNT_ID`, etc.) and an Anthropic API key exist in `internal/config/config.go` but aren't referenced anywhere else in the codebase — they're unused placeholders for future work, not a currently-wired integration.

## Schema evolution

The database schema is defined in two places that must be kept in sync:

1. `infra/compose/init.sql` — runs once, only when the Postgres container's data volume is first created (via `docker-entrypoint-initdb.d`).
2. `internal/db/postgres.go` (`EnsureSchema`) — runs on every API boot, using idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TYPE ... ADD VALUE IF NOT EXISTS` statements. This is the actual migration mechanism for existing databases; `init.sql` only matters for brand-new ones.

See [`DATABASE.md`](DATABASE.md) for the full schema.
