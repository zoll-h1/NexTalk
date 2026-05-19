import type { Attachment, Chat, Message } from "./types";
import type { NcChat, NcMessage, NcReplyPreview } from "./nexchat-mock";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #6C63FF 0%, #9B5DE5 100%)",
  "linear-gradient(135deg, #FF6B6B 0%, #FF8E53 100%)",
  "linear-gradient(135deg, #4ECDC4 0%, #44A08D 100%)",
  "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)",
  "linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)",
  "linear-gradient(135deg, #f953c6 0%, #b91d73 100%)",
];

function colorForId(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function dateGroup(dateStr: string): "today" | "yesterday" {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return diffDays <= 0 ? "today" : "yesterday";
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentUrl(attachment: Attachment): string | null {
  return attachment.display_url ?? null;
}

export function getMessagePreview(message?: Pick<NcMessage, "text" | "attachments" | "type"> | null): string {
  if (!message) return "";
  if (message.text.trim()) return message.text.trim();
  const first = message.attachments[0];
  if (!first) return message.type === "image" ? "GIF" : "Attachment";
  if (first.mime_type.startsWith("image/")) return "Photo";
  if (first.mime_type.startsWith("video/")) return "Video";
  if (first.mime_type.startsWith("audio/")) return "Audio";
  return first.file_name;
}

export function chatToNc(
  chat: Chat,
  typingUserIds: string[],
  onlineUsers: Set<string>,
  lastMessage: string,
): NcChat {
  const name = chat.display_name ?? chat.name ?? chat.peer_username ?? "Unknown";
  const isOnline = chat.peer_id ? onlineUsers.has(chat.peer_id) : chat.peer_status === "online";

  return {
    id: chat.id,
    name,
    initials: initials(name),
    avatarColor: colorForId(chat.id),
    avatarUrl: chat.display_avatar_url ?? chat.avatar_url,
    lastMessage,
    timestamp: formatTime(chat.updated_at),
    unread: chat.unread_count,
    online: isOnline,
    isTyping: typingUserIds.length > 0,
    type: chat.type,
    description: chat.description,
    parentId: chat.parent_id ?? null,
    peerId: chat.peer_id,
    peerUsername: chat.peer_username,
    rawChat: chat,
  };
}

export function messageToNc(
  msg: Message,
  currentUserId: string,
  senderName: string,
  replyPreview: NcReplyPreview | null,
): NcMessage {
  return {
    id: msg.id,
    text: msg.content ?? "",
    isOutgoing: msg.sender_id === currentUserId,
    timestamp: formatTime(msg.created_at),
    reactions: {},
    read: false,
    dateGroup: dateGroup(msg.created_at),
    senderId: msg.sender_id,
    senderName,
    type: msg.type,
    attachments: msg.attachments,
    replyToId: msg.reply_to_id,
    replyPreview,
    isEdited: msg.is_edited,
    isDeleted: msg.is_deleted,
    createdAt: msg.created_at,
  };
}
