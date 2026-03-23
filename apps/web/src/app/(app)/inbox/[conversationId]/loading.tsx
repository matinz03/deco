import { ChatSkeleton } from "@/components/chat/ChatSkeleton";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <ChatSkeleton />
    </div>
  );
}
