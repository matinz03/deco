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
} from "@deco/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const PUBLIC_UPLOAD_BASE = process.env.NEXT_PUBLIC_UPLOAD_BASE ?? "/api/v1/media";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("deco_token") : null;
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
    displayName: r.display_name ?? r.displayName ?? "",
    avatarUrl: resolveAssetUrl(r.avatar_url ?? r.avatarUrl ?? ""),
    publicKey: r.public_key ?? r.publicKey ?? "",
    bio: r.bio ?? "",
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
    url: resolveAssetUrl(r.url ?? ""),
    mimeType: r.mime_type ?? r.mimeType ?? "",
    size: r.size ?? 0,
    name: r.name ?? "",
    kind: r.kind ?? "file",
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

    getGroupKey: async (id: string): Promise<{ encryptedKey: string; encryptedBy: string }> => {
      const raw = await request<Record<string, string>>(`/api/v1/conversations/${id}/group-key`);
      return { encryptedKey: raw["encrypted_key"] ?? "", encryptedBy: raw["encrypted_by"] ?? "" };
    },

    putGroupKeys: async (id: string, entries: { userId: string; encryptedKey: string; encryptedBy: string }[]) => {
      await request(`/api/v1/conversations/${id}/group-keys`, {
        method: "PUT",
        body: JSON.stringify(entries.map((e) => ({
          user_id: e.userId,
          encrypted_key: e.encryptedKey,
          encrypted_by: e.encryptedBy,
        }))),
      });
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

    getMe: async () => {
      const raw = await request<unknown>("/api/v1/users/me");
      return mapUser(raw);
    },

    updateMe: async (body: { displayName?: string; bio?: string; avatarUrl?: string }) => {
      const raw = await request<unknown>("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: body.displayName,
          bio: body.bio,
          avatar_url: body.avatarUrl,
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
    create: async (file: File | Blob, kind: UploadKind, name?: string) => {
      const form = new FormData();
      const filename = name ?? (file instanceof File ? file.name : `${kind}-${Date.now()}`);
      form.append("file", file, filename);
      form.append("kind", kind);

      const raw = await request<unknown>("/api/v1/uploads", {
        method: "POST",
        body: form,
      });
      return mapUploadResponse(raw);
    },
  },
};
