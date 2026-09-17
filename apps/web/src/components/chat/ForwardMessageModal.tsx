"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { Conversation, Message } from "@deco/types";
import { Avatar } from "@/components/ui/Avatar";
import { useConversationStore } from "@/store/conversations";

interface Props {
  message: Message | null;
  onClose: () => void;
}

function preview(message: Message): string {
  if (message.type === "sticker") return message.sticker?.emoji ? `${message.sticker.emoji} Sticker` : "Sticker";
  if (message.type === "poll") return message.poll?.question || "Poll";
  if (message.type === "image") return "Photo";
  if (message.type === "video") return "Video";
  if (message.type === "audio") return "Audio";
  if (message.type === "file") return message.mediaName || "File";
  if (message.type === "location") return "Location";
  if (message.type === "contact") return "Contact";
  return message.decryptedContent || "Message";
}

function conversationLabel(conversation: Conversation): string {
  if (conversation.type === "saved") return "Saved Messages";
  return conversation.name || "Unnamed conversation";
}

export function ForwardMessageModal({ message, onClose }: Props) {
  const conversations = useConversationStore((state) => state.conversations);
  const forwardMessage = useConversationStore((state) => state.forwardMessage);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [forwardingId, setForwardingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!message) return;
    setQuery("");
    setForwardingId(null);
    setError(null);
  }, [message]);
  useEffect(() => {
    if (!message) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !forwardingId) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [forwardingId, message, onClose]);

  const destinations = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return conversations.filter((conversation) => {
      if (conversation.id === message?.conversationId) return false;
      if (!normalized) return true;
      return `${conversationLabel(conversation)} ${conversation.description}`.toLocaleLowerCase().includes(normalized);
    });
  }, [conversations, message?.conversationId, query]);

  async function handleForward(destination: Conversation) {
    if (!message || forwardingId) return;
    setForwardingId(destination.id);
    setError(null);
    try {
      await forwardMessage(message, destination.id);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be forwarded.");
      setForwardingId(null);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {message && (
        <motion.div
          className="fixed inset-0 z-[210] flex items-end justify-center p-0 sm:items-start sm:p-4 sm:pt-20"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!forwardingId) onClose(); }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            className="relative z-10 flex w-full max-w-sm flex-col overflow-hidden rounded-t-3xl border border-sidebar bg-surface shadow-2xl sm:max-h-[min(36rem,calc(100vh-6rem))] sm:rounded-2xl"
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-sidebar px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Forward message</h2>
                <p className="mt-0.5 truncate text-xs text-muted">{preview(message)}</p>
              </div>
              <button type="button" onClick={onClose} disabled={Boolean(forwardingId)} className="icon-btn" aria-label="Close">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="border-b border-sidebar px-4 py-3">
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations"
                className="w-full rounded-xl border border-transparent bg-muted px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/40"
              />
              {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
            </div>
            <div className="max-h-80 overflow-y-auto chat-scroll py-1">
              {destinations.length ? destinations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  disabled={Boolean(forwardingId)}
                  onClick={() => void handleForward(conversation)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <Avatar src={conversation.avatarUrl} name={conversationLabel(conversation)} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{conversationLabel(conversation)}</p>
                    <p className="truncate text-xs text-muted">{conversation.type === "group" ? "Group" : conversation.type === "saved" ? "Private" : "Direct"}</p>
                  </div>
                  {forwardingId === conversation.id && <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
                </button>
              )) : (
                <p className="px-4 py-10 text-center text-sm text-muted">No other conversations found.</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
