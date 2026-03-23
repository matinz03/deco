"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";
import { useRouter } from "next/navigation";
import type { Conversation, LeadershipStatus, Member, User } from "@deco/types";
import { Avatar } from "@/components/ui/Avatar";
import { OnlineDot } from "@/components/ui/OnlineDot";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useConversationStore } from "@/store/conversations";
import { SharedMediaPortal } from "./SharedMediaPortal";

interface Props {
  conversation: Conversation;
}

export function ChatHeader({ conversation }: Props) {
  const router = useRouter();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const liveConversation =
    useConversationStore((s) => s.conversations.find((item) => item.id === conversation.id)) ?? conversation;
  const presence = useConversationStore((s) => s.presence);
  const updateConversation = useConversationStore((s) => s.updateConversation);
  const listMembers = useConversationStore((s) => s.listMembers);
  const addMember = useConversationStore((s) => s.addMember);
  const updateMemberRole = useConversationStore((s) => s.updateMemberRole);
  const removeMember = useConversationStore((s) => s.removeMember);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const conversationMessages = useConversationStore((s) => s.messages[liveConversation.id] ?? []);

  const title = liveConversation.name || "Unknown conversation";
  const currentMember = liveConversation.members?.find((member) => member.userId === currentUserId);
  const otherMemberRecord = liveConversation.members?.find((member) => member.userId !== currentUserId);
  const otherMember = otherMemberRecord?.user;
  const otherPresence = otherMemberRecord ? presence[otherMemberRecord.userId] : undefined;
  const isOnline = otherPresence?.status === "online";
  const canManageMembers = liveConversation.type === "group" && (currentMember?.role === "owner" || currentMember?.role === "admin");
  const canManageRoles = liveConversation.type === "group" && currentMember?.role === "owner";
  const canDeleteGroup = liveConversation.type === "group" && currentMember?.role === "owner";
  const isSaved = liveConversation.type === "saved";
  const subtitle =
    liveConversation.type === "saved"
      ? "Private notes to yourself"
      : liveConversation.type === "direct"
      ? getDirectConversationSubtitle(otherPresence?.lastSeenAt || otherMember?.lastSeenAt, isOnline)
      : `${liveConversation.memberCount} members`;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [groupName, setGroupName] = useState(liveConversation.name || "");
  const [description, setDescription] = useState(liveConversation.description || "");
  const [saving, setSaving] = useState(false);
  const [managingMembers, setManagingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [portalMounted, setPortalMounted] = useState(false);
  const [leadershipStatus, setLeadershipStatus] = useState<LeadershipStatus | null>(null);
  const [leadershipBusy, setLeadershipBusy] = useState(false);
  const [leadershipError, setLeadershipError] = useState("");

  useEffect(() => setPortalMounted(true), []);

  useEffect(() => {
    setGroupName(liveConversation.name || "");
    setDescription(liveConversation.description || "");
  }, [liveConversation.name, liveConversation.description, liveConversation.id]);

  useEffect(() => {
    if (!settingsOpen || liveConversation.type !== "group") return;
    void listMembers(liveConversation.id);
  }, [settingsOpen, liveConversation.id, liveConversation.type, listMembers]);

  useEffect(() => {
    if (!settingsOpen || liveConversation.type !== "group") return;
    let cancelled = false;
    setLeadershipError("");
    void api.conversations
      .getLeadership(liveConversation.id)
      .then((status) => {
        if (!cancelled) setLeadershipStatus(status);
      })
      .catch(() => {
        if (!cancelled) setLeadershipError("Failed to load leadership status");
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen, liveConversation.id, liveConversation.type]);

  useEffect(() => {
    if (!settingsOpen || !searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void api.users
        .search(searchQuery.trim())
        .then((users) => {
          if (!cancelled) setSearchResults(users);
        })
        .catch(() => {
          if (!cancelled) setSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [settingsOpen, searchQuery]);

  const members = liveConversation.members ?? [];
  const memberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const addableUsers = searchResults.filter((user) => !memberIds.has(user.id));
  const isGroup = liveConversation.type === "group";

  async function handleSaveGroupSettings() {
    setSaving(true);
    try {
      await updateConversation(liveConversation.id, {
        name: groupName.trim(),
        description: description.trim(),
      });
      setSettingsOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(userId: string) {
    setManagingMembers(true);
    try {
      await addMember(liveConversation.id, userId);
      setSearchQuery("");
      setSearchResults([]);
    } finally {
      setManagingMembers(false);
    }
  }

  async function handleRoleChange(member: Member, role: "admin" | "member") {
    setManagingMembers(true);
    try {
      await updateMemberRole(liveConversation.id, member.userId, role);
    } finally {
      setManagingMembers(false);
    }
  }

  async function handleRemoveMember(member: Member) {
    setManagingMembers(true);
    try {
      await removeMember(liveConversation.id, member.userId);
    } finally {
      setManagingMembers(false);
    }
  }

  async function handleDeleteGroup() {
    if (!window.confirm(`Delete "${title}" permanently? This cannot be undone.`)) return;
    setManagingMembers(true);
    try {
      await deleteConversation(liveConversation.id);
      setSettingsOpen(false);
      router.push("/inbox?tab=groups");
    } finally {
      setManagingMembers(false);
    }
  }

  async function handleLeadershipObjection() {
    setLeadershipBusy(true);
    setLeadershipError("");
    try {
      const status = await api.conversations.objectToLeadership(liveConversation.id);
      setLeadershipStatus(status);
      await listMembers(liveConversation.id);
    } catch {
      setLeadershipError("Could not register your objection");
    } finally {
      setLeadershipBusy(false);
    }
  }

  async function handleLeadershipVote(candidateUserId: string) {
    setLeadershipBusy(true);
    setLeadershipError("");
    try {
      const status = await api.conversations.voteLeadership(liveConversation.id, candidateUserId);
      setLeadershipStatus(status);
      await listMembers(liveConversation.id);
    } catch {
      setLeadershipError("Could not submit your leadership vote");
    } finally {
      setLeadershipBusy(false);
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

        <button
          className="relative shrink-0 rounded-full cursor-pointer"
          onClick={() => {
            if (isGroup) setSettingsOpen(true);
            else if (isSaved) return;
            else if (otherMember) setProfileUser(otherMember);
          }}
          aria-label={isGroup ? "Group settings" : isSaved ? "Saved messages" : "View profile"}
        >
          <Avatar src={liveConversation.avatarUrl} name={title} size="sm" />
          {!isGroup && !isSaved && <OnlineDot isOnline={isOnline} borderClass="border-surface" />}
        </button>

        <button
          className="chat-header-info min-w-0 text-left cursor-pointer"
          onClick={() => {
            if (isGroup) setSettingsOpen(true);
            else if (isSaved) return;
            else if (otherMember) setProfileUser(otherMember);
          }}
        >
          <h3 className="chat-header-name">{title}</h3>
          <p className="chat-header-status">{subtitle}</p>
        </button>

        <div className="chat-actions">
          <button
            className={`chat-action-btn hidden sm:flex ${searchOpen ? "!text-primary bg-primary/10" : ""}`}
            title="Search messages"
            aria-label="Search messages"
            onClick={() => setSearchOpen((value) => !value)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </button>

          <button
            className={`chat-action-btn hidden sm:flex ${sharedMediaOpen ? "!text-primary bg-primary/10" : ""}`}
            title="Shared media"
            aria-label="Shared media"
            onClick={() => setSharedMediaOpen(true)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75V6A2.25 2.25 0 0 1 4.5 3.75h15A2.25 2.25 0 0 1 21.75 6v12a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 18v-2.25Zm0 0 4.72-4.72a.75.75 0 0 1 1.06 0l4.72 4.72m0 0 1.78-1.78a.75.75 0 0 1 1.06 0l4.72 4.72M15 8.25h.008v.008H15V8.25Z" />
            </svg>
          </button>

          {!isSaved && (
            <button className="chat-action-btn hidden sm:flex" title="Voice call" aria-label="Voice call">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
            </button>
          )}

          {!isSaved && (
            <button className="chat-action-btn hidden sm:flex" title="Video call" aria-label="Video call">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75Z" />
              </svg>
            </button>
          )}

          {isGroup ? (
            <button
              className="chat-action-btn"
              title="Group settings"
              aria-label="Group settings"
              onClick={() => setSettingsOpen(true)}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </button>
          ) : !isSaved ? (
            <button className="chat-action-btn" title="More options" aria-label="More options">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
              </svg>
            </button>
          ) : null}
        </div>
      </header>

      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-b border-sidebar"
          >
            <div className="flex items-center gap-2 px-4 py-2">
              <svg className="w-4 h-4 shrink-0 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                autoFocus
                type="search"
                value={searchMsg}
                onChange={(event) => setSearchMsg(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    setSearchMsg("");
                  }
                }}
                placeholder="Search in conversation..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
              {searchMsg && (
                <button className="text-xs text-muted hover:text-foreground" onClick={() => setSearchMsg("")}>
                  Clear
                </button>
              )}
              <button
                className="icon-btn"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchMsg("");
                }}
                aria-label="Close search"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {portalMounted &&
        createPortal(
          <AnimatePresence>
            {settingsOpen && isGroup && (
              <motion.div
                className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setSettingsOpen(false)}
              >
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

                <motion.div
                  className="relative z-10 flex max-h-[92dvh] min-w-0 w-full flex-col overflow-hidden rounded-t-3xl border border-sidebar bg-surface shadow-2xl sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-3xl"
                  initial={{ y: 40, opacity: 0, scale: 0.98 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 40, opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex shrink-0 justify-center pb-1 pt-3 sm:hidden">
                    <div className="h-1 w-10 rounded-full bg-border" />
                  </div>

                  <div className="flex shrink-0 items-center gap-3 border-b border-sidebar px-5 py-4">
                    <Avatar src={liveConversation.avatarUrl} name={title} size="sm" />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-base font-semibold">{title}</h4>
                      <p className="text-xs text-muted">{liveConversation.memberCount} members</p>
                    </div>
                    <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto">
                    <div className="flex flex-col gap-5 p-5 sm:grid sm:grid-cols-[1.1fr,0.9fr] sm:gap-6">
                      <div className="space-y-5">
                        <div className="space-y-3">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Group name</span>
                            <input
                              value={groupName}
                              onChange={(event) => setGroupName(event.target.value)}
                              className="input"
                              placeholder="Name your group"
                              disabled={!canManageMembers}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Description</span>
                            <textarea
                              value={description}
                              onChange={(event) => setDescription(event.target.value)}
                              className="input min-h-[80px] resize-none"
                              placeholder="What is this group about?"
                              disabled={!canManageMembers}
                            />
                          </label>
                          {canManageMembers && (
                            <div className="flex justify-end">
                              <button
                                onClick={() => void handleSaveGroupSettings()}
                                disabled={saving || !groupName.trim()}
                                className="btn-primary w-auto px-5 py-2 text-sm"
                              >
                                {saving ? "Saving..." : "Save details"}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 rounded-2xl border border-sidebar/80 bg-background/40 p-4">
                          <div className="mb-3">
                            <h5 className="text-sm font-semibold">Members</h5>
                            <p className="mt-0.5 text-xs text-muted">
                              {canManageRoles
                                ? "Promote admins, remove people, or add new members."
                                : canManageMembers
                                  ? "Add people and remove regular members."
                                  : "See who is in this group."}
                            </p>
                          </div>
                          <div className="space-y-2">
                            {members.map((member) => {
                              const canRemove =
                                canManageMembers &&
                                member.userId !== currentUserId &&
                                member.role !== "owner" &&
                                (canManageRoles || member.role === "member");

                              return (
                                <div
                                  key={member.userId}
                                  className="flex items-center gap-3 rounded-xl border border-sidebar/70 px-3 py-2.5"
                                >
                                  <button
                                    type="button"
                                    className="shrink-0 rounded-full"
                                    onClick={() => { if (member.user) setProfileUser(member.user); }}
                                    aria-label="View profile"
                                  >
                                    <Avatar
                                      src={member.user?.avatarUrl}
                                      name={member.user?.displayName || member.user?.username || member.userId}
                                      size="sm"
                                    />
                                  </button>
                                  <div className="min-w-0 flex-1">
                                    <button
                                      type="button"
                                      className="w-full text-left"
                                      onClick={() => { if (member.user) setProfileUser(member.user); }}
                                    >
                                      <p className="truncate text-sm font-medium">
                                        {member.user?.displayName || member.user?.username || "Unknown user"}
                                        {member.userId === currentUserId ? " (You)" : ""}
                                      </p>
                                      <p className="truncate text-xs capitalize text-muted">
                                        @{member.user?.username || "unknown"} · {member.role}
                                      </p>
                                    </button>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    {canManageRoles && member.role !== "owner" && member.userId !== currentUserId && (
                                      <button
                                        type="button"
                                        onClick={() => void handleRoleChange(member, member.role === "admin" ? "member" : "admin")}
                                        disabled={managingMembers}
                                        className="rounded-lg border border-sidebar px-2 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                                      >
                                        {member.role === "admin" ? "Demote" : "Admin"}
                                      </button>
                                    )}
                                    {canRemove && (
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveMember(member)}
                                        disabled={managingMembers}
                                        className="rounded-lg border border-red-500/30 px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                                      >
                                        Remove
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-3 rounded-2xl border border-sidebar/80 bg-background/40 p-4">
                          <div>
                            <h5 className="text-sm font-semibold">Leadership</h5>
                            <p className="mt-0.5 text-xs text-muted">
                              Members can object to the current owner. If objections reach two-thirds of the group,
                              a one-day election begins. After an election starts, objections stay on cooldown for 30 days.
                            </p>
                          </div>

                          {leadershipStatus ? (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-sidebar/70 px-3 py-3">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Current owner</p>
                                <p className="mt-1 text-sm font-medium">
                                  {members.find((member) => member.userId === leadershipStatus.currentOwnerId)?.user?.displayName ||
                                    members.find((member) => member.userId === leadershipStatus.currentOwnerId)?.user?.username ||
                                    "Unknown"}
                                </p>
                              </div>

                              {!leadershipStatus.electionActive ? (
                                <div className="space-y-2 rounded-xl border border-sidebar/70 px-3 py-3">
                                  <p className="text-sm font-medium">
                                    Objections: {leadershipStatus.objectionCount}/{leadershipStatus.objectionThreshold}
                                  </p>
                                  {leadershipStatus.objectionCooldownEndsAt &&
                                    new Date(leadershipStatus.objectionCooldownEndsAt).getTime() > Date.now() && (
                                      <p className="text-xs text-muted">
                                        Next objection window opens{" "}
                                        {formatDistanceToNowStrict(new Date(leadershipStatus.objectionCooldownEndsAt), {
                                          addSuffix: true,
                                        })}
                                      </p>
                                    )}
                                  <button
                                    type="button"
                                    onClick={() => void handleLeadershipObjection()}
                                    disabled={!leadershipStatus.canObject || leadershipStatus.hasObjected || leadershipBusy}
                                    className="rounded-xl border border-sidebar px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                                  >
                                    {leadershipStatus.hasObjected ? "You objected" : "Object to leadership"}
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-3">
                                  <div>
                                    <p className="text-sm font-medium">Owner election is live</p>
                                    {leadershipStatus.electionEndsAt && (
                                      <p className="mt-0.5 text-xs text-muted">
                                        Voting ends{" "}
                                        {formatDistanceToNowStrict(new Date(leadershipStatus.electionEndsAt), { addSuffix: true })}
                                      </p>
                                    )}
                                    <p className="mt-1 text-xs text-muted">
                                      Turnout: {leadershipStatus.turnoutCount}/{leadershipStatus.turnoutThreshold}
                                    </p>
                                  </div>
                                  <div className="space-y-2">
                                    {leadershipStatus.candidates.map((candidate) => (
                                      <button
                                        key={candidate.userId}
                                        type="button"
                                        onClick={() => void handleLeadershipVote(candidate.userId)}
                                        disabled={leadershipBusy}
                                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                                          leadershipStatus.votedForUserId === candidate.userId
                                            ? "border-primary bg-primary/10"
                                            : "border-sidebar hover:bg-accent"
                                        }`}
                                      >
                                        <Avatar
                                          src={candidate.avatarUrl}
                                          name={candidate.displayName || candidate.username}
                                          size="sm"
                                        />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm font-medium">
                                            {candidate.displayName || candidate.username}
                                            {candidate.userId === currentUserId ? " (You)" : ""}
                                          </p>
                                          <p className="truncate text-xs text-muted">@{candidate.username}</p>
                                        </div>
                                        <div className="shrink-0 text-xs text-muted">{candidate.voteCount} votes</div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {leadershipError && (
                                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                                  {leadershipError}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted">Loading leadership status...</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-5">
                        <div className="space-y-3 rounded-2xl border border-sidebar/80 bg-background/40 p-4">
                          <div>
                            <h5 className="text-sm font-semibold">Add members</h5>
                            <p className="mt-0.5 text-xs text-muted">Search by name or username.</p>
                          </div>
                          <input
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder={canManageMembers ? "Search people..." : "No permission to add people"}
                            className="input"
                            disabled={!canManageMembers}
                          />
                          <div className="max-h-52 space-y-2 overflow-y-auto">
                            {searching && <p className="text-xs text-muted">Searching...</p>}
                            {!searching && searchQuery.trim().length >= 2 && addableUsers.length === 0 && (
                              <p className="text-xs text-muted">No addable people found.</p>
                            )}
                            {addableUsers.map((user) => (
                              <div
                                key={user.id}
                                className="flex items-center gap-3 rounded-xl border border-sidebar/70 px-3 py-2"
                              >
                                <Avatar src={user.avatarUrl} name={user.displayName || user.username} size="sm" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium">{user.displayName || user.username}</p>
                                  <p className="truncate text-xs text-muted">@{user.username}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleAddMember(user.id)}
                                  disabled={!canManageMembers || managingMembers}
                                  className="shrink-0 rounded-lg border border-sidebar px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                                >
                                  Add
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        {canDeleteGroup && (
                          <div className="space-y-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                            <div>
                              <h5 className="text-sm font-semibold text-red-300">Danger zone</h5>
                              <p className="mt-0.5 text-xs text-red-200/80">Deleting removes the chat for everyone.</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeleteGroup()}
                              disabled={managingMembers}
                              className="w-full rounded-xl border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                            >
                              Delete group
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {portalMounted &&
        createPortal(
          <AnimatePresence>
            {profileUser && (
              <motion.div
                className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setProfileUser(null)}
              >
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
                <motion.div
                  className="relative z-10 w-full max-w-sm overflow-hidden rounded-t-3xl border border-sidebar bg-surface shadow-2xl sm:rounded-3xl"
                  initial={{ y: 40, opacity: 0, scale: 0.98 }}
                  animate={{ y: 0, opacity: 1, scale: 1 }}
                  exit={{ y: 40, opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-center pb-1 pt-3 sm:hidden">
                    <div className="h-1 w-10 rounded-full bg-border" />
                  </div>

                  <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar">
                    <h4 className="text-base font-semibold">Profile</h4>
                    <button
                      className="icon-btn"
                      onClick={() => setProfileUser(null)}
                      aria-label="Close"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex flex-col items-center gap-3 px-6 py-6">
                    <Avatar src={profileUser.avatarUrl} name={profileUser.displayName || profileUser.username} size="lg" />
                    <div className="text-center">
                      <p className="text-lg font-semibold">{profileUser.displayName || profileUser.username}</p>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-sidebar px-6 pb-6 pt-4">
                    <div className="flex items-center justify-between rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Username</p>
                        <p className="mt-0.5 text-sm text-foreground/80">@{profileUser.username}</p>
                      </div>
                      <button
                        type="button"
                        className="ml-3 shrink-0 rounded-lg border border-sidebar px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                        onClick={() => {
                          void navigator.clipboard.writeText(profileUser.username);
                          setCopiedId(true);
                          setTimeout(() => setCopiedId(false), 2000);
                        }}
                      >
                        {copiedId ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    {profileUser.bio && (
                      <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bio</p>
                        <p className="mt-1 text-sm">{profileUser.bio}</p>
                      </div>
                    )}
                    {profileUser.createdAt && (
                      <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Member since</p>
                        <p className="mt-0.5 text-sm">{new Date(profileUser.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      <SharedMediaPortal
        open={sharedMediaOpen}
        title={title}
        messages={conversationMessages}
        onClose={() => setSharedMediaOpen(false)}
      />
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
