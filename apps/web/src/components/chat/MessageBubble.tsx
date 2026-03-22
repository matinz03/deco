"use client";

import { Avatar } from "@/components/ui/Avatar";
import { format } from "date-fns";
import type { Message } from "@deco/types";

interface Props {
  message: Message;
  isSent: boolean;
  showAvatar: boolean;
}

export function MessageBubble({ message: msg, isSent, showAvatar }: Props) {
  const text = getMessageText(msg);
  const time = format(new Date(msg.sentAt), "HH:mm");
  const senderName = msg.sender?.displayName || msg.sender?.username || "Unknown";

  return (
    <div className={`flex items-end gap-2 ${isSent ? "flex-row-reverse" : "flex-row"} animate-fade-in`}>
      {/* Avatar for received messages */}
      {!isSent && (
        <div className="w-7 shrink-0">
          {showAvatar && (
            <Avatar
              src={msg.sender?.avatarUrl}
              name={senderName}
              size="xs"
            />
          )}
        </div>
      )}

      <div className={`group flex flex-col gap-1 max-w-[65%] ${isSent ? "items-end" : "items-start"}`}>
        {/* Sender name for groups (received only) */}
        {!isSent && showAvatar && msg.sender && (
          <span className="text-[11px] font-medium text-muted px-1">
            {senderName}
          </span>
        )}

        {/* Reply preview */}
        {msg.replyTo && (
          <div className={`text-xs px-3 py-1.5 rounded-lg border-l-2 border-primary opacity-70 max-w-full truncate
            ${isSent ? "bg-primary/10" : "bg-muted"}`}>
            {msg.replyTo.decryptedContent ?? "…"}
          </div>
        )}

        {/* Bubble */}
        <div
          className={`relative px-3.5 py-2 rounded-2xl text-sm leading-relaxed
            ${isSent
              ? "bubble-sent rounded-br-sm"
              : "bubble-received rounded-bl-sm shadow-sm"
            }
            ${isSent ? "animate-bubble-in-sent" : "animate-bubble-in-received"}
          `}
        >
          {/* Media */}
          {msg.type === "image" && msg.mediaUrl && (
            <img
              src={msg.mediaUrl}
              alt="Image"
              className="rounded-xl max-w-full max-h-64 object-cover mb-1.5"
            />
          )}

          {/* Text */}
          {msg.isDeleted ? (
            <span className="italic opacity-50">Message deleted</span>
          ) : (
            <span className="whitespace-pre-wrap break-words">{text}</span>
          )}

          {/* Time + status */}
          <span className={`flex items-center gap-1 text-[10px] mt-1 opacity-55 ${isSent ? "justify-end" : "justify-start"}`}>
            {time}
            {isSent && <DeliveryIcon status={msg.status} />}
          </span>
        </div>

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {groupReactions(msg.reactions).map(([emoji, count]) => (
              <button
                key={emoji}
                className="flex items-center gap-1 text-xs bg-muted hover:bg-accent px-2 py-0.5 rounded-full transition-colors"
              >
                <span>{emoji}</span>
                {count > 1 && <span className="text-muted">{count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeliveryIcon({ status }: { status: Message["status"] }) {
  if (status === "read") {
    return (
      <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
      </svg>
    );
  }
  if (status === "delivered") {
    return (
      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/>
      </svg>
    );
  }
  return (
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  );
}

function groupReactions(reactions: Message["reactions"]): [string, number][] {
  const map = new Map<string, number>();
  for (const r of reactions) map.set(r.emoji, (map.get(r.emoji) ?? 0) + 1);
  return Array.from(map.entries());
}

function getMessageText(message: Message) {
  if (message.decryptedContent) {
    return message.decryptedContent;
  }

  if (message.encryptedContent) {
    return "Encrypted message unavailable on this device";
  }

  return "";
}
