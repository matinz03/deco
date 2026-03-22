function MessageSkeleton({ align }: { align: "left" | "right" }) {
  return (
    <div className={`flex items-end gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
      {align === "left" && (
        <div className="w-7 h-7 rounded-full bg-muted animate-pulse shrink-0" />
      )}
      <div className={`flex flex-col gap-1 ${align === "right" ? "items-end" : "items-start"}`}>
        <div
          className={`h-10 rounded-2xl bg-muted animate-pulse ${
            align === "right" ? "w-44" : "w-56"
          }`}
        />
      </div>
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <MessageSkeleton align="left" />
      <MessageSkeleton align="right" />
      <MessageSkeleton align="left" />
      <MessageSkeleton align="right" />
      <MessageSkeleton align="right" />
      <MessageSkeleton align="left" />
    </div>
  );
}
