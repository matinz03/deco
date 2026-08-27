"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { generateKeyPair, loadPrivateKey, storePrivateKey } from "@deco/crypto";
import { api, setClerkTokenProvider } from "@/lib/api";

/**
 * Binds a Clerk identity to a Deco profile and an X25519 key.
 *
 * On the legacy path, register inserts the user and their public key in one
 * statement. Clerk creates the identity outside the database, so something has
 * to close that gap. Doing it from the client rather than a Clerk webhook is
 * deliberate: a webhook races the user's first authenticated request and can
 * leave an account with no public key, which breaks the E2E model.
 *
 * Also registers the Clerk token provider for lib/api.ts, so every request
 * carries a fresh short-lived Clerk token once a session exists.
 *
 * Renders nothing.
 */
export function ClerkBootstrapGate() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const bootstrapped = useRef(false);
  const [, setError] = useState<string | null>(null);

  // Register the token provider as soon as Clerk is ready, and before the
  // bootstrap effect runs — the bootstrap call itself needs the token.
  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setClerkTokenProvider(null);
      return;
    }

    setClerkTokenProvider(() => getToken());
    return () => setClerkTokenProvider(null);
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user || bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      try {
        // Does a Deco profile already exist for this Clerk identity? The API
        // answers 409 profile_required when the token is valid but no row
        // exists, which is the signal to bootstrap.
        let profile = await api.users.getMe().catch(() => null);

        if (!profile) {
          const username = deriveUsername(user);
          const keypair = generateKeyPair();

          profile = await api.profile.bootstrap({
            publicKey: keypair.publicKey,
            username,
            displayName: user.fullName ?? username,
            email: user.primaryEmailAddress?.emailAddress ?? "",
            phoneNumber: user.primaryPhoneNumber?.phoneNumber ?? "",
          });

          // Store the private key only after the server has accepted the
          // public one, and key it by the Deco user id the server assigned.
          // Storing first would orphan a key if bootstrap were rejected.
          await storePrivateKey(profile.id, keypair.privateKey);
        } else if (!(await loadPrivateKey(profile.id))) {
          // Profile exists but this device has no private key: another device
          // bootstrapped, or local storage was cleared. public_key is
          // immutable server-side, so a new keypair would be refused — the
          // passphrase key backup is the only recovery path. KeyBackupGate
          // owns that flow; do not silently generate a second key here.
          setError("key_missing_on_this_device");
        }
      } catch (err) {
        // Leave bootstrapped.current true: retrying a failing bootstrap on
        // every render would hammer the API. A reload retries.
        setError(err instanceof Error ? err.message : "bootstrap_failed");
      }
    })();
  }, [isLoaded, isSignedIn, user]);

  return null;
}

/**
 * Clerk accounts need not have a username; Deco requires one and it must be
 * unique. Prefer Clerk's username, fall back to the email local part, and
 * sanitise to what the users table and search indexes expect.
 */
function deriveUsername(user: {
  username?: string | null;
  primaryEmailAddress?: { emailAddress?: string } | null;
  id: string;
}): string {
  const candidate =
    user.username ??
    user.primaryEmailAddress?.emailAddress?.split("@")[0] ??
    "";

  const cleaned = candidate.toLowerCase().replace(/[^a-z0-9_]/g, "");

  // The schema requires a non-empty unique username; fall back to a suffix of
  // the Clerk id rather than sending something the API will reject.
  if (cleaned.length >= 4) return cleaned.slice(0, 64);
  return `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-12).toLowerCase()}`;
}
