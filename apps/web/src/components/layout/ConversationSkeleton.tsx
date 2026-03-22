function ConversationRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-3 mx-2">
      <div className="w-10 h-10 rounded-full bg-muted animate-pulse shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <div className="h-3.5 rounded-full bg-muted animate-pulse w-28" />
        <div className="h-3 rounded-full bg-muted animate-pulse w-40 opacity-60" />
      </div>
      <div className="h-3 rounded-full bg-muted animate-pulse w-8 shrink-0 opacity-40" />
    </div>
  );
}

export function ConversationSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 7 }).map((_, i) => (
        <ConversationRowSkeleton key={i} />
      ))}
    </div>
  );
}
