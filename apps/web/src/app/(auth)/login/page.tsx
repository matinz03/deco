import { LoginForm } from "@/components/auth/LoginForm";
import { ClerkAuthControls } from "@/components/auth/ClerkAuthControls";
import Link from "next/link";

// Clerk is opt-in and mirrors the server default (CLERK_ENABLED=false in
// internal/config/clerk.go). Without a publishable key the Clerk controls are
// not rendered at all, so a checkout with no Clerk keys sees the login page
// exactly as before.
const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const metadata = { title: "Sign in — Deco" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-lg tracking-tight">D</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted">Sign in to continue to Deco</p>
      </div>

      <LoginForm />

      {clerkEnabled && <ClerkAuthControls />}

      <p className="text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-foreground font-medium underline underline-offset-4 hover:opacity-70 transition-opacity">
          Create one
        </Link>
      </p>
    </div>
  );
}
