import { NavRail } from "@/components/layout/NavRail";
import { ConversationList } from "@/components/layout/ConversationList";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-app flex overflow-hidden bg-background">
      {/* Panel 1 — Nav rail (narrow icon strip) */}
      <NavRail />

      {/* Panel 2 — Conversation list */}
      <aside className="w-[300px] shrink-0 flex flex-col bg-sidebar border-r border-sidebar">
        <ConversationList />
      </aside>

      {/* Panel 3 — Chat window */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface">
        {children}
      </main>
    </div>
  );
}
