"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StickerPack } from "@deco/types";
import { api } from "@/lib/api";

const RECENT_STICKERS_KEY = "deco:recent-stickers";
const MAX_RECENT_STICKERS = 18;

export function StickerPickerPanel({
  onSelect,
}: {
  onSelect: (sticker: NonNullable<StickerPack["stickers"]>[number]) => void;
}) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePackId, setActivePackId] = useState<string>("");
  const [recentStickerIds, setRecentStickerIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RECENT_STICKERS_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as string[];
      if (Array.isArray(parsed)) {
        setRecentStickerIds(parsed.filter((value): value is string => typeof value === "string"));
      }
    } catch {
      // ignore localStorage corruption
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextPacks = await api.stickers.listPacks();
        if (cancelled) return;
        setPacks(nextPacks.filter((pack) => (pack.stickers?.length ?? 0) > 0));
        setActivePackId(nextPacks.find((pack) => (pack.stickers?.length ?? 0) > 0)?.id ?? "");
      } catch {
        if (!cancelled) {
          setError("Couldn't load sticker packs right now.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const activePack = useMemo(
    () => packs.find((pack) => pack.id === activePackId) ?? packs[0],
    [activePackId, packs]
  );
  const recentStickers = useMemo(() => {
    const stickerMap = new Map(
      packs.flatMap((pack) => (pack.stickers ?? []).map((sticker) => [sticker.id, sticker] as const))
    );
    return recentStickerIds
      .map((stickerId) => stickerMap.get(stickerId))
      .filter((sticker): sticker is NonNullable<StickerPack["stickers"]>[number] => Boolean(sticker));
  }, [packs, recentStickerIds]);

  function handleSelectSticker(sticker: NonNullable<StickerPack["stickers"]>[number]) {
    setRecentStickerIds((current) => {
      const next = [sticker.id, ...current.filter((id) => id !== sticker.id)].slice(0, MAX_RECENT_STICKERS);
      try {
        window.localStorage.setItem(RECENT_STICKERS_KEY, JSON.stringify(next));
      } catch {
        // ignore localStorage write failures
      }
      return next;
    });
    onSelect(sticker);
  }

  if (loading) {
    return (
      <div className="w-full rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-muted">Loading sticker packs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/stickers" className="mt-3 inline-flex text-sm font-medium text-primary">
          Open sticker studio
        </Link>
      </div>
    );
  }

  if (!packs.length || !activePack) {
    return (
      <div className="w-full rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-muted">No sticker packs yet.</p>
        <Link href="/stickers" className="mt-3 inline-flex text-sm font-medium text-primary">
          Create or import a pack
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-3xl border border-sidebar bg-surface shadow-2xl">
      <div className="border-b border-sidebar/80 px-3 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Stickers</h3>
            <p className="text-xs text-muted">Pick from your Deco and Telegram-imported packs.</p>
          </div>
          <Link href="/stickers" className="shrink-0 rounded-full border border-sidebar px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground">
            Manage
          </Link>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {recentStickers.length > 0 && (
            <button
              type="button"
              onClick={() => setActivePackId("recent")}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activePackId === "recent" ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted hover:text-foreground"
              }`}
            >
              Recent
            </button>
          )}
          {packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => setActivePackId(pack.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                pack.id === activePack.id ? "bg-primary text-primary-foreground" : "bg-background/70 text-muted hover:text-foreground"
              }`}
            >
              {pack.title}
            </button>
          ))}
        </div>
      </div>

      <div className="grid max-h-[min(50vh,22rem)] grid-cols-3 gap-2 overflow-y-auto p-2 sm:grid-cols-4 sm:p-3">
        {(activePackId === "recent" ? recentStickers : activePack.stickers ?? []).map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            onClick={() => handleSelectSticker(sticker)}
            className="group flex aspect-square items-center justify-center rounded-2xl bg-background/40 p-1.5 transition-colors hover:bg-accent sm:p-2"
            title={`${sticker.emoji} ${sticker.name}`}
          >
            {sticker.format === "video" ? (
              <video src={sticker.assetUrl} muted loop autoPlay playsInline className="max-h-full max-w-full rounded-xl object-contain" />
            ) : (
              <img src={sticker.assetUrl} alt={sticker.name} className="max-h-full max-w-full rounded-xl object-contain" loading="lazy" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
