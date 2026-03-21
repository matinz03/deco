"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth";

// Call once at the app root to rehydrate auth state from localStorage
export function useHydration() {
  const hydrate = useAuthStore((s) => s.hydrate);
  useEffect(() => { hydrate(); }, [hydrate]);
}
