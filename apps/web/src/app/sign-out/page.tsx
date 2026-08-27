"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/auth";

/**
 * Landing point after a Clerk sign-out.
 *
 * Clerk clears only its own session. The legacy bcrypt path stores a separate
 * `auth_token` cookie (Max-Age 604800) plus `deco_token`/`deco_user` in
 * localStorage, and proxy.ts treats the presence of that cookie as
 * authentication — so signing out of Clerk left the old session holding the
 * door open and the user stuck inside the app, unable to reach /login.
 *
 * This clears the legacy session too, then leaves for /login with a full
 * navigation so the proxy re-evaluates with the cookie actually gone.
 *
 * Deliberately NOT in PUBLIC_ROUTES: public routes bounce authenticated users
 * to /inbox, which is exactly the trap this page exists to escape.
 */
export default function SignOutPage() {
  const logout = useAuthStore((state) => state.logout);
  const ran = useRef(false);

  useEffect(() => {
    // React strict mode double-invokes effects in development.
    if (ran.current) return;
    ran.current = true;

    void (async () => {
      try {
        // logout() awaits POST /auth/logout before clearing local state, so an
        // unreachable API leaves the user watching this page until the fetch
        // gives up. Leaving is not allowed to depend on the server answering.
        await Promise.race([
          logout(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // Clearing local state is what matters; we leave for /login regardless.
      } finally {
        // Belt and braces: if logout() lost the race, drop the credentials the
        // proxy and API client actually read, so /login is not bounced back to
        // /inbox and no stale bearer token survives.
        try {
          localStorage.removeItem("deco_token");
          localStorage.removeItem("deco_user");
          document.cookie =
            "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        } catch {
          // Storage can throw in restricted contexts; the redirect still runs.
        }
        window.location.replace("/login");
      }
    })();
  }, [logout]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted">Signing out…</p>
    </div>
  );
}
