"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";
import { NoiseOverlay } from "@/components/ui/NoiseOverlay";
import { KeyboardShortcutsOverlay } from "@/components/ui/KeyboardShortcutsOverlay";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-app flex overflow-hidden bg-background">
      {/* Panel 1 — Nav rail */}
      <div className="relative shrink-0">
        <NavRail />
        <NoiseOverlay />
      </div>

      {/* Panel 2 — Conversation list */}
      <aside className="w-[300px] shrink-0 flex flex-col bg-sidebar border-r border-sidebar relative">
        <NoiseOverlay />
        <ConversationList />
      </aside>

      {/* Panel 3 — Chat window */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            className="flex-1 flex flex-col h-full"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Global keyboard shortcuts overlay — triggered by '?' key */}
      <KeyboardShortcutsOverlay />
    </div>
  );
}
