# Current engineering status

Updated 2026-09-15. This is a working integration handoff, not independent
certification.

## MVP integration branch

`codex/mvp-integration` starts from `origin/master` at `cdccf43`.

Integrated work:

- `codex/security-program`: private-media tickets, conversation-membership
  checks, protected media routes, upload hardening, and focused integration
  tests.
- `platform/clerk-auth`: exclusive Clerk RS256/JWKS authentication in managed
  mode, internal UUID mapping, explicit persisted owner identity, durable
  profile/key bootstrap, fresh-token REST/WebSocket sessions, blocking key
  recovery, and Clerk sign-in/sign-up pages. Legacy HS256 login remains only
  when Clerk mode is disabled.
- `platform/storage-backend`: configurable local and S3-compatible storage,
  MinIO bucket provisioning, stable object keys, backend-aware cleanup, and
  membership-gated private-object presigning through a browser-facing endpoint.
  Private-bucket CORS is provisioned from `ALLOWED_ORIGINS`; legacy local
  attachments keep working during an S3 migration. Native development defaults
  to local storage; production Compose defaults to S3/MinIO.
- `platform/blob-crypto`: binary attachment encryption and decryption
  primitives with tamper-detection tests. DM and group attachments are now
  encrypted before upload and decrypted into browser-local Blob URLs after an
  authorized fetch; Saved Messages retain their existing plaintext behavior.
  The media registry binds encryption, type, name, MIME, and size metadata so
  message JSON cannot substitute unsafe rendering metadata.
- Production CSP no longer permits `unsafe-eval`, fails the build when API/WS
  origins are absent, and includes Clerk's documented protection origins.
  App Router/Clerk `unsafe-inline` remains until nonce-based CSP is introduced.
- Group encryption uses immutable key epochs. Group creation requires a
  complete epoch-1 distribution; add/remove membership and key rotation commit
  atomically behind an expected-epoch compare; messages and encrypted
  attachments record their exact epoch so old history remains decryptable.
  Legacy key rows are retained as a rollback projection. Direct epoch/copy
  mutation is blocked at the database layer; account deletion now refuses to
  bypass rotation for users who still belong to encrypted groups.
- CI builds and tests Go against live Postgres and MinIO, runs crypto/type
  gates, and creates a production web build. API/web containers have application-level
  healthchecks. Production Nginx routes the app, API health, WebSocket, and the
  separate MinIO media origin through loopback-only container bindings.
- Deployments are serialized, take off-host PostgreSQL/MinIO/legacy-upload
  snapshots, wait for health, and rebuild the previous commit on failure. A
  daily systemd timer and checksum-gated destructive restore command are
  included.

After integrating security, Clerk, storage, blob primitives, and private S3
reads, the following commands exited successfully on this branch:

- `go build ./...`
- `go vet ./...`
- `go test ./... -count=1` — 236 tests across 9 packages
- `pnpm --filter @deco/crypto test` — 12 tests
- `pnpm type-check`
- `pnpm build` with the required API, WebSocket, and media origins set

These results describe this authored integration tree and are not independent
certification. Clerk still requires a real-tenant browser exercise.

## Work still outside this branch

- `security/sessions`: the legacy server-cookie change remains intentionally
  unmerged because Clerk owns the production session. Its compatible CSP work
  was integrated separately.

## Launch blockers

1. Exercise the implemented Clerk-to-Deco session bridge against a real tenant:
   sign-up, sign-in, sign-out, token rotation/reconnect, account switch, and
   cross-device key recovery. Managed mode now removes legacy routes/forms,
   captures subject-specific bootstrap tokens, and blocks app content until the
   local encryption key exists.
2. Configure `CLERK_OWNER_USER_ID` to the intended verified Clerk subject. On a
   legacy deployment, stop all API instances and bind the migrated persisted
   owner using the transaction in `PLATFORM_MIGRATION_PLAN.md` before enabling
   Clerk. Signup order no longer grants managed-mode privilege.
3. Exercise encrypted upload/download in two real browsers against the deployed
   object store. S3 now has a separate browser-facing signing endpoint, private
   bucket CORS, and CSP support; deployment values still need real-environment
   proof.
4. Exercise group creation, concurrent admin rotation, member add/remove, stale
   send recovery, and old-message/media decryption against live Postgres in two
   browsers. The real-Postgres migration test exists but skips unless
   `DECO_TEST_DATABASE_URL` is configured. Self-service group leave is hidden:
   an owner/admin must remove the member while generating the next key; a safe
   asynchronous leave/handoff protocol is future work. Existing deployments
   with legacy key rows must stop all old API instances, set
   `DECO_ALLOW_LEGACY_GROUP_KEY_MIGRATION=1` for one boot, then unset it; the
   server refuses to migrate without this explicit drained-deployment gate.
5. Configure the off-host backup destination, run the first snapshot, and
   rehearse `restore.sh` on a disposable VPS. The implementation is present;
   operator credentials and disaster-recovery proof are not.
6. Add browser coverage for auth, encrypted media, realtime reconnect, and
   unauthorized access.

See [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) and
[`SECURITY_PLAN.md`](SECURITY_PLAN.md) for design constraints.
