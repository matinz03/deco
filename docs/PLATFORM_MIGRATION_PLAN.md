# Platform migration plan — managed auth, object storage, encrypted media

**Status:** proposal, not approved. **Authored by:** Claude (Opus 5), 2026-08-27.
**Owner for the security-relevant portions:** Codex, per the boundary in
[`SECURITY_PLAN.md`](SECURITY_PLAN.md).

This document answers a product question: *should Deco replace its own auth,
database, and object storage with a managed platform (InsForge), and adopt
Clerk for authentication?*

It partially supersedes `MINIO_DELEGATION_GUIDE.md` — see
[Relationship to the MinIO guide](#relationship-to-the-minio-guide). That guide
currently lives only on `codex/security-program`, not on `master`.

Read [`STATUS.md`](STATUS.md) first. Substantial parts of the media work this
plan discusses are **already implemented on an unmerged branch**.

---

## Rules for every delegated task

Same rules as the MinIO guide. Repeated here so this document stands alone.

- Work in a dedicated worktree and branch created from current `origin/master`.
- Read [`../AGENTS.md`](../AGENTS.md), [`SECURITY_PLAN.md`](SECURITY_PLAN.md),
  and [`STATUS.md`](STATUS.md) before editing.
- Inspect existing uncommitted changes before editing.
- Never use `git add -A`; stage explicit files only.
- Never alter or weaken tests, scripts, CI gates, or security constraints to
  make checks pass.
- Run `gofmt` on modified Go files.
- Run `go build ./...` before reporting Go test results.
- Report exact commands and exit codes; do not say "verified" or "fixed."
- Do not commit, push, merge, delete data, or mutate production unless the user
  explicitly requests it.
- Write tests for intended behavior, not current vulnerable behavior.
- Treat URLs, filenames, MIME types, headers, and database values as
  attacker-controlled.
- Stop if a required product policy or production credential is missing.

---

## The finding that drives this plan

**Media is not encrypted. Message text is.**

Evidence, verified against source on `master` at `a6e723a`:

- `packages/crypto/src/index.ts` exports `encryptMessage(plaintext: string, ...)`
  and `decryptMessage`. There is **no** blob, file, or stream encryption export.
- `apps/web/src/lib/api.ts:676` uploads via `FormData` to `POST /api/v1/uploads`.
  Nothing encrypts the file first.
- `apps/api/internal/handlers/uploads.go` calls `storage.DetectMimeType` on the
  first 512 real bytes. It can only do that because the bytes are plaintext.
- `apps/api/internal/storage/local.go` `Save()` writes plaintext to disk.
- The resulting URL is stored on the message row as `mediaUrl` and served by
  `http.FileServer`.

So the server reads every photo, video, and file its users exchange, while the
encryption model described in [`ARCHITECTURE.md`](ARCHITECTURE.md) is about
message content only. That is a threat-model inconsistency, and it is the reason
media authorization is expensive.

### Why this makes media auth hard

Every failure mode listed in the MinIO guide's Phase 0 descends from one root
cause: **plaintext media served to `<img>` and `<a>` tags that cannot send an
`Authorization` header.**

The entire signed-ticket subsystem — HMAC signing, constant-time comparison,
domain separation, path and method binding, expiry, `nosniff`,
`Content-Disposition`, MIME allowlists, extension allowlists — exists to make
unauthenticated plaintext delivery safe.

Encrypt the attachment client-side and most of it stops being necessary:

| Concern today | After client-side encryption |
|---|---|
| Uploaded HTML/SVG/JS becomes stored XSS | Stored object is ciphertext. Not parseable as markup. |
| MIME sniff, extension allowlist, `nosniff`, disposition | Always `application/octet-stream`, always attachment. |
| `<img>` cannot authenticate, so tickets are required | Client `fetch()`es (headers work), decrypts, sets `<img src={blobURL}>`. |
| Leaked URL exposes the file | Leaked URL exposes ciphertext to someone without the conversation key. |
| Membership-check bug is a confidentiality breach | Membership-check bug leaks ciphertext. Still a bug, no longer catastrophic. |

No new key management is required. The key already exists per conversation:
`deriveSharedSecret` for DMs, the group key in `conversations.ts`
`groupKeyCache` for groups.

### Relationship to the MinIO guide

`MINIO_DELEGATION_GUIDE.md` already contains attachment E2E encryption — as
**Phase 7**, last.

This plan disagrees with that ordering. Encryption is not a capstone; it is the
change that makes Phases 0, 3, 4 and 6 of that guide much smaller. Doing it last
means building the full ticket-and-content-type apparatus and then discovering
most of it was scaffolding.

The guide's failure-mode catalogues remain valuable and are not replaced. Its
sequencing is what this document revises.

---

## Decisions

| Question | Decision | Reason |
|---|---|---|
| Clerk for auth? | **Yes** | No mail or SMS platform exists. OTP, verification, reset, and MFA are weeks of work with real abuse surface. Clerk also closes S2-1 outright. |
| InsForge for auth/DB/storage? | **No** | See below. |
| Replace Postgres? | **No** | It is already Postgres. If ops is the pain, use managed Postgres (Neon, RDS) for a zero-line diff. |
| Object storage vendor? | **Cloudflare R2** | S3-compatible, zero egress fees, config already scaffolded in `internal/config` and `docker-compose.yml`. |
| MinIO? | **Yes, for local dev only** | Gives dev/prod parity through one S3 code path. Self-hosting it in production contradicts the goal of not operating storage. |
| Encrypt attachments? | **Yes, and earlier than Phase 7** | See above. |

### Why not InsForge

With Clerk holding identity and R2 holding bytes, InsForge's residual value is
managed Postgres. Deco would use a minority of the platform and fight the rest:
InsForge's SDK is TypeScript, and `apps/api` is roughly 5,700 lines of Go
written against `pgx`.

Going through InsForge's REST/SDK layer instead of `pgx` would cost:

- multi-statement transactions;
- the `RETURNING`-heavy data-modifying CTE pattern that
  [`../AGENTS.md`](../AGENTS.md) documents as load-bearing;
- `pgx` typed scanning;
- `EnsureSchema` boot migrations in `internal/db/postgres.go`.

**The one honest counter-argument.** If `conversations` and `members` lived in
InsForge Postgres, InsForge storage RLS could enforce conversation membership in
SQL, and media authorization would genuinely be vendor-handled. The policy is
about one `EXISTS` clause. That is real.

It is still rejected, because the price is migrating the whole database behind a
REST layer to avoid roughly thirty lines of Go — and because once attachments
are encrypted, a membership-check failure leaks ciphertext rather than content.

Revisit only if `apps/api` is ever rewritten as TypeScript functions.

**Caveat:** InsForge maturity, pricing, SLA, and self-hosting story were not
evaluated and are outside the author's knowledge cutoff. If this decision is
reopened, evaluate those directly.

---

## Phase A — merge what already exists

**Do this before anything else in this document.** See [`STATUS.md`](STATUS.md).

S1-1 media access tickets are implemented and tested on `codex/security-program`
(~1,900 lines including integration tests). S2-2 CSP and `HttpOnly` cookie work
is implemented on `security/sessions`. Neither is merged. `master` today serves
attachments with no authorization at all.

Nothing in this plan justifies leaving that unmerged. Ship the ticket work,
close the live hole, and treat encryption as the later change that lets the
ticket layer shrink.

### Common mistakes

- Discarding the ticket branch because "encryption makes it unnecessary."
  Encryption is Phase D. The hole is open now.
- Merging `security/media-tickets` (superseded) instead of
  `codex/security-program`.
- Self-merging. `AGENTS.md` rule 1 and the acceptance criteria in the archived
  Session 1 handoff both forbid it.
- Treating a green `go test ./...` as browser evidence. A type-check pass shipped
  the regression that 401'd every image in the app.

### Required evidence

The acceptance criteria are already set by Codex and are unchanged:

1. Unauthenticated request for a private attachment → `401`.
2. A conversation **member** obtains a ticket and the image renders **in a real
   browser**.
3. A valid-JWT non-member → `403`, and cannot replay a ticket issued for a
   different path.
4. Expired and byte-tampered tickets → `401`.
5. Public avatar and sticker URLs still render without a ticket.

---

## Phase B — Clerk

### Why the migration is small

Three facts in the current code make this cheap. Verify each before relying on it.

1. `users.id` is `UUID PRIMARY KEY` (`infra/compose/init.sql`).
2. The JWT `sub` claim is that same UUID (`handlers/auth.go` `generateToken`).
3. Every handler reads the caller through one accessor,
   `middleware.GetUserID(r)` (`apps/api/internal/middleware/auth.go:66`), and
   `ValidateToken` is shared with the WebSocket `?token=` path.

So the identity swap is contained to one 68-line file.

### Required design

- Add `clerk_user_id TEXT UNIQUE` to `users`. **Keep the internal UUID as the
  primary key and as the foreign key everywhere.** Do not renumber users.
- `middleware/auth.go` swaps HS256-local verification for RS256 via Clerk's
  JWKS, maps `sub` (a Clerk ID) to the internal UUID, and puts the **internal
  UUID** into the request context exactly as today.
- Cache the JWKS and the Clerk-ID-to-UUID mapping in Redis. A cold JWKS fetch on
  every WebSocket connect is an availability dependency on Clerk.
- Handlers must not change. If a delegated task starts editing
  `conversations.go` or `messages.go`, the mapping layer is wrong.
- Retire `password_hash`, bcrypt, and the register/login bodies in `auth.go`
  only after the cutover completes.

### Public-key bootstrap — the one real conflict

Registration today inserts the user **and** their X25519 `public_key` in a
single statement. Clerk creates the identity outside the database, so that
atomicity is lost.

**Do not use a Clerk webhook to create the profile row.** It races the client's
first authenticated request and produces a window in which an account exists
with no public key, which breaks the E2E model.

Required sequence:

1. User completes Clerk sign-up.
2. Client generates the X25519 keypair and stores the private key in IndexedDB.
3. Client calls `POST /api/v1/profile/bootstrap` with the Clerk JWT and the
   `public_key`.
4. Go verifies the JWT and inserts the `users` row.
5. **Every other authenticated endpoint returns `409 profile_required` until
   that row exists.**

The call must be idempotent: a repeat with the same key succeeds, a repeat with
a *different* key is rejected (see below).

Ownership is persisted in `users.is_owner`. Migration preserves an existing
installation by marking its oldest `(created_at, id)` user, matching the former
computed rule exactly. After Clerk cutover, only the verified subject equal to
`CLERK_OWNER_USER_ID` can bootstrap as owner/admin; signup order grants no
privilege. Startup fails closed if configured and persisted owners disagree.

For an existing legacy installation, bind the migrated owner before enabling
Clerk and while every API instance is stopped. First identify the exact internal
owner UUID and intended Clerk subject, then run this transaction directly on
Postgres (substitute both values and retain the UUID predicate):

```sql
BEGIN;
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
UPDATE users
SET clerk_user_id = 'user_intended_clerk_subject'
WHERE id = 'verified-internal-owner-uuid'
  AND is_owner
  AND clerk_user_id IS NULL;
COMMIT;
```

Require exactly one updated row, then set the same subject in
`CLERK_OWNER_USER_ID`, drain old binaries, and enable Clerk. A zero-row result is
a failed precondition; do not enable Clerk or broaden the predicate. The owner
must bootstrap with the existing X25519 key because key immutability remains in
force.

### Mandatory security requirements

Clerk can mint a valid token for any user. In an end-to-end encrypted product,
an identity vendor combined with mutable public keys is a total compromise: mint
a token, replace the victim's public key, receive everything sent afterwards.

These are requirements, not recommendations:

- `public_key` is **immutable after bootstrap**. Never `UPDATE` it. A new device
  means a new row in a device/key table, never a mutation.
- An append-only key-change audit table, written in the same transaction.
- Client-side safety-number verification, and a visible
  "this contact's security code changed" warning.

This risk is not created by Clerk. Anyone with database access can silently swap
a public key on `master` today and nothing would notice. Clerk widens who can do
it; the mitigation was already owed. `SECURITY_PLAN.md` lists public-key
verification among the untouched architectural hypotheses.

Cheap to implement: `public_key` is written only in `auth.go` register and is
never updated in `users.go` (verified by grep). This is a guard plus a table,
not a refactor.

### What Clerk closes for free

- **S2-1 (no token revocation or refresh)** — currently `🔴 Open`, `Logout` is a
  server-side no-op and `/auth/refresh` returns `501`. Clerk provides
  short-lived tokens and real revocation. This item can likely be closed by
  Phase B rather than implemented.
- **Part of S2-2** — Clerk manages the session cookie. Coordinate with
  `security/sessions` so the two do not both own cookie issuance. The CSP half
  of S2-2 is independent and still needed.
- The `?token=` WebSocket query parameter stops being a long-lived credential.
  The MinIO guide flags "putting the session JWT into `?token=`, exposing a
  reusable account credential" as a mistake; `master` does exactly that with a
  7-day JWT. Clerk's short-lived tokens reduce the blast radius.

### Common mistakes

- Changing `users.id` to a Clerk string ID. This rewrites every foreign key and
  every handler.
- Creating the profile row from a webhook.
- Allowing `public_key` to be updated.
- Fetching JWKS per request or per WebSocket connect.
- Assuming the client can cache a Clerk token like the current `deco_token` in
  `localStorage`. Clerk tokens are short-lived (verify the current default
  against Clerk's docs — 60 seconds at time of writing) and must be requested
  from the SDK on demand, including immediately before each WebSocket connect.
- Breaking multi-account switching in `apps/web/src/store/auth.ts`. Clerk
  supports multi-session; confirm the mapping to the existing UX **before**
  committing to the approach.
- Enabling phone/SMS OTP without pricing it. SMS is the cost driver; email-first
  with phone optional keeps it predictable.

### Required tests

- Valid Clerk JWT → request succeeds and context carries the **internal UUID**.
- Expired, wrong-issuer, wrong-audience, and `alg=none` tokens → `401`.
- Token valid but no profile row → `409 profile_required` on every endpoint
  except bootstrap.
- Bootstrap twice with the same key → success. With a different key → rejected,
  and the audit table is unchanged.
- WebSocket handshake with a valid short-lived token → accepted; with an expired
  one → `401`.
- JWKS unavailable → requests fail closed, never open.

---

## Phase C — storage backend and R2

### Required design

- Define a `storage.Backend` interface over the current 151-line
  `internal/storage/local.go`: `Put`, `PresignGet`, `Delete`.
- Two implementations: `local` (dev fallback, existing behaviour) and `s3`.
- Production points the `s3` backend at R2. Local dev points it at MinIO in
  `docker-compose.yml`, so dev and prod exercise the same code path.
- **Two buckets**, not one:
  - **Public** — avatars and stickers. Plaintext, CDN-cacheable, no
    authorization. Telegram sticker import (`handlers/stickers.go`) is
    server-side and unaffected.
  - **Private** — message attachments. Presigned `GET`, short TTL, issued only
    after a conversation-membership check.

### Common mistakes

- Putting avatars or stickers in the private bucket. It breaks sticker packs and
  gains nothing.
- Making the private bucket public "temporarily" to unblock a demo.
- Presigning with a long TTL because a test was flaky.
- Presigning `PUT` for uploads in this phase. Uploads stay server-side until
  Phase D so MIME sniffing still works on plaintext.
- Losing the legacy same-origin absolute-URL compatibility already handled on
  `codex/security-program` (`PUBLIC_UPLOAD_ORIGIN`). Existing rows carry
  absolute URLs.
- Committing R2 credentials. `R2_*` keys belong in the gitignored repo-root
  `.env`.

### Required tests

- `Put` then `PresignGet` round-trips against MinIO in CI.
- Presigned URL past its TTL → denied by the storage provider.
- A presigned URL for object A cannot fetch object B.
- Public-bucket objects fetch with no signature.
- Backend selection is config-driven, and an unknown backend name fails at boot,
  not on first upload.

---

## Phase D — encrypt attachments

This is the phase that shrinks media authorization permanently.

### Required design

- Add `encryptBlob` / `decryptBlob` to `packages/crypto`, using the existing
  per-conversation key: `deriveSharedSecret` for DMs, `groupKeyCache` for
  groups.
- Upload: client encrypts, then uploads ciphertext.
- Download: Go checks conversation membership, returns a presigned URL, client
  fetches ciphertext, decrypts, renders from a Blob URL.
- Orphan handling: upload to a `pending/` prefix; the message-row insert
  promotes the object; a **bucket lifecycle rule** deletes stale `pending/`
  objects after 24 hours. This is vendor configuration, not application code.
- Once this ships, the ticket layer from Phase A can be reduced to
  membership-check plus presign. Do not delete it in the same change.

### Decide before starting

**Encrypted video streaming.** Ciphertext defeats HTTP range requests. The
current limit is 100 MB (`maxBytesForKind` in `handlers/uploads.go`). Either:

- decrypt the whole file in the browser — acceptable to roughly 50 MB, poor
  above; or
- chunked encryption with MediaSource — the approach Signal uses, and materially
  more work.

Pick one explicitly. Do not let a delegated task choose it implicitly.

**Thumbnails.** Server-side thumbnailing, CDN image resizing, and Next.js
`<Image>` optimisation are all unavailable on private encrypted media. Generate
thumbnails client-side **before** encryption and store them as separate
encrypted objects.

### Common mistakes

- Encrypting stickers or avatars. They are public by design.
- Inventing a new key hierarchy. The conversation key already exists.
- Reusing a nonce across chunks.
- Encrypting the file but storing its original filename or exact MIME in
  plaintext on the message row. Metadata leaks.
- Forgetting `URL.revokeObjectURL`. Long chat sessions will leak memory.
- Assuming existing plaintext objects migrate themselves. Legacy rows need a
  defined stage — see the MinIO guide's Phase 5.

### Required tests

- Encrypt/decrypt round-trip for binary content, including a zero-byte and a
  large file.
- A tampered ciphertext byte → decryption fails, and the UI shows a failure
  rather than rendering garbage.
- A non-member with a valid presigned URL obtains bytes that do not decrypt.
- Browser test: an encrypted image uploaded by one member renders for another
  member and does not render for a non-member.

---

## Sequencing

1. **Phase A** — merge the existing media-ticket and session work. Closes a live
   hole. Independent of everything else here.
2. **Phase B** — Clerk. Self-contained, highest product value, closes S2-1.
3. **Phase C** — storage interface and R2.
4. **Phase D** — attachment encryption.

C and D are one media workstream. Do not migrate media twice.

Phases C and D are a **security fix**, not a vendor swap: attachments on
`master` are unauthenticated today.

---

## Delegation boundaries

### Reasonable for a cheaper model

- The `storage.Backend` interface extraction and the `local` implementation.
- MinIO `docker-compose` service and dev wiring.
- Round-trip and TTL tests against MinIO.
- Client-side thumbnail generation.
- `URL.revokeObjectURL` lifecycle work.

### Requires strong independent review

- `middleware/auth.go` JWKS verification and the Clerk-ID-to-UUID mapping.
- The `profile/bootstrap` endpoint and the `409 profile_required` gate.
- Public-key immutability and the audit table.
- Conversation-membership checks that gate presigning.
- Any `encryptBlob` implementation, especially nonce handling.
- The chunked-encryption decision for video.

### Never delegate autonomously

- Merging any branch to `master`.
- Choosing the Clerk plan, or enabling SMS.
- Deleting the legacy `uploads_data` volume or any production object.
- Relaxing a bucket to public.
- Retiring the ticket layer after Phase D.

---

## Open questions for the owner

1. Does Clerk's multi-session model actually cover the account switching in
   `store/auth.ts`, or does that UX change?
2. Whole-file decryption or chunked streaming for video?
3. Are existing plaintext attachments migrated, re-encrypted, or left on a
   legacy read path?
4. Who owns the safety-number verification UI — it is the control that makes
   outsourced identity survivable, and no one is assigned to it.
5. Does S2-2's server-issued `HttpOnly` cookie survive Clerk adoption, or should
   `security/sessions` merge first and be partially reverted in Phase B?
