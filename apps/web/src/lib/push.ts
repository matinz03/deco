const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function getVAPIDPublicKey(): Promise<string> {
  const token = localStorage.getItem("deco_token");
  const res = await fetch(`${BASE}/api/v1/push/vapid-public-key`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error("Failed to fetch VAPID public key");
  const data = await res.json();
  return data.publicKey as string;
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const token = localStorage.getItem("deco_token");
  if (!token) return;
  await fetch(`${BASE}/api/v1/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(sub.toJSON()),
  });
}

async function removeSubscription(endpoint: string): Promise<void> {
  const token = localStorage.getItem("deco_token");
  if (!token) return;
  await fetch(`${BASE}/api/v1/push/unsubscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
}

/**
 * Registers the service worker and subscribes to Web Push.
 * Safe to call on every app load — no-ops if already subscribed.
 */
export async function registerPush(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    // Wait for the service worker to be active
    await navigator.serviceWorker.ready;

    // Check current permission — don't prompt immediately
    if (Notification.permission === "denied") return;

    const vapidPublicKey = await getVAPIDPublicKey().catch(() => null);
    if (!vapidPublicKey) return;

    let sub = await registration.pushManager.getSubscription();

    if (!sub) {
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
      }

      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    await saveSubscription(sub);
  } catch {
    // Push not supported or user declined — non-fatal
  }
}

/**
 * Unsubscribes from Web Push and notifies the backend.
 */
export async function unregisterPush(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return;

    const sub = await registration.pushManager.getSubscription();
    if (!sub) return;

    await removeSubscription(sub.endpoint);
    await sub.unsubscribe();
  } catch {
    // Non-fatal
  }
}
