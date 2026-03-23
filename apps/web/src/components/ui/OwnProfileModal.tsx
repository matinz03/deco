"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OwnProfileModal({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setDisplayName(user?.displayName ?? "");
      setBio(user?.bio ?? "");
      setEditing(false);
    }
  }, [open, user]);

  async function handleSave() {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await updateProfile({ displayName: displayName.trim(), bio: bio.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || !user) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
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
              <h4 className="text-base font-semibold">My Profile</h4>
              <div className="flex items-center gap-2">
                {!editing && (
                  <button
                    className="rounded-lg border border-sidebar px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </button>
                )}
                <button className="icon-btn" onClick={onClose} aria-label="Close">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-col items-center gap-3 px-6 py-6">
              <Avatar src={user.avatarUrl} name={user.displayName || user.username} size="lg" />

              {editing ? (
                <div className="w-full space-y-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Display name</span>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="input"
                      placeholder="Your name"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Bio</span>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      className="input min-h-[80px] resize-none"
                      placeholder="Tell people a little about yourself"
                    />
                  </label>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-lg border border-sidebar px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary px-4 py-1.5 text-sm"
                      disabled={saving || !displayName.trim()}
                      onClick={() => void handleSave()}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-lg font-semibold">{user.displayName || user.username}</p>
              )}
            </div>

            {!editing && (
              <div className="space-y-2 border-t border-sidebar px-6 pb-6 pt-4">
                <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Username</p>
                  <p className="mt-0.5 text-sm">@{user.username}</p>
                </div>
                {user.bio && (
                  <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bio</p>
                    <p className="mt-1 text-sm">{user.bio}</p>
                  </div>
                )}
                {user.createdAt && (
                  <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Member since</p>
                    <p className="mt-0.5 text-sm">
                      {new Date(user.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
