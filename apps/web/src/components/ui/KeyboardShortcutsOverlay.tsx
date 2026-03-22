"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const SHORTCUTS = [
  { keys: ["Enter"], description: "Send message" },
  { keys: ["Shift", "Enter"], description: "New line" },
  { keys: ["Esc"], description: "Close modal / cancel" },
  { keys: ["?"], description: "Show keyboard shortcuts" },
];

function Key({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[11px] font-mono font-medium bg-muted border border-border shadow-sm min-w-[28px]">
      {label}
    </kbd>
  );
}

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";
      if (e.key === "?" && !isInput) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="kbd-backdrop"
            className="fixed inset-0 z-40 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="kbd-panel"
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-5"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-sm">Keyboard shortcuts</h2>
              <button
                onClick={() => setOpen(false)}
                className="icon-btn p-1"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ul className="flex flex-col gap-3">
              {SHORTCUTS.map(({ keys, description }) => (
                <li key={description} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-muted">{description}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {keys.map((k, i) => (
                      <span key={k} className="flex items-center gap-1">
                        <Key label={k} />
                        {i < keys.length - 1 && <span className="text-xs text-muted">+</span>}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted mt-4">Press <Key label="?" /> to toggle this panel</p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
