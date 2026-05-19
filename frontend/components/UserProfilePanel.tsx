"use client";

import { MessageCircle, User } from "lucide-react";

import type { NcChat } from "@/lib/nexchat-mock";
import type { User as UserType } from "@/lib/types";

interface UserProfilePanelProps {
  open: boolean;
  chat: NcChat | null;
  user: UserType | null;
  memberCount?: number;
  onClose: () => void;
  onMessage: () => void;
}

export function UserProfilePanel({ open, chat, user, memberCount, onClose, onMessage }: UserProfilePanelProps) {
  if (!open || !chat) return null;

  const title = user?.display_name || chat.name;
  const subtitle = user ? `@${user.username}` : chat.type === "direct" ? "Direct conversation" : `${memberCount ?? 0} members`;

  return (
    <div className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm animate-slide-in-right flex-col border-l border-nc-border bg-nc-sidebar shadow-nc-glow-lg">
      <div className="flex items-center justify-between border-b border-nc-border px-5 py-4">
        <h3 className="text-lg font-semibold text-nc-text">Profile</h3>
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-nc-muted hover:bg-nc-surface hover:text-nc-text">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="rounded-3xl border border-nc-border bg-nc-surface p-5">
          <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-nc-primary/30 bg-nc-primary/15 shadow-nc-glow">
            {user?.display_avatar_url || chat.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user?.display_avatar_url ?? chat.avatarUrl ?? ""} alt={title} className="h-full w-full object-cover" />
            ) : (
              <User size={34} className="text-nc-primary" />
            )}
          </div>
          <div className="mt-4 text-center">
            <div className="text-lg font-semibold text-nc-text">{title}</div>
            <div className="mt-1 text-sm text-nc-muted">{subtitle}</div>
          </div>
          <button type="button" onClick={onMessage} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-nc-primary px-4 py-3 text-sm font-semibold text-white shadow-nc-glow transition-all hover:shadow-nc-hover">
            <MessageCircle size={16} />
            Message
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-nc-border bg-nc-surface p-5 text-sm text-nc-muted">
          <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-nc-muted">About</div>
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-nc-muted">Bio</div>
              <div className="mt-1 text-nc-text">{user?.bio || chat.description || "No bio yet."}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-nc-muted">Status</div>
              <div className="mt-1 capitalize text-nc-text">{user?.status ?? (chat.online ? "online" : "offline")}</div>
            </div>
            {user?.custom_status && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-nc-muted">Custom status</div>
                <div className="mt-1 text-nc-text">{user.custom_status}</div>
              </div>
            )}
            {user?.last_seen && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-nc-muted">Last seen</div>
                <div className="mt-1 text-nc-text">{new Date(user.last_seen).toLocaleString()}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
