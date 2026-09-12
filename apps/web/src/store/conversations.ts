import { create } from "zustand";
import { api, ApiError, mapMessage } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { decryptMessage, deriveSharedSecret, encryptBlob, loadPrivateKey } from "@deco/crypto";
import type { Conversation, Member, Message, MessageType, WSEvent, CreatePollInput, Sticker, UploadResponse } from "@deco/types";
import { useAuthStore } from "./auth";
import { usePreferencesStore } from "./preferences";
import { useToastStore } from "./toasts";

// Immutable decrypted group keys are cached by conversation and epoch. The
// separate current-epoch pointer is invalidated whenever the server rejects a
// stale write.
const groupKeyCache = new Map<string, string>();
const currentGroupKeyEpoch = new Map<string, number>();

function groupConversationCacheKey(userId: string, conversationId: string) {
  return `${userId}:${conversationId}`;
}

function groupKeyCacheKey(userId: string, conversationId: string, epoch: number) {
  return `${groupConversationCacheKey(userId, conversationId)}:${epoch}`;
}

/**
 * Thrown when a message cannot be encrypted (missing keys). Sending must fail
 * closed — never fall back to plaintext for anything except "saved" notes.
 */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

async function getOrFetchGroupKey(
  conversationId: string,
  requestedEpoch?: number
): Promise<{ key: string; epoch: number } | null> {
  const user = useAuthStore.getState().user;
  if (!user) return null;
  const conversationCacheKey = groupConversationCacheKey(user.id, conversationId);
  const knownEpoch = requestedEpoch ?? currentGroupKeyEpoch.get(conversationCacheKey);
  if (knownEpoch) {
    const cached = groupKeyCache.get(groupKeyCacheKey(user.id, conversationId, knownEpoch));
    if (cached) return { key: cached, epoch: knownEpoch };
  }

  try {
    const { epoch, encryptedKey, encryptorPublicKey } = await api.conversations.getGroupKey(
      conversationId,
      requestedEpoch
    );
    if (!epoch || !encryptedKey || !encryptorPublicKey) return null;

    const privateKey = await loadPrivateKey(user.id);
    if (!privateKey) return null;

    const sharedSecret = deriveSharedSecret(encryptorPublicKey, privateKey);
    const groupKey = decryptMessage(encryptedKey, sharedSecret);
    groupKeyCache.set(groupKeyCacheKey(user.id, conversationId, epoch), groupKey);
    const currentEpoch = currentGroupKeyEpoch.get(conversationCacheKey) ?? 0;
    if (requestedEpoch === undefined || epoch > currentEpoch) {
      currentGroupKeyEpoch.set(conversationCacheKey, epoch);
    }
    return { key: groupKey, epoch };
  } catch {
    return null;
  }
}

export async function getConversationEncryptionKey(
  conversation: Conversation | undefined,
  userId: string,
  groupKeyEpoch?: number
): Promise<string | null> {
  if (!conversation || conversation.type === "saved") return null;

  // Channels do not have a distributable key protocol yet. Failing closed is
  // safer than encrypting for one arbitrary member and hiding the upload from
  // everyone else.
  if (conversation.type === "channel") return null;

  if (conversation.type === "group") {
    return (await getOrFetchGroupKey(conversation.id, groupKeyEpoch))?.key ?? null;
  }

  const otherUser = conversation.members?.find((member) => member.userId !== userId)?.user;
  if (!otherUser?.publicKey) return null;
  const privateKey = await loadPrivateKey(userId);
  if (!privateKey) return null;
  return deriveSharedSecret(otherUser.publicKey, privateKey);
}

type GroupKeyRecipient = { userId: string; publicKey?: string };

async function rotateGroupKey(
  conversationId: string,
  expectedEpoch: number,
  recipients: GroupKeyRecipient[],
  membershipChange?: { action: "add" | "remove"; userId: string }
): Promise<number> {
  const user = useAuthStore.getState().user;
  if (!user) throw new EncryptionError("Sign in before changing an encrypted group.");

  const privateKey = await loadPrivateKey(user.id);
  if (!privateKey) {
    throw new EncryptionError(
      "Your private key is missing on this device. Restore your key backup before changing group membership."
    );
  }

  const normalizedRecipients = recipients.map((recipient) => ({
    userId: recipient.userId,
    publicKey: recipient.publicKey || (recipient.userId === user.id ? user.publicKey : undefined),
  }));
  const missingKeys = normalizedRecipients.filter((recipient) => !recipient.publicKey);
  if (missingKeys.length > 0) {
    throw new EncryptionError("Every group member needs a public key before the group can be secured.");
  }

  const { encryptMessage, generateGroupKey } = await import("@deco/crypto");
  const groupKey = generateGroupKey();
  const copies = normalizedRecipients.map((recipient) => ({
    userId: recipient.userId,
    encryptedKey: encryptMessage(
      groupKey,
      deriveSharedSecret(recipient.publicKey!, privateKey)
    ),
  }));
  let epoch: number;
  try {
    epoch = await api.conversations.createGroupKeyEpoch(conversationId, {
      expectedEpoch,
      membershipChange,
      copies,
    });
  } catch (error) {
    // A dropped response can hide a committed rotation. Accept the server state
    // only when our next-epoch copy decrypts to the exact key generated above.
    try {
      const existing = await api.conversations.getGroupKey(conversationId, expectedEpoch + 1);
      const sharedSecret = deriveSharedSecret(existing.encryptorPublicKey, privateKey);
      if (decryptMessage(existing.encryptedKey, sharedSecret) !== groupKey) throw error;
      epoch = existing.epoch;
    } catch {
      throw error;
    }
  }

  const conversationCacheKey = groupConversationCacheKey(user.id, conversationId);
  groupKeyCache.set(groupKeyCacheKey(user.id, conversationId, epoch), groupKey);
  currentGroupKeyEpoch.set(conversationCacheKey, epoch);
  return epoch;
}

function invalidateCurrentGroupKey(conversationId: string, error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    const userId = useAuthStore.getState().user?.id;
    if (userId) currentGroupKeyEpoch.delete(groupConversationCacheKey(userId, conversationId));
  }
}

type PresenceState = {
  status: "online" | "offline" | "busy" | "away";
  lastSeenAt?: string;
};

type PendingMediaUpload = {
  conversationId: string;
  tempId: string;
  input: {
    type: Extract<MessageType, "image" | "video" | "audio" | "file">;
    file: File | Blob;
    fileName: string;
    mimeType: string;
    caption?: string;
    previewUrl?: string;
    replyToId?: string;
  };
  upload?: UploadResponse;
  mediaEncrypted?: boolean;
  groupKeyEpoch?: number;
};

const MAX_ENCRYPTED_ATTACHMENT_BYTES = 20 << 20;

const pendingMediaUploads = new Map<string, PendingMediaUpload>();

interface ConversationState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string | null;
  presence: Record<string, PresenceState>;
  typing: Record<string, string[]>;
  mutedIds: Set<string>;
  messagesHasMore: Record<string, boolean>;
  messagesLoadingMore: Record<string, boolean>;
  muteConversation: (conversationId: string) => void;
  unmuteConversation: (conversationId: string) => void;
  clearConversationMessages: (conversationId: string) => void;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  loadMoreMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    text: string,
    options?: {
      replyToId?: string;
      type?: Extract<MessageType, "text" | "location" | "contact">;
    }
  ) => Promise<void>;
  sendMediaMessage: (
    conversationId: string,
    input: {
      type: Extract<MessageType, "image" | "video" | "audio" | "file">;
      file: File | Blob;
      fileName: string;
      mimeType: string;
      caption?: string;
      previewUrl?: string;
      replyToId?: string;
    }
  ) => Promise<void>;
  sendSticker: (conversationId: string, sticker: Sticker, options?: { replyToId?: string }) => Promise<void>;
  sendPoll: (conversationId: string, input: CreatePollInput, options?: { replyToId?: string }) => Promise<void>;
  votePoll: (conversationId: string, messageId: string, optionId: string) => Promise<void>;
  retryMediaMessage: (conversationId: string, messageId: string) => Promise<void>;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>;
  editMessage: (conversationId: string, messageId: string, text: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  markConversationRead: (conversationId: string) => void;
  handleIncomingEvent: (event: WSEvent) => void;
  createConversation: (opts: { type: string; name?: string; memberIds: string[] }) => Promise<Conversation>;
  updateConversation: (conversationId: string, data: { name?: string; description?: string; avatarUrl?: string }) => Promise<Conversation>;
  listMembers: (conversationId: string) => Promise<Member[]>;
  addMember: (conversationId: string, userId: string) => Promise<Member[]>;
  updateMemberRole: (conversationId: string, userId: string, role: "admin" | "member") => Promise<Member[]>;
  removeMember: (conversationId: string, userId: string) => Promise<Member[]>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

export const useConversationStore = create<ConversationState>((set, get) => {
  // Subscribe to all WebSocket events once
  if (typeof window !== "undefined") {
    wsClient.on("*", (event) => get().handleIncomingEvent(event));
  }

  const storedMuted = typeof window !== "undefined"
    ? (JSON.parse(localStorage.getItem("deco_muted") ?? "[]") as string[])
    : [];

  return {
    conversations: [],
    messages: {},
    activeConversationId: null,
    presence: {},
    typing: {},
    mutedIds: new Set(storedMuted),
    messagesHasMore: {},
    messagesLoadingMore: {},

    muteConversation(conversationId) {
      set((s) => {
        const next = new Set(s.mutedIds);
        next.add(conversationId);
        localStorage.setItem("deco_muted", JSON.stringify([...next]));
        return { mutedIds: next };
      });
    },

    unmuteConversation(conversationId) {
      set((s) => {
        const next = new Set(s.mutedIds);
        next.delete(conversationId);
        localStorage.setItem("deco_muted", JSON.stringify([...next]));
        return { mutedIds: next };
      });
    },

    clearConversationMessages(conversationId) {
      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: [],
        },
      }));
    },

    setActiveConversation(id) {
      set({ activeConversationId: id });
    },

    markConversationRead(conversationId) {
      const currentUserId = useAuthStore.getState().user?.id;
      const now = new Date().toISOString();
      set((s) => ({
        conversations: s.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                unreadCount: 0,
                members: conversation.members?.map((member) =>
                  member.userId === currentUserId
                    ? {
                        ...member,
                        lastReadAt:
                          !member.lastReadAt || new Date(member.lastReadAt).getTime() < new Date(now).getTime()
                            ? now
                            : member.lastReadAt,
                      }
                    : member
                ),
              }
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
      set((s) => ({
        messages: { ...s.messages, [conversationId]: withReplyLinks(decrypted) },
        messagesHasMore: { ...s.messagesHasMore, [conversationId]: rawMessages.length === 50 },
        messagesLoadingMore: { ...s.messagesLoadingMore, [conversationId]: false },
      }));
    },

    async loadMoreMessages(conversationId) {
      const state = get();
      if (!state.messagesHasMore[conversationId] || state.messagesLoadingMore[conversationId]) return;
      const existingMessages = state.messages[conversationId] ?? [];
      if (existingMessages.length === 0) return;
      const before = existingMessages[0]!.sentAt;
      set((s) => ({ messagesLoadingMore: { ...s.messagesLoadingMore, [conversationId]: true } }));
      try {
        const rawMessages = await api.messages.list(conversationId, before);
        const conversation = get().conversations.find((c) => c.id === conversationId);
        const decrypted = await hydrateMessages(rawMessages, conversation);
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks([...decrypted, ...(s.messages[conversationId] ?? [])]),
          },
          messagesHasMore: { ...s.messagesHasMore, [conversationId]: rawMessages.length === 50 },
          messagesLoadingMore: { ...s.messagesLoadingMore, [conversationId]: false },
        }));
      } catch {
        set((s) => ({ messagesLoadingMore: { ...s.messagesLoadingMore, [conversationId]: false } }));
      }
    },

    async sendMessage(conversationId, text, options) {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const messageType = options?.type ?? "text";
      const replyTo = options?.replyToId
        ? get().messages[conversationId]?.find((message) => message.id === options.replyToId)
        : undefined;

      // Optimistic update — show message immediately before server confirms
      const tempId = `temp_${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        type: messageType,
        encryptedContent: "",
        decryptedContent: text,
        replyToId: options?.replyToId,
        replyTo,
        reactions: [],
        status: "sending",
        isEdited: false,
        isDeleted: false,
        sentAt: new Date().toISOString(),
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks([...(s.messages[conversationId] ?? []), optimisticMsg]),
        },
      }));

      try {
        const conversation = get().conversations.find((c) => c.id === conversationId);
        let confirmed: Message | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const encrypted = await encryptOutgoingContent(conversation, user.id, text);
          try {
            confirmed = await api.messages.send(conversationId, {
              type: messageType,
              encryptedContent: encrypted.content,
              groupKeyEpoch: encrypted.groupKeyEpoch,
              replyToId: options?.replyToId,
            });
            break;
          } catch (error) {
            const staleGroupKey =
              conversation?.type === "group" && error instanceof ApiError && error.status === 409;
            if (!staleGroupKey || attempt > 0) throw error;
            invalidateCurrentGroupKey(conversationId, error);
          }
        }
        if (!confirmed) throw new Error("Message was not accepted by the server.");

        const confirmedMessage = await hydrateMessage(confirmed, conversation);

        // Replace optimistic message with confirmed one and dedupe if the websocket arrived first
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks(upsertMessage(
              (s.messages[conversationId] ?? []).map((m) =>
                m.id === tempId ? { ...confirmedMessage, decryptedContent: text } : m
              ).filter((m, index, all) => m.id !== tempId || all.findIndex((item) => item.id === confirmedMessage.id) === -1),
              { ...confirmedMessage, decryptedContent: text }
            )),
          },
        }));
      } catch (error) {
        invalidateCurrentGroupKey(conversationId, error);
        // Mark optimistic message as failed
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks(s.messages[conversationId]!.map((m) =>
              m.id === tempId ? { ...m, status: "failed" as const } : m
            )),
          },
        }));
      }
    },

    async sendMediaMessage(conversationId, input) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const caption = input.caption?.trim() ?? "";
      const tempId = `temp_${Date.now()}`;
      const replyTo = input.replyToId
        ? get().messages[conversationId]?.find((message) => message.id === input.replyToId)
        : undefined;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        type: input.type,
        encryptedContent: "",
        decryptedContent: caption || undefined,
        mediaUrl: input.previewUrl,
        mediaName: input.fileName,
        mediaMimeType: input.mimeType,
        mediaSize: input.file.size,
        replyToId: input.replyToId,
        replyTo,
        reactions: [],
        status: "sending",
        isEdited: false,
        isDeleted: false,
        uploadProgress: 0,
        sentAt: new Date().toISOString(),
      };

      pendingMediaUploads.set(tempId, {
        conversationId,
        tempId,
        input,
      });

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks([...(s.messages[conversationId] ?? []), optimisticMsg]),
        },
      }));

      await uploadAndSendMediaMessage({ conversationId, tempId, input, userId: user.id });
    },

    async sendSticker(conversationId, sticker, options) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const replyTo = options?.replyToId
        ? get().messages[conversationId]?.find((message) => message.id === options.replyToId)
        : undefined;
      const tempId = `temp_${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        type: "sticker",
        encryptedContent: "",
        mediaUrl: sticker.assetUrl,
        mediaName: sticker.name,
        mediaMimeType: sticker.mimeType,
        sticker,
        replyToId: options?.replyToId,
        replyTo,
        reactions: [],
        status: "sending",
        isEdited: false,
        isDeleted: false,
        sentAt: new Date().toISOString(),
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks([...(s.messages[conversationId] ?? []), optimisticMsg]),
        },
      }));

      try {
        const confirmed = await api.messages.send(conversationId, {
          type: "sticker",
          mediaUrl: sticker.assetUrl,
          mediaName: sticker.name,
          mediaMimeType: sticker.mimeType,
          stickerId: sticker.id,
          replyToId: options?.replyToId,
        });
        const conversation = get().conversations.find((c) => c.id === conversationId);
        const confirmedMessage = await hydrateMessage(confirmed, conversation);
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks(upsertMessage(
              (s.messages[conversationId] ?? []).map((message) =>
                message.id === tempId ? confirmedMessage : message
              ),
              confirmedMessage
            )),
          },
        }));
      } catch {
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
              message.id === tempId ? { ...message, status: "failed" as const } : message
            )),
          },
        }));
      }
    },

    async sendPoll(conversationId, input, options) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const normalizedQuestion = input.question.trim();
      const normalizedOptions = input.options.map((option) => option.trim()).filter(Boolean);
      if (!normalizedQuestion || normalizedOptions.length < 2) {
        throw new Error("Poll requires a question and at least two options");
      }

      const tempId = `temp_${Date.now()}`;
      const replyTo = options?.replyToId
        ? get().messages[conversationId]?.find((message) => message.id === options.replyToId)
        : undefined;

      const optimisticMsg: Message = {
        id: tempId,
        conversationId,
        senderId: user.id,
        sender: user,
        type: "poll",
        encryptedContent: "",
        poll: {
          messageId: tempId,
          question: normalizedQuestion,
          allowsMultiple: false,
          totalVotes: 0,
          options: normalizedOptions.map((option, index) => ({
            id: `temp-option-${index}`,
            text: option,
            voteCount: 0,
            votedByMe: false,
          })),
        },
        replyToId: options?.replyToId,
        replyTo,
        reactions: [],
        status: "sending",
        isEdited: false,
        isDeleted: false,
        sentAt: new Date().toISOString(),
      };

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks([...(s.messages[conversationId] ?? []), optimisticMsg]),
        },
      }));

      try {
        const confirmed = await api.messages.send(conversationId, {
          type: "poll",
          poll: {
            question: normalizedQuestion,
            options: normalizedOptions,
          },
          replyToId: options?.replyToId,
        });

        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks(upsertMessage(
              (s.messages[conversationId] ?? []).map((message) =>
                message.id === tempId ? confirmed : message
              ),
              confirmed
            )),
          },
          conversations: s.conversations
            .map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, lastMessage: confirmed, updatedAt: confirmed.sentAt }
                : conversation
            )
            .sort(sortConversationList),
        }));
      } catch (error) {
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
              message.id === tempId ? { ...message, status: "failed" as const } : message
            )),
          },
        }));
        throw error;
      }
    },

    async votePoll(conversationId, messageId, optionId) {
      const existing = get().messages[conversationId]?.find((message) => message.id === messageId);
      if (!existing?.poll) {
        return;
      }

      const optimisticPoll = {
        ...existing.poll,
        options: existing.poll.options.map((option) => ({
          ...option,
          voteCount: option.id === optionId
            ? option.voteCount + (option.votedByMe ? 0 : 1)
            : option.voteCount + (option.votedByMe ? -1 : 0),
          votedByMe: option.id === optionId,
        })),
      };
      optimisticPoll.totalVotes = optimisticPoll.options.reduce((sum, option) => sum + option.voteCount, 0);

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
            message.id === messageId ? { ...message, poll: optimisticPoll } : message
          )),
        },
        conversations: s.conversations.map((conversation) =>
          conversation.id === conversationId && conversation.lastMessage?.id === messageId
            ? { ...conversation, lastMessage: { ...conversation.lastMessage, poll: optimisticPoll } }
            : conversation
        ),
      }));

      try {
        const updated = await api.messages.votePoll(conversationId, messageId, optionId);
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks(upsertMessage(s.messages[conversationId] ?? [], updated)),
          },
          conversations: s.conversations.map((conversation) =>
            conversation.id === conversationId && conversation.lastMessage?.id === messageId
              ? { ...conversation, lastMessage: updated }
              : conversation
          ),
        }));
      } catch (error) {
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
              message.id === messageId ? existing : message
            )),
          },
        }));
        throw error;
      }
    },

    async retryMediaMessage(conversationId, messageId) {
      const user = useAuthStore.getState().user;
      if (!user) return;
      const pending = pendingMediaUploads.get(messageId);
      if (!pending) return;

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  status: "sending",
                  uploadProgress: 0,
                  uploadError: undefined,
                }
              : message
          )),
        },
      }));

      await uploadAndSendMediaMessage({ conversationId, tempId: messageId, input: pending.input, userId: user.id });
    },

    sendTyping(conversationId, isTyping) {
      wsClient.send({
        type: "typing",
        payload: {
          conversation_id: conversationId,
          is_typing: isTyping,
        },
      });
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

    async editMessage(conversationId, messageId, text) {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("Message cannot be empty");
      }

      const conversation = get().conversations.find((item) => item.id === conversationId);
      const message = get().messages[conversationId]?.find((item) => item.id === messageId);
      if (!message) {
        throw new Error("Message not found");
      }

      // Throws EncryptionError when the keys needed to encrypt are unavailable.
      const encrypted = await encryptOutgoingContent(
        conversation,
        user.id,
        trimmed,
        message.groupKeyEpoch
      );
      const encryptedContent = encrypted.content;

      const previousMessage = message;

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).map((item) =>
            item.id === messageId
              ? { ...item, decryptedContent: trimmed, encryptedContent, isEdited: true }
              : item
          ),
        },
      }));

      try {
        const updated = await api.messages.edit(conversationId, messageId, { encryptedContent });
        const hydrated = await hydrateMessage(updated, conversation);

        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: upsertMessage(s.messages[conversationId] ?? [], {
              ...hydrated,
              decryptedContent: trimmed,
            }),
          },
          conversations: s.conversations.map((item) =>
            item.id === conversationId && item.lastMessage?.id === messageId
              ? { ...item, lastMessage: { ...hydrated, decryptedContent: trimmed } }
              : item
          ),
        }));
      } catch (error) {
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] ?? []).map((item) =>
              item.id === messageId ? previousMessage : item
            ),
          },
        }));
        throw error;
      }
    },

    async deleteMessage(conversationId, messageId) {
      const previousMessage = get().messages[conversationId]?.find((item) => item.id === messageId);
      if (!previousMessage) {
        return;
      }

      set((s) => ({
        messages: {
          ...s.messages,
          [conversationId]: (s.messages[conversationId] ?? []).map((item) =>
            item.id === messageId
              ? { ...item, isDeleted: true, decryptedContent: "", encryptedContent: "" }
              : item
          ),
        },
      }));

      try {
        await api.messages.delete(conversationId, messageId);
      } catch (error) {
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: (s.messages[conversationId] ?? []).map((item) =>
              item.id === messageId ? previousMessage : item
            ),
          },
        }));
        throw error;
      }
    },

    async createConversation(opts) {
      const raw = await api.conversations.create(opts);
      const [conv] = await hydrateConversationSummaries([raw]);
      if (!conv) throw new Error("Failed to create conversation");

      // A group is not usable until every member has an epoch-1 key copy.
      if (opts.type === "group") {
        try {
          const members = conv.members?.length
            ? conv.members
            : await api.conversations.listMembers(conv.id);
          if (members.length === 0) {
            throw new EncryptionError("The server returned a group without members.");
          }
          conv.members = members;
          conv.memberCount = members.length;
          await rotateGroupKey(
            conv.id,
            0,
            members.map((member) => ({
              userId: member.userId,
              publicKey: member.user?.publicKey,
            }))
          );
        } catch (error) {
          // Known validation/auth failures cannot have committed. Network/5xx
          // outcomes are ambiguous and must not trigger destructive cleanup.
          const provenPreCommitFailure =
            error instanceof EncryptionError ||
            (error instanceof ApiError && error.status !== 409 && error.status >= 400 && error.status < 500);
          if (provenPreCommitFailure) {
            await api.conversations.remove(conv.id).catch(() => undefined);
          }
          throw error;
        }
      }

      set((s) => ({
        conversations: s.conversations.some((c) => c.id === conv.id)
          ? s.conversations
          : [conv, ...s.conversations].sort(sortConversationList),
      }));
      return conv;
    },

    async updateConversation(conversationId, data) {
      const updatedConversation = await api.conversations.update(conversationId, data);
      const [hydratedConversation] = await hydrateConversationSummaries([updatedConversation]);

      if (!hydratedConversation) {
        throw new Error("Failed to update conversation");
      }

      set((s) => ({
        conversations: s.conversations
          .map((item) => (item.id === conversationId ? { ...item, ...hydratedConversation } : item))
          .sort(sortConversationList),
      }));

      return hydratedConversation;
    },

    async listMembers(conversationId) {
      const members = await api.conversations.listMembers(conversationId);
      set((s) => ({
        conversations: s.conversations.map((item) =>
          item.id === conversationId
            ? { ...item, members, memberCount: members.length }
            : item
        ),
      }));
      return members;
    },

    async addMember(conversationId, userId) {
      const conversation = get().conversations.find((item) => item.id === conversationId);
      if (conversation?.type !== "group") {
        await api.conversations.addMember(conversationId, userId);
        return get().listMembers(conversationId);
      }

      try {
        const currentKey = await getOrFetchGroupKey(conversationId);
        if (!currentKey) throw new EncryptionError("The current group key is unavailable.");
        const [members, newUser] = await Promise.all([
          api.conversations.listMembers(conversationId),
          api.users.get(userId),
        ]);
        await rotateGroupKey(
          conversationId,
          currentKey.epoch,
          [
            ...members.map((member) => ({
              userId: member.userId,
              publicKey: member.user?.publicKey,
            })),
            { userId, publicKey: newUser.publicKey },
          ],
          { action: "add", userId }
        );
      } catch (error) {
        invalidateCurrentGroupKey(conversationId, error);
        await get().listMembers(conversationId).catch(() => undefined);
        throw error;
      }
      return get().listMembers(conversationId);
    },

    async updateMemberRole(conversationId, userId, role) {
      await api.conversations.updateMemberRole(conversationId, userId, role);
      return get().listMembers(conversationId);
    },

    async removeMember(conversationId, userId) {
      const conversation = get().conversations.find((item) => item.id === conversationId);
      if (conversation?.type !== "group") {
        await api.conversations.removeMember(conversationId, userId);
        return get().listMembers(conversationId);
      }

      try {
        const currentKey = await getOrFetchGroupKey(conversationId);
        if (!currentKey) throw new EncryptionError("The current group key is unavailable.");
        const members = await api.conversations.listMembers(conversationId);
        await rotateGroupKey(
          conversationId,
          currentKey.epoch,
          members
            .filter((member) => member.userId !== userId)
            .map((member) => ({
              userId: member.userId,
              publicKey: member.user?.publicKey,
            })),
          { action: "remove", userId }
        );
      } catch (error) {
        invalidateCurrentGroupKey(conversationId, error);
        await get().listMembers(conversationId).catch(() => undefined);
        throw error;
      }
      return get().listMembers(conversationId);
    },

    async deleteConversation(conversationId) {
      await api.conversations.remove(conversationId);
      set((s) => {
        const nextMessages = { ...s.messages };
        delete nextMessages[conversationId];
        return {
          conversations: s.conversations.filter((item) => item.id !== conversationId),
          messages: nextMessages,
          activeConversationId: s.activeConversationId === conversationId ? null : s.activeConversationId,
        };
      });
    },

    handleIncomingEvent(event) {
      if (event.type === "message.new") {
        void (async () => {
          const rawMsg = mapMessage(event.payload);
          const state = get();
          let conversation = state.conversations.find((c) => c.id === rawMsg.conversationId);

          // Conversation not in store yet — new conversation for this user.
          // Fetch it and add to the list before processing the message.
          if (!conversation) {
            try {
              const rawConv = await api.conversations.get(rawMsg.conversationId);
              const [hydratedConv] = await hydrateConversationSummaries([rawConv]);
              if (hydratedConv) {
                set((s) => ({
                  conversations: s.conversations.some((c) => c.id === hydratedConv.id)
                    ? s.conversations
                    : [hydratedConv, ...s.conversations].sort(sortConversationList),
                }));
                conversation = hydratedConv;
              }
            } catch {
              // Couldn't fetch conversation — still process the message below
            }
          }

          const msg = await hydrateMessage(rawMsg, conversation);
          const currentUserId = useAuthStore.getState().user?.id;
          const isMuted = get().mutedIds.has(msg.conversationId);
          const shouldNotify =
            !isMuted &&
            msg.senderId !== currentUserId &&
            (state.activeConversationId !== msg.conversationId || typeof document !== "undefined" && document.hidden);

          set((s) => ({
            messages: {
              ...s.messages,
              [msg.conversationId]: withReplyLinks(upsertMessage(s.messages[msg.conversationId] ?? [], msg)),
            },
            typing: {
              ...s.typing,
              [msg.conversationId]: (s.typing[msg.conversationId] ?? []).filter((id) => id !== msg.senderId),
            },
            conversations: s.conversations
              .map((c) =>
                c.id === msg.conversationId
                  ? {
                      ...c,
                      lastMessage: msg,
                      updatedAt: msg.sentAt,
                      unreadCount:
                        !s.mutedIds.has(msg.conversationId) && msg.senderId !== currentUserId && s.activeConversationId !== msg.conversationId
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
              [editedMessage.conversationId]: withReplyLinks(upsertMessage(
                s.messages[editedMessage.conversationId] ?? [],
                editedMessage
              )),
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
            c.id === conversationId
              ? {
                  ...c,
                  unreadCount: userId === useAuthStore.getState().user?.id ? 0 : c.unreadCount,
                  members: c.members?.map((member) =>
                    member.userId === userId
                      ? {
                          ...member,
                          lastReadAt:
                            !member.lastReadAt || new Date(member.lastReadAt).getTime() < readAt
                              ? lastReadAt
                              : member.lastReadAt,
                        }
                      : member
                  ),
                }
              : c
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
            [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
              message.id === id ? { ...message, isDeleted: true, decryptedContent: "" } : message
            )),
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

      if (event.type === "typing") {
        const { conversationId, userId, isTyping } = event.payload as {
          conversationId: string;
          userId: string;
          isTyping: boolean;
        };
        const currentUserId = useAuthStore.getState().user?.id;
        if (!conversationId || !userId || userId === currentUserId) {
          return;
        }

        set((s) => {
          const existing = s.typing[conversationId] ?? [];
          const nextUsers = isTyping
            ? Array.from(new Set([...existing, userId]))
            : existing.filter((id) => id !== userId);

          return {
            typing: {
              ...s.typing,
              [conversationId]: nextUsers,
            },
          };
        });
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

function withReplyLinks(messages: Message[]) {
  const sorted = sortMessages(messages);
  const byId = new Map(sorted.map((message) => [message.id, message]));

  return sorted.map((message) => ({
    ...message,
    replyTo: message.replyToId ? byId.get(message.replyToId) : undefined,
  }));
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

async function uploadAndSendMediaMessage({
  conversationId,
  tempId,
  input,
  userId,
}: {
  conversationId: string;
  tempId: string;
  input: PendingMediaUpload["input"];
  userId: string;
}) {
  const caption = input.caption?.trim() ?? "";

  try {
    const conversation = useConversationStore.getState().conversations.find((c) => c.id === conversationId);
    const encrypted = await encryptOutgoingContent(conversation, userId, caption);
    const encryptedContent = encrypted.content;
    const uploadKind = input.type === "image" ? "image" : input.type === "video" ? "video" : input.type === "audio" ? "audio" : "file";
    const pending = pendingMediaUploads.get(tempId);
    let upload = pending?.upload;
    let mediaEncrypted = pending?.mediaEncrypted ?? false;
    if (pending?.groupKeyEpoch !== encrypted.groupKeyEpoch) {
      upload = undefined;
      mediaEncrypted = false;
    }
    if (!upload && conversation?.type !== "saved") {
      if (input.file.size > MAX_ENCRYPTED_ATTACHMENT_BYTES) {
        throw new EncryptionError(
          "Encrypted attachments are limited to 20 MB for the MVP to avoid exhausting browser memory."
        );
      }
      const attachmentKey = await getConversationEncryptionKey(
        conversation,
        userId,
        encrypted.groupKeyEpoch
      );
      if (!attachmentKey) {
        throw new EncryptionError(
          "Attachment encryption is unavailable on this device, so the file was not uploaded. Restore your key backup or wait for the group key."
        );
      }
      const plaintext = new Uint8Array(await input.file.arrayBuffer());
      const ciphertext = encryptBlob(plaintext, attachmentKey);
      const uploadBody = new Blob([Uint8Array.from(ciphertext)], { type: "application/octet-stream" });
      mediaEncrypted = true;

      upload = await api.uploads.create(uploadBody, uploadKind, input.fileName, {
        encrypted: { originalMimeType: input.mimeType, originalSize: input.file.size },
        onProgress: updateMediaUploadProgress(conversationId, tempId),
      });
    }

    if (!upload) {
      upload = await api.uploads.create(input.file, uploadKind, input.fileName, {
        onProgress: updateMediaUploadProgress(conversationId, tempId),
      });
    }

    pendingMediaUploads.set(tempId, {
      conversationId,
      tempId,
      input,
      upload,
      mediaEncrypted,
      groupKeyEpoch: encrypted.groupKeyEpoch,
    });
    const confirmed = await api.messages.send(conversationId, {
      type: input.type,
      encryptedContent,
      replyToId: input.replyToId,
      mediaUrl: upload.url,
      mediaName: upload.name,
      mediaMimeType: upload.mimeType,
      mediaSize: upload.size,
      mediaEncrypted,
      groupKeyEpoch: encrypted.groupKeyEpoch,
    });
    const confirmedMessage = await hydrateMessage(confirmed, conversation);
    pendingMediaUploads.delete(tempId);

    useConversationStore.setState((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: withReplyLinks(upsertMessage(
          (s.messages[conversationId] ?? []).map((m) =>
            m.id === tempId
              ? {
                  ...confirmedMessage,
                  decryptedContent: caption || confirmedMessage.decryptedContent,
                }
              : m
          ),
          {
            ...confirmedMessage,
            decryptedContent: caption || confirmedMessage.decryptedContent,
          }
        )),
      },
    }));
  } catch (error) {
    invalidateCurrentGroupKey(conversationId, error);
    const failureReason =
      error instanceof EncryptionError
        ? error.message
        : "Upload failed. Tap retry to try again.";
    useConversationStore.setState((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((m) =>
          m.id === tempId
            ? {
                ...m,
                status: "failed" as const,
                uploadError: failureReason,
                uploadProgress: undefined,
              }
            : m
        )),
      },
    }));
  }
}

function updateMediaUploadProgress(conversationId: string, tempId: string) {
  return (progress: number) => {
    useConversationStore.setState((s) => ({
      messages: {
        ...s.messages,
        [conversationId]: withReplyLinks((s.messages[conversationId] ?? []).map((message) =>
          message.id === tempId ? { ...message, uploadProgress: progress } : message
        )),
      },
    }));
  };
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
  return withReplyLinks(hydrated);
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
  if (!user || !message.encryptedContent || message.isDeleted) return message;

  try {
    if (conversation?.type === "saved") {
      return { ...message, decryptedContent: message.encryptedContent };
    }
    if (conversation?.type === "group") {
      // Group: decrypt with the shared group key
      const groupKey = await getOrFetchGroupKey(message.conversationId, message.groupKeyEpoch);
      if (!groupKey) return message;
      return { ...message, decryptedContent: decryptMessage(message.encryptedContent, groupKey.key) };
    } else {
      // DM: decrypt with ECDH shared secret
      const otherUser = conversation?.members?.find((member) => member.userId !== user.id)?.user;
      if (!otherUser?.publicKey) return message;
      const privateKey = await loadPrivateKey(user.id);
      if (!privateKey) return message;
      const sharedSecret = deriveSharedSecret(otherUser.publicKey, privateKey);
      return { ...message, decryptedContent: decryptMessage(message.encryptedContent, sharedSecret) };
    }
  } catch {
    return message;
  }
}

async function encryptOutgoingContent(
  conversation: Conversation | undefined,
  userId: string,
  text: string,
  requestedGroupKeyEpoch?: number
): Promise<{ content: string; groupKeyEpoch?: number }> {
  // "Saved Messages" are notes to yourself, stored unencrypted by design.
  if (conversation?.type === "saved") {
    return { content: text };
  }

  if (conversation?.type === "group") {
    const groupKey = await getOrFetchGroupKey(conversation.id, requestedGroupKeyEpoch);
    if (!groupKey) {
      throw new EncryptionError(
        "This group's encryption key isn't available on this device yet, so the message was not sent."
      );
    }
    if (!text) return { content: "", groupKeyEpoch: groupKey.epoch };
    const { encryptMessage } = await import("@deco/crypto");
    return {
      content: encryptMessage(text, groupKey.key),
      groupKeyEpoch: groupKey.epoch,
    };
  }

  if (!text) return { content: "" };

  const otherUser = conversation?.members?.find((member) => member.userId !== userId)?.user;
  if (!otherUser?.publicKey) {
    throw new EncryptionError(
      "Encryption is unavailable because the recipient's public key is missing, so the message was not sent."
    );
  }
  const privateKey = await loadPrivateKey(userId);
  if (!privateKey) {
    throw new EncryptionError(
      "Your private key is missing on this device, so the message was not sent. Restore your key backup from Settings to send encrypted messages."
    );
  }
  const { encryptMessage, deriveSharedSecret: derive } = await import("@deco/crypto");
  const sharedSecret = derive(otherUser.publicKey, privateKey);
  return { content: encryptMessage(text, sharedSecret) };
}

function notifyAboutMessage(message: Message, conversation?: Conversation) {
  if (typeof window === "undefined") return;

  const { pushNotifications, messagePreviews } = usePreferencesStore.getState();
  if (!pushNotifications) return;

  // In-app toast when user is actively viewing the app (but a different conversation)
  if (document.visibilityState !== "hidden") {
    useToastStore.getState().pushToast(message, conversation);
    return;
  }

  // Native browser notification when the tab is hidden/backgrounded
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const title = conversation?.name || message.sender?.displayName || "New message";
    const body = messagePreviews
      ? message.isDeleted
        ? "Message deleted"
        : (message.decryptedContent ?? "New message")
      : "New message";
    new Notification(title, { body, tag: message.conversationId });
  }
}
