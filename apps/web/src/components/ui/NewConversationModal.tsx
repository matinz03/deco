"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useConversationStore } from "@/store/conversations";
import { Avatar } from "@/components/ui/Avatar";
import type { User } from "@deco/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewConversationModal({ open, onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const createConversation = useConversationStore((s) => s.createConversation);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    startTransition(async () => {
      try {
        const users = await api.users.search(q.trim());
        setResults(users ?? []);
      } catch {
        setResults([]);
      }
    });
  };

  const handleSelect = async (user: User) => {
    if (creating) return;
    setCreating(true);
    try {
      const conv = await createConversation({ type: "direct", memberIds: [user.id] });
      onClose();
      router.push(`/inbox/${conv.id}`);
    } catch (e) {
      console.error("Failed to create conversation", e);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-surface rounded-2xl shadow-2xl border border-sidebar overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar">
          <h2 className="font-semibold text-sm">New conversation</h2>
          <button
            onClick={onClose}
            className="icon-btn"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-sidebar">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by username or name…"
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-muted border border-transparent focus:outline-none focus:ring-1 focus:ring-ring/40 text-sm placeholder:text-muted-foreground/50"
            />
            {isPending && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto chat-scroll">
          {results.length > 0 ? (
            <ul className="py-1">
              {results.map((user) => (
                <li key={user.id}>
                  <button
                    onClick={() => handleSelect(user)}
                    disabled={creating}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted transition-colors text-left disabled:opacity-60"
                  >
                    <Avatar src={user.avatarUrl} name={user.displayName} size="md" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{user.displayName}</p>
                      <p className="text-xs text-muted truncate">@{user.username}</p>
                    </div>
                    {creating && (
                      <span className="ml-auto w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center justify-center py-10 text-sm text-muted">
              {query.length >= 2 ? `No results for "${query}"` : "Type at least 2 characters to search"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
