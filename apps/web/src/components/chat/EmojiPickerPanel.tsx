"use client";

const emojiGroups = [
  ["😀", "😁", "😂", "🤣", "😊", "😍", "🥰", "😎"],
  ["👍", "👏", "🙌", "🙏", "💪", "🔥", "❤️", "✨"],
  ["🎉", "🥳", "🤝", "👀", "🤔", "😴", "😭", "😡"],
];

interface Props {
  onSelect: (emoji: string) => void;
}

export function EmojiPickerPanel({ onSelect }: Props) {
  return (
    <div className="w-64 rounded-2xl border border-sidebar bg-surface p-3 shadow-2xl">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">Emoji</p>
      <div className="space-y-2">
        {emojiGroups.map((group, index) => (
          <div key={index} className="grid grid-cols-8 gap-1">
            {group.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onSelect(emoji)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-colors hover:bg-accent"
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
