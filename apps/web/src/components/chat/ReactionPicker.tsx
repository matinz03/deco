"use client";

import { motion } from "framer-motion";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥"];

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function ReactionPicker({ onSelect, onClose }: ReactionPickerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, y: 4 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      className="absolute bottom-full mb-2 bg-surface border border-border rounded-2xl shadow-xl p-1.5 flex gap-0.5 z-50"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="w-8 h-8 text-lg rounded-xl hover:bg-accent transition-colors flex items-center justify-center active:scale-90"
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </motion.div>
  );
}
