"use client";
import { useEffect, useRef } from "react";

interface Props {
  onSelect: (emoji: string) => void;
}

export function EmojiPickerPanel({ onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let picker: Node | null = null;

    Promise.all([import("emoji-mart"), import("@emoji-mart/data")]).then(
      ([{ Picker }, emojiData]) => {
        if (!containerRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        picker = new (Picker as any)({
          data: (emojiData as { default: unknown }).default,
          onEmojiSelect: (emoji: { native: string }) => {
            onSelectRef.current(emoji.native);
          },
          theme: "auto",
          previewPosition: "none",
          skinTonePosition: "search",
          perLine: 8,
          maxFrequentRows: 2,
        }) as unknown as Node;
        containerRef.current.appendChild(picker);
      }
    );

    return () => {
      if (picker && container.contains(picker)) container.removeChild(picker);
    };
  }, []);

  return <div ref={containerRef} />;
}
