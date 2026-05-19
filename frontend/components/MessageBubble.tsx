"use client";

import { Download, MoreHorizontal, Pencil, Reply, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { getBubbleGradient, type BubbleColorTheme, type BubbleStyle } from "@/lib/appearance";
import { formatFileSize, getAttachmentUrl } from "@/lib/nexchat-adapters";
import type { NcMessage } from "@/lib/nexchat-mock";

interface MessageBubbleProps {
  message: NcMessage;
  canManageOthers: boolean;
  currentUserId: string;
  bubbleStyle: BubbleStyle;
  bubbleColorTheme: BubbleColorTheme;
  onReply: (message: NcMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onDelete: (messageId: string) => void;
}

const QUICK_REACTIONS = ["❤️", "👍", "😂", "😮", "😢", "🔥"] as const;

function getBubbleClass(isOutgoing: boolean, bubbleStyle: BubbleStyle) {
  if (!isOutgoing) {
    if (bubbleStyle === "minimal") return "rounded-lg bg-transparent";
    if (bubbleStyle === "sharp") return "rounded-lg bg-nc-surface2";
    return "bubble-in";
  }
  // Outgoing — gradient applied via inline style
  if (bubbleStyle === "minimal") return "rounded-lg bg-transparent";
  if (bubbleStyle === "sharp") return "rounded-lg";
  return "bubble-out-shape";
}

export function MessageBubble({ message, canManageOthers, currentUserId, bubbleStyle, bubbleColorTheme, onReply, onReact, onEdit, onDelete }: MessageBubbleProps) {
  const { text, isOutgoing, timestamp, read } = message;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(text);
  const menuRef = useRef<HTMLDivElement>(null);

  const canEdit = isOutgoing && message.type === "text" && message.attachments.length === 0 && !message.isDeleted;
  const canDelete = isOutgoing || canManageOthers;
  const isMinimal = bubbleStyle === "minimal";
  const bubbleClass = getBubbleClass(isOutgoing, bubbleStyle);
  // Apply gradient to outgoing bubbles (unless minimal)
  const outgoingBgStyle = isOutgoing && !isMinimal ? { background: getBubbleGradient(bubbleColorTheme) } : undefined;
  const textClass = isMinimal ? "text-nc-text" : isOutgoing ? "text-white" : "text-nc-text";
  const deletedTextClass = isMinimal ? "text-nc-muted" : isOutgoing ? "text-white/60" : "text-nc-muted";
  const timestampClass = isMinimal ? "text-nc-muted" : isOutgoing ? "text-white/40" : "text-nc-muted";
  const replyCardClass = isOutgoing && !isMinimal ? "border-white/10 bg-white/10" : "border-nc-border bg-nc-bg/50";
  const isImageOnlyUrl = useMemo(
    () => message.type === "image" && /^https?:\/\//.test(text.trim()) && message.attachments.length === 0,
    [message.attachments.length, message.type, text],
  );
  const reactionEntries = useMemo(
    () => Object.entries(message.reactions).filter(([, userIds]) => userIds.length > 0),
    [message.reactions],
  );

  useEffect(() => {
    setEditValue(text);
  }, [text]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const saveEdit = () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === text) {
      setEditing(false);
      return;
    }
    onEdit(message.id, trimmed);
    setEditing(false);
  };

  return (
    <div
      className={`group flex flex-col ${isOutgoing ? "items-end" : "items-start"} ${menuOpen ? "relative z-50" : ""}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {!isOutgoing && message.senderName && (
        <div className="mb-1 px-2 text-[11px] font-medium text-nc-muted">{message.senderName}</div>
      )}
      <div ref={menuRef} className="relative max-w-[70%]">
        {/* ··· trigger button — floats outside the bubble */}
        <div
          className={`absolute -top-2 ${isOutgoing ? "left-0 -translate-x-full pr-2" : "right-0 translate-x-full pl-2"} transition-opacity ${menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-nc-border bg-nc-surface text-nc-muted shadow-nc-glow transition-colors hover:text-nc-text"
          >
            <MoreHorizontal size={14} />
          </button>
        </div>

        {/* Dropdown — anchored to the bubble itself so it's always fully visible */}
        {menuOpen && (
          <div
            className={`absolute top-full z-50 mt-1 w-48 overflow-hidden rounded-2xl border border-nc-border bg-nc-surface2 p-2 shadow-nc-glow-lg ${isOutgoing ? "right-0" : "left-0"}`}
          >
            {!message.isDeleted && !editing && (
              <div className="mb-1 flex justify-center gap-1 border-b border-nc-border pb-2">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onReact(message.id, emoji);
                      setMenuOpen(false);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-base transition-colors hover:bg-nc-surface"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <MenuButton
              icon={<Reply size={14} />}
              label="Reply"
              onClick={() => {
                onReply(message);
                setMenuOpen(false);
              }}
            />
            {canEdit && (
              <MenuButton
                icon={<Pencil size={14} />}
                label="Edit"
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
              />
            )}
            {canDelete && (
              <MenuButton
                danger
                icon={<Trash2 size={14} />}
                label="Delete"
                onClick={() => {
                  if (window.confirm("Delete this message?")) onDelete(message.id);
                  setMenuOpen(false);
                }}
              />
            )}
          </div>
        )}

        <div className={`px-[14px] py-[10px] ${bubbleClass}`} style={outgoingBgStyle}>
          {message.replyPreview && (
            <button
              type="button"
              onClick={() => onReply(message)}
              className={`mb-2 block w-full rounded-2xl border px-3 py-2 text-left ${replyCardClass}`}
            >
              <div className={`text-[11px] font-semibold ${isOutgoing && !isMinimal ? "text-white/80" : "text-nc-primary"}`}>
                {message.replyPreview.senderName}
              </div>
              <div className={`truncate text-[12px] ${isOutgoing && !isMinimal ? "text-white/70" : "text-nc-muted"}`}>
                {message.replyPreview.text}
              </div>
            </button>
          )}

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                rows={3}
                className="w-full resize-none rounded-2xl border border-nc-border bg-nc-surface px-3 py-2 text-[14px] leading-relaxed text-nc-text outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} className="rounded-full bg-nc-surface px-3 py-1 text-[12px] text-nc-muted">Cancel</button>
                <button type="button" onClick={saveEdit} className="rounded-full bg-nc-primary px-3 py-1 text-[12px] text-white">Save</button>
              </div>
            </div>
          ) : (
            <>
              {message.isDeleted ? (
                <p className={`text-[14px] italic leading-relaxed ${deletedTextClass}`}>Message deleted</p>
              ) : (
                <>
                  {isImageOnlyUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={text.trim()} alt="GIF" className="max-h-72 w-full rounded-2xl object-cover" />
                  ) : text ? (
                    <p className={`break-words whitespace-pre-wrap text-[14px] leading-relaxed ${textClass}`}>{text}</p>
                  ) : null}
                  {message.attachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {message.attachments.map((attachment) => (
                        <AttachmentCard key={attachment.id} attachment={attachment} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="mt-1 flex items-center justify-end gap-1">
            <span className={`font-mono text-[10px] tabular-nums ${timestampClass}`}>
              {timestamp}{message.isEdited ? " · edited" : ""}{message.pending ? " · sending" : ""}
            </span>
            {isOutgoing && (
              <span className={`text-[11px] font-bold leading-none ${read ? "text-nc-primary" : timestampClass}`}>
                ✓✓
              </span>
            )}
          </div>
        </div>
      </div>

      {reactionEntries.length > 0 && (
        <div className={`mt-1 flex flex-wrap gap-1 ${isOutgoing ? "mr-1" : "ml-1"}`}>
          {reactionEntries.map(([emoji, userIds]) => {
            const reactedByCurrentUser = userIds.includes(currentUserId);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(message.id, emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] transition-colors duration-150 ${
                  reactedByCurrentUser
                    ? "border-nc-primary/40 bg-nc-primary/15 text-nc-primary"
                    : "border-nc-border bg-nc-surface2 text-nc-text hover:bg-nc-surface"
                }`}
              >
                <span>{emoji}</span>
                <span className="text-[11px] font-medium">{userIds.length}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MenuButton({ label, icon, onClick, danger }: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors ${danger ? "text-red-400 hover:bg-red-400/10" : "text-nc-text hover:bg-nc-surface"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function AttachmentCard({ attachment }: { attachment: NcMessage["attachments"][number] }) {
  const url = getAttachmentUrl(attachment);
  const isImage = attachment.mime_type.startsWith("image/");
  const isVideo = attachment.mime_type.startsWith("video/");
  const isAudio = attachment.mime_type.startsWith("audio/");

  if (isImage && url) {
    return (
      <div className="overflow-hidden rounded-2xl bg-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={attachment.file_name} className="max-h-72 w-full object-cover" />
        <AttachmentFooter attachment={attachment} url={url} />
      </div>
    );
  }

  if (isVideo && url) {
    return (
      <div className="overflow-hidden rounded-2xl bg-black/10">
        <video controls className="max-h-72 w-full rounded-2xl" src={url} />
        <AttachmentFooter attachment={attachment} url={url} />
      </div>
    );
  }

  if (isAudio && url) {
    return <AudioPlayer src={url} fileName={attachment.file_name} />;
  }

  return (
    <div className="rounded-2xl bg-black/10 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">{attachment.file_name}</div>
          <div className="text-[11px] text-white/50">{attachment.mime_type} · {formatFileSize(attachment.file_size)}</div>
        </div>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 p-2 text-white/80">
            <Download size={14} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentFooter({ attachment, url }: { attachment: NcMessage["attachments"][number]; url: string }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-black/20 px-3 py-2 text-sm text-white">
      <span className="truncate">{attachment.file_name}</span>
      <a href={url} target="_blank" rel="noreferrer" className="rounded-full bg-white/10 p-2 text-white/80">
        <Download size={14} />
      </a>
    </div>
  );
}

function AudioPlayer({ src, fileName }: { src: string; fileName: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      void audioRef.current.play();
      setPlaying(true);
    } else {
      audioRef.current.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="rounded-2xl bg-black/10 px-3 py-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="mb-2 flex items-center justify-between gap-3">
        <button type="button" onClick={toggle} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white">
          {playing ? "Pause" : "Play"}
        </button>
        <span className="truncate text-xs text-white/70">{fileName}</span>
      </div>
      <input
        type="range"
        min={0}
        max={duration || 0}
        value={currentTime}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (audioRef.current) audioRef.current.currentTime = value;
          setCurrentTime(value);
        }}
        className="w-full accent-white"
      />
      <div className="mt-1 text-right text-[10px] text-white/50">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>
    </div>
  );
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
