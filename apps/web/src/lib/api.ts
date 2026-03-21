const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("deco_token") : null;

  const res = await fetch(`${BASE}${path}`, {
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

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (body: { email?: string; phone?: string; password: string }) =>
      request<{ token: string; user: import("@deco/types").User }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    register: (body: {
      username: string;
      displayName: string;
      email?: string;
      phone?: string;
      password: string;
      publicKey: string;
    }) =>
      request<{ token: string; user: import("@deco/types").User }>("/api/v1/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    logout: () => request("/api/v1/auth/logout", { method: "POST" }),
  },

  conversations: {
    list: () =>
      request<import("@deco/types").Conversation[]>("/api/v1/conversations"),

    get: (id: string) =>
      request<import("@deco/types").Conversation>(`/api/v1/conversations/${id}`),

    create: (body: { type: string; name?: string; memberIds: string[] }) =>
      request<import("@deco/types").Conversation>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },

  messages: {
    list: (conversationId: string, cursor?: string) =>
      request<import("@deco/types").PaginatedResponse<import("@deco/types").Message>>(
        `/api/v1/conversations/${conversationId}/messages${cursor ? `?cursor=${cursor}` : ""}`
      ),

    send: (conversationId: string, body: { encryptedContent: string; type?: string; replyToId?: string }) =>
      request<import("@deco/types").Message>(
        `/api/v1/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify(body) }
      ),

    react: (conversationId: string, messageId: string, emoji: string) =>
      request(`/api/v1/conversations/${conversationId}/messages/${messageId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }),
  },

  users: {
    search: (q: string) =>
      request<import("@deco/types").User[]>(`/api/v1/users/search?q=${encodeURIComponent(q)}`),

    getMe: () => request<import("@deco/types").User>("/api/v1/users/me"),
  },
};
