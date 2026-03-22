"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useConversationStore } from "@/store/conversations";
import { Avatar } from "@/components/ui/Avatar";
import type { User } from "@deco/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Mode = "direct" | "group";

export function NewConversationModal({ open, onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("direct");
  const [query, setQuery] = useState("");
  const [groupName, setGroupName] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const createConversation = useConversationStore((s) => s.createConversation);

  useEffect(() => {
    if (!open) {
      return;
    }

    setMode("direct");
    setQuery("");
    setGroupName("");
    setResults([]);
    setSelectedUsers([]);

    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (open) {
      document.addEventListener("keydown", handler);
    }

    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const selectedUserIds = useMemo(() => new Set(selectedUsers.map((user) => user.id)), [selectedUsers]);

  const handleSearch = (value: string) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }

    startTransition(async () => {
      try {
        const users = await api.users.search(value.trim());
        setResults(users ?? []);
      } catch {
        setResults([]);
      }
    });
  };

  async function handleCreateDirect(user: User) {
    if (creating) return;
    setCreating(true);
    try {
      const conversation = await createConversation({ type: "direct", memberIds: [user.id] });
      onClose();
      router.push(`/inbox/${conversation.id}`);
    } finally {
      setCreating(false);
    }
  }

  function toggleSelectedUser(user: User) {
    setSelectedUsers((current) =>
      current.some((item) => item.id === user.id)
        ? current.filter((item) => item.id !== user.id)
        : [...current, user]
    );
  }

  async function handleCreateGroup() {
    if (creating) return;
    if (!groupName.trim() || selectedUsers.length === 0) return;

    setCreating(true);
    try {
      const conversation = await createConversation({
        type: "group",
        name: groupName.trim(),
        memberIds: selectedUsers.map((user) => user.id),
      });
      onClose();
      router.push(`/inbox/${conversation.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          <motion.div
            key="modal"
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-sidebar bg-surface shadow-2xl"
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <div className="flex items-center justify-between border-b border-sidebar px-4 py-3">
              <h2 className="text-sm font-semibold">
                {mode === "direct" ? "New conversation" : "New group"}
              </h2>
              <button onClick={onClose} className="icon-btn" aria-label="Close">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="border-b border-sidebar px-4 py-3">
              <div className="flex gap-2 rounded-xl bg-muted p-1">
                {(["direct", "group"] as Mode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      mode === value ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
                    }`}
                  >
                    {value === "direct" ? "Direct" : "Group"}
                  </button>
                ))}
              </div>

              {mode === "group" && (
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="Group name"
                  className="input mt-3"
                />
              )}

              <div className="relative mt-3">
                <svg
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  />
                </svg>
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(event) => handleSearch(event.target.value)}
                  placeholder={mode === "direct" ? "Search for a person..." : "Add people to the group..."}
                  className="w-full rounded-xl border border-transparent bg-muted py-2 pl-10 pr-4 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring/40"
                />
                {isPending && (
                  <span className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
              </div>

              {mode === "group" && selectedUsers.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => toggleSelectedUser(user)}
                      className="flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs text-foreground"
                    >
                      <span>{user.displayName}</span>
                      <span className="text-muted">×</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto chat-scroll">
              {results.length > 0 ? (
                <ul className="py-1">
                  {results.map((user) => {
                    const selected = selectedUserIds.has(user.id);

                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() =>
                            mode === "direct" ? void handleCreateDirect(user) : toggleSelectedUser(user)
                          }
                          disabled={creating}
                          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-60 ${
                            selected ? "bg-accent/70" : "hover:bg-muted"
                          }`}
                        >
                          <Avatar src={user.avatarUrl} name={user.displayName} size="md" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{user.displayName}</p>
                            <p className="truncate text-xs text-muted">@{user.username}</p>
                          </div>
                          {mode === "group" && selected && (
                            <span className="ml-auto text-xs font-medium text-primary">Selected</span>
                          )}
                          {mode === "direct" && creating && (
                            <span className="ml-auto h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex items-center justify-center px-4 py-10 text-sm text-muted">
                  {query.length >= 2 ? `No results for "${query}"` : "Type at least 2 characters to search"}
                </div>
              )}
            </div>

            {mode === "group" && (
              <div className="border-t border-sidebar px-4 py-3">
                <button
                  type="button"
                  onClick={() => void handleCreateGroup()}
                  disabled={creating || !groupName.trim() || selectedUsers.length === 0}
                  className="btn-primary w-full disabled:opacity-50"
                >
                  {creating ? "Creating group..." : "Create group"}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
