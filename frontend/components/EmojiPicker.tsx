"use client";

import { EMOJI_CATEGORIES } from "@/lib/nexchat-data";

interface EmojiPickerProps {
  open: boolean;
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ open, activeCategory, onCategoryChange, onSelect }: EmojiPickerProps) {
  if (!open) return null;

  const current = EMOJI_CATEGORIES.find((entry) => entry.label === activeCategory) ?? EMOJI_CATEGORIES[0];

  return (
    <div className="absolute bottom-full left-0 z-40 mb-3 w-[320px] overflow-hidden rounded-2xl border border-nc-border bg-nc-surface2 shadow-nc-glow-lg">
      <div className="flex gap-1 overflow-x-auto border-b border-nc-border bg-nc-surface px-2 py-2 scrollbar-hide">
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.label}
            type="button"
            onClick={() => onCategoryChange(category.label)}
            className={`flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs transition-colors ${
              activeCategory === category.label
                ? "bg-nc-primary/15 text-nc-primary"
                : "text-nc-muted hover:bg-nc-bg hover:text-nc-text"
            }`}
          >
            <span>{category.icon}</span>
            <span>{category.label}</span>
          </button>
        ))}
      </div>
      <div className="max-h-72 overflow-y-auto p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">
          {current.label}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {current.emojis.map((emoji) => (
            <button
              key={`${current.label}-${emoji}`}
              type="button"
              onClick={() => onSelect(emoji)}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-nc-surface text-xl transition-all duration-150 hover:-translate-y-0.5 hover:bg-nc-bg hover:shadow-nc-hover"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
