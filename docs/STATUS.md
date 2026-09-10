# Current engineering status

Updated 2026-09-10. This is a working integration handoff, not independent
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
  MinIO bucket provisioning, stable object keys, and backend-aware cleanup.
  Local storage remains the default while private S3 reads are wired.

Before the Clerk merge, the following commands ran on the media integration:

- `go build ./...`
- `go test ./... -count=1` — 70 tests across 9 packages
- `pnpm --filter @deco/crypto test` — 4 tests
- `pnpm type-check`
- `pnpm build`

These results describe that exact tree only. Clerk integration requires a new
full gate run and browser exercise.

## Work still outside this branch

- `platform/blob-crypto`: binary attachment encryption primitives.
- `security/sessions`: CSP hardening plus a legacy server-cookie change. The
  CSP work may survive Clerk; cookie ownership must not be merged blindly.

## Launch blockers

1. Exercise Clerk sign-up, bootstrap, sign-in, sign-out, reconnect, and key
   recovery against a real Clerk tenant.
2. Connect `PresignGet`, then integrate attachment encryption into one
   browser-tested private-media path. Do not enable S3 before that connection.
3. Resolve group-key first-writer authority and add key epochs.
4. Add off-host Postgres and object-storage backups, service health checks, and
   deployment rollback.
5. Add browser coverage for auth, encrypted media, realtime reconnect, and
   unauthorized access.

See [`PLATFORM_MIGRATION_PLAN.md`](PLATFORM_MIGRATION_PLAN.md) and
[`SECURITY_PLAN.md`](SECURITY_PLAN.md) for design constraints.
