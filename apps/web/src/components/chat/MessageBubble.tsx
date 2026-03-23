"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { format } from "date-fns";
import type { Message } from "@deco/types";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/store/auth";
import { useConversationStore } from "@/store/conversations";
import { ReactionPicker } from "./ReactionPicker";
import { MessageContextMenu } from "./MessageContextMenu";

interface Props {
  message: Message;
  isSent: boolean;
  showAvatar: boolean;
  isGrouped: boolean;
  isLastInGroup: boolean;
  replyCount?: number;
  onReply?: (message: Message) => void;
  onOpenThread?: (message: Message) => void;
}

export function MessageBubble({ message: msg, isSent, showAvatar, isGrouped, isLastInGroup, replyCount = 0, onReply, onOpenThread }: Props) {
  if (msg.isDeleted) return null;

  const text = getMessageText(msg);
  const time = format(new Date(msg.sentAt), "HH:mm");
  const senderName = msg.sender?.displayName || msg.sender?.username || "Unknown";
  const currentUserId = useAuthStore((s) => s.user?.id);
  const conversation = useConversationStore((s) =>
    s.conversations.find((item) => item.id === msg.conversationId)
  );
  const toggleReaction = useConversationStore((s) => s.toggleReaction);
  const votePoll = useConversationStore((s) => s.votePoll);
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
  const readers = getReadersForMessage(msg, conversation?.members, currentUserId);
  const readReceiptLabel = getReadReceiptLabel(msg, conversation?.type, readers);
  const readReceiptTitle = getReadReceiptTitle(readers);

  const swipeX = useMotionValue(0);
  const replyIconOpacity = useTransform(swipeX, [0, 30, 70], [0, 0.6, 1]);
  const replyIconScale = useTransform(swipeX, [0, 30, 70], [0.5, 0.8, 1]);

  function openReactions() {
    const rect = reactionContainerRef.current?.getBoundingClientRect();
    setPickerAbove(!rect || rect.top >= 180);
    setShowReactions((value) => !value);
  }

  useEffect(() => {
    setDraft(text);
  }, [text, msg.id]);

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  useEffect(() => {
    if (!showReactions) return;
    function handleOutsideClick(event: MouseEvent) {
      if (reactionContainerRef.current && !reactionContainerRef.current.contains(event.target as Node)) {
        setShowReactions(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showReactions]);

  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
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

  function handleBubbleClick(event: React.MouseEvent) {
    lastPos.current = { x: event.clientX, y: event.clientY };
    tapCount.current += 1;

    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }

    if (tapCount.current >= 2) {
      tapCount.current = 0;
      setContextMenu(lastPos.current);
      return;
    }

    tapTimer.current = setTimeout(() => {
      if (tapCount.current === 1) {
        openReactions();
      }
      tapCount.current = 0;
    }, 300);
  }

  return (
    <>
      <div
        data-message-id={msg.id}
        className={`relative ${isGrouped ? "mt-0.5" : "mt-3"}`}
        onContextMenu={handleContextMenu}
      >
        {/* Reply icon revealed by swipe */}
        <motion.div
          className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full bg-muted"
          style={{ opacity: replyIconOpacity, scale: replyIconScale }}
          aria-hidden
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
        </motion.div>

        <motion.div
          className={`flex items-end gap-2 ${isSent ? "flex-row-reverse" : "flex-row"}`}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={{ left: 0, right: 0.25 }}
          dragMomentum={false}
          style={{ x: swipeX }}
          onDragEnd={(_, info) => {
            if (info.offset.x > 55) onReply?.(msg);
            swipeX.set(0);
          }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
        {!isSent && (
          <div className="w-7 shrink-0">
            {showAvatar && <Avatar src={msg.sender?.avatarUrl} name={senderName} size="xs" />}
          </div>
        )}

        <div className={`group flex max-w-[65%] flex-col gap-1 ${isSent ? "items-end" : "items-start"}`}>
          {!isSent && !isGrouped && msg.sender && (
            <span className="px-1 text-[11px] font-medium text-muted">{senderName}</span>
          )}

          {msg.replyTo && (
            <button
              type="button"
              onClick={() => onOpenThread?.(msg)}
              className={`max-w-full truncate rounded-lg border-l-2 border-primary px-3 py-1.5 text-left text-xs opacity-70 transition-colors hover:opacity-100 ${
                isSent ? "bg-primary/10" : "bg-muted"
              }`}
            >
              {getReplyPreviewText(msg.replyTo)}
            </button>
          )}

          <div className="relative" ref={reactionContainerRef}>
            <motion.div
              className={`relative cursor-pointer select-none px-3.5 py-2 text-sm leading-relaxed ${
                isSent
                  ? `bubble-sent ${!isGrouped ? "rounded-2xl rounded-br-sm" : isLastInGroup ? "rounded-2xl rounded-br-sm rounded-tr-md" : "rounded-xl rounded-r-md"}`
                  : `bubble-received shadow-sm ${!isGrouped ? "rounded-2xl rounded-bl-sm" : isLastInGroup ? "rounded-2xl rounded-bl-sm rounded-tl-md" : "rounded-xl rounded-l-md"}`
              }`}
              initial={{ scale: 0.92, opacity: 0, x: isSent ? 8 : -8 }}
              animate={{ scale: 1, opacity: 1, x: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 28 }}
              onClick={handleBubbleClick}
            >
              {msg.type === "image" && msg.mediaUrl && (
                <img
                  src={msg.mediaUrl}
                  alt="Image"
                  className="mb-1.5 max-h-64 max-w-full rounded-xl object-cover"
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
              {msg.type === "poll" && msg.poll && (
                <div className="mb-2 min-w-[260px] rounded-2xl border border-border/70 bg-background/55 p-3">
                  <div className="mb-3">
                    <p className="text-sm font-semibold">{msg.poll.question}</p>
                    <p className="mt-1 text-xs text-muted">
                      {msg.poll.totalVotes} {msg.poll.totalVotes === 1 ? "vote" : "votes"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {msg.poll.options.map((option) => {
                      const percentage = msg.poll?.totalVotes ? Math.round((option.voteCount / msg.poll.totalVotes) * 100) : 0;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => void votePoll(msg.conversationId, msg.id, option.id)}
                          className={`relative block w-full overflow-hidden rounded-xl border px-3 py-2 text-left transition-colors ${
                            option.votedByMe
                              ? "border-primary/60 bg-primary/10"
                              : "border-sidebar bg-surface hover:bg-accent"
                          }`}
                        >
                          <span
                            className={`absolute inset-y-0 left-0 rounded-xl transition-all ${
                              option.votedByMe ? "bg-primary/15" : "bg-muted/70"
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="relative flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium">{option.text}</span>
                            <span className="shrink-0 text-xs text-muted">
                              {option.voteCount} • {percentage}%
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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

              <span className={`mt-1 flex items-center gap-1 text-[10px] opacity-55 ${isSent ? "justify-end" : "justify-start"}`}>
                {time}
                {isSent && <DeliveryIcon status={msg.status} />}
              </span>
            </motion.div>

            <button
              onClick={(event) => {
                event.stopPropagation();
                openReactions();
              }}
              className={`absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-xs opacity-0 shadow-sm transition-opacity group-hover:opacity-100 ${
                isSent ? "-left-8" : "-right-8"
              }`}
              aria-label="Add reaction"
            >
              <span>😊</span>
            </button>

            <button
              onClick={(event) => {
                event.stopPropagation();
                onReply?.(msg);
              }}
              className={`absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-xs opacity-0 shadow-sm transition-opacity group-hover:opacity-100 ${
                isSent ? "-left-16" : "-right-16"
              }`}
              aria-label="Reply to message"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>

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

          {msg.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {groupReactions(msg.reactions, currentUserId).map(({ emoji, count, reactedByMe }) => (
                <button
                  key={emoji}
                  onClick={() => void toggleReaction(msg.conversationId, msg.id, emoji)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                    reactedByMe ? "bg-primary/15 text-primary hover:bg-primary/20" : "bg-muted hover:bg-accent"
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="text-muted">{count}</span>}
                </button>
              ))}
            </div>
          )}

          {(replyCount > 0 || msg.replyToId) && (
            <button
              type="button"
              onClick={() => onOpenThread?.(msg)}
              className="rounded-full border border-sidebar/80 bg-surface px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-accent hover:text-foreground"
            >
              {replyCount > 0 ? `View thread (${replyCount + (msg.replyToId ? 1 : 0)})` : "View thread"}
            </button>
          )}

          {isSent && readReceiptLabel && (
            <span
              className="px-1 text-[11px] text-muted"
              title={readReceiptTitle}
            >
              {readReceiptLabel}
            </span>
          )}
        </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {contextMenu && (
          <MessageContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isSent={isSent}
            text={text}
            onEdit={isSent && !msg.isDeleted ? () => setIsEditing(true) : undefined}
            onReply={() => onReply?.(msg)}
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
    return <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent opacity-60" title="Sending" />;
  }
  if (status === "failed") {
    return (
      <span title="Failed">
        <svg className="h-3.5 w-3.5 text-destructive" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
      </span>
    );
  }
  if (status === "read") {
    return (
      <span title="Read">
        <svg className="h-3.5 w-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
        </svg>
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span title="Delivered">
        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z" />
        </svg>
      </span>
    );
  }
  return (
    <span title="Sent">
      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
      </svg>
    </span>
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
  if (message.type === "poll" && message.poll) return message.poll.question;
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

function getReplyPreviewText(message: Message) {
  return message.decryptedContent || message.mediaName || getMessageText(message) || "Reply";
}

function getReadersForMessage(message: Message, members?: { userId: string; user?: { displayName: string; username: string }; lastReadAt: string }[], currentUserId?: string | null) {
  if (!members?.length) {
    return [];
  }

  const sentAt = new Date(message.sentAt).getTime();
  if (Number.isNaN(sentAt)) {
    return [];
  }

  return members
    .filter((member) => member.userId !== currentUserId && member.userId !== message.senderId && Boolean(member.lastReadAt))
    .filter((member) => new Date(member.lastReadAt).getTime() >= sentAt)
    .sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());
}

function getReadReceiptLabel(message: Message, conversationType: "direct" | "group" | "channel" | undefined, readers: ReturnType<typeof getReadersForMessage>) {
  if (!readers.length || message.status !== "read") {
    return "";
  }

  if (conversationType === "direct") {
    return `Seen ${format(new Date(readers[0]!.lastReadAt), "HH:mm")}`;
  }

  const names = readers.map((reader) => reader.user?.displayName || reader.user?.username || "Someone");
  if (names.length === 1) {
    return `Seen by ${names[0]}`;
  }
  if (names.length === 2) {
    return `Seen by ${names[0]} and ${names[1]}`;
  }
  return `Seen by ${names[0]} and ${names.length - 1} others`;
}

function getReadReceiptTitle(readers: ReturnType<typeof getReadersForMessage>) {
  if (!readers.length) {
    return "";
  }

  return readers
    .map((reader) => {
      const name = reader.user?.displayName || reader.user?.username || "Someone";
      return `${name} • ${format(new Date(reader.lastReadAt), "PPp")}`;
    })
    .join("\n");
}
