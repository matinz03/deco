import { create } from "zustand";
import { api, mapMessage } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { decryptMessage, deriveSharedSecret, loadPrivateKey } from "@deco/crypto";
import type { Conversation, Message, WSEvent } from "@deco/types";
import { useAuthStore } from "./auth";

type PresenceState = {
  status: "online" | "offline" | "busy" | "away";
  lastSeenAt?: string;
};

interface ConversationState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string | null;
  presence: Record<string, PresenceState>;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => Promise<void>;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  markConversationRead: (conversationId: string) => void;
  handleIncomingEvent: (event: WSEvent) => void;
  createConversation: (opts: { type: string; name?: string; memberIds: string[] }) => Promise<Conversation>;
}

export const useConversationStore = create<ConversationState>((set, get) => {
  // Subscribe to all WebSocket events once
  if (typeof window !== "undefined") {
    wsClient.on("*", (event) => get().handleIncomingEvent(event));
  }

  return {
    conversations: [],
    messages: {},
    activeConversationId: null,
    presence: {},

    setActiveConversation(id) {
      set({ activeConversationId: id });
    },

    markConversationRead(conversationId) {
      set((s) => ({
        conversations: s.conversations.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        ),
      }));
    },

    async fetchConversations() {
      const rawConversations = await api.conversations.list();
      const conversations = await hydrateConversationSummaries(rawConversations);
      const existingMessages = get().messages;
      const hydratedMessages = await rehydrateConversationMessages(existingMessages, conversations);
      set({ conversations, messages: hydratedMessages });
    },

    async fetchMessages(conversationId) {
      const rawMessages = await api.messages.list(conversationId);
      const conversation = get().conversations.find((c) => c.id === conversationId);
      const decrypted = await hydrateMessages(rawMessages, conversation);
      set((s) => ({ messages: { ...s.messages, [conversationId]: sortMessages(decrypted) } }));
    },

    async sendMessage(conversationId, text) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      // Optimistic update — show message immediately before server confirms
      const tempId = `temp_${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        type: "text",
        encryptedContent: "",
        decryptedContent: text,
        reactions: [],
        status: "sending",
        isEdited: false,
        isDeleted: false,
        sentAt: new Date().toISOString(),
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: [...(s.messages[conversationId] ?? []), optimisticMsg],
        },
      }));

      try {
        // Encrypt before sending
        const conversation = get().conversations.find((c) => c.id === conversationId);
        const otherUser = conversation?.members?.find((m) => m.userId !== user.id)?.user;

        let encryptedContent = text; // fallback (no encryption without recipient's public key)
        if (otherUser) {
          const privateKey = await loadPrivateKey(user.id);
          if (privateKey) {
            const { encryptMessage, deriveSharedSecret: derive } = await import("@deco/crypto");
            const sharedSecret = derive(otherUser.publicKey, privateKey);
            encryptedContent = encryptMessage(text, sharedSecret);
          }
        }

        const confirmed = await api.messages.send(conversationId, { encryptedContent });

        const confirmedMessage = await hydrateMessage(confirmed, conversation);

        // Replace optimistic message with confirmed one and dedupe if the websocket arrived first
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: upsertMessage(
              (s.messages[conversationId] ?? []).map((m) =>
                m.id === tempId ? { ...confirmedMessage, decryptedContent: text } : m
              ).filter((m, index, all) => m.id !== tempId || all.findIndex((item) => item.id === confirmedMessage.id) === -1),
              { ...confirmedMessage, decryptedContent: text }
            ),
          },
        }));
      } catch {
        // Mark optimistic message as failed
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: s.messages[conversationId]!.map((m) =>
              m.id === tempId ? { ...m, status: "failed" as const } : m
            ),
          },
        }));
      }
    },

    async toggleReaction(conversationId, messageId, emoji) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const message = get().messages[conversationId]?.find((item) => item.id === messageId);
      const existingReaction = message?.reactions.find(
        (reaction) => reaction.userId === user.id && reaction.emoji === emoji
      );

      const optimisticPayload = existingReaction
        ? {
            action: "remove" as const,
            messageId,
            userId: user.id,
            emoji,
          }
        : {
            action: "add" as const,
            reaction: {
              messageId,
              userId: user.id,
              user,
              emoji,
              createdAt: new Date().toISOString(),
            },
          };

      set((s) => ({
        messages: Object.fromEntries(
          Object.entries(s.messages).map(([id, messages]) => [
            id,
            id === conversationId
              ? messages.map((item) => applyReactionEvent(item, optimisticPayload))
              : messages,
          ])
        ),
      }));

      try {
        if (existingReaction) {
          await api.messages.removeReaction(conversationId, messageId, emoji);
        } else {
          await api.messages.react(conversationId, messageId, emoji);
        }
      } catch {
        set((s) => ({
          messages: Object.fromEntries(
            Object.entries(s.messages).map(([id, messages]) => [
              id,
              id === conversationId
                ? messages.map((item) =>
                    applyReactionEvent(
                      item,
                      existingReaction
                        ? {
                            action: "add" as const,
                            reaction: existingReaction,
                          }
                        : {
                            action: "remove" as const,
                            messageId,
                            userId: user.id,
                            emoji,
                          }
                    )
                  )
                : messages,
            ])
          ),
        }));
      }
    },

    async createConversation(opts) {
      const [conv] = await hydrateConversationSummaries([await api.conversations.create(opts)]);
      if (!conv) {
        throw new Error("Failed to create conversation");
      }
      set((s) => ({
        conversations: s.conversations.some((c) => c.id === conv.id)
          ? s.conversations
          : [conv, ...s.conversations].sort(sortConversationList),
      }));
      return conv;
    },

    handleIncomingEvent(event) {
      if (event.type === "message.new") {
        void (async () => {
          const rawMsg = mapMessage(event.payload);
          const state = get();
          const conversation = state.conversations.find((c) => c.id === rawMsg.conversationId);
          const msg = await hydrateMessage(rawMsg, conversation);
          const currentUserId = useAuthStore.getState().user?.id;
          const shouldNotify =
            msg.senderId !== currentUserId &&
            (state.activeConversationId !== msg.conversationId || typeof document !== "undefined" && document.hidden);

          set((s) => ({
            messages: {
              ...s.messages,
              [msg.conversationId]: upsertMessage(s.messages[msg.conversationId] ?? [], msg),
            },
            conversations: s.conversations
              .map((c) =>
                c.id === msg.conversationId
                  ? {
                      ...c,
                      lastMessage: msg,
                      updatedAt: msg.sentAt,
                      unreadCount:
                        msg.senderId !== currentUserId && s.activeConversationId !== msg.conversationId
                          ? c.unreadCount + 1
                          : c.unreadCount,
                    }
                  : c
              )
              .sort(sortConversationList),
          }));

          if (shouldNotify) {
            notifyAboutMessage(msg, conversation);
          }
        })();
      }

      if (event.type === "message.edited") {
        void (async () => {
          const rawEditedMessage = mapMessage(event.payload);
          const conversation = get().conversations.find(
            (item) => item.id === rawEditedMessage.conversationId
          );
          const editedMessage = await hydrateMessage(rawEditedMessage, conversation);

          set((s) => ({
            messages: {
              ...s.messages,
              [editedMessage.conversationId]: upsertMessage(
                s.messages[editedMessage.conversationId] ?? [],
                editedMessage
              ),
            },
            conversations: s.conversations.map((item) =>
              item.id === editedMessage.conversationId && item.lastMessage?.id === editedMessage.id
                ? { ...item, lastMessage: editedMessage }
                : item
            ),
          }));
        })();
      }

      if (event.type === "message.read") {
        const { conversationId, userId, lastReadAt } = event.payload as { conversationId: string; userId: string; lastReadAt: string };
        const readAt = new Date(lastReadAt).getTime();
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
          ),
          // Mark all messages sent by the current user (not the reader) as "read"
          // if they were sent before or at the lastReadAt timestamp
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] ?? []).map((msg) =>
              msg.senderId !== userId && new Date(msg.sentAt).getTime() <= readAt
                ? { ...msg, status: "read" as const }
                : msg
            ),
          },
        }));
      }

      if (event.type === "message.reaction") {
        const payload = event.payload as {
          action: "add" | "remove";
          reaction?: Message["reactions"][number];
          messageId?: string;
          userId?: string;
          emoji?: string;
        };

        set((s) => ({
          messages: Object.fromEntries(
            Object.entries(s.messages).map(([conversationId, messages]) => [
              conversationId,
              messages.map((message) => applyReactionEvent(message, payload)),
            ])
          ),
        }));
      }

      if (event.type === "message.deleted") {
        const { id, conversationId } = event.payload as { id: string; conversationId: string };
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] ?? []).map((message) =>
              message.id === id ? { ...message, isDeleted: true, decryptedContent: "" } : message
            ),
          },
        }));
      }

      if (event.type === "presence") {
        const { userId, status, lastSeenAt } = event.payload as {
          userId: string;
          status: "online" | "offline" | "busy" | "away";
          lastSeenAt?: string;
        };

        set((s) => ({
          conversations: s.conversations.map((conversation) => ({
            ...conversation,
            members: conversation.members?.map((member) =>
              member.userId === userId && member.user
                ? {
                    ...member,
                    user: {
                      ...member.user,
                      lastSeenAt:
                        status === "online"
                          ? member.user.lastSeenAt
                          : (lastSeenAt || member.user.lastSeenAt),
                    },
                  }
                : member
            ),
          })),
          presence: {
            ...s.presence,
            [userId]: {
              status,
              lastSeenAt: status === "online" ? s.presence[userId]?.lastSeenAt : (lastSeenAt || s.presence[userId]?.lastSeenAt),
            },
          },
        }));
      }
    },
  };
});

function sortConversationList(a: Conversation, b: Conversation) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function sortMessages(messages: Message[]) {
  return [...messages].sort((a, b) => {
    const sentAtDiff = new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
    if (sentAtDiff !== 0) return sentAtDiff;
    return a.id.localeCompare(b.id);
  });
}

function upsertMessage(messages: Message[], incoming: Message) {
  const next = [...messages];
  const existingIndex = next.findIndex((message) => message.id === incoming.id);

  if (existingIndex >= 0) {
    next[existingIndex] = { ...next[existingIndex], ...incoming };
    return sortMessages(next);
  }

  const tempIndex = next.findIndex(
    (message) =>
      message.id.startsWith("temp_") &&
      message.senderId === incoming.senderId &&
      message.status === "sending" &&
      message.conversationId === incoming.conversationId
  );

  if (tempIndex >= 0) {
    const existingTemp = next[tempIndex];
    next[tempIndex] = { ...incoming, decryptedContent: existingTemp?.decryptedContent ?? incoming.decryptedContent };
    return sortMessages(next);
  }

  next.push(incoming);
  return sortMessages(next);
}

function applyReactionEvent(
  message: Message,
  payload: {
    action: "add" | "remove";
    reaction?: Message["reactions"][number];
    messageId?: string;
    userId?: string;
    emoji?: string;
  }
) {
  const targetMessageId = payload.reaction?.messageId ?? payload.messageId;
  if (message.id !== targetMessageId) {
    return message;
  }

  if (payload.action === "add" && payload.reaction) {
    const exists = message.reactions.some(
      (reaction) =>
        reaction.messageId === payload.reaction?.messageId &&
        reaction.userId === payload.reaction?.userId &&
        reaction.emoji === payload.reaction?.emoji
    );

    return exists
      ? message
      : { ...message, reactions: [...message.reactions, payload.reaction] };
  }

  if (payload.action === "remove") {
    return {
      ...message,
      reactions: message.reactions.filter(
        (reaction) =>
          !(reaction.userId === payload.userId && reaction.emoji === payload.emoji)
      ),
    };
  }

  return message;
}

async function hydrateConversationSummaries(conversations: Conversation[]) {
  const hydrated = await Promise.all(
    conversations.map(async (conversation) => ({
      ...conversation,
      lastMessage: conversation.lastMessage
        ? await hydrateMessage(conversation.lastMessage, conversation)
        : conversation.lastMessage,
    }))
  );

  return hydrated.sort(sortConversationList);
}

async function hydrateMessages(messages: Message[], conversation?: Conversation) {
  const hydrated = await Promise.all(messages.map((message) => hydrateMessage(message, conversation)));
  return sortMessages(hydrated);
}

async function rehydrateConversationMessages(
  messagesByConversation: Record<string, Message[]>,
  conversations: Conversation[]
) {
  const entries = await Promise.all(
    Object.entries(messagesByConversation).map(async ([conversationId, messages]) => {
      const conversation = conversations.find((item) => item.id === conversationId);
      return [conversationId, await hydrateMessages(messages, conversation)] as const;
    })
  );

  return Object.fromEntries(entries);
}

async function hydrateMessage(message: Message, conversation?: Conversation) {
  const user = useAuthStore.getState().user;
  if (!user) return message;

  const otherUser = conversation?.members?.find((member) => member.userId !== user.id)?.user;
  if (!otherUser?.publicKey || !message.encryptedContent || message.isDeleted) {
    return message;
  }

  try {
    const privateKey = await loadPrivateKey(user.id);
    if (!privateKey) return message;

    const sharedSecret = deriveSharedSecret(otherUser.publicKey, privateKey);
    return {
      ...message,
      decryptedContent: decryptMessage(message.encryptedContent, sharedSecret),
    };
  } catch {
    return message;
  }
}

function notifyAboutMessage(message: Message, conversation?: Conversation) {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission !== "granted") {
    return;
  }

  const title = conversation?.name || message.sender?.displayName || "New message";
  const body = message.isDeleted
    ? "Message deleted"
    : (message.decryptedContent ?? "You received a new message");

  new Notification(title, {
    body,
    tag: message.conversationId,
  });
}
