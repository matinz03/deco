# Deco

Deco is an end-to-end encrypted messaging app — direct messages, groups, and channels, with polls, stickers, reactions, and a bespoke group-ownership election system. The server is content-blind: it stores and relays ciphertext only, never plaintext.

Go REST + WebSocket API, Next.js web client, Postgres, Redis — in a pnpm/Turborepo monorepo.

## Features

- **End-to-end encryption** — X25519 key exchange (ECDH) for direct messages, symmetric group keys distributed per-member for groups/channels. Private keys never leave the browser (IndexedDB only); optional passphrase-encrypted key backup for cross-device recovery.
- **Direct messages, groups, and channels** — with member roles, typing indicators, presence, read receipts, message edit/delete, reactions, and threaded replies.
- **Group leadership** — an objection/cooldown/election mechanism for rotating group ownership, instead of a fixed "creator is forever owner" model.
- **Polls, stickers, media** — polls with multi-choice voting, sticker packs (including importing/cloning Telegram sticker sets), image/video/audio/file uploads.
- **Admin controls** — the first registered user becomes an admin automatically; admins can restrict specific actions (`send_messages`, `create_conversations`, `manage_stickers`) per user, or manage/delete accounts.
- **Realtime** — a Redis-backed WebSocket hub fans events out across API instances.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how these fit together, [`docs/API.md`](docs/API.md) for the full endpoint reference, and [`docs/DATABASE.md`](docs/DATABASE.md) for the schema.

## Tech stack

| Layer | Stack |
|---|---|
| API | Go 1.23, [chi](https://github.com/go-chi/chi) router, [pgx](https://github.com/jackc/pgx), [go-redis](https://github.com/redis/go-redis), [gorilla/websocket](https://github.com/gorilla/websocket), JWT (HS256), bcrypt |
| Web | Next.js 16 (App Router, Turbopack), React 19, Zustand, Tailwind CSS 3, Framer Motion, `@react-three/fiber` |
| Data | PostgreSQL 17 (`pgvector` extension), Redis 7 |
| Crypto | [tweetnacl](https://github.com/dchest/tweetnacl-js) (X25519 + XSalsa20-Poly1305), Web Crypto (PBKDF2 + AES-GCM for key backups) |
| Monorepo | pnpm workspaces, Turborepo |

## Repo layout

```
apps/
  api/            Go backend — cmd/server (entrypoint), internal/{handlers,middleware,db,models,websocket,storage,telegram,config}
  web/            Next.js frontend — src/{app,components,store,lib,hooks}
packages/
  types/          Shared TypeScript interfaces (source of truth for API payload shapes)
  crypto/         E2E encryption + IndexedDB key storage, shared by the web app (and future clients)
  ui/, config/    Placeholders — shared UI components and tsconfig/tailwind config presets
infra/
  compose/        docker-compose.yml + init.sql (Postgres bootstrap schema) for both local and production use
  docker/         Production Dockerfiles for the api and web images
  nginx/          Reverse-proxy config for the VPS deployment
docs/             Architecture, API, and database reference docs
```

## Prerequisites

- [Docker](https://www.docker.com/) (for Postgres + Redis)
- [Node.js](https://nodejs.org/) ≥ 20 and [pnpm](https://pnpm.io/) ≥ 9 (`corepack enable && corepack prepare pnpm@latest --activate`)
- [Go](https://go.dev/) ≥ 1.23

## Local development

**1. Start Postgres, Redis and MinIO:**

```bash
cd infra/compose
cp .env.example .env   # fill in POSTGRES_PASSWORD / REDIS_PASSWORD / JWT_SECRET / MINIO_ROOT_* — any values are fine locally
docker compose up -d postgres redis minio
```

MinIO is the S3-compatible object store that holds media. The API creates the
`deco-public` and `deco-private` buckets itself on boot, so there is no console
step. To run the API on local disk instead, leave `STORAGE_BACKEND` unset — see
step 2.

**2. Configure the API.** Copy the root `.env.example` to `.env` and point it at the containers you just started (values must match `infra/compose/.env`):

```bash
cp .env.example .env
```

```dotenv
DATABASE_URL=postgres://deco:<POSTGRES_PASSWORD>@localhost:5432/deco
REDIS_URL=redis://:<REDIS_PASSWORD>@localhost:6379
JWT_SECRET=<any-long-random-string>
API_PORT=8080
API_ENV=development
ALLOWED_ORIGINS=http://localhost:3000
# Required outside development; must match NEXT_PUBLIC_API_URL exactly.
PUBLIC_UPLOAD_ORIGIN=http://localhost:8080
```

R2 and Anthropic keys can stay blank — they're unused placeholders (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)); the storage backend never reads them. `TELEGRAM_BOT_TOKEN` is only needed if you want to test Telegram sticker-pack import.

To point the API at the MinIO container instead of the local `uploads/` directory, add:

```dotenv
STORAGE_BACKEND=s3
STORAGE_S3_ENDPOINT=http://localhost:9000
STORAGE_S3_PRESIGN_ENDPOINT=http://localhost:9000
STORAGE_S3_ACCESS_KEY_ID=<MINIO_ROOT_USER>
STORAGE_S3_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_PUBLIC_BASE_URL=http://localhost:9000/deco-public
```

`STORAGE_S3_PRESIGN_ENDPOINT` must be reachable from user browsers; it may
differ from the API-only `STORAGE_S3_ENDPOINT`. The API installs private-bucket
CORS for `ALLOWED_ORIGINS` so encrypted objects can be fetched and decrypted in
the browser. Omitting `STORAGE_BACKEND` keeps the secured on-disk local backend,
which is suitable for single-host development but still needs off-host backups
before production. An unrecognised value fails at boot rather than on the first
upload.

**3. Configure the web app.** Next.js only reads `.env*` files from its own directory, not the repo root — create `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
NEXT_PUBLIC_MEDIA_URL=http://localhost:9000
```

Skipping this breaks the app in a confusing way: the CSP header in `next.config.ts` interpolates these vars, so if they're undefined every API/WebSocket request gets blocked client-side with a generic "Failed to fetch."

**4. Install dependencies and run:**

```bash
pnpm install

# Terminal 1 — API (loads the repo-root .env automatically)
cd apps/api && go run ./cmd/server

# Terminal 2 — Web app
pnpm --filter @deco/web dev
```

Open [http://localhost:3000](http://localhost:3000) and sign up — the first account created becomes an admin.

Verify the API independently with `curl http://localhost:8080/health` → `{"status":"ok"}`.

## Current security-program handoff (2026-08-12)

This section records in-progress work that is **not yet merged**. Treat
[`docs/TOMORROW.md`](docs/TOMORROW.md) and
[`docs/SECURITY_PLAN.md`](docs/SECURITY_PLAN.md) as the full backlog; the
former predates the TypeScript/runtime fixes now on `master`.

- `master` includes the TypeScript 7 upgrade, the React external-store snapshot
  fix, the local-media CSP allowance, and the Saved Messages duplicate-race
  migration.
- The S1-1 media-ticket change was isolated from an unrelated 2,682-line local
  branch bundle on `codex/security-program`. Its live acceptance run established
  private raw access `401`, authorized member tickets `200`, non-member ticket
  requests `403`, and public avatars `200`; a real browser loaded ticketed
  images.
- Independent reviews found three blockers during that work: arbitrary external
  media origins, tickets not bound to `GET`, and older same-origin absolute
  upload URLs becoming unreadable. The working tree contains corrections for
  all three, including `PUBLIC_UPLOAD_ORIGIN` (required outside development and
  equal to `NEXT_PUBLIC_API_URL`) to permit only the legacy API origin. The
  final live compatibility check and an independent review of that last change
  remain before any commit or merge.
- The next queued item is the `security/sessions` branch. It still needs the
  required login/logout cookie, cross-origin credential, and no-JavaScript
  fallback tests before integration.

All temporary API/web servers used for the media checks were stopped. Docker's
Postgres and Redis containers were intentionally left running.

## Scripts

From the repo root (Turborepo):

```bash
pnpm dev          # turbo run dev — runs dev scripts for all workspace packages (web app; API is Go, run separately)
pnpm build        # turbo run build
pnpm lint         # ⚠️ currently broken — no ESLint is set up (docs/FEATURE_BACKLOG.md D-9)
pnpm type-check   # turbo run type-check
pnpm clean        # turbo run clean
```

Go side, from `apps/api`:

```bash
go build ./...
go vet ./...
go test ./...
```

Tests:

```bash
cd apps/api && go test ./...       # Go: config, handlers, middleware, storage
pnpm --filter @deco/crypto test    # Node: E2E crypto round-trip tests
```

The storage tests in `apps/api/internal/storage` include integration tests that
need a real S3-compatible server. They run automatically when one is listening
on `http://127.0.0.1:9000` (`docker compose -f infra/compose/docker-compose.yml
up -d minio`) and skip when it is not, so `go test ./...` still passes without
it. Set `STORAGE_TEST_S3_REQUIRE=1` to turn that skip into a failure — do that
in CI, where a silent skip means the presign, expiry and cross-object
assertions never ran.

Coverage is early — the Go tests cover JWT/auth middleware, registration and login validation, and config resolution; the crypto tests cover X25519 key exchange, encrypt/decrypt, and tampered-ciphertext rejection. The web app itself (`apps/web`) has no tests and no runner configured yet, and the WebSocket, uploads, and group-key paths are untested.

## Backups

**Nothing in this repository backs up user data, and one volume now holds every
uploaded file.**

`infra/compose/docker-compose.yml` runs MinIO as the production object store.
Its `minio_data` volume is the only copy of every avatar, sticker and message
attachment in Deco. The database stores the URLs; it does not store the bytes.
**If the disk holding that volume is lost or corrupted, every attachment ever
sent is gone permanently** — and because attachments are referenced from
message rows, the messages will survive with broken media.

The same applies to `postgres_data`, but a database is the thing people
remember to back up; a storage volume that used to be someone else's problem is
not.

There is no backup implementation here and this section does not add one. It
records a gap that must be closed before this deployment is relied on. At
minimum, decide on: an off-host destination, a schedule, a retention window,
and a restore that has actually been tested.

## Production deployment

The app ships with Dockerfiles for both `api` and `web`, and an nginx + Certbot + Docker Compose setup for a single VPS. See [`SETUP.md`](SETUP.md) for the full walkthrough (DNS, SSL, `docker compose up`), and [`deploy.sh`](deploy.sh) / [`watch-deploy.sh`](watch-deploy.sh) for the update/auto-deploy scripts used on the VPS.

### One-time legacy group-key cutover

Fresh databases need no special step. If `group_keys` already contains rows,
stop every old API instance before deploying the epoch-aware API. Set
`DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION=1` for the first new API boot, wait for
it to finish, then unset the flag (or return it to `0`) before starting the
remaining instances. The API intentionally refuses this migration without the
explicit gate because old binaries write a multi-recipient key batch as
separate database transactions.
