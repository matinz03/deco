# Quick wins — sub-hour enhancements

**Reviewed:** `master` at `f06deee` on 2026-09-30 · **Authored by:** Claude Code

> Every item below was proposed by an area reviewer (backlog/infra, web UI, web state, Go API) and then re-checked by a separate adversarial verifier against the cited lines. Estimates are the verifier's revised numbers and include verification (build, type-check, tests). This was **static analysis only** — nothing here has been built, run or tested yet, and line numbers are as of `f06deee`.

> Items marked **Sign-off: Yes** touch a surface listed in the [`FEATURE_BACKLOG.md`](FEATURE_BACKLOG.md) *Boundary* table or [`SECURITY_PLAN.md`](SECURITY_PLAN.md) and need Codex's approval before they land. This document does not change `SECURITY_PLAN.md` findings or sequencing; security items here are inputs for Codex.

**Suggested first hour:** [#1](#q1) + [#5](#q5) (about 40 min; unblocks large uploads, location sharing and video notes), then [#2](#q2), then [#3](#q3).

## Summary


### Broken today

| # | Enhancement | Est. | Sign-off |
|---|---|---|---|
| [1](#q1) | Uploads over 8 MB fail with 400 in Docker (scratch image has no `/tmp`) | 25m | No |
| [2](#q2) | Chat crashes when a message is deleted (hooks after an early return) | 30m | No |
| [3](#q3) | WebSocket hub can panic and take down the API (double `close(client.Send)`) | 55m | No |
| [4](#q4) | Privacy preferences ignored until Settings is opened; "Online status" toggle is a no-op | 25m | No |
| [5](#q5) | Location sharing and video notes blocked by `Permissions-Policy` | 15m | Reviewers split |
| [6](#q6) | Message edits and poll votes wipe reactions and sender on other clients | 25m | No |
| [7](#q7) | Other members' polls show the voter's choice as their own vote | 30m | No |
| [8](#q8) | Conversations marked read / read receipts sent while the tab is hidden | 25m | No |
| [9](#q9) | Mobile swipe "Delete" offered everywhere, fails silently, deletes owned groups unconfirmed | 30m | No |
| [10](#q10) | Messages missed during a WebSocket drop never appear (no resync on reconnect) | 55m | No |
| [11](#q11) | Conversation-list preview not updated when the last message is deleted | 20m | No |
| [12](#q12) | `infra/compose` never sets `PUBLIC_UPLOAD_ORIGIN`, so the API panics at boot on the `deploy.sh` path | 30m | Yes |

### Security hardening

| # | Enhancement | Est. | Sign-off |
|---|---|---|---|
| [13](#q13) | Repo-published fallback / placeholder JWT secrets pass the production guard (S2-3 gap) | 40m | Yes |
| [14](#q14) | `/users/search` and `/users/{id}` expose other users' email and moderation state | 50m | Yes |
| [15](#q15) | Reactions can target a message outside the path conversation; errors swallowed as 200 | 55m | No |
| [16](#q16) | `send_messages` restriction not enforced on edit, reactions, poll votes, uploads (S3-8) | 55m | Yes |
| [17](#q17) | Production deploy runs even when CI fails; new pushes cancel in-flight deploys | 45m | Yes |
| [18](#q18) | Bump vulnerable Go deps, add `govulncheck`, move off EOL Go 1.23 | 25m | Yes |
| [19](#q19) | Keep `TELEGRAM_BOT_TOKEN` out of errors and logs; cap sticker download size | 35m | No |
| [20](#q20) | REST CORS uses the raw `ALLOWED_ORIGINS` string (S3-3) | 40m | Yes |
| [21](#q21) | Legacy logout/login keeps decrypted messages in the conversation store | 20m | No |
| [22](#q22) | Personal `.claude/settings.local.json` committed to the public repo; `master` unprotected | ~5m | No |

### Robustness and UX

| # | Enhancement | Est. | Sign-off |
|---|---|---|---|
| [23](#q23) | Harden `api.ts` `request()`: cursor encoding, timeouts, readable errors | 25m | No |
| [24](#q24) | Typing indicators: throttle and expire on the web; member-only relay and throttle on the API | 35-45m | No |
| [25](#q25) | `upsertMessage` attaches incoming messages to the wrong optimistic message | 45m | No |
| [26](#q26) | Surface create-conversation failures; debounce and de-race user search | 45m | No |
| [27](#q27) | ChatHeader: overflow menu for groups/saved, dead call buttons, mobile back | 45m | No |
| [28](#q28) | Distinguish load failures and unknown conversations from "empty" | 55m | No |
| [29](#q29) | `reply_to_id` integrity: admin deletion failure, missing index, send validation | 50m | No |
| [30](#q30) | Remove the messages x members join fan-out in `GET /conversations` | 45m | No |
| [31](#q31) | Telegram sticker import is sequential and hits the 30s request deadline | 50m | No |
| [32](#q32) | A11y quick wins: form labels, named switches, light-theme contrast | 40m | No |
| [33](#q33) | Ship the PWA icons/favicon the manifest references | 35m | No |
| [34](#q34) | Nav unread dots should ignore muted conversations | 10m | No |
| [35](#q35) | ImageLightbox listeners only while open; keep conversation identity on presence events | 20m | No |
| [36](#q36) | Presence changes: publish once instead of once per online user | 35m | No |

### DX, CI, docs and cleanup

| # | Enhancement | Est. | Sign-off |
|---|---|---|---|
| [37](#q37) | Healthchecks in root `compose.yaml`; web waits for a healthy API | 15m | No |
| [38](#q38) | Structured access log with request IDs and `X-Request-Id` | 45m | No |
| [39](#q39) | Docker builds ignore lockfiles; `Dockerfile.web` copies `public/` to the wrong path | 40m | No |
| [40](#q40) | CI builds and boots the production Docker images | 40m | Yes |
| [41](#q41) | CI hygiene: fail on `init.sql` errors, least-privilege token, no duplicate runs | 45m | Yes |
| [42](#q42) | D-8 first slice: vitest harness for `apps/web`, run in CI | 50m | Yes |
| [43](#q43) | D-9 slice: real ESLint flat config for `apps/web`, re-enable CI lint | 60m | No |
| [44](#q44) | Remove unused web dependencies, hook, types and dangling config export | 25m | No |
| [45](#q45) | Dead config (`ANTHROPIC_API_KEY`) and unreachable states (A-4 delivered, A-5 busy/away) | 20m | No |
| [46](#q46) | Align AGENTS/API/DATABASE/ARCHITECTURE/SECURITY_PLAN docs with `master` | 35m | No |
| [47](#q47) | SETUP.md step that blocks `deploy.sh`; nginx body-size and caching errors | 35m | No |


## Details


### Broken today

<a id="q1"></a>
#### 1. Uploads over 8 MB fail with 400 in Docker (scratch image has no `/tmp`)

**Estimate:** 25m · **Sign-off:** No

**Problem:** The API runtime is FROM scratch and has no /tmp. ParseMultipartForm(8 MiB) writes any larger file part to os.CreateTemp in /tmp. In the container that call fails and the handler returns 400 'failed to parse upload'. Any 8-100 MB upload (encrypted attachments up to 20 MB, saved-message video up to 100 MB) therefore fails in both compose stacks, while `go run` works because the host has /tmp. S3 spool() also calls CreateTemp for non-seekable Telegram downloads.

**Evidence:**

- infra/docker/Dockerfile.api:20-25 - scratch runtime; only the CA bundle and /api are copied
- apps/api/internal/handlers/uploads.go:29 - multipartMemoryBytes = 8 << 20
- apps/api/internal/handlers/uploads.go:146 - ParseMultipartForm spills larger parts to os.TempDir()
- apps/api/internal/handlers/uploads.go:41-47 - the parse error becomes 400 'failed to parse upload'
- apps/api/internal/handlers/uploads.go:189-201 - per-kind limits of 25/100/50 MB
- apps/web/src/store/conversations.ts:186 - client allows 20 MB encrypted attachments
- apps/api/internal/storage/s3.go:315 - spool() os.CreateTemp
- apps/api/internal/telegram/client.go:141 - DownloadFile returns a non-seekable body
- compose.yaml:36-60 and infra/compose/docker-compose.yml:77-133 - no tmpfs or TMPDIR for api

**Proposed change:** Builder stage: `RUN install -d -m 1777 /runtime-tmp`. Runner stage: `COPY --from=builder /runtime-tmp /tmp`, using --chmod=1777 if the mode is not preserved. Optionally also add `tmpfs: [/tmp]` to api in both compose files to bound disk use. Do not raise multipartMemoryBytes, because that would make it a memory DoS instead.

**Verify:** Build the api image and start root compose.yaml (legacy auth). Register or log in, then `curl -H 'Authorization: Bearer $T' -F kind=video -F 'file=@12mb.mp4;type=video/mp4' http://127.0.0.1:8080/api/v1/uploads/`. Before the fix this returns 400 'failed to parse upload'; after it returns 2xx. A 1 MB file succeeds in both cases as a control.

**Reviewer note:** The problem is bigger than described. With the S3 backend, which infra compose uses by default (docker-compose.yml:107), EVERY upload fails in the container, not only files over 8 MiB. uploads.go wraps the file in bufio.NewReader and passes that to storage.Save (uploads.go:103), and bufio.Reader is not an io.ReadSeeker. So S3Backend.Put -> spool() always reaches os.CreateTemp("") (s3.go:211, 314-315), which fails on scratch with no /tmp, and the handler returns 500 'failed to save upload'. With the local backend only parts over 8 MiB fail, with 400 from ParseMultipartForm. Telegram sticker import to S3 fails the same way. The Dockerfile fix is right. The API runs as root (there is no USER), so the mode of /tmp does not matter today, and --chmod is only needed if a non-root USER is added later. The optional compose `tmpfs: [/tmp]` limits RAM, not disk. If it is used, give it a size (for example /tmp:size=256m), or leave it out and use the container's writable layer. Also verify an S3-backend upload of a 1 MB file, which fails today; the 1 MB control in the proposed verification only works for the local backend.

<a id="q2"></a>
#### 2. Chat crashes when a message is deleted (hooks after an early return)

**Estimate:** 30m · **Sign-off:** No

**Problem:** MessageBubble calls useMediaTicketUrl() and then returns null early when msg.isDeleted, before about 20 more hooks (useAuthStore, several useConversationStore selectors, 9 useState, useRef, useMotionValue/useTransform, 3 useEffect). The store never removes deleted messages. Both the optimistic deleteMessage and the WS message.deleted handler keep the item in the array with isDeleted: true, and ChatPanel does not filter them out. So the same MessageBubble instance (key = msg.id) re-renders with fewer hooks. React throws 'Rendered fewer hooks than expected', and the nearest boundary (inbox/[conversationId]/error.tsx) replaces the whole chat with 'Loading conversation...' until its silent auto-reset. This happens on every delete, by you or by the other party. It also happens in reverse when a failed delete rolls back (isDeleted goes from true to false, so more hooks run). error.tsx never logs the error, which is why this went unnoticed.

**Evidence:**

- apps/web/src/components/chat/MessageBubble.tsx:137 - useMediaTicketUrl(msg) runs first (itself ~10 hooks, see apps/web/src/lib/use-media-ticket.ts:122-131)
- apps/web/src/components/chat/MessageBubble.tsx:138 - `if (msg.isDeleted) return null;` early return
- apps/web/src/components/chat/MessageBubble.tsx:145-178 - hooks after the early return (useAuthStore, useConversationStore x6, useState x9, useRef x4, useMotionValue)
- apps/web/src/components/chat/MessageBubble.tsx:202,210 - useEffects after the early return
- apps/web/src/store/conversations.ts:990-998 - optimistic delete keeps the item with isDeleted: true
- apps/web/src/store/conversations.ts:1004-1011 - rollback flips isDeleted back to false
- apps/web/src/store/conversations.ts:1318-1327 - WS message.deleted also keeps the item with isDeleted: true
- apps/web/src/components/chat/ChatPanel.tsx:90-122 - items built from convMessages with no isDeleted filter
- apps/web/src/app/(app)/inbox/[conversationId]/error.tsx:7-22 - boundary auto-resets silently and ignores the `error` prop

**Proposed change:** (1) In ChatPanel, build `items` from `convMessages.filter(m => !m.isDeleted)` so date dividers and grouping also ignore tombstones. (2) In MessageBubble, move the `if (msg.isDeleted) return null;` below the last hook, just before the JSX return, so the hook order is unconditional. (3) In error.tsx, accept `error` and `console.error` it in the effect, so future render crashes are not masked by the silent retry. Optional follow-up: `void deleteMessage(...)` in MessageBubble (context menu onDelete) swallows the rethrown error. Catch it and surface it through the existing editError-style inline error.

**Verify:** `pnpm --filter @deco/web dev`. Open a DM in two browsers and delete a message you sent via right-click > Delete. Before: the console shows React's hooks-order error and the chat briefly shows 'Loading conversation...'. After: the bubble disappears with no console error and no boundary flash, in both the sender and the receiver window. Also block DELETE /messages in DevTools (request blocking) so the rollback path runs, and confirm there is still no hooks error. `pnpm type-check` passes.

**Reviewer note:** The finder has this right. The early return at MessageBubble.tsx:138 comes after useMediaTicketUrl and before about 20 more hooks. conversations.ts:990-998 and :1318-1327 keep the tombstone in the array, and nothing in ChatPanel.tsx:90-122 filters it out. React throws in production too (minified #300/#310), so this is not only a dev warning. The impact is worse than the finder says: error.tsx remounts the whole segment, so ChatPanel refetches, and MessageInput loses its draft and replyTo on every delete. After reset it recovers, because a fresh instance consistently returns null. Rollback on a fresh instance then crashes the other way ('more hooks'). Additions: (1) Also drop tombstones from the replyCounts memo (ChatPanel.tsx:84-87), or deleted replies will inflate thread badges. (2) ThreadPortal still gets the unfiltered list; that is harmless but can be filtered the same way. (3) apps/web has no test runner (backlog D-8), so verification is manual with the API stack running. Budget about 10 minutes for that.

<a id="q3"></a>
#### 3. WebSocket hub can panic and take down the API (double `close(client.Send)`)

**Estimate:** 55m · **Sign-off:** No

**Problem:** Hub.Run closes client.Send on every unregister, whether or not the client is still in the map. A client can be unregistered twice. First, the hub unregisters it on backpressure by sending `h.unregister <- client` from inside Run, and it does this again for every broadcast that finds the buffer still full. Then readPump's defer unregisters it again when the socket closes. The second unregister runs `close(client.Send)` on a closed channel, and the panic hits the hub goroutine, which has no recover, so the whole API process exits. This happens whenever a slow or frozen client lets its 256-message buffer fill: a busy group plus presence traffic during the 10s writeWait is enough. There is a second path. register and unregister are separate channels and `select` picks between ready cases at random. A socket that drops right after the handshake can therefore be unregistered first (Send closed, map untouched) and registered second. sendPresenceSnapshot and later broadcasts then send on a closed channel, which panics even inside a select with a default branch. Finally, Run sending to its own buffered channel deadlocks the hub for good once 256 unregisters are queued.

**Evidence:**

- apps/api/internal/websocket/hub.go:98-113 — unregister calls close(client.Send) with no check that the client was present
- apps/api/internal/websocket/hub.go:115-126 — on a full buffer, Run re-enqueues h.unregister <- client from inside its own loop, once per broadcast
- apps/api/internal/websocket/hub.go:63-64 — register and unregister are separate channels (256 buffer each), so their order is not guaranteed
- apps/api/internal/websocket/hub.go:189-192 — sendPresenceSnapshot sends on client.Send inside select/default; a closed channel still panics
- apps/api/internal/websocket/handler.go:108 — hub.register <- client
- apps/api/internal/websocket/handler.go:120-126 — readPump defer always does hub.unregister <- c
- apps/api/internal/websocket/ (no hub_test.go) — hub fanout has no tests (AGENTS.md also lists it as untested)

**Proposed change:** 1) Replace register/unregister with a single ordered channel `membership chan membershipOp{client *Client; add bool}`. FIFO then guarantees a client's register is handled before its unregister. 2) Extract `func (h *Hub) removeClient(c *Client) (removed, lastConn bool)`. It deletes c from the map and closes c.Send only when c was present; unregistering an unknown client does nothing. 3) In the broadcast default branch, call removeClient inline (and broadcast offline if lastConn) instead of `h.unregister <- client`. 4) Add a test-only `clientCount()` that reads under the lock. 5) New hub_test.go: build the Hub with `redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1, DialTimeout: 50*time.Millisecond})`. Redis errors are already ignored by setPresence and broadcastPresence. Start Run, then: register and unregister twice; fill a client's Send (cap 1 in the test) and broadcast to it, then unregister it; assert no panic and an empty map.

**Verify:** cd apps/api && go build ./... && go vet ./... && go test ./internal/websocket/ -race -count=1 -run Hub -v. Run the new double-unregister test against the old hub.go first: it should crash with 'close of closed channel', which confirms the test reproduces the bug. Then check that the existing handler_test.go and clerk_handshake_test.go still pass.

**Reviewer note:** The evidence holds. hub.go:110 calls close(client.Send) with no check that the client was present. hub.go:124 enqueues another unregister for every broadcast that hits a full buffer, and handler.go:124 adds one more from readPump's defer. So any slow client that fills its 256 buffer crashes the process through the hub goroutine, which has no recover. The register/unregister reorder (separate buffered channels, random select) and the self-send deadlock are also real. A simpler alternative to the single membership channel: give Client a `removed bool` field that only Run touches. unregister returns early if it is set, then sets it and closes Send; register skips a client whose flag is already set. That fixes both paths without changing channel topology or handler.go. Test notes: CI starts no Redis and does not run -race (ci.yml go test -p 1 ./... -count=1), so the unreachable-Redis client with DialTimeout is required. Inject broadcastMsg straight into h.broadcast from the package-internal test. Budget time for goroutine-sync flakiness: poll clientCount with a deadline and never use sleeps. This also answers the SECURITY_PLAN Realtime hypothesis 'a slow client cannot stall the hub', so tell Codex, but there is no sign-off gate.

<a id="q4"></a>
#### 4. Privacy preferences ignored until Settings is opened; "Online status" toggle is a no-op

**Estimate:** 25m · **Sign-off:** No

**Problem:** usePreferencesStore.hydrate() is only called from the Settings page. After any reload that does not visit /settings, the store holds its defaults. (a) pushNotifications=false, so notifyAboutMessage() returns immediately: no in-app toasts and no native notifications for users who enabled them. (b) readReceipts=true, so ChatPanel calls api.messages.markRead on every conversation open even for users who turned read receipts off. That is a privacy opt-out that silently stops working after reload. Separately, the 'Online status - Show when you're active to other users' toggle writes showOnlineStatus, but nothing in the app reads it. The UI promises a privacy control that does nothing.

**Evidence:**

- apps/web/src/app/(app)/settings/page.tsx:56-58 - the only hydrate() call site for preferences
- apps/web/src/store/preferences.ts:40-44 - defaults pushNotifications:false, readReceipts:true
- apps/web/src/app/providers.tsx:10-34 - boot hydration covers only useAuthStore
- apps/web/src/store/conversations.ts:1730-1731 - `if (!pushNotifications) return;` gates both toasts and native notifications
- apps/web/src/components/chat/ChatPanel.tsx:54,145,152 - markRead gated on the un-hydrated readReceipts default
- apps/web/src/app/(app)/settings/page.tsx:519-524 - Online status toggle; grep shows showOnlineStatus is read nowhere outside settings and preferences.ts
- apps/web/src/store/preferences.ts:40-58 - defaults readReceipts:true / pushNotifications:false; state is only loaded from localStorage inside hydrate()
- apps/web/src/app/(app)/settings/page.tsx:56-58 - the only caller of usePreferencesStore.hydrate()
- apps/web/src/components/chat/ChatPanel.tsx:54 - reads readReceipts (the un-hydrated default true)
- apps/web/src/components/chat/ChatPanel.tsx:145 and :152 - `if (readReceipts) void api.messages.markRead(...)` fires on every conversation open and on every new message
- apps/web/src/store/conversations.ts:1730-1731 - notifyAboutMessage returns early while pushNotifications is still the default false
- apps/web/src/app/(app)/settings/page.tsx:519-524 - the Online status SettingRow writes setPref('showOnlineStatus')
- apps/web/src/store/preferences.ts:13,44,56 - the only places showOnlineStatus exists; a grep of apps/web/src finds no reader outside Settings
- apps/api - a grep for show_online_status/showOnlineStatus finds nothing
- apps/api/internal/websocket/hub.go:94-96 - on register the hub sets presence and broadcasts 'online' unconditionally
- docs/SECURITY_PLAN.md:173 - lists 'Presence/typing may leak activity for users who disabled showOnlineStatus' as an open hypothesis

**Proposed change:** Call `usePreferencesStore.getState().hydrate()` once on mount in HydrationGate in providers.tsx, next to the auth hydrate, and keep the settings-page call harmless. Optionally add a `storage` event listener so a change in one tab applies to other tabs. For the online-status row, wiring it needs server presence changes (out of scope), so render it disabled with the description 'Coming soon', or remove it until the server honors it. Known side effect to call out in the PR: last_read_at is the only unread cursor server-side, so a user who honestly has read receipts off will now keep seeing unread badges after reload. That limitation was masked by this bug. Log it as a follow-up rather than fixing it here.

**Verify:** Enable Push notifications in Settings and reload on /inbox without visiting Settings. Have another account message you in a non-active conversation: a toast now appears (before: nothing). Turn Read receipts off, reload directly on /inbox/<id>, and watch the Network tab: no POST .../messages/read (before: one per open). The Online status row is disabled or removed. `pnpm type-check`.

**Reviewer note 1:** Confirmed. The only hydrate() call is settings/page.tsx:58. useHydration.ts hydrates only auth and is not used anywhere. notifyAboutMessage bails at conversations.ts:1731. ChatPanel.tsx:145/152 uses the default readReceipts=true. showOnlineStatus is read nowhere. Hydrating inside HydrationGate's effect is safe for ordering: the gate returns null until auth isHydrated (store default false, auth.ts:205), so children and ChatPanel's markRead effect mount after preferences are loaded. The unread-badge side effect is real and should be written up in the PR. Server unread_count uses mb.last_read_at (conversations.go:47), and MarkRead (messages.go:768-800) is the only writer. So users who honestly have read receipts off will keep seeing badges after reload. Get a product decision, or add a follow-up to split 'mark read locally' from 'broadcast read'. Disabling the Online status row is the correct scope.

**Reviewer note 2:** Confirmed: settings/page.tsx:58 is the only caller of hydrate(). The finder missed a side effect. Once readReceipts=false really applies after a reload, a hidden coupling shows up: members.last_read_at is only advanced by POST /messages/read (messages.go:768-800), and the server's unread_count is derived from it (conversations.go:47). So users who opt out will see their unread badges come back on every reload and on every other device. Today this is masked, because the pref silently resets to true on reload. Ship the boot hydrate: the notifications half is a pure win. Pair it with a one-line Settings description noting the unread-sync trade-off, or record a product/server decision to split 'advance last_read_at' from 'broadcast receipt'. Note that other members' lastReadAt is also exposed through the members payload (conversations.go:351,535) and drives 'Seen' (MessageBubble.tsx:926-948), so real receipt privacy is a larger server design. Put the prefs hydrate in its own effect so it runs in Clerk mode too (providers.tsx:16-18 only hydrates auth in legacy mode).

**Reviewer note 3:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q5"></a>
#### 5. Location sharing and video notes blocked by `Permissions-Policy`

**Estimate:** 15m · **Sign-off:** Reviewers split

**Problem:** next.config.ts sends `camera=(), geolocation=()`, which disables both features for every origin, including the app itself. The location composer's getCurrentPosition always fails with 'We couldn't access your location' and never shows a prompt. Video-note recording calls getUserMedia({video:true}) and fails with 'Camera and mic access denied.' A-2 is otherwise complete on master, so this header is the last blocker.

**Evidence:**

- apps/web/next.config.ts:107-110 - Permissions-Policy: camera=(), microphone=(self), geolocation=()
- apps/web/src/components/chat/MessageInput.tsx:894-913 - navigator.geolocation.getCurrentPosition; error branch shown
- apps/web/src/components/chat/MessageInput.tsx:326-327,357-359 - getUserMedia video+audio; denial message
- apps/web/src/components/chat/MessageInput.tsx:446-476 - location/contact send path exists
- infra/compose/init.sql:66 and apps/api/internal/db/postgres.go:100-126 - enum already includes location/contact
- apps/web/next.config.ts:107-110 - `camera=(), microphone=(self), geolocation=()`
- apps/web/src/components/chat/MessageInput.tsx:326-327 - getUserMedia with video:true for video notes
- apps/web/src/components/chat/MessageInput.tsx:359 - misleading 'Camera and mic access denied.' message
- apps/web/src/components/chat/MessageInput.tsx:901-911 - navigator.geolocation.getCurrentPosition and its 'Check browser permissions' error
- docs/SECURITY_PLAN.md - no mention of Permissions-Policy, so the restriction is not a documented security decision

**Proposed change:** Change the value to `camera=(self), microphone=(self), geolocation=(self)`. Check that nginx (infra/nginx/nginx.conf) does not override the header; it currently does not.

**Verify:** Run pnpm type-check and pnpm build. Start the app and check `curl -sI http://localhost:3000/login | grep -i permissions-policy`. In the browser console, document.featurePolicy.allowsFeature('geolocation') and ('camera') should return true. Sharing a location now shows a permission prompt and sends a location bubble; recording a video note opens the camera.

**Reviewer note 1:** Confirmed at next.config.ts:107-110. The value dates from the initial scaffold and was never revisited in the CSP-hardening commits, so it is not a deliberate decision. The video toggle (MessageInput.tsx:433) and the geolocation-only location picker (:894-913) have no fallback, so both features are dead in Chromium. Firefox largely ignores Permissions-Policy, so test in Chrome. It is not in the sign-off boundary, but it sits next to the S2-2 CSP header, so mention it to Codex in the PR.

**Reviewer note 2:** The header at next.config.ts:107-110 is real and nothing in infra overrides it (grep finds no other Permissions-Policy). One claim is wrong. The attachment-menu 'Video camera' and 'Camera' actions open `<input type=file capture="environment">` (MessageInput.tsx:530-544). Permissions-Policy does not gate that, so it still works. Only the hold-to-record video note is blocked: getUserMedia with video at :326-327, toggled via setVideoMode at :433/:725. Geolocation (:901) is blocked too. The fallback should therefore hide the video-note mode toggle and the 'use current location' button, not the 'Video camera' attachment action. document.featurePolicy is deprecated and Chrome-only. Verify with document.permissionsPolicy?.allowsFeature, or check the response header. This header lives in the same Codex-owned headers block as the S2-2 CSP work (SECURITY_PLAN.md:26,107), so sign-off is correctly flagged.

<a id="q6"></a>
#### 6. Message edits and poll votes wipe reactions and sender on other clients

**Estimate:** 25m · **Sign-off:** No

**Problem:** The Edit handler's RETURNING row has no sender and no reactions, and that row is both the REST response and the message.edited broadcast. VotePoll's payload also carries no reactions. mapMessage turns a missing sender into undefined and missing reactions into []. upsertMessage then does {...existing, ...incoming}, so after any edit or poll vote every member loses that message's reactions until reload. In groups the sender header and avatar also disappear or show 'Unknown'. The editor's own copy is wiped too, through the editMessage success path.

**Evidence:**

- apps/api/internal/handlers/messages.go:630-653 - Edit scans only message columns (no sender, no reactions) and broadcasts that struct as message.edited
- apps/api/internal/handlers/messages.go:575-610 - VotePoll reloads the sender, sticker and poll but not reactions before broadcasting
- apps/api/internal/models/models.go:78,93 - Sender and Reactions are omitempty, so both are absent from the JSON
- apps/web/src/lib/api.ts:112,125 - mapMessage: sender undefined when absent, reactions [] when absent
- apps/web/src/store/conversations.ts:1411 - `{ ...next[existingIndex], ...incoming }` overwrites reactions and sender
- apps/web/src/store/conversations.ts:1246-1258 and :957-969 - the message.edited handler and the editMessage success path both upsert the partial message
- apps/web/src/components/chat/MessageBubble.tsx:144,309,740 - the sender name/avatar and the reactions row depend on these fields

**Proposed change:** Add a mergeEditedMessage(existing, incoming) helper used by the message.edited handler, the editMessage success path and the votePoll success path. Keep existing.reactions (reactions have their own message.reaction events). Use incoming.sender ?? existing.sender. When both have a poll, take counts from incoming and votedByMe from existing (this folds in web-poll-votedbyme-broadcast). Apply the same helper to conversations[].lastMessage.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q7"></a>
#### 7. Other members' polls show the voter's choice as their own vote

**Estimate:** 30m · **Sign-off:** No

**Problem:** VotePoll rebuilds the poll with votedByMe computed for the VOTER and broadcasts it as message.edited to every member. Each recipient merges that into its copy, so the voter's option is highlighted as the recipient's vote and the recipient's real vote marker is cleared. The optimistic count logic in votePoll trusts votedByMe, so the recipient's next vote also shows wrong interim counts.

**Evidence:**

- apps/api/internal/handlers/messages.go:600 - `msg.Poll = h.loadPoll(r, tx, msg.ID, userID)` (the voter's perspective)
- apps/api/internal/handlers/messages.go:991 - `BOOL_OR(v.user_id = $2) AS voted_by_me`
- apps/api/internal/handlers/messages.go:604-609 - that message is broadcast to all conversation members as message.edited
- apps/web/src/store/conversations.ts:1238-1259 - the message.edited handler upserts the payload into messages and lastMessage
- apps/web/src/store/conversations.ts:1411 - upsert does `{...existing, ...incoming}`, so the whole poll object is replaced
- apps/web/src/components/chat/MessageBubble.tsx:495-502 - option.votedByMe drives the 'your vote' styling
- apps/web/src/store/conversations.ts:756-766 - optimistic vote maths depends on votedByMe

**Proposed change:** Client-side and self-contained. In the message.edited handler, when both the existing message and the incoming one have a poll, build a merged poll: take question, totalVotes and each option's voteCount from the incoming poll, and take votedByMe from the existing option with the same id (default false). Apply the same merge to conversations[].lastMessage. The current user's own votes still get authoritative votedByMe from the REST response in votePoll (conversations.ts:783-794). Optional server-side hardening in the same change: zero out VotedByMe in the broadcast copy (messages.go:604-609) so no perspective data leaks.

**Verify:** In a group with users A and B, A creates a poll and B votes for option 1. Then A votes for option 2. On B's screen option 1 must stay marked as B's vote while the counts update to 1/1. Before the fix, B sees option 2 marked as their own vote.

**Reviewer note:** Confirmed: loadPoll is called with the voter's userID (messages.go:600) and broadcast to all members as message.edited (messages.go:606-610); upsert spreads the whole poll (conversations.go:1411). Limitation of the client-only merge: when the same user votes from another tab or device, this tab keeps a stale votedByMe, since the payload carries no voter id. Acceptable. The same message.edited path also wipes reactions and sender (see missed candidate web-edited-event-preserves-reactions-sender), so fix both in one merge function. The optional server-side zeroing needs `go build ./...` plus a test per AGENTS.md rule 2; keep it out of the 30 minutes.

<a id="q8"></a>
#### 8. Conversations marked read / read receipts sent while the tab is hidden

**Estimate:** 25m · **Sign-off:** No

**Problem:** When the user has a conversation open but the tab is in the background, every incoming message changes convMessages.length. ChatPanel's effect then clears the local unread count and POSTs markRead. The server sets last_read_at and status='read' and broadcasts message.read, so the sender sees 'Read' although the user has not looked. At the same moment the store raises a native notification, because it treats document.hidden as 'not viewing'. The two paths contradict each other, and the read receipt is false.

**Evidence:**

- apps/web/src/components/chat/ChatPanel.tsx:149-153 - markConversationRead plus api.messages.markRead on every convMessages.length change, with no visibility check
- apps/web/src/store/conversations.ts:1200-1204 - shouldNotify already treats document.hidden as not viewing the active conversation
- apps/api/internal/handlers/messages.go:768-800 - MarkRead updates last_read_at and messages.status='read' and broadcasts EventRead
- apps/web/src/components/chat/MessageBubble.tsx:926-939 - the sender's read receipt is computed from member.lastReadAt >= sentAt
- apps/web/src/components/chat/ChatPanel.tsx:149-153 - an effect on convMessages.length calls markConversationRead and api.messages.markRead with no visibility check
- apps/web/src/store/conversations.ts:1201-1204 - shouldNotify treats document.hidden as not viewing the active conversation
- apps/web/src/store/conversations.ts:1222-1225 - unreadCount is never incremented for the active conversation, even while hidden
- apps/api/internal/handlers/messages.go:778-797 - MarkRead advances last_read_at and broadcasts message.read
- apps/web/src/components/chat/MessageBubble.tsx:926-948 - the 'Seen' label is derived from members' lastReadAt

**Proposed change:** In the ChatPanel convMessages.length effect (and the mount effect), skip markConversationRead and markRead when document.visibilityState === 'hidden'. Add a visibilitychange listener that runs both once the tab becomes visible again, gated on readReceipts for the API call. No server change.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q9"></a>
#### 9. Mobile swipe "Delete" offered everywhere, fails silently, deletes owned groups unconfirmed

**Estimate:** 30m · **Sign-off:** No

**Problem:** ConversationItem renders a swipe Delete action for every row: DMs, Saved Messages, and groups where the user is not owner. The server only allows the owner of a group to delete it and returns 400 or 403 for everything else. Because the call is `void deleteConversation(...)` with no catch, the row snaps closed, nothing happens, and an unhandled rejection is logged. For the one case that does work (group owner), the swipe deletes the group for every member at once and irreversibly, with no confirmation. The header flow (ChatHeader) does show window.confirm for the same action.

**Evidence:**

- apps/web/src/components/layout/ConversationList.tsx:384-396 - Delete action rendered unconditionally, `void deleteConversation(conversation.id)`
- apps/web/src/components/layout/ConversationList.tsx:315 - no role or type information used
- apps/web/src/components/chat/ChatHeader.tsx:218-228 - the header path confirms first ('Delete ... permanently? This cannot be undone.')
- apps/api/internal/handlers/conversations.go:320-328 - 'only groups can be deleted' (400) and 'only the group owner can delete this group' (403)
- apps/web/src/store/conversations.ts:1159-1170 - deleteConversation throws on API failure and does not update state

**Proposed change:** In ConversationRow, compute `canDelete = conversation.type === 'group' && members.find(m => m.userId === currentUserId)?.role === 'owner'` and pass it to ConversationItem. Render the Delete button only when canDelete, and shrink ACTION_WIDTH when only Mute is shown. Wrap the delete in a confirm that reuses the ChatHeader copy, catch errors, and show them with a toast or `window.alert`. If the deleted conversation is the one open (pathname match), `router.push('/inbox?tab=groups')`.

**Verify:** Use the mobile viewport (375px) in DevTools. Swipe a DM row left: only Mute appears. Swipe a group you do not own: only Mute. Swipe a group you own and tap Delete: a confirm dialog appears. Cancel keeps the group; OK removes it from the list for both members. The console shows no unhandled rejection. `pnpm type-check`.

**Reviewer note:** Confirmed. The Delete action at ConversationList.tsx:384-396 is unconditional and has no confirm or catch. The server allows only type 'group' plus owner (conversations.go:320-328). Members, including role, come with the list response (attachMembers at conversations.go:113), so canDelete is computable in the row. Channels are also rejected with 400 and should be excluded; the check `type === 'group'` already does that. isActive is already a ConversationItem prop, so use it for the post-delete redirect. The desktop Group settings > Delete group path has the same missing catch: ChatHeader.tsx:218-228 uses try/finally, so a failure is an unhandled rejection with no memberError. Fix it in the same change; it takes about 3 more minutes.

<a id="q10"></a>
#### 10. Messages missed during a WebSocket drop never appear (no resync on reconnect)

**Estimate:** 55m · **Sign-off:** No

**Problem:** When the socket drops (every deploy restarts the API, laptop sleep, network blip) and then reconnects, the client never refetches anything. Messages sent while it was down do not appear in the open chat, and sidebar previews and unread counts stay stale, until the user switches conversation or reloads. Presence is also only merged: the server's reconnect snapshot lists online users only, so anyone who went offline during the gap stays 'online' forever. Separately, fetchMessages replaces the whole list, so a 'sending' or 'failed' optimistic message (including its media retry button) disappears when the user re-enters the chat.

**Evidence:**

- apps/web/src/lib/websocket.ts:111-113 - onopen only resets the backoff delay; nothing lets listeners know a (re)connect happened
- apps/web/src/lib/websocket.ts:158-162 - the only subscription API is per-event-type
- apps/web/src/store/conversations.ts:266-269 - the store subscribes to '*' events only
- apps/web/src/components/chat/ChatPanel.tsx:140-147 - fetchMessages runs only when conversationId changes
- apps/web/src/components/layout/ConversationList.tsx:54-56 - fetchConversations runs once on mount
- apps/api/internal/websocket/hub.go:95 and :175-194 - on register the server sends a snapshot of ONLINE users only
- apps/web/src/store/conversations.ts:1330-1362 - the presence handler only merges, never clears
- apps/web/src/store/conversations.ts:353-364 - fetchMessages overwrites messages[conversationId], dropping temp_ entries
- deploy.sh:53-54 - `compose up -d` restarts the API on every deploy, disconnecting every client

**Proposed change:** In WSClient, add onOpen(listener) that returns an unsubscribe function, plus a hasOpenedOnce flag (reset in disconnect()). In socket.onopen, call the listeners with {reconnect: hasOpenedOnce}, then set the flag. In the conversations store creator (behind the window guard), subscribe: on reconnect, set({presence:{}, typing:{}}) (onopen runs before the snapshot frames arrive), call fetchConversations(), and if activeConversationId is set, resync that conversation. Change fetchMessages (or add a merge variant for resync) to merge by id into the existing list and re-append any local temp_ messages instead of replacing the list, so older loaded pages and unsent or failed messages survive.

**Verify:** Open a DM in browser A. Stop the API (or block the WS in DevTools), send two messages from browser B through a second API instance or after a restart, then bring the API back. Once A reconnects (up to about 30s of backoff, or focus the tab), both messages should appear without navigating. Also: start a media upload, fail it (go offline), switch chats and come back: the failed bubble with Retry should still be there.

**Reviewer note:** The core claims hold: no onopen hook (websocket.ts:111-113), fetch only on mount or conversation change, a snapshot of online users only (hub.go:95,175-194), merge-only presence (conversations.ts:1355-1361), and fetchMessages replacing the list, which drops temp_ entries and the retry bubble (conversations.ts:359-360). Citation fix: deploy.sh:53-54 is inside rollback(); the normal deploy restart is deploy.sh:76-77, and deploys use infra/compose/docker-compose.yml. The estimate is only achievable with a narrowed merge: union the newest page with the existing list by id and re-append local temp_/failed entries. If the fetched page doesn't overlap the existing list (a gap of 50+ messages), replace the list and reset messagesHasMore rather than keeping older pages with a hole. Keep messagesHasMore consistent with whichever pages are retained. Clearing presence in onopen causes a brief flicker until the snapshot frames arrive (acceptable). fetchConversations also re-decrypts every cached message (conversations.ts:347-348), so avoid calling it more than once per reconnect.

<a id="q11"></a>
#### 11. Conversation-list preview not updated when the last message is deleted

**Estimate:** 20m · **Sign-off:** No

**Problem:** Deleting a message, locally or via the message.deleted WS event, only updates messages[conversationId]. conversations[].lastMessage keeps the decrypted text, so the sidebar keeps showing a 'deleted for everyone' message's plaintext to every member until they reload. The preview renderer already supports isDeleted, but the store never sets it.

**Evidence:**

- apps/web/src/store/conversations.ts:984-1014 - deleteMessage (optimistic update and rollback) never touches conversations
- apps/web/src/store/conversations.ts:1318-1328 - the message.deleted handler never touches conversations
- apps/web/src/components/layout/ConversationList.tsx:456-457 - the preview would show 'Message deleted' if lastMessage.isDeleted were set; otherwise it shows decryptedContent
- apps/api/internal/handlers/messages.go:684-689 - the delete event is broadcast to all members, including the sender

**Proposed change:** Add a helper markConversationLastMessageDeleted(conversations, conversationId, messageId) that sets {isDeleted:true, decryptedContent:'', encryptedContent:''} when lastMessage.id matches. Call it in deleteMessage's optimistic set (and restore the previous lastMessage on rollback) and in the message.deleted handler. Optionally drop any pending toast for that message id from useToastStore.

**Verify:** A sends 'secret' to B, then deletes it. In both A's and B's sidebars the preview should read 'Message deleted' at once without a reload, and a failed delete (API stopped) should restore the original preview.

**Reviewer note:** Accurate. The server's list query already returns lm.is_deleted for the latest message (conversations.go:49-61), so after a reload the preview reads 'Message deleted'. This change just makes live state match reload state. The rollback in deleteMessage (conversations.ts:1002-1011) must restore the previous lastMessage as well.

<a id="q12"></a>
#### 12. `infra/compose` never sets `PUBLIC_UPLOAD_ORIGIN`, so the API panics at boot on the `deploy.sh` path

**Estimate:** 30m · **Sign-off:** Yes

**Problem:** Outside development, config.Load() panics when PUBLIC_UPLOAD_ORIGIN is unset. infra/compose/docker-compose.yml (the path used by deploy.sh, backup.sh, restore.sh and SETUP.md) sets API_ENV=production, lists the api environment explicitly, has no env_file, and omits PUBLIC_UPLOAD_ORIGIN. Neither .env.example documents it. The API therefore crash-loops, `up --wait` fails, and deploy.sh rolls back to a commit with the same defect. Root compose.yaml works only if the server's root .env happens to supply the value.

**Evidence:**

- apps/api/internal/config/config.go:53-55 - panics when PUBLIC_UPLOAD_ORIGIN is empty outside development
- infra/compose/docker-compose.yml:89-121 - api environment (API_ENV production at :91) omits PUBLIC_UPLOAD_ORIGIN; the service has no env_file
- infra/compose/.env.example:1-55 and .env.example:41-58 - variable not listed
- README.md:79-80 - documents that it is required and must equal NEXT_PUBLIC_API_URL (compose sets that to ${APP_URL} at docker-compose.yml:141,151)
- compose.yaml:46-56 - relies on the optional env_file
- deploy.sh:47-57,77 - a failed --wait triggers rollback

**Proposed change:** Add `PUBLIC_UPLOAD_ORIGIN: ${PUBLIC_UPLOAD_ORIGIN:-${APP_URL}}` to the api service in infra/compose/docker-compose.yml, and the same with the existing deco.matinz03.tech fallback in compose.yaml. Add the variable with a comment to both .env.example files. Add a cheap drift guard: a Go test in internal/config that reads ../../../../infra/compose/docker-compose.yml and asserts that every variable Load()/LoadStorage() require outside development appears in the api environment.

**Verify:** Run `docker compose --env-file infra/compose/.env.example -f infra/compose/docker-compose.yml config api | grep PUBLIC_UPLOAD_ORIGIN`. Then `up -d --wait postgres redis minio api` and check that `logs api` no longer shows 'PUBLIC_UPLOAD_ORIGIN must be explicitly set'. Also run go build ./... && go test ./internal/config/.

**Reviewer note:** Confirmed: config.go:53-55 panics, and the infra compose api environment (docker-compose.yml:89-121) has no PUBLIC_UPLOAD_ORIGIN and no env_file. Value is lowered from 5 because the live production path appears to be the root compose.yaml, not infra compose. The last deploy fix (c4da81c1) edited only compose.yaml, deploy.yml calls a host-side `project-deploy` that is not in the repo, and Deploy runs are green. So this breaks the documented deploy.sh/SETUP.md path, not the running site. Sign-off is correct: README.md:147-151 describes PUBLIC_UPLOAD_ORIGIN as the S1-1 legacy-media origin allowlist. A simpler drift guard than a Go test parsing YAML is a CI step: `docker compose --env-file infra/compose/.env.example -f infra/compose/docker-compose.yml config api | grep PUBLIC_UPLOAD_ORIGIN`. Nested `${A:-${B}}` needs Compose v2, which the scripts already assume.


### Security hardening

<a id="q13"></a>
#### 13. Repo-published fallback / placeholder JWT secrets pass the production guard (S2-3 gap)

**Estimate:** 40m · **Sign-off:** Yes

**Problem:** The S2-3 guard rejects only '' and 'change-me'. compose.yaml (the root file edited by the deploy PRs; the repo is public) sets API_ENV=production with `JWT_SECRET: ${JWT_SECRET:-decosecretkey1234567890}` and `decosecret123` DB/Redis fallbacks. Both .env.example placeholders also pass the guard. A deployment missing the variable boots with a public secret: in legacy mode anyone can forge HS256 tokens, including admin tokens. In any mode JWT_SECRET also signs media tickets, so they can be forged too. SECURITY_PLAN's fix direction already includes rejecting 'unset/default/short'.

**Evidence:**

- compose.yaml:51-54 - API_ENV production plus fallback JWT_SECRET decosecretkey1234567890
- compose.yaml:10,25,31,52-53 - decosecret123 fallback passwords
- apps/api/internal/config/config.go:47 - rejects only '' and 'change-me'
- .env.example:9 and infra/compose/.env.example:3 - placeholder secrets that pass the guard
- apps/api/internal/handlers/messages.go:467 and apps/api/cmd/server/media_routes.go:17 - media tickets are keyed by JWTSecret
- docs/SECURITY_PLAN.md:123 - fix direction: unset/default/short
- gh: matinz03/deco is public; master is unprotected

**Proposed change:** compose.yaml: use `${JWT_SECRET:?set JWT_SECRET}`, `${POSTGRES_PASSWORD:?...}` and `${REDIS_PASSWORD:?...}`. config.go: outside development, panic when len(secret) < 32 or the secret is in a denylist of known values (change-me, both example placeholders, decosecretkey1234567890). Add a table test with one case per placeholder that asserts the panic message. Also raise the 18-char secret in config_test.go:75 to 32 or more characters and assert that test's panic message, so it keeps failing for the right reason. Before merging, confirm the VM .env has a secret of 32+ characters.

**Verify:** Run go build ./... && go vet ./... && go test ./internal/config/ -v: each placeholder panics and a 32+ char secret loads. `docker compose -f compose.yaml config` with JWT_SECRET unset must fail with the :? message.

**Reviewer note:** Confirmed at compose.yaml:51-54 and config.go:47. The root compose.yaml appears to be the live production file (see prod-compose item), so check the VM's root .env first. If JWT_SECRET is missing there, production is signing with a public secret right now, and that is an incident, not a hardening task. Making POSTGRES_PASSWORD/REDIS_PASSWORD `:?`-required is dangerous: POSTGRES_PASSWORD only applies when the volume is first created. If the VM was bootstrapped with the decosecret123 fallback, the operator must set the variable to that same value (then rotate with ALTER USER), or the API loses DB auth. Include infra/compose/.env.example's 'change-this-to-64-random-characters' in the denylist, since it is 35 chars and passes a 32-char length check. Also check the other config tests (config_test.go:34 'custom-secret-key' runs in development, so it is fine).

<a id="q14"></a>
#### 14. `/users/search` and `/users/{id}` expose other users' email and moderation state

**Estimate:** 50m · **Sign-off:** Yes

**Problem:** Search and GetUser use userSelectColumns, which includes email, is_admin, is_owner and restricted_actions. models.User marshals email whenever it is non-empty. Any authenticated user can therefore collect other users' email addresses and see their admin and restriction state. q is also placed into ILIKE unescaped, so `%` and `_` act as wildcards: q="__" or "%%" passes the 2-byte check and matches every user. The web client reads email and isAdmin only for the signed-in user. mapUser defaults missing fields, and api.users.get is used only for the public key when adding a group member, so public_key must stay.

**Evidence:**

- apps/api/internal/handlers/users.go:132-138 — Search selects userSelectColumns with "%"+q+"%" unescaped
- apps/api/internal/handlers/users.go:156-166 — GetUser returns the full projection for any user ID
- apps/api/internal/handlers/admin_helpers.go:14-27 — userSelectColumns includes email, is_admin, restricted_actions, is_owner
- apps/api/internal/models/models.go:11 — Email is json omitempty, so it is emitted when set
- apps/web/src/lib/api.ts:86-101 — mapUser defaults email/isAdmin/restrictedActions when absent
- apps/web/src/components/ui/OwnProfileModal.tsx:279 — email shown only for the signed-in user
- apps/web/src/store/conversations.ts:1102 — api.users.get is used for the peer's public key

**Proposed change:** Add publicUserSelectColumns (id, username, display_name, avatar_url, public_key, bio, last_seen_at, created_at) and scanPublicUser, and use them in Search and GetUser. GetMe and the admin endpoints keep the full projection. Add escapeLikePattern, which escapes \, % and _, and use `ILIKE $1 ESCAPE '\'`. Validate q by rune count (2..64) using utf8.RuneCountInString.

**Verify:** cd apps/api && go build ./... && go vet ./... && go test ./internal/handlers/ -run 'Escape|Search' -count=1. Unit-test escapeLikePattern. Add an integration test on DECO_TEST_DATABASE_URL: seed a user with an email and restricted_actions, and assert that the Search and GetUser JSON contains neither 'email' nor 'restricted_actions', that q=%% matches only names containing a literal %, and that GetMe still returns the caller's email. In the web app, check that search and add-member still work.

**Reviewer note:** The leak is real: Search (users.go:132-138) and GetUser (users.go:156-166, via loadUserByID) return email, is_admin, is_owner and restricted_actions for any user. The proposed test assertion would fail if results are still scanned into models.User, because is_admin, is_owner and restricted_actions have no omitempty (models.go:16-18) and always serialize, as `"restricted_actions":null` for example. Add a dedicated PublicUser response struct instead. loadUserByID must stay as it is, because UpdateAdminUser and DeleteAdminUser depend on it for is_owner (users.go:222,282). Sign-off should be true: GetUser is the endpoint whose public_key feeds group-key rotation on add (web store/conversations.ts:1100-1112, rotateGroupKey), which is the users.public_key / key-lifecycle boundary. An info-disclosure defect also belongs in Codex's SECURITY_PLAN. Search also has no ORDER BY with LIMIT 20, so exact matches can drop out; adding one is a cheap fix. The ILIKE wildcard escaping is minor, since results are already capped at 20.

<a id="q15"></a>
#### 15. Reactions can target a message outside the path conversation; errors swallowed as 200

**Estimate:** 55m · **Sign-off:** No

**Problem:** AddReaction checks membership of the path conversation but inserts the reaction on any message_id without checking which conversation that message is in. A user who knows a message ID (for example, a removed former member) can attach reactions to messages in conversations they no longer belong to. The reaction is stored and shown to that conversation's members through attachReactions. Every insert error is swallowed as 200 'reaction noted': an FK violation for an unknown message, a malformed UUID, or an emoji too large for the btree primary key. Emoji is unbounded TEXT inside the PK. RemoveReaction ignores errors and always broadcasts. Delete looks up sender_id without scoping to the conversation and ignores lookup errors. It never checks RowsAffected, so an unknown ID returns 200 and broadcasts a fake message.deleted. A sender who has left the conversation can still delete there.

**Evidence:**

- apps/api/internal/handlers/messages.go:701-704 — only checks caller membership of convID
- apps/api/internal/handlers/messages.go:714-725 — INSERT uses the bare msgID; any error becomes 200 'reaction noted'
- apps/api/internal/handlers/messages.go:706-712 — emoji is only checked for non-empty
- apps/api/internal/handlers/messages.go:749-763 — RemoveReaction ignores the Exec error and always broadcasts
- apps/api/internal/handlers/messages.go:664-692 — Delete: sender lookup not scoped to the conversation, errors ignored, no RowsAffected check, unconditional broadcast
- infra/compose/init.sql:132-137 — reactions.emoji TEXT is part of the PRIMARY KEY
- apps/api/internal/handlers/messages.go:539-541 — VotePoll already scopes correctly (id AND conversation_id): the pattern to copy

**Proposed change:** AddReaction: `INSERT INTO reactions (message_id,user_id,emoji) SELECT $1,$2,$3 WHERE EXISTS (SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$4 AND is_deleted=false) ON CONFLICT DO NOTHING RETURNING ...`. On ErrNoRows, run an existence check: 404 if the message is not in this conversation, 200 idempotent otherwise. Return 500 on other errors. Validate the emoji: trimmed, utf8.ValidString, 1..64 bytes, else 400. RemoveReaction: scope the delete with `AND message_id IN (SELECT id FROM messages WHERE conversation_id=$4)`, handle errors, and broadcast only when RowsAffected > 0. Delete: one `UPDATE messages SET is_deleted=true, encrypted_content='' WHERE id=$1 AND conversation_id=$2 AND EXISTS(caller is a member) AND (sender_id=$3 OR caller role in owner/admin) RETURNING id`. If no row is returned, send 404 when the message is not in the conversation and 403 when it is; already-deleted stays 200 so optimistic client deletes do not roll back. Broadcast only on success.

**Verify:** cd apps/api && go build ./... && go vet ./.... Add an integration test (DECO_TEST_DATABASE_URL) with conversations A and B, the caller a member of A only, and message M in B. POST /conversations/A/messages/M/reactions gives 404 and no reactions row. A 5 KB emoji gives 400. DELETE /conversations/A/messages/<random uuid> gives 404. Deleting M through A gives 404 and M is unchanged. Normal add, remove and delete in A still return 201/200. Use a nil hub so no broadcast is needed.

**Reviewer note:** The AddReaction gap is confirmed: messages.go:701-725 checks membership of the path conversation, then inserts on a bare msgID, and every error becomes 200 'reaction noted'. Parts of the Delete claim are overstated. A cross-conversation delete is not possible, because the UPDATE is already scoped by conversation_id (messages.go:675-679). The unscoped sender lookup only affects the 403 decision, and in the admin case produces a no-op update plus a spurious broadcast. The one real Delete authz quirk is that a sender who has left can still delete their own messages there (role is '' but senderID == userID), and blocking that is a product decision. Trim the scope to fit the hour: scope the AddReaction insert with EXISTS, validate the emoji length, map ErrNoRows to 404 or idempotent 200, and map other errors to 500. For RemoveReaction, broadcast only when RowsAffected > 0. For Delete, return 404 when RowsAffected == 0 and broadcast only on success. Defer the 'caller must still be a member' change. The web client rolls back an optimistic delete on any error (store/conversations.ts:1001-1012), so keep already-deleted returning 200 as proposed.

<a id="q16"></a>
#### 16. `send_messages` restriction not enforced on edit, reactions, poll votes, uploads (S3-8)

**Estimate:** 55m · **Sign-off:** Yes

**Problem:** S3-8 asked for confirmation that requireAllowedAction guards every mutating path. Checked: coverage is partial. send_messages is enforced only in Send. A user an admin has restricted from sending can still rewrite any of their existing messages to new ciphertext through Edit, add reactions, vote in polls, and upload message attachments. Each handler also repeats the same 8-line permission block (Send, conversation Create, 6 sticker handlers).

**Evidence:**

- apps/api/internal/handlers/messages.go:158-165 — the only send_messages check
- apps/api/internal/handlers/messages.go:617-656 — Edit has no restriction check
- apps/api/internal/handlers/messages.go:696-712 — AddReaction has no restriction check
- apps/api/internal/handlers/messages.go:512-520 — VotePoll has no restriction check
- apps/api/internal/handlers/uploads.go:34-53 — upload Create has no restriction check for any kind
- apps/api/internal/handlers/admin_helpers.go:31-35,91-103 — restricted action names and requireAllowedAction
- docs/SECURITY_PLAN.md S3-8 row — enforcement coverage unverified

**Proposed change:** Add `func denyIfRestricted(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, userID, action, msg string) bool` that wraps requireAllowedAction and writes 403 or 500. Call it with send_messages in Edit, AddReaction and VotePoll. In UploadHandler.Create, after parsing kind, apply it with send_messages for image, video, audio and file, and with manage_stickers for sticker; avatar stays unrestricted. Replace the existing duplicated blocks with the helper.

**Verify:** cd apps/api && go build ./... && go vet ./.... Add an integration test (DECO_TEST_DATABASE_URL): set restricted_actions='{send_messages}' on a user. Edit, AddReaction and VotePoll must return 403, upload with kind=image must return 403 and kind=avatar 201, and an unrestricted user and an admin are unaffected. Existing uploads_integration_test.go must still pass.

**Reviewer note:** Confirmed by grep: requireAllowedAction is called only in Send (messages.go:158), conversations.Create (conversations.go:123) and 6 sticker handlers. Edit, AddReaction, VotePoll and upload Create have no check. Sign-off is correct: this is S3-8, and uploads.go is the S1-1 media path. Blocking Edit under send_messages is unambiguous. Whether reactions and poll votes count as 'sending' is a product or Codex decision, so get that ruling before coding. Drop the refactor of the 8 existing duplicated blocks to stay under an hour and limit the diff. The upload part of the integration test needs the storage-backend setup from uploads_integration_test.go.

<a id="q17"></a>
#### 17. Production deploy runs even when CI fails; new pushes cancel in-flight deploys

**Estimate:** 45m · **Sign-off:** Yes

**Problem:** deploy.yml fires on every push to master in parallel with CI; the same commit starts both at 12:04:41Z. Commits with red CI therefore deploy, and master has no branch protection. cancel-in-progress: true kills a running production deploy when the next merge lands; run 35219083364 was cancelled after 24s when PR #9 merged 9s after #8. `ssh-keyscan` trusts whatever host key it sees on each run (TOFU), so a MITM on DEPLOY_HOST would receive the deploy session.

**Evidence:**

- .github/workflows/deploy.yml:3-6 - on push to master, no dependency on CI
- .github/workflows/deploy.yml:13 - cancel-in-progress: true
- .github/workflows/deploy.yml:27 - ssh-keyscan -H on every run
- .github/workflows/deploy.yml:31 - runs project-deploy deco (deploys the branch head)
- gh run list - CI 35219096908 and Deploy 35219096953 started together; Deploy 35219083364 was cancelled
- gh api branches/master/protection - 404 'Branch not protected' (D-1 follow-up not done)

**Proposed change:** Trigger on `workflow_run: {workflows: [CI], types: [completed], branches: [master]}` and keep workflow_dispatch. Guard the job with `if: github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push'`. Add a step that skips when master's head (gh api repos/$REPO/commits/master) no longer equals workflow_run.head_sha; a newer run will deploy instead. Set cancel-in-progress: false and timeout-minutes: 20. Load known_hosts from a DEPLOY_KNOWN_HOSTS secret with StrictHostKeyChecking=yes. Separately, the user should enable branch protection requiring CI.

**Verify:** actionlint on the workflow. Push a branch commit that breaks go build and merge it to a test fork: CI goes red and Deploy is skipped. Two quick merges: the first deploy completes and the second runs after it. Removing the known_hosts secret makes ssh fail closed.

**Reviewer note:** Confirmed at deploy.yml:3-13,27 and in the run history (Deploy 35219083364 was cancelled; CI and Deploy start together). Two caveats. 'project-deploy deploys the branch head' cannot be verified from the repo, because the host script is not tracked. workflow_run only fires for workflow files on the default branch, so the change cannot be exercised from a PR. Verification needs a scratch fork with the ssh step stubbed to echo, plus actionlint. Do not land the DEPLOY_KNOWN_HOSTS change until the user has created that secret, or every deploy fails closed. Ship it as a follow-up, or guard the step so it errors with a clear message. Worth noting: deploy.sh traps HUP and rolls back (deploy.sh:73), so a cancelled ssh session may trigger a rollback on the host if project-deploy wraps deploy.sh. That is one more reason for cancel-in-progress: false.

<a id="q18"></a>
#### 18. Bump vulnerable Go deps, add `govulncheck`, move off EOL Go 1.23

**Estimate:** 25m · **Sign-off:** Yes

**Problem:** golang-jwt/jwt v5.2.1 is affected by CVE-2025-30204 (excessive memory allocation parsing a token with many '.' separators; fixed in 5.2.2). It is reachable before authentication through the Authorization header and /ws?token=. go-redis v9.7.0 is affected by CVE-2025-29923 (out-of-order responses; fixed in 9.7.3). The toolchain is go 1.23 and golang:1.23-alpine, which stopped receiving stdlib security fixes when Go 1.25 shipped. CI has no vulnerability scan.

**Evidence:**

- apps/api/go.mod:12 - github.com/golang-jwt/jwt/v5 v5.2.1
- apps/api/internal/middleware/auth.go:18 and apps/api/internal/middleware/clerk.go:165 - jwt.Parse / NewParser on untrusted tokens
- apps/api/go.mod:16 - github.com/redis/go-redis/v9 v9.7.0
- apps/api/go.mod:3 and infra/docker/Dockerfile.api:2 - go 1.23
- SETUP.md:18-20, README.md:22,49, AGENTS.md:87 - document Go 1.23
- .github/workflows/ci.yml:63-73 - build, vet and test only

**Proposed change:** `go get github.com/golang-jwt/jwt/v5@latest github.com/redis/go-redis/v9@latest && go mod tidy`. Add a CI step `go run golang.org/x/vuln/cmd/govulncheck@latest ./...`. If govulncheck reports stdlib findings, raise the go directive, Dockerfile.api base and docs to the current supported release, and fix any new vet findings (1.24+ printf non-constant format check). Do not add an ignore list to make the gate green.

**Verify:** Run go build ./... && go vet ./... && go test -p 1 ./... -count=1 against the CI services. govulncheck ./... exits 0. A token of 1 MB of dots is rejected without a large allocation spike (compare `go test -bench` or pprof before and after).

**Reviewer note:** The CVE claims are accurate: jwt v5.2.1 is at go.mod:12 and is parsed pre-auth at auth.go:18 and clerk.go:165; go-redis v9.7.0 is at go.mod:16. The full proposal is over an hour. go 1.23 went EOL long ago (1.26/1.27 are current on 2026-09-30), so govulncheck will almost certainly report reachable stdlib findings. That forces a toolchain bump: go directive, Dockerfile base, docs, and vet fixes. For example, telegram/client.go:136 `fmt.Errorf(env.Description)` fails the printf check once the go directive is 1.24 or later. Then the full DB/MinIO suite has to be rerun. Keep only the <1h slice: bump golang-jwt to >=5.2.2 and go-redis to >=9.7.3 (pinned versions, not @latest, which may silently raise the go directive), fix the fmt.Errorf, then run build/vet/test. Do govulncheck (pinned version, not @latest) plus the toolchain bump as a separate item.

<a id="q19"></a>
#### 19. Keep `TELEGRAM_BOT_TOKEN` out of errors and logs; cap sticker download size

**Estimate:** 35m · **Sign-off:** No

**Problem:** The bot token is embedded in every Telegram request URL. httpClient.Do errors are *url.Error values whose Error() includes the full URL, and they are returned unwrapped. ImportTelegramPack logs them with zap.Error, so any timeout, DNS or TLS failure writes the bot token to stdout and docker logs. fmt.Errorf(env.Description) uses a Telegram-controlled string as a format string: a '%' in it garbles the message, and newer go vet printf checks flag non-constant format strings. Downloads are not size-capped. The S3 backend limits the spool (s3.go:324), but the local backend io.Copy is unbounded.

**Evidence:**

- apps/api/internal/telegram/client.go:115,130,145 — token interpolated into the endpoint URLs
- apps/api/internal/telegram/client.go:150-152,167-170 — the raw httpClient.Do error (*url.Error with the URL) is returned
- apps/api/internal/handlers/stickers.go:279 — logger.Error(..., zap.Error(err)) on GetStickerSet failure
- apps/api/internal/telegram/client.go:121,136 — fmt.Errorf(env.Description) with a non-constant format
- apps/api/internal/handlers/stickers.go:317,772 — storage.Save(..., reader, 0) with no size
- apps/api/internal/storage/local.go:89 — io.Copy(file, in.Body) is unbounded (compare s3.go:324 LimitReader)

**Proposed change:** In client.go, add `func (c *Client) scrub(err error) error`. For *url.Error it returns a copy whose URL has c.token replaced by "<redacted>"; for any other error it applies strings.ReplaceAll to the message. Apply it to every error returned from doJSON and DownloadFile. Replace fmt.Errorf(env.Description) with errors.New("telegram: " + env.Description). Wrap the DownloadFile body in a reader capped at 12 MiB (the sticker limit in uploads.go maxBytesForKind) that returns an error past the cap.

**Verify:** cd apps/api && go build ./... && go vet ./... && go test ./internal/telegram/ -count=1. In the new test, build a Client{token: "123:SECRET", httpClient: &http.Client{Transport: failingRoundTripper}}. Assert that the GetStickerSet, GetFile and DownloadFile errors contain "<redacted>" and never "SECRET". A RoundTripper that returns a 20 MiB body must make reading DownloadFile's reader fail at the cap.

**Reviewer note:** The token is in every URL (client.go:115,130,145), and httpClient.Do returns a *url.Error whose message includes the full URL (client.go:150-152,167-170). That error is logged via zap.Error at stickers.go:279. It is the only log site: GetFile and DownloadFile errors become 'skipped' strings with no err (stickers.go:303-312). One correction: go.mod declares `go 1.23`, and vet's non-constant-format check only fires for Go 1.24+ files, so fmt.Errorf(env.Description) does not break CI today. It is a latent problem, still worth the errors.New change. Also scrub errors from http.NewRequestWithContext, whose URL parse errors include the URL as well. The 12 MiB cap matches maxBytesForKind(KindSticker) at uploads.go:196-197, and the local backend io.Copy (local.go:89) is indeed unbounded.

<a id="q20"></a>
#### 20. REST CORS uses the raw `ALLOWED_ORIGINS` string (S3-3)

**Estimate:** 40m · **Sign-off:** Yes

**Problem:** main.go passes []string{cfg.AllowedOrigins} to go-chi/cors. The WebSocket CheckOrigin and the S3 bucket CORS both comma-split the same variable. With ALLOWED_ORIGINS='https://a,https://b', WebSocket and media accept both origins, but every REST call fails CORS for both, because the literal string matches neither. The operator's natural fix is '*' with AllowCredentials, which SECURITY_PLAN warns about.

**Evidence:**

- apps/api/cmd/server/main.go:135-141 - AllowedOrigins: []string{cfg.AllowedOrigins}, AllowCredentials true
- apps/api/internal/websocket/handler.go:30-34 - strings.Split(cfg.AllowedOrigins, ",")
- apps/api/internal/config/storage.go:113 - separate split for bucket CORS
- docs/SECURITY_PLAN.md:135 - S3-3 still open
- apps/api/cmd/server/main.go:135-141 — cors.Options{AllowedOrigins: []string{cfg.AllowedOrigins}, AllowCredentials: true}
- apps/api/internal/websocket/handler.go:31 — strings.Split(cfg.AllowedOrigins, ",") for the WS CheckOrigin
- apps/api/internal/config/storage.go:113 — strings.Split(ALLOWED_ORIGINS, ",") for S3 CORS
- apps/api/internal/config/config.go:33 — AllowedOrigins is a single raw string
- docs/SECURITY_PLAN.md S3-3 row — CORS accepts exactly one origin string

**Proposed change:** Add `func (c *Config) AllowedOriginList() []string` (split, trim, drop empty entries) and use it in main.go, websocket/handler.go and storage.go. Outside development, reject '*' in Load(). Extract the cors options into a newCORS(cfg) helper in cmd/server so it can be tested.

**Verify:** Unit tests: ' https://a , https://b,,' parses to [https://a https://b]. An httptest OPTIONS preflight with Origin https://b returns Access-Control-Allow-Origin https://b, and an unknown origin returns none. go build, vet and test.

**Reviewer note 1:** Confirmed at main.go:135-141, websocket/handler.go:30-34 and storage.go:113 (LoadStorage reads ALLOWED_ORIGINS on its own). The shared helper therefore has to be a free function, for example config.SplitOrigins(string), not only a Config method. Rejecting '*' outside development matters: go-chi/cors with AllowCredentials reflects the request origin. This only affects multi-origin deployments; today's single-origin value works. The estimate grows a little because the CORS options have to be extracted for an httptest preflight test.

**Reviewer note 2:** The code defect is real (main.go:136 vs handler.go:31 and storage.go:113), but it does not bite production today. compose.yaml:55 sets ALLOWED_ORIGINS to a single APP_URL, and the web app calls the API on that same origin (compose.yaml:67,78; nginx proxies /api/), so REST CORS is never exercised there. It only matters for dev or for a future multi-origin setup, so user value is 2. It is still cheap and closes S3-3. Sign-off stays true because S3-3 is a Codex item. Panicking on '*' outside development is a new fail-closed startup behavior, so mention it in the deploy notes.

<a id="q21"></a>
#### 21. Legacy logout/login keeps decrypted messages in the conversation store

**Estimate:** 20m · **Sign-off:** No

**Problem:** Legacy logout() never calls resetConversationSession(). The Clerk path does. Settings then navigates client-side, so the previous account's decrypted messages, groupKeyCache (decrypted group keys), activeConversationId, typing and presence stay in memory. login() and register() don't reset either, and fetchConversations re-uses whatever messages are already in the store, so the old account's plaintext stays in the new session. hydrateMessage returns the message unchanged when it can't decrypt, which keeps the old decryptedContent. In-flight sends and WS handlers also have no generation check, so they can write into the next session, and the failure path in sendMessage dereferences `messages[conversationId]!`, which throws a TypeError once the store has been reset.

**Evidence:**

- apps/web/src/store/auth.ts:324-349 - legacy logout: no resetConversationSession
- apps/web/src/store/auth.ts:251-257 - clearClerkSession does reset (inconsistent with the legacy path)
- apps/web/src/store/auth.ts:297-303 and :305-322 - login and register do not reset
- apps/web/src/app/(app)/settings/page.tsx:642-643 - `await logout(); router.replace('/login')` is client-side navigation with no reload
- apps/web/src/store/conversations.ts:13-14 - module-level groupKeyCache holds decrypted group keys
- apps/web/src/store/conversations.ts:342-351 - fetchConversations rehydrates the existing messages map
- apps/web/src/store/conversations.ts:1655-1657 and :1677-1679 - hydrateMessage returns the input untouched when it can't decrypt
- apps/web/src/store/conversations.ts:468 - `s.messages[conversationId]!.map` in the sendMessage failure path
- apps/web/src/store/conversations.ts:392-474, 1172-1261 - no conversationSessionGeneration checks after awaits (fetchMessages at :354-358 shows the intended pattern)

**Proposed change:** In auth.ts, add a helper `async function resetConversations() { const m = await import('./conversations'); m.resetConversationSession(); }`. Call it in logout() right after wsClient.disconnect(), and at the start of login() and register() before wsClient.connect(). In conversations.ts, capture `const generation = conversationSessionGeneration` at the start of sendMessage, sendSticker, sendPoll, uploadAndSendMediaMessage, votePoll, toggleReaction, and the async message.new and message.edited handlers, and return early after each await if it has changed. Replace the `!` at :468 with `?? []`.

**Verify:** Legacy mode: log in as A, open a DM, then sign out from Settings. In the console, `useConversationStore.getState()` (via React DevTools or a temporary window hook) should show conversations [] and messages {}. Log in as B in the same tab: no A-only conversation ids should appear in messages. Send a message and sign out immediately: there should be no uncaught TypeError in the console.

**Reviewer note:** Real, but legacy-only. The production Clerk path already resets in clearClerkSession (auth.ts:251-257) and establishClerkSession (:216-218). Legacy logout (:324-349), login and register don't reset, and settings/page.tsx:642-643 navigates client-side. One concrete leak on shared devices: after B logs in, pressing back to /inbox/<A-conv> renders A's cached plaintext, because fetchMessages failing doesn't clear messages[id]. Keep the narrow slice: resetConversationSession in logout, login and register, plus `?? []` at conversations.ts:468. Session-generation guards in about 8 async paths would push this toward 45+ minutes with more regression risk; defer them. No token, key-storage or backup behaviour changes (it mirrors the Clerk path), so it sits outside the four boundary items and doesn't need sign-off.

<a id="q22"></a>
#### 22. Personal `.claude/settings.local.json` committed to the public repo; `master` unprotected

**Estimate:** ~5m · **Sign-off:** No

**Problem:** `.claude/settings.local.json` is tracked on the public `master`. It is a personal Claude Code permissions file: it contains a local filesystem path from a contributor's machine and pre-approves `pnpm add:*` / `pnpm install:*` for anyone who opens the repo with Claude Code. `.gitignore` does not list it. Separately, `master` has no branch protection, so the CI gates in `.github/workflows/ci.yml` are advisory only (see also [#17](#q17)).

**Evidence:**

- `.claude/settings.local.json:1-15` — committed personal permissions and local path
- `.gitignore` — no `.claude/` entry
- `gh api repos/matinz03/deco/branches/master/protection` returns `404 Branch not protected`

**Proposed change:** `git rm --cached .claude/settings.local.json` and add `.claude/settings.local.json` to `.gitignore`. Enable branch protection on `master` requiring the CI checks (a repository setting, not a code change).

**Verify:** `git ls-files .claude` prints nothing; the protection endpoint returns 200.


### Robustness and UX

<a id="q23"></a>
#### 23. Harden `api.ts` `request()`: cursor encoding, timeouts, readable errors

**Estimate:** 25m · **Sign-off:** No

**Problem:** (1) messages.list puts the `before` cursor (an RFC3339 sent_at) into the query string unencoded. When the API runs in a non-UTC zone (for example `go run` on a developer machine in Europe), sent_at carries an offset like +02:00. The '+' is decoded as a space, the ::timestamptz cast fails, and 'load older messages' breaks silently (errors are swallowed and hasMore stays true). (2) On error responses that are not JSON (nginx 502/504 during deploys) the message becomes res.statusText, which is '' over HTTP/2. `?? 'Unknown error'` keeps the empty string, so users see blank error text, for example the upload failure reason. (3) fetch has no timeout, so a stalled request hangs spinners forever. (4) Network failures surface as a raw TypeError instead of ApiError, unlike the XHR upload path. (5) res.json() is called unconditionally, so an empty 204 body throws.

**Evidence:**

- apps/web/src/lib/api.ts:595-597 - `?before=${before}` is not encoded (compare encodeURIComponent at api.ts:539 and :696)
- apps/api/internal/handlers/messages.go:49 and :57-71 - `before` is cast with `$2::timestamptz`
- apps/api/internal/models/models.go:97 - SentAt is a time.Time scanned by pgx (local zone), so the JSON carries the process offset
- apps/web/src/store/conversations.ts:387-389 - the loadMoreMessages catch swallows the error
- apps/web/src/lib/api.ts:76-78 - `{ error: res.statusText }` then `body.error ?? 'Unknown error'`
- infra/nginx/nginx.conf:22 and :99 - `listen 443 ssl http2` (HTTP/2 has an empty statusText)
- apps/web/src/store/conversations.ts:1586-1591 - ApiError.message is shown to the user as uploadError
- apps/web/src/lib/api.ts:66-74 - no AbortSignal timeout; fetch rejections are not wrapped
- apps/web/src/lib/api.ts:836 - the XHR path already normalises failures to ApiError(0, ...)
- apps/web/src/lib/api.ts:81 - unconditional res.json()

**Proposed change:** api.ts:597: use encodeURIComponent(before). Do not use toISOString(): it truncates microseconds to milliseconds and would skip messages. In request(): wrap fetch in try/catch; rethrow AbortError from a caller's signal, otherwise throw new ApiError(0, 'Network error - check your connection'). Add a default timeout of about 30s via AbortSignal.timeout, combined with init.signal via AbortSignal.any when available, and skip it for FormData bodies. Error message: `body?.error || res.statusText || \`Request failed (HTTP ${res.status})\``. On success, return undefined for 204 or an empty body, otherwise JSON.parse(text), throwing ApiError(res.status, 'Invalid server response') if parsing fails.

**Verify:** (1) Run the API with TZ=Europe/Rome, open a chat with more than 50 messages and scroll up: older pages load, and the Network tab shows before=...%2B02%3A00. (2) Stop the API behind nginx (or return a 502 HTML page) and send media: the failure text reads 'Request failed (HTTP 502)' instead of blank. (3) Go offline and send: you get an ApiError with status 0 and a readable message. Run type-check.

**Reviewer note:** Trim the scope. (1) The unencoded `before` is real (api.ts:597) but dev-only. The production API image is FROM scratch (infra/docker/Dockerfile.api:20) with no tzdata, so pgx's local zone is UTC and sent_at ends in 'Z'. It is still a 1-line fix worth doing, and it bites developers on non-UTC hosts. (2) The empty statusText on HTTP/2 is real, but the media upload failure text mostly comes from the XHR path, which has the same bug (api.ts:831,833), so fix both. (4) Wrapping fetch TypeErrors as ApiError(0) is fine. Drop (3), the timeout: AbortSignal.any needs a fallback, and a blanket 30s would abort legitimate slow requests. Drop (5): the only 204 handler is PutGroupKeys (conversations.go:743), and no client code calls it.

<a id="q24"></a>
#### 24. Typing indicators: throttle and expire on the web; member-only relay and throttle on the API

**Estimate:** 35-45m · **Sign-off:** No

**Problem:** MessageInput calls sendTyping(true) on every keystroke. The server runs a members query and a Redis fan-out for each one, so a burst of typing costs dozens of DB queries and WS messages per second per typist. On the receiving side, typing entries have no expiry: they are only cleared by an explicit typing=false or a new message from that user. The sender sends false only from a 1.5s client timer, and the server sends nothing on disconnect. So if the typist closes the tab, loses connectivity, or the receiver misses the false during a reconnect, 'X is typing...' stays forever.

**Evidence:**

- apps/web/src/components/chat/MessageInput.tsx:261-263 and :755-769 - sendTyping(conv, true) on every input change, false after 1.5s idle
- apps/web/src/store/conversations.ts:833-841 - sendTyping forwards every call to wsClient.send without dedupe
- apps/api/internal/websocket/handler.go:151-181 - each typing event runs `SELECT user_id FROM members` and a SendToUser per member
- apps/api/internal/websocket/handler.go:121-126 - disconnect does not emit typing=false
- apps/web/src/store/conversations.ts:1365-1389 - incoming typing is added to or removed from a Set with no timer
- apps/web/src/components/chat/MessageInput.tsx:261-264 - handleInput calls queueTypingUpdate on every change
- apps/web/src/components/chat/MessageInput.tsx:755-770 - sendTyping(true) on every call, stop after 1.5 s
- apps/web/src/store/conversations.ts:833-841 - sendTyping sends a WS frame unconditionally
- apps/api/internal/websocket/handler.go:151-178 - per-frame members query and fanout, no membership check on sender
- apps/api/internal/websocket/handler.go:121-126 - disconnect path emits no typing:false
- apps/web/src/store/conversations.ts:1365-1388 - inbound typing added or removed only by explicit events, no timeout
- apps/web/src/components/chat/ChatPanel.tsx:79-82 and apps/web/src/components/chat/TypingIndicator.tsx:45 - plural label with singular 'is'
- apps/api/internal/websocket/handler.go:150-181 — typing case builds and relays the event with no sender membership check
- apps/api/internal/websocket/handler.go:171 — SELECT user_id FROM members WHERE conversation_id = $1 using context.Background()
- apps/api/internal/websocket/hub.go:135-149 — each recipient costs one json.Marshal plus one Redis PUBLISH
- docs/SECURITY_PLAN.md 'Realtime' bug-hunt list — the membership-filtering hypothesis, still unverified

**Proposed change:** Store-only change. In sendTyping, keep a Map<conversationId, {typing:boolean, sentAt:number}>. Send true only if the last state was false or more than 3s have passed since the last true (a keep-alive). Send false only if the last state was true. For incoming events, keep a Map<`${conv}:${user}`, timeout>: on true, (re)arm a 6s timer that removes the user from typing[conv]; on false, or on message.new from that user, clear the timer. Clear all timers in resetConversationSession.

**API side:** readPump relays a typing event for any conversation_id the client sends. It never checks that the sender is a member, so any authenticated socket can push 'user X is typing' to every member of any conversation whose ID it knows (for example, after being removed from a group). Each event also runs a DB query with context.Background() and no timeout, plus one Redis publish per member. Typing is client-originated and unthrottled, so a single socket can drive unbounded DB and Redis load. (Checked and ruled out: chi's Timeout middleware does not cut WS sessions, because the handler returns right after spawning the pumps and they use context.Background().) Extract `typingRecipients(ctx, q querier, convID, senderID string) ([]string, error)` with a single query: `SELECT m.user_id FROM members m WHERE m.conversation_id=$1 AND m.user_id<>$2 AND EXISTS (SELECT 1 FROM members s WHERE s.conversation_id=$1 AND s.user_id=$2)`, run under context.WithTimeout(2s). Drop events whose conversation_id is not a UUID. Add a per-client throttle, `lastTyping map[string]time.Time`, local to readPump (single goroutine, no lock needed): drop is_typing=true repeats within 750ms and always pass is_typing=false.

**Verify:** Two browsers. Type continuously for 10s in A: in DevTools WS frames, A should send at most about 4 typing=true frames (today it sends one per keystroke), and B's indicator stays on. Start typing in A and immediately close A's tab: B's indicator should disappear within about 6s (today it never does).

**Reviewer note 1:** Confirmed: one true per keystroke (MessageInput.tsx:765), a members query per event (handler.go:171), no false on disconnect (handler.go:121-126), and no expiry on received typing entries (conversations.ts:1376-1388). wsClient.send drops frames while the socket isn't OPEN (websocket.ts:164-168), so a false sent during a drop is lost too; the TTL covers that. Make sure the dedupe state resets on conversation switch and on reconnect, so the first true after a reconnect isn't suppressed.

**Reviewer note 2:** Confirmed. queueTypingUpdate (MessageInput.tsx:754-768) sends on every keystroke. The server runs a members query and fans out per frame (handler.go:151-178) and emits no typing:false on disconnect (:121-126). The inbound typing state never expires. One small correction: message.new already strips the sender from typing (conversations.ts:1211-1214), so the timer map only needs to clear on false, on message.new and on reset. Also note the receiver creates a new array on every true frame (conversations.ts:1379-1381); return the same state when the user is already present, or the re-render cost stays. The missing membership check in the server typing handler is an API authorization gap. Split it into its own API task, not part of this web change. Value is moderate: the stuck indicator is visible, and the per-keystroke cost falls mostly on the server.

**Reviewer note 3:** Confirmed: handler.go:150-181 relays typing events for any conversation_id, with no sender membership check and an unbounded context.Background() query. The throttle matters more than the finder says. The web client sends a typing event on every keystroke (MessageInput.tsx:264 queueTypingUpdate -> sendTyping on each change, then false after 1.5s), so today legitimate typing costs one DB query plus N Redis publishes per keystroke. Clear the throttle entry whenever is_typing=false passes through. Otherwise emptying the input (which sends false) and resuming within 750ms swallows the next 'true'. internal/db imports nothing from websocket, so the integration test can call db.Connect and EnsureSchema without an import cycle.

<a id="q25"></a>
#### 25. `upsertMessage` attaches incoming messages to the wrong optimistic message

**Estimate:** 45m · **Sign-off:** No

**Problem:** When a message.new arrives for the current user's own message, upsertMessage replaces the FIRST temp_ message from that sender with status 'sending', whatever its type or content. A media upload sits in 'sending' for its whole upload. So sending a text while a dropped file is uploading, or sending from another tab of the same account, makes the incoming text take over the media placeholder: the progress UI vanishes and the text can show the media caption. When the text's own POST then resolves, its temp is mapped to the same id, leaving a duplicate bubble. The filter meant to prevent that runs after the map, so it never matches. Temp ids are `temp_${Date.now()}`, which can also collide.

**Evidence:**

- apps/web/src/store/conversations.ts:1415-1427 - temp match uses only the temp_ prefix, senderId, status 'sending' and conversationId; the temp's decryptedContent is kept over the incoming one
- apps/web/src/store/conversations.ts:454-458 - map(temp -> confirmed) runs before `.filter(m => m.id !== tempId || ...)`, so the filter is a no-op and duplicates of confirmed.id survive
- apps/web/src/store/conversations.ts:500-503 - a media temp stays status 'sending' for the whole upload
- apps/web/src/components/chat/ChatPanel.tsx:227-246 - the drag-and-drop send path is not gated by MessageInput's `sending` flag (MessageInput.tsx:236)
- apps/api/internal/websocket/hub.go:115-126 - events go to every client of the user, so another tab's sends arrive as message.new
- apps/web/src/store/conversations.ts:1246-1252 - message.edited also goes through the temp-matching path
- apps/web/src/store/conversations.ts:401,481,530,602 - `temp_${Date.now()}` ids (compare the collision-safe id at apps/web/src/store/toasts.ts:84)

**Proposed change:** Move sortMessages, upsertMessage, withReplyLinks and applyReactionEvent into a pure module, store/message-list.ts. Make temp matching strict: same type, plus the same decryptedContent for text, location and contact when the incoming message was decrypted; the same mediaName for media; the same sticker.id for stickers; the same poll question for polls. Add an option {matchTemp:false} and use it for message.edited and for the confirmed-response paths. In the success paths of sendMessage, sendSticker, sendPoll and uploadAndSendMediaMessage, filter out tempId first, then upsert the confirmed message by id. Generate temp ids as `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`.

**Verify:** Throttle the network to Slow 3G. Drop a ~5 MB image onto the chat and, while it uploads, type and send 'hello'. Expected: two separate bubbles, the upload keeps its progress bar, and there is no duplicate 'hello' after both finish. Repeat with two tabs of the same account sending at the same time. Pairs with the vitest harness: unit-test the upsertMessage cases in message-list.ts.

**Reviewer note:** Confirmed: the loose temp match (conversations.ts:1415-1426) and the no-op filter after map (:454-458) mean a mis-attached temp yields a duplicate confirmed.id, and nothing dedupes. The finder overstates the triggers. Picker uploads hold MessageInput's sending flag for the whole upload (MessageInput.tsx:273-296), so in one tab only drag-and-drop (ChatPanel handleDrop, ChatPanel.tsx:227-246) or another tab/device sends can collide. message.edited only reaches the temp path when the edited id isn't loaded (rare). 'Text shows the media caption' only happens if the media had a caption (:1425 prefers the temp's decryptedContent). Skip extracting a message-list.ts module unless the vitest harness lands in the same change, since it adds churn to a 1,749-line store. Also replace the non-null assertion at :468 while there.

<a id="q26"></a>
#### 26. Surface create-conversation failures; debounce and de-race user search

**Estimate:** 45m · **Sign-off:** No

**Problem:** createConversation throws on several expected paths, most importantly for groups: it throws EncryptionError when any member has no public key or group-key distribution fails, and it deletes the half-created group first. NewConversationModal wraps both create handlers in try/finally with no catch and has no error state, so the button re-enables and nothing happens. SearchPanel only console.errors. Separately, both components call api.users.search on every keystroke with no debounce and no stale-response guard. A slow response for 'ma' can overwrite the results for 'mat'. On a search error, SearchPanel shows 'Type at least 2 characters to search.'. ChatHeader's add-member search already does this correctly (250 ms debounce plus a cancelled flag).

**Evidence:**

- apps/web/src/components/ui/NewConversationModal.tsx:65-79 - search per keystroke, no debounce, no stale guard
- apps/web/src/components/ui/NewConversationModal.tsx:82-91,102-118 - try/finally without catch; the file has no error state
- apps/web/src/store/conversations.ts:1016-1050 - createConversation throws EncryptionError or ApiError after cleanup
- apps/web/src/components/layout/SearchPanel.tsx:18-34 - same per-keystroke search race; the catch leaves `empty` stale
- apps/web/src/components/layout/SearchPanel.tsx:36-43 - failure only console.error; no busy guard against double-click
- apps/web/src/components/chat/ChatHeader.tsx:135-160 - existing debounce and cancel pattern to copy

**Proposed change:** Add `error` state to NewConversationModal and render it the same way ForwardMessageModal does. Catch in both handlers and show `err.message` (EncryptionError messages are user-actionable, e.g. a member without keys). Add the same error display and a `creating` guard to SearchPanel.handleStartDM. Replace the transition-based search in both components with a small shared effect keyed on the query: a 250 ms setTimeout plus a `cancelled` flag or incrementing request id, mirroring ChatHeader. Do not change createConversation's cleanup semantics.

**Verify:** In DevTools, throttle to Slow 3G and type 'matin' quickly in /search. The Network tab shows 1-2 requests instead of 4, and the final results match the final query. Create a group that includes a user with no public key, or block POST /group-keys: an inline error appears and the modal stays open (before: silent). Block POST /conversations in SearchPanel and click a user: an inline error appears. `pnpm type-check`.

**Reviewer note:** Confirmed. NewConversationModal.tsx:82-91 and :102-118 use try/finally with no catch and there is no error state. createConversation (conversations.ts:1022-1049) throws EncryptionError or ApiError after deleting the half-made group. Both search paths run per keystroke without a stale guard. SearchPanel's catch leaves `empty` stale, so it falls through to 'Type at least 2 characters'. There is also a second race to fix: when the query drops below 2 characters, a pending transition can still repopulate results afterwards. The ForwardMessageModal error pattern (ForwardMessageModal.tsx:38,73,119, with role=alert) is a good template. Do not touch createConversation's cleanup: group key distribution is a crypto path, and it is fine as long as it is left alone.

<a id="q27"></a>
#### 27. ChatHeader: overflow menu for groups/saved, dead call buttons, mobile back

**Estimate:** 45m · **Sign-off:** No

**Problem:** This is mostly wired already but unreachable. The store supports muting any conversation (mutedIds, persisted to localStorage), but for groups the header shows only a settings button, and the overflow menu (Mute, Clear history, Shared media) is rendered only for DMs. The group branch inside that menu (owner 'Delete chat') is dead code. On desktop, swipe is disabled, so groups cannot be muted at all. Saved Messages get no menu. In-conversation search and Shared media are `hidden sm:flex`, so on phones search is unreachable in every conversation type, and Shared media is unreachable in groups and Saved. The Voice call and Video call buttons have no onClick; clicking them does nothing. The menu's 'Shared media' count shows the total loaded message count. The mobile back button uses router.back(), so after a deep link, refresh, or notification entry it leaves the app or goes nowhere.

**Evidence:**

- apps/web/src/components/chat/ChatHeader.tsx:335-346 - groups get only the settings button
- apps/web/src/components/chat/ChatHeader.tsx:346-438 - menu only when `!isGroup && !isSaved`
- apps/web/src/components/chat/ChatHeader.tsx:407-420 - unreachable `isGroup ? canDeleteGroup ...` branch
- apps/web/src/components/chat/ChatHeader.tsx:297-317 - Search and Shared media `hidden sm:flex`
- apps/web/src/components/chat/ChatHeader.tsx:319-333 - Voice and Video call buttons with no handler
- apps/web/src/components/chat/ChatHeader.tsx:377 - count is conversationMessages.length (all messages)
- apps/web/src/components/chat/ChatHeader.tsx:261-263 - `router.back()` back button
- apps/web/src/components/layout/ConversationList.tsx:401 - swipe (the only other mute path) is mobile-only

**Proposed change:** Render the overflow menu for every conversation type. Items: 'Search messages' (sm:hidden, sets searchOpen), 'Shared media' (count = media and file messages, or no count), Mute/Unmute (all types except saved), Clear history, and type-specific extras ('Group settings' and owner 'Delete group' for groups; 'View profile' for DMs). Keep the group settings icon button on desktop if desired. Remove the two call buttons until calling exists. Replace router.back() with `router.push(isGroup ? '/inbox?tab=groups' : '/inbox')`.

**Verify:** Desktop: open a group, open the menu, click Mute. The conversation row shows the muted icon and incoming messages no longer increment its badge. Reload: still muted. Mobile viewport: the menu offers 'Search messages', which opens the search bar in DM, group, and Saved conversations. No voice or video buttons remain. Open /inbox/<id> directly in a new tab and tap back: you land on /inbox. `pnpm type-check`.

**Reviewer note:** All cited lines check out. Groups get only the settings button (ChatHeader.tsx:335-346), and the menu is DM-only (:346-438), which makes the isGroup branch at :407-420 dead. Search and media are `hidden sm:flex` (:297-317). The call buttons have no onClick (:319-333). The count at :377 is conversationMessages.length. The back button is router.back() (:261-263). Groups really cannot be muted on desktop: mute exists only here and in the mobile-only swipe. Removing the call buttons is a product decision, not a bug fix. Prefer disabling them with a 'Coming soon' title, or leave them for a separate PR. Group mute plus the mobile search entry is the core value.

<a id="q28"></a>
#### 28. Distinguish load failures and unknown conversations from "empty"

**Estimate:** 55m · **Sign-off:** No

**Problem:** Three misleading states. (1) ConversationList: fetchConversations() throws on any API or network error, but the component only does `.finally(() => setLoading(false))`. The user sees 'No conversations yet. Start a new one...' when the list simply failed to load, and an unhandled rejection is logged. (2) ChatPanel: the same pattern for fetchMessages. A failed history load shows the empty-conversation state 'Say hi to <name>! 👋' in an existing conversation, which suggests the history was lost. (3) ChatPanel renders ChatSkeleton forever when the conversation id is not in the store: a bad or stale URL, a group deleted by its owner, or a user removed from a group. There is no way to tell 'still loading' from 'not available'. The error.tsx boundary does not catch these because they are async effect rejections, not render errors.

**Evidence:**

- apps/web/src/components/layout/ConversationList.tsx:54-56 - `void fetchConversations().finally(...)`, no catch
- apps/web/src/components/layout/ConversationList.tsx:152-171 - failure falls through to the 'No conversations yet' copy
- apps/web/src/store/conversations.ts:342-351 - fetchConversations and fetchMessages rethrow API errors
- apps/web/src/components/chat/ChatPanel.tsx:140-147 - `void fetchMessages(...).finally(...)`, no catch
- apps/web/src/components/chat/ChatPanel.tsx:322-339 - failure shows the 'Say hi' empty state
- apps/web/src/components/chat/ChatPanel.tsx:285-291 - `if (!conversation) return <ChatSkeleton />` with no terminal state
- apps/web/src/components/chat/StickerPickerPanel.tsx:104-111 - existing inline error pattern to match

**Proposed change:** ConversationList: add `loadError` state, catch the fetch, and render '<p>Couldn't load conversations</p><button>Retry</button>' where Retry re-runs the fetch. ChatPanel: add `loadError` state, catch fetchMessages, and render an inline 'Couldn't load messages - Retry' block instead of the empty state. Unknown conversation: add `conversationsLoaded: boolean` to the conversation store. Set it true on a successful fetchConversations and reset it in resetConversationSession. In ChatPanel, `if (!conversation) return conversationsLoaded ? <NotAvailable/> : <ChatSkeleton/>`, where NotAvailable says 'This conversation isn't available' and links back to /inbox.

**Verify:** In DevTools request blocking, block GET /api/v1/conversations and reload /inbox: the sidebar shows the error and Retry (not 'No conversations yet'). Unblock and click Retry to load the list. Block GET .../messages and open a conversation that has history: the error and Retry show instead of 'Say hi'. Visit /inbox/00000000-0000-0000-0000-000000000000: after the list loads, 'This conversation isn't available' with a link to /inbox replaces the infinite skeleton. `pnpm type-check`.

**Reviewer note:** The three problems are confirmed. ConversationList.tsx:54-56 and ChatPanel.tsx:145 use `void ...finally()` with no catch, so there is an unhandled rejection and the empty-state copy appears. ChatPanel.tsx:285-291 shows the skeleton forever. No WS event exists for conversation deleted or member removed (only the message.*, presence and typing events at conversations.ts:1173-1365), so the 'not available' state appears only after a refetch. That is fine. auth.ts:71 also calls fetchConversations, so set conversationsLoaded inside the store method, not in the component. At 55 minutes this is tight with the full stack running. Ship it as two PRs: (a) error plus Retry in both lists, about 30 minutes; (b) conversationsLoaded plus the NotAvailable state, about 25 minutes.

<a id="q29"></a>
#### 29. `reply_to_id` integrity: admin deletion failure, missing index, send validation

**Estimate:** 50m · **Sign-off:** No

**Problem:** messages.reply_to_id REFERENCES messages(id) with the default NO ACTION and no index. deleteUserAccount runs `DELETE FROM messages WHERE sender_id=$1`. If any other user's message replies to one of the target's messages, the FK aborts the transaction and DELETE /users/admin/{id} returns 500 'failed to delete user'. Without an index, every deleted row's FK check also scans the whole messages table, which is quadratic for prolific users. Send stores any client-supplied reply_to_id: an ID from another conversation is saved as a cross-conversation reference, and an unknown ID hits the FK and returns 500 instead of 400.

**Evidence:**

- infra/compose/init.sql:84 — reply_to_id UUID REFERENCES messages(id) (no ON DELETE action)
- infra/compose/init.sql:93-94 — only the (conversation_id, sent_at) and sender_id indexes exist; nothing on reply_to_id
- apps/api/internal/db/postgres.go (EnsureSchema) — no reply_to_id index or FK change (grep 'reply_to' finds nothing)
- apps/api/internal/handlers/users.go:494-500 — DELETE FROM messages WHERE sender_id = $1 inside deleteUserAccount
- apps/api/internal/handlers/users.go:292-298 — any error becomes 500 'failed to delete user'
- apps/api/internal/handlers/messages.go:192,306-324 — ReplyToID inserted unvalidated; insert error becomes 500

**Proposed change:** 1) In deleteUserAccount, after the existing lock and encrypted-group check (leave those untouched) and before deleting messages, run: `UPDATE messages SET reply_to_id = NULL WHERE reply_to_id IN (SELECT id FROM messages WHERE sender_id=$1) AND sender_id <> $1`. 2) Add `CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL` to both init.sql and EnsureSchema; the two schema sources must stay in sync. 3) In Send, when ReplyToID is set, check inside the transaction that `SELECT 1 FROM messages WHERE id=$1 AND conversation_id=$2`, and return 400 'reply_to_id must reference a message in this conversation' otherwise.

**Verify:** cd apps/api && go build ./... && go vet ./.... Add an integration test next to users_group_key_integration_test.go (DECO_TEST_DATABASE_URL). Seed a DM between A and B; B replies to a message from A. handler.deleteUserAccount(A) must succeed, and B's reply must survive with reply_to_id NULL (before the fix: FK violation). Check the schema with `SELECT indexname FROM pg_indexes WHERE indexname='idx_messages_reply_to'` after EnsureSchema, and on a fresh init.sql database as CI does.

**Reviewer note:** Confirmed. init.sql:84 has reply_to_id REFERENCES messages(id) with the default NO ACTION and no index. deleteUserAccount runs DELETE FROM messages WHERE sender_id=$1 (users.go:494-500), which fails as soon as any other user has replied to the target, and DeleteAdminUser then returns 500 (users.go:297). A reply to one's own message is fine, because NO ACTION is checked at the end of the statement. The missing index also hurts group Delete (conversations.go:326-331): the cascade runs an FK seq scan of messages for every deleted row. Recommend dropping step 3, the Send validation. It is low value, because the content is ciphertext and the client resolves replies only inside the current conversation (store/conversations.ts:396-397). It also edits Send, which holds the group-key epoch lock and media binding that Codex has reserved. Without it, no sign-off is needed. deleteUserAccount was hardened under S1-2, so give Codex a heads-up that its lock and check stay unchanged. An alternative that also covers cross-conversation cascades is to redefine the FK as ON DELETE SET NULL in EnsureSchema and init.sql. It is heavier, since it needs a DO block to drop and re-add messages_reply_to_id_fkey. The non-concurrent CREATE INDEX in EnsureSchema briefly blocks writes at startup, which is acceptable at current scale.

<a id="q30"></a>
#### 30. Remove the messages x members join fan-out in `GET /conversations`

**Estimate:** 45m · **Sign-off:** No

**Problem:** The conversation-list query LEFT JOINs every non-deleted message (m2) and every member (m3) of each conversation, then GROUPs BY with COUNT(DISTINCT). Per conversation that produces (#messages x #members) intermediate rows: a 50-member group with 20k messages yields about 1M rows, on every inbox load. The member_count computed this way is thrown away anyway, because attachMembers overwrites MemberCount with len(Members). The existing (conversation_id, sent_at DESC) index would serve a correlated unread count directly.

**Evidence:**

- apps/api/internal/handlers/conversations.go:43-66 — List query with the m2/m3 joins, COUNT(DISTINCT) and a large GROUP BY
- apps/api/internal/handlers/conversations.go:54-55 — LEFT JOIN messages m2 and LEFT JOIN members m3 multiply against each other
- apps/api/internal/handlers/conversations.go:563-565 — attachMembers overwrites MemberCount, so the m3 join is redundant
- infra/compose/init.sql:93 — idx_messages_conversation_sent(conversation_id, sent_at DESC) can serve a correlated count

**Proposed change:** Drop the m3 join. Replace the m2 join with a scalar subquery: `(SELECT COUNT(*) FROM messages m2 WHERE m2.conversation_id = c.id AND m2.is_deleted = false AND m2.sent_at > mb.last_read_at AND m2.sender_id <> $1) AS unread_count`. Compute member_count as `(SELECT COUNT(*) FROM members WHERE conversation_id = c.id)`, or leave it to attachMembers. Remove the GROUP BY. Keep the LATERAL last-message join, ORDER BY and Scan order unchanged so the JSON shape is identical.

**Verify:** cd apps/api && go build ./... && go vet ./.... Add an integration test gated on DECO_TEST_DATABASE_URL, following users_group_key_integration_test.go. Seed a group with 3 members and messages before and after the caller's last_read_at, including deleted ones and the caller's own. Call List through httptest with the user ID in context and assert unread_count and member_count. Optionally run EXPLAIN ANALYZE on a seeded conversation with 10k messages and 50 members, before and after.

**Reviewer note:** The problem is real: conversations.go:54-55 joins m2 (messages) against m3 (members), which multiplies rows, and COUNT(DISTINCT) plus a GROUP BY over lm.encrypted_content then cleans up. attachMembers overwrites MemberCount (conversations.go ~563), but it returns early on a query error, and the SQL member_count is then the only value. Keep member_count as a scalar subquery instead of dropping it. members.last_read_at is NOT NULL (init.sql:59), so the correlated unread subquery keeps the same semantics. The integration test must also clean up the Saved Messages conversation that ensureSavedConversation creates on every List call. User value is 3, not 4: the current data scale is probably small, but the fix is low-risk and the cost grows as messages x members.

<a id="q31"></a>
#### 31. Telegram sticker import is sequential and hits the 30s request deadline

**Estimate:** 50m · **Sign-off:** No

**Problem:** ImportTelegramPack processes stickers one at a time, all under r.Context(). Each sticker costs a GetFile call, a download, a storage save, and then a second GetFile, download and save for the thumbnail. The chi Timeout middleware and the server WriteTimeout are both 30s. With about 0.4-1s of Telegram round trips per sticker, a 50-120 sticker pack runs past the deadline. From then on, every GetFile fails at once and is recorded as 'Couldn't fetch file', loadPackByID fails on the expired context, and the client gets a 500. A partially imported pack is left behind. Re-importing is worse: createOrReplaceImportedPack first deletes the existing stickers, so a previously complete pack ends up partial.

**Evidence:**

- apps/api/cmd/server/main.go:134 — r.Use(middleware.Timeout(30 * time.Second)) applies to every route
- apps/api/cmd/server/main.go:171 — http.Server WriteTimeout: 30 * time.Second
- apps/api/internal/handlers/stickers.go:297-347 — sequential loop using r.Context() for GetFile (303), DownloadFile (309) and importTelegramThumbnail (326)
- apps/api/internal/handlers/stickers.go:350-354 — loadPackByID(r.Context(), ...) runs after the loop; on an expired context it returns 500 even though stickers were already written
- apps/api/internal/handlers/stickers.go:720 — a re-import deletes the existing stickers in the pack first
- apps/web/src/lib/api.ts:909 — the endpoint is exposed in the web UI

**Proposed change:** Fetch and save the stickers with bounded concurrency: a semaphore channel of about 6 plus a WaitGroup (golang.org/x/sync is not a dependency, so don't use errgroup). Store the results in a slice indexed by position, then call insertSticker in order so positions are preserved. For static webp stickers, skip the separate thumbnail fetch and use the asset URL as the thumbnail. Run the import under context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Minute) so the whole operation has its own explicit budget. Make botAPIBase a Client field (defaulting to the constant) so tests can point it at httptest.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q32"></a>
#### 32. A11y quick wins: form labels, named switches, light-theme contrast

**Estimate:** 40m · **Sign-off:** No

**Problem:** (1) Login and signup labels are bare <label> elements with no htmlFor or id and are not wrapping the input, so inputs have no programmatic label (placeholders only). The show/hide password button has no accessible name and tabIndex={-1}, so keyboard users cannot reach it. Error messages are plain <p> with no role=alert, so screen readers do not announce them. (2) The Settings Toggle is role="switch" with aria-checked but no name, so screen readers announce 'switch, on' without saying which setting. (3) Several texts use hard-coded dark-theme colors with no light variant. The light theme uses a white or near-white surface (--surface 0 0% 100%), so text-amber-100 is about 1.1:1 contrast and text-red-300 or red-200 about 1.5-2:1, far below WCAG AA 4.5:1. Affected: the key-backup warning banner, and the group settings 'Danger zone', member errors, and the owner menu tag.

**Evidence:**

- apps/web/src/components/auth/LoginForm.tsx:58,71,86 - labels not associated with inputs
- apps/web/src/components/auth/LoginForm.tsx:101-106 - password toggle: no aria-label, tabIndex={-1}
- apps/web/src/components/auth/LoginForm.tsx:120-122 - error <p> without role=alert
- apps/web/src/components/auth/SignupForm.tsx:198,209,223,236,250,262-267 - same issues
- apps/web/src/app/(app)/settings/page.tsx:711-716 - role=switch with no aria-label or aria-labelledby
- apps/web/src/components/auth/KeyBackupGate.tsx:57 - text-amber-100 on bg-amber-500/10
- apps/web/src/components/chat/ChatHeader.tsx:418,612,829-836 - text-red-300, text-red-200/80, text-red-300/80
- apps/web/src/app/globals.css:9-11 - light theme background and white surface

**Proposed change:** Use `useId()` in LoginForm and SignupForm to wire each label's htmlFor to its input id. Give the password toggle `aria-label={showPassword ? 'Hide password' : 'Show password'}` and `aria-pressed`, and drop tabIndex={-1}. Add `role="alert"` to the error paragraphs. Pass `label` into Toggle and set `aria-label={label}` (or aria-labelledby with a useId on the label <p>). Replace the dark-only colors with pairs: `text-amber-900 dark:text-amber-100`, `text-red-600 dark:text-red-300`, `text-red-700/80 dark:text-red-200/80`. KeyBackupGate gets a class-only change; do not touch its logic.

**Verify:** Run axe DevTools or Lighthouse Accessibility on /login, /signup, and /settings in the light theme: no 'form elements must have labels' or 'ARIA toggle fields must have an accessible name' violations. Clicking a label focuses its input. Tab reaches the eye toggle. Open group settings as owner in the light theme: the Danger zone text passes the contrast checker (at least 4.5:1). `pnpm type-check`.

**Reviewer note:** The issues are real, but the SignupForm evidence is wrong: the file has only 165 lines. The actual locations are labels at SignupForm.tsx:69,80,94,107,121, the password toggle tabIndex={-1} at :137, and the error <p> at :152-153. The LoginForm lines (58,71,86,101-106,120-122), the settings Toggle (settings/page.tsx:700-716), KeyBackupGate.tsx:57 (text-amber-100) and ChatHeader.tsx:418/611/829-836 are accurate. Tailwind uses darkMode ['class'] (tailwind.config.ts:4), so dark:-prefixed pairs will work. The KeyBackupGate change is class-only, so no key-lifecycle sign-off is needed.

<a id="q33"></a>
#### 33. Ship the PWA icons/favicon the manifest references

**Estimate:** 35m · **Sign-off:** No

**Problem:** manifest.json declares /icon-192.png and /icon-512.png, but apps/web/public contains only .gitkeep and manifest.json. There is also no favicon.ico, app/icon.*, or apple-icon, so every page load 404s the favicon, the install prompt has no icon, and Chrome reports the manifest as not installable. There are two more traps. (a) The proxy matcher excludes `icons` (a directory) and `favicon.ico`, but not root-level `/icon-192.png`. For logged-out visitors, for example on /login where install prompts happen, those requests are redirected to /login?from=/icon-192.png. (b) `"purpose": "any maskable"` in a single entry is discouraged: maskable art gets cropped when used as 'any'.

**Evidence:**

- apps/web/public/manifest.json:12,18 - /icon-192.png and /icon-512.png referenced
- apps/web/public/manifest.json:15,21 - combined "any maskable" purpose
- apps/web/public/ - contains only .gitkeep and manifest.json (verified with ls)
- apps/web/src/app/layout.tsx:15-24 - manifest linked; no icons metadata
- apps/web/src/proxy.ts:57-60 - matcher excludes favicon.ico|manifest.json|icons, but not /icon-*.png

**Proposed change:** Add public/icons/icon-192.png, public/icons/icon-512.png, and public/icons/maskable-512.png (the existing 'D' mark on the primary color; export from a small SVG), plus public/favicon.ico and public/icons/apple-touch-icon.png. Update manifest.json to use the /icons/... paths, with separate `any` and `maskable` entries, and add `id: "/inbox"`. Add `icons: { icon: '/favicon.ico', apple: '/icons/apple-touch-icon.png' }` to the root metadata. Keeping everything under /icons/ and /favicon.ico means the auth proxy matcher needs no change.

**Verify:** Logged out, `curl -I http://localhost:3000/icons/icon-192.png` and `/favicon.ico` return 200 (not a 307 to /login). Chrome DevTools > Application > Manifest shows both icons with no errors and the install button is available. The console no longer shows favicon 404s. Lighthouse has no manifest icon warnings.

**Reviewer note:** Confirmed. public/ holds only .gitkeep and manifest.json, and the manifest references /icon-192.png and /icon-512.png. The proxy.ts:59 lookahead `icons` does not match `/icon-192.png`, so logged-out requests are redirected to /login. Two cautions. (1) Producing the PNGs needs an image tool (sharp or ImageMagick), and node_modules are not installed, so include that setup in the estimate. (2) If the implementer uses Next's generated app/icon.tsx or apple-icon.tsx (ImageResponse) instead, those /icon and /apple-icon routes are NOT excluded by the matcher, and the matcher must be updated. The finder's /icons/* plus /favicon.ico layout avoids touching proxy.ts, which is the better choice.

<a id="q34"></a>
#### 34. Nav unread dots should ignore muted conversations

**Estimate:** 10m · **Sign-off:** No

**Problem:** Row badges are hidden for muted conversations, but the Messages and Groups unread dots in NavRail and MobileNav count every conversation. A single muted chatty group keeps the Groups dot lit permanently, which defeats the purpose of muting.

**Evidence:**

- apps/web/src/components/layout/ConversationList.tsx:436 - row badge rendered only when `!isMuted && unreadCount > 0`
- apps/web/src/components/layout/MobileNav.tsx:19-20 - hasUnreadMessages and hasUnreadGroups ignore mutedIds
- apps/web/src/components/layout/NavRail.tsx:31-32 - same computation ignores mutedIds
- apps/web/src/store/conversations.ts:214,281 - mutedIds is a persisted Set in the store

**Proposed change:** Select `s.mutedIds` in MobileNav and NavRail and add `!mutedIds.has(conversation.id)` to both `some()` predicates.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q35"></a>
#### 35. ImageLightbox listeners only while open; keep conversation identity on presence events

**Estimate:** 20m · **Sign-off:** No

**Problem:** Every image bubble mounts an ImageLightbox, even when it is closed. Each one registers document-level mousemove and mouseup listeners unconditionally, and re-registers them on every offset change. Separately, the presence reducer rebuilds every conversation object on each presence event, even for conversations that do not contain that user. That re-renders every conversation row and, through the conversation selectors, every visible MessageBubble.

**Evidence:**

- apps/web/src/components/chat/ImageLightbox.tsx:73-80 - mousemove and mouseup added regardless of `open`
- apps/web/src/components/chat/MessageBubble.tsx:360-364 - ImageLightbox mounted per image message
- apps/web/src/store/conversations.ts:1337-1353 - presence maps every conversation to a new object
- apps/web/src/components/chat/MessageBubble.tsx:146-148 and apps/web/src/lib/use-media-ticket.ts:123 - per-bubble selectors on conversations.find(...) re-render when identity changes

**Proposed change:** In ImageLightbox, return early from the listener effect when `!open` and add `open` to its deps. Keep the component mounted so the AnimatePresence exit still animates. In the presence reducer, return the same conversation object when none of its members matches userId, and the same member object when unchanged.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q36"></a>
#### 36. Presence changes: publish once instead of once per online user

**Estimate:** 35m · **Sign-off:** No

**Problem:** On every connect and every last-connection disconnect, the hub goroutine synchronously runs setPresence, sendPresenceSnapshot and broadcastPresence. broadcastPresence runs json.Marshal twice and does one Redis PUBLISH for every user in the local client map. With N users online, a reconnect storm after a deploy costs about N^2 Redis round trips, all serialized in Run. While Run is busy it drains no broadcasts, so the 1024-slot broadcast channel and the client buffers back up, which then trips the backpressure-unregister crash. Recipients also come only from the local map, so on a multi-instance deployment users connected to other instances never receive the presence change.

**Evidence:**

- apps/api/internal/websocket/hub.go:94-96 — register runs setPresence, the snapshot and broadcastPresence synchronously inside Run
- apps/api/internal/websocket/hub.go:111-113 — the unregister path does the same for offline
- apps/api/internal/websocket/hub.go:196-216 — broadcastPresence loops over every local user and calls SendToUser for each
- apps/api/internal/websocket/hub.go:135-149 — each SendToUser marshals twice and does a Redis PUBLISH on deco:events

**Proposed change:** Add an `All bool` field (or a reserved UserID "*") to broadcastMsg. broadcastPresence then publishes one message, and Run's broadcast case delivers it to every locally connected client using the same full-buffer handling. This turns N round trips into 1 per presence change and makes presence reach clients on every instance. Test it in the hub_test.go harness from ws-hub-unregister-panic: register 3 clients, trigger a presence broadcast, and inject the resulting broadcastMsg into h.broadcast so each client receives exactly one presence event.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.


### DX, CI, docs and cleanup

<a id="q37"></a>
#### 37. Healthchecks in root `compose.yaml`; web waits for a healthy API

**Estimate:** 15m · **Sign-off:** No

**Problem:** infra/compose/docker-compose.yml has application healthchecks for api and web, and web waits on api via service_healthy (D-5). The root compose.yaml has none of this: no healthcheck on either service, and web uses a bare `depends_on: - api`. The deploy PRs edit this file (c4da81c1 'fix(deploy): pass web auth mode' touched only compose.yaml). So an API that panics at boot, for example on a config guard like JWT_SECRET or PUBLIC_UPLOAD_ORIGIN, is not reported as unhealthy, and `up --wait` or the host deploy cannot gate on real health.

**Evidence:**

- compose.yaml:36-61 - api service with no healthcheck
- compose.yaml:62-83 - web service with no healthcheck; depends_on at :72-73 has no condition
- infra/compose/docker-compose.yml:124-129,147-149,159-164 - existing healthchecks and service_healthy gating to copy
- apps/api/cmd/server/main.go:27-33 and apps/api/cmd/server/healthcheck.go:10-25 - `/api healthcheck` subcommand that works in the scratch image
- apps/web/src/app/api/health/route.ts - web health route used by the infra healthcheck
- gh commit c4da81c1 - deploy fix edits only compose.yaml

**Proposed change:** Copy the api healthcheck (`["CMD", "/api", "healthcheck"]`, interval 10s, retries 5, start_period 10s) and the web node-fetch healthcheck from infra compose into compose.yaml. Change web to `depends_on: api: condition: service_healthy`.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q38"></a>
#### 38. Structured access log with request IDs and `X-Request-Id`

**Estimate:** 45m · **Sign-off:** No

**Problem:** chi's RequestID middleware is installed, but the ID is never logged or returned to the client. There is no access log at all: no middleware.Logger or zap equivalent. Handler error logs carry no request correlation. Incidents cannot be traced to a request, users cannot report an ID, and deploy health debugging depends on guesswork. Any log line must not include the query string, because /ws?token= carries the session JWT (S3-5) and media URLs carry ?ticket=.

**Evidence:**

- apps/api/cmd/server/main.go:131 — middleware.RequestID is used, and nothing reads GetReqID
- apps/api/cmd/server/main.go:131-144 — no request-logging middleware in the stack
- apps/api/internal/handlers/messages.go:88,321 — error logs without request_id
- apps/api/internal/handlers/stickers.go:279 — the same
- docs/SECURITY_PLAN.md S3-5 — the WS token travels in the query string and must not be logged

**Proposed change:** New apps/api/internal/middleware/logging.go with `RequestLogger(logger *zap.Logger) func(http.Handler) http.Handler`. It wraps w with chimiddleware.NewWrapResponseWriter, which keeps http.Hijacker for the WS upgrade, and sets the X-Request-Id response header from middleware.GetReqID. After next.ServeHTTP it logs method, route pattern (chi.RouteContext(...).RoutePattern()), status, bytes, duration_ms and request_id. It never logs r.URL.RawQuery or headers. /health is logged at Debug. Mount it right after RequestID in main.go.

**Verify:** cd apps/api && go build ./... && go vet ./... && go test ./internal/middleware/ -run RequestLogger -count=1. The test uses go.uber.org/zap/zaptest/observer, which ships in the existing zap module. Request /ws?token=SECRET and /api/v1/media/x?ticket=T through a chi router with RequestID and RequestLogger. Expect one entry each with request_id and status, no field containing SECRET or T, and a non-empty X-Request-Id header. Manually, the WS upgrade still works in the browser.

**Reviewer note:** Confirmed: main.go:131-144 installs RequestID but no access log, and nothing reads GetReqID. Details to get right: (1) Mount the logger after RequestID and before Recoverer, so panics are logged as 500. (2) On /ws, gorilla writes the 101 response on the hijacked connection, so the wrapper reports status 0 or 200. Log it as 101 or 'hijacked'. (3) Log only the RoutePattern and never r.URL.Path. Media paths contain storage keys and tickets travel in the query string (S1-1, S3-5), and unmatched routes should log as 'unmatched'. (4) chi's RequestID trusts an inbound X-Request-Id header, so cap its length before echoing it back or logging it. No sign-off is needed if the query string is never logged, but a heads-up to Codex is cheap given S3-5.

<a id="q39"></a>
#### 39. Docker builds ignore lockfiles; `Dockerfile.web` copies `public/` to the wrong path

**Estimate:** 40m · **Sign-off:** No

**Problem:** Dockerfile.web runs `corepack prepare pnpm@latest` (the repo pins pnpm 9.15.0) and installs with --no-frozen-lockfile before pnpm-lock.yaml is copied. Every production build therefore re-resolves semver ranges from scratch; for example next ^16.2.0 can drift from the next@16.2.1 that CI tested. The runner copies public/ to /app/public, but the monorepo standalone server runs from /app/apps/web, so /manifest.json (referenced by layout metadata) returns 404. The manifest's icons are missing from the repo as well. Dockerfile.api copies go.mod without go.sum and builds with -mod=mod, which lets the image silently rewrite module files where CI's readonly build would fail.

**Evidence:**

- infra/docker/Dockerfile.web:3 - pnpm@latest, while package.json:21 has packageManager pnpm@9.15.0
- infra/docker/Dockerfile.web:7-13 - pnpm-lock.yaml not copied; pnpm install --no-frozen-lockfile
- pnpm-lock.yaml:983 - lock pins next@16.2.1
- infra/docker/Dockerfile.web:46,53 - public copied to ./public; CMD runs apps/web/server.js
- apps/web/src/app/layout.tsx:18 - manifest: /manifest.json
- apps/web/public/manifest.json:10-22 - icon-192.png and icon-512.png referenced; public/ holds only .gitkeep and manifest.json
- infra/docker/Dockerfile.api:10-11,16 - go.mod only; -mod=mod

**Proposed change:** Dockerfile.web: `COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./`, then `RUN corepack enable` (honours packageManager), then `pnpm install --frozen-lockfile`, then `COPY --from=builder /app/apps/web/public ./apps/web/public`, and drop the stray mkdir ./public. Add the two icons (put them under /icons/, which proxy.ts:59 already excludes, and update the manifest), or remove the icons array. Dockerfile.api: `COPY apps/api/go.mod apps/api/go.sum ./`, drop -mod=mod, add -trimpath.

**Verify:** `docker build -f infra/docker/Dockerfile.web --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 --build-arg NEXT_PUBLIC_WS_URL=ws://localhost:8080 .`: the log shows a frozen install with pnpm 9.15.0. Run the image and `curl -I localhost:3000/manifest.json` returns 200, as do the icon URLs. `docker build -f infra/docker/Dockerfile.api .` succeeds without -mod=mod.

**Reviewer note:** All evidence checks out. The public/ path is wrong: standalone server.js does chdir to /app/apps/web. The lockfile is lockfileVersion 9.0 with next@16.2.1. `--no-frozen-lockfile` was introduced on purpose in 1a17f4a4, before CI enforced a frozen install; ci.yml:91 now runs `pnpm install --frozen-lockfile`, so switching back is safe. An agent cannot easily produce real PNG icons, so the realistic slice is to remove the icons array or add placeholders under /icons/. /icon-*.png at the root would be caught by the proxy.ts matcher and redirected to /login. Two Docker builds, including a Next production build, push verification past 30 minutes. The -mod=mod/go.sum part is low value, because COPY apps/api/ restores go.sum before the build anyway.

<a id="q40"></a>
#### 40. CI builds and boots the production Docker images

**Estimate:** 40m · **Sign-off:** Yes

**Problem:** CI builds Go natively and runs `pnpm build`, but never builds infra/docker/Dockerfile.api or Dockerfile.web. Container-only defects therefore reach production undetected and surface only as a host-side deploy failure or a runtime bug: the missing /tmp in the scratch image (which breaks every S3 upload), the wrong public/ path in the standalone runner, and the unpinned pnpm@latest with no lockfile. A build job plus a short boot smoke test of the API image against the existing CI Postgres service would catch these.

**Evidence:**

- .github/workflows/ci.yml:7-117 - only the `go` and `node` jobs; no docker build
- .github/workflows/deploy.yml:31 - images are first built on the production host at deploy time
- infra/docker/Dockerfile.api:20-25 - scratch runtime with no /tmp; the defect is invisible to native go test
- apps/api/internal/storage/s3.go:211,314-315 - spool() uses os.CreateTemp for the non-seekable bufio reader passed at apps/api/internal/handlers/uploads.go:103
- infra/docker/Dockerfile.web:3,7-13,46 - pnpm@latest, no lockfile, public/ copied to the wrong path

**Proposed change:** Add a CI job that runs `docker build -f infra/docker/Dockerfile.api .` and `docker build -f infra/docker/Dockerfile.web` with the same NEXT_PUBLIC_* build args the node job uses. Optionally, in the go job after the services start, `docker run --network host` the API image with API_ENV=production, a 32+ char JWT_SECRET, PUBLIC_UPLOAD_ORIGIN, DATABASE_URL, and STORAGE_BACKEND=s3 pointed at the CI MinIO. Then curl /health and POST one small multipart upload with a legacy token, which fails today because of the missing /tmp. Use docker/build-push-action with a gha cache to keep it fast.

**Reviewer note:** Surfaced by the area verifier as a missed item; not independently re-verified by a second reviewer.

<a id="q41"></a>
#### 41. CI hygiene: fail on `init.sql` errors, least-privilege token, no duplicate runs

**Estimate:** 45m · **Sign-off:** Yes

**Problem:** `psql -f init.sql` runs without ON_ERROR_STOP, so a broken init.sql exits 0 and EnsureSchema can mask it. The CI token uses the repo-default permissions. push and pull_request are both unfiltered, so each PR commit runs CI twice. There are no timeouts. The Node version is hard-coded to 22 while engines says >=20, yet crypto tests import .ts directly and need Node 22.18+ type stripping. The pnpm version is declared twice. There is no gofmt check, although docs require gofmt. DB-backed tests skip silently when their URL is unset and have no REQUIRE switch, unlike S3's STORAGE_TEST_S3_REQUIRE. Disproved: CI caching is not worth work, since the full run takes about 50s with setup-go and pnpm caches.

**Evidence:**

- .github/workflows/ci.yml:61 - psql -f without -v ON_ERROR_STOP=1
- .github/workflows/ci.yml:3-5 - unfiltered push + pull_request; no permissions or concurrency block
- gh runs 35218893007 (push) and 35218909510 (pull_request) - same commit ran twice
- .github/workflows/ci.yml:83,87 - pnpm 9.15.0 and node 22 hard-coded; package.json:18,21
- packages/crypto/test.mjs:17 - imports ./src/index.ts directly
- docs/MINIO_DELEGATION_GUIDE.md:17 - requires gofmt
- apps/api/internal/db/schema_integration_test.go:25-27 and apps/api/internal/handlers/media_ticket_integration_test.go:176-178 - silent t.Skip
- apps/api/internal/storage/s3_test.go:78 and .github/workflows/ci.yml:28 - REQUIRE pattern exists for S3 only
- gh run 35219096908 - Go job 49s, Node job 33s

**Proposed change:** Add `-v ON_ERROR_STOP=1` to psql. Add top-level `permissions: contents: read`, concurrency `ci-${{ github.ref }}` with cancel-in-progress for non-master refs, `push: branches: [master]` (Codex decides this), and timeout-minutes: 15. Add .nvmrc (22), use node-version-file, set engines to >=22.18, and drop the pnpm action `version` so packageManager is the single source. Add a `test -z "$(gofmt -l .)"` step, formatting any files it lists in the same PR. Add DECO_TEST_DB_REQUIRE=1 so the DB tests t.Fatal instead of skipping, and set it in CI.

**Verify:** Push a PR and confirm a single CI run. Introduce a syntax error in a later statement of init.sql on a scratch branch and confirm the init step now fails. Unset TEST_DATABASE_URL on a scratch branch and confirm the tests fail instead of skipping. actionlint passes.

**Reviewer note:** The bundle is too wide for an hour once each change is verified. Narrow it to: ON_ERROR_STOP (ci.yml:61), top-level permissions plus concurrency plus timeouts, the push/pull_request dedupe (Codex decides the trigger), and the DECO_TEST_DB_REQUIRE switch for the three integration test files. Split .nvmrc/engines/pnpm single-source and the gofmt gate into a follow-up. gofmt -l may list files, which would expand the diff, and engines >=22.18 changes the README prerequisite. ON_ERROR_STOP may turn CI red if init.sql has errors that are currently masked. That is the intent, but it can blow the time budget. The permissions block adds little, because repos created after 2023 already default to a read-only GITHUB_TOKEN, but it is harmless.

<a id="q42"></a>
#### 42. D-8 first slice: vitest harness for `apps/web`, run in CI

**Estimate:** 50m · **Sign-off:** Yes

**Problem:** apps/web has no test runner. The backlog calls the WS reconnect logic and the optimistic-update paths the highest-risk untested code. The pure, exported pieces (mapWSEvent, mapMessage/resolveAssetUrl, the WSClient class) can be tested in node with no DOM, but nothing runs them. The Node job in CI only runs the crypto tests.

**Evidence:**

- docs/FEATURE_BACKLOG.md D-8 - 'apps/web has no tests and no runner'
- apps/web/package.json - scripts has no test entry; no vitest or jest dependency
- .github/workflows/ci.yml - the node job runs only `pnpm --filter @deco/crypto test`, type-check and build
- apps/web/src/lib/api.ts:335-391 - mapWSEvent is pure and exported (snake_case to camelCase for each WS event type)
- apps/web/src/lib/api.ts:285-305 - resolveAssetUrl (reachable through the exported mapMessage) rewrites /uploads/ to the media base
- apps/web/src/lib/websocket.ts:28-185 - WSClient is exported and depends only on the global WebSocket, timers and ./api resolveAuthToken

**Proposed change:** Add vitest as a devDependency of apps/web. Add apps/web/vitest.config.ts with resolve.alias '@' pointing to ./src and test.environment 'node', include src/**/*.test.ts. Add the script "test": "vitest run", a turbo 'test' task, and a CI step `pnpm --filter @deco/web test` in the node job. Tests: (a) src/lib/api.test.ts: mapWSEvent for message.read, typing, presence, message.reaction (add and remove) and message.deleted; mapMessage resolving '/uploads/x' to `${BASE}/api/v1/media/x` and leaving https:, blob: and data: untouched. (b) src/lib/websocket.test.ts: vi.mock('./api') so resolveAuthToken returns 'tok', stub a WebSocket class with OPEN/CONNECTING statics, fake timers; check backoff doubles up to the 30s cap, resets on open, and disconnect() stops reconnecting, and that the socket URL gets /ws and ?token=. Follow-ups (per fix, not in this slice): the upsertMessage cases once message-list.ts is extracted, and the batched-frame isolation case. Honest estimate: about 55 minutes for the harness, the two files and CI wiring; more tests come with each fix.

**Verify:** Run `pnpm --filter @deco/web test` locally and in CI. Temporarily break mapWSEvent (for example drop the conversation_id fallback) and confirm a test fails, then revert. Confirm `pnpm type-check` still passes, since the test files are covered by tsconfig include.

**Reviewer note:** Under 60 minutes only with a trimmed first slice: vitest devDependency, config, api.test.ts (mapWSEvent, mapMessage/resolveAssetUrl), the turbo task and a CI step. Leave the WSClient fake-timer/stub-WebSocket test as a follow-up; with it, 55 minutes is optimistic. apps/web/tsconfig.json includes **/*.ts, so both `tsc --noEmit` and `next build` will type-check the test files and vitest.config.ts. Import describe/it/expect explicitly. pnpm install must update pnpm-lock.yaml, because CI uses --frozen-lockfile (ci.yml:91). Do not touch the commented-out lint step (ci.yml:104-105, D-9). The CI edit falls under the D-1 boundary, so the sign-off flag is right.

<a id="q43"></a>
#### 43. D-9 slice: real ESLint flat config for `apps/web`, re-enable CI lint

**Estimate:** 60m · **Sign-off:** No

**Problem:** `pnpm lint` fails outright: next lint was removed in Next 16, no eslint dependency or config exists, and packages/config exports a missing ./eslint.js. CI's lint step is omitted on purpose until real ESLint exists, so type-check is the only JS static gate.

**Evidence:**

- apps/web/package.json:9 - "lint": "next lint"
- packages/config/package.json:7 - ./eslint points to the nonexistent eslint.js
- package.json:8 and turbo.json:14-16 - lint pipeline
- .github/workflows/ci.yml:96-105 - lint deliberately omitted, citing D-9
- AGENTS.md:57 - documented as broken

**Proposed change:** pnpm --filter @deco/web add -D eslint eslint-config-next@16. Create apps/web/eslint.config.mjs with defineConfig([...core-web-vitals, ...typescript, globalIgnores(['.next/**','next-env.d.ts'])]), set the script to `eslint .`, and delete the dangling ./eslint export. Fix the violations and uncomment the CI step. If the default react-hooks rules produce more errors than fit in the hour, land the config and script, keep the CI step omitted, and update the D-9 note with the error count. Do not disable rules to get green.

**Verify:** `pnpm lint` runs ESLint and exits 0. A deliberately added `useEffect` with a missing dependency makes it fail, which proves the gate enforces rules. The CI lint step is green on the PR.

**Reviewer note:** Confirmed at apps/web/package.json:9, packages/config/package.json:7 (eslint.js is absent) and ci.yml:96-105. The proposed flat config matches Next 16's documented shape, and apps/web pins typescript ^5.9.3, so typescript-eslint works despite the root TS 7. But the web source is about 14.4k lines with 99 useEffect calls, and eslint-config-next 16 ships the React-Compiler-era react-hooks rules, so a green run within the hour is unlikely. Plan for the documented fallback: land the config and script, keep the CI step omitted, and record the violation count in D-9. Per AGENTS rule 3 and D-9, rules must not be disabled to reach green.

<a id="q44"></a>
#### 44. Remove unused web dependencies, hook, types and dangling config export

**Estimate:** 25m · **Sign-off:** No

**Problem:** apps/web declares socket.io-client, emoji-mart, @emoji-mart/data, three, @react-three/drei, @react-three/fiber, @types/three, clsx and tailwind-merge. None is imported anywhere under apps/web/src. Next only bundles imported modules, so B-6's 'shipped to users' claim is inaccurate. The real cost is install and Docker build time, lockfile noise and supply-chain surface. Docs still advertise @react-three/fiber and socket.io.

**Evidence:**

- apps/web/package.json:18-20,23,25,30-32,40 - the dead dependency entries
- grep over apps/web/src - zero imports of any of them
- README.md:23 - tech stack lists @react-three/fiber
- AGENTS.md:106 and docs/ARCHITECTURE.md:37 - socket.io-client dead-code notes
- docs/FEATURE_BACKLOG.md:45 - B-6
- apps/web/package.json - lists socket.io-client, emoji-mart, @emoji-mart/data and @tanstack/react-query; grep of apps/web/src finds 0 imports of the first three
- apps/web/src/app/providers.tsx:3 and :47-54 - the only react-query usage (a provider with no consumers)
- apps/web/src/hooks/useHydration.ts:7-10 - no importers anywhere in apps/web/src
- packages/types/src/index.ts:226-235 - PaginatedResponse and ApiError interfaces, unused
- packages/config/package.json:7 - `"./eslint": "./eslint.js"`, but packages/config contains only package.json, tailwind.js and tsconfig.json
- AGENTS.md:106 - already documents socket.io-client as dead code

**Proposed change:** `pnpm --filter @deco/web remove socket.io-client emoji-mart @emoji-mart/data three @react-three/drei @react-three/fiber @types/three clsx tailwind-merge`, then commit the lockfile. Update README, AGENTS, ARCHITECTURE and the B-6 row. Leave @tanstack/react-query in place: it is used only as a provider (providers.tsx:3), so removing it is a separate decision.

**Verify:** pnpm install --frozen-lockfile, pnpm type-check, and pnpm build with the CI env. `grep -rE "three|socket.io|emoji-mart|clsx|tailwind-merge" apps/web/src` returns nothing.

**Reviewer note 1:** Confirmed: grep over apps/web and packages finds zero imports of any of the 9 packages, and none are referenced by config files (tailwind/postcss/next.config). The finder is right that B-6's 'bundle bloat' is inaccurate, because unimported packages are not bundled. The payoff is install and Docker build time, especially drei/fiber/three, plus supply-chain surface. It needs network access for pnpm remove, and the updated lockfile must pass `pnpm install --frozen-lockfile`.

**Reviewer note 2:** The finder missed more dead weight: three, @react-three/drei, @react-three/fiber and @types/three (apps/web/package.json) also have zero imports in apps/web. The 'bundle weight' claim is wrong for unimported packages, since Next doesn't bundle them. Only @tanstack/react-query (imported in providers.tsx:3) actually ships. The gain is mostly install size and lockfile hygiene, plus the react-query bundle. Removing the './eslint' export changes the evidence D-9 cites (packages/config/package.json:7), so update the D-9 wording rather than leave a stale citation. Requires a lockfile update (CI uses --frozen-lockfile).

<a id="q45"></a>
#### 45. Dead config (`ANTHROPIC_API_KEY`) and unreachable states (A-4 delivered, A-5 busy/away)

**Estimate:** 20m · **Sign-off:** No

**Problem:** ANTHROPIC_API_KEY is loaded and never used. .env.example lists JWT_EXPIRY, DATABASE_MAX_CONNECTIONS and APP_NAME, which nothing reads. Its DATABASE_URL (bahregram user/db) and password-less REDIS_URL do not match compose's deco user and requirepass, so a copied example will not boot. No code path sets a message to 'delivered' or presence to 'busy'/'away', yet the UI renders them. Dropping them is the <1h slice; implementing delivery acks is not. .claude/settings.local.json, a personal file with a local path and pre-approved `pnpm add/install`, is committed to the public repo. R2_* is deliberately excluded because it touches CSP and falls under the B-1 boundary.

**Evidence:**

- apps/api/internal/config/config.go:21,43 - AnthropicKey has no consumer
- .env.example:2-3,6,10,87,90 - bahregram URL, DATABASE_MAX_CONNECTIONS, redis without password, JWT_EXPIRY, ANTHROPIC_API_KEY, APP_NAME
- apps/api/internal/db/postgres.go:21 - MaxConns hard-coded to 25 (also overrides pool_max_conns)
- apps/api/internal/handlers/auth.go:225 - 7-day expiry hard-coded
- infra/compose/docker-compose.yml:10-12,28 - deco user and requirepass
- packages/types/src/index.ts:22,134 and apps/web/src/components/chat/MessageBubble.tsx:815-822 - delivered/busy/away
- apps/api/internal/websocket/hub.go:96,155,181 - only online/offline are produced
- .claude/settings.local.json:1-15 - committed personal permissions

**Proposed change:** Remove the AnthropicKey field and its env lines, including the infra/compose/.env.example:44 and Dockerfile.api:22 comments. Delete the unused example vars and set the DATABASE_URL/REDIS_URL defaults to compose's values. Shrink the TS unions to online|offline and sending|sent|read|failed and delete the delivered UI branch; keep the Postgres enum value. `git rm --cached .claude/settings.local.json` and gitignore it. Update the B-2, A-4 and A-5 rows.

**Verify:** go build ./... && go vet ./... && go test ./...; pnpm type-check fails on any remaining comparison with a removed literal. With a fresh cp .env.example .env pointed at infra compose, the API boots after only the passwords are filled in.

**Reviewer note:** The facts check out: AnthropicKey is used only at config.go:21,43; the example-only env vars are never read; 'delivered' is rendered at MessageBubble.tsx:815; busy/away appear in the types and store; .claude/settings.local.json is tracked on public master (gh contents API), and .gitignore does not list it, and it pre-approves `pnpm add:*`/`pnpm install:*` and contains a personal local path. But the backlog marks B-2, A-4 and A-5 as product decisions ('needs a product decision', 'either implement or drop', 'decide whether to implement or shrink'), so shrinking the TS unions and removing AnthropicKey should not be bundled in without that decision. Narrow the slice to `git rm --cached .claude/settings.local.json` (the gitignore entry already exists), plus aligning the root .env.example DATABASE_URL/REDIS_URL with compose and removing JWT_EXPIRY, DATABASE_MAX_CONNECTIONS and APP_NAME.

<a id="q46"></a>
#### 46. Align AGENTS/API/DATABASE/ARCHITECTURE/SECURITY_PLAN docs with `master`

**Estimate:** 35m · **Sign-off:** No

**Problem:** AGENTS.md is the single source of truth for agents, and it and the reference docs describe an older system. They say no AWS SDK is wired and media is a local-disk FileServer. They mark uploads and group keys as untested. API.md omits routes, and DATABASE.md claims group_keys is not in init.sql. ARCHITECTURE says uploads are not E2E encrypted. The docs index says the MinIO guide exists only on a branch. This misleads agents into duplicate work or wrong assumptions.

**Evidence:**

- AGENTS.md:87,99 vs apps/api/go.mod:6-8, apps/api/internal/storage/s3.go and apps/api/cmd/server/media_routes.go:12-21
- AGENTS.md:65-75 vs uploads_test.go, conversations_group_keys_test.go and media_ticket_integration_test.go in apps/api/internal/handlers
- docs/API.md:39-69 missing POST group-key-epochs (routes.go:76), GET media-ticket (routes.go:116) and the media routes; :88 says uploads go to local disk
- docs/DATABASE.md:7 vs infra/compose/init.sql:99; :17 enum lacks location/contact (init.sql:66); epochs, copies, media_objects and audit tables not documented
- docs/ARCHITECTURE.md:13-15,29,57 vs docs/STATUS.md:20-31
- docs/README.md:25-27,49-53 and docs/PLATFORM_MIGRATION_PLAN.md:13-14 vs docs/MINIO_DELEGATION_GUIDE.md on master

**Proposed change:** Rewrite the stale sections to match the code: storage (local|s3 plus tickets), Clerk/HS256 auth, the current test inventory, the full route table from routes.go and media_routes.go, the table list from init.sql and EnsureSchema, and the encrypted-attachment model. Do not edit SECURITY_PLAN.md; its stale lines go to Codex.

**Verify:** A second agent diffs each route in routes.go and media_routes.go against API.md, and each CREATE TABLE in init.sql and postgres.go against DATABASE.md. Every relative link resolves (a markdown link checker, or grep the link targets).

**Reviewer note:** The drift is real: AGENTS.md:87,99 vs the aws-sdk in go.mod and media_routes.go; API.md:88 still says 'local disk'; routes.go:76,116 are missing from API.md; ARCHITECTURE.md:13-15,57 is stale; docs/README.md:47-53 says MINIO_DELEGATION_GUIDE is branch-only, but it is on master. The full six-doc rewrite (48 routes, about 6 undocumented tables) plus independent verification does not fit in 45 minutes; about 75-90 is realistic. Keep only the high-leverage slice: AGENTS.md (test inventory :65-75, :87, :99, :106), docs/README.md :47-53, DATABASE.md :7 and the trigger claim, and the ARCHITECTURE storage paragraph. Do the full API.md route table and DATABASE.md table list as a follow-up.

<a id="q47"></a>
#### 47. SETUP.md step that blocks `deploy.sh`; nginx body-size and caching errors

**Estimate:** 35m · **Sign-off:** No

**Problem:** SETUP.md tells operators to `sed -i` the tracked infra/nginx/nginx.conf. deploy.sh then refuses to run because of tracked local changes. The Go tarball URL 404s (Go names it go1.23.0), and Go and Node are not needed for the Docker deploy anyway. `corepack prepare pnpm@latest` conflicts with the pinned pnpm 9.15.0. README links the missing docs/TOMORROW.md. In nginx, a 50m body cap sits in front of a 101 MB API body limit (100 MB video, 50 MB files plus multipart overhead), so those uploads get 413. Every .js/.css/.png/.svg is cached for 1y immutable, including non-hashed paths such as /__clerk. Because that nested location sets its own add_header, it also drops the server-level HSTS, X-Frame-Options and nosniff headers.

**Evidence:**

- SETUP.md:55 - sed -i edits the tracked infra/nginx/nginx.conf
- deploy.sh:30-33 - refuses to deploy over tracked local changes
- SETUP.md:19-20 - go1.23.linux-amd64.tar.gz (nonexistent file name)
- SETUP.md:16 and README.md:48 - pnpm@latest vs package.json:21
- README.md:134 - docs/TOMORROW.md, moved per docs/README.md:43-45
- infra/nginx/nginx.conf:69 - client_max_body_size 50m vs apps/api/internal/handlers/uploads.go:28,195,199
- infra/nginx/nginx.conf:81-85 - immutable 1y regex cache with its own add_header; server headers at :34-36 are not inherited
- apps/web/src/proxy.ts:18 - /__clerk proxy path is served by web

**Proposed change:** SETUP.md: render the template with `sed 's/yourdomain.com/.../g' infra/nginx/nginx.conf | sudo tee /etc/nginx/sites-available/deco`, drop or fix the Go/Node VPS steps, and use `corepack enable`. README: fix the link and trim the stale 2026-08-12 handoff section. nginx: set `client_max_body_size 101m` on /api/, and replace the regex block with `location /_next/static/ { proxy_pass http://web; add_header Cache-Control "public, max-age=31536000, immutable"; <repeat security headers> }`.

**Verify:** Run `docker run --rm -v $PWD/infra/nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine nginx -t`, stubbing the cert paths with a self-signed pair. Follow SETUP step 3 on a checkout, then check that `git status` is clean and that deploy.sh passes its dirty-tree check. `curl -I` on a /_next/static asset shows HSTS and immutable; /login is not immutable.

**Reviewer note:** Every claim verified: SETUP.md:55 vs deploy.sh:30-33; go1.23.linux-amd64.tar.gz does not exist (the file is go1.23.0); README.md:134 links docs/TOMORROW.md, which moved to docs/archive; nginx.conf:69 sets 50m; the nested add_header at :84 drops the server-level headers. Value is low because this template and runbook serve the infra-compose path, which does not appear to be the live one. The 413 only affects plaintext Saved-Messages video over 50 MB and 50 MB files, since encrypted attachments are capped at 20 MB (conversations.ts:186). Deleting the stale 2026-08-12 handoff section is a doc-owner decision, so fix the link and leave the section alone unless someone approves removing it.


## Real, but over an hour

Verified as real, but left off the list because the honest estimate is more than an hour:

- **D-2 slice: test that EnsureSchema is a no-op on a fresh init.sql database, and backfill init.sql** — The drift is real: media_objects is only at postgres.go:269-280, and trg_group_leadership_cycles_updated_at is only at :708-719. There is more drift the test would surface immediately. init.sql:43 and :82 declare unnamed CHECKs (auto-named *_check), while EnsureSchema adds named ones (conversations_group_key_epoch_nonnegative and messages_group_key_epoch_positive, postgres.go:227-261) when the name is absent. So every fresh init.sql database gets duplicate CHECKs on the S1-2 group-key-epoch columns. Reconciling constraint definitions on key-epoch and media tables is Codex-owned. The unknown size of the full catalog diff makes 50 minutes unrealistic. Reject as scoped. A safe sub-slice, with Codex sign-off: backfill media_objects and the trigger into init.sql, name the two CHECKs to match EnsureSchema, and fix DATABASE.md:7,33.
- **Consistent modal behaviour: Esc-to-close, role=dialog/aria-modal, focus restore for the 8 modals that lack it** — The gap is real: grep finds zero role=dialog, aria-modal or aria-labelledby, and the listed modals lack Esc. The plan as scoped does not fit an hour, and its verification is invalid. SharedMediaPortal never opens ImageLightbox; ImageLightbox is used only from MessageBubble.tsx:360. A topmost-only Esc stack also needs ImageLightbox (ImageLightbox.tsx:33-38), MessageContextMenu and KeyboardShortcutsOverlay (its global Escape at :31) to join, and none of them are in files_touched. Otherwise one Esc still closes several layers. Focus-in and restore across AnimatePresence portals in 8 components adds more. A sub-hour slice: add Esc-to-close plus role='dialog', aria-modal and aria-labelledby to the 8 panels, with no stack and no focus management, in about 35 minutes.
- **Stop whole-store subscriptions re-rendering every conversation row and message bubble on every WS event** — The whole-store subscriptions (ChatPanel.tsx:55, ConversationList.tsx:47,315) and the missing memo are real. But the proposed change will not produce the stated result. The presence handler (conversations.ts:1337-1353) rebuilds every conversation object on every presence event. So every MessageBubble's `s.conversations.find(...)` selector (MessageBubble.tsx:146-148, and use-media-ticket.ts:123) returns a new object, and every ConversationItem gets a new `conversation` prop. Bubbles and rows still re-render after memo and selectors. Upload progress goes through withReplyLinks (conversations.ts:1616-1620), which recreates every message object, so memo does nothing for upload ticks either. Two of the three verification scenarios would fail unless the reducers also preserve object identity. With that added, this is medium-risk and well over an hour. The only cheap, verifiable part is the ImageLightbox listener gate; see the missed candidates.
- **Limit JSON request body size globally and cap stored ciphertext and text fields** — The gap is real: 19 json.NewDecoder sites exist, only 3 handlers bound their body, and nginx allows 50m on /api/ (nginx.conf:69). As proposed, though, the change does not fit an hour. It rewires about 11 decode sites to a new decodeJSON, adds 7 field validators across Send/Edit/poll/Create/Update/UpdateMe with table tests, and needs manual checks. That is realistically 75-90 minutes. A slice of about 25 minutes does fit: add chimiddleware.RequestSize(1<<20) to the auth, users, conversations, messages and stickers groups in routes.go (uploads keep their own limit), add an encrypted_content length cap in Send and Edit, and add one router test. The existing 'invalid request body' 400 is an acceptable response on overflow. Note the mitigations already present: http.Server ReadTimeout is 10s (main.go:170), and host nginx buffers bodies. The users group includes PUT /users/me/key-backup (user_key_backups), so tell Codex even though the 1 MiB cap changes nothing for real backups.

Also real and small, but low value because the web UI cannot reach it: `POST /conversations` validation (an unknown type returns 500, a direct conversation with 0 or 2+ members is accepted, `tx.Exec` errors are ignored). A 25-minute slice is possible.


## Stale documentation found

Claims in existing docs that no longer match `master` (inputs for [#46](#q46)):

- **A-1 (forgot-password link to a nonexistent page)** — The page now exists: apps/web/src/app/(auth)/forgot-password/page.tsx is an explanatory placeholder that redirects to /login in Clerk mode, and proxy.ts:9 marks it public. The link no longer 404s. What is still missing is the actual reset flow, so reword the item.
- **A-2 (location/contact cannot be sent)** — Fixed at schema and compose level. init.sql:66 and postgres.go:100-126 add the enum values; the send path is at MessageInput.tsx:446-476 and rendering at MessageBubble.tsx:518-560. The remaining blocker is the Permissions-Policy geolocation=() header at next.config.ts:109 (candidate permissions-policy-blocks-location-video).
- **A-3 (POST /auth/refresh returns 501)** — Accurate only for legacy mode (auth.go:218-220). In Clerk mode (infra compose sets CLERK_ENABLED=true at docker-compose.yml:95) the /auth routes are not registered (routes.go:18-25).
- **B-1 (R2 unused; local.go is the only storage backend)** — Stale. An S3-compatible backend exists (storage/s3.go, s3_buckets.go, factory.go, config/storage.go) and infra compose runs MinIO with STORAGE_BACKEND=s3. Only the R2_* fields are dead (config.go:16-20,38-42), and config/storage.go:98 notes they are deliberately not consulted. R2 could be used through STORAGE_S3_*.
- **B-6 (dead deps shipped to users / bundle bloat)** — The impact claim is inaccurate: Next bundles only imported modules and these have zero imports, so the cost is install, build and supply-chain surface. The list is also incomplete: three, @react-three/drei, @react-three/fiber, @types/three, clsx and tailwind-merge are unused too.
- **D-1/D-3/D-4/D-5 ('Implemented on codex/mvp-integration')** — Merged to master (PR #3, 16da5c64). D-1's follow-up is still undone: GET repos/matinz03/deco/branches/master/protection returns 404 'Branch not protected'.
- **D-2 (group_keys exists only in the Go path)** — Stale: init.sql:99 creates group_keys, and :108 and :116 create the epoch and copy tables. Drift persists elsewhere: media_objects (postgres.go:269) and trg_group_leadership_cycles_updated_at (postgres.go:716) exist only in EnsureSchema.
- **D-3 (deploys locked, backed up, rolled back via deploy.sh)** — The automatic GitHub deploy (deploy.yml:31) runs an external `project-deploy deco` that is not in the repo, not deploy.sh. The backup and rollback guarantees are therefore proven only for manual or watch-deploy runs. Root compose.yaml, which the deploy PRs edited, has no MinIO service, so backup.sh cannot run against that stack.
- **docs/SECURITY_PLAN.md:15-19 (S1-1 remediation NOT on master)** — Stale. master has storage/media_ticket.go, storage/media_handler.go, cmd/server/media_routes.go and GET .../media-ticket (routes.go:116), and STATUS.md:12-14 records the work as integrated. Codex should update the banner.
- **docs/SECURITY_PLAN.md:49 (S1-1 evidence: FileServer at main.go:102-106)** — No longer present. Media is served by storage.NewMediaHandler (media_routes.go:17-20).
- **docs/SECURITY_PLAN.md:52,109 and :141 (unsafe-eval; S3-9 CheckOrigin returns true)** — Both fixed: production CSP omits unsafe-eval (next.config.ts:118-121), and makeCheckOrigin validates the origin (websocket/handler.go:24-64). The row text is stale although the status table is correct.
- **docs/SECURITY_PLAN.md:27 (S2-3 Fixed)** — Overstated. The guard rejects only '' and 'change-me' (config.go:47). compose.yaml:54's fallback secret and both .env.example placeholders pass in production (candidate jwt-secret-fail-open-defaults).
- **docs/SECURITY_PLAN.md:138 (S3-6 client-supplied media_url)** — Appears closed. Send requires media_url to resolve to a media_objects row owned by the caller (messages.go:410-423). Codex to confirm.
- **AGENTS.md:65-75,87,99 (test coverage; no AWS SDK; local FileServer storage)** — Stale. The AWS SDK v2 is wired (go.mod:6-8, storage/s3.go). Uploads, group keys, media tickets, storage and Clerk all have tests now.
- **docs/README.md:49-53, docs/PLATFORM_MIGRATION_PLAN.md:13-14 (MinIO guide only on a branch)** — docs/MINIO_DELEGATION_GUIDE.md is on master. The plan is also labeled 'proposal, not approved' although the Clerk and storage work is integrated (STATUS.md:15-25).
- **docs/DATABASE.md:7,17,33** — group_keys is in init.sql. The message_type list is missing location/contact. The leadership-cycles trigger is attached only by EnsureSchema, not by init.sql.
- **README.md:131-158 and :134** — The dated 2026-08-12 handoff describes unmerged work that has since been merged, and it links docs/TOMORROW.md, which was moved to docs/archive/SESSION_1_HANDOFF_2026-08-10.md.
- **docs/ARCHITECTURE.md:29 (uploads are not E2E encrypted)** — Inaccurate. DM and group attachments are encrypted before upload (STATUS.md:26-29; conversations.ts:186-187 encrypted size limits). Only Saved Messages stay plaintext.
- **SECURITY_PLAN S2-2 evidence ('auth.ts:137 document.cookie'; next.config.ts "'unsafe-inline' 'unsafe-eval'")** — The evidence is outdated. The cookie write is now at apps/web/src/store/auth.ts:135, and 'unsafe-eval' is dev-only (apps/web/next.config.ts:118-121). The cookie is still not HttpOnly and has no Secure flag, so the item remains open as the Status table says.
- **docs/FEATURE_BACKLOG.md D-1 ('Implemented on codex/mvp-integration')** — CI is on master (.github/workflows/ci.yml): go build, vet and test against live Postgres and MinIO, crypto tests, type-check and the Next build. The branch wording is stale. Note: `go test` runs without -race (ci.yml:73) even though the WebSocket hub is concurrency-heavy.
- **docs/SECURITY_PLAN.md S1-2 evidence (PutGroupKeys upserts caller-supplied rows without membership or encrypted_by checks)** — The evidence text is stale. PutGroupKeys rejects a forged encrypted_by (handlers/conversations.go:731-734) and delegates to createGroupKeyEpoch: owner/admin only, epoch compare-and-swap, one copy for every current member (conversations.go:770-885, 940-962). The Status table already reflects this.
- **docs/SECURITY_PLAN.md S3-6 (media_url is client-supplied and stored verbatim)** — Mostly fixed. image, video, audio and file messages must reference a media_objects row the sender owns (handlers/messages.go:257-270). Residual: type=sticker still stores a client-supplied media_url verbatim (messages.go:206,227-230; sticker is not in isPrivateMediaMessage at :364-369), sticker_id has no FK (init.sql:83), and the web client falls back to mediaUrl (apps/web/src/components/chat/MessageBubble.tsx:386-399). Production CSP img-src (apps/web/next.config.ts:39,130) blocks external hosts, which limits the impact.
