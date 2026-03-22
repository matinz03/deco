"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/store/auth";
import { useConversationStore } from "@/store/conversations";
import { ReactionPicker } from "./ReactionPicker";
import { MessageContextMenu } from "./MessageContextMenu";
import { format } from "date-fns";
import type { Message } from "@deco/types";

interface Props {
  message: Message;
  isSent: boolean;
  showAvatar: boolean;
}

export function MessageBubble({ message: msg, isSent, showAvatar }: Props) {
  const text = getMessageText(msg);
  const time = format(new Date(msg.sentAt), "HH:mm");
  const senderName = msg.sender?.displayName || msg.sender?.username || "Unknown";
  const currentUserId = useAuthStore((s) => s.user?.id);
  const toggleReaction = useConversationStore((s) => s.toggleReaction);
  const editMessage = useConversationStore((s) => s.editMessage);
  const deleteMessage = useConversationStore((s) => s.deleteMessage);
  const [showReactions, setShowReactions] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setDraft(text);
  }, [text, msg.id]);

  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  async function handleSaveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === text) {
      setIsEditing(false);
      setDraft(text);
      return;
    }

    await editMessage(msg.conversationId, msg.id, trimmed);
    setIsEditing(false);
  }

  function handleBubbleClick(e: React.MouseEvent) {
    lastPos.current = { x: e.clientX, y: e.clientY };
    tapCount.current += 1;

    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }

    // Double tap — open context menu immediately
    if (tapCount.current >= 2) {
      tapCount.current = 0;
      setContextMenu(lastPos.current);
      return;
    }

    // Single tap — wait 1.5s, then open emoji bar if no second tap
    tapTimer.current = setTimeout(() => {
      if (tapCount.current === 1 && !msg.isDeleted) {
        setShowReactions((v) => !v);
      }
      tapCount.current = 0;
    }, 1500);
  }

  return (
    <>
      <motion.div
        className={`flex items-end gap-2 ${isSent ? "flex-row-reverse" : "flex-row"}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        onContextMenu={handleContextMenu}
      >
        {/* Avatar for received messages */}
        {!isSent && (
          <div className="w-7 shrink-0">
            {showAvatar && (
              <Avatar src={msg.sender?.avatarUrl} name={senderName} size="xs" />
            )}
          </div>
        )}

        <div className={`group flex flex-col gap-1 max-w-[65%] ${isSent ? "items-end" : "items-start"}`}>
          {/* Sender name for groups (received only) */}
          {!isSent && showAvatar && msg.sender && (
            <span className="text-[11px] font-medium text-muted px-1">{senderName}</span>
          )}

          {/* Reply preview */}
          {msg.replyTo && (
            <div className={`text-xs px-3 py-1.5 rounded-lg border-l-2 border-primary opacity-70 max-w-full truncate
              ${isSent ? "bg-primary/10" : "bg-muted"}`}>
              {msg.replyTo.decryptedContent ?? "…"}
            </div>
          )}

          {/* Bubble + reaction trigger */}
          <div className="relative">
            <motion.div
              className={`relative px-3.5 py-2 rounded-2xl text-sm leading-relaxed cursor-pointer select-none
                ${isSent ? "bubble-sent rounded-br-sm" : "bubble-received rounded-bl-sm shadow-sm"}
              `}
              initial={{ scale: 0.92, opacity: 0, x: isSent ? 8 : -8 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              onClick={handleBubbleClick}
            >
              {/* Media */}
              {msg.type === "image" && msg.mediaUrl && (
                <img
                  src={msg.mediaUrl}
                  alt="Image"
                  className="rounded-xl max-w-full max-h-64 object-cover mb-1.5"
                  loading="lazy"
                />
              )}

              {/* Text */}
              {msg.isDeleted ? (
                <span className="italic opacity-50">Message deleted</span>
              ) : isEditing ? (
                <div className="min-w-[220px]">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSaveEdit();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setIsEditing(false);
                        setDraft(text);
                      }
                    }}
                    className="min-h-[84px] w-full resize-none rounded-xl border border-border bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring/40"
                    autoFocus
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setDraft(text);
                      }}
                      className="rounded-lg px-2.5 py-1 text-xs text-muted transition-colors hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleSaveEdit()}
                      className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <span className="whitespace-pre-wrap break-words">
                  {text}
                  {msg.isEdited && <span className="ml-1 text-[11px] opacity-60">(edited)</span>}
                </span>
              )}

              {/* Time + status */}
              <span className={`flex items-center gap-1 text-[10px] mt-1 opacity-55 ${isSent ? "justify-end" : "justify-start"}`}>
                {time}
                {isSent && <DeliveryIcon status={msg.status} />}
              </span>
            </motion.div>

            {/* Reaction picker trigger — shows on hover (desktop) */}
            {!msg.isDeleted && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowReactions((v) => !v); }}
                className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity
                  w-6 h-6 rounded-full bg-surface border border-border shadow-sm flex items-center justify-center text-xs
                  ${isSent ? "-left-8" : "-right-8"}`}
                aria-label="Add reaction"
              >
                <span>😊</span>
              </button>
            )}

            {/* Reaction picker popover */}
            <AnimatePresence>
              {showReactions && (
                <div className={`absolute bottom-full mb-1 z-50 ${isSent ? "right-0" : "left-0"} w-max`}>
                  <ReactionPicker
                    onSelect={(emoji) => {
                      void toggleReaction(msg.conversationId, msg.id, emoji);
                    }}
                    onClose={() => setShowReactions(false)}
                  />
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Reactions */}
          {msg.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {groupReactions(msg.reactions, currentUserId).map(({ emoji, count, reactedByMe }) => (
                <button
                  key={emoji}
                  onClick={() => void toggleReaction(msg.conversationId, msg.id, emoji)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${
                    reactedByMe
                      ? "bg-primary/15 text-primary hover:bg-primary/20"
                      : "bg-muted hover:bg-accent"
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="text-muted">{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* Context menu (portal) */}
      <AnimatePresence>
        {contextMenu && (
          <MessageContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isSent={isSent}
            text={text}
            onEdit={isSent && !msg.isDeleted ? () => setIsEditing(true) : undefined}
            onReply={() => {/* reply state to be wired */}}
            onCopy={() => void navigator.clipboard.writeText(text)}
            onDelete={isSent && !msg.isDeleted ? () => void deleteMessage(msg.conversationId, msg.id) : undefined}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function DeliveryIcon({ status }: { status: Message["status"] }) {
  if (status === "sending") {
    return <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin opacity-60" />;
  }
  if (status === "failed") {
    return (
      <svg className="w-3.5 h-3.5 text-destructive" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
    );
  }
  if (status === "read") {
    return (
      <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
      </svg>
    );
  }
  if (status === "delivered") {
    return (
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  );
}

function groupReactions(reactions: Message["reactions"], currentUserId?: string | null) {
  const map = new Map<string, { count: number; reactedByMe: boolean }>();

  for (const reaction of reactions) {
    const existing = map.get(reaction.emoji) ?? { count: 0, reactedByMe: false };
    existing.count += 1;
    existing.reactedByMe = existing.reactedByMe || reaction.userId === currentUserId;
    map.set(reaction.emoji, existing);
  }

  return Array.from(map.entries()).map(([emoji, value]) => ({
    emoji,
    count: value.count,
    reactedByMe: value.reactedByMe,
  }));
}

function getMessageText(message: Message) {
  if (message.decryptedContent) return message.decryptedContent;
  if (message.encryptedContent) return "Encrypted message unavailable on this device";
  return "";
}
