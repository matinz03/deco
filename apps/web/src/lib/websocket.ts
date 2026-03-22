import type { WSEvent } from "@deco/types";
import { mapWSEvent } from "./api";

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

class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private url = "";
  private shouldReconnect = true;
  private boundBrowserRecovery = false;

  connect(url = resolveWebSocketURL()) {
    this.url = url;
    this.shouldReconnect = true;
    this.bindBrowserRecovery();

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this._connect();
  }

  private bindBrowserRecovery() {
    if (this.boundBrowserRecovery || typeof window === "undefined") {
      return;
    }

    const recover = () => {
      if (!this.shouldReconnect) {
        return;
      }

      if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
        return;
      }

      this._connect();
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

  private _connect() {
    const token = localStorage.getItem("deco_token");
    if (!token || !this.url) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socketURL = `${this.url.replace(/\/$/, "")}/ws?token=${encodeURIComponent(token)}`;
    this.ws = new WebSocket(socketURL);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (e) => {
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

    this.ws.onclose = () => {
      this.ws = null;

      if (!this.shouldReconnect) {
        return;
      }

      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this._connect();
      }, this.reconnectDelay);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
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
