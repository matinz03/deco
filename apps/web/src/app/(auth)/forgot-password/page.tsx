import Link from "next/link";

export const metadata = { title: "Password recovery — Deco" };

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary">
          <span className="text-lg font-bold tracking-tight text-primary-foreground">D</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Password recovery</h1>
        <p className="text-sm text-muted">Recovery is being designed with your encryption keys in mind.</p>
      </div>

      <div className="rounded-2xl border border-border bg-surface/80 p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V7a4.5 4.5 0 0 0-9 0v3.5m-1.5 0h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 20.5H6A1.5 1.5 0 0 1 4.5 19v-7A1.5 1.5 0 0 1 6 10.5Zm6 4v2" />
          </svg>
          <span>Why recovery takes care</span>
        </div>
        <p className="text-sm leading-6 text-muted">
          Deco cannot replace your encryption identity during a password reset. The final recovery flow will
          explain how to restore access without silently making your existing encrypted messages unreadable.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Link href="/login" className="btn-primary text-center">
          Back to sign in
        </Link>
        <Link
          href="/signup"
          className="rounded-xl border border-border px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-accent"
        >
          Create a new account
        </Link>
      </div>

      <p className="text-center text-xs leading-5 text-muted">
        Already signed in? Change your password from Settings without leaving your current device.
      </p>
    </div>
  );
}
