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
  if (msg.isDeleted) return null;

  const text = getMessageText(msg);
  const time = format(new Date(msg.sentAt), "HH:mm");
  const senderName = msg.sender?.displayName || msg.sender?.username || "Unknown";
  const currentUserId = useAuthStore((s) => s.user?.id);
  const toggleReaction = useConversationStore((s) => s.toggleReaction);
  const editMessage = useConversationStore((s) => s.editMessage);
  const deleteMessage = useConversationStore((s) => s.deleteMessage);
  const [showReactions, setShowReactions] = useState(false);
  const [pickerAbove, setPickerAbove] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const reactionContainerRef = useRef<HTMLDivElement>(null);

  function openReactions() {
    // Check if there's enough room above the bubble to show the picker (≥180px)
    const rect = reactionContainerRef.current?.getBoundingClientRect();
    setPickerAbove(!rect || rect.top >= 180);
    setShowReactions((v) => !v);
  }

  useEffect(() => {
    setDraft(text);
  }, [text, msg.id]);

  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);

  // Close emoji bar on outside click
  useEffect(() => {
    if (!showReactions) return;
    function handleOutsideClick(e: MouseEvent) {
      if (reactionContainerRef.current && !reactionContainerRef.current.contains(e.target as Node)) {
        setShowReactions(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showReactions]);

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
      if (tapCount.current === 1) {
        openReactions();
      }
      tapCount.current = 0;
    }, 300);
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
          <div className="relative" ref={reactionContainerRef}>
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
              {msg.type === "video" && msg.mediaUrl && (
                <video
                  src={msg.mediaUrl}
                  controls
                  playsInline
                  className="mb-2 max-h-72 w-full rounded-xl bg-black"
                />
              )}
              {msg.type === "audio" && msg.mediaUrl && (
                <div className="mb-2 min-w-[240px] rounded-xl bg-black/5 p-2">
                  <div className="mb-1 text-xs font-medium opacity-70">
                    {msg.mediaName || "Audio message"}
                  </div>
                  <audio src={msg.mediaUrl} controls className="w-full" preload="metadata" />
                </div>
              )}
              {msg.type === "file" && msg.mediaUrl && (
                <a
                  href={msg.mediaUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-2 flex min-w-[220px] items-center gap-3 rounded-xl border border-border/70 bg-background/50 px-3 py-3 transition-colors hover:bg-accent"
                >
                  <div className="rounded-xl bg-muted p-2">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5A2.25 2.25 0 0 0 19.5 19.5v-5.25Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 2.25v4.5A1.5 1.5 0 0 0 15 8.25h4.5" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{msg.mediaName || "File attachment"}</div>
                    <div className="truncate text-xs opacity-70">{formatBytes(msg.mediaSize)}</div>
                  </div>
                </a>
              )}

              {/* Text */}
              {isEditing ? (
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
            <button
              onClick={(e) => { e.stopPropagation(); openReactions(); }}
              className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity
                w-6 h-6 rounded-full bg-surface border border-border shadow-sm flex items-center justify-center text-xs
                ${isSent ? "-left-8" : "-right-8"}`}
              aria-label="Add reaction"
            >
              <span>😊</span>
            </button>

            {/* Reaction picker popover */}
            <AnimatePresence>
              {showReactions && (
                <div className={`absolute z-50 ${pickerAbove ? "bottom-full mb-1" : "top-full mt-1"} ${isSent ? "right-0" : "left-0"} w-max`}>
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
  if (message.type !== "text" && message.mediaUrl) return "";
  if (message.encryptedContent) return "Encrypted message unavailable on this device";
  return "";
}

function formatBytes(value?: number) {
  if (!value) return "Attachment";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[unit]}`;
}
