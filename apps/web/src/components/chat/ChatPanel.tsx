"use client";

import { useEffect, useRef } from "react";
import { useConversationStore } from "@/store/conversations";
import { useAuthStore } from "@/store/auth";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { ChatHeader } from "./ChatHeader";

interface Props { conversationId: string; }

export function ChatPanel({ conversationId }: Props) {
  const user = useAuthStore((s) => s.user);
  const { messages, fetchMessages, setActiveConversation, conversations } = useConversationStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversation = conversations.find((c) => c.id === conversationId);
  const convMessages = messages[conversationId] ?? [];

  useEffect(() => {
    setActiveConversation(conversationId);
    fetchMessages(conversationId);
    return () => setActiveConversation(null);
  }, [conversationId, setActiveConversation, fetchMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convMessages.length]);

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ChatHeader conversation={conversation} />

      {/* Messages */}
      <div className="flex-1 chat-scroll px-4 py-4 flex flex-col gap-1">
        {convMessages.length === 0 ? (
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
            {convMessages.map((msg, i) => {
              const isSent = msg.senderId === user?.id;
              const prevMsg = convMessages[i - 1];
              const showAvatar = !isSent && prevMsg?.senderId !== msg.senderId;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isSent={isSent}
                  showAvatar={showAvatar}
                />
              );
            })}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <MessageInput conversationId={conversationId} />
    </div>
  );
}
