# Current engineering status

Updated 2026-09-12. This is a working integration handoff, not independent
certification.

## MVP integration branch

`codex/mvp-integration` starts from `origin/master` at `cdccf43`.

Integrated work:

- `codex/security-program`: private-media tickets, conversation-membership
  checks, protected media routes, upload hardening, and focused integration
  tests.
- `platform/clerk-auth`: opt-in Clerk RS256/JWKS authentication, internal UUID
  mapping, profile bootstrap, immutable public-key audit, short-lived client
  token handling, and Clerk sign-in/sign-up pages. Legacy HS256 login remains
  available until production cutover evidence is complete.
- `platform/storage-backend`: configurable local and S3-compatible storage,
  MinIO bucket provisioning, stable object keys, backend-aware cleanup, and
  membership-gated private-object presigning through a browser-facing endpoint.
  Private-bucket CORS is provisioned from `ALLOWED_ORIGINS`; legacy local
  attachments keep working during an S3 migration. Local storage remains the
  default.
- `platform/blob-crypto`: binary attachment encryption and decryption
  primitives with tamper-detection tests. DM and group attachments are now
  encrypted before upload and decrypted into browser-local Blob URLs after an
  authorized fetch; Saved Messages retain their existing plaintext behavior.
  The media registry binds encryption, type, name, MIME, and size metadata so
  message JSON cannot substitute unsafe rendering metadata.
- Production CSP no longer permits `unsafe-eval`, fails the build when API/WS
  origins are absent, and includes Clerk's documented protection origins.
  App Router/Clerk `unsafe-inline` remains until nonce-based CSP is introduced.

After integrating security, Clerk, storage, blob primitives, and private S3
reads, the following commands exited successfully on this branch:

- `go build ./...`
- `go vet ./...`
- `go test ./... -count=1` — 227 tests across 9 packages
- `pnpm --filter @deco/crypto test` — 12 tests
- `pnpm type-check`
- `pnpm build` with the required API, WebSocket, and media origins set

These results describe this authored integration tree and are not independent
certification. Clerk still requires a real-tenant browser exercise.

## Work still outside this branch

- `security/sessions`: CSP hardening plus a legacy server-cookie change. The
  CSP work may survive Clerk; cookie ownership must not be merged blindly.

## Launch blockers

1. Exercise Clerk sign-up, bootstrap, sign-in, sign-out, reconnect, and key
   recovery against a real Clerk tenant.
2. Exercise encrypted upload/download in two real browsers against the deployed
   object store. S3 now has a separate browser-facing signing endpoint, private
   bucket CORS, and CSP support; deployment values still need real-environment
   proof.
3. Resolve group-key first-writer authority and add key epochs.
4. Add off-host Postgres and object-storage backups, service health checks, and
   deployment rollback.
5. Add browser coverage for auth, encrypted media, realtime reconnect, and
   unauthorized access.

See [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) and
[`SECURITY_PLAN.md`](SECURITY_PLAN.md) for design constraints.
