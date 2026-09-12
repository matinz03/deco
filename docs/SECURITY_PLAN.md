# Security Plan — Deco

**Owner:** Codex (security lead) · **Authored by:** Claude Coder · **Status:** partially remediated (see Status table)

> Codex owns this document and all remediation sequencing. Feature work (see [`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md), owned by OpenCode + Antigravity) must not land changes to the surfaces listed here without Codex's review — see *Boundary* below.

Every finding below was verified against the source at the cited `file:line`, not inferred. Work them in priority order. For each one, the "Verify" step is what Antigravity should reproduce **before** anyone writes a fix, and the "Regression test" is what should exist afterwards.

> ⚠️ **Do not write tests that assert current behaviour on any S1/S2 item.** Several of these are broken today; a test written against today's output would lock the vulnerability in. Assert the *intended* behaviour and let the test fail until the fix lands.

## Status

Remediation reviewed independently by Claude Coder and Codex. Verified by running `go build ./...`, `go vet ./...`, and `go test ./... -count=1` — not by trusting status reports.

> ⚠️ **`master` is NOT security-complete. Do not read a green build as a fixed system.**
> `master` is *feature*-integrated (A-1, A-2, CI, docs) and compiles and tests clean — that is all a green build means.
> **The S1-1 media remediation is NOT on `master`.** It lives on branch `security/media-tickets` at `7e33d6a`, deliberately held back pending authorization sign-off. Anything deployed from `master` today still serves media through the pre-ticket path.
>
> Sign-off progress on `7e33d6a`: schema/migration integration **verified against a live Postgres** — `EnsureSchema` ran clean and `media_objects` was created with `storage_path` PK and an `owner_id` FK `ON DELETE CASCADE`. **Remaining: authorization behaviour** — non-member 403, ticket expiry/tamper rejection, and a real browser render check (type-check alone did not catch the last media regression).

| ID | Status | Notes |
|---|---|---|
| S1-1 | 🟡 **Implemented; live proof pending** | Upload types are allowlisted, private media is bound to uploader/conversation metadata, and reads use membership-gated short-lived tickets or private S3 presigns. DM/group attachments are encrypted before upload and decrypted only into browser-local Blob URLs; Saved Messages keep their documented plaintext behavior. Focused Go/crypto tests pass on the authored tree. Remaining proof: real object store, two-browser render/download, non-member denial, expiry, and tamper exercises. |
| S1-2 | 🟡 **Implemented; live proof pending** | Only group owner/admin can initialize or rotate. Immutable epochs contain exactly one encrypted copy per post-change member, add/remove membership commits in the same transaction, expected-epoch CAS rejects competing admins, sender membership/epoch is locked through message insert, and each message/media record keeps its decryption epoch. Direct epoch mutation is database-blocked; account deletion refuses to cascade an encrypted-group membership. Legacy `group_keys` is a current-key rollback projection. Remaining proof: real-Postgres migration and concurrent two-client rotation/removal exercise. |
| S2-1 | 🔴 **Open** | No revocation, no refresh. Untouched. |
| S2-2 | 🟡 **Partial** | Production CSP no longer allows `unsafe-eval` and fails its build when API/WS origins are missing. App Router/Clerk still require `unsafe-inline` until nonce-based CSP is introduced; the legacy auth cookie is still written via `document.cookie` and is not `HttpOnly`. |
| S2-3 | 🟢 **Fixed** | `Load()` panics when `JWT_SECRET` is empty or `change-me` outside development, and `API_ENV` now **defaults to `production`**, so misconfiguration fails closed. ⚠️ Onboarding side effect: a fresh clone with no `.env` now panics at startup instead of silently running insecure — intended, but follow the `README.md` setup steps. |
| S3-9 | 🟢 **Fixed** | `makeCheckOrigin(cfg)` validates `Origin` against `ALLOWED_ORIGINS` (comma-split), with `localhost` fallbacks gated on `cfg.Env == "development"`. |

Everything else in this document remains open and unverified.

## Boundary — security vs. feature work

Codex owns everything in this file. OpenCode + Antigravity own [`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md). Four items straddle the line and must be designed jointly, with Codex approving the design before implementation: **password reset / multi-device** (key lifecycle), **refresh tokens** (S2-1, same work item), **media storage / R2** (S1-1 confidentiality), and **CI** (runs every regression test specified here). See the Boundary table in the backlog for the split.

**S1-1 implementation decision:** private media uses path-scoped, short-lived
tickets (or private S3 presigns) and encrypted attachments use authenticated
fetch plus browser-local Blob URLs. Session JWTs are never placed in media
query strings. Live browser/object-store proof remains a launch gate.

---

## S1-1 — Unauthenticated media serving chains into total E2E compromise

This is three defects that individually look moderate and together defeat the entire encryption model. Treat as one unit.

**Evidence**

- `apps/api/cmd/server/main.go:102-106` — `http.FileServer(http.Dir(cfg.UploadRoot))` is registered on the **root** router, after and outside the `r.Route("/api/v1", …)` group, so it never passes through `middleware.Auth`. Both `PUBLIC_UPLOAD_BASE` (default `/api/v1/media/*`) and the legacy `/uploads/*` alias are affected.
- `apps/api/internal/handlers/uploads.go:107-152` — `isAllowedUpload` returns true if **either** MIME **or** extension matches. For `kind=file`, `isAllowedMime` returns `true` for any MIME and `isAllowedExtension` returns `true` for any extension — so `kind=file` accepts **arbitrary content, including `.html` and `.js`**. For `kind=avatar`/`image`, `.svg` is explicitly allowed.
- `apps/web/src/store/auth.ts:137` — the session cookie is written with `document.cookie`, so it is **not `HttpOnly`** and carries no `Secure` flag.
- `apps/web/next.config.ts` — CSP allows `script-src 'unsafe-inline' 'unsafe-eval'`.
- `packages/crypto/src/index.ts` — private keys live in IndexedDB, readable by any same-origin JS.

**The chain:** upload an `.html` or `.svg` payload → it is served **from the app's own origin** with no auth → victim opens the URL → same-origin script executes (CSP permits inline) → script reads the IndexedDB private key and the non-`HttpOnly` `auth_token` cookie → attacker decrypts that user's entire message history, past and future. End-to-end encryption provides no protection against this, because the compromise happens on the plaintext side.

**Independently:** filenames are `timestamp_randomhex` (`internal/storage/local.go:64`), which is unguessable — but that is obscurity, not access control. Any URL that is forwarded, logged, or leaked grants permanent unauthenticated access with no membership check and no expiry.

**DECISION (Codex, security owner) — short-lived, path-scoped media tickets.** Explicitly *not* session-JWT query parameters, and *not* a directly authenticated `FileServer` (both were tried and rejected — see the Status table). Design gates required before implementation:

1. Persist an upload/object record and bind message media to it; **reject arbitrary client-supplied `media_url`** (closes S3-6 as a side effect).
2. Authorize ticket issuance against the actual resource: conversation membership for message media, with a **separately defined** policy for stickers (public) and avatars (visibility rules differ — they are not conversation-scoped).
3. The ticket carries only object ID/path, method, and a short expiry, signed with a **dedicated key purpose — not the session JWT**. The ticket endpoint must reject non-members, expired or tampered tickets, path traversal, and unlinked objects.
4. The client receives a refreshable ticketed URL with **no session token in markup**. Tests must cover both browser rendering and non-member 403.

Codex has reserved the media and group-key paths; do not modify them without their sign-off.

**Original fix directions considered:**
1. Serve media through an authenticated handler that checks conversation membership, with short-lived signed URLs.
2. Never serve uploads from the app origin — separate domain/bucket, so injected script is not same-origin.
3. Force `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` on all user content; drop `.svg` from image kinds, or rasterise on upload.
4. Tighten `kind=file` to a real allowlist, and make MIME **and** extension both required (`&&`, not `||`).
5. Encrypt attachments client-side before upload so the server holds ciphertext, consistent with the message model.

**Verify:** upload a file with `kind=file` containing `<script>alert(document.cookie)</script>` and an `.html` name; fetch the returned URL in a browser with no `Authorization` header; confirm it renders and script executes. Then confirm from a logged-out incognito session that the URL still serves.

**Regression test:** unauthenticated GET of a media URL returns 401/403; a non-member of the conversation gets 403; `kind=file` rejects `.html`/`.svg`; responses carry `nosniff` + `attachment`.

---

## S1-2 — Any group member can overwrite any other member's group key

**Evidence:** `apps/api/internal/handlers/conversations.go`, `PutGroupKeys`. Authorization checks only that **the caller** is a member. It then accepts a caller-supplied array of `{user_id, encrypted_key, encrypted_by}` and upserts with `ON CONFLICT (conversation_id, user_id) DO UPDATE`. There is **no check that `entry.UserID` is a member**, and **no check that `encrypted_by` is the caller**.

**Impact:** a single malicious or compromised member can rewrite the key distribution for every other member — replacing a victim's `encrypted_key` with one the attacker controls and attributing it to an arbitrary `encrypted_by`. Depending on how the client resolves keys, this is a group-message MITM primitive; at minimum it is a trivial, permanent denial of service against the group (victims can no longer decrypt). Because it is an upsert, the legitimate key is destroyed, not shadowed.

**Fix direction:** require `encrypted_by == callerID`; validate every `entry.UserID` is a current member of that conversation; consider restricting distribution to `owner`/`admin` roles, and refuse to overwrite an existing row unless the key is being legitimately rotated (add a key epoch/version and reject downgrades).

**Verify:** as member A of a group containing B, `PUT /conversations/{id}/group-keys` with `[{user_id: B, encrypted_key: <attacker key>, encrypted_by: <anyone>}]`. Confirm 204 and that B's row in `group_keys` is replaced. Then confirm B can no longer decrypt.

**Regression test:** overwriting another member's key returns 403; `encrypted_by` spoofing is rejected; a non-member `user_id` in the payload is rejected.

---

## S2-1 — No token revocation of any kind

**Evidence:** `apps/api/internal/handlers/auth.go` — `Logout` is a no-op that returns `200 {"message":"logged out"}` and touches nothing server-side. `Refresh` returns **501**. Tokens are stateless HS256 JWTs with a **7-day** expiry (`generateToken`).

**Impact:** a leaked token is valid for up to 7 days and **cannot be revoked** — not by logout, not by password change, not by an admin deleting the user. "Sign out" is purely cosmetic (it clears client storage). Combined with S1-1's cookie theft, an attacker retains access for a week.

**Fix direction:** short-lived access tokens plus a real refresh flow, or a server-side denylist (Redis is already deployed — `jti` → expiry works well). At minimum, include a `token_version` claim on the user row that increments on logout/password change, and reject stale versions.

**Verify:** log in, capture the token, call `POST /auth/logout`, then reuse the token against `GET /users/me` — confirm it still succeeds. Repeat after deleting the user via admin.

---

## S2-2 — Weak session-cookie and CSP posture

**Evidence:** `apps/web/src/store/auth.ts:137` (`document.cookie`, no `HttpOnly`, no `Secure`); `apps/web/next.config.ts` (`'unsafe-inline' 'unsafe-eval'`).

**Impact:** amplifies every XSS into full account + key compromise. `Secure` omitted means the cookie is sent over plaintext HTTP if the app is ever reached without TLS.

**Fix direction:** the middleware gate in `src/proxy.ts` only needs *presence* of a session — issue that cookie from the server as `HttpOnly; Secure; SameSite=Lax` and keep the bearer token in memory. Remove `unsafe-eval`; move to nonce/hash-based `script-src`.

---

## S2-3 — `JWT_SECRET` silently defaults to `change-me`

**Evidence:** `apps/api/internal/config/config.go` — `JWTSecret: getEnv("JWT_SECRET", "change-me")`.

**Impact:** a deployment that forgets the env var boots successfully and signs tokens with a publicly known secret — anyone can forge a token for any `sub`, including an admin. Fails open, silently.

**Fix direction:** fail fast at startup if `JWT_SECRET` is unset/default/short when `API_ENV != development`.

**Verify:** boot with `JWT_SECRET` unset; forge an HS256 token with `sub` = an admin's UUID signed with `change-me`; call an admin route.

---

## S3 — Confirm and triage

| # | Finding | Evidence |
|---|---|---|
| S3-1 | **First-user-admin bootstrap is raceable.** `COUNT(*)` then `INSERT` are separate statements — two concurrent registrations on an empty DB can both observe 0 and both become admin. | `handlers/auth.go` `Register` |
| S3-2 | **Rate limiting depends on spoofable client IP.** `httprate.LimitByIP(100, time.Minute)` sits behind `middleware.RealIP`, which trusts `X-Forwarded-For`/`X-Real-IP`. If the API is ever reachable without the nginx hop, an attacker sets the header and bypasses the limit entirely. 100/min is also generous for password brute force. | `cmd/server/main.go:79-80` |
| S3-3 | **CORS accepts exactly one origin string.** `AllowedOrigins: []string{cfg.AllowedOrigins}` — a comma-separated env value becomes one malformed origin, which tends to get "fixed" by setting `*`. Verify the deployed value. | `cmd/server/main.go` |
| S3-4 | **Key-backup KDF below current guidance.** PBKDF2-SHA256 at 250k iterations; OWASP now recommends 600k, or Argon2id. The blob is server-stored, so a DB compromise enables offline brute force against user passphrases. | `packages/crypto/src/index.ts` |
| S3-5 | **WebSocket token travels in the query string** (`/ws?token=…`), so it lands in nginx access logs, proxy logs, and browser history. Unavoidable for browser WS handshakes — mitigate with a short-lived single-use ticket instead of the session JWT. | `cmd/server/main.go:107` |
| S3-6 | **`media_url` is client-supplied** and stored verbatim, so a message can point at an arbitrary external URL (tracking pixel / phishing / IP disclosure on render). | `handlers/messages.go` |
| S3-7 | **Soft delete only.** `messages.is_deleted` flags the row; ciphertext is retained indefinitely and no media file is unlinked. "Delete for everyone" does not delete. | `infra/compose/init.sql` |
| S3-8 | **`restricted_actions` enforcement coverage is unverified.** `requireAllowedAction` exists in `admin_helpers.go`; confirm it is actually called on every mutating path (messages, conversations, stickers, uploads) rather than a subset. | `handlers/admin_helpers.go` |
| S3-9 | **WebSocket origin validation is disabled** — `CheckOrigin: func(r *http.Request) bool { return true }`, justified by the comment "the auth middleware already validates the JWT". See the note below; the comment's reasoning is wrong even though the outcome is currently survivable. | `internal/websocket/handler.go:23-28` |

### Note on S3-9 (CSWSH) — reported by Antigravity, confirmed with narrower scope

The code defect is real: any origin may open a handshake. But classic Cross-Site WebSocket Hijacking requires the browser to *auto-attach* credentials, and this endpoint authenticates from `?token=`, which a cross-origin page cannot read (the token lives in same-origin `localStorage`). So an attacker page cannot currently forge an authenticated socket — **today's safety is accidental, not designed.**

Two reasons to fix it anyway:
1. **It is a pre-auth resource sink.** Any origin can force upgrades and burn connections/goroutines before token validation rejects them.
2. **It is a landmine for the S3-5 fix.** The obvious remedy for "token in query string" is to move WS auth onto the existing `auth_token` cookie — at which point the browser *does* auto-attach credentials and this becomes directly exploitable CSWSH. Whoever implements S3-5 must add a real `CheckOrigin` allowlist in the same change, or they will convert a logged-token problem into an account-takeover one.

Fix: validate `Origin` against `ALLOWED_ORIGINS` and delete the misleading comment.

---

## Architectural bug-hunt list

Classes of defect this specific architecture invites. Antigravity: treat each as a hypothesis to disprove.

**E2E / key management**
- No forward secrecy: DM shared secret is a static ECDH product, so one stolen private key retroactively decrypts *all* history. Any post-compromise security story requires ratcheting.
- No public-key verification/pinning — the server hands clients the peer's `public_key`, so a malicious server can substitute its own and MITM silently. There is no safety-number/fingerprint UI to detect it.
- Group key rotation on member removal is implemented atomically with membership
  deletion; live concurrent-client proof remains pending.
- Key-backup passphrase has no strength requirement and no attempt throttling on `GET /users/me/key-backup`.

**AuthZ**
- Conversation membership is checked per-handler rather than centrally — audit for any handler that trusts a path param without an `isConversationMember` check.
- Role checks (`owner`/`admin`/`member`) vs. the separate global `is_admin` — confirm a group admin cannot escalate to platform admin, and that `is_owner` (computed as oldest `created_at`) cannot be inherited by deleting the founder.
- Leadership election: can a non-member vote or object? Can a user vote twice via race? Is `finalizeLeadershipElection` idempotent under concurrent calls?

**Realtime**
- The hub fans out via Redis to all instances — verify events are filtered by *recipient membership* at delivery, not just at publish, so a client cannot receive events for conversations it left.
- Presence/typing may leak activity for users who disabled `showOnlineStatus`.
- The 256-buffer disconnect-on-backpressure path: confirm a slow client cannot be used to stall the hub.

**Data / infra**
- `init.sql` and `EnsureSchema` are two sources of truth and already disagree (`group_keys` exists only in the Go path) — drift here silently changes constraints.
- No DB migration tool and no rollback path.
- Postgres/Redis bind to `127.0.0.1` in compose — verify that holds on the VPS and that Redis requires its password.
- Uploads are a Docker volume with no quota — unbounded disk growth is a cheap DoS given a 100 MB video limit.

---

## Suggested order for Antigravity

1. **S1-1** upload → same-origin XSS → key exfiltration chain (highest blast radius)
2. **S1-2** group-key overwrite
3. **S2-1** revocation, then **S2-3** JWT default, then **S2-2** cookie/CSP
4. S3 table, top to bottom
5. Architectural list — report which hypotheses you disproved, not only the confirmed bugs

Report findings back with `file:line` + a reproduction. Do not modify source; this document and the fixes are the user's call.
