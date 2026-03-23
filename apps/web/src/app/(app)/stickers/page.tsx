"use client";

import { useEffect, useMemo, useState } from "react";
import type { StickerPack } from "@deco/types";
import { api } from "@/lib/api";

export default function StickersPage() {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePackId, setActivePackId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [telegramInput, setTelegramInput] = useState("");
  const [stickerName, setStickerName] = useState("");
  const [stickerEmoji, setStickerEmoji] = useState(":)");
  const [stickerFile, setStickerFile] = useState<File | null>(null);

  useEffect(() => {
    void loadPacks();
  }, []);

  const activePack = useMemo(
    () => packs.find((pack) => pack.id === activePackId) ?? packs[0],
    [activePackId, packs]
  );

  async function loadPacks(nextActivePackId?: string) {
    setLoading(true);
    setError("");
    try {
      const nextPacks = await api.stickers.listPacks();
      setPacks(nextPacks);
      setActivePackId(nextActivePackId ?? nextPacks[0]?.id ?? "");
    } catch {
      setError("Couldn't load sticker packs.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePack(event: React.FormEvent) {
    event.preventDefault();
    if (!createTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const pack = await api.stickers.createPack({
        title: createTitle.trim(),
        description: createDescription.trim() || undefined,
      });
      setCreateTitle("");
      setCreateDescription("");
      await loadPacks(pack.id);
    } catch {
      setError("Couldn't create the sticker pack.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportTelegram(event: React.FormEvent) {
    event.preventDefault();
    if (!telegramInput.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.stickers.importTelegramPack(telegramInput.trim());
      setTelegramInput("");
      await loadPacks(result.pack.id);
      if (result.skipped.length) {
        setError(result.skipped.join(" "));
      }
    } catch {
      setError("Couldn't import that Telegram sticker pack.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddSticker(event: React.FormEvent) {
    event.preventDefault();
    if (!activePack || !stickerFile || !stickerEmoji.trim()) return;
    setBusy(true);
    setError("");
    try {
      const upload = await api.uploads.create(stickerFile, "sticker", stickerFile.name);
      await api.stickers.addSticker(activePack.id, {
        name: stickerName.trim() || stickerFile.name.replace(/\.[^.]+$/, ""),
        emoji: stickerEmoji.trim(),
        assetUrl: upload.url,
        mimeType: upload.mimeType,
        format: upload.mimeType.startsWith("video/") ? "video" : "static",
      });
      setStickerName("");
      setStickerEmoji(":)");
      setStickerFile(null);
      await loadPacks(activePack.id);
    } catch {
      setError("Couldn't add that sticker.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="border-b border-sidebar px-6 py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Sticker Studio</p>
        <h1 className="mt-2 text-2xl font-semibold">Create packs and import them from Telegram</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Build Deco-native packs, then bring in regular Telegram sticker sets with a shortname or pack link.
        </p>
      </header>

      <div className="grid min-h-0 flex-1 gap-6 overflow-hidden px-6 py-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-5 overflow-y-auto">
          <form onSubmit={handleCreatePack} className="rounded-3xl border border-sidebar bg-surface p-5">
            <h2 className="text-base font-semibold">New Deco pack</h2>
            <div className="mt-4 space-y-3">
              <input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                className="input"
                placeholder="Pack title"
              />
              <textarea
                value={createDescription}
                onChange={(event) => setCreateDescription(event.target.value)}
                className="input min-h-[88px]"
                placeholder="What kind of stickers live here?"
              />
            </div>
            <button type="submit" disabled={busy || !createTitle.trim()} className="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-60">
              {busy ? "Working..." : "Create pack"}
            </button>
          </form>

          <form onSubmit={handleImportTelegram} className="rounded-3xl border border-sidebar bg-surface p-5">
            <h2 className="text-base font-semibold">Import from Telegram</h2>
            <p className="mt-1 text-xs text-muted">Paste a pack link like `t.me/addstickers/...` or the sticker set shortname.</p>
            <input
              value={telegramInput}
              onChange={(event) => setTelegramInput(event.target.value)}
              className="input mt-4"
              placeholder="https://t.me/addstickers/..."
            />
            <button type="submit" disabled={busy || !telegramInput.trim()} className="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-60">
              {busy ? "Importing..." : "Import pack"}
            </button>
          </form>

          <form onSubmit={handleAddSticker} className="rounded-3xl border border-sidebar bg-surface p-5">
            <h2 className="text-base font-semibold">Add sticker to active pack</h2>
            <p className="mt-1 text-xs text-muted">
              {activePack ? `Adding to ${activePack.title}` : "Create or select a Deco pack first."}
            </p>
            <div className="mt-4 space-y-3">
              <input value={stickerName} onChange={(event) => setStickerName(event.target.value)} className="input" placeholder="Sticker name" />
              <input value={stickerEmoji} onChange={(event) => setStickerEmoji(event.target.value)} className="input" placeholder="Emoji" maxLength={8} />
              <input
                type="file"
                accept=".webp,.png,.jpg,.jpeg,.gif,.webm"
                onChange={(event) => setStickerFile(event.target.files?.[0] ?? null)}
                className="input cursor-pointer"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !activePack || activePack.source !== "deco" || !stickerFile || !stickerEmoji.trim()}
              className="btn-primary mt-4 px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? "Uploading..." : "Add sticker"}
            </button>
          </form>

          {error && <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-sidebar bg-surface">
          <div className="border-b border-sidebar px-5 py-4">
            <div className="flex gap-2 overflow-x-auto">
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setActivePackId(pack.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    pack.id === activePack?.id ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted hover:text-foreground"
                  }`}
                >
                  {pack.title}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {loading ? (
              <p className="text-sm text-muted">Loading packs...</p>
            ) : !activePack ? (
              <p className="text-sm text-muted">No sticker packs yet. Create one or import from Telegram.</p>
            ) : (
              <>
                <div className="mb-5">
                  <div className="flex items-center gap-3">
                    {activePack.coverSticker ? (
                      activePack.coverSticker.format === "video" ? (
                        <video src={activePack.coverSticker.assetUrl} muted loop autoPlay playsInline className="h-16 w-16 rounded-2xl object-contain bg-background/60 p-2" />
                      ) : (
                        <img src={activePack.coverSticker.assetUrl} alt={activePack.title} className="h-16 w-16 rounded-2xl object-contain bg-background/60 p-2" />
                      )
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-background/60 text-2xl">S</div>
                    )}
                    <div>
                      <h2 className="text-lg font-semibold">{activePack.title}</h2>
                      <p className="text-sm text-muted">{activePack.description || "No description yet."}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-primary">
                        {activePack.source === "telegram" ? "Imported from Telegram" : "Deco pack"} • {activePack.stickerCount} stickers
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
                  {activePack.stickers?.map((sticker) => (
                    <div key={sticker.id} className="rounded-2xl border border-sidebar bg-background/40 p-3">
                      <div className="flex aspect-square items-center justify-center rounded-2xl bg-surface">
                        {sticker.format === "video" ? (
                          <video src={sticker.assetUrl} muted loop autoPlay playsInline className="max-h-full max-w-full rounded-xl object-contain" />
                        ) : (
                          <img src={sticker.assetUrl} alt={sticker.name} className="max-h-full max-w-full rounded-xl object-contain" loading="lazy" />
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm font-medium">{sticker.emoji} {sticker.name}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
