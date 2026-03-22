"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { ChatHeader } from "./ChatHeader";
import { ChatSkeleton } from "./ChatSkeleton";
import { TypingIndicator } from "./TypingIndicator";

const VIRTUAL_THRESHOLD = 80;

interface Props { conversationId: string; }

export function ChatPanel({ conversationId }: Props) {
  const user = useAuthStore((s) => s.user);
  const { messages, fetchMessages, setActiveConversation, markConversationRead, conversations } = useConversationStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const initialScrollDone = useRef(false);

  const conversation = conversations.find((c) => c.id === conversationId);
  const convMessages = messages[conversationId] ?? [];
  const useVirtual = convMessages.length > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: useVirtual ? convMessages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  useEffect(() => {
    setActiveConversation(conversationId);
    markConversationRead(conversationId);
    setLoading(true);
    void fetchMessages(conversationId).finally(() => setLoading(false));
    void api.messages.markRead(conversationId).catch(() => {});
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation, markConversationRead, fetchMessages]);

  useEffect(() => {
    if (convMessages.length === 0) return;
    markConversationRead(conversationId);
    void api.messages.markRead(conversationId).catch(() => {});
  }, [conversationId, convMessages.length, markConversationRead]);

  // Reset initial scroll flag when conversation changes
  useEffect(() => {
    initialScrollDone.current = false;
    setShowScrollBtn(false);
  }, [conversationId]);

  // Scroll logic: instant jump on first load, smooth scroll on new messages
  useEffect(() => {
    if (loading || convMessages.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    if (!initialScrollDone.current) {
      // First render of this conversation — jump instantly to bottom
      initialScrollDone.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }

    // Subsequent messages — smooth scroll only if already near bottom
    if (!showScrollBtn) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [loading, convMessages.length, showScrollBtn]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);
  }

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

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 chat-scroll px-4 py-4 flex flex-col gap-1"
      >
        {loading ? (
          <ChatSkeleton />
        ) : convMessages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
              <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
              </svg>
            </div>
            <p className="text-sm text-muted">
              This is the beginning of your conversation with <strong className="text-foreground">{conversation.name}</strong>.
            </p>
          </div>
        ) : (
          <>
            {useVirtual ? (
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const msg = convMessages[virtualItem.index]!;
                  const isSent = msg.senderId === user?.id;
                  const prevMsg = convMessages[virtualItem.index - 1];
                  const showAvatar = !isSent && prevMsg?.senderId !== msg.senderId;
                  return (
                    <div
                      key={msg.id}
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
                      <MessageBubble message={msg} isSent={isSent} showAvatar={showAvatar} />
                    </div>
                  );
                })}
              </div>
            ) : (
              convMessages.map((msg, i) => {
                const isSent = msg.senderId === user?.id;
                const prevMsg = convMessages[i - 1];
                const showAvatar = !isSent && prevMsg?.senderId !== msg.senderId;
                return (
                  <MessageBubble key={msg.id} message={msg} isSent={isSent} showAvatar={showAvatar} />
                );
              })
            )}
            {/* Scroll-to-bottom button — sticky inside scroll area */}
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

      <TypingIndicator isTyping={false} />
      <MessageInput conversationId={conversationId} />
    </div>
  );
}
