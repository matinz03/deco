import { LoginForm } from "@/components/auth/LoginForm";
import Link from "next/link";

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

      <p className="text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-foreground font-medium underline underline-offset-4 hover:opacity-70 transition-opacity">
          Create one
        </Link>
      </p>
    </div>
  );
}
