"use client";

import { useEffect, useState } from "react";
import {
  type BackgroundThemeId,
  BACKGROUND_THEMES,
  getBackgroundTheme,
} from "@/store/backgroundTheme";

const POSITIONS = [
  [8, 12, -12], [25, 28, 8], [43, 9, 15], [62, 24, -8], [82, 11, 11],
  [14, 57, 9], [36, 73, -14], [57, 52, 6], [76, 69, -9], [91, 49, 14],
  [5, 87, 12], [50, 91, -6], [88, 88, 8], [29, 43, -5], [70, 38, 10],
] as const;

function StaticEmojiBackground({ emojis }: { emojis: string[] }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {POSITIONS.map(([left, top, rotation], index) => (
        <span
          key={`${left}-${top}`}
          className="absolute select-none opacity-80"
          style={{
            left: `${left}%`,
            top: `${top}%`,
            fontSize: `${24 + (index % 4) * 6}px`,
            lineHeight: 1,
            transform: `rotate(${rotation}deg)`,
          }}
        >
          {emojis[index % emojis.length]}
        </span>
      ))}
    </div>
  );
}

function StaticGeometricBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="absolute right-[-8rem] top-[16%] h-96 w-96 rounded-full bg-sky-500/15 blur-3xl" />
      <div className="absolute bottom-[-10rem] left-[28%] h-96 w-96 rounded-full bg-fuchsia-500/15 blur-3xl" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_20%,rgb(255_255_255_/_0.04)_20%,transparent_21%,transparent_55%,rgb(255_255_255_/_0.04)_55%,transparent_56%)] bg-[length:72px_72px]" />
    </div>
  );
}

export function AuthBackground() {
  const [themeId, setThemeId] = useState<BackgroundThemeId>("geometric");

  useEffect(() => {
    setThemeId(getBackgroundTheme());
    const handler = (event: Event) => setThemeId((event as CustomEvent<BackgroundThemeId>).detail);
    window.addEventListener("deco-bg-theme-change", handler);
    return () => window.removeEventListener("deco-bg-theme-change", handler);
  }, []);

  const theme = BACKGROUND_THEMES.find((item) => item.id === themeId);
  return theme?.emojis
    ? <StaticEmojiBackground emojis={theme.emojis} />
    : <StaticGeometricBackground />;
}
