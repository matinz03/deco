"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { StickerPack } from "@deco/types";
import { api } from "@/lib/api";

export function StickerPickerPanel({
  onSelect,
}: {
  onSelect: (sticker: NonNullable<StickerPack["stickers"]>[number]) => void;
}) {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [activePackId, setActivePackId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (loading) {
    return (
      <div className="w-[320px] rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-muted">Loading sticker packs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-[320px] rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/stickers" className="mt-3 inline-flex text-sm font-medium text-primary">
          Open sticker studio
        </Link>
      </div>
    );
  }

  if (!packs.length || !activePack) {
    return (
      <div className="w-[320px] rounded-3xl border border-sidebar bg-surface p-4 shadow-2xl">
        <p className="text-sm text-muted">No sticker packs yet.</p>
        <Link href="/stickers" className="mt-3 inline-flex text-sm font-medium text-primary">
          Create or import a pack
        </Link>
      </div>
    );
  }

  return (
    <div className="w-[360px] overflow-hidden rounded-3xl border border-sidebar bg-surface shadow-2xl">
      <div className="border-b border-sidebar/80 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Stickers</h3>
            <p className="text-xs text-muted">Pick from your Deco and Telegram-imported packs.</p>
          </div>
          <Link href="/stickers" className="rounded-full border border-sidebar px-3 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground">
            Manage
          </Link>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
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

      <div className="grid max-h-[320px] grid-cols-4 gap-2 overflow-y-auto p-3">
        {activePack.stickers?.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            onClick={() => onSelect(sticker)}
            className="group flex aspect-square items-center justify-center rounded-2xl bg-background/40 p-2 transition-colors hover:bg-accent"
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
