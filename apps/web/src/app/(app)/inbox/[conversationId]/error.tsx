"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-8">
      <p className="text-sm font-medium">Something went wrong loading this conversation.</p>
      <button onClick={reset} className="text-xs text-muted underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}
