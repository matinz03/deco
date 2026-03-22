"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const QUICK_REACTIONS = ["👍", "❤️", "🔥", "🥰", "👏", "😂", "🤔", "🤯"];

const ALL_REACTIONS = [
  "👍", "❤️", "🔥", "🥰", "👏", "😂", "🤔", "🤯",
  "😱", "🎉", "🤩", "😢", "💔", "🙏", "👻", "🤡",
  "🥱", "🥴", "😍", "🐳", "💯", "🤣", "⚡", "🏆",
  "😡", "🤮", "💩", "🌚", "😈", "🤓", "👀", "🎃",
];

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function ReactionPicker({ onSelect, onClose }: ReactionPickerProps) {
  const [expanded, setExpanded] = useState(false);

  const reactions = expanded ? ALL_REACTIONS : QUICK_REACTIONS;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 4 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="bg-surface border border-border rounded-2xl shadow-xl p-1.5 z-50"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={expanded ? "expanded" : "quick"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
          className={expanded ? "grid grid-cols-8 gap-0.5 max-h-36 overflow-y-auto" : "flex gap-0.5"}
        >
          {reactions.map((emoji) => (
            <button
              key={emoji}
              onClick={() => { onSelect(emoji); onClose(); }}
              className="w-8 h-8 text-lg rounded-xl hover:bg-accent transition-colors flex items-center justify-center active:scale-90 shrink-0"
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* Expand / collapse toggle */}
      <div className="flex justify-end mt-1 pt-1 border-t border-border/50">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-accent transition-colors"
          aria-label={expanded ? "Show less" : "Show more reactions"}
        >
          {expanded ? (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
              Less
            </>
          ) : (
            <>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
              More
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
