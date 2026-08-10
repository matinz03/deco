# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.

## What this is

Deco (env defaults still say `Bahregram` in places) is an end-to-end encrypted messaging app: a Go REST+WebSocket API and a Next.js web client, in a pnpm/Turborepo monorepo. The server never sees plaintext message content — only ciphertext, public keys, and encrypted key backups.

## Commands

Local dev (no Docker build needed for api/web — see `README.md` for full first-time setup):

```bash
# Postgres + Redis only
docker compose -f infra/compose/docker-compose.yml up -d postgres redis

# Go API (from apps/api) — loads ../../.env, i.e. the repo-root .env
go run ./cmd/server

# Web app (from repo root)
pnpm --filter @deco/web dev
```

Build / lint / typecheck (Turborepo, from repo root):

```bash
pnpm build         # turbo run build — builds apps/web and workspace packages
pnpm lint          # turbo run lint
pnpm type-check    # turbo run type-check (tsc --noEmit)
pnpm clean
```

Go side (from `apps/api`):

```bash
go build ./...
go vet ./...
go test ./...                                             # all Go tests
go test ./internal/middleware/ -run TestValidateToken -v  # a single test
```

Crypto package tests (from repo root):

```bash
pnpm --filter @deco/crypto test    # node --test packages/crypto/test.mjs
```

Test coverage, as of the last verified run:

| Suite | File | Covers |
|---|---|---|
| Go — middleware | `apps/api/internal/middleware/auth_test.go` | JWT validation, auth middleware |
| Go — handlers | `apps/api/internal/handlers/auth_validation_test.go` | Register/Login validation, logout+refresh status codes, bcrypt |
| Go — config | `apps/api/internal/config/config_test.go` | env defaults and override resolution |
| Go — websocket | `apps/api/internal/websocket/event_test.go`, `handler_test.go` | event JSON serialization, event-type constants, and handshake rejection (401 on missing/invalid `?token=`) |
| Node — crypto | `packages/crypto/test.mjs` | X25519 keygen, ECDH symmetry, encrypt/decrypt round-trip, tampered-ciphertext rejection |

Everything else is untested. There is still **no test runner under `apps/web`** (no `*.test.*`/`*.spec.*`, no Jest/Vitest configured) — the only JS-side tests are the crypto package's, which use the built-in `node --test`. Untested and security-relevant: WebSocket origin validation and hub fanout (handshake *rejection* is covered, but the authenticated happy path and `CheckOrigin` are not), group-key distribution, uploads, and every handler beyond auth validation. Before adding tests to those paths, read [`docs/SECURITY_PLAN.md`](docs/SECURITY_PLAN.md) — several are currently broken, so a test written against today's behaviour would cement the bug.

## Environment variables — two separate `.env` files, easy to get wrong

- **Repo root `.env`** — read by the Go API only, via `godotenv.Load("../../.env")` in `cmd/server/main.go` (path is relative to `apps/api/cmd/server`, so it always resolves to the repo root regardless of where `go run` is invoked from within the module). Holds `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `API_PORT`, `ALLOWED_ORIGINS`, R2/Anthropic/Telegram keys.
- **`apps/web/.env.local`** — Next.js only auto-loads `.env*` files from its own app directory, never the monorepo root. `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` must be duplicated here or the client silently gets `undefined` for both — which breaks the CSP header in `next.config.ts` (`connect-src 'self' undefined undefined`) and every API/WS request gets blocked client-side with a confusing "Failed to fetch" rather than a clear error.
- `infra/compose/.env` is a third, separate file consumed only by `docker-compose.yml` for the containerized production `api`/`web` services (not needed for native local dev).

## Architecture

### Monorepo layout

- `apps/api` — Go 1.23 backend (chi router, pgx, go-redis, gorilla/websocket, JWT, bcrypt). No AWS/Anthropic SDKs are actually wired in despite config fields existing for them (see below).
- `apps/web` — Next.js 16 / React 19 app (App Router, Turbopack), Zustand for state, Tailwind v3.
- `packages/types` — shared TS interfaces (`User`, `Conversation`, `Message`, `WSEvent`, poll/sticker/leadership types) — the source of truth for API payload shapes on the frontend.
- `packages/crypto` — all E2E crypto (`tweetnacl` X25519 + XSalsa20-Poly1305), IndexedDB private-key storage, passphrase-encrypted key backup (PBKDF2 + AES-GCM via Web Crypto).
- `packages/ui`, `packages/config` — currently near-empty placeholders (UI components still live under `apps/web/src/components`; config package just re-exports shared tsconfig/tailwind config).

### Backend (`apps/api/internal`)

- `handlers/` — one file per resource (`auth`, `users`, `conversations`, `messages`, `stickers`, `uploads`), all mounted under `/api/v1` except `/health` and `/ws`. `admin_helpers.go` holds `userSelectColumns`/`scanUser` (the canonical user-row projection, incl. a computed `is_owner` subquery = oldest-created user) and the `restricted_actions` permission check used across handlers.
- `middleware/auth.go` — JWT (HS256) via `Authorization: Bearer` header; the WebSocket handshake can't set headers, so `/ws` instead validates the token from a `?token=` query param using the same `ValidateToken`.
- `db/postgres.go` `EnsureSchema` — runs idempotent `ALTER TYPE`/`CREATE TABLE IF NOT EXISTS` at boot. Schema is defined by **both** `infra/compose/init.sql` (initial container bootstrap) **and** this Go function (incremental migrations) — check both when reasoning about the current schema.
- `websocket/hub.go` — realtime fanout uses Redis pub/sub (`deco:events` channel) so events reach clients connected to any API instance; each connected client has a buffered (256) send channel that disconnects the client on backpressure rather than blocking.
- `storage/local.go` — media (avatars, message attachments, stickers) is stored on local disk under `UPLOAD_ROOT`, served via `http.FileServer`. The R2 config fields in `internal/config` are unused placeholders.
- `telegram/client.go` — only consumer is sticker-pack import/clone (`stickers.go`); `NewClient` returns `nil` when `TELEGRAM_BOT_TOKEN` is unset.
- **Postgres data-modifying CTE gotcha**: a data-modifying CTE's changes are only visible to the rest of the statement through its own `RETURNING` output — you cannot `INSERT ... RETURNING id` in a CTE and then `JOIN` that id back against the base table in the outer query to read the rest of the row; that join sees the pre-insert snapshot and returns zero rows even though the insert committed. Always `RETURNING` every column you need directly from the `INSERT`/`UPDATE` statement instead of re-querying the table.

### Frontend (`apps/web/src`)

- `lib/api.ts` — single REST client (`fetch` wrapper with `Authorization: Bearer <deco_token>` from `localStorage`), plus every snake_case→camelCase DTO mapper (`mapUser`, `mapMessage`, `mapConversation`, etc.). This is the boundary translating Go API JSON into `@deco/types` shapes.
- `lib/websocket.ts` — hand-rolled reconnecting `WebSocket` client (newline-delimited JSON, exponential backoff, reconnects on focus/online/visibilitychange). `socket.io-client` is a listed dependency but is dead code — the real transport is this native client.
- `store/` (Zustand, no persist middleware — state that needs to survive reload is synced to `localStorage` by hand): `auth.ts` (session, multi-account switching, key-backup lifecycle), `conversations.ts` (the largest store — messages, optimistic send/edit/delete, media upload progress, group-key cache, all inbound WS event handling), `preferences.ts`, `toasts.ts`.
- `src/proxy.ts` — despite the filename, this is the Next.js middleware (`matcher` + default export), gating routes on the `auth_token` cookie.
- E2E model: DMs derive a shared secret via ECDH (`deriveSharedSecret`) between the two users' X25519 keys; groups use a symmetric key generated once and distributed per-member, encrypted to each recipient's public key (`conversations.ts` `groupKeyCache` + the `/conversations/{id}/group-key(s)` endpoints). Private keys never leave the browser (IndexedDB only); `KeyBackupGate` handles the passphrase-encrypted server-side backup/restore flow for cross-device recovery.
- "Group leadership" is a bespoke ownership-rotation feature (objection + cooldown + turnout-threshold election) spanning `conversations.go` server-side and the leadership endpoints/UI client-side — not a standard chat-app concept, worth reading both sides together if touching it.
