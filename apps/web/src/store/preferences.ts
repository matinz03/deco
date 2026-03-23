"use client";

import { create } from "zustand";

const STORAGE_KEY = "deco_prefs";

type PrefKey = "pushNotifications" | "messagePreviews" | "readReceipts" | "showOnlineStatus";

interface PreferencesState {
  pushNotifications: boolean;
  messagePreviews: boolean;
  readReceipts: boolean;
  showOnlineStatus: boolean;
  hydrate: () => void;
  setPref: (key: PrefKey, value: boolean) => void;
}

function load(): Partial<Record<PrefKey, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Record<PrefKey, boolean>>;
  } catch {
    return {};
  }
}

function save(state: PreferencesState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pushNotifications: state.pushNotifications,
        messagePreviews: state.messagePreviews,
        readReceipts: state.readReceipts,
        showOnlineStatus: state.showOnlineStatus,
      })
    );
  } catch {}
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  pushNotifications: false,
  messagePreviews: true,
  readReceipts: true,
  showOnlineStatus: true,

  hydrate() {
    if (typeof window === "undefined") return;
    const stored = load();
    // Sync pushNotifications with actual browser permission
    const permissionGranted =
      typeof Notification !== "undefined" && Notification.permission === "granted";
    set({
      pushNotifications: permissionGranted && (stored.pushNotifications ?? false),
      messagePreviews: stored.messagePreviews ?? true,
      readReceipts: stored.readReceipts ?? true,
      showOnlineStatus: stored.showOnlineStatus ?? true,
    });
  },

  setPref(key, value) {
    set({ [key]: value });
    save({ ...get(), [key]: value });
  },
}));
