"use client";

import { Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";
import { SearchPanel } from "@/components/layout/SearchPanel";
import { SettingsSidebar } from "@/components/layout/SettingsSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { NoiseOverlay } from "@/components/ui/NoiseOverlay";
import { KeyboardShortcutsOverlay } from "@/components/ui/KeyboardShortcutsOverlay";
import { KeyBackupGate } from "@/components/auth/KeyBackupGate";

const AuthBackground = dynamic(
  () => import("@/components/auth/AuthBackground").then((module) => module.AuthBackground),
  { ssr: false }
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isInboxRoute = pathname.startsWith("/inbox");
  const isInboxRoot = pathname === "/inbox";
  const hasActiveConversation = isInboxRoute && !isInboxRoot;
  const isSearchPage = pathname === "/search";
  const isSettingsPage = pathname === "/settings";
  const showSidebarMobile = isSearchPage || (isInboxRoute && !hasActiveConversation);
  const showMainMobile = hasActiveConversation || (!isInboxRoute && !isSearchPage);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem("deco_sidebar_collapsed");
    if (stored) {
      setSidebarCollapsed(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("deco_sidebar_collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  return (
    <div className="relative flex h-app overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <AuthBackground />
      </div>

      <div className="hidden md:relative md:block md:shrink-0">
        <Suspense>
          <NavRail
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          />
        </Suspense>
        <NoiseOverlay />
      </div>

      <aside
        className={`
          relative flex-col bg-sidebar border-r border-sidebar transition-[width] duration-200
          ${showSidebarMobile ? "flex w-full" : "hidden"}
          ${sidebarCollapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : "md:w-[300px] md:shrink-0"}
          md:flex
        `}
      >
        <NoiseOverlay />
        <Suspense>
          {isSearchPage ? <SearchPanel /> : isSettingsPage ? <SettingsSidebar /> : <ConversationList />}
        </Suspense>
      </aside>

      <main
        className={`
          flex-col min-w-0 bg-surface overflow-hidden
          ${showMainMobile ? "flex flex-1" : "hidden"} md:flex md:flex-1
        `}
      >
        <AnimatePresence initial={false}>
          <motion.div
            key={pathname}
            className="flex h-full flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <Suspense>
        <MobileNav />
      </Suspense>

      <KeyboardShortcutsOverlay />
      <KeyBackupGate />
    </div>
  );
}
