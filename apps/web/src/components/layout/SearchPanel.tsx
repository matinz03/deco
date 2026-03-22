"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { useConversationStore } from "@/store/conversations";
import type { User } from "@deco/types";

export function SearchPanel() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [isPending, startTransition] = useTransition();
  const [empty, setEmpty] = useState(false);
  const createConversation = useConversationStore((s) => s.createConversation);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      setEmpty(false);
      return;
    }
    startTransition(async () => {
      try {
        const users = await api.users.search(q.trim());
        setResults(users ?? []);
        setEmpty((users ?? []).length === 0);
      } catch {
        setResults([]);
      }
    });
  };

  const handleStartDM = async (user: User) => {
    try {
      const conv = await createConversation({ type: "direct", memberIds: [user.id] });
      router.push(`/inbox/${conv.id}`);
    } catch (e) {
      console.error("Failed to start conversation", e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sidebar-header">
        <h2 className="sidebar-title">Find people</h2>
      </div>

      <div className="sidebar-search-wrap">
        <div className="relative sidebar-search">
          <svg
            className="sidebar-search-icon"
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
            autoFocus
            type="search"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by username or name…"
            className="sidebar-search-input"
          />
          {isPending && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      <div className="sidebar-list">
        {results.length > 0 ? (
          <ul>
            {results.map((user) => (
              <li key={user.id}>
                <button
                  onClick={() => void handleStartDM(user)}
                  className="conv-item w-full text-left"
                >
                  <div className="conv-avatar-wrap">
                    <Avatar src={user.avatarUrl} name={user.displayName} size="md" />
                  </div>
                  <div className="conv-meta">
                    <div className="conv-row">
                      <span className="conv-name">{user.displayName}</span>
                    </div>
                    <div className="conv-row mt-0.5">
                      <p className="conv-preview">@{user.username}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <div className="sidebar-empty">
            <p className="text-sm text-muted">No users found for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="sidebar-empty">
            <p className="text-sm text-muted">Type at least 2 characters to search.</p>
          </div>
        )}
      </div>
    </div>
  );
}
