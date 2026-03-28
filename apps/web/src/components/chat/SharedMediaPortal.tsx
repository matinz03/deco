"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNowStrict, format, isToday, isYesterday } from "date-fns";
import type { ContactAttachment, LocationAttachment, Message } from "@deco/types";

interface Props {
  open: boolean;
  title: string;
  messages: Message[];
  onClose: () => void;
}

type SharedTab = "media" | "files" | "places" | "contacts";

export function SharedMediaPortal({ open, title, messages, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<SharedTab>("media");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setTab("media");
      setQuery("");
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

  const locationMessages = useMemo(
    () =>
      messages
        .filter((message) => !message.isDeleted && message.type === "location" && parseLocationAttachment(message))
        .slice()
        .reverse(),
    [messages]
  );

  const contactMessages = useMemo(
    () =>
      messages
        .filter((message) => !message.isDeleted && message.type === "contact" && parseContactAttachment(message))
        .slice()
        .reverse(),
    [messages]
  );

  const normalizedQuery = deferredQuery.trim().toLowerCase();

  const filteredMediaMessages = useMemo(
    () =>
      filterByQuery(mediaMessages, normalizedQuery, (message) => [
        message.mediaName,
        message.decryptedContent,
        getMediaLabel(message),
      ]),
    [mediaMessages, normalizedQuery]
  );

  const filteredFileMessages = useMemo(
    () =>
      filterByQuery(fileMessages, normalizedQuery, (message) => [
        message.mediaName,
        message.decryptedContent,
        message.mediaMimeType,
        "file",
      ]),
    [fileMessages, normalizedQuery]
  );

  const filteredLocationMessages = useMemo(
    () =>
      filterByQuery(locationMessages, normalizedQuery, (message) => {
        const location = parseLocationAttachment(message);
        return [
          location?.label,
          location ? `${location.latitude},${location.longitude}` : undefined,
          message.decryptedContent,
          "location",
        ];
      }),
    [locationMessages, normalizedQuery]
  );

  const filteredContactMessages = useMemo(
    () =>
      filterByQuery(contactMessages, normalizedQuery, (message) => {
        const contact = parseContactAttachment(message);
        return [
          contact?.name,
          contact?.phone,
          contact?.email,
          message.decryptedContent,
          "contact",
        ];
      }),
    [contactMessages, normalizedQuery]
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
                <TabButton active={tab === "places"} onClick={() => setTab("places")}>
                  Places
                </TabButton>
                <TabButton active={tab === "contacts"} onClick={() => setTab("contacts")}>
                  Contacts
                </TabButton>
              </div>
              <div className="mt-3">
                <div className="flex items-center gap-2 rounded-2xl border border-sidebar bg-background/40 px-3 py-2">
                  <svg className="h-4 w-4 shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m0 0A7.65 7.65 0 1 0 5.85 5.85a7.65 7.65 0 0 0 10.8 10.8Z" />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={getSearchPlaceholder(tab)}
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
                  />
                  {query && (
                    <button
                      type="button"
                      className="rounded-lg p-1 text-muted transition-colors hover:text-foreground"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {tab === "media" ? (
                filteredMediaMessages.length > 0 ? (
                  <div className="space-y-5">
                    {groupMessagesByDay(filteredMediaMessages).map(([label, dayMessages]) => (
                      <section key={label} className="space-y-3">
                        <SectionLabel label={label} />
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {dayMessages.map((message) => (
                            <MediaCard key={message.id} message={message} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={normalizedQuery ? "No media matches" : "No shared media yet"}
                    description={
                      normalizedQuery
                        ? "Try a file name, caption, or media type keyword."
                        : "Photos, videos, and audio messages from this chat will appear here."
                    }
                  />
                )
              ) : tab === "files" ? (
                filteredFileMessages.length > 0 ? (
                  <div className="space-y-5">
                    {groupMessagesByDay(filteredFileMessages).map(([label, dayMessages]) => (
                      <section key={label} className="space-y-3">
                        <SectionLabel label={label} />
                        <div className="space-y-3">
                          {dayMessages.map((message) => (
                            <FileRow key={message.id} message={message} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={normalizedQuery ? "No files match" : "No shared files yet"}
                    description={
                      normalizedQuery
                        ? "Try a file name, type, or note from the message."
                        : "Documents and other files from this chat will appear here."
                    }
                  />
                )
              ) : tab === "places" ? (
                filteredLocationMessages.length > 0 ? (
                  <div className="space-y-5">
                    {groupMessagesByDay(filteredLocationMessages).map(([label, dayMessages]) => (
                      <section key={label} className="space-y-3">
                        <SectionLabel label={label} />
                        <div className="space-y-3">
                          {dayMessages.map((message) => (
                            <LocationRow key={message.id} message={message} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={normalizedQuery ? "No places match" : "No shared locations yet"}
                    description={
                      normalizedQuery
                        ? "Try a place name or coordinate."
                        : "Locations shared in this chat will show up here."
                    }
                  />
                )
              ) : (
                filteredContactMessages.length > 0 ? (
                  <div className="space-y-5">
                    {groupMessagesByDay(filteredContactMessages).map(([label, dayMessages]) => (
                      <section key={label} className="space-y-3">
                        <SectionLabel label={label} />
                        <div className="space-y-3">
                          {dayMessages.map((message) => (
                            <ContactRow key={message.id} message={message} />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={normalizedQuery ? "No contacts match" : "No shared contacts yet"}
                    description={
                      normalizedQuery
                        ? "Try a name, phone number, or email address."
                        : "Contact cards from this chat will show up here."
                    }
                  />
                )
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

function LocationRow({ message }: { message: Message }) {
  const location = parseLocationAttachment(message);
  if (!location) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sidebar bg-background/40 px-4 py-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-primary">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.75-5.625-6.75-11.25a6.75 6.75 0 1 1 13.5 0C18.75 15.375 12 21 12 21Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{location.label || "Shared location"}</p>
        <p className="truncate text-xs text-muted">
          {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · {formatDistanceToNowStrict(new Date(message.sentAt), { addSuffix: true })}
        </p>
      </div>
      <a
        href={buildMapLink(location)}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
      >
        Open
      </a>
      <button
        type="button"
        className="shrink-0 rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        onClick={() => void navigator.clipboard.writeText(`${location.latitude}, ${location.longitude}`)}
      >
        Copy coords
      </button>
    </div>
  );
}

function ContactRow({ message }: { message: Message }) {
  const contact = parseContactAttachment(message);
  if (!contact) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-sidebar bg-background/40 px-4 py-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-muted">
        <span className="text-sm font-semibold">{getInitials(contact.name)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{contact.name}</p>
        <p className="truncate text-xs text-muted">
          {[contact.phone, contact.email].filter(Boolean).join(" · ") || "Shared contact"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Call
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          >
            Email
          </a>
        )}
        <button
          type="button"
          className="rounded-xl border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
          onClick={() => void navigator.clipboard.writeText(buildContactClipboardText(contact))}
        >
          Copy
        </button>
      </div>
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

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border/60" />
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{label}</span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

function groupMessagesByDay(messages: Message[]) {
  const groups = new Map<string, Message[]>();
  for (const message of messages) {
    const label = formatDayLabel(message.sentAt);
    const bucket = groups.get(label);
    if (bucket) {
      bucket.push(message);
    } else {
      groups.set(label, [message]);
    }
  }
  return Array.from(groups.entries());
}

function formatDayLabel(value: string) {
  const date = new Date(value);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
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

function filterByQuery<T>(
  items: T[],
  query: string,
  getFields: (item: T) => Array<string | undefined | null>
) {
  if (!query) return items;
  return items.filter((item) =>
    getFields(item)
      .filter((field): field is string => Boolean(field))
      .some((field) => field.toLowerCase().includes(query))
  );
}

function getSearchPlaceholder(tab: SharedTab) {
  switch (tab) {
    case "media":
      return "Search media...";
    case "files":
      return "Search files...";
    case "places":
      return "Search places...";
    case "contacts":
      return "Search contacts...";
    default:
      return "Search shared items...";
  }
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

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function buildContactClipboardText(contact: ContactAttachment) {
  return [contact.name, contact.phone, contact.email].filter(Boolean).join("\n");
}
