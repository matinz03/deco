"use client";

import { AnimatePresence, motion } from "framer-motion";

interface TypingIndicatorProps {
  isTyping: boolean;
  name?: string;
}

const dotVariants = {
  bounce: (i: number) => ({
    y: [0, -5, 0],
    transition: {
      repeat: Infinity,
      duration: 0.8,
      delay: i * 0.15,
      ease: "easeInOut" as const,
    },
  }),
};

export function TypingIndicator({ isTyping, name }: TypingIndicatorProps) {
  return (
    <AnimatePresence>
      {isTyping && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="flex items-center gap-2 px-4 pb-1"
        >
          <div className="bubble-received px-3 py-2.5 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                custom={i}
                variants={dotVariants}
                animate="bounce"
                className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 block"
              />
            ))}
          </div>
          {name && (
            <span className="text-[11px] text-muted">{name} is typing…</span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
