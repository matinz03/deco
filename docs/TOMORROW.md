# Pick up here tomorrow

State as of 2026-08-10, end of session 1. Read this before touching anything — several things look finished but are not.

## The one-paragraph summary

`master` is **feature**-complete and builds green; it is **not** security-complete. The two most important security fixes are sitting on unmerged branches awaiting cross-review. Nothing has been deployed. If someone deploys `master` today, media is still served through the pre-ticket path.

---

## Where the code is

| Branch | Head | Contains | Blocked on |
|---|---|---|---|
| `master` | `71ffeed` | A-1 forgot-password page, A-2 location/contact enum, CI, all docs, earlier security hardening | — (pushed to origin) |
| `security/media-tickets` | `7e33d6a` | **S1-1**: media access tickets, upload ownership, browser refresh hook | Codex's authorization/browser sign-off |
| `security/sessions` | `0dcf476` | **S2-2**: CSP hardening + HttpOnly session cookie | Codex's review (do not self-merge) |

Only one worktree exists: the main checkout on `security/media-tickets`. Others were cleaned up; re-create with `git worktree add ../deco-<name> -b <branch>`.

## Do these first

1. **Codex: finish the S1-1 sign-off.** Schema/migration integration is already verified green against live Postgres (`media_objects` exists with the right PK and cascading FK). What remains is *authorization behaviour only*: non-member gets 403, expired/tampered tickets rejected, and **a real browser render check**. That last one is not optional — type-check passed on the change that broke every image in the app, so it is not evidence.
2. **Cross-review and merge the two security branches.** `security/sessions` needs Codex; `security/media-tickets` needs a second pair of eyes. Neither author merges their own.
3. **Revert the fake lint fix** (see landmines) before wiring CI's lint step back on.

## Remaining security work

Full detail in [`SECURITY_PLAN.md`](SECURITY_PLAN.md); this is just the queue.

| Item | Owner | State |
|---|---|---|
| S1-1 media | Codex | Implemented, unmerged, needs authorization + browser sign-off |
| S1-2 group-key epoch/authority | Codex | Partial. First-insert race and removed-distributor cases still open; epoch invariant not yet defined |
| S2-1 token revocation/refresh | Claude Coder | **Not started.** `Logout` is a no-op server-side, `/auth/refresh` returns 501, 7-day JWTs cannot be revoked |
| S2-2 CSP + cookie | Claude Coder | Cookie done, CSP `unsafe-eval` dropped. **Remaining:** `unsafe-inline` needs nonce-based CSP |
| S3-1…S3-8 | unassigned | Untouched. See the S3 table |
| Architectural hypotheses | unassigned | Untouched — forward secrecy, key-rotation-on-removal, public-key verification are the interesting ones |

## Feature work

[`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md) has the full list. Next most valuable:

- **D-9 real ESLint** — currently there is no linting at all, and CI's lint step is deliberately commented out until this exists.
- **A-1 follow-through** — the forgot-password *page* exists; there is still no password reset flow. Needs Codex's design first because it entangles with E2E key backup.
- **C-5 multi-device** — arguably the biggest product gap: a second device cannot read history without the passphrase key backup.
- **A-4** — `message_status` never reaches `delivered`.

## Landmines

Things that will bite whoever moves next.

1. **`apps/web/package.json` lint script is still `tsc --noEmit`** in the main checkout's working tree — an attempted "fix" that makes `pnpm lint` report green while enforcing zero rules. **Revert it.** It is uncommitted, so it may simply be discarded.
2. **`master` is 18 commits ahead of where anyone last looked.** Rebase or merge before starting new work.
3. **The main checkout has uncommitted files from several agents** — Codex's in-progress work plus stray edits to `AGENTS.md`, `README.md`, `models.go`, `init.sql`, `package.json`, and an untracked `.eslintrc.json`. Sort out what is wanted before committing anything there; do not `git add -A`.
4. **A fresh clone now panics at startup without a `.env`.** `API_ENV` defaults to `production`, which requires a real `JWT_SECRET`. This is intentional (fail closed) but it will look like a broken build to anyone new. Follow the README setup steps.
5. **`apps/api/uploads/` is gitignored** and holds real uploaded files. Do not commit it; do not delete it expecting the app to regenerate it.
6. **CORS still takes a single origin string** (`S3-3`) — a comma-separated `ALLOWED_ORIGINS` silently produces one malformed origin. The WebSocket origin check *does* split on commas, so the two disagree.

## Resuming the environment

```bash
docker compose -f infra/compose/docker-compose.yml up -d postgres redis
cd apps/api && go run ./cmd/server      # needs repo-root .env
pnpm --filter @deco/web dev             # needs apps/web/.env.local
```

Both `.env` files are gitignored and exist only in the original checkout — a new worktree needs them copied in.

Test accounts in the local DB from this session: `matinz03` (admin/owner), plus throwaways `cookietest2`, `patin`, `new123`. Safe to delete.

## Process

Working rules are at the top of [`../AGENTS.md`](../AGENTS.md) and they are not decoration — each one exists because its absence broke something here. The two that did the most work: **never certify your own work**, and **never weaken a gate to make it green**.

Session analysis: [`AGENT_OPERATIONS.md`](AGENT_OPERATIONS.md) (what was produced, per-agent scorecard) and [`INTERACTION_PATTERNS.md`](INTERACTION_PATTERNS.md) (how it was communicated, and why enthusiasm turned out to be a negative signal for reliability).

**Open question worth answering tomorrow:** whether the multi-agent setup earns its ~32% coordination overhead once the no-self-certification rule is actually in force. If the correction ratio does not fall, shrink the crew.
