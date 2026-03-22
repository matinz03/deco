"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { NewConversationModal } from "@/components/ui/NewConversationModal";
import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation } from "@deco/types";

export function ConversationList() {
  const pathname = usePathname();
  const { conversations, fetchConversations, presence } = useConversationStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const filtered = conversations.filter((conversation) =>
    (conversation.name || "Unknown conversation").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <h2 className="font-semibold text-base">Messages</h2>
        <button className="icon-btn" title="New conversation" onClick={() => setModalOpen(true)}>
          <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <NewConversationModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="px-3 pb-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="search"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-muted border-0 focus:outline-none focus:ring-1 focus:ring-ring/30 placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto chat-scroll">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
            <p className="text-sm text-muted">No conversations yet.</p>
            <p className="text-xs text-muted">Start a new one with the + button.</p>
          </div>
        ) : (
          <ul>
            {filtered.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={pathname === `/inbox/${conversation.id}`}
                isOnline={Boolean(
                  conversation.type === "direct" &&
                  conversation.members?.some(
                    (member) => member.userId !== currentUserId && presence[member.userId] === "online"
                  )
                )}
              />
            ))}
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
    <li>
      <Link
        href={`/inbox/${conversation.id}`}
        className={`flex items-center gap-3 px-3 py-3 mx-2 rounded-xl transition-all ${
          isActive ? "bg-accent" : "hover:bg-accent/50"
        }`}
      >
        <div className="relative shrink-0">
          <Avatar src={conversation.avatarUrl} name={title} size="md" />
          {conversation.type === "direct" && (
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-sidebar ${
                isOnline ? "bg-green-500" : "bg-muted-foreground/30"
              }`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate">{title}</span>
            <span className="text-[11px] text-muted shrink-0">{timeStr}</span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <p className="text-xs text-muted truncate">{lastMessageText}</p>
            {conversation.unreadCount > 0 && (
              <span className="shrink-0 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center px-1">
                {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function getConversationPreview(conversation: Conversation) {
  if (!conversation.lastMessage) {
    return "...";
  }

  if (conversation.lastMessage.isDeleted) {
    return "Message deleted";
  }

  if (conversation.lastMessage.decryptedContent) {
    return conversation.lastMessage.decryptedContent;
  }

  if (conversation.lastMessage.type !== "text") {
    return "Media message";
  }

  return "Encrypted message";
}
