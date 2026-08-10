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

**1. Start Postgres and Redis:**

```bash
cd infra/compose
cp .env.example .env   # fill in POSTGRES_PASSWORD / REDIS_PASSWORD / JWT_SECRET — any values are fine locally
docker compose up -d postgres redis
```

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
```

R2 and Anthropic keys can stay blank — they're unused placeholders (see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)). `TELEGRAM_BOT_TOKEN` is only needed if you want to test Telegram sticker-pack import.

**3. Configure the web app.** Next.js only reads `.env*` files from its own directory, not the repo root — create `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
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

## Scripts

From the repo root (Turborepo):

```bash
pnpm dev          # turbo run dev — runs dev scripts for all workspace packages (web app; API is Go, run separately)
pnpm build        # turbo run build
pnpm lint         # turbo run lint
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
cd apps/api && go test ./...       # Go: config, handlers, middleware
pnpm --filter @deco/crypto test    # Node: E2E crypto round-trip tests
```

Coverage is early — the Go tests cover JWT/auth middleware, registration and login validation, and config resolution; the crypto tests cover X25519 key exchange, encrypt/decrypt, and tampered-ciphertext rejection. The web app itself (`apps/web`) has no tests and no runner configured yet, and the WebSocket, uploads, and group-key paths are untested.

## Production deployment

The app ships with Dockerfiles for both `api` and `web`, and an nginx + Certbot + Docker Compose setup for a single VPS. See [`SETUP.md`](SETUP.md) for the full walkthrough (DNS, SSL, `docker compose up`), and [`deploy.sh`](deploy.sh) / [`watch-deploy.sh`](watch-deploy.sh) for the update/auto-deploy scripts used on the VPS.
