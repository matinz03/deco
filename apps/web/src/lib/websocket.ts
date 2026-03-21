import type { WSEvent } from "@deco/types";

type Listener = (event: WSEvent) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private url = "";

  connect(url: string) {
    this.url = url;
    this._connect();
  }

  private _connect() {
    const token = localStorage.getItem("deco_token");
    if (!token) return;

    this.ws = new WebSocket(`${this.url}?token=${token}`);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000; // Reset backoff on successful connection
    };

    this.ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        this.listeners.get(event.type)?.forEach((fn) => fn(event));
        this.listeners.get("*")?.forEach((fn) => fn(event));
      } catch {}
    };

    this.ws.onclose = () => {
      // Exponential backoff reconnect
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
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton
export const wsClient = new WSClient();
