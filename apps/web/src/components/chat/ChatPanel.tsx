"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { isSameDay, isToday, isYesterday, format } from "date-fns";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { usePreferencesStore } from "@/store/preferences";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { ChatHeader } from "./ChatHeader";
import { ChatSkeleton } from "./ChatSkeleton";
import { TypingIndicator } from "./TypingIndicator";
import { ThreadPortal } from "./ThreadPortal";
import type { Message } from "@deco/types";

const VIRTUAL_THRESHOLD = 80;

type ChatItem =
  | { kind: "divider"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      msg: Message;
      isSent: boolean;
      isGrouped: boolean;
      isLastInGroup: boolean;
      showAvatar: boolean;
    };

function formatDateLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

interface Props { conversationId: string; }

export function ChatPanel({ conversationId }: Props) {
  const user = useAuthStore((s) => s.user);
  const readReceipts = usePreferencesStore((s) => s.readReceipts);
  const { messages, fetchMessages, setActiveConversation, markConversationRead, conversations, typing } = useConversationStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const initialScrollDone = useRef(false);
  const lastScrollTop = useRef(0);

  const conversation = conversations.find((c) => c.id === conversationId);
  const convMessages = messages[conversationId] ?? [];
  const typingUsers = typing[conversationId] ?? [];
  const typingNames = (conversation?.members ?? [])
    .filter((member) => typingUsers.includes(member.userId) && member.userId !== user?.id)
    .map((member) => member.user?.displayName || member.user?.username || "Someone");
  const typingLabel =
    typingNames.length <= 1
      ? typingNames[0]
      : `${typingNames[0]} and ${typingNames.length - 1} ${typingNames.length - 1 === 1 ? "other" : "others"}`;

  const replyCounts = useMemo(() => convMessages.reduce<Record<string, number>>((acc, m) => {
    if (m.replyToId) acc[m.replyToId] = (acc[m.replyToId] ?? 0) + 1;
    return acc;
  }, {}), [convMessages]);

  // Build flat items array: date dividers + messages with grouping metadata
  const items = useMemo<ChatItem[]>(() => {
    const result: ChatItem[] = [];
    for (let i = 0; i < convMessages.length; i++) {
      const msg = convMessages[i]!;
      const prevMsg = convMessages[i - 1];
      const nextMsg = convMessages[i + 1];

      const msgDate = new Date(msg.sentAt);
      const prevDate = prevMsg ? new Date(prevMsg.sentAt) : null;

      if (!prevDate || !isSameDay(msgDate, prevDate)) {
        result.push({ kind: "divider", key: `divider-${msg.id}`, label: formatDateLabel(msgDate) });
      }

      const isSent = msg.senderId === user?.id;
      const sameAsPrev = !!prevMsg && prevMsg.senderId === msg.senderId && !!prevDate && isSameDay(msgDate, prevDate);
      const sameAsNext = !!nextMsg && nextMsg.senderId === msg.senderId && isSameDay(msgDate, new Date(nextMsg.sentAt));

      const isGrouped = sameAsPrev;
      const isLastInGroup = !sameAsNext;

      result.push({
        kind: "message",
        key: msg.id,
        msg,
        isSent,
        isGrouped,
        isLastInGroup,
        showAvatar: !isSent && isLastInGroup,
      });
    }
    return result;
  }, [convMessages, user?.id]);

  const useVirtual = items.length > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => items[i]?.kind === "divider" ? 40 : 56,
    overscan: 10,
  });

  useEffect(() => {
    setActiveConversation(conversationId);
    markConversationRead(conversationId);
    setLoading(true);
    void fetchMessages(conversationId).finally(() => setLoading(false));
    if (readReceipts) void api.messages.markRead(conversationId).catch(() => {});
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation, markConversationRead, fetchMessages, readReceipts]);

  useEffect(() => {
    if (convMessages.length === 0) return;
    markConversationRead(conversationId);
    if (readReceipts) void api.messages.markRead(conversationId).catch(() => {});
  }, [conversationId, convMessages.length, markConversationRead, readReceipts]);

  useEffect(() => {
    initialScrollDone.current = false;
    setShowScrollBtn(false);
    setReplyTo(null);
    setThreadMessageId(null);
  }, [conversationId]);

  useEffect(() => {
    if (loading || convMessages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;
    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (!showScrollBtn) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading, convMessages.length, showScrollBtn]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrollingDown = el.scrollTop > lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (distanceFromBottom <= 200) {
      setShowScrollBtn(false);
    } else if (scrollingDown) {
      setShowScrollBtn(true);
    } else {
      setShowScrollBtn(false);
    }
  }

  function jumpToMessage(messageId: string) {
    const element = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderItem(item: ChatItem) {
    if (item.kind === "divider") {
      return (
        <div key={item.key} className="flex items-center gap-3 py-3 px-2">
          <div className="flex-1 h-px bg-border/50" />
          <span className="text-[11px] font-medium text-muted shrink-0">{item.label}</span>
          <div className="flex-1 h-px bg-border/50" />
        </div>
      );
    }
    return (
      <MessageBubble
        key={item.key}
        message={item.msg}
        isSent={item.isSent}
        showAvatar={item.showAvatar}
        isGrouped={item.isGrouped}
        isLastInGroup={item.isLastInGroup}
        replyCount={replyCounts[item.msg.id] ?? 0}
        onReply={setReplyTo}
        onOpenThread={(msg) => setThreadMessageId(msg.id)}
      />
    );
  }

  // Other member for empty state
  const otherMember = conversation?.type === "direct"
    ? conversation.members?.find((m) => m.userId !== user?.id)
    : null;

  if (!conversation) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      <ChatHeader conversation={conversation} />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 chat-scroll px-4 py-4 flex flex-col"
      >
        {loading ? (
          <ChatSkeleton />
        ) : convMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <Avatar
              src={otherMember?.user?.avatarUrl ?? conversation.avatarUrl}
              name={conversation.name || "?"}
              size="lg"
            />
            <div>
              <p className="font-semibold">{conversation.name}</p>
              <p className="mt-1 text-sm text-muted">
                {conversation.type === "direct"
                  ? `Say hi to ${otherMember?.user?.displayName || conversation.name}! 👋`
                  : "No messages yet. Start the conversation!"}
              </p>
            </div>
          </div>
        ) : (
          <>
            {useVirtual ? (
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const item = items[virtualItem.index]!;
                  return (
                    <div
                      key={item.key}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                      ref={virtualizer.measureElement}
                      data-index={virtualItem.index}
                    >
                      {renderItem(item)}
                    </div>
                  );
                })}
              </div>
            ) : (
              items.map((item) => renderItem(item))
            )}

            <AnimatePresence>
              {showScrollBtn && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                  onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="sticky bottom-2 self-center z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border shadow-md text-xs text-foreground hover:bg-accent transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                  Scroll to bottom
                </motion.button>
              )}
            </AnimatePresence>
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <TypingIndicator isTyping={typingNames.length > 0} name={typingLabel} />
      <MessageInput conversationId={conversationId} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} />
      <ThreadPortal
        open={Boolean(threadMessageId)}
        messages={convMessages}
        focusMessageId={threadMessageId}
        onClose={() => setThreadMessageId(null)}
        onJumpToMessage={jumpToMessage}
      />
    </div>
  );
}
