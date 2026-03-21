import { SignupForm } from "@/components/auth/SignupForm";
import Link from "next/link";

export const metadata = { title: "Create account — Deco" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center">
          <span className="text-primary-foreground font-bold text-lg tracking-tight">D</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted">Start messaging privately and freely</p>
      </div>

      <SignupForm />

      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground font-medium underline underline-offset-4 hover:opacity-70 transition-opacity">
          Sign in
        </Link>
      </p>
    </div>
  );
}
