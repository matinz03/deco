import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

/**
 * Clerk sign-in controls, shown alongside the existing bcrypt LoginForm while
 * both auth paths coexist.
 *
 * This is deliberately additive: the legacy form stays the primary path until
 * the Go API flips CLERK_ENABLED on (internal/config/clerk.go defaults it to
 * false). Nothing here touches store/auth.ts, so `deco_token`, the `auth_token`
 * cookie, and multi-account switching keep working unchanged.
 *
 * Rendered only when Clerk is configured — see the caller.
 */
export function ClerkAuthControls() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-foreground/10" />
        <span className="text-xs uppercase tracking-wider text-muted">or</span>
        <span className="h-px flex-1 bg-foreground/10" />
      </div>

      <Show when="signed-out">
        <div className="flex flex-col gap-2">
          <SignInButton>
            <button
              type="button"
              className="w-full rounded-xl border border-foreground/15 px-4 py-2.5 text-sm font-medium hover:bg-foreground/5 transition-colors"
            >
              Continue with Clerk
            </button>
          </SignInButton>
          <SignUpButton>
            <button
              type="button"
              className="w-full rounded-xl px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              Create an account with Clerk
            </button>
          </SignUpButton>
        </div>
      </Show>

      <Show when="signed-in">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-foreground/15 px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Signed in with Clerk</span>
            <span className="text-xs text-muted">
              Your Deco profile is created on first use.
            </span>
          </div>
          <UserButton />
        </div>
      </Show>
    </div>
  );
}
