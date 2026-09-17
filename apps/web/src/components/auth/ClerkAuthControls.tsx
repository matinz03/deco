import { Show, SignInButton, SignUpButton } from "@clerk/nextjs";

export function ClerkAuthControls({ mode }: { mode: "sign-in" | "sign-up" }) {
  return (
    <Show when="signed-out">
      {mode === "sign-in" ? (
        <SignInButton>
          <button type="button" className="btn-primary w-full">
            Continue with Clerk
          </button>
        </SignInButton>
      ) : (
        <SignUpButton>
          <button type="button" className="btn-primary w-full">
            Create account with Clerk
          </button>
        </SignUpButton>
      )}
    </Show>
  );
}
