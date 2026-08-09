# API Reference

Base URL: `{API_URL}/api/v1` (e.g. `http://localhost:8080/api/v1`). All routes except `POST /auth/register` and `POST /auth/login` require `Authorization: Bearer <jwt>`.

Two routes live outside `/api/v1`:
- `GET /health` → `{"status":"ok"}`
- `GET /ws?token=<jwt>` — WebSocket upgrade (see [`ARCHITECTURE.md`](ARCHITECTURE.md#realtime-websocket))

Media is served (not under `/api/v1`) at `PUBLIC_UPLOAD_BASE` (default `/api/v1/media/*`), plus a legacy `/uploads/*` alias — both are static file serves of `UPLOAD_ROOT`.

Route definitions live in `apps/api/internal/handlers/routes.go`; this doc mirrors that file.

## Auth — `/auth` (public)

| Method | Path | Handler |
|---|---|---|
| POST | `/auth/register` | `AuthHandler.Register` — creates a user; the first user ever registered becomes admin. Requires `username`, `password` (≥8 chars), `display_name`, `public_key`; `email` or `phone_number` optional. |
| POST | `/auth/login` | `AuthHandler.Login` — by `email` or `phone_number` + `password`. |
| POST | `/auth/logout` | `AuthHandler.Logout` |
| POST | `/auth/refresh` | `AuthHandler.Refresh` — **returns 501 Not Implemented**; no refresh-token flow exists yet. |

## Users — `/users` (authenticated)

| Method | Path | Handler |
|---|---|---|
| GET | `/users/me` | `GetMe` |
| PATCH | `/users/me` | `UpdateMe` |
| GET | `/users/me/key-backup` | `GetKeyBackup` — encrypted private-key backup |
| PUT | `/users/me/key-backup` | `PutKeyBackup` |
| DELETE | `/users/me/key-backup` | `DeleteKeyBackup` |
| GET | `/users/admin` | `ListAdminUsers` — admin only |
| PATCH | `/users/admin/{userID}` | `UpdateAdminUser` — admin only; set `is_admin`/`restricted_actions` |
| DELETE | `/users/admin/{userID}` | `DeleteAdminUser` — admin only |
| GET | `/users/search` | `Search` — fuzzy search via `pg_trgm` on username/display name |
| GET | `/users/{userID}` | `GetUser` |

## Conversations — `/conversations` (authenticated)

| Method | Path | Handler |
|---|---|---|
| GET | `/conversations/` | `List` |
| POST | `/conversations/` | `Create` |
| GET | `/conversations/{conversationID}` | `Get` |
| PATCH | `/conversations/{conversationID}` | `Update` |
| DELETE | `/conversations/{conversationID}` | `Delete` |
| GET | `/conversations/{conversationID}/leadership` | `GetLeadershipStatus` |
| POST | `/conversations/{conversationID}/leadership/object` | `ObjectToLeadership` |
| POST | `/conversations/{conversationID}/leadership/vote` | `VoteLeadership` |
| GET | `/conversations/{conversationID}/members` | `ListMembers` |
| POST | `/conversations/{conversationID}/members` | `AddMember` |
| PATCH | `/conversations/{conversationID}/members/{userID}` | `UpdateMemberRole` |
| DELETE | `/conversations/{conversationID}/members/{userID}` | `RemoveMember` |
| GET | `/conversations/{conversationID}/group-key` | `GetGroupKey` — this member's encrypted copy of the group key |
| PUT | `/conversations/{conversationID}/group-keys` | `PutGroupKeys` — distribute per-member encrypted keys (called when a member joins) |

## Messages — `/conversations/{conversationID}/messages` (authenticated)

| Method | Path | Handler |
|---|---|---|
| GET | `/conversations/{conversationID}/messages/` | `List` — paginated |
| POST | `/conversations/{conversationID}/messages/` | `Send` — broadcasts `message.new` over the WebSocket hub |
| POST | `/conversations/{conversationID}/messages/read` | `MarkRead` — broadcasts `message.read` |
| PATCH | `/conversations/{conversationID}/messages/{messageID}` | `Edit` — broadcasts `message.edited` |
| DELETE | `/conversations/{conversationID}/messages/{messageID}` | `Delete` — broadcasts `message.deleted` |
| POST | `/conversations/{conversationID}/messages/{messageID}/poll/vote` | `VotePoll` |
| POST | `/conversations/{conversationID}/messages/{messageID}/reactions` | `AddReaction` — broadcasts `message.reaction` |
| DELETE | `/conversations/{conversationID}/messages/{messageID}/reactions/{emoji}` | `RemoveReaction` |

## Stickers — `/stickers` (authenticated)

| Method | Path | Handler |
|---|---|---|
| GET | `/stickers/packs` | `ListPacks` |
| POST | `/stickers/packs` | `CreatePack` |
| GET | `/stickers/packs/{packID}` | `GetPack` |
| DELETE | `/stickers/packs/{packID}` | `DeletePack` |
| POST | `/stickers/packs/{packID}/clone` | `ClonePack` — clone another user's shared pack |
| POST | `/stickers/packs/{packID}/stickers` | `AddSticker` |
| DELETE | `/stickers/packs/{packID}/stickers/{stickerID}` | `DeleteSticker` |
| POST | `/stickers/import/telegram` | `ImportTelegramPack` — requires `TELEGRAM_BOT_TOKEN` configured |

## Uploads — `/uploads` (authenticated)

| Method | Path | Handler |
|---|---|---|
| POST | `/uploads/` | `Create` — multipart file upload; stored to local disk under `UPLOAD_ROOT`, returns the public URL to reference from a message/avatar/sticker |

## WebSocket events

Sent by the server over `/ws`, newline-delimited JSON, `{"type": "...", "payload": {...}}`:

| Type | Emitted by |
|---|---|
| `message.new` | `POST /conversations/{id}/messages/` |
| `message.edited` | `PATCH /conversations/{id}/messages/{id}` |
| `message.deleted` | `DELETE /conversations/{id}/messages/{id}` |
| `message.reaction` | `POST/DELETE .../reactions` |
| `message.read` | `POST /conversations/{id}/messages/read` |
| `typing` | client-originated, relayed by the hub |
| `presence` | connect/disconnect, relayed by the hub |

## Errors

Non-2xx responses are JSON: `{"error": "message"}`. Rate limiting is global — 100 requests/minute per IP (`httprate.LimitByIP`) — applies to every route above, including `/auth/*`.
