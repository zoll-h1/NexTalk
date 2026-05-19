"use client";

import { GIF_COLLECTION } from "@/lib/nexchat-data";

interface GifPickerProps {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (url: string) => void;
}

export function GifPicker({ open, query, onQueryChange, onSelect }: GifPickerProps) {
  if (!open) return null;

  const normalized = query.trim().toLowerCase();
  const gifs = GIF_COLLECTION.filter((gif) =>
    !normalized || gif.tags.some((tag) => tag.toLowerCase().includes(normalized)),
  );

  return (
    <div className="absolute bottom-full left-0 z-40 mb-3 w-[340px] overflow-hidden rounded-2xl border border-nc-border bg-nc-surface2 shadow-nc-glow-lg">
      <div className="border-b border-nc-border bg-nc-surface p-3">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search GIFs..."
          className="w-full rounded-xl border border-nc-border bg-nc-bg px-3 py-2 text-[13px] text-nc-text outline-none transition-colors placeholder:text-nc-muted focus:border-nc-primary"
        />
      </div>
      <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-3">
        {gifs.map((gif) => (
          <button
            key={gif.id}
            type="button"
            onClick={() => onSelect(gif.url)}
            className="overflow-hidden rounded-2xl border border-nc-border bg-nc-surface transition-all duration-150 hover:-translate-y-0.5 hover:border-nc-primary/40 hover:shadow-nc-hover"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gif.url} alt={gif.tags.join(", ")} className="h-28 w-full object-cover" />
          </button>
        ))}
        {gifs.length === 0 && (
          <div className="col-span-2 rounded-2xl border border-dashed border-nc-border bg-nc-surface px-4 py-8 text-center text-sm text-nc-muted">
            No GIFs match your search.
          </div>
        )}
      </div>
    </div>
  );
}
