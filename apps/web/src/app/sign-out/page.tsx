"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { useAuthStore } from "@/store/auth";

/**
 * The single exit for both auth paths.
 *
 * There are two independent sessions while Clerk and the legacy bcrypt login
 * coexist, and proxy.ts counts EITHER as authenticated: a live Clerk session,
 * or the mere presence of the legacy `auth_token` cookie (Max-Age 604800).
 * Clearing one leaves the other holding the door open, and /login then bounces
 * to /inbox by the redirect-authenticated-users-away rule — the user is stuck
 * inside with no way out.
 *
 * So this page ends BOTH, in order, then leaves with a full navigation so the
 * proxy re-evaluates against the real cookie state.
 *
 * It works from either entry point: ClerkProvider's `afterSignOutUrl` sends
 * users here once Clerk is already signed out (the signOut call is then a
 * harmless no-op), and typing /sign-out directly does the whole job.
 *
 * Deliberately NOT in PUBLIC_ROUTES: public routes bounce authenticated users
 * to /inbox, which is exactly the trap this page exists to escape.
 */
export default function SignOutPage() {
  const logout = useAuthStore((state) => state.logout);
  const { signOut, loaded } = useClerk();
  const ran = useRef(false);
  const [stalled, setStalled] = useState(false);

  // Armed unconditionally. If Clerk never loads at all — a blocked script, a
  // network failure — the effect below never runs, so the escape hatch cannot
  // live inside it or the user gets a spinner with no way out.
  useEffect(() => {
    const escapeHatch = setTimeout(() => setStalled(true), 8000);
    return () => clearTimeout(escapeHatch);
  }, []);

  useEffect(() => {
    // Wait for Clerk to load. Calling signOut() before it is ready is a no-op,
    // which would leave a live Clerk session and put the user straight back
    // into the app.
    if (!loaded || ran.current) return;
    ran.current = true;

    void (async () => {
      // Legacy session first, and locally. logout() awaits POST /auth/logout
      // before clearing, so an unreachable API would otherwise strand the user
      // here; the direct clear below is what actually has to happen.
      try {
        await Promise.race([
          logout(),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch {
        // Clearing local state is what matters, not the server acknowledging.
      }

      // Belt and braces: drop exactly what the proxy and the API client read,
      // in case logout() lost its race or threw.
      try {
        localStorage.removeItem("deco_token");
        localStorage.removeItem("deco_user");
        document.cookie =
          "auth_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      } catch {
        // Storage can throw in restricted contexts; carry on.
      }

      // Clerk last, and let IT own the navigation. Racing signOut against a
      // timeout and navigating ourselves would land on /login while the Clerk
      // session was still live — and the proxy would bounce us straight back
      // to /inbox, which is the bug this page exists to fix.
      try {
        await signOut({ redirectUrl: "/login" });
      } catch {
        // If Clerk cannot complete, fall through to the manual navigation.
      }

      // Reached only if signOut resolved without navigating (already signed
      // out, or it failed). Safe either way — the legacy session is gone.
      window.location.replace("/login");
    })();
  }, [loaded, signOut, logout]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted">Signing out…</p>
      {stalled && (
        <a
          href="/login"
          className="text-sm underline underline-offset-4 hover:opacity-70"
        >
          Taking too long — go to sign in
        </a>
      )}
    </div>
  );
}
