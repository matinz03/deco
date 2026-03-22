"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";
import { MobileNav } from "@/components/layout/MobileNav";
import { NoiseOverlay } from "@/components/ui/NoiseOverlay";
import { KeyboardShortcutsOverlay } from "@/components/ui/KeyboardShortcutsOverlay";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Detect when user is inside a specific conversation
  const isInConversation = /^\/inbox\/.+/.test(pathname);

  return (
    <div className="h-app flex overflow-hidden bg-background">
      {/* Panel 1 — Nav rail: hidden on mobile, visible md+ */}
      <div className="hidden md:relative md:block md:shrink-0">
        <NavRail />
        <NoiseOverlay />
      </div>

      {/* Panel 2 — Conversation list:
          mobile: full-width when NOT in a conversation
          tablet+: always visible at fixed width */}
      <aside
        className={`
          flex flex-col bg-sidebar border-r border-sidebar relative
          ${isInConversation ? "hidden md:flex md:w-[300px] md:shrink-0" : "flex w-full md:w-[300px] md:shrink-0"}
        `}
      >
        <NoiseOverlay />
        <ConversationList />
      </aside>

      {/* Panel 3 — Chat window:
          mobile: full-width when IN a conversation, hidden otherwise
          tablet+: always visible, takes remaining space */}
      <main
        className={`
          flex-col min-w-0 bg-surface overflow-hidden
          ${isInConversation ? "flex flex-1" : "hidden md:flex md:flex-1"}
        `}
      >
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

      {/* Mobile bottom tab bar — hidden inside conversations */}
      <MobileNav />

      {/* Global keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay />
    </div>
  );
}
