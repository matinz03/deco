# Current engineering status

Updated 2026-08-27. This is a navigation and handoff document, **not** a claim
of independent verification. Read the linked plans for acceptance criteria.

Branch state below was read from `git` on 2026-08-27. Everything else is a
pointer to a document that owns the detail.

---

## `master` — `a6e723a`

Feature-integrated and building. **Not security-complete.**

Recent history: TypeScript 7 upgrade, startup conversation-duplicate fix, and
the merge of both (`a6e723a`).

> ⚠️ **Attachments on `master` are served with no authorization.**
> `internal/storage/local.go` writes plaintext to disk and `http.FileServer`
> serves it. Anyone holding a URL reads the file. The S1-1 remediation exists
> but is **not merged** — see below. Do not read a green build as a fixed
> system.

---

## Unmerged work

| Branch | Head | Ahead of `master` | Contains | Blocked on |
|---|---|---|---|---|
| `codex/security-program` | `4148539` | 4 commits | **S1-1** media access tickets, media routes, storage ticket layer, integration tests, `MINIO_DELEGATION_GUIDE.md`, its own updated `SECURITY_PLAN.md` and `STATUS.md` (~1,900 lines) | Fresh compatibility run + independent review |
| `security/sessions` | `0dcf476` | 2 commits | **S2-2** CSP hardening, build-time public-env check, server-issued `HttpOnly` session cookie | Codex review. Do not self-merge |
| `security/media-tickets` | `eeecc17` | 2 commits | **Superseded.** An earlier, divergent take on S1-1 | Nothing — supersede and delete, or keep as reference |
| `codex/add-clerk-plan` | `a6e723a` | 0 commits | Nothing committed. One uncommitted line in its worktree adding backlog item **C-8** (evaluate Clerk) | Folded into [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) |
| `claude/repo-docs-review-4a8265` | `4148539` | 4 commits | Same head as `codex/security-program` — duplicate checkout | Nothing. Redundant worktree |

### What this means

Two separate, already-written security fixes are sitting unmerged while the
vulnerabilities they close are live. That is the highest-value action available
in this repository, and it does not depend on any platform decision.

---

## Worktrees

```
C:/Users/Damian Zod/deco                                  a6e723a  [master]
C:/Users/Damian Zod/deco/.claude/worktrees/repo-docs-review-4a8265
                                                          4148539  [claude/repo-docs-review-4a8265]
C:/Users/Damian Zod/deco/.worktrees/clerk-future-plans    a6e723a  [codex/add-clerk-plan]
C:/Users/Damian Zod/deco/.worktrees/security-program      4148539  [codex/security-program]
C:/Users/Damian Zod/deco/.worktrees/typescript-7          16956c8  [codex/typescript-7]
C:/Users/Damian Zod/deco-sessions                         0dcf476  [security/sessions]
```

Notes:

- `codex/typescript-7` is **merged** into `master` via `a6e723a`. Its worktree
  can be removed.
- `deco-sessions` lives **outside** the repository directory. It is easy to miss.
- `.claude/worktrees/repo-docs-review-4a8265` duplicates
  `.worktrees/security-program` at the same SHA.
- Both `.env` files are gitignored and exist only in the original checkout. A
  new worktree needs them copied in.

---

## Documentation divergence

`codex/security-program` carries a **newer documentation tree** than `master`,
including files `master` has never had:

| File | On `master` | On `codex/security-program` |
|---|---|---|
| `MINIO_DELEGATION_GUIDE.md` | absent | present (401 lines) |
| `FUTURE_FEATURES.md` | absent | present |
| `STATUS.md` | present (this file, written 2026-08-27) | present (branch's own, 2026-08-12) |
| `README.md` (docs map) | present (written 2026-08-27) | present (2026-08-12) |
| `SECURITY_PLAN.md` | older — see below | updated S1-1 status |

Those docs are entangled with ~1,900 lines of unmerged code on the same branch,
so they cannot be picked up by merging alone. When `codex/security-program`
merges, **reconcile the two `STATUS.md` and `README.md` copies rather than
letting one silently overwrite the other.**

### Known staleness on `master`

[`SECURITY_PLAN.md`](SECURITY_PLAN.md) points S1-1 at branch
`security/media-tickets` at `7e33d6a`. That branch is superseded; the live work
is `codex/security-program` at `4148539`. The branch's own copy of
`SECURITY_PLAN.md` already carries this correction.

`SECURITY_PLAN.md` is owned by Codex. Its findings and remediation sequencing
have **not** been edited here.

---

## Remaining security queue

Full detail in [`SECURITY_PLAN.md`](SECURITY_PLAN.md). This is the queue only.

| Item | State |
|---|---|
| S1-1 media authorization | Implemented on `codex/security-program`, unmerged, needs review |
| S1-2 group-key epoch/authority | Partial. First-insert race and removed-distributor cases open |
| S2-1 token revocation/refresh | 🔴 Open. `Logout` is a server-side no-op, `/auth/refresh` returns `501`. Likely **closed by Clerk** — see [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) Phase B |
| S2-2 CSP + cookie | Implemented on `security/sessions`, unmerged. Coordinate with Clerk before merging the cookie half |
| S2-3 JWT config fail-closed | 🟢 Fixed |
| S3-9 WebSocket origin validation | 🟢 Fixed |
| S3-1…S3-8 | Untouched |
| Architectural hypotheses | Untouched. Public-key verification is now a **requirement** if Clerk is adopted |

---

## Open decisions

- [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) — Clerk, R2,
  attachment encryption, and why InsForge is rejected. **Proposal, not
  approved.** Its five open questions need an owner.

---

## Known landmines

1. **`pnpm lint` enforces nothing and there is no ESLint in the workspace.**
   Tracked as D-9. Do not alias it to another command to make it green — that
   was attempted before and produces a gate that reports success while checking
   nothing.
2. **`apps/api/uploads/` is gitignored and holds real uploaded files.** Do not
   commit it; do not delete it expecting regeneration.
3. **A fresh clone panics at startup without a `.env`.** `API_ENV` defaults to
   `production`, which requires a real `JWT_SECRET`. Intentional fail-closed
   behaviour. Follow the README setup steps.
4. **CORS takes a single origin string (S3-3)** while the WebSocket origin check
   splits on commas. A comma-separated `ALLOWED_ORIGINS` makes the two disagree.
5. **`PUBLIC_UPLOAD_ORIGIN` is required outside development on
   `codex/security-program`.** It must equal the public API origin and exists
   solely to recognise legacy same-origin absolute media URLs.

---

## Resuming the environment

```bash
docker compose -f infra/compose/docker-compose.yml up -d postgres redis
```

```bash
cd apps/api && go run ./cmd/server
```

```bash
pnpm --filter @deco/web dev
```

The API loads the repo-root `.env`; the web app needs `apps/web/.env.local`.
Both are gitignored.
