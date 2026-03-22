"use client";

import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Apply system theme on mount and watch for changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    function apply(dark: boolean) {
      document.documentElement.classList.toggle("dark", dark);
    }

    apply(mq.matches);
    const handleChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  return <>{children}</>;
}
