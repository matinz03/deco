"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { useConversationStore } from "@/store/conversations";
import type { User } from "@deco/types";

export default function SearchPage() {
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
      const conv = await createConversation({
        type: "direct",
        memberIds: [user.id],
      });
      router.push(`/inbox/${conv.id}`);
    } catch (e) {
      console.error("Failed to start conversation", e);
    }
  };

  return (
    <div className="flex flex-col h-full max-w-xl mx-auto w-full px-4 pt-10">
      <h1 className="text-xl font-semibold mb-6">Find people</h1>

      {/* Search input */}
      <div className="relative mb-6">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by username or name…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-muted border border-transparent focus:outline-none focus:ring-1 focus:ring-ring/40 text-sm placeholder:text-muted-foreground/50"
        />
        {isPending && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((user) => (
            <li key={user.id}>
              <button
                onClick={() => handleStartDM(user)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted transition-colors text-left"
              >
                <Avatar src={user.avatarUrl} name={user.displayName} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.displayName}</p>
                  <p className="text-xs text-muted truncate">@{user.username}</p>
                </div>
                <svg
                  className="ml-auto w-4 h-4 text-muted shrink-0"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {empty && query.length >= 2 && (
        <p className="text-sm text-muted text-center mt-8">No users found for &ldquo;{query}&rdquo;</p>
      )}

      {!query && (
        <p className="text-sm text-muted text-center mt-8">Type at least 2 characters to search.</p>
      )}
    </div>
  );
}
