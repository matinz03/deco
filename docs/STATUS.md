# Current engineering status

Updated 2026-08-12. This is a navigation and handoff document, not a claim of
independent verification. Read the linked plans for acceptance criteria.

## Integrated on `master`

- TypeScript 7 migration with the web app's compatibility arrangement for
  Next.js 16.
- React external-store snapshot fix, media CSP allowance, and Saved Messages
  duplicate-race migration.
- CI workflow and the `location`/`contact` message-type migration.

## In progress: `codex/security-program`

This worktree is ahead of `origin/master` by two commits. It contains an
isolated implementation of S1-1 private-media access tickets and a MinIO
delegation guide. It has not been merged.

The prior local acceptance run exercised raw/private access, authorized and
non-member ticket paths, tampering/expiry, public avatars, and a real browser
image load. Subsequent compatibility corrections for legacy same-origin
absolute upload URLs still need a fresh live check and independent review
before this branch is proposed for merge.

`PUBLIC_UPLOAD_ORIGIN` is required outside development for that branch. It
must equal the public API origin and exists solely to recognize legacy
same-origin absolute media URLs; other absolute media origins are rejected.

## Phase 0 audit — 2026-08-12

A read-only audit compared the current S1-1 implementation with the required
tests and failure modes in [`MINIO_DELEGATION_GUIDE.md`](MINIO_DELEGATION_GUIDE.md).
No source files were changed during the audit.

Commands run:

- `go -C apps/api build ./...` — exit code 0.
- `go -C apps/api test ./internal/handlers ./internal/storage` — exit code 0.
- `go -C apps/api vet ./...` — exit code 0.
- `go -C apps/api test ./...` — did not complete within the 120-second timeout.

The focused tests cover ticket expiry, path and method binding, basic external
URL rejection, same-origin legacy URL normalization, and upload helper
allowlists. The following evidence is still missing before S1-1 can advance:

- Live HTTP checks for anonymous private access, member ticket issuance,
  non-member `403`, header policy, public assets, and canonical/legacy route
  parity.
- Coverage for lookalike origins, wrong schemes or ports, URL userinfo, and
  multipart upload rejection.
- Real-browser checks for image loading, media playback/seeking, ticket refresh,
  cancellation, and retry behavior.

The audit also recorded implementation follow-ups requiring review: strict MIME
validation for `kind=file`, cleanup when database registration fails, replacing
client-controlled private `media_url` values with an opaque object identity,
and a policy for sticker/external asset URLs. Attachment bytes remain
plaintext; the existing client encryption covers message content, not uploads.
These findings are not security acceptance decisions.

## MinIO Phase 2 inventory — not started

The prerequisite inventory found no MinIO implementation to advance:

- `infra/compose/docker-compose.yml` has no MinIO service, bucket bootstrap,
  S3-readiness health check, or persistent MinIO volume.
- `apps/api/internal/storage/local.go` is still the only storage backend.
- `apps/api/internal/config/config.go` contains unused R2 placeholder fields,
  but no provider, endpoint, region, private/public bucket, or capability
  configuration.
- `apps/api/go.mod` has no S3-compatible client dependency or storage-provider
  abstraction.

No Phase 2 infrastructure, credentials, bucket policies, production migration,
or attachment-cryptography work was started. The S1-1 gate remains in force;
MinIO implementation must wait for the live compatibility run and independent
review listed below.

## S1-1 follow-up implementation — 2026-08-12

The local-media route was extracted into a testable registration helper and now
has HTTP coverage for anonymous private access, signed canonical and legacy
access, ticket tampering, wrong paths, expiry, unsupported methods, missing
files, public avatar/sticker access, traversal rejection, response headers, and
private-media cache prevention. Private responses now carry `Cache-Control:
private, no-store` so a browser or intermediary cannot extend a ticket's
lifetime using a cached response.

Upload validation now pairs the retained `kind=file` extensions with explicit
detected MIME types, instead of accepting every non-blocked type. Multipart
Content-Type fallback values are no longer trusted when the file bytes are
unknown. Gzip-detected Telegram `.tgs` stickers remain supported. Local storage
removes a partial file when its copy or close operation fails; after a definite
PostgreSQL registration error, it also attempts to remove the newly saved
private attachment. Ambiguous connection outcomes intentionally retain the
file for later reconciliation, because deleting it could leave committed object
metadata pointing to missing media.

Commands run after these changes:

- `go -C apps/api build ./...` — exit code 0.
- `go -C apps/api test ./cmd/server ./internal/handlers ./internal/storage` —
  exit code 0.
- `go -C apps/api vet ./...` — exit code 0.

Remaining S1-1 evidence and design work:

- Database-backed tests for ticket issuance: authorized members, non-members,
  deleted messages, and unregistered objects.
- Multipart endpoint tests for authentication, registration, and cleanup paths.
- Real-browser checks for image/video/audio loading and ticket refresh.
- The pending-to-attached object state machine and opaque object IDs required
  before the MinIO migration; messages still use legacy `media_url` values.

This work does not constitute S1-1 acceptance; the live compatibility run and
independent security review remain required.

## Next gates

1. Finish S1-1's live legacy-URL compatibility test and independent review.
2. Review the `security/sessions` work against its cookie, credential, and
   no-JavaScript acceptance criteria.
3. Do not begin the MinIO migration until S1-1 is complete. Then follow
   [`MINIO_DELEGATION_GUIDE.md`](MINIO_DELEGATION_GUIDE.md) phase by phase.

## Local environment

The temporary API and web servers used for media testing are stopped. Local
Postgres and Redis containers were intentionally left running. See the root
[`README.md`](../README.md) for startup commands and the two required `.env`
files.
