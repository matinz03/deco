import type { WSEvent } from "@deco/types";
import { mapWSEvent, resolveAuthToken } from "./api";

type Listener = (event: WSEvent) => void;

export function resolveWebSocketURL() {
  const explicitURL = process.env.NEXT_PUBLIC_WS_URL;
  if (explicitURL) {
    return explicitURL;
  }

  const apiURL = process.env.NEXT_PUBLIC_API_URL;
  if (apiURL) {
    return apiURL
      .replace(/^http:\/\//i, "ws://")
      .replace(/^https:\/\//i, "wss://")
      .replace(/\/api(?:\/v\d+)?\/?$/i, "");
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}`;
  }

  return "ws://localhost:8080";
}

export class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private url = "";
  private shouldReconnect = true;
  private boundBrowserRecovery = false;
  private connecting = false;
  private connectionGeneration = 0;

  private hasActiveSocket() {
    return this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING;
  }

  connect(url = resolveWebSocketURL()) {
    this.url = url;
    this.shouldReconnect = true;
    this.bindBrowserRecovery();

    if (this.hasActiveSocket()) {
      return;
    }

    void this._connect();
  }

  private bindBrowserRecovery() {
    if (this.boundBrowserRecovery || typeof window === "undefined") {
      return;
    }

    const recover = () => {
      if (!this.shouldReconnect) {
        return;
      }

      if (this.hasActiveSocket()) {
        return;
      }

      void this._connect();
    };

    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        recover();
      }
    });

    this.boundBrowserRecovery = true;
  }

  private async _connect() {
    if (this.connecting || !this.shouldReconnect || !this.url) return;
    if (this.hasActiveSocket()) return;

    const generation = ++this.connectionGeneration;
    this.connecting = true;

    const token = await resolveAuthToken();
    if (generation !== this.connectionGeneration) return;
    this.connecting = false;

    if (!this.shouldReconnect || !token || !this.url) {
      if (this.shouldReconnect) this.scheduleReconnect();
      return;
    }

    if (this.hasActiveSocket()) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const baseURL = this.url.replace(/\/$/, "");
    const socketURL = `${baseURL.endsWith("/ws") ? baseURL : `${baseURL}/ws`}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(socketURL);
    this.ws = socket;

    socket.onopen = () => {
      this.reconnectDelay = 1000;
    };

    socket.onmessage = (e) => {
      try {
        const chunks = String(e.data)
          .split("\n")
          .map((chunk) => chunk.trim())
          .filter(Boolean);

        for (const chunk of chunks) {
          const event: WSEvent = mapWSEvent(JSON.parse(chunk));
          this.listeners.get(event.type)?.forEach((fn) => fn(event));
          this.listeners.get("*")?.forEach((fn) => fn(event));
        }
      } catch {
        // Ignore malformed frames and wait for the next event.
      }
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;

      if (!this.shouldReconnect) {
        return;
      }

      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.shouldReconnect) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      void this._connect();
    }, this.reconnectDelay);
  }

  on(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    this.connectionGeneration += 1;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsClient = new WSClient();
