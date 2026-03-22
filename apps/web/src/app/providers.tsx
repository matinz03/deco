"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { useAuthStore } from "@/store/auth";

function HydrationGate({ children }: { children: React.ReactNode }) {
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const user = useAuthStore((s) => s.user);

  useEffect(() => { hydrate(); }, [hydrate]);

  useEffect(() => {
    if (!user || typeof window === "undefined" || typeof Notification === "undefined") {
      return;
    }

    if (Notification.permission !== "default") {
      return;
    }

    const timer = window.setTimeout(() => {
      void Notification.requestPermission().catch(() => {});
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [user]);

  if (!isHydrated) return null; // Prevent flash of unauthenticated content

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60 * 1000, retry: 1 },
        },
      })
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <HydrationGate>{children}</HydrationGate>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
