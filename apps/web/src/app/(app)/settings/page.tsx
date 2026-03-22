"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";
import { useTheme } from "@/components/ui/ThemeProvider";
import {
  BACKGROUND_THEMES,
  type BackgroundThemeId,
  getBackgroundTheme,
  setBackgroundTheme,
} from "@/store/backgroundTheme";

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [bgTheme, setBgTheme] = useState<BackgroundThemeId>("geometric");
  useEffect(() => { setBgTheme(getBackgroundTheme()); }, []);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasLocalPrivateKey = useAuthStore((s) => s.hasLocalPrivateKey);
  const hasServerKeyBackup = useAuthStore((s) => s.hasServerKeyBackup);
  const backupBusy = useAuthStore((s) => s.backupBusy);
  const backupWarning = useAuthStore((s) => s.backupWarning);
  const backupError = useAuthStore((s) => s.backupError);
  const refreshKeyBackupStatus = useAuthStore((s) => s.refreshKeyBackupStatus);
  const createKeyBackup = useAuthStore((s) => s.createKeyBackup);
  const changeKeyBackupPassphrase = useAuthStore((s) => s.changeKeyBackupPassphrase);
  const deleteKeyBackup = useAuthStore((s) => s.deleteKeyBackup);
  const clearBackupError = useAuthStore((s) => s.clearBackupError);

  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [profileError, setProfileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"create" | "change" | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    void refreshKeyBackupStatus("settings");
  }, [refreshKeyBackupStatus]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError("");
    clearBackupError();

    if (!mode) return;

    if (passphrase.length < 8) {
      setLocalError("Use at least 8 characters for your backup passphrase");
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setLocalError("Passphrases do not match");
      return;
    }

    if (mode === "create") {
      await createKeyBackup(passphrase);
    } else {
      await changeKeyBackupPassphrase(passphrase);
    }

    setMode(null);
    setPassphrase("");
    setConfirmPassphrase("");
  }

  async function handleDeleteBackup() {
    const confirmed = window.confirm(
      "Delete your server backup? This device will still work, but new devices will not be able to restore encrypted history."
    );

    if (!confirmed) {
      return;
    }

    await deleteKeyBackup();
  }

  return (
    <div className="overflow-y-auto h-full w-full"><div className="max-w-xl flex flex-col px-4 pt-10 pb-24 md:pb-10 mx-auto">
      <h1 className="mb-8 text-xl font-semibold">Settings</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Appearance</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted">Choose your preferred colour scheme</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-muted p-1">
              {(["light", "system", "dark"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                    theme === t
                      ? "bg-surface text-foreground shadow-sm"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Animated Background</h2>
        <p className="mb-3 text-xs text-muted">Choose what floats around on the login screen.</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BACKGROUND_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setBgTheme(t.id);
                setBackgroundTheme(t.id);
              }}
              className={`flex flex-col items-center gap-1.5 rounded-2xl border px-2 py-3 text-center transition-all ${
                bgTheme === t.id
                  ? "border-primary bg-primary/8 shadow-sm"
                  : "border-sidebar bg-muted/50 hover:bg-accent"
              }`}
            >
              <span className="text-2xl leading-none">{t.preview}</span>
              <span className="text-xs font-medium leading-tight">{t.name}</span>
              <span className="text-[10px] text-muted leading-tight">{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Profile</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50">
          <div className="flex items-center gap-4 border-b border-sidebar px-4 py-4">
            <Avatar src={user?.avatarUrl} name={user?.displayName ?? "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user?.displayName}</p>
              <p className="truncate text-sm text-muted">@{user?.username}</p>
            </div>
            {!editingProfile && (
              <button
                className="ml-auto shrink-0 text-sm text-primary hover:underline"
                onClick={() => {
                  setDisplayName(user?.displayName ?? "");
                  setBio(user?.bio ?? "");
                  setAvatarUrl(user?.avatarUrl ?? "");
                  setAvatarFile(null);
                  setProfileError("");
                  setEditingProfile(true);
                }}
              >
                Edit
              </button>
            )}
          </div>

          {editingProfile && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!displayName.trim()) {
                  setProfileError("Display name cannot be empty");
                  return;
                }
                if (avatarProcessing) {
                  setProfileError("Please wait for the image to finish processing");
                  return;
                }
                setProfileSaving(true);
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
                  setEditingProfile(false);
                } catch {
                  setProfileError("Failed to save changes");
                } finally {
                  setProfileSaving(false);
                }
              }}
              className="border-b border-sidebar px-4 py-4 flex flex-col gap-3"
            >
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
              <div className="flex items-center gap-4">
                <Avatar src={avatarUrl} name={displayName || user?.displayName || "?"} size="lg" />
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarProcessing}
                    className="rounded-xl border border-sidebar px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {avatarProcessing ? "Processing image..." : "Choose profile picture"}
                  </button>
                  <p className="text-xs text-muted">
                    JPG, PNG, GIF, or WebP. We resize it automatically before saving.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted">Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="input"
                  placeholder="Your display name"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted">Bio</label>
                <input
                  type="text"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="input"
                  placeholder="A short bio (optional)"
                />
              </div>
              {profileError && (
                <p className="text-sm text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{profileError}</p>
              )}
              <div className="flex gap-2">
                <button type="submit" disabled={profileSaving || avatarProcessing} className="btn-primary">
                  {profileSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAvatarUrl(user?.avatarUrl ?? "");
                    setAvatarFile(null);
                    setEditingProfile(false);
                  }}
                  className="rounded-xl border border-sidebar px-4 py-3 text-sm font-medium text-muted hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-muted">Username</span>
            <span className="text-sm text-muted">@{user?.username}</span>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Encryption Backup</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50">
          <div className="border-b border-sidebar px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Cross-device key backup</p>
                <p className="mt-1 text-xs text-muted">
                  Your private key stays encrypted with your passphrase before it is uploaded.
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  hasServerKeyBackup
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                }`}
              >
                {hasServerKeyBackup ? "Backed up" : "Not backed up"}
              </span>
            </div>

            <div className="mt-4 space-y-2 text-xs text-muted">
              <p>Local key on this device: {hasLocalPrivateKey ? "Available" : "Missing"}</p>
              <p>
                Recovery rule: if you forget the passphrase, only a device that already has the local key can create a
                new backup.
              </p>
            </div>

            {(backupWarning || backupError || localError) && (
              <div className="mt-4 space-y-2">
                {backupWarning && (
                  <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">{backupWarning}</p>
                )}
                {(backupError || localError) && (
                  <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                    {localError || backupError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-3 px-4 py-4">
            {!hasServerKeyBackup && (
              <button
                onClick={() => {
                  setMode("create");
                  setLocalError("");
                  clearBackupError();
                }}
                disabled={!hasLocalPrivateKey || backupBusy}
                className="btn-primary"
              >
                Create backup
              </button>
            )}

            {hasServerKeyBackup && (
              <button
                onClick={() => {
                  setMode("change");
                  setLocalError("");
                  clearBackupError();
                }}
                disabled={!hasLocalPrivateKey || backupBusy}
                className="btn-primary"
              >
                Change passphrase
              </button>
            )}

            <button
              onClick={() => void refreshKeyBackupStatus("settings")}
              disabled={backupBusy}
              className="rounded-xl border border-sidebar px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              Refresh status
            </button>

            {hasServerKeyBackup && (
              <button
                onClick={() => void handleDeleteBackup()}
                disabled={backupBusy}
                className="rounded-xl border border-red-500/40 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/10"
              >
                Delete backup
              </button>
            )}
          </div>

          {!hasLocalPrivateKey && (
            <div className="border-t border-sidebar px-4 py-3 text-xs text-muted">
              Restore your key on this device first before creating or changing a backup here.
            </div>
          )}

          {mode && (
            <form onSubmit={(event) => void handleSubmit(event)} className="border-t border-sidebar px-4 py-4">
              <p className="text-sm font-medium">
                {mode === "create" ? "Create a new backup passphrase" : "Choose a replacement backup passphrase"}
              </p>
              <div className="mt-3 space-y-3">
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete="new-password"
                  className="input"
                  placeholder="New backup passphrase"
                />
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                  autoComplete="new-password"
                  className="input"
                  placeholder="Confirm backup passphrase"
                />
              </div>
              <div className="mt-4 flex gap-3">
                <button type="submit" disabled={backupBusy} className="btn-primary">
                  {backupBusy ? "Saving..." : mode === "create" ? "Save backup" : "Replace backup"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode(null);
                    setPassphrase("");
                    setConfirmPassphrase("");
                    setLocalError("");
                    clearBackupError();
                  }}
                  className="rounded-xl border border-sidebar px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Notifications</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50 divide-y divide-sidebar">
          <SettingRow label="Push notifications" description="Get notified about new messages" />
          <SettingRow label="Message previews" description="Show message content in notifications" />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Privacy</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50 divide-y divide-sidebar">
          <SettingRow label="Read receipts" description="Let others see when you've read messages" />
          <SettingRow label="Online status" description="Show when you're active" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Account</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50">
          <button
            onClick={async () => { await logout(); router.replace("/login"); }}
            className="w-full px-4 py-3 text-left text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-500/10"
          >
            Sign out
          </button>
        </div>
      </section>
    </div></div>
  );
}

function SettingRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <Toggle />
    </div>
  );
}

function Toggle() {
  return (
    <div className="relative h-5.5 w-10 cursor-pointer rounded-full border border-sidebar bg-muted">
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-muted-foreground/40 transition-all" />
    </div>
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
