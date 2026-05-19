"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { BubbleColorTheme, BubbleStyle } from "@/lib/appearance";
import type { NcChat, NcMessage } from "@/lib/nexchat-mock";
import { Header } from "./Header";
import { InputBar } from "./InputBar";
import { MessageBubble } from "./MessageBubble";

interface MessageGroup {
  label: string;
  messages: NcMessage[];
}

function groupMessagesByDate(messages: NcMessage[]): MessageGroup[] {
  const yesterday = messages.filter((m) => m.dateGroup === "yesterday");
  const today = messages.filter((m) => m.dateGroup === "today");
  const groups: MessageGroup[] = [];
  if (yesterday.length > 0) groups.push({ label: "Yesterday", messages: yesterday });
  if (today.length > 0) groups.push({ label: "Today", messages: today });
  return groups;
}

interface ChatWindowProps {
  chat: NcChat;
  messages: NcMessage[];
  canManageOthers: boolean;
  currentUserId: string;
  isArchived: boolean;
  wallpaper: string;
  bubbleStyle: BubbleStyle;
  bubbleColorTheme: BubbleColorTheme;
  onReact: (messageId: string, emoji: string) => void;
  emojiPickerOpen: boolean;
  emojiCategory: string;
  gifPickerOpen: boolean;
  gifSearchQuery: string;
  replyTo: NcMessage | null;
  uploadProgress: { label: string; progress: number } | null;
  onCreateGroup: () => void;
  onDeleteHistory: () => void;
  onArchiveToggle: () => void;
  onOpenGroupSettings: () => void;
  onOpenProfile: () => void;
  onStartCall: (type: "audio" | "video") => void;
  onSend: (text: string) => void;
  onSendGif: (url: string) => void;
  onSendFiles: (files: File[]) => void;
  onSendVoice: (blob: Blob) => void;
  onReply: (message: NcMessage) => void;
  onCancelReply: () => void;
  onEditMessage: (messageId: string, content: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  onToggleEmojiPicker: () => void;
  onEmojiCategoryChange: (category: string) => void;
  onGifSearchChange: (query: string) => void;
  onToggleGifPicker: () => void;
}

export function ChatWindow({
  chat,
  messages,
  canManageOthers,
  currentUserId,
  isArchived,
  wallpaper,
  bubbleStyle,
  bubbleColorTheme,
  onReact,
  emojiPickerOpen,
  emojiCategory,
  gifPickerOpen,
  gifSearchQuery,
  replyTo,
  uploadProgress,
  onCreateGroup,
  onDeleteHistory,
  onArchiveToggle,
  onOpenGroupSettings,
  onOpenProfile,
  onStartCall,
  onSend,
  onSendGif,
  onSendFiles,
  onSendVoice,
  onReply,
  onCancelReply,
  onEditMessage,
  onDeleteMessage,
  onTypingStart,
  onTypingStop,
  onToggleEmojiPicker,
  onEmojiCategoryChange,
  onGifSearchChange,
  onToggleGifPicker,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (!searchQuery.trim()) return messages;
    return messages.filter((m) =>
      [m.text, m.senderName, m.replyPreview?.text ?? ""].join(" ").toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [messages, searchQuery]);

  const groups = groupMessagesByDate(visibleMessages);

  return (
    <div className="relative flex h-screen flex-1 flex-col overflow-hidden bg-nc-bg">
      <Header
        chat={chat}
        searchActive={searchActive}
        isArchived={isArchived}
        canManageGroup={canManageOthers}
        onAvatarClick={onOpenProfile}
        onCreateGroup={onCreateGroup}
        onDeleteHistory={onDeleteHistory}
        onArchiveToggle={onArchiveToggle}
        onOpenGroupSettings={onOpenGroupSettings}
        onSearchToggle={() => {
          setSearchActive((v) => !v);
          setSearchQuery("");
        }}
        onStartCall={onStartCall}
      />

      {searchActive && (
        <div className="shrink-0 border-b border-nc-border bg-nc-sidebar px-4 py-2">
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages…"
            className="w-full rounded-full border border-nc-border bg-nc-surface px-4 py-2 text-[13px] text-nc-text outline-none transition-colors placeholder-nc-muted focus:border-nc-primary"
          />
        </div>
      )}

      <div
        className="flex-1 overflow-y-auto bg-nc-bg px-4 py-2"
        style={wallpaper ? { backgroundImage: wallpaper, backgroundPosition: "center", backgroundSize: "cover" } : undefined}
      >
        {groups.length === 0 && (
          <p className="pt-10 text-center text-[13px] text-nc-muted">
            {searchQuery ? "No messages match your search" : "No messages yet"}
          </p>
        )}
        {groups.map((group, gi) => (
          <div key={gi}>
            <div className="my-4 flex justify-center">
              <span className="select-none rounded-full bg-nc-surface px-3 py-1 text-[11px] text-nc-muted">
                {group.label}
              </span>
            </div>

            {group.messages.map((msg, mi) => {
              const prev = group.messages[mi - 1];
              const sameSender = prev?.isOutgoing === msg.isOutgoing && prev?.senderId === msg.senderId;
              return (
                <div key={msg.id} className={sameSender ? "mt-0.5" : "mt-2"}>
                  <MessageBubble
                    message={msg}
                    canManageOthers={canManageOthers}
                    currentUserId={currentUserId}
                    bubbleStyle={bubbleStyle}
                    bubbleColorTheme={bubbleColorTheme}
                    onReply={onReply}
                    onReact={onReact}
                    onEdit={onEditMessage}
                    onDelete={onDeleteMessage}
                  />
                </div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} className="h-1" />
      </div>

      <InputBar
        onSend={onSend}
        onSendGif={onSendGif}
        onSendFiles={onSendFiles}
        onSendVoice={onSendVoice}
        onTypingStart={onTypingStart}
        onTypingStop={onTypingStop}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        emojiPickerOpen={emojiPickerOpen}
        emojiCategory={emojiCategory}
        gifPickerOpen={gifPickerOpen}
        gifSearchQuery={gifSearchQuery}
        uploadProgress={uploadProgress}
        onToggleEmojiPicker={onToggleEmojiPicker}
        onEmojiCategoryChange={onEmojiCategoryChange}
        onGifSearchChange={onGifSearchChange}
        onToggleGifPicker={onToggleGifPicker}
      />
    </div>
  );
}
