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
} from "@deco/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("deco_token") : null;

  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
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
    avatarUrl: r.avatar_url ?? r.avatarUrl ?? "",
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
    mediaUrl: r.media_url ?? r.mediaUrl,
    mediaMimeType: r.media_mime_type ?? r.mediaMimeType,
    mediaSize: r.media_size ?? r.mediaSize,
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
    avatarUrl: r.avatar_url ?? r.avatarUrl ?? "",
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
  },

  messages: {
    list: async (conversationId: string, before?: string) => {
      const raw = await request<unknown[]>(
        `/api/v1/conversations/${conversationId}/messages${before ? `?before=${before}` : ""}`
      );
      return raw.map(mapMessage);
    },

    send: async (conversationId: string, body: { encryptedContent: string; type?: string; replyToId?: string }) => {
      const raw = await request<unknown>(
        `/api/v1/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({
          encrypted_content: body.encryptedContent,
          type: body.type,
          reply_to_id: body.replyToId,
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
};
