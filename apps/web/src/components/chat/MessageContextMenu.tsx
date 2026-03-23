"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";

interface MessageContextMenuProps {
  x: number;
  y: number;
  isSent: boolean;
  text: string;
  seenLabel?: string;
  seenTitle?: string;
  onEdit?: () => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors text-left
        ${destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-accent text-foreground"
        }`}
    >
      <span className="w-4 h-4 shrink-0">{icon}</span>
      {label}
    </button>
  );
}

export function MessageContextMenu({
  x, y, isSent, text, seenLabel, seenTitle, onEdit, onReply, onCopy, onDelete, onClose,
}: MessageContextMenuProps) {
  // Clamp to viewport
  const clampedX = Math.min(x, window.innerWidth - 176);
  const clampedY = Math.min(y, window.innerHeight - 160);

  useEffect(() => {
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [onClose]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="fixed z-[200] bg-surface border border-border rounded-xl shadow-2xl p-1 min-w-[160px]"
      style={{ top: clampedY, left: clampedX }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem
        icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
          </svg>
        }
        label="Reply"
        onClick={() => { onReply(); onClose(); }}
      />
      <MenuItem
        icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
        }
        label="Copy text"
        onClick={() => { void navigator.clipboard.writeText(text); onClose(); }}
      />
      {isSent && onEdit && (
        <MenuItem
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
            </svg>
          }
          label="Edit"
          onClick={() => { onEdit(); onClose(); }}
        />
      )}
      {isSent && onDelete && (
        <MenuItem
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          }
          label="Delete"
          onClick={() => { onDelete(); onClose(); }}
          destructive
        />
      )}
      {isSent && seenLabel && (
        <div
          className="flex items-center gap-2.5 px-3 py-2 mt-0.5 border-t border-border"
          title={seenTitle}
        >
          <span className="w-4 h-4 shrink-0 text-muted">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </span>
          <span className="text-xs text-muted">{seenLabel}</span>
        </div>
      )}
    </motion.div>,
    document.body
  );
}
