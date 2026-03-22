import { create } from "zustand";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { decryptMessage, deriveSharedSecret, loadPrivateKey } from "@deco/crypto";
import type { Conversation, Message, WSEvent } from "@deco/types";
import { useAuthStore } from "./auth";

interface ConversationState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  activeConversationId: string | null;

  fetchConversations: () => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (conversationId: string, text: string) => Promise<void>;
  setActiveConversation: (id: string | null) => void;
  handleIncomingEvent: (event: WSEvent) => void;
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

    setActiveConversation(id) {
      set({ activeConversationId: id });
    },

    async fetchConversations() {
      const conversations = await api.conversations.list();
      set({ conversations });
    },

    async fetchMessages(conversationId) {
      const rawMessages = await api.messages.list(conversationId);
      const user = useAuthStore.getState().user;
      if (!user) return;

      // Decrypt messages client-side
      const decrypted = await Promise.all(
        rawMessages.map(async (msg) => {
          try {
            const conversation = get().conversations.find((c) => c.id === conversationId);
            const otherUser = conversation?.members?.find((m) => m.userId !== user.id)?.user;
            if (!otherUser) return msg;

            const privateKey = await loadPrivateKey(user.id);
            if (!privateKey) return msg;

            const sharedSecret = deriveSharedSecret(otherUser.publicKey, privateKey);
            const decryptedContent = decryptMessage(msg.encryptedContent, sharedSecret);
            return { ...msg, decryptedContent };
          } catch {
            return msg; // Return as-is if decryption fails
          }
        })
      );

      set((s) => ({ messages: { ...s.messages, [conversationId]: decrypted } }));
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

        // Replace optimistic message with confirmed one
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: s.messages[conversationId]!.map((m) =>
              m.id === tempId ? { ...confirmed, decryptedContent: text } : m
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

    handleIncomingEvent(event) {
      if (event.type === "message.new") {
        const msg = event.payload as Message;
        set((s) => ({
          messages: {
            ...s.messages,
            [msg.conversationId]: [...(s.messages[msg.conversationId] ?? []), msg],
          },
          // Update last message in conversation list
          conversations: s.conversations.map((c) =>
            c.id === msg.conversationId
              ? { ...c, lastMessage: msg, updatedAt: msg.sentAt }
              : c
          ),
        }));
      }

      if (event.type === "message.read") {
        const { conversationId } = event.payload as { conversationId: string; userId: string; lastReadAt: string };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
          ),
        }));
      }
    },
  };
});
