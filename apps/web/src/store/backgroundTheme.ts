"use client";

export type BackgroundThemeId =
  | "geometric"
  | "love"
  | "valentine"
  | "dogs"
  | "cats"
  | "space"
  | "nature"
  | "party"
  | "food"
  | "ocean";

export interface BackgroundTheme {
  id: BackgroundThemeId;
  name: string;
  preview: string;
  description: string;
  emojis?: string[]; // undefined = geometric Three.js
}

export const BACKGROUND_THEMES: BackgroundTheme[] = [
  {
    id: "geometric",
    name: "Geometric",
    preview: "🔷",
    description: "Classic wireframe shapes",
  },
  {
    id: "love",
    name: "Love",
    preview: "❤️",
    description: "Hearts & romance",
    emojis: ["❤️", "💕", "💘", "💝", "😍", "💌"],
  },
  {
    id: "valentine",
    name: "Valentine",
    preview: "💘",
    description: "Hearts, cupids & kisses",
    emojis: ["💘", "💋", "😘", "❤️", "💝", "🏹", "💌", "💑", "😍", "💖"],
  },
  {
    id: "dogs",
    name: "Dogs",
    preview: "🐶",
    description: "Man's best friend",
    emojis: ["🐶", "🐾", "🦴", "🐕", "🐩", "🐕‍🦺"],
  },
  {
    id: "cats",
    name: "Cats",
    preview: "🐱",
    description: "Purrfect vibes",
    emojis: ["🐱", "🐈", "😺", "🐾", "🐈‍⬛", "😸"],
  },
  {
    id: "space",
    name: "Space",
    preview: "🌟",
    description: "Stars & cosmos",
    emojis: ["⭐", "🌟", "✨", "🌙", "☄️", "🪐"],
  },
  {
    id: "nature",
    name: "Nature",
    preview: "🌸",
    description: "Flowers & leaves",
    emojis: ["🌸", "🍀", "🌺", "🌻", "🍃", "🌿"],
  },
  {
    id: "party",
    name: "Party",
    preview: "🎉",
    description: "Always celebrating",
    emojis: ["🎉", "🎊", "🎈", "✨", "🥳", "🎶"],
  },
  {
    id: "food",
    name: "Food",
    preview: "🍕",
    description: "Yummy treats",
    emojis: ["🍕", "🍔", "🍩", "🍪", "🧁", "🍰"],
  },
  {
    id: "ocean",
    name: "Ocean",
    preview: "🌊",
    description: "Sea & waves",
    emojis: ["🌊", "🐠", "🦋", "🐙", "🦈", "🐋"],
  },
];

const STORAGE_KEY = "deco_bg_theme";

export function getBackgroundTheme(): BackgroundThemeId {
  if (typeof window === "undefined") return "geometric";
  return (localStorage.getItem(STORAGE_KEY) as BackgroundThemeId) ?? "geometric";
}

export function setBackgroundTheme(id: BackgroundThemeId) {
  localStorage.setItem(STORAGE_KEY, id);
  window.dispatchEvent(new CustomEvent("deco-bg-theme-change", { detail: id }));
}
