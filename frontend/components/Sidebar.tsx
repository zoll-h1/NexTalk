"use client";

import { Bell, MessageCircle, Settings, User, Users } from "lucide-react";

const NAV = [
  { id: "chats", icon: MessageCircle, label: "Chats" },
  { id: "contacts", icon: Users, label: "Contacts" },
  { id: "notifications", icon: Bell, label: "Notifications" },
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "profile", icon: User, label: "Profile" },
] as const;

interface SidebarProps {
  active: string;
  unreadNotifications: number;
  onSelect: (id: string) => void;
}

export function Sidebar({ active, unreadNotifications, onSelect }: SidebarProps) {
  return (
    <aside className="w-[72px] shrink-0 h-screen bg-nc-sidebar border-r border-nc-border flex flex-col items-center py-4">
      <div className="w-10 h-10 rounded-xl bg-nc-primary flex items-center justify-center mb-5 shadow-nc-glow shrink-0">
        <span className="text-white font-bold text-sm tracking-widest select-none">N</span>
      </div>

      <nav className="flex flex-col gap-1 w-full px-3 flex-1">
        {NAV.map(({ id, icon: Icon, label }) => (
          <div key={id} className="sidebar-btn-wrap">
            <button
              onClick={() => onSelect(id)}
              aria-label={label}
              className={`relative w-full h-11 flex items-center justify-center rounded-xl transition-all duration-150 ${
                active === id
                  ? "sidebar-active"
                  : "text-nc-muted hover:bg-nc-surface hover:text-nc-text"
              }`}
            >
              <Icon size={20} strokeWidth={active === id ? 2.2 : 1.8} />
              {id === "notifications" && unreadNotifications > 0 && (
                <span className="absolute right-2 top-2 min-w-[18px] rounded-full bg-nc-primary px-1.5 text-[10px] font-bold leading-[18px] text-white shadow-nc-glow">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </button>
            <span className="sidebar-tooltip">{label}</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}
