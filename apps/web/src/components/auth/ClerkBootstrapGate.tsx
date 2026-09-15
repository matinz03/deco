"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import {
  deletePrivateKey,
  generateKeyPair,
  loadPrivateKey,
  storePrivateKey,
} from "@deco/crypto";
import { ApiError, api, setClerkTokenProvider } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

type BootstrapResult = {
  profile: Awaited<ReturnType<typeof api.users.getMe>>;
  reason: "hydrate" | "signup";
};

type BootstrapRun = {
  subject: string;
  controller: AbortController;
  promise: Promise<BootstrapResult>;
};

export function ClerkBootstrapGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const establishClerkSession = useAuthStore((state) => state.establishClerkSession);
  const clearClerkSession = useAuthStore((state) => state.clearClerkSession);
  const bootstrapRun = useRef<BootstrapRun | null>(null);
  const completedSubject = useRef<string | null>(null);
  const observedSubject = useRef<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
    if (!isLoaded) return;

    if (!isSignedIn || !user) {
      bootstrapRun.current?.controller.abort();
      bootstrapRun.current = null;
      completedSubject.current = null;
      observedSubject.current = null;
      clearClerkSession();
      setError(null);
      setPhase("ready");
      return;
    }

    if (observedSubject.current && observedSubject.current !== user.id) {
      bootstrapRun.current?.controller.abort();
      window.location.reload();
      return;
    }
    observedSubject.current = user.id;

    if (completedSubject.current === user.id) {
      setPhase("ready");
      return;
    }

    clearClerkSession();
    setError(null);
    setPhase("loading");

    if (bootstrapRun.current?.subject !== user.id) {
      bootstrapRun.current?.controller.abort();
      const controller = new AbortController();
      bootstrapRun.current = {
        subject: user.id,
        controller,
        promise: (async () => {
          const sessionToken = await getToken();
          if (!sessionToken) throw new Error("Clerk session token is unavailable");
          try {
            const profile = await api.users.getMe(sessionToken, controller.signal);
            await recoverPendingBootstrapKey(user.id, profile);
            return { profile, reason: "hydrate" };
          } catch (requestError) {
            const profileRequired =
              requestError instanceof ApiError &&
              requestError.status === 409 &&
              requestError.message === "profile_required";
            if (!profileRequired) throw requestError;
          }

          const username = deriveUsername(user);
          const keypair = await getOrCreatePendingBootstrapKey(user.id);
          const profile = await api.profile.bootstrap(
            {
              publicKey: keypair.publicKey,
              username,
              displayName: user.fullName ?? username,
              email: user.primaryEmailAddress?.emailAddress ?? "",
              phoneNumber: user.primaryPhoneNumber?.phoneNumber ?? "",
            },
            sessionToken,
            controller.signal
          );

          await storePrivateKey(profile.id, keypair.privateKey);
          await deletePrivateKey(pendingKeyID(user.id));
          return { profile, reason: "signup" };
        })(),
      };
    }

    const run = bootstrapRun.current;
    let cancelled = false;

    void run.promise
      .then(async ({ profile, reason }) => {
        if (cancelled || bootstrapRun.current !== run) return;
        await establishClerkSession(profile, reason);
        if (cancelled || bootstrapRun.current !== run) return;
        completedSubject.current = run.subject;
        setPhase("ready");
      })
      .catch((bootstrapError) => {
        if (cancelled || bootstrapRun.current !== run) return;
        setError(
          bootstrapError instanceof Error
            ? bootstrapError.message
            : "Could not initialize your Deco account"
        );
        setPhase("error");
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, clearClerkSession, establishClerkSession, getToken, isLoaded, isSignedIn, user]);

  if (!isLoaded || phase === "loading") {
    return <SessionStatus title="Preparing your secure session…" />;
  }

  if (phase === "error") {
    return (
      <SessionStatus title="We could not start your secure session" error={error}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            bootstrapRun.current?.controller.abort();
            bootstrapRun.current = null;
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
        <button
          type="button"
          className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium"
          onClick={() => void signOut({ redirectUrl: "/login" })}
        >
          Sign out
        </button>
      </SessionStatus>
    );
  }

  return children;
}

function SessionStatus({
  title,
  error,
  children,
}: {
  title: string;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 text-center shadow-2xl">
        <h1 className="text-xl font-semibold">{title}</h1>
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        {children && <div className="mt-6 flex justify-center gap-3">{children}</div>}
      </div>
    </div>
  );
}

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
  const suffix = user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-12).toLowerCase();
  const base = cleaned.length >= 2 ? cleaned : "user";
  return `${base.slice(0, 51)}_${suffix}`;
}

function pendingKeyID(subject: string) {
  return `clerk-bootstrap:${subject}`;
}

async function getOrCreatePendingBootstrapKey(subject: string) {
  const stored = await loadPrivateKey(pendingKeyID(subject));
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { publicKey?: string; privateKey?: string };
      if (parsed.publicKey && parsed.privateKey) {
        return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
      }
    } catch {
      await deletePrivateKey(pendingKeyID(subject));
    }
  }

  const keypair = generateKeyPair();
  await storePrivateKey(pendingKeyID(subject), JSON.stringify(keypair));
  return keypair;
}

async function recoverPendingBootstrapKey(
  subject: string,
  profile: Awaited<ReturnType<typeof api.users.getMe>>
) {
  if (await loadPrivateKey(profile.id)) {
    await deletePrivateKey(pendingKeyID(subject));
    return;
  }

  const stored = await loadPrivateKey(pendingKeyID(subject));
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored) as { publicKey?: string; privateKey?: string };
    if (parsed.publicKey === profile.publicKey && parsed.privateKey) {
      await storePrivateKey(profile.id, parsed.privateKey);
      await deletePrivateKey(pendingKeyID(subject));
    }
  } catch {
    // A malformed staging record cannot be trusted as the profile's key.
  }
}
