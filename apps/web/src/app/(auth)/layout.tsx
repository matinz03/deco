export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-app flex items-center justify-center bg-background">
      {/* Subtle grid pattern background */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative w-full max-w-md px-6">{children}</div>
    </div>
  );
}
