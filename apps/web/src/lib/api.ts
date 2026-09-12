import type {
  User,
  Conversation,
  Message,
  WSEvent,
  KeyBackupPayload,
  KeyBackupResponse,
  KeyBackupRecord,
  Member,
  MemberRole,
  UploadKind,
  UploadResponse,
  Poll,
  CreatePollInput,
  LeadershipStatus,
  Sticker,
  StickerPack,
  AddStickerInput,
  CreateStickerPackInput,
  UserRestriction,
} from "@deco/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const PUBLIC_UPLOAD_BASE = process.env.NEXT_PUBLIC_UPLOAD_BASE ?? "/api/v1/media";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Supplies a Clerk session token. Registered by ClerkBootstrapGate rather than
 * imported, so this module stays free of React and of @clerk/nextjs — it is
 * used from stores and plain functions as well as components.
 *
 * Clerk tokens are short-lived (60s by default), so this is called per request
 * rather than cached. Clerk's own SDK caches and refreshes behind getToken().
 */
type ClerkTokenProvider = () => Promise<string | null>;

let clerkTokenProvider: ClerkTokenProvider | null = null;

export function setClerkTokenProvider(provider: ClerkTokenProvider | null) {
  clerkTokenProvider = provider;
}

/**
 * Clerk first, legacy second. During the dual-path migration a browser can
 * hold both; the Go API only accepts one, decided by CLERK_ENABLED, and a
 * Clerk session is the newer intent.
 */
export async function resolveAuthToken(): Promise<string | null> {
  if (clerkTokenProvider) {
    try {
      const token = await clerkTokenProvider();
      if (token) return token;
    } catch {
      // Fall back to the legacy token rather than failing the request.
    }
  }
  return typeof window !== "undefined" ? localStorage.getItem("deco_token") : null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await resolveAuthToken();
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;

  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? "Unknown error");
  }

  return res.json();
}

// ─── Response mappers (Go API returns snake_case, TS types are camelCase) ─────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapUser(r: any): User {
  return {
    id: r.id,
    username: r.username ?? "",
    email: r.email ?? "",
    displayName: r.display_name ?? r.displayName ?? "",
    avatarUrl: resolveAssetUrl(r.avatar_url ?? r.avatarUrl ?? ""),
    publicKey: r.public_key ?? r.publicKey ?? "",
    bio: r.bio ?? "",
    isAdmin: Boolean(r.is_admin ?? r.isAdmin ?? false),
    isOwner: Boolean(r.is_owner ?? r.isOwner ?? false),
    restrictedActions: Array.isArray(r.restricted_actions ?? r.restrictedActions)
      ? (r.restricted_actions ?? r.restrictedActions) as UserRestriction[]
      : [],
    lastSeenAt: r.last_seen_at ?? r.lastSeenAt ?? "",
    createdAt: r.created_at ?? r.createdAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMessage(r: any): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id ?? r.conversationId ?? "",
    senderId: r.sender_id ?? r.senderId ?? "",
    sender: r.sender ? mapUser(r.sender) : undefined,
    type: r.type ?? "text",
    encryptedContent: r.encrypted_content ?? r.encryptedContent ?? "",
    decryptedContent: r.decrypted_content ?? r.decryptedContent,
    mediaUrl: resolveAssetUrl(r.media_url ?? r.mediaUrl),
    mediaName: r.media_name ?? r.mediaName,
    mediaMimeType: r.media_mime_type ?? r.mediaMimeType,
    mediaSize: r.media_size ?? r.mediaSize,
    mediaEncrypted: Boolean(r.media_encrypted ?? r.mediaEncrypted ?? false),
    groupKeyEpoch: r.group_key_epoch ?? r.groupKeyEpoch,
    sticker: r.sticker ? mapSticker(r.sticker) : undefined,
    poll: r.poll ? mapPoll(r.poll) : undefined,
    replyToId: r.reply_to_id ?? r.replyToId,
    reactions: (r.reactions ?? []).map(mapReaction),
    status: r.status ?? "sent",
    isEdited: r.is_edited ?? r.isEdited ?? false,
    isDeleted: r.is_deleted ?? r.isDeleted ?? false,
    sentAt: r.sent_at ?? r.sentAt ?? "",
    editedAt: r.edited_at ?? r.editedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReaction(r: any) {
  return {
    messageId: r.message_id ?? r.messageId ?? "",
    userId: r.user_id ?? r.userId ?? "",
    user: r.user ? mapUser(r.user) : undefined,
    emoji: r.emoji ?? "",
    createdAt: r.created_at ?? r.createdAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapConversation(r: any): Conversation {
  return {
    id: r.id,
    type: r.type ?? "direct",
    name: r.name ?? "",
    avatarUrl: resolveAssetUrl(r.avatar_url ?? r.avatarUrl ?? ""),
    description: r.description ?? "",
    createdById: r.created_by_id ?? r.createdById ?? "",
    lastMessage: r.last_message ? mapMessage(r.last_message) : undefined,
    unreadCount: r.unread_count ?? r.unreadCount ?? 0,
    memberCount: r.member_count ?? r.memberCount ?? 0,
    members: r.members ? r.members.map(mapMember) : undefined,
    createdAt: r.created_at ?? r.createdAt ?? "",
    updatedAt: r.updated_at ?? r.updatedAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKeyBackupRecord(r: any): KeyBackupRecord {
  return {
    version: r.version,
    kdf: r.kdf,
    iterations: r.iterations,
    salt: r.salt,
    cipher: r.cipher,
    iv: r.iv,
    ciphertext: r.ciphertext,
    createdAt: r.created_at ?? r.createdAt ?? "",
    updatedAt: r.updated_at ?? r.updatedAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapKeyBackupResponse(r: any): KeyBackupResponse {
  return {
    exists: Boolean(r?.exists),
    backup: r?.backup ? mapKeyBackupRecord(r.backup) : undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapUploadResponse(r: any): UploadResponse {
  return {
    // Keep the upload's canonical relative path when it is sent back to the
    // API as media_url. Resolving it here would turn it into an absolute URL,
    // which would either force the server to trust an origin supplied by the
    // client or let an attacker substitute a different origin. Messages are
    // resolved for display by mapMessage after the server has authorized them.
    url: r.url ?? "",
    mimeType: r.mime_type ?? r.mimeType ?? "",
    size: r.size ?? 0,
    name: r.name ?? "",
    kind: r.kind ?? "file",
    encrypted: Boolean(r.encrypted ?? false),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSticker(r: any): Sticker {
  return {
    id: r.id ?? "",
    packId: r.pack_id ?? r.packId ?? "",
    name: r.name ?? "",
    emoji: r.emoji ?? "",
    assetUrl: resolveAssetUrl(r.asset_url ?? r.assetUrl ?? ""),
    thumbnailUrl: resolveAssetUrl(r.thumbnail_url ?? r.thumbnailUrl ?? ""),
    mimeType: r.mime_type ?? r.mimeType ?? "",
    format: r.format ?? "static",
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    telegramFileId: r.telegram_file_id ?? r.telegramFileId,
    telegramUniqueFileId: r.telegram_unique_file_id ?? r.telegramUniqueFileId,
    sortOrder: r.sort_order ?? r.sortOrder ?? 0,
    createdAt: r.created_at ?? r.createdAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapStickerPack(r: any): StickerPack {
  return {
    id: r.id ?? "",
    ownerId: r.owner_id ?? r.ownerId ?? "",
    name: r.name ?? "",
    slug: r.slug ?? "",
    title: r.title ?? "",
    description: r.description ?? "",
    source: r.source ?? "deco",
    telegramSetName: r.telegram_set_name ?? r.telegramSetName,
    stickerCount: r.sticker_count ?? r.stickerCount ?? 0,
    coverStickerId: r.cover_sticker_id ?? r.coverStickerId,
    coverSticker: r.cover_sticker ? mapSticker(r.cover_sticker) : undefined,
    stickers: (r.stickers ?? []).map(mapSticker),
    createdAt: r.created_at ?? r.createdAt ?? "",
    updatedAt: r.updated_at ?? r.updatedAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPoll(r: any): Poll {
  return {
    messageId: r.message_id ?? r.messageId ?? "",
    question: r.question ?? "",
    allowsMultiple: Boolean(r.allows_multiple ?? r.allowsMultiple ?? false),
    totalVotes: r.total_votes ?? r.totalVotes ?? 0,
    options: (r.options ?? []).map((option: any) => ({
      id: option.id ?? "",
      text: option.text ?? "",
      voteCount: option.vote_count ?? option.voteCount ?? 0,
      votedByMe: Boolean(option.voted_by_me ?? option.votedByMe ?? false),
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapLeadershipStatus(r: any): LeadershipStatus {
  return {
    conversationId: r.conversation_id ?? r.conversationId ?? "",
    currentOwnerId: r.current_owner_id ?? r.currentOwnerId ?? "",
    objectionCount: r.objection_count ?? r.objectionCount ?? 0,
    objectionThreshold: r.objection_threshold ?? r.objectionThreshold ?? 0,
    hasObjected: Boolean(r.has_objected ?? r.hasObjected ?? false),
    canObject: Boolean(r.can_object ?? r.canObject ?? false),
    objectionCooldownEndsAt: r.objection_cooldown_ends_at ?? r.objectionCooldownEndsAt,
    electionActive: Boolean(r.election_active ?? r.electionActive ?? false),
    electionEndsAt: r.election_ends_at ?? r.electionEndsAt,
    hasVoted: Boolean(r.has_voted ?? r.hasVoted ?? false),
    votedForUserId: r.voted_for_user_id ?? r.votedForUserId,
    turnoutCount: r.turnout_count ?? r.turnoutCount ?? 0,
    turnoutThreshold: r.turnout_threshold ?? r.turnoutThreshold ?? 0,
    candidates: (r.candidates ?? []).map((candidate: any) => ({
      userId: candidate.user_id ?? candidate.userId ?? "",
      displayName: candidate.display_name ?? candidate.displayName ?? "",
      username: candidate.username ?? "",
      avatarUrl: resolveAssetUrl(candidate.avatar_url ?? candidate.avatarUrl ?? ""),
      voteCount: candidate.vote_count ?? candidate.voteCount ?? 0,
    })),
  };
}

function resolveAssetUrl(value?: string) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) {
    return value;
  }

  const normalizedBase = BASE.replace(/\/$/, "");
  const normalizedUploadBase = PUBLIC_UPLOAD_BASE.startsWith("/")
    ? PUBLIC_UPLOAD_BASE
    : `/${PUBLIC_UPLOAD_BASE}`;

  if (value.startsWith("/uploads/")) {
    return `${normalizedBase}${normalizedUploadBase}${value.slice("/uploads".length)}`;
  }

  if (value.startsWith("/")) {
    return `${normalizedBase}${value}`;
  }

  return `${normalizedBase}/${value.replace(/^\//, "")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapMember(r: any): Member {
  const maybeFlatUser =
    r.user ??
    ((r.id || r.username || r.display_name || r.displayName)
      ? {
          id: r.id,
          username: r.username,
          display_name: r.display_name ?? r.displayName,
          avatar_url: r.avatar_url ?? r.avatarUrl,
          public_key: r.public_key ?? r.publicKey,
          bio: r.bio,
          last_seen_at: r.last_seen_at ?? r.lastSeenAt,
          created_at: r.created_at ?? r.createdAt,
        }
      : undefined);

  return {
    conversationId: r.conversation_id ?? r.conversationId ?? "",
    userId: r.user_id ?? r.userId ?? maybeFlatUser?.id ?? "",
    user: maybeFlatUser ? mapUser(maybeFlatUser) : undefined,
    role: (r.role ?? "member") as MemberRole,
    joinedAt: r.joined_at ?? r.joinedAt ?? "",
    lastReadAt: r.last_read_at ?? r.lastReadAt ?? "",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapWSEvent(event: any): WSEvent {
  switch (event?.type) {
    case "message.new":
    case "message.edited":
      return { type: event.type, payload: mapMessage(event.payload) };
    case "message.read":
      return {
        type: event.type,
        payload: {
          conversationId: event.payload?.conversation_id ?? event.payload?.conversationId ?? "",
          userId: event.payload?.user_id ?? event.payload?.userId ?? "",
          lastReadAt: event.payload?.last_read_at ?? event.payload?.lastReadAt ?? "",
        },
      };
    case "message.deleted":
      return {
        type: event.type,
        payload: {
          id: event.payload?.id ?? "",
          conversationId: event.payload?.conversation_id ?? event.payload?.conversationId ?? "",
        },
      };
    case "message.reaction":
      return {
        type: event.type,
        payload: {
          action: event.payload?.action ?? "",
          reaction: event.payload?.reaction
            ? mapReaction(event.payload.reaction)
            : undefined,
          messageId: event.payload?.message_id ?? event.payload?.messageId ?? "",
          userId: event.payload?.user_id ?? event.payload?.userId ?? "",
          emoji: event.payload?.emoji ?? "",
        },
      };
    case "typing":
      return {
        type: event.type,
        payload: {
          conversationId: event.payload?.conversation_id ?? event.payload?.conversationId ?? "",
          userId: event.payload?.user_id ?? event.payload?.userId ?? "",
          isTyping: Boolean(event.payload?.is_typing ?? event.payload?.isTyping ?? true),
        },
      };
    case "presence":
      return {
        type: event.type,
        payload: {
          userId: event.payload?.user_id ?? event.payload?.userId ?? "",
          status: event.payload?.status ?? "offline",
          lastSeenAt: event.payload?.last_seen_at ?? event.payload?.lastSeenAt ?? "",
        },
      };
    default:
      return event as WSEvent;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const api = {
  /**
   * Clerk identity path only. Creates the Deco `users` row for a Clerk
   * account and binds its X25519 public key.
   *
   * Registration on the legacy path inserts the user and their public key in
   * one statement. Clerk creates the identity outside the database, so this
   * closes that gap from the client instead of from a webhook, which would
   * race the first authenticated request and leave an account with no key.
   *
   * Idempotent: the same key succeeds, a different key is refused with
   * 409 `public_key_immutable`.
   */
  profile: {
    bootstrap: async (input: {
      publicKey: string;
      username: string;
      displayName?: string;
      email?: string;
      phoneNumber?: string;
    }) => {
      const raw = await request<{ user: unknown }>("/api/v1/profile/bootstrap", {
        method: "POST",
        body: JSON.stringify({
          public_key: input.publicKey,
          username: input.username,
          display_name: input.displayName ?? input.username,
          email: input.email ?? "",
          phone_number: input.phoneNumber ?? "",
        }),
      });
      return mapUser(raw.user);
    },
  },

  auth: {
    login: async (body: { email?: string; phone?: string; password: string }) => {
      const raw = await request<{ token: string; user: unknown }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: body.email,
          phone_number: body.phone,
          password: body.password,
        }),
      });
      return { token: raw.token, user: mapUser(raw.user) };
    },

    register: async (body: {
      username: string;
      displayName: string;
      email?: string;
      phone?: string;
      password: string;
      publicKey: string;
    }) => {
      const raw = await request<{ token: string; user: unknown }>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username: body.username,
          display_name: body.displayName,
          email: body.email,
          phone_number: body.phone,
          password: body.password,
          public_key: body.publicKey,
        }),
      });
      return { token: raw.token, user: mapUser(raw.user) };
    },

    logout: () => request("/api/v1/auth/logout", { method: "POST" }),
  },

  conversations: {
    list: async () => {
      const raw = await request<unknown[]>("/api/v1/conversations");
      return raw.map(mapConversation);
    },

    get: async (id: string) => {
      const raw = await request<unknown>(`/api/v1/conversations/${id}`);
      return mapConversation(raw);
    },

    create: async (body: { type: string; name?: string; memberIds: string[] }) => {
      const raw = await request<unknown>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({
          type: body.type,
          name: body.name,
          member_ids: body.memberIds,
        }),
      });
      return mapConversation(raw);
    },

    update: async (id: string, body: { name?: string; description?: string; avatarUrl?: string }) => {
      const raw = await request<unknown>(`/api/v1/conversations/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: body.name,
          description: body.description,
          avatar_url: body.avatarUrl,
        }),
      });
      return mapConversation(raw);
    },

    remove: async (id: string) => {
      await request(`/api/v1/conversations/${id}`, {
        method: "DELETE",
      });
    },

    listMembers: async (id: string) => {
      const raw = await request<unknown[]>(`/api/v1/conversations/${id}/members`);
      return raw.map((member) => ({ ...mapMember(member), conversationId: id }));
    },

    addMember: async (id: string, userId: string) => {
      await request(`/api/v1/conversations/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      });
    },

    updateMemberRole: async (id: string, userId: string, role: "admin" | "member") => {
      await request(`/api/v1/conversations/${id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    },

    removeMember: async (id: string, userId: string) => {
      await request(`/api/v1/conversations/${id}/members/${userId}`, {
        method: "DELETE",
      });
    },

    getGroupKey: async (
      id: string,
      epoch?: number
    ): Promise<{ epoch: number; encryptedKey: string; encryptedBy?: string; encryptorPublicKey: string }> => {
      const query = epoch ? `?epoch=${encodeURIComponent(epoch)}` : "";
      const raw = await request<Record<string, unknown>>(`/api/v1/conversations/${id}/group-key${query}`);
      return {
        epoch: Number(raw["epoch"] ?? 0),
        encryptedKey: String(raw["encrypted_key"] ?? ""),
        encryptedBy: raw["encrypted_by"] ? String(raw["encrypted_by"]) : undefined,
        encryptorPublicKey: String(raw["encryptor_public_key"] ?? ""),
      };
    },

    createGroupKeyEpoch: async (
      id: string,
      body: {
        expectedEpoch: number;
        membershipChange?: { action: "add" | "remove"; userId: string };
        copies: { userId: string; encryptedKey: string }[];
      }
    ) => {
      const raw = await request<{ epoch: number }>(`/api/v1/conversations/${id}/group-key-epochs`, {
        method: "POST",
        body: JSON.stringify({
          expected_epoch: body.expectedEpoch,
          membership_change: body.membershipChange
            ? { action: body.membershipChange.action, user_id: body.membershipChange.userId }
            : undefined,
          copies: body.copies.map((copy) => ({
            user_id: copy.userId,
            encrypted_key: copy.encryptedKey,
          })),
        }),
      });
      return raw.epoch;
    },

    getLeadership: async (id: string) => {
      const raw = await request<unknown>(`/api/v1/conversations/${id}/leadership`);
      return mapLeadershipStatus(raw);
    },

    objectToLeadership: async (id: string) => {
      const raw = await request<unknown>(`/api/v1/conversations/${id}/leadership/object`, {
        method: "POST",
      });
      return mapLeadershipStatus(raw);
    },

    voteLeadership: async (id: string, candidateUserId: string) => {
      const raw = await request<unknown>(`/api/v1/conversations/${id}/leadership/vote`, {
        method: "POST",
        body: JSON.stringify({ candidate_user_id: candidateUserId }),
      });
      return mapLeadershipStatus(raw);
    },
  },

  messages: {
    list: async (conversationId: string, before?: string) => {
      const raw = await request<unknown[]>(
        `/api/v1/conversations/${conversationId}/messages${before ? `?before=${before}` : ""}`
      );
      return raw.map(mapMessage);
    },

    getMediaTicket: async (conversationId: string, messageId: string) => {
      const raw = await request<{ url?: string }>(
        `/api/v1/conversations/${conversationId}/messages/${messageId}/media-ticket`
      );
      return resolveAssetUrl(raw.url ?? "");
    },

    send: async (
      conversationId: string,
      body: {
        encryptedContent?: string;
        type?: string;
        replyToId?: string;
        mediaUrl?: string;
        mediaName?: string;
        mediaMimeType?: string;
        mediaSize?: number;
        mediaEncrypted?: boolean;
        groupKeyEpoch?: number;
        stickerId?: string;
        poll?: CreatePollInput;
      }
    ) => {
      const raw = await request<unknown>(
        `/api/v1/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({
          encrypted_content: body.encryptedContent,
          type: body.type,
          reply_to_id: body.replyToId,
          media_url: body.mediaUrl,
          media_name: body.mediaName,
          media_mime_type: body.mediaMimeType,
          media_size: body.mediaSize,
          media_encrypted: body.mediaEncrypted,
          group_key_epoch: body.groupKeyEpoch,
          sticker_id: body.stickerId,
          poll: body.poll ? {
            question: body.poll.question,
            options: body.poll.options,
            allows_multiple: false,
          } : undefined,
        }) }
      );
      return mapMessage(raw);
    },

    edit: async (conversationId: string, messageId: string, body: { encryptedContent: string }) => {
      const raw = await request<unknown>(
        `/api/v1/conversations/${conversationId}/messages/${messageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            encrypted_content: body.encryptedContent,
          }),
        }
      );
      return mapMessage(raw);
    },

    delete: (conversationId: string, messageId: string) =>
      request(`/api/v1/conversations/${conversationId}/messages/${messageId}`, {
        method: "DELETE",
      }),

    react: (conversationId: string, messageId: string, emoji: string) =>
      request(`/api/v1/conversations/${conversationId}/messages/${messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }),

    removeReaction: (conversationId: string, messageId: string, emoji: string) =>
      request(`/api/v1/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
        method: "DELETE",
      }),

    markRead: (conversationId: string) =>
      request(`/api/v1/conversations/${conversationId}/messages/read`, {
        method: "POST",
      }),

    votePoll: async (conversationId: string, messageId: string, optionId: string) => {
      const raw = await request<unknown>(
        `/api/v1/conversations/${conversationId}/messages/${messageId}/poll/vote`,
        {
          method: "POST",
          body: JSON.stringify({ option_id: optionId }),
        }
      );
      return mapMessage(raw);
    },
  },

  users: {
    search: async (q: string) => {
      const raw = await request<unknown[]>(`/api/v1/users/search?q=${encodeURIComponent(q)}`);
      return raw.map(mapUser);
    },

    get: async (id: string) => {
      const raw = await request<unknown>(`/api/v1/users/${id}`);
      return mapUser(raw);
    },

    getMe: async () => {
      const raw = await request<unknown>("/api/v1/users/me");
      return mapUser(raw);
    },

    listAdminUsers: async () => {
      const raw = await request<unknown[]>("/api/v1/users/admin");
      return raw.map(mapUser);
    },

    updateAdminUser: async (
      userId: string,
      body: {
        displayName?: string;
        username?: string;
        avatarUrl?: string;
        isAdmin?: boolean;
        restrictedActions?: UserRestriction[];
      }
    ) => {
      const raw = await request<unknown>(`/api/v1/users/admin/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({
          display_name: body.displayName,
          username: body.username,
          avatar_url: body.avatarUrl,
          is_admin: body.isAdmin,
          restricted_actions: body.restrictedActions,
        }),
      });
      return mapUser(raw);
    },

    deleteAdminUser: async (userId: string) => {
      await request(`/api/v1/users/admin/${userId}`, {
        method: "DELETE",
      });
    },

    updateMe: async (body: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    }) => {
      const raw = await request<unknown>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: body.displayName,
          bio: body.bio,
          avatar_url: body.avatarUrl,
          email: body.email,
          current_password: body.currentPassword,
          new_password: body.newPassword,
        }),
      });
      return mapUser(raw);
    },

    getKeyBackup: async () => {
      const raw = await request<unknown>("/api/v1/users/me/key-backup");
      return mapKeyBackupResponse(raw);
    },

    putKeyBackup: async (payload: KeyBackupPayload) => {
      const raw = await request<unknown>("/api/v1/users/me/key-backup", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      return mapKeyBackupResponse(raw);
    },

    deleteKeyBackup: async () => {
      const raw = await request<unknown>("/api/v1/users/me/key-backup", {
        method: "DELETE",
      });
      return mapKeyBackupResponse(raw);
    },
  },

  uploads: {
    create: async (
      file: File | Blob,
      kind: UploadKind,
      name?: string,
      options?: {
        onProgress?: (progress: number) => void;
        encrypted?: { originalMimeType: string; originalSize: number };
      }
    ) => {
      const form = new FormData();
      const filename = name ?? (file instanceof File ? file.name : `${kind}-${Date.now()}`);
      form.append("file", file, filename);
      form.append("kind", kind);
      if (options?.encrypted) {
        form.append("encrypted", "true");
        form.append("original_mime_type", options.encrypted.originalMimeType);
        form.append("original_size", String(options.encrypted.originalSize));
      }

      if (typeof window !== "undefined" && options?.onProgress) {
        const token = await resolveAuthToken();
        const xhrResult = await new Promise<unknown>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${BASE}/api/v1/uploads`);
          if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            options.onProgress?.(Math.round((event.loaded / event.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new ApiError(xhr.status, "Invalid upload response"));
              }
              return;
            }

            try {
              const body = JSON.parse(xhr.responseText) as { error?: string };
              reject(new ApiError(xhr.status, body.error ?? xhr.statusText));
            } catch {
              reject(new ApiError(xhr.status, xhr.statusText));
            }
          };
          xhr.onerror = () => reject(new ApiError(0, "Upload failed"));
          xhr.send(form);
        });
        return mapUploadResponse(xhrResult);
      }

      const raw = await request<unknown>("/api/v1/uploads", {
        method: "POST",
        body: form,
      });
      return mapUploadResponse(raw);
    },
  },

  stickers: {
    listPacks: async () => {
      const raw = await request<unknown[]>("/api/v1/stickers/packs");
      return raw.map(mapStickerPack);
    },

    getPack: async (packId: string) => {
      const raw = await request<unknown>(`/api/v1/stickers/packs/${packId}`);
      return mapStickerPack(raw);
    },

    createPack: async (body: CreateStickerPackInput) => {
      const raw = await request<unknown>("/api/v1/stickers/packs", {
        method: "POST",
        body: JSON.stringify({
          title: body.title,
          description: body.description,
        }),
      });
      return mapStickerPack(raw);
    },

    deletePack: async (packId: string) => {
      await request(`/api/v1/stickers/packs/${packId}`, {
        method: "DELETE",
      });
    },

    clonePack: async (packId: string) => {
      const raw = await request<unknown>(`/api/v1/stickers/packs/${packId}/clone`, {
        method: "POST",
      });
      return mapStickerPack(raw);
    },

    addSticker: async (packId: string, body: AddStickerInput) => {
      const raw = await request<unknown>(`/api/v1/stickers/packs/${packId}/stickers`, {
        method: "POST",
        body: JSON.stringify({
          name: body.name,
          emoji: body.emoji,
          asset_url: body.assetUrl,
          mime_type: body.mimeType,
          format: body.format,
          thumbnail_url: body.thumbnailUrl,
          telegram_file_id: body.telegramFileId,
          telegram_unique_file_id: body.telegramUniqueFileId,
        }),
      });
      return mapSticker(raw);
    },

    deleteSticker: async (packId: string, stickerId: string) => {
      await request(`/api/v1/stickers/packs/${packId}/stickers/${stickerId}`, {
        method: "DELETE",
      });
    },

    importTelegramPack: async (input: string) => {
      const raw = await request<{ pack: unknown; imported_count: number; skipped?: string[] }>("/api/v1/stickers/import/telegram", {
        method: "POST",
        body: JSON.stringify({ input }),
      });
      return {
        pack: mapStickerPack(raw.pack),
        importedCount: raw.imported_count,
        skipped: raw.skipped ?? [],
      };
    },
  },
};
