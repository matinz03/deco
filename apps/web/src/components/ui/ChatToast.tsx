"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { useToastStore, type ToastItem } from "@/store/toasts";

const AUTO_DISMISS_MS = 4000;

function Toast({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismissToast);
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  const senderName =
    toast.message.sender?.displayName ||
    toast.message.sender?.username ||
    "Unknown";

  const preview = toast.message.isDeleted
    ? "Message deleted"
    : toast.message.decryptedContent ?? "New message";
  const truncatedPreview = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;

  const conversationName = toast.conversation?.name || senderName;
  const isGroup = toast.conversation?.type !== "direct" && toast.conversation?.type !== "saved";

  function handleClick() {
    dismiss(toast.id);
    router.push(`/inbox/${toast.message.conversationId}`);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.88 }}
      transition={{ type: "spring", stiffness: 380, damping: 28 }}
      className="flex w-80 cursor-pointer items-start gap-3 rounded-2xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClick(); }}
    >
      <Avatar
        src={toast.message.sender?.avatarUrl ?? toast.conversation?.avatarUrl}
        name={senderName}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{conversationName}</p>
        {isGroup && (
          <p className="truncate text-xs text-muted">{senderName}</p>
        )}
        <p className="mt-0.5 truncate text-sm text-muted">{truncatedPreview}</p>
      </div>
      <button
        type="button"
        className="shrink-0 text-muted hover:text-foreground transition-colors"
        aria-label="Dismiss"
        onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}

export function ChatToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[200] flex flex-col items-end gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
