"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { OnlineDot } from "@/components/ui/OnlineDot";
import { NewConversationModal } from "@/components/ui/NewConversationModal";
import { ConversationSkeleton } from "@/components/layout/ConversationSkeleton";
import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation } from "@deco/types";

export function ConversationList() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "messages";
  const isGroupsTab = tab === "groups";

  const { conversations, fetchConversations, presence } = useConversationStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchConversations().finally(() => setLoading(false));
  }, [fetchConversations]);

  const filtered = conversations
    .filter((c) => (isGroupsTab ? c.type !== "direct" : c.type === "direct"))
    .filter((c) =>
      (c.name || "Unknown conversation").toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="flex flex-col h-full">
      <div className="sidebar-header">
        <h2 className="sidebar-title">{isGroupsTab ? "Groups" : "Messages"}</h2>
        <button
          className="icon-btn"
          title={isGroupsTab ? "New group" : "New conversation"}
          aria-label={isGroupsTab ? "New group" : "New conversation"}
          onClick={() => setModalOpen(true)}
        >
          {isGroupsTab ? (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
          ) : (
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          )}
        </button>
      </div>

      <NewConversationModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="sidebar-search-wrap">
        <div className="sidebar-search">
          <svg className="sidebar-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            placeholder={isGroupsTab ? "Search groups..." : "Search conversations..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sidebar-search-input"
          />
        </div>
      </div>

      <div className="sidebar-list">
        {loading ? (
          <ConversationSkeleton />
        ) : filtered.length === 0 ? (
          <div className="sidebar-empty">
            {isGroupsTab ? (
              <>
                <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-1">
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium">No groups yet</p>
                <p className="text-xs text-muted mt-0.5">Create one with the + button.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">No conversations yet.</p>
                <p className="text-xs text-muted">Start a new one with the + button.</p>
              </>
            )}
          </div>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {filtered.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                isActive={pathname === `/inbox/${conversation.id}`}
                isOnline={Boolean(
                  conversation.type === "direct" &&
                  conversation.members?.some(
                    (member) => member.userId !== currentUserId && presence[member.userId]?.status === "online"
                  )
                )}
              />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

function ConversationItem({
  conversation,
  isActive,
  isOnline,
}: {
  conversation: Conversation;
  isActive: boolean;
  isOnline: boolean;
}) {
  const title = conversation.name || "Unknown conversation";
  const lastMessageText = getConversationPreview(conversation);
  const timeStr = conversation.updatedAt
    ? formatDistanceToNowStrict(new Date(conversation.updatedAt), { addSuffix: false })
    : "";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ type: "spring", stiffness: 350, damping: 30 }}
    >
      <Link
        href={`/inbox/${conversation.id}`}
        className={`conv-item ${isActive ? "conv-item--active" : ""}`}
      >
        <div className="conv-avatar-wrap">
          <Avatar src={conversation.avatarUrl} name={title} size="md" />
          {conversation.type === "direct" && (
            <OnlineDot isOnline={isOnline} borderClass="border-sidebar" />
          )}
        </div>

        <div className="conv-meta">
          <div className="conv-row">
            <span className="conv-name">{title}</span>
            <span className="conv-time">{timeStr}</span>
          </div>
          <div className="conv-row mt-0.5">
            <p className="conv-preview">{lastMessageText}</p>
            {conversation.unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="unread-badge"
              >
                {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
              </motion.span>
            )}
          </div>
        </div>
      </Link>
    </motion.li>
  );
}

function getConversationPreview(conversation: Conversation) {
  if (!conversation.lastMessage) return "...";
  if (conversation.lastMessage.isDeleted) return "Message deleted";
  if (conversation.lastMessage.decryptedContent) return conversation.lastMessage.decryptedContent;
  if (conversation.lastMessage.type !== "text") return "Media message";
  return "Encrypted message";
}
