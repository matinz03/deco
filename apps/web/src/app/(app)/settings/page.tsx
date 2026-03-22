"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";

export default function SettingsPage() {
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
    <div className="flex h-full w-full max-w-xl flex-col px-4 pt-10 mx-auto">
      <h1 className="mb-8 text-xl font-semibold">Settings</h1>

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Profile</h2>
        <div className="overflow-hidden rounded-2xl border border-sidebar bg-muted/50">
          <div className="flex items-center gap-4 border-b border-sidebar px-4 py-4">
            <Avatar src={user?.avatarUrl} name={user?.displayName ?? "?"} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{user?.displayName}</p>
              <p className="truncate text-sm text-muted">@{user?.username}</p>
            </div>
            <button className="ml-auto shrink-0 text-sm text-primary hover:underline">Edit</button>
          </div>
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
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300"
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
                  <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{backupWarning}</p>
                )}
                {(backupError || localError) && (
                  <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">
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
                className="rounded-xl border border-red-500/30 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
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
            onClick={() => void logout()}
            className="w-full px-4 py-3 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
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
