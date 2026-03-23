"use client";

import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS = [400, 900, 1800];

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const attemptsRef = useRef(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    const attempt = attemptsRef.current;
    if (attempt >= RETRY_DELAYS.length) {
      setExhausted(true);
      return;
    }
    attemptsRef.current += 1;
    const timer = window.setTimeout(() => {
      reset();
    }, RETRY_DELAYS[attempt]);
    return () => window.clearTimeout(timer);
  }, [reset]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-8">
      {exhausted ? (
        <>
          <p className="text-sm font-medium">Something went wrong loading this conversation.</p>
          <button onClick={reset} className="text-xs text-muted underline underline-offset-2">
            Try again
          </button>
        </>
      ) : (
        <p className="text-sm text-muted">Loading conversation…</p>
      )}
    </div>
  );
}
