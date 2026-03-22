"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { OnlineDot } from "@/components/ui/OnlineDot";
import { useAuthStore } from "@/store/auth";
import { useConversationStore } from "@/store/conversations";
import { formatDistanceToNowStrict } from "date-fns";
import type { Conversation } from "@deco/types";

interface Props {
  conversation: Conversation;
}

export function ChatHeader({ conversation }: Props) {
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const presence = useConversationStore((s) => s.presence);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const title = conversation.name || "Unknown conversation";
  const otherMemberRecord = conversation.members?.find((member) => member.userId !== currentUserId);
  const otherMember = otherMemberRecord?.user;
  const otherPresence = otherMemberRecord ? presence[otherMemberRecord.userId] : undefined;
  const isOnline = otherPresence?.status === "online";
  const currentMember = conversation.members?.find((member) => member.userId === currentUserId);
  const canEditGroup =
    conversation.type === "group" && (currentMember?.role === "owner" || currentMember?.role === "admin");
  const subtitle =
    conversation.type === "direct"
      ? getDirectConversationSubtitle(otherPresence?.lastSeenAt || otherMember?.lastSeenAt, isOnline)
      : `${conversation.memberCount} members`;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupName, setGroupName] = useState(conversation.name || "");
  const [description, setDescription] = useState(conversation.description || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setGroupName(conversation.name || "");
    setDescription(conversation.description || "");
  }, [conversation.name, conversation.description, conversation.id]);

  async function handleSaveGroupSettings() {
    setSaving(true);
    try {
      await updateConversation(conversation.id, {
        name: groupName.trim(),
        description: description.trim(),
      });
      setSettingsOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="chat-header">
        <button
          onClick={() => router.back()}
          className="md:hidden icon-btn mr-1 shrink-0"
          aria-label="Back to conversations"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </button>

        <div className="relative shrink-0">
          <Avatar src={conversation.avatarUrl} name={title} size="sm" />
          {conversation.type === "direct" && <OnlineDot isOnline={isOnline} borderClass="border-surface" />}
        </div>

        <div className="chat-header-info">
          <h3 className="chat-header-name">{title}</h3>
          <p className="chat-header-status">{subtitle}</p>
        </div>

        <div className="chat-actions">
          <button className="hidden sm:flex icon-btn" title="Search in conversation" aria-label="Search in conversation">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>
          <button className="hidden sm:flex icon-btn" title="Voice call" aria-label="Voice call">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
            </svg>
          </button>
          <button className="hidden sm:flex icon-btn" title="Video call" aria-label="Video call">
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title={canEditGroup ? "Group settings" : "More options"}
            aria-label={canEditGroup ? "Group settings" : "More options"}
            onClick={() => {
              if (canEditGroup) {
                setSettingsOpen(true);
              }
            }}
          >
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
            </svg>
          </button>
        </div>
      </header>

      <AnimatePresence>
        {settingsOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div
              className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-sidebar bg-surface p-5 shadow-2xl"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-base font-semibold">Group settings</h4>
                <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Group name</span>
                  <input
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    className="input"
                    placeholder="Name your group"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Description</span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="input min-h-[100px] resize-none"
                    placeholder="What is this group about?"
                  />
                </label>
              </div>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="rounded-xl border border-sidebar px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSaveGroupSettings()}
                  disabled={saving || !groupName.trim()}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function getDirectConversationSubtitle(lastSeenAt: string | undefined, isOnline: boolean) {
  if (isOnline) return "Online";
  if (!lastSeenAt) return "Direct message";
  const lastSeen = new Date(lastSeenAt);
  if (Number.isNaN(lastSeen.getTime())) return "Direct message";
  const diffMs = Date.now() - lastSeen.getTime();
  if (diffMs < 5 * 60 * 1000) return "Active recently";
  return `Last seen ${formatDistanceToNowStrict(lastSeen, { addSuffix: true })}`;
}
