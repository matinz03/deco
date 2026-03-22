"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";

export function KeyBackupGate() {
  const backupPrompt = useAuthStore((s) => s.backupPrompt);
  const backupWarning = useAuthStore((s) => s.backupWarning);
  const backupError = useAuthStore((s) => s.backupError);
  const backupBusy = useAuthStore((s) => s.backupBusy);
  const createKeyBackup = useAuthStore((s) => s.createKeyBackup);
  const restoreKeyBackup = useAuthStore((s) => s.restoreKeyBackup);
  const dismissBackupPrompt = useAuthStore((s) => s.dismissBackupPrompt);
  const clearBackupError = useAuthStore((s) => s.clearBackupError);

  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    setPassphrase("");
    setConfirmPassphrase("");
    setLocalError("");
    clearBackupError();
  }, [backupPrompt, clearBackupError]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError("");

    if (!passphrase.trim()) {
      setLocalError("Passphrase is required");
      return;
    }

    if (backupPrompt === "setup") {
      if (passphrase.length < 8) {
        setLocalError("Use at least 8 characters for your backup passphrase");
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setLocalError("Passphrases do not match");
        return;
      }

      await createKeyBackup(passphrase);
      return;
    }

    if (backupPrompt === "restore") {
      await restoreKeyBackup(passphrase);
    }
  }

  return (
    <>
      {backupWarning && !backupPrompt && (
        <div className="fixed left-4 right-4 top-4 z-40 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-lg backdrop-blur">
          {backupWarning}
        </div>
      )}

      {backupPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 shadow-2xl"
          >
            <h2 className="text-xl font-semibold text-foreground">
              {backupPrompt === "setup" ? "Protect your encryption key" : "Restore your encryption key"}
            </h2>

            <p className="mt-2 text-sm text-muted">
              {backupPrompt === "setup"
                ? "Choose a backup passphrase now so you can recover encrypted messages on another device later."
                : "Enter your backup passphrase to unlock encrypted message history on this device."}
            </p>

            <div className="mt-5 space-y-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  {backupPrompt === "setup" ? "Backup passphrase" : "Passphrase"}
                </span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  autoComplete={backupPrompt === "setup" ? "new-password" : "current-password"}
                  className="input"
                  placeholder={backupPrompt === "setup" ? "Choose a strong passphrase" : "Enter your passphrase"}
                />
              </label>

              {backupPrompt === "setup" && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-foreground">Confirm passphrase</span>
                  <input
                    type="password"
                    value={confirmPassphrase}
                    onChange={(event) => setConfirmPassphrase(event.target.value)}
                    autoComplete="new-password"
                    className="input"
                    placeholder="Repeat your passphrase"
                  />
                </label>
              )}
            </div>

            {(localError || backupError) && (
              <p className="mt-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {localError || backupError}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button type="submit" disabled={backupBusy} className="btn-primary flex-1">
                {backupBusy
                  ? backupPrompt === "setup"
                    ? "Saving backup..."
                    : "Restoring..."
                  : backupPrompt === "setup"
                    ? "Create backup"
                    : "Restore key"}
              </button>
              {backupPrompt === "restore" && (
                <button
                  type="button"
                  onClick={dismissBackupPrompt}
                  disabled={backupBusy}
                  className="rounded-xl border border-sidebar px-4 py-3 text-sm font-medium text-muted transition-colors hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
            </div>

            <p className="mt-4 text-xs text-muted">
              {backupPrompt === "setup"
                ? "If you forget this passphrase, only a device that already has your local key can create a new backup."
                : "If you skip this, encrypted history will stay unavailable on this device until you restore your key."}
            </p>
          </form>
        </div>
      )}
    </>
  );
}
