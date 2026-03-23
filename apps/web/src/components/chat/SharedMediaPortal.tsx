"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import type { Message } from "@deco/types";

interface Props {
  open: boolean;
  title: string;
  messages: Message[];
  onClose: () => void;
}

type SharedTab = "media" | "files";

export function SharedMediaPortal({ open, title, messages, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<SharedTab>("media");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setTab("media");
    }
  }, [open]);

  const mediaMessages = useMemo(
    () =>
      messages
        .filter((message) =>
          !message.isDeleted &&
          Boolean(message.mediaUrl) &&
          (message.type === "image" || message.type === "video" || message.type === "audio")
        )
        .slice()
        .reverse(),
    [messages]
  );

  const fileMessages = useMemo(
    () =>
      messages
        .filter((message) => !message.isDeleted && Boolean(message.mediaUrl) && message.type === "file")
        .slice()
        .reverse(),
    [messages]
  );

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="relative z-10 flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-sidebar bg-surface shadow-2xl sm:max-h-[88dvh] sm:rounded-3xl"
            initial={{ y: 32, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center pb-1 pt-3 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-sidebar px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold">Shared media</h3>
                <p className="truncate text-xs text-muted">{title}</p>
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Close shared media">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="border-b border-sidebar px-5 py-3">
              <div className="inline-flex rounded-2xl border border-sidebar bg-background/40 p-1">
                <TabButton active={tab === "media"} onClick={() => setTab("media")}>
                  Media
                </TabButton>
                <TabButton active={tab === "files"} onClick={() => setTab("files")}>
                  Files
                </TabButton>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {tab === "media" ? (
                mediaMessages.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {mediaMessages.map((message) => (
                      <MediaCard key={message.id} message={message} />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No shared media yet"
                    description="Photos, videos, and audio messages from this chat will appear here."
                  />
                )
              ) : fileMessages.length > 0 ? (
                <div className="space-y-3">
                  {fileMessages.map((message) => (
                    <FileRow key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No shared files yet"
                  description="Documents and other files from this chat will appear here."
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function MediaCard({ message }: { message: Message }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-sidebar bg-background/40">
      {message.type === "image" && message.mediaUrl && (
        <a href={message.mediaUrl} target="_blank" rel="noreferrer" className="block">
          <img src={message.mediaUrl} alt={message.mediaName || "Shared image"} className="h-56 w-full object-cover" />
        </a>
      )}

      {message.type === "video" && message.mediaUrl && (
        <video src={message.mediaUrl} controls className="h-56 w-full bg-black object-cover" preload="metadata" />
      )}

      {message.type === "audio" && message.mediaUrl && (
        <div className="flex h-56 flex-col justify-between bg-gradient-to-br from-surface to-background p-4">
          <div>
            <p className="text-sm font-semibold">{message.mediaName || "Audio message"}</p>
            <p className="mt-1 text-xs text-muted">{formatMeta(message)}</p>
          </div>
          <audio src={message.mediaUrl} controls className="w-full" preload="metadata" />
        </div>
      )}

      <div className="space-y-2 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{message.mediaName || getMediaLabel(message)}</p>
          <p className="truncate text-xs text-muted">{formatMeta(message)}</p>
        </div>
        <div className="flex items-center gap-2">
          {message.mediaUrl && (
            <>
              <a
                href={message.mediaUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Open
              </a>
              <a
                href={message.mediaUrl}
                download={message.mediaName || getMediaLabel(message)}
                className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                Download
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FileRow({ message }: { message: Message }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sidebar bg-background/40 px-4 py-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-muted">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5A2.25 2.25 0 0 0 19.5 19.5v-5.25Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 2.25v4.5A1.5 1.5 0 0 0 15 8.25h4.5" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{message.mediaName || "File attachment"}</p>
        <p className="truncate text-xs text-muted">{formatMeta(message)}</p>
      </div>
      {message.mediaUrl && (
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={message.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Open
          </a>
          <a
            href={message.mediaUrl}
            download={message.mediaName || "attachment"}
            className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Download
          </a>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-3xl border border-dashed border-sidebar bg-background/30 px-6 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted">{description}</p>
    </div>
  );
}

function formatMeta(message: Message) {
  const parts: string[] = [];
  if (message.mediaSize) {
    parts.push(formatBytes(message.mediaSize));
  }
  if (message.sentAt) {
    try {
      parts.push(formatDistanceToNowStrict(new Date(message.sentAt), { addSuffix: true }));
    } catch {
      // ignore invalid dates
    }
  }
  return parts.join(" · ");
}

function formatBytes(value?: number) {
  if (!value || value <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function getMediaLabel(message: Message) {
  switch (message.type) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default:
      return "Attachment";
  }
}
