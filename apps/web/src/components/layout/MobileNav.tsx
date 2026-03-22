"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { useConversationStore } from "@/store/conversations";

const NAV_ITEMS = [
  {
    href: "/inbox",
    label: "Messages",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
  },
  {
    href: "/inbox?tab=groups",
    label: "Groups",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const conversations = useConversationStore((s) => s.conversations);
  const hasUnreadMessages = conversations.some((conversation) => conversation.type !== "group" && conversation.unreadCount > 0);
  const hasUnreadGroups = conversations.some((conversation) => conversation.type === "group" && conversation.unreadCount > 0);
  const isInConversation = /^\/inbox\/.+/.test(pathname);

  if (isInConversation) return null;

  return (
    <nav className="mobile-nav">
      <div className="mobile-nav-items">
        {NAV_ITEMS.map((item) => {
          const hrefPath = item.href.split("?")[0]!;
          const hrefTab = new URLSearchParams(item.href.split("?")[1] ?? "").get("tab");
          const currentTab = searchParams.get("tab");
          const isActive = hrefTab
            ? pathname.startsWith(hrefPath) && currentTab === hrefTab
            : pathname.startsWith(hrefPath) && currentTab !== "groups";

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className="mobile-nav-item"
            >
              <motion.span
                whileTap={{ scale: 0.88 }}
                transition={{ type: "spring", stiffness: 500, damping: 28 }}
                className={`mobile-nav-icon relative ${isActive ? "text-foreground" : "text-muted"}`}
              >
                {item.icon}
                {item.label === "Messages" && hasUnreadMessages && (
                  <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-nav bg-primary" />
                )}
                {item.label === "Groups" && hasUnreadGroups && (
                  <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full border-2 border-nav bg-primary" />
                )}
                <span className="mobile-nav-label">{item.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="mobile-indicator"
                    className="absolute bottom-1 h-1 w-1 rounded-full bg-primary"
                  />
                )}
              </motion.span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
