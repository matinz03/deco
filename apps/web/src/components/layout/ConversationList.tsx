"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { OnlineDot } from "@/components/ui/OnlineDot";
import { NewConversationModal } from "@/components/ui/NewConversationModal";
import { ConversationSkeleton } from "@/components/layout/ConversationSkeleton";
import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation } from "@deco/types";

const VIRTUALIZATION_THRESHOLD = 24;
const ROW_ESTIMATE = 88;

export function ConversationList() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "messages";
  const isGroupsTab = tab === "groups";

  const directionRef = useRef(0);
  const prevTabRef = useRef(tab);
  if (prevTabRef.current !== tab) {
    directionRef.current = tab === "groups" ? 1 : -1;
    prevTabRef.current = tab;
  }

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const { conversations, fetchConversations, presence } = useConversationStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchConversations().finally(() => setLoading(false));
  }, [fetchConversations]);

  const filtered = conversations
    .filter((c) => (isGroupsTab ? c.type === "group" || c.type === "channel" : c.type === "direct" || c.type === "saved"))
    .filter((c) =>
      (c.name || "Unknown conversation").toLowerCase().includes(search.toLowerCase())
    );

  return (
    <div className="flex flex-col h-full">
      <div className="sidebar-header">
        <h2 className="sidebar-title">{isGroupsTab ? "Groups" : "Messages"}</h2>
        {isGroupsTab ? (
          <button
            className="rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            title="Create group"
            aria-label="Create group"
            onClick={() => setModalOpen(true)}
          >
            Create group +
          </button>
        ) : (
          <button
            className="icon-btn"
            title="New conversation"
            aria-label="New conversation"
            onClick={() => setModalOpen(true)}
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        )}
      </div>

      <NewConversationModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialMode={isGroupsTab ? "group" : "direct"}
      />

      {/* Mobile compose FAB */}
      <button
        className="md:hidden fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95 transition-transform"
        aria-label="New conversation"
        onClick={() => setModalOpen(true)}
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </button>

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

      <div className="sidebar-list overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={directionRef.current}>
          <motion.div
            key={tab}
            custom={directionRef.current}
            variants={{
              enter: (dir: number) => ({
                opacity: 0,
                x: isMobile ? dir * 48 : 0,
                y: isMobile ? 0 : dir * 10,
              }),
              center: { opacity: 1, x: 0, y: 0 },
              exit: (dir: number) => ({
                opacity: 0,
                x: isMobile ? dir * -48 : 0,
                y: isMobile ? 0 : dir * -10,
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 500, damping: 38, mass: 0.6 }}
            className="h-full"
          >
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
                    <p className="text-xs text-muted mt-0.5">Create one with the button above.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted">No conversations yet.</p>
                    <p className="text-xs text-muted">Start a new one with the + button.</p>
                  </>
                )}
              </div>
            ) : (
              <ConversationItems
                conversations={filtered}
                pathname={pathname}
                currentUserId={currentUserId}
                presence={presence}
                isMobile={isMobile}
                isGroupsTab={isGroupsTab}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ConversationItems({
  conversations,
  pathname,
  currentUserId,
  presence,
  isMobile,
  isGroupsTab,
}: {
  conversations: Conversation[];
  pathname: string | null;
  currentUserId?: string;
  presence: Record<string, { status: string }>;
  isMobile: boolean;
  isGroupsTab: boolean;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = conversations.length >= VIRTUALIZATION_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? conversations.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
  });

  if (!shouldVirtualize) {
    return (
      <div ref={parentRef} className="h-full overflow-y-auto">
        <ul>
          {conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              pathname={pathname}
              currentUserId={currentUserId}
              presence={presence}
              isMobile={isMobile}
              isGroupsTab={isGroupsTab}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const conversation = conversations[virtualRow.index];
          if (!conversation) return null;
          return (
            <div
              key={conversation.id}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <ConversationRow
                conversation={conversation}
                pathname={pathname}
                currentUserId={currentUserId}
                presence={presence}
                isMobile={isMobile}
                isGroupsTab={isGroupsTab}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConversationRow({
  conversation,
  pathname,
  currentUserId,
  presence,
  isMobile,
  isGroupsTab,
}: {
  conversation: Conversation;
  pathname: string | null;
  currentUserId?: string;
  presence: Record<string, { status: string }>;
  isMobile: boolean;
  isGroupsTab: boolean;
}) {
  return (
    <ConversationItem
      conversation={conversation}
      href={
        isGroupsTab || conversation.type === "group" || conversation.type === "channel"
          ? `/inbox/${conversation.id}?tab=groups`
          : `/inbox/${conversation.id}`
      }
      isActive={pathname === `/inbox/${conversation.id}`}
      isOnline={Boolean(
        conversation.type === "direct" &&
        conversation.members?.some(
          (member) => member.userId !== currentUserId && presence[member.userId]?.status === "online"
        )
      )}
      isMobile={isMobile}
    />
  );
}

const ACTION_WIDTH = 130; // px revealed on swipe

function ConversationItem({
  conversation,
  isActive,
  isOnline,
  href,
  isMobile,
}: {
  conversation: Conversation;
  isActive: boolean;
  isOnline: boolean;
  href: string;
  isMobile: boolean;
}) {
  const { mutedIds, muteConversation, unmuteConversation, deleteConversation } = useConversationStore();
  const isMuted = mutedIds.has(conversation.id);
  const title = conversation.name || "Unknown conversation";
  const lastMessageText = getConversationPreview(conversation);
  const timeStr = conversation.updatedAt
    ? formatDistanceToNowStrict(new Date(conversation.updatedAt), { addSuffix: false })
    : "";

  const x = useMotionValue(0);
  const actionsOpacity = useTransform(x, [-ACTION_WIDTH, -ACTION_WIDTH / 2, 0], [1, 0.6, 0]);
  const [isOpen, setIsOpen] = useState(false);

  function snapOpen() {
    x.set(-ACTION_WIDTH);
    setIsOpen(true);
  }
  function snapClosed() {
    x.set(0);
    setIsOpen(false);
  }

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    if (offset < -ACTION_WIDTH / 2 || velocity < -200) {
      snapOpen();
    } else {
      snapClosed();
    }
  }

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 500, damping: 38 }} className="relative overflow-hidden">
      {/* Actions revealed behind the row */}
      <motion.div
        className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2"
        style={{ opacity: actionsOpacity }}
        aria-hidden={!isOpen}
      >
        <button
          onClick={() => {
            isMuted ? unmuteConversation(conversation.id) : muteConversation(conversation.id);
            snapClosed();
          }}
          className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-accent"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 0 0 3.844.148m-3.844-.148a23.856 23.856 0 0 1-5.455-1.31 8.964 8.964 0 0 0 2.3-5.542m3.155 6.852a3 3 0 0 0 5.667 1.97m1.965-2.277L21 21m-4.225-4.225a23.81 23.81 0 0 0 .984-2.058 8.963 8.963 0 0 0-1.673-7.25M15 9.75a6 6 0 0 0-6-6 6 6 0 0 0-5.022 2.735m0 0L3 3" />
            </svg>
          )}
          <span className="mt-0.5 text-[9px] font-medium leading-none">{isMuted ? "Unmute" : "Mute"}</span>
        </button>

        <button
          onClick={() => {
            snapClosed();
            void deleteConversation(conversation.id);
          }}
          className="flex h-10 w-10 flex-col items-center justify-center rounded-xl bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
          title="Delete"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          <span className="mt-0.5 text-[9px] font-medium leading-none">Delete</span>
        </button>
      </motion.div>

      {/* The draggable row — only drag on mobile */}
      <motion.div
        drag={isMobile ? "x" : false}
        dragConstraints={{ left: -ACTION_WIDTH, right: 0 }}
        dragElastic={{ left: 0.05, right: 0.15 }}
        dragMomentum={false}
        style={{ x }}
        onDragEnd={handleDragEnd}
        onClick={() => { if (isOpen) snapClosed(); }}
        className="relative"
      >
        <Link
          href={isOpen ? "#" : href}
          onClick={(e) => { if (isOpen) { e.preventDefault(); snapClosed(); } }}
          className={`conv-item ${isActive ? "conv-item--active" : ""} ${isMuted ? "opacity-60" : ""}`}
        >
          <div className="conv-avatar-wrap">
            <Avatar src={conversation.avatarUrl} name={title} size="md" />
            {conversation.type === "direct" && (
              <OnlineDot isOnline={isOnline} borderClass="border-sidebar" />
            )}
          </div>

          <div className="conv-meta">
            <div className="conv-row">
              <span className="conv-name flex items-center gap-1.5">
                {title}
                {isMuted && (
                  <svg className="h-3 w-3 shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.143 17.082a24.248 24.248 0 0 0 3.844.148m-3.844-.148a23.856 23.856 0 0 1-5.455-1.31 8.964 8.964 0 0 0 2.3-5.542m3.155 6.852a3 3 0 0 0 5.667 1.97m1.965-2.277L21 21m-4.225-4.225a23.81 23.81 0 0 0 .984-2.058 8.963 8.963 0 0 0-1.673-7.25M15 9.75a6 6 0 0 0-6-6 6 6 0 0 0-5.022 2.735m0 0L3 3" />
                  </svg>
                )}
              </span>
              <span className="conv-time">{timeStr}</span>
            </div>
            <div className="conv-row mt-0.5">
              <p className="conv-preview">{lastMessageText}</p>
              {!isMuted && conversation.unreadCount > 0 && (
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
      </motion.div>
    </motion.li>
  );
}

function getConversationPreview(conversation: Conversation) {
  if (conversation.type === "saved" && !conversation.lastMessage) return "Keep notes, links, and files for yourself";
  if (!conversation.lastMessage) return "...";
  if (conversation.lastMessage.isDeleted) return "Message deleted";
  if (conversation.lastMessage.decryptedContent) return conversation.lastMessage.decryptedContent;
  if (conversation.lastMessage.type === "poll") {
    return conversation.lastMessage.poll?.question || "Poll";
  }
  if (conversation.lastMessage.type === "location") {
    return "Shared location";
  }
  if (conversation.lastMessage.type === "contact") {
    return "Shared contact";
  }
  if (conversation.lastMessage.type === "sticker") {
    return `${conversation.lastMessage.sticker?.emoji ?? "🙂"} Sticker`;
  }
  if (conversation.lastMessage.type !== "text") return "Media message";
  return "Encrypted message";
}
