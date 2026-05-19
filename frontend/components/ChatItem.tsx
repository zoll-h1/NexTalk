import type { ReactNode } from "react";

import type { NcChat } from "@/lib/nexchat-mock";

interface ChatItemProps {
  chat: NcChat;
  isActive: boolean;
  onClick: () => void;
  trailingAction?: ReactNode;
}

export function ChatItem({ chat, isActive, onClick, trailingAction }: ChatItemProps) {
  return (
    <div className={`group relative flex items-stretch gap-2 px-2 ${isActive ? "" : ""}`}>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-2 py-3 transition-all duration-150 text-left rounded-2xl ${
          isActive ? "bg-nc-primary/10" : "hover:bg-nc-surface/50"
        }`}
      >
        <div className="relative shrink-0">
          <div
            className={`w-[46px] h-[46px] rounded-full flex items-center justify-center text-white font-semibold text-sm select-none overflow-hidden ${
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
            <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-400 border-2 border-nc-sidebar" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-semibold text-nc-text truncate leading-snug">
              {chat.name}
            </span>
            <span className="text-[11px] text-nc-muted shrink-0 font-mono">
              {chat.timestamp}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 mt-0.5">
            {chat.isTyping ? (
              <TypingDots />
            ) : (
              <span className="text-[12px] text-nc-muted truncate leading-snug">
                {chat.lastMessage || (chat.type === "direct" ? "Direct message" : "Group chat")}
              </span>
            )}
            {chat.unread > 0 && (
              <span className="shrink-0 bg-nc-primary text-white text-[10px] font-bold rounded-full px-[7px] py-[1px] min-w-[18px] text-center leading-[16px]">
                {chat.unread > 99 ? "99+" : chat.unread}
              </span>
            )}
          </div>
        </div>
      </button>
      {trailingAction ? <div className="absolute right-3 top-1/2 -translate-y-1/2">{trailingAction}</div> : null}
    </div>
  );
}

function TypingDots() {
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
