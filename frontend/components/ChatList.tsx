"use client";

import { ArchiveRestore, ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { NcChat } from "@/lib/nexchat-mock";
import { ChatItem } from "./ChatItem";

export type ChatFolder = "all" | "personal" | "groups" | "archived";

interface ChatListProps {
  chats: NcChat[];
  activeId: string | null;
  folder: ChatFolder;
  archivedChatIds: Set<string>;
  onFolderChange: (folder: ChatFolder) => void;
  onSelect: (id: string) => void;
  onCreateGroup: () => void;
  onUnarchive: (id: string) => void;
}

const FOLDERS: Array<{ id: ChatFolder; label: string }> = [
  { id: "all", label: "All" },
  { id: "personal", label: "Personal" },
  { id: "groups", label: "Groups" },
  { id: "archived", label: "Archived" },
];

export function ChatList({
  chats,
  activeId,
  folder,
  archivedChatIds,
  onFolderChange,
  onSelect,
  onCreateGroup,
  onUnarchive,
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return chats.filter((chat) => {
      const matchesQuery = chat.name.toLowerCase().includes(query.toLowerCase());
      const archived = archivedChatIds.has(chat.id);
      if (!matchesQuery) return false;
      if (folder === "archived") return archived;
      if (archived) return false;
      if (folder === "personal") return chat.type === "direct";
      if (folder === "groups") return chat.type === "group" || chat.type === "supergroup";
      return true;
    });
  }, [archivedChatIds, chats, folder, query]);

  const groupIds = useMemo(
    () => new Set(filtered.filter((chat) => chat.type === "group").map((chat) => chat.id)),
    [filtered],
  );

  const groupChildren = useMemo(() => {
    const map = new Map<string, NcChat[]>();
    for (const chat of filtered) {
      if (chat.type !== "supergroup" || !chat.parentId || !groupIds.has(chat.parentId)) continue;
      const siblings = map.get(chat.parentId) ?? [];
      siblings.push(chat);
      map.set(chat.parentId, siblings);
    }
    return map;
  }, [filtered, groupIds]);

  const topLevelChats = useMemo(
    () => filtered.filter((chat) => !(chat.type === "supergroup" && chat.parentId && groupIds.has(chat.parentId))),
    [filtered, groupIds],
  );

  const toggleGroup = (chatId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  };

  const renderTrailingAction = (chatId: string) =>
    folder === "archived" ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onUnarchive(chatId);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-nc-surface text-nc-primary transition-colors hover:bg-nc-bg"
        aria-label="Unarchive chat"
      >
        <ArchiveRestore size={15} />
      </button>
    ) : undefined;

  return (
    <div className="w-[300px] shrink-0 h-screen bg-nc-sidebar border-r border-nc-border flex flex-col">
      <div className="px-4 pt-5 pb-3 shrink-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="text-[18px] font-bold text-nc-text tracking-tight">Chats</h1>
          <button
            type="button"
            onClick={onCreateGroup}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-nc-primary/15 text-nc-primary transition-all hover:shadow-nc-hover"
            aria-label="New group"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2.5 bg-nc-surface rounded-full px-4 py-2.5">
          <Search size={14} className="text-nc-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 bg-transparent text-[13px] text-nc-text placeholder-nc-muted outline-none"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto scrollbar-hide">
          {FOLDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onFolderChange(item.id)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                folder === item.id
                  ? "bg-nc-primary text-white shadow-nc-glow"
                  : "bg-nc-surface text-nc-muted hover:text-nc-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-3">
        {filtered.length === 0 ? (
          <p className="text-center text-nc-muted text-[13px] pt-8 px-4">
            {folder === "archived" ? "No archived chats" : "No chats found"}
          </p>
        ) : (
          topLevelChats.map((chat) => {
            const children = groupChildren.get(chat.id) ?? [];
            const hasChildren = chat.type === "group" && children.length > 0;
            const isExpanded = expandedGroupIds.has(chat.id) || children.some((child) => child.id === activeId);

            return (
              <div key={chat.id}>
                <div className="relative">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleGroup(chat.id);
                      }}
                      className="absolute left-3 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-nc-muted transition-colors hover:bg-nc-surface hover:text-nc-primary"
                      aria-label={isExpanded ? "Collapse channels" : "Expand channels"}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : null}
                  <div className={hasChildren ? "pl-5" : undefined}>
                    <ChatItem
                      chat={chat}
                      isActive={chat.id === activeId}
                      onClick={() => onSelect(chat.id)}
                      trailingAction={renderTrailingAction(chat.id)}
                    />
                  </div>
                </div>

                {hasChildren && isExpanded
                  ? children.map((child) => (
                      <div key={child.id} className="ml-6 border-l border-nc-primary/20 pl-3">
                        <ChatItem
                          chat={{ ...child, name: `#${child.name}` }}
                          isActive={child.id === activeId}
                          onClick={() => onSelect(child.id)}
                          trailingAction={renderTrailingAction(child.id)}
                        />
                      </div>
                    ))
                  : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
