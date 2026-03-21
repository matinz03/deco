import { create } from "zustand";
import { api } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { generateKeyPair, storePrivateKey } from "@deco/crypto";
import type { User } from "@deco/types";

interface AuthState {
  user: User | null;
  token: string | null;
  isHydrated: boolean;

  login: (creds: { email?: string; phone?: string; password: string }) => Promise<void>;
  register: (data: {
    username: string;
    displayName: string;
    email?: string;
    phone?: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  isHydrated: false,

  hydrate() {
    const token = localStorage.getItem("deco_token");
    const userRaw = localStorage.getItem("deco_user");
    if (token && userRaw) {
      const user: User = JSON.parse(userRaw);
      set({ token, user, isHydrated: true });
      wsClient.connect(process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080");
    } else {
      set({ isHydrated: true });
    }
  },

  async login({ email, phone, password }) {
    const { token, user } = await api.auth.login({ email, phone, password });
    localStorage.setItem("deco_token", token);
    localStorage.setItem("deco_user", JSON.stringify(user));
    set({ token, user });
    wsClient.connect(process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080");
  },

  async register({ username, displayName, email, phone, password }) {
    // Generate E2E keypair — private key stored locally ONLY
    const { publicKey, privateKey } = await generateKeyPair();

    const { token, user } = await api.auth.register({
      username,
      displayName,
      email,
      phone,
      password,
      publicKey, // only public key goes to server
    });

    // Store private key in IndexedDB, never in localStorage or server
    await storePrivateKey(user.id, privateKey);

    localStorage.setItem("deco_token", token);
    localStorage.setItem("deco_user", JSON.stringify(user));
    set({ token, user });
    wsClient.connect(process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080");
  },

  async logout() {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem("deco_token");
    localStorage.removeItem("deco_user");
    wsClient.disconnect();
    set({ token: null, user: null });
  },
}));
