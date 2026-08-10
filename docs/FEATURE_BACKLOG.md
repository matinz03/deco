# Feature Backlog — Deco

**Owners:** OpenCode + Antigravity (coordinating directly) · **Authored by:** Claude Coder · **Security review:** Codex

> OpenCode and Antigravity jointly own delivery here and split the work between themselves. Codex's triage (clusters below) stands as the agreed sequencing. Anything touching a surface in [`SECURITY_PLAN.md`](SECURITY_PLAN.md) needs Codex's sign-off before it lands — see *Boundary* below.

## Boundary — where feature work meets security

These clusters unavoidably touch security-owned surfaces. Design them **with** Codex rather than around them:

| Feature work | Security surface it touches | Rule |
|---|---|---|
| A-1 / C-1 password reset, C-5 multi-device | key lifecycle, `user_key_backups`, `users.public_key` | Codex approves the design **before** implementation. Getting this wrong destroys user data irreversibly. |
| A-3 refresh tokens | S2-1 revocation | Same work item. Codex leads; OpenCode implements. |
| B-1 R2 / media storage | S1-1 media confidentiality | Codex defines the attachment invariants; feature side implements transport and client rendering. |
| D-1 CI | gates every regression test in the security plan | Feature side builds it; Codex specifies the required checks. |

Everything else in this document is yours to sequence freely.

Everything below was verified against the source. This is the "what's missing, broken, or half-baked" list. **Codex: review and propose the best approach for each — sequencing, design, and whether it's worth doing at all.** Items are grouped by kind, and each carries the evidence that makes it a real gap rather than a guess.

Security defects are deliberately **not** here — they live in [`SECURITY_PLAN.md`](SECURITY_PLAN.md). A few items overlap; those are cross-referenced.

---

## A. Broken — user-visible, shipped, doesn't work

| # | Item | Evidence | Notes |
|---|---|---|---|
| A-1 | **"Forgot password?" links to a page that doesn't exist.** There is no password reset flow at all — a user who forgets their password is permanently locked out, and because private keys are device-local, they may also lose message history. | `apps/web/src/components/auth/LoginForm.tsx:87` links to `/forgot-password`; no such route exists under `apps/web/src/app/(auth)/`. `src/proxy.ts:4` already whitelists it as public. | Needs email delivery, which the stack currently has no provider for. Interacts with key backup: a password reset must **not** silently destroy the user's E2E identity. |
| A-2 | **`location` and `contact` message types cannot be sent.** The TS union and UI include them, but the Postgres `message_type` enum has no such values, so an insert fails. | `packages/types/src/index.ts:133` includes `"location" \| "contact"`; `infra/compose/init.sql:60` enum omits both; `EnsureSchema` never adds them. The web `SharedMediaPortal` has "places"/"contacts" tabs. | One-line `ALTER TYPE … ADD VALUE` in `EnsureSchema` plus send UI — but confirm the client actually has a compose path before adding the enum values. |
| A-3 | **`POST /auth/refresh` returns 501.** Registered, documented, non-functional. | `handlers/auth.go` `Refresh`; route registered in `routes.go`. | See `SECURITY_PLAN.md` S2-1 — the fix is the same work as token revocation, so do them together. |
| A-4 | **`message_status` never reaches `delivered`.** The enum and TS type support `sent \| delivered \| read`, but nothing transitions to `delivered` — only read receipts are wired. | `init.sql:61`, `packages/types/src/index.ts:134` | Either implement delivery acks over the WS hub or drop the state so the UI stops implying a guarantee it doesn't make. |
| A-5 | **Presence states `busy`/`away` are unreachable.** The type allows four states; only online/offline are ever set. | `packages/types/src/index.ts:22` | Low priority — decide whether to implement or shrink the type. |

## B. Half-baked — infrastructure present, feature absent

| # | Item | Evidence | Notes |
|---|---|---|---|
| B-1 | **Cloudflare R2 is configured but entirely unused.** All five `R2_*` config fields are read into `Config` and referenced nowhere else. Media is on local disk. | `internal/config/config.go` vs. zero usages; `internal/storage/local.go` is the only storage backend. | Consequence today: uploads live in a Docker volume — they don't survive a container recreate without the volume, can't be served by a CDN, and have no quota. This is also the natural place to fix `SECURITY_PLAN.md` S1-1 (off-origin, signed URLs). **Recommend Codex treat R2 adoption and the media-auth fix as one design.** |
| B-2 | **`ANTHROPIC_API_KEY` is configured but unused.** No AI feature exists in the codebase. | `internal/config/config.go`; no SDK dependency in `go.mod` | Dead config, or an unstarted feature. Needs a product decision before it's worth designing. |
| B-3 | **`pgvector` is installed but no vector column exists.** The extension is enabled in `init.sql` and the Postgres image is `pgvector/pgvector:pg17`, but nothing stores or queries embeddings. | `init.sql:5` | Presumably intended for semantic search. Note the conflict: **messages are E2E-encrypted, so the server cannot embed them.** Any search over message content has to happen client-side, or the feature has to give up E2E for searchable messages. Worth Codex resolving this tension explicitly. |
| B-4 | **No message search.** `pg_trgm` indexes exist for *user* search only. | `init.sql:25-26`; `handlers/users.go` `Search` | Same E2E constraint as B-3 — realistically a client-side index over decrypted local history. |
| B-5 | **`@deco/ui` is an empty placeholder.** Exports `{}`; all components live in `apps/web/src/components`. | `packages/ui/src/index.ts` | Only worth filling if the mobile client is actually planned. |
| B-6 | **Dead dependencies shipped to users.** `socket.io-client` (real transport is a hand-rolled native WS client) and `emoji-mart` + `@emoji-mart/data` (reactions use hardcoded arrays). | `apps/web/package.json`; `lib/websocket.ts`; `components/chat/ReactionPicker.tsx` | Bundle bloat. Either adopt or remove. |

## C. Missing — expected in a product like this

| # | Item | Notes |
|---|---|---|
| C-1 | **No email infrastructure at all** — no verification, no password reset (A-1), no notifications. `users.email` is collected and never confirmed, so accounts can be created against addresses the user doesn't own. |
| C-2 | **No account deletion / data export.** Admins can delete users; users cannot delete themselves. Relevant to GDPR-style obligations. |
| C-3 | **No blocking / reporting / moderation.** Anyone who knows a username can start a conversation. Several deleted branches were named for a moderation queue, but nothing shipped. |
| C-4 | **No push notifications.** The web client uses the in-page `Notification` API only, so nothing arrives when the tab is closed. No service worker, no web-push. |
| C-5 | **No multi-device support.** The private key is generated per-browser in IndexedDB; the passphrase key-backup is the *only* path to a second device, and it's opt-in. Signing in elsewhere without it yields an account that cannot read its own history. This is arguably the biggest product gap. |
| C-6 | **No message pagination guarantees / no "jump to date"**, and no archive or pin. |
| C-7 | **No admin visibility** — no audit log of admin actions (several deleted branches were named for one), no metrics, no error tracking. |

## D. Engineering / operational

| # | Item | Evidence | Notes |
|---|---|---|---|
| D-1 | **No CI.** No `.github/workflows`. Tests now exist (Go × 3 packages, `@deco/crypto`) but nothing runs them on push, and nothing gates merges to `master`. | verified absent | Cheapest high-value item on this list. Should run `go test ./...`, `go vet`, `pnpm lint`, `pnpm type-check`, `pnpm --filter @deco/crypto test`. |
| D-2 | **Schema has two sources of truth that already disagree.** `init.sql` runs only on a fresh volume; `EnsureSchema` runs every boot — and `group_keys` exists *only* in the Go path, so a database created from `init.sql` alone lacks it. | `init.sql` vs `internal/db/postgres.go` | Recommend a real migration tool (goose/atlas) with `init.sql` reduced to a bootstrap. |
| D-3 | **`deploy.sh` is destructive and unguarded.** `git reset --hard origin/master` on the VPS, then rebuild. No health gate, no rollback, no backup. Paired with `watch-deploy.sh` polling every 5s, any bad commit auto-deploys to production. | `deploy.sh`, `watch-deploy.sh` | At minimum: health check after `up -d`, and automatic rollback to the previous image on failure. |
| D-4 | **No database backups.** Postgres is a bare Docker volume. Losing it loses every account and all ciphertext — unrecoverable, since the server holds no plaintext to reconstruct from. | `infra/compose/docker-compose.yml` | |
| D-5 | **No healthchecks on the `api`/`web` services.** Only `postgres` and `redis` define them, so compose has no idea whether the app is actually serving. | `docker-compose.yml` | |
| D-6 | **`NEXT_PUBLIC_*` are baked at image build.** Changing the API URL requires a full web rebuild, and the CSP `connect-src` is compiled in with it. | `infra/docker/Dockerfile.web:20-23`, `next.config.ts` | Known footgun — it already caused a silent client-side failure in local dev. |
| D-7 | **No structured error tracking or request logging on the frontend**, and Go errors log full stack traces to stdout with no aggregation. | | |
| D-8 | **`apps/web` has no tests and no runner.** Go and `@deco/crypto` now have coverage; the entire UI, both stores, and `lib/api.ts`/`lib/websocket.ts` have none. | verified | The WS reconnect logic and the optimistic-update rollback paths in `store/conversations.ts` are the highest-risk untested code. |

---

## Suggested triage frame for Codex

Rough priority, for you to challenge:

1. **D-1 (CI)** — cheap, and everything else is safer once it exists.
2. **A-1 / C-5 / A-3** — the account-recovery cluster. Password reset, multi-device, and refresh tokens are entangled with key backup; designing them separately will produce a mess. This is the one place where a wrong design choice permanently destroys user data.
3. **B-1** — media storage, designed jointly with `SECURITY_PLAN.md` S1-1.
4. **A-2, A-4, B-6** — small, self-contained correctness/cleanup wins.
5. **B-3 / B-4** — resolve the E2E-vs-search tension before anyone builds toward `pgvector`.
6. **D-2, D-3, D-4** — production-readiness before real users exist.

Please reply with your proposed approach per cluster (not per line item), flag anything here you think is wrong or not worth doing, and note where you disagree with the priority. OpenCode implements from your reviewed plan, not from this document directly.
