"use client";

import { Archive, FolderCog, Lock, MoreVertical, Phone, Plus, Search, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { NcChat } from "@/lib/nexchat-mock";

interface HeaderProps {
  chat: NcChat;
  searchActive: boolean;
  isArchived: boolean;
  canManageGroup: boolean;
  onAvatarClick: () => void;
  onCreateGroup: () => void;
  onDeleteHistory: () => void;
  onArchiveToggle: () => void;
  onOpenGroupSettings: () => void;
  onSearchToggle: () => void;
  onStartCall: (type: "audio" | "video") => void;
}

export function Header({
  chat,
  searchActive,
  isArchived,
  canManageGroup,
  onAvatarClick,
  onCreateGroup,
  onDeleteHistory,
  onArchiveToggle,
  onOpenGroupSettings,
  onSearchToggle,
  onStartCall,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div className="flex items-center gap-3 px-4 h-16 bg-nc-sidebar border-b border-nc-border shrink-0">
      <button type="button" onClick={onAvatarClick} className="relative shrink-0">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm select-none overflow-hidden ${
            chat.online ? "aura-online" : ""
          }`}
          style={{ background: chat.avatarColor }}
        >
          {chat.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={chat.avatarUrl} alt={chat.name} className="h-full w-full object-cover" />
          ) : (
            chat.initials
          )}
        </div>
        {chat.online && (
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-nc-sidebar" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-nc-text leading-tight truncate">{chat.name}</p>
        {chat.isTyping ? (
          <TypingLabel />
        ) : (
          <p className="text-[12px] text-nc-muted leading-tight capitalize">
            {chat.type === "direct" ? (chat.online ? "online" : "last seen recently") : `${chat.type} chat`}
          </p>
        )}
      </div>

      <div className="hidden sm:flex items-center gap-1 mr-2">
        <Lock size={11} className="text-nc-primary shrink-0" />
        <span className="text-[10px] text-nc-primary font-medium whitespace-nowrap">End-to-end encrypted</span>
      </div>

      <div className="flex items-center gap-0.5">
        <IconBtn label="New group" onClick={onCreateGroup}><Plus size={18} /></IconBtn>
        <IconBtn label={searchActive ? "Close search" : "Search"} onClick={onSearchToggle} active={searchActive}>
          {searchActive ? <X size={18} /> : <Search size={18} />}
        </IconBtn>
        <IconBtn label="Voice call" onClick={() => onStartCall("audio")}><Phone size={18} /></IconBtn>
        <IconBtn label="Video call" onClick={() => onStartCall("video")}><Video size={18} /></IconBtn>

        <div ref={menuRef} className="relative">
          <IconBtn label="More" onClick={() => setMenuOpen((v) => !v)} active={menuOpen}>
            <MoreVertical size={18} />
          </IconBtn>
          {menuOpen && (
            <div className="absolute right-0 top-11 w-48 bg-nc-surface2 rounded-xl border border-nc-border shadow-nc-glow-lg z-50 py-1 overflow-hidden">
              <MenuItemRow
                label="Search messages"
                onClick={() => {
                  onSearchToggle();
                  setMenuOpen(false);
                }}
              />
              <MenuItemRow
                label={isArchived ? "Unarchive chat" : "Archive chat"}
                icon={<Archive size={14} />}
                onClick={() => {
                  onArchiveToggle();
                  setMenuOpen(false);
                }}
              />
              {chat.type !== "direct" && canManageGroup && (
                <MenuItemRow
                  label="Group Settings"
                  icon={<FolderCog size={14} />}
                  onClick={() => {
                    onOpenGroupSettings();
                    setMenuOpen(false);
                  }}
                />
              )}
              <div className="h-px bg-nc-border mx-3 my-1" />
              <MenuItemRow
                label="Delete History"
                danger
                onClick={() => {
                  onDeleteHistory();
                  setMenuOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ children, label, onClick, active }: { children: ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-150 ${
        active ? "bg-nc-primary/15 text-nc-primary" : "text-nc-muted hover:bg-nc-surface hover:text-nc-text"
      }`}
    >
      {children}
    </button>
  );
}

function MenuItemRow({ label, danger, onClick, icon }: { label: string; danger?: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 text-left px-4 py-2.5 text-[13px] transition-colors duration-100 ${
        danger ? "text-red-400 hover:bg-red-400/10" : "text-nc-text hover:bg-nc-surface"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function TypingLabel() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[12px] text-nc-primary italic">typing</span>
      <div className="flex items-end gap-0.5">
        <span className="dot-1 w-1 h-1 bg-nc-primary rounded-full" />
        <span className="dot-2 w-1 h-1 bg-nc-primary rounded-full" />
        <span className="dot-3 w-1 h-1 bg-nc-primary rounded-full" />
      </div>
    </div>
  );
}
