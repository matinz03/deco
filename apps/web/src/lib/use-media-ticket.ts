"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const REFRESH_SKEW_MS = 30_000;

function ticketExpiry(url: string): number | null {
  try {
    const ticket = new URL(url, window.location.origin).searchParams.get("ticket");
    if (!ticket) return null;
    const payload = ticket.split(".")[0];
	if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const expiresAt = Number(decoded.slice(decoded.lastIndexOf("\n") + 1));
    return Number.isFinite(expiresAt) ? expiresAt * 1000 : null;
  } catch {
    return null;
  }
}

function isPrivateMessageAttachment(url: string | undefined): boolean {
  return Boolean(url && /\/messages\/(images|videos|audio|files)\//.test(url));
}

// Browser media elements cannot attach an Authorization header. This hook
// refreshes a short-lived, server-authorized ticket before it expires while
// leaving public avatars/stickers and local blob previews untouched.
export function useMediaTicketUrl(conversationId: string, messageId: string, initialUrl?: string) {
  const [url, setUrl] = useState(initialUrl ?? "");

  const refresh = useCallback(async () => {
    if (!isPrivateMessageAttachment(initialUrl)) return;
    try {
      const next = await api.messages.getMediaTicket(conversationId, messageId);
      if (next) setUrl(next);
    } catch {
      // Keep the current URL; the next normal message fetch will also issue a
      // replacement ticket, and failed refreshes must not blank the media.
    }
  }, [conversationId, initialUrl, messageId]);

  useEffect(() => {
    setUrl(initialUrl ?? "");
    if (!isPrivateMessageAttachment(initialUrl)) return;
	if (!ticketExpiry(initialUrl ?? "")) void refresh();
  }, [initialUrl, refresh]);

  useEffect(() => {
    const expiry = ticketExpiry(url);
    if (!expiry || !isPrivateMessageAttachment(url)) return;
    const delay = Math.max(0, expiry - Date.now() - REFRESH_SKEW_MS);
    const timer = window.setTimeout(() => { void refresh(); }, delay);
    return () => window.clearTimeout(timer);
  }, [refresh, url]);

  return { url, refresh };
}
