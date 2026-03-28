"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { format } from "date-fns";
import dynamic from "next/dynamic";
import type { ContactAttachment, LocationAttachment, Message } from "@deco/types";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/store/auth";
import { useConversationStore } from "@/store/conversations";

const ReactionPicker = dynamic(
  () => import("./ReactionPicker").then((mod) => mod.ReactionPicker),
  { ssr: false }
);

const ImageLightbox = dynamic(
  () => import("./ImageLightbox").then((mod) => mod.ImageLightbox),
  { ssr: false }
);

const MessageContextMenu = dynamic(
  () => import("./MessageContextMenu").then((mod) => mod.MessageContextMenu),
  { ssr: false }
);

function getFileTypeStyle(mimeType?: string, name?: string): { bg: string; text: string; label: string } {
  const ext = name?.split(".").pop()?.toLowerCase() ?? "";
  const mime = mimeType ?? "";
  if (mime.startsWith("image/") || ["jpg","jpeg","png","gif","webp","svg"].includes(ext))
    return { bg: "bg-blue-500/15", text: "text-blue-500", label: ext.toUpperCase() || "IMG" };
  if (mime.startsWith("video/") || ["mp4","mov","webm","avi","mkv"].includes(ext))
    return { bg: "bg-purple-500/15", text: "text-purple-500", label: ext.toUpperCase() || "VID" };
  if (mime.startsWith("audio/") || ["mp3","wav","ogg","flac","m4a","aac"].includes(ext))
    return { bg: "bg-orange-500/15", text: "text-orange-500", label: ext.toUpperCase() || "AUD" };
  if (mime === "application/pdf" || ext === "pdf")
    return { bg: "bg-red-500/15", text: "text-red-500", label: "PDF" };
  if (["zip","rar","7z","tar","gz"].includes(ext))
    return { bg: "bg-yellow-500/15", text: "text-yellow-500", label: ext.toUpperCase() || "ZIP" };
  if (["doc","docx"].includes(ext) || mime.includes("word"))
    return { bg: "bg-green-500/15", text: "text-green-500", label: ext.toUpperCase() || "DOC" };
  return { bg: "bg-muted", text: "text-muted-foreground", label: ext.toUpperCase() || "FILE" };
}

function AudioPlayer({ src, name }: { src: string; name?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); } else { void el.play(); }
  }

  function fmt(s: number) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  const bars = [3, 5, 8, 6, 4, 7, 5, 9, 6, 3, 7, 5];

  return (
    <div className="mb-2 flex min-w-[220px] items-center gap-3 rounded-2xl bg-black/5 px-3 py-2.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="h-4 w-4 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 min-w-0">
        <div className="flex items-end gap-px h-7">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`w-1 rounded-full transition-all ${playing ? "animate-pulse" : ""}`}
              style={{
                height: `${h * 3}px`,
                backgroundColor: playing ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.4)",
                animationDelay: `${i * 60}ms`,
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{fmt(currentTime)} / {fmt(duration || 0)}</span>
          {name && <span className="truncate text-[10px] text-muted-foreground ml-2 max-w-[100px]">{name}</span>}
        </div>
      </div>
    </div>
  );
}

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
  const location = parseLocationAttachment(msg);
  const contact = parseContactAttachment(msg);
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
  const retryMediaMessage = useConversationStore((s) => s.retryMediaMessage);
  const [lightboxOpen, setLightboxOpen] = useState(false);
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
              initial={{ scale: 0.9, opacity: 0, y: 14 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              onClick={handleBubbleClick}
            >
              {msg.type === "image" && msg.mediaUrl && (
                <>
                  <img
                    src={msg.mediaUrl}
                    alt="Image"
                    className="mb-1.5 max-h-64 max-w-full rounded-xl object-cover cursor-zoom-in"
                    loading="lazy"
                    onClick={(e) => { e.stopPropagation(); setLightboxOpen(true); }}
                  />
                  <ImageLightbox
                    src={msg.mediaUrl}
                    open={lightboxOpen}
                    onClose={() => setLightboxOpen(false)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <a
                      href={msg.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open
                    </a>
                    <a
                      href={msg.mediaUrl}
                      download={msg.mediaName || "image"}
                      className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Download
                    </a>
                  </div>
                </>
              )}
              {msg.type === "sticker" && (msg.sticker?.assetUrl || msg.mediaUrl) && (
                <div className="mb-2 flex justify-center">
                  {msg.sticker?.format === "video" || msg.mediaMimeType?.startsWith("video/") ? (
                    <video
                      src={msg.sticker?.assetUrl || msg.mediaUrl}
                      muted
                      loop
                      autoPlay
                      playsInline
                      className="max-h-48 max-w-[180px] rounded-2xl object-contain"
                    />
                  ) : (
                    <img
                      src={msg.sticker?.assetUrl || msg.mediaUrl}
                      alt={msg.sticker?.name || "Sticker"}
                      className="max-h-48 max-w-[180px] rounded-2xl object-contain"
                      loading="lazy"
                    />
                  )}
                </div>
              )}
              {msg.type === "video" && msg.mediaUrl && (
                <div className="mb-2 overflow-hidden rounded-2xl bg-black">
                  <video
                    src={msg.mediaUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="max-h-72 w-full object-contain"
                  />
                  <div className="flex items-center justify-between bg-black/60 px-3 py-1.5">
                    <span className="truncate text-[11px] text-white/70 max-w-[140px]">{msg.mediaName || "Video"}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={msg.mediaUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/10 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >Open</a>
                      <a
                        href={msg.mediaUrl}
                        download={msg.mediaName || "video"}
                        className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-white/80 hover:bg-white/10 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >Download</a>
                    </div>
                  </div>
                </div>
              )}
              {msg.type === "audio" && msg.mediaUrl && (
                <AudioPlayer src={msg.mediaUrl} name={msg.mediaName} />
              )}
              {msg.type === "file" && (msg.mediaUrl || msg.mediaName) && (() => {
                const ft = getFileTypeStyle(msg.mediaMimeType, msg.mediaName);
                return (
                  <div className="mb-2 min-w-[240px] rounded-xl border border-border/70 bg-background/50 px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`relative rounded-xl p-2 ${ft.bg} shrink-0`}>
                        <svg className={`h-5 w-5 ${ft.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5A2.25 2.25 0 0 0 19.5 19.5v-5.25Z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 2.25v4.5A1.5 1.5 0 0 0 15 8.25h4.5" />
                        </svg>
                        <span className={`absolute -bottom-1.5 -right-1.5 rounded px-0.5 text-[7px] font-bold leading-none ${ft.bg} ${ft.text} border border-current/20 py-0.5`}>
                          {ft.label.slice(0, 4)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{msg.mediaName || "File attachment"}</div>
                        <div className="truncate text-xs opacity-70">{formatBytes(msg.mediaSize)}</div>
                      </div>
                    </div>
                    {msg.mediaUrl && (
                      <div className="mt-3 flex items-center gap-2">
                        <a
                          href={msg.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >Open</a>
                        <a
                          href={msg.mediaUrl}
                          download={msg.mediaName || "attachment"}
                          className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >Download</a>
                      </div>
                    )}
                  </div>
                );
              })()}
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
              {msg.type === "location" && location && (
                <div className="mb-2 min-w-[260px] rounded-2xl border border-border/70 bg-background/55 p-3">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.75-5.625-6.75-11.25a6.75 6.75 0 1 1 13.5 0C18.75 15.375 12 21 12 21Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{location.label || "Shared location"}</p>
                      <p className="mt-1 text-xs text-muted">
                        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                      </p>
                    </div>
                  </div>
                  <a
                    href={buildMapLink(location)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Open in maps
                  </a>
                  <button
                    type="button"
                    className="ml-2 inline-flex rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                    onClick={(event) => {
                      event.stopPropagation();
                      void navigator.clipboard.writeText(`${location.latitude}, ${location.longitude}`);
                    }}
                  >
                    Copy coords
                  </button>
                </div>
              )}
              {msg.type === "contact" && contact && (
                <div className="mb-2 min-w-[260px] rounded-2xl border border-border/70 bg-background/55 p-3">
                  <div className="mb-3 flex items-start gap-3">
                    <Avatar src="" name={contact.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{contact.name}</p>
                      {contact.phone && <p className="mt-1 text-xs text-muted">{contact.phone}</p>}
                      {contact.email && <p className="truncate text-xs text-muted">{contact.email}</p>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Call
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Email
                      </a>
                    )}
                    <button
                      type="button"
                      className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-accent"
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigator.clipboard.writeText(buildContactClipboardText(contact));
                      }}
                    >
                      Copy
                    </button>
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

              {typeof msg.uploadProgress === "number" && msg.status === "sending" && (
                <div className="mt-2 min-w-[180px]">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                    <span>Uploading...</span>
                    <span>{msg.uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full rounded-full bg-current transition-[width] duration-200"
                      style={{ width: `${Math.max(6, msg.uploadProgress)}%` }}
                    />
                  </div>
                </div>
              )}

              {msg.uploadError && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px]">
                  <span className="text-destructive">{msg.uploadError}</span>
                  <button
                    type="button"
                    onClick={() => void retryMediaMessage(msg.conversationId, msg.id)}
                    className="shrink-0 rounded-full border border-destructive/30 px-2.5 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    Retry
                  </button>
                </div>
              )}
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
            seenLabel={readReceiptLabel || undefined}
            seenTitle={readReceiptTitle || undefined}
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
  if (message.type === "poll" && message.poll) return message.poll.question;
  if (message.type === "location") return "";
  if (message.type === "contact") return "";
  if (message.type === "sticker") return "";
  if (message.decryptedContent) return message.decryptedContent;
  if (message.type !== "text" && message.mediaUrl) return "";
  if (message.encryptedContent) return "Encrypted message unavailable on this device";
  return "";
}

function parseLocationAttachment(message: Message): LocationAttachment | null {
  if (message.type !== "location" || !message.decryptedContent) {
    return null;
  }

  try {
    const parsed = JSON.parse(message.decryptedContent) as LocationAttachment;
    if (typeof parsed.latitude !== "number" || typeof parsed.longitude !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseContactAttachment(message: Message): ContactAttachment | null {
  if (message.type !== "contact" || !message.decryptedContent) {
    return null;
  }

  try {
    const parsed = JSON.parse(message.decryptedContent) as ContactAttachment;
    if (!parsed.name) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildMapLink(location: LocationAttachment) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(String(location.latitude))}&mlon=${encodeURIComponent(String(location.longitude))}#map=16/${encodeURIComponent(String(location.latitude))}/${encodeURIComponent(String(location.longitude))}`;
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
  if (message.type === "location") return "Shared location";
  if (message.type === "contact") return "Shared contact";
  if (message.type === "sticker") return `${message.sticker?.emoji ?? "🙂"} Sticker`;
  return message.decryptedContent || message.mediaName || getMessageText(message) || "Reply";
}

function buildContactClipboardText(contact: ContactAttachment) {
  return [contact.name, contact.phone, contact.email].filter(Boolean).join("\n");
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

function getReadReceiptLabel(message: Message, conversationType: "direct" | "group" | "channel" | "saved" | undefined, readers: ReturnType<typeof getReadersForMessage>) {
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
