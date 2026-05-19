"use client";

import { MessageSquarePlus, Search, User } from "lucide-react";
import { useState } from "react";

import { apiRequest } from "@/lib/api";
import type { Chat, User as UserType } from "@/lib/types";

interface ContactsPanelProps {
  token: string;
  onChatOpened: (chat: Chat) => void;
}

export function ContactsPanel({ token, onChatOpened }: ContactsPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const search = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const users = await apiRequest<UserType[]>(`/users/search?q=${encodeURIComponent(q.trim())}`, {
        accessToken: token,
      });
      setResults(users);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const startChat = async (userId: string) => {
    setStarting(userId);
    try {
      const chat = await apiRequest<Chat>("/chats/direct", {
        method: "POST",
        body: { user_id: userId },
        accessToken: token,
      });
      onChatOpened(chat);
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-nc-bg overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-nc-border shrink-0">
        <h2 className="text-nc-text text-xl font-bold">Contacts</h2>
        <p className="text-nc-muted text-sm mt-0.5">Find people on NexChat</p>
      </div>

      <div className="p-4 shrink-0">
        <div className="flex items-center gap-2.5 bg-nc-surface rounded-full px-4 py-2.5 border border-nc-border focus-within:border-nc-primary transition-colors">
          <Search size={14} className="text-nc-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => void search(e.target.value)}
            placeholder="Search by username…"
            className="flex-1 bg-transparent text-[13px] text-nc-text placeholder-nc-muted outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && <p className="text-nc-muted text-sm text-center py-6 animate-pulse">Searching…</p>}

        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <User size={32} className="text-nc-muted" />
            <p className="text-nc-muted text-sm">No users found</p>
          </div>
        )}

        {!loading && query.length < 2 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Search size={32} className="text-nc-muted" />
            <p className="text-nc-muted text-sm">Type at least 2 characters to search</p>
          </div>
        )}

        {results.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-nc-surface transition-colors duration-150">
            <div className="w-10 h-10 rounded-full bg-nc-primary/20 border border-nc-primary/30 flex items-center justify-center text-nc-primary font-semibold text-sm shrink-0 overflow-hidden">
              {u.display_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.display_avatar_url} alt={u.display_name || u.username} className="h-full w-full object-cover" />
              ) : (
                (u.display_name || u.username)[0]?.toUpperCase() ?? "?"
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-nc-text text-[13px] font-semibold truncate">{u.display_name || u.username}</p>
              <p className="text-nc-muted text-[11px]">@{u.username}</p>
            </div>
            <button
              onClick={() => void startChat(u.id)}
              disabled={starting === u.id}
              className="w-8 h-8 rounded-lg bg-nc-primary/10 hover:bg-nc-primary/20 flex items-center justify-center text-nc-primary transition-colors disabled:opacity-50"
              aria-label="Start chat"
            >
              <MessageSquarePlus size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
