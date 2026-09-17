"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";
import { SearchPanel } from "@/components/layout/SearchPanel";
import { SettingsSidebar } from "@/components/layout/SettingsSidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { NoiseOverlay } from "@/components/ui/NoiseOverlay";
import { KeyboardShortcutsOverlay } from "@/components/ui/KeyboardShortcutsOverlay";
import { ChatToastContainer } from "@/components/ui/ChatToast";

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
          relative flex-col glass-sidebar border-r border-sidebar transition-[width] duration-200
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
          relative min-w-0 overflow-hidden glass-shell
          ${showMainMobile ? "flex flex-1" : "hidden"} md:flex md:flex-1
        `}
      >
        <div className="absolute inset-0 flex flex-col">{children}</div>
      </main>

      <Suspense>
        <MobileNav />
      </Suspense>

      <KeyboardShortcutsOverlay />
      <ChatToastContainer />
    </div>
  );
}
