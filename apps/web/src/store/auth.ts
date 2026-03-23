import { create } from "zustand";
import { api } from "@/lib/api";
import { wsClient, resolveWebSocketURL } from "@/lib/websocket";
import {
  generateKeyPair,
  storePrivateKey,
  loadPrivateKey,
  encryptPrivateKeyForBackup,
  decryptPrivateKeyBackup,
} from "@deco/crypto";
import type { User } from "@deco/types";

type BackupPrompt = "setup" | "restore" | null;
const KNOWN_ACCOUNTS_KEY = "deco_known_accounts";

interface AuthState {
  user: User | null;
  token: string | null;
  isHydrated: boolean;
  hasLocalPrivateKey: boolean;
  hasServerKeyBackup: boolean;
  backupPrompt: BackupPrompt;
  backupWarning: string | null;
  backupError: string | null;
  backupBusy: boolean;

  login: (creds: { email?: string; phone?: string; password: string }) => Promise<void>;
  register: (data: {
    username: string;
    displayName: string;
    email?: string;
    phone?: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshKeyBackupStatus: (reason?: "hydrate" | "login" | "signup" | "settings") => Promise<void>;
  createKeyBackup: (passphrase: string) => Promise<void>;
  changeKeyBackupPassphrase: (passphrase: string) => Promise<void>;
  restoreKeyBackup: (passphrase: string) => Promise<void>;
  deleteKeyBackup: () => Promise<void>;
  dismissBackupPrompt: () => void;
  clearBackupError: () => void;
  updateProfile: (data: { displayName?: string; bio?: string; avatarUrl?: string }) => Promise<void>;
}

async function refreshConversationState() {
  const { useConversationStore } = await import("./conversations");
  const store = useConversationStore.getState();
  await store.fetchConversations();
  if (store.activeConversationId) {
    await store.fetchMessages(store.activeConversationId);
  }
}

async function syncKeyBackupState(
  user: User,
  reason: "hydrate" | "login" | "signup" | "settings",
  set: (partial: Partial<AuthState>) => void
) {
  const privateKey = await loadPrivateKey(user.id);
  const hasLocalPrivateKey = Boolean(privateKey);

  try {
    const response = await api.users.getKeyBackup();
    const hasServerKeyBackup = Boolean(response.exists && response.backup);

    let backupPrompt: BackupPrompt = null;
    let backupWarning: string | null = null;

    if (hasLocalPrivateKey) {
      if (!hasServerKeyBackup) {
        backupWarning =
          reason === "signup"
            ? "Create an encryption backup now so your messages can be restored on other devices."
            : "This device can read your messages, but cross-device recovery is not set up yet.";

        if (reason === "signup") {
          backupPrompt = "setup";
        }
      }
    } else if (hasServerKeyBackup) {
      backupPrompt = "restore";
    } else {
      backupWarning =
        "This device cannot decrypt your older messages because no key backup exists yet.";
    }

    set({
      hasLocalPrivateKey,
      hasServerKeyBackup,
      backupPrompt,
      backupWarning,
      backupError: null,
    });
  } catch {
    set({
      hasLocalPrivateKey,
      hasServerKeyBackup: false,
      backupPrompt: null,
      backupWarning: hasLocalPrivateKey
        ? "We could not verify your encryption backup status right now."
        : "We could not verify or restore your encryption key backup right now.",
      backupError: null,
    });
  }
}

function persistAuth(token: string, user: User) {
  localStorage.setItem("deco_token", token);
  localStorage.setItem("deco_user", JSON.stringify(user));
  rememberKnownAccount(user);
  document.cookie = `auth_token=${token}; path=/; SameSite=Lax; Max-Age=604800`;
}

function rememberKnownAccount(user: User) {
  const nextEntry = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  };

  const existing = readKnownAccounts().filter((account) => account.id !== user.id);
  localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify([nextEntry, ...existing]));
}

function readKnownAccounts(): Array<{
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}> {
  try {
    return JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) ?? "[]") as Array<{
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string;
    }>;
  } catch {
    return [];
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isHydrated: false,
  hasLocalPrivateKey: false,
  hasServerKeyBackup: false,
  backupPrompt: null,
  backupWarning: null,
  backupError: null,
  backupBusy: false,

  async hydrate() {
    const token = localStorage.getItem("deco_token");
    const userRaw = localStorage.getItem("deco_user");

    if (!token || !userRaw) {
      set({ isHydrated: true });
      return;
    }

    const user: User = JSON.parse(userRaw);
    set({ token, user });
    wsClient.connect(resolveWebSocketURL());
    await syncKeyBackupState(user, "hydrate", set);
    set({ isHydrated: true });
  },

  async login({ email, phone, password }) {
    const { token, user } = await api.auth.login({ email, phone, password });
    persistAuth(token, user);
    set({ token, user });
    wsClient.connect(resolveWebSocketURL());
    await syncKeyBackupState(user, "login", set);
  },

  async register({ username, displayName, email, phone, password }) {
    const { publicKey, privateKey } = generateKeyPair();
    const { token, user } = await api.auth.register({
      username,
      displayName,
      email,
      phone,
      password,
      publicKey,
    });

    await storePrivateKey(user.id, privateKey);

    persistAuth(token, user);
    set({ token, user });
    wsClient.connect(resolveWebSocketURL());
    await syncKeyBackupState(user, "signup", set);
  },

  async logout() {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem("deco_token");
    localStorage.removeItem("deco_user");
    document.cookie = "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    wsClient.disconnect();
    set({
      token: null,
      user: null,
      hasLocalPrivateKey: false,
      hasServerKeyBackup: false,
      backupPrompt: null,
      backupWarning: null,
      backupError: null,
      backupBusy: false,
    });
  },

  async refreshKeyBackupStatus(reason = "settings") {
    const user = get().user;
    if (!user) return;
    await syncKeyBackupState(user, reason, set);
  },

  async createKeyBackup(passphrase) {
    const user = get().user;
    if (!user) {
      throw new Error("You must be signed in");
    }

    const privateKey = await loadPrivateKey(user.id);
    if (!privateKey) {
      throw new Error("This device does not have your local private key yet");
    }

    set({ backupBusy: true, backupError: null });

    try {
      const payload = await encryptPrivateKeyForBackup(privateKey, passphrase);
      await api.users.putKeyBackup(payload);
      set({
        hasLocalPrivateKey: true,
        hasServerKeyBackup: true,
        backupPrompt: null,
        backupWarning: null,
        backupError: null,
      });
    } catch (error) {
      set({
        backupError: error instanceof Error ? error.message : "Failed to create key backup",
      });
      throw error;
    } finally {
      set({ backupBusy: false });
    }
  },

  async changeKeyBackupPassphrase(passphrase) {
    await get().createKeyBackup(passphrase);
  },

  async restoreKeyBackup(passphrase) {
    const user = get().user;
    if (!user) {
      throw new Error("You must be signed in");
    }

    set({ backupBusy: true, backupError: null });

    try {
      const response = await api.users.getKeyBackup();
      if (!response.exists || !response.backup) {
        throw new Error("No server backup is available for this account");
      }

      const privateKey = await decryptPrivateKeyBackup(response.backup, passphrase);
      await storePrivateKey(user.id, privateKey);
      await refreshConversationState();

      set({
        hasLocalPrivateKey: true,
        hasServerKeyBackup: true,
        backupPrompt: null,
        backupWarning: null,
        backupError: null,
      });
    } catch (error) {
      set({
        backupError: error instanceof Error ? error.message : "Failed to restore key backup",
      });
      throw error;
    } finally {
      set({ backupBusy: false });
    }
  },

  async deleteKeyBackup() {
    const user = get().user;
    if (!user) {
      throw new Error("You must be signed in");
    }

    set({ backupBusy: true, backupError: null });

    try {
      await api.users.deleteKeyBackup();
      const hasLocalPrivateKey = Boolean(await loadPrivateKey(user.id));
      set({
        hasLocalPrivateKey,
        hasServerKeyBackup: false,
        backupPrompt: null,
        backupWarning: hasLocalPrivateKey
          ? "Your local key still works here, but cross-device recovery is now disabled."
          : "This device cannot decrypt older messages and no server backup is available.",
      });
    } catch (error) {
      set({
        backupError: error instanceof Error ? error.message : "Failed to delete key backup",
      });
      throw error;
    } finally {
      set({ backupBusy: false });
    }
  },

  dismissBackupPrompt() {
    const prompt = get().backupPrompt;
    set({
      backupPrompt: null,
      backupWarning:
        prompt === "setup"
          ? "Cross-device recovery is not set up yet."
          : "This device cannot decrypt older messages until you restore your key backup.",
    });
  },

  clearBackupError() {
    set({ backupError: null });
  },

  async updateProfile(data) {
    const updated = await api.users.updateMe(data);
    set({ user: updated });
    localStorage.setItem("deco_user", JSON.stringify(updated));
    rememberKnownAccount(updated);
  },
}));
