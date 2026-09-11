"use client";

import { useCallback, useEffect, useState } from "react";
import { decryptBlob } from "@deco/crypto";
import type { Message } from "@deco/types";
import { api } from "./api";
import { useAuthStore } from "@/store/auth";
import { getConversationEncryptionKey, useConversationStore } from "@/store/conversations";

const REFRESH_SKEW_MS = 30_000;
const DECRYPT_RETRY_DELAY_MS = 500;
const MAX_CONCURRENT_DECRYPTIONS = 2;

let activeDecryptions = 0;
const decryptWaiters: Array<() => void> = [];

async function withDecryptSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeDecryptions >= MAX_CONCURRENT_DECRYPTIONS) {
    await new Promise<void>((resolve) => decryptWaiters.push(resolve));
  } else {
    activeDecryptions += 1;
  }

  try {
    return await task();
  } finally {
    const next = decryptWaiters.shift();
    if (next) {
      next();
    } else {
      activeDecryptions -= 1;
    }
  }
}

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, DECRYPT_RETRY_DELAY_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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

async function fetchEncryptedAttachment(
  initialUrl: string,
  signal: AbortSignal,
  refresh: () => Promise<string | null>
): Promise<Response> {
  let requestUrl = initialUrl;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(requestUrl, { credentials: "omit", signal });
    } catch (error) {
      if (signal.aborted || attempt > 0) throw error;
      await waitForRetry(signal);
      continue;
    }

    if (response.ok) return response;

    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      const freshUrl = await refresh();
      if (freshUrl) {
        requestUrl = freshUrl;
        continue;
      }
    }

    if (response.status >= 500 && attempt === 0) {
      await waitForRetry(signal);
      continue;
    }

    throw new Error(`attachment fetch failed: ${response.status}`);
  }

  throw new Error("attachment fetch failed");
}

// Browser media elements cannot attach an Authorization header. Plain media
// gets a short-lived ticket; encrypted media is fetched, decrypted in a
// two-item queue, and exposed only as an in-memory Blob URL while visible.
export function useMediaTicketUrl(
  message: Pick<Message, "conversationId" | "id" | "type" | "mediaUrl" | "mediaMimeType" | "mediaEncrypted">
) {
  const {
    conversationId,
    id: messageId,
    type: messageType,
    mediaUrl: initialUrl,
    mediaMimeType,
    mediaEncrypted,
  } = message;
  const userId = useAuthStore((state) => state.user?.id);
  const conversation = useConversationStore((state) => state.conversations.find((item) => item.id === conversationId));
  const [sourceUrl, setSourceUrl] = useState(initialUrl ?? "");
  const [url, setUrl] = useState(mediaEncrypted ? "" : (initialUrl ?? ""));
  const [observedElement, setObservedElement] = useState<HTMLElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(!mediaEncrypted);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const observe = useCallback((element: HTMLElement | null) => {
    setObservedElement(element);
  }, []);

  const load = useCallback(() => {
    setShouldLoad(true);
    setLoadVersion((version) => version + 1);
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    if (!mediaEncrypted && !isPrivateMessageAttachment(initialUrl)) return null;
    try {
      const next = await api.messages.getMediaTicket(conversationId, messageId);
      if (next) setSourceUrl(next);
      return next || null;
    } catch {
      return null;
    }
  }, [conversationId, initialUrl, mediaEncrypted, messageId]);

  useEffect(() => {
    setSourceUrl(initialUrl ?? "");
    setUrl(mediaEncrypted ? "" : (initialUrl ?? ""));
    setError(null);
    setLoading(false);
    if (mediaEncrypted || !isPrivateMessageAttachment(initialUrl)) return;
    if (!ticketExpiry(initialUrl ?? "")) void refresh();
  }, [initialUrl, mediaEncrypted, refresh]);

  useEffect(() => {
    if (!mediaEncrypted) {
      setShouldLoad(true);
      return;
    }

    setShouldLoad(false);
    if (!observedElement || messageType === "file") return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => setShouldLoad(Boolean(entry?.isIntersecting)), {
      rootMargin: "400px 0px",
    });
    observer.observe(observedElement);
    return () => observer.disconnect();
  }, [mediaEncrypted, messageId, messageType, observedElement]);

  useEffect(() => {
    if (mediaEncrypted) return;
    const expiry = ticketExpiry(sourceUrl);
    if (!expiry || !isPrivateMessageAttachment(sourceUrl)) return;
    const delay = Math.max(0, expiry - Date.now() - REFRESH_SKEW_MS);
    const timer = window.setTimeout(() => {
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [mediaEncrypted, refresh, sourceUrl]);

  useEffect(() => {
    if (!mediaEncrypted) {
      setUrl(sourceUrl);
      return;
    }
    if (!shouldLoad) {
      setUrl("");
      setLoading(false);
      return;
    }
    if (!sourceUrl || !conversation || !userId) {
      setUrl("");
      return;
    }

    let disposed = false;
    let objectUrl = "";
    const controller = new AbortController();
    setUrl("");
    setLoading(true);
    setError(null);

    const decryptAttachment = async () => {
      try {
        await withDecryptSlot(async () => {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const key = await getConversationEncryptionKey(conversation, userId);
          if (!key) throw new Error("attachment key unavailable");
          const response = await fetchEncryptedAttachment(sourceUrl, controller.signal, refresh);
          const plaintext = decryptBlob(new Uint8Array(await response.arrayBuffer()), key);
          objectUrl = URL.createObjectURL(
            new Blob([Uint8Array.from(plaintext)], {
              type: mediaMimeType || "application/octet-stream",
            })
          );
        });

        if (disposed) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = "";
          return;
        }
        setUrl(objectUrl);
        setLoading(false);
      } catch {
        if (!disposed && !controller.signal.aborted) {
          setUrl("");
          setLoading(false);
          setError("Attachment could not be decrypted.");
        }
      }
    };
    void decryptAttachment();

    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversation, loadVersion, mediaEncrypted, mediaMimeType, refresh, shouldLoad, sourceUrl, userId]);

  return { url, refresh, observe, load, loading, error };
}
