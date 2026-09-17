# MinIO migration delegation guide

This guide supplements the media-storage implementation plan. It identifies
edge cases that lower-cost or less capable coding agents commonly miss, along
with the tests and review boundaries needed to delegate work safely.

## Rules for every delegated task

Include these instructions in every task prompt:

- Work in a dedicated worktree and branch created from current `origin/master`.
- Read `AGENTS.md`, `docs/SECURITY_PLAN.md`, and the relevant architecture files
  before editing.
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

## Phase 0 — finish local media tickets

### Common mistakes

- Protecting `/api/v1/media/*` but forgetting the legacy `/uploads/*` alias.
- Authenticating the ticket endpoint while leaving the raw file route public.
- Requiring `Authorization` on `<img>` or `<video>` requests. Browsers do not
  attach custom bearer headers there.
- Putting the session JWT into `?token=`, exposing a reusable account
  credential.
- Checking for any valid JWT instead of checking conversation membership.
- Authorizing a client-provided `media_url` instead of a server-owned object.
- Accepting `https://attacker.example/messages/images/local.png` because only
  its path matches an owned object.
- Rejecting all absolute URLs and breaking legitimate legacy same-origin rows.
- Comparing origins with prefix matching, accidentally accepting a lookalike
  host such as `https://api.example.com.attacker.test`.
- Ignoring scheme, effective port, URL userinfo, or protocol-relative URLs.
- Signing only an expiry while omitting path and HTTP method.
- Treating `HEAD` as equivalent to a signed `GET` without explicitly choosing
  that policy.
- Using ordinary string comparison instead of constant-time HMAC comparison.
- Reusing the session JWT signing purpose without domain separation.
- Issuing a ticket before proving the message belongs to the requested
  conversation.
- Returning tickets for deleted, missing, or unattached messages.
- Accidentally making avatars and stickers private.
- Accepting HTML, SVG, JavaScript, or executable uploads.
- Checking MIME type or extension with `||` instead of requiring both.
- Trusting only the browser-supplied MIME type.
- Omitting `nosniff` and safe download disposition headers.
- Leaving orphaned files when storage succeeds but the database insert fails.
- Testing signing helpers without exercising HTTP and browser behavior.
- Failing to refresh tickets shortly before expiry.
- Creating React render loops through unstable selector fallbacks or URLs.
- Logging complete signed URLs.

### Required tests

- Anonymous private fetch returns `401`.
- Authorized conversation member obtains a ticket and media returns `200`.
- Authenticated non-member ticket request returns `403`.
- Expired, byte-tampered, wrong-path, and wrong-method tickets return `401`.
- External absolute and protocol-relative `media_url` values are rejected.
- A configured legacy same-origin absolute URL is accepted and normalized.
- Lookalike origin, wrong scheme, wrong port, and userinfo URL are rejected.
- Public avatar and sticker requests return `200` without tickets.
- HTML, SVG, and script uploads are rejected.
- A real browser confirms the image has `naturalWidth > 0`, or confirms the
  equivalent playable state for audio/video.
- Canonical and legacy media routes enforce the same policy.

## Phase 1 — storage contract and database model

### Common mistakes

- Storing a complete URL as object identity instead of an opaque object ID and
  storage key.
- Allowing clients to choose bucket names or object keys.
- Using original filenames as keys, enabling collisions, traversal, Unicode
  ambiguity, and information disclosure.
- Conflating uploader ownership with read authorization. The uploader controls
  creation; conversation membership controls reading.
- Marking an upload attached before a message references it.
- Omitting a pending state and accumulating untracked uploads.
- Allowing one object to be attached to unrelated messages without policy.
- Missing races between upload finalization and message creation.
- Omitting size, detected MIME type, checksum, and timestamps.
- Trusting finalization metadata supplied by the browser instead of storage.
- Allowing a user to finalize another user's object.
- Missing uniqueness constraints, foreign keys, or deletion behavior.
- Updating only `EnsureSchema` or only `init.sql`; this repository has two
  schema sources.
- Using a data-modifying CTE and incorrectly re-reading its changes from the
  base table in the same statement.
- Immediately deleting media during soft message deletion without handling
  shared references.
- Writing non-idempotent migrations.
- Omitting compatibility for existing `media_url` rows.

### Recommended state machine

```text
pending → attached → deleting → deleted
       ↘ expired/orphaned
```

### Required invariants

- Object ID and key are generated by the server.
- A pending object belongs to exactly one uploader.
- Finalization confirms object existence, size, checksum, and expected type.
- An attached private object is reachable only through an authorized message.
- Orphans expire without affecting attached objects.
- Database and object-storage deletion are retryable and idempotent.

## Phase 2 — MinIO infrastructure

### Common mistakes

- Exposing the MinIO administrator console publicly.
- Giving the application MinIO root credentials.
- Making the private bucket anonymous to solve browser image loading.
- Reusing one bucket and policy for public and private assets.
- Publishing S3 ports without TLS or reverse-proxy controls.
- Tracking access keys in Compose files.
- Using default credentials.
- Omitting persistent volumes.
- Treating a Docker volume as a backup.
- Checking only process liveness rather than S3 readiness.
- Starting the API before bucket and policy initialization completes.
- Writing a non-idempotent bucket bootstrap job.
- Using `depends_on` without health conditions.
- Giving the browser or web container storage credentials.
- Setting bucket CORS to `*` or allowing unnecessary methods.
- Forgetting clock synchronization for time-sensitive signatures.
- Treating one MinIO container as redundant storage.
- Pinning `latest` instead of an explicit image version.
- Adding a second lockfile or editing generated lock data manually.
- Missing Windows/Linux volume-permission differences.
- Forgetting upload-size limits in nginx, the API, and storage.

### Required evidence

- Clean-volume startup creates buckets and policies idempotently.
- Restart preserves objects.
- A private object without a signature is denied.
- The application credential cannot administer users or policies.
- Browser CORS permits only the required signed operations and origins.
- The administrator console is not publicly exposed.
- Health checks transition correctly.
- Backup and restore commands are documented and exercised using disposable
  data.

## Phase 3 — S3-compatible backend

### Common mistakes

- Depending on MinIO-only APIs and losing R2/S3 portability.
- Hardcoding path-style or virtual-host addressing.
- Signing an internal Docker hostname the browser cannot resolve.
- Signing one hostname while the browser requests another.
- Omitting region configuration where a provider expects it.
- Signing `PUT` while the browser uses `POST`, or vice versa.
- Issuing long-lived URLs.
- Allowing overwrite of an existing key.
- Signing arbitrary keys supplied by the client.
- Giving the client general bucket credentials.
- Returning storage errors containing internal endpoints or credentials.
- Treating successful upload as proof of expected size, type, or checksum.
- Failing to abort incomplete multipart uploads.
- Ignoring encoded slashes and object-key canonicalization.
- Modifying signed query parameters or headers in frontend URL helpers.
- Assuming every S3-compatible provider supports identical checksums.
- Treating storage-side encryption as E2E encryption.
- Deleting objects synchronously without retry handling.
- Falling back to public access when signing fails.

Prefer narrow interface methods such as:

```go
CreatePendingUpload(...)
FinalizeUpload(...)
CreateAuthorizedDownload(...)
DeleteObject(...)
StatObject(...)
```

Avoid a generic `GenerateSignedURL(clientSuppliedKey)` API.

### Required tests

- A presigned upload works only for one server-generated key.
- Wrong key, method, expiry, content type, or required signed header fails.
- Finalization rejects missing, oversized, mismatched, or foreign objects.
- Download capability creation requires an authorized object identity.
- The provider endpoint never comes from client input.
- Integration tests use a disposable MinIO bucket or isolated prefix.

## Phase 4 — client upload and display flow

### Common mistakes

- Sending a signed URL back as permanent message data.
- Persisting signed URLs in the database after they expire.
- Putting storage credentials in `NEXT_PUBLIC_*` variables.
- Treating storage upload completion as message completion.
- Creating the message before upload finalization.
- Producing duplicate messages or objects during retries.
- Reusing an expired capability without requesting another.
- Reusing one upload capability for multiple files.
- Uploading bytes that differ from authorized checksum or size.
- Exposing raw storage errors to users.
- Forgetting cancellation and multipart cleanup.
- Replacing optimistic `blob:` URLs in a render loop.
- Revoking a blob URL before the image finishes using it.
- Caching signed URLs in Zustand or local storage.
- Refreshing every signed URL simultaneously.
- Sending browser credentials to the storage origin unnecessarily.
- Setting `credentials: "include"` on signed object requests without need.
- Breaking safe download filenames or content disposition.
- Assuming the HTML `download` attribute works identically cross-origin.
- Forgetting Range requests for video and audio.
- Skipping real-browser tests because type-check succeeds.

### Required sequence

```text
request upload capability
→ PUT bytes
→ finalize object
→ create message with media_object_id
→ replace optimistic preview with confirmed message
```

### Required browser tests

- Image visibly loads.
- Video metadata and seeking work.
- Audio metadata and playback load.
- File download uses a safe filename.
- Expired download capability refreshes.
- Cancellation leaves no attached object.
- Failed finalization sends no message.
- Retry does not duplicate the message.
- A non-member cannot obtain a download capability.

## Phase 5 — legacy migration

This is one of the riskiest tasks to delegate.

### Common mistakes

- Updating the database before verifying copied object integrity.
- Deleting local files during the first migration pass.
- Treating missing files as successful migration.
- Producing duplicate objects when rerun.
- Migrating attacker-controlled external URLs as local paths.
- Following traversal paths or symlinks outside `UPLOAD_ROOT`.
- Trusting extensions instead of data.
- Losing MIME type, size, or original filename metadata.
- Loading large files entirely into memory.
- Holding a database transaction open during a large upload.
- Updating a stale message after concurrent edit or deletion.
- Treating ticket query strings as part of object identity.
- Normalizing `/uploads/*` and `/api/v1/media/*` inconsistently.
- Ignoring Windows versus Linux path separators and case sensitivity.
- Migrating duplicate references without shared-object accounting.
- Deleting a shared source file after migrating one reference.
- Omitting dry-run reconciliation totals.
- Reporting success without source, copied, updated, skipped, and failed counts.
- Providing no checkpoint/restart behavior.
- Skipping database and media backup before cutover.

### Safe migration stages

1. Inventory only.
2. Classify local, trusted legacy absolute, external, missing, duplicate, and
   malformed references.
3. Generate a dry-run object mapping.
4. Stream-copy while computing a checksum.
5. Verify object metadata and checksum.
6. Update one row or a bounded batch transactionally.
7. Record migration state and errors.
8. Rerun until no eligible rows remain.
9. Operate in dual-read mode.
10. Observe legacy fallback metrics.
11. Back up again.
12. Remove fallback in a separate PR.
13. Delete old media only after explicit approval.

Never allow a delegated agent to perform a production migration or deletion
autonomously.

## Phase 6 — production hardening

### Common mistakes

- Treating replication as a backup.
- Backing up objects without database mappings, or vice versa.
- Never testing restoration.
- Keeping backups on the same VPS and disk.
- Exposing metrics or administrator endpoints publicly.
- Logging signatures, keys, session tokens, or complete signed URLs.
- Providing no capacity, certificate, clock-skew, or backup alerts.
- Using retention rules that prevent legitimate user deletion.
- Enabling versioning without lifecycle cleanup and exhausting disk space.
- Running MinIO or backup jobs as root.
- Sharing one credential across bootstrap, API, backup, and administration.
- Rotating credentials without overlap and rollback.
- Applying unpinned upgrades directly to production.
- Describing a single disk as highly available.
- Failing to coordinate proxy body limits and upload timeouts.
- Backing up encrypted objects without the KMS keys needed to restore them.
- Treating `/health` as proof that uploads and downloads work.
- Auto-deploying storage changes without rollback.

### Required operational evidence

- Restore a disposable database and bucket from backup.
- Read an existing attachment after a service restart.
- Alert on low disk, failed uploads, failed backups, and certificate expiry.
- Confirm private bucket policy after deployment.
- Document credential rotation and compromised-key response.
- Record actual recovery-point and recovery-time objectives.

## Phase 7 — attachment E2E encryption

Do not delegate the cryptographic design to a weaker model.

### Common mistakes

- Encrypting with a user's password directly.
- Reusing a nonce with the same key.
- Using one attachment key indefinitely.
- Uploading plaintext thumbnails or revealing metadata unnecessarily.
- Storing the plaintext attachment key beside the ciphertext.
- Treating TLS or MinIO server-side encryption as E2E encryption.
- Using encryption without authentication.
- Failing to authenticate object ID, message ID, MIME type, or other context.
- Losing decryption capability on a second device.
- Giving removed group members access to new attachment keys.
- Omitting key rotation after group membership changes.
- Loading large attachments entirely into memory.
- Inventing chunk encryption without safe nonce derivation and ordering.
- Allowing chunk reordering, truncation, duplication, or substitution.
- Leaking plaintext through previews, logs, crash reports, or temporary files.
- Claiming deletion can erase copies recipients already downloaded.
- Migrating plaintext attachments without a compatibility policy.

This phase requires a written protocol, threat model, test vectors, and
independent expert review before implementation.

## Delegation boundaries

### Reasonable work for a cheaper model

- Compose service and health-check scaffolding.
- Environment-variable documentation.
- Provider-interface boilerplate.
- A basic MinIO client adapter.
- Unit-test scaffolding.
- UI progress and error states.
- Dry-run inventory reports.
- Documentation updates.

### Work requiring stronger independent review

- Authorization and capability signing.
- URL and origin canonicalization.
- Database constraints and state transitions.
- CORS and reverse-proxy configuration.
- Legacy migration logic.
- Production credentials and bucket policies.
- Backup and restore design.
- Attachment cryptography.

### Never delegate autonomously

- Production cutover.
- Deleting legacy files.
- Rotating production credentials.
- Changing retention or object-lock policy.
- Merging security PRs without independent review.
- Declaring security acceptance complete.

## Suggested prompt ending

Append this to delegated implementation tasks:

> Implement only the stated scope. Before editing, list the invariants and
> likely failure modes. After editing, provide the exact diff scope, commands
> run, exit codes, and remaining untested behavior. Do not commit or claim the
> security property is verified; an independent reviewer will decide that.
