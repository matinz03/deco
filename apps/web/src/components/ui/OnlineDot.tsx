interface OnlineDotProps {
  isOnline: boolean;
  borderClass?: string;
}

export function OnlineDot({ isOnline, borderClass = "border-sidebar" }: OnlineDotProps) {
  if (!isOnline) {
    return (
      <span
        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 ${borderClass} bg-muted-foreground/30`}
      />
    );
  }
  return (
    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 ${borderClass} bg-green-500`}>
      <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-60" />
    </span>
  );
}
