"use client";

import { Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";
import { MobileNav } from "@/components/layout/MobileNav";
import { NoiseOverlay } from "@/components/ui/NoiseOverlay";
import { KeyboardShortcutsOverlay } from "@/components/ui/KeyboardShortcutsOverlay";
import { KeyBackupGate } from "@/components/auth/KeyBackupGate";
import { registerPush } from "@/lib/push";

const AuthBackground = dynamic(
  () => import("@/components/auth/AuthBackground").then((m) => m.AuthBackground),
  { ssr: false }
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    void registerPush();
  }, []);
  // Only show the ConversationList as the full-width panel on /inbox root (mobile)
  const isInboxRoot = pathname === "/inbox";
  // Hide ConversationList sidebar on mobile for any non-inbox route
  const showSidebarMobile = isInboxRoot;
  // Show main panel on mobile for everything except inbox root
  const showMainMobile = !isInboxRoot;

  return (
    <div className="h-app flex overflow-hidden bg-background relative">
      <div className="absolute inset-0 pointer-events-none opacity-40">
        <AuthBackground />
      </div>
      {/* Panel 1 — Nav rail: hidden on mobile, visible md+ */}
      <div className="hidden md:relative md:block md:shrink-0">
        <Suspense>
          <NavRail />
        </Suspense>
        <NoiseOverlay />
      </div>

      {/* Panel 2 — Conversation list:
          mobile: full-width only on /inbox root
          tablet+: always visible at fixed width */}
      <aside
        className={`
          flex-col bg-sidebar border-r border-sidebar relative
          ${showSidebarMobile ? "flex w-full" : "hidden"} md:flex md:w-[300px] md:shrink-0
        `}
      >
        <NoiseOverlay />
        <Suspense>
          <ConversationList />
        </Suspense>
      </aside>

      {/* Panel 3 — Main content:
          mobile: shown for all routes except /inbox root
          tablet+: always visible, takes remaining space */}
      <main
        className={`
          flex-col min-w-0 bg-surface overflow-hidden
          ${showMainMobile ? "flex flex-1" : "hidden"} md:flex md:flex-1
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
      <Suspense>
        <MobileNav />
      </Suspense>

      {/* Global keyboard shortcuts overlay */}
      <KeyboardShortcutsOverlay />

      {/* Passphrase setup / restore gate */}
      <KeyBackupGate />
    </div>
  );
}
