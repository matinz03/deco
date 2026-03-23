"use client";

import { ChangeEvent, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { api } from "@/lib/api";

interface Props {
  open: boolean;
  onClose: () => void;
}

type KnownAccount = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
};

export function OwnProfileModal({ open, onClose }: Props) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setDisplayName(user?.displayName ?? "");
      setBio(user?.bio ?? "");
      setAvatarUrl(user?.avatarUrl ?? "");
      setAvatarFile(null);
      setAvatarProcessing(false);
      setProfileError("");
      setEditing(false);
      setKnownAccounts(readKnownAccounts().filter((account) => account.id !== user?.id));
    }
  }, [open, user]);

  async function handleSave() {
    if (!displayName.trim()) {
      setProfileError("Display name cannot be empty");
      return;
    }
    if (avatarProcessing) {
      setProfileError("Please wait for the image to finish processing");
      return;
    }
    setSaving(true);
    setProfileError("");
    try {
      let nextAvatarUrl = avatarUrl;
      if (avatarFile) {
        const upload = await api.uploads.create(avatarFile, "avatar", avatarFile.name);
        nextAvatarUrl = upload.url;
      }
      await updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim(),
        avatarUrl: nextAvatarUrl,
      });
      setAvatarFile(null);
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
            drag="y"
            dragDirectionLock
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.22 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) {
                onClose();
              }
            }}
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(event) =>
                  void handleAvatarSelect(
                    event,
                    setAvatarUrl,
                    setAvatarFile,
                    setAvatarProcessing,
                    setProfileError
                  )
                }
              />
              <Avatar
                src={editing ? avatarUrl : user.avatarUrl}
                name={displayName || user.displayName || user.username}
                size="lg"
              />

              {editing ? (
                <div className="w-full space-y-3">
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-sidebar/70 bg-background/40 px-4 py-4">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={avatarProcessing || saving}
                      className="rounded-xl border border-sidebar px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {avatarProcessing ? "Processing image..." : "Choose profile picture"}
                    </button>
                    <p className="text-center text-xs text-muted">
                      JPG, PNG, GIF, or WebP. We resize it automatically before saving.
                    </p>
                  </div>
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
                  {profileError && (
                    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{profileError}</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-lg border border-sidebar px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
                      onClick={() => {
                        setDisplayName(user.displayName ?? "");
                        setBio(user.bio ?? "");
                        setAvatarUrl(user.avatarUrl ?? "");
                        setAvatarFile(null);
                        setAvatarProcessing(false);
                        setProfileError("");
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary px-4 py-1.5 text-sm"
                      disabled={saving || avatarProcessing || !displayName.trim()}
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
                <div className="rounded-xl border border-sidebar/70 bg-background/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Accounts</p>
                      <p className="mt-0.5 text-sm text-muted">Quick access for accounts used on this browser.</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-sidebar px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
                      onClick={() => {
                        onClose();
                        router.push("/login");
                      }}
                    >
                      Add account
                    </button>
                  </div>

                  {knownAccounts.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {knownAccounts.map((account) => (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => {
                            onClose();
                            router.push("/login");
                          }}
                          className="flex w-full items-center gap-3 rounded-xl border border-sidebar/70 px-3 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <Avatar
                            src={account.avatarUrl}
                            name={account.displayName || account.username}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {account.displayName || account.username}
                            </p>
                            <p className="truncate text-xs text-muted">@{account.username}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

async function handleAvatarSelect(
  event: ChangeEvent<HTMLInputElement>,
  setAvatarUrl: (value: string) => void,
  setAvatarFile: (value: File | null) => void,
  setAvatarProcessing: (value: boolean) => void,
  setProfileError: (value: string) => void
) {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setProfileError("Please choose an image file");
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    setProfileError("Please choose an image smaller than 6MB");
    return;
  }

  setAvatarProcessing(true);
  setProfileError("");

  try {
    const resized = await resizeImage(file, 512);
    setAvatarUrl(URL.createObjectURL(resized));
    setAvatarFile(resized);
  } catch {
    setProfileError("We couldn't process that image");
  } finally {
    setAvatarProcessing(false);
  }
}

async function resizeImage(file: File, maxSize: number) {
  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }

  context.drawImage(image, 0, 0, width, height);
  const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const quality = mimeType === "image/png" ? undefined : 0.86;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  if (!blob) {
    throw new Error("Image encoding failed");
  }
  const extension = mimeType === "image/png" ? "png" : "jpg";
  return new File([blob], `avatar.${extension}`, { type: mimeType });
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function readKnownAccounts(): KnownAccount[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    return JSON.parse(window.localStorage.getItem("deco_known_accounts") ?? "[]") as KnownAccount[];
  } catch {
    return [];
  }
}
