import dynamic from "next/dynamic";

const AuthBackground = dynamic(
  () => import("@/components/auth/AuthBackground").then((m) => m.AuthBackground),
  { ssr: false }
);

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-app flex items-center justify-center bg-background relative overflow-hidden">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-md px-6">{children}</div>
    </div>
  );
}
