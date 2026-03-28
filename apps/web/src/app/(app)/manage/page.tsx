"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { User, UserRestriction } from "@deco/types";
import { api } from "@/lib/api";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/store/auth";

const RESTRICTIONS: Array<{ key: UserRestriction; label: string; description: string }> = [
  {
    key: "send_messages",
    label: "Send messages",
    description: "Blocks sending chat messages and polls.",
  },
  {
    key: "create_conversations",
    label: "Create conversations",
    description: "Blocks starting new direct chats or groups.",
  },
  {
    key: "manage_stickers",
    label: "Manage stickers",
    description: "Blocks creating, importing, cloning, and deleting sticker packs.",
  },
];

export default function ManagePage() {
  const router = useRouter();
  const currentUser = useAuthStore((state) => state.user);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    displayName: string;
    username: string;
    avatarUrl: string;
    isAdmin: boolean;
    restrictedActions: UserRestriction[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editingUser = useMemo(
    () => users.find((user) => user.id === editingId) ?? null,
    [editingId, users]
  );

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    if (!currentUser) {
      router.replace("/login");
      return;
    }
    if (!currentUser.isAdmin) {
      router.replace("/inbox");
      return;
    }
    void loadUsers();
  }, [currentUser, isHydrated, router]);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const nextUsers = await api.users.listAdminUsers();
      setUsers(nextUsers);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  function beginEdit(user: User) {
    setEditingId(user.id);
    setDraft({
      displayName: user.displayName,
      username: user.username,
      avatarUrl: user.avatarUrl,
      isAdmin: user.isAdmin,
      restrictedActions: [...user.restrictedActions],
    });
    setError("");
  }

  async function saveUser() {
    if (!editingUser || !draft) return;
    if (!draft.displayName.trim() || !draft.username.trim()) {
      setError("Display name and username are required");
      return;
    }

    setSavingId(editingUser.id);
    setError("");
    try {
      const updatedUser = await api.users.updateAdminUser(editingUser.id, {
        displayName: draft.displayName.trim(),
        username: draft.username.trim(),
        avatarUrl: draft.avatarUrl.trim(),
        isAdmin: draft.isAdmin,
        restrictedActions: draft.restrictedActions,
      });
      setUsers((current) => current.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
      if (currentUser?.id === updatedUser.id) {
        useAuthStore.setState({ user: updatedUser });
        localStorage.setItem("deco_user", JSON.stringify(updatedUser));
      }
      setEditingId(null);
      setDraft(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to save user");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteUser(user: User) {
    const confirmed = window.confirm(`Delete @${user.username}? This removes their account and related data.`);
    if (!confirmed) return;

    setDeletingId(user.id);
    setError("");
    try {
      await api.users.deleteAdminUser(user.id);
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      if (editingId === user.id) {
        setEditingId(null);
        setDraft(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAvatarPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !draft) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }

    setSavingId(editingId);
    setError("");
    try {
      const upload = await api.uploads.create(file, "avatar", file.name);
      setDraft((current) => (current ? { ...current, avatarUrl: upload.url } : current));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to upload avatar");
    } finally {
      setSavingId(null);
    }
  }

  if (!isHydrated || !currentUser) {
    return null;
  }

  if (!currentUser.isAdmin) {
    return null;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 pb-24 pt-8 md:px-8 md:pb-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Manage</h1>
            <p className="mt-1 text-sm text-muted">
              Admins can review accounts, update public profile fields, promote other admins, and restrict key actions.
            </p>
          </div>
          <button onClick={() => void loadUsers()} className="rounded-xl border border-sidebar px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground">
            Refresh
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</p>
        )}

        <section className="overflow-hidden rounded-3xl border border-sidebar bg-surface/85 shadow-sm">
          <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_120px_160px_150px] gap-4 border-b border-sidebar px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            <span>User</span>
            <span>Avatar</span>
            <span>Role</span>
            <span>Restrictions</span>
            <span>Actions</span>
          </div>

          {loading ? (
            <div className="px-5 py-8 text-sm text-muted">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="px-5 py-8 text-sm text-muted">No users found.</div>
          ) : (
            users.map((user) => {
              const isEditing = editingId === user.id && draft;
              const disabled = savingId === user.id || deletingId === user.id;
              return (
                <div
                  key={user.id}
                  className="grid grid-cols-[minmax(220px,1.4fr)_minmax(180px,1fr)_120px_160px_150px] gap-4 border-b border-sidebar px-5 py-4 last:border-b-0"
                >
                  <div className="min-w-0">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={draft.displayName}
                          onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                          className="input"
                          placeholder="Display name"
                        />
                        <input
                          value={draft.username}
                          onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                          className="input"
                          placeholder="Username"
                        />
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <p className="truncate font-medium">{user.displayName}</p>
                        <p className="truncate text-sm text-muted">@{user.username}</p>
                        <p className="mt-1 text-xs text-muted">
                          {user.isOwner ? "Application owner" : user.isAdmin ? "Admin account" : "Member account"}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Avatar src={isEditing ? draft.avatarUrl : user.avatarUrl} name={user.displayName} size="md" />
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={draft.avatarUrl}
                          onChange={(event) => setDraft({ ...draft, avatarUrl: event.target.value })}
                          className="input"
                          placeholder="Avatar URL"
                        />
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          onChange={(event) => void handleAvatarPick(event)}
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm text-primary hover:underline"
                        >
                          Upload picture
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted">{user.avatarUrl ? "Custom picture" : "Default avatar"}</span>
                    )}
                  </div>

                  <div className="flex items-center">
                    {isEditing ? (
                      <label className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${user.isOwner ? "border-amber-500/40 text-amber-500" : "border-sidebar text-muted"}`}>
                        <input
                          type="checkbox"
                          checked={draft.isAdmin}
                          disabled={user.isOwner}
                          onChange={(event) => setDraft({ ...draft, isAdmin: event.target.checked })}
                        />
                        <span>{user.isOwner ? "Owner" : "Admin"}</span>
                      </label>
                    ) : (
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${user.isOwner ? "bg-amber-500/15 text-amber-500" : user.isAdmin ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {user.isOwner ? "Owner" : user.isAdmin ? "Admin" : "User"}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {isEditing ? (
                      RESTRICTIONS.map((restriction) => (
                        <label key={restriction.key} className="flex items-start gap-2 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={draft.restrictedActions.includes(restriction.key)}
                            disabled={draft.isAdmin}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...draft.restrictedActions, restriction.key]
                                : draft.restrictedActions.filter((value) => value !== restriction.key);
                              setDraft({ ...draft, restrictedActions: Array.from(new Set(next)) });
                            }}
                          />
                          <span>
                            <strong className="block text-foreground">{restriction.label}</strong>
                            {restriction.description}
                          </span>
                        </label>
                      ))
                    ) : user.restrictedActions.length > 0 ? (
                      user.restrictedActions.map((restriction) => (
                        <span key={restriction} className="mr-1 inline-flex rounded-full bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
                          {restriction}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted">{user.isAdmin ? "Admins are unrestricted" : "No restrictions"}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveUser()}
                          disabled={disabled}
                          className="rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
                        >
                          {savingId === user.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(null);
                          }}
                          className="rounded-xl border border-sidebar px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => beginEdit(user)}
                          className="rounded-xl border border-sidebar px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
                        >
                          Edit
                        </button>
                        {!user.isOwner && (
                          <button
                            type="button"
                            onClick={() => void deleteUser(user)}
                            disabled={disabled}
                            className="rounded-xl border border-red-500/40 px-3 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          >
                            {deletingId === user.id ? "Deleting..." : "Delete"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
