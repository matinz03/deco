"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import type { Message } from "@deco/types";

interface Props {
  open: boolean;
  messages: Message[];
  focusMessageId: string | null;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}

type ThreadNode = {
  message: Message;
  depth: number;
  isFocus: boolean;
};

export function ThreadPortal({ open, messages, focusMessageId, onClose, onJumpToMessage }: Props) {
  const thread = useMemo(() => buildThread(messages, focusMessageId), [messages, focusMessageId]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && thread.length > 0 && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <motion.div
            className="relative z-10 flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-sidebar bg-surface shadow-2xl sm:max-h-[85dvh] sm:rounded-3xl"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 justify-center pb-1 pt-3 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between border-b border-sidebar px-5 py-4">
              <div>
                <h3 className="text-base font-semibold">Thread</h3>
                <p className="text-xs text-muted">Follow the reply chain for this conversation.</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-muted transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close thread"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <div className="space-y-3">
                {thread.map(({ message, depth, isFocus }) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => {
                      onJumpToMessage(message.id);
                      onClose();
                    }}
                    className={`block w-full rounded-2xl border px-4 py-3 text-left transition-colors hover:bg-accent ${
                      isFocus ? "border-primary/40 bg-primary/5" : "border-sidebar/80 bg-background/40"
                    }`}
                    style={{ marginLeft: `${Math.min(depth, 4) * 20}px`, width: `calc(100% - ${Math.min(depth, 4) * 20}px)` }}
                  >
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {message.sender?.displayName || message.sender?.username || "Unknown"}
                        </p>
                        <p className="text-[11px] text-muted">{format(new Date(message.sentAt), "PPp")}</p>
                      </div>
                      {isFocus && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          Focus
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-3 text-sm text-foreground/90">
                      {message.decryptedContent || message.mediaName || getTypeLabel(message)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function buildThread(messages: Message[], focusMessageId: string | null): ThreadNode[] {
  if (!focusMessageId) return [];

  const byId = new Map(messages.map((message) => [message.id, message]));
  let rootId = focusMessageId;
  const seen = new Set<string>();

  while (true) {
    const current = byId.get(rootId);
    if (!current?.replyToId || seen.has(rootId)) break;
    seen.add(rootId);
    rootId = current.replyToId;
  }

  const threadMessages = messages.filter((message) => belongsToRoot(message, rootId, byId));
  const sorted = [...threadMessages].sort((a, b) => {
    const sentAtDiff = new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime();
    if (sentAtDiff !== 0) return sentAtDiff;
    return a.id.localeCompare(b.id);
  });

  return sorted.map((message) => ({
    message,
    depth: getDepth(message, rootId, byId),
    isFocus: message.id === focusMessageId,
  }));
}

function belongsToRoot(message: Message, rootId: string, byId: Map<string, Message>) {
  let current: Message | undefined = message;
  const seen = new Set<string>();

  while (current) {
    if (current.id === rootId) return true;
    if (!current.replyToId || seen.has(current.id)) return false;
    seen.add(current.id);
    current = byId.get(current.replyToId);
  }

  return false;
}

function getDepth(message: Message, rootId: string, byId: Map<string, Message>) {
  let depth = 0;
  let current: Message | undefined = message;
  const seen = new Set<string>();

  while (current && current.id !== rootId && current.replyToId && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.replyToId);
    depth += 1;
  }

  return depth;
}

function getTypeLabel(message: Message) {
  switch (message.type) {
    case "image":
      return "Image attachment";
    case "video":
      return "Video attachment";
    case "audio":
      return "Audio attachment";
    case "file":
      return "File attachment";
    case "sticker":
      return "Sticker";
    case "poll":
      return "Poll";
    case "location":
      return "Shared location";
    case "contact":
      return "Shared contact";
    default:
      return "Message";
  }
}
