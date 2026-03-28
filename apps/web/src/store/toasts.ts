import { create } from "zustand";
import type { Conversation, Message } from "@deco/types";

export interface ToastItem {
  id: string;
  message: Message;
  conversation?: Conversation;
}

interface ToastState {
  toasts: ToastItem[];
  pushToast: (message: Message, conversation?: Conversation) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  pushToast(message, conversation) {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    set((s) => ({
      // Keep max 3 visible toasts
      toasts: [...s.toasts, { id, message, conversation }].slice(-3),
    }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
