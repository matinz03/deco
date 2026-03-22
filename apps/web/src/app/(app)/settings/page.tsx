"use client";

import { useAuthStore } from "@/store/auth";
import { Avatar } from "@/components/ui/Avatar";

export default function SettingsPage() {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex flex-col h-full max-w-xl mx-auto w-full px-4 pt-10">
      <h1 className="text-xl font-semibold mb-8">Settings</h1>

      {/* Profile section */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Profile</h2>
        <div className="rounded-2xl bg-muted/50 border border-sidebar overflow-hidden">
          <div className="flex items-center gap-4 px-4 py-4 border-b border-sidebar">
            <Avatar src={user?.avatarUrl} name={user?.displayName ?? "?"} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold truncate">{user?.displayName}</p>
              <p className="text-sm text-muted truncate">@{user?.username}</p>
            </div>
            <button className="ml-auto text-sm text-primary hover:underline shrink-0">Edit</button>
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted">Username</span>
            <span className="text-sm text-muted">@{user?.username}</span>
          </div>
        </div>
      </section>

      {/* Notifications */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Notifications</h2>
        <div className="rounded-2xl bg-muted/50 border border-sidebar overflow-hidden divide-y divide-sidebar">
          <SettingRow label="Push notifications" description="Get notified about new messages" />
          <SettingRow label="Message previews" description="Show message content in notifications" />
        </div>
      </section>

      {/* Privacy */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Privacy</h2>
        <div className="rounded-2xl bg-muted/50 border border-sidebar overflow-hidden divide-y divide-sidebar">
          <SettingRow label="Read receipts" description="Let others see when you've read messages" />
          <SettingRow label="Online status" description="Show when you're active" />
        </div>
      </section>

      {/* Account */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Account</h2>
        <div className="rounded-2xl bg-muted/50 border border-sidebar overflow-hidden">
          <button
            onClick={logout}
            className="w-full flex items-center px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
          >
            <svg className="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
            </svg>
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingRow({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      <Toggle />
    </div>
  );
}

function Toggle() {
  return (
    <div className="relative w-10 h-5.5 rounded-full bg-muted border border-sidebar cursor-pointer">
      <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-muted-foreground/40 transition-all" />
    </div>
  );
}
