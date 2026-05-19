import type { Attachment, Chat, Message } from "./types";

export interface NcChat {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  avatarUrl?: string | null;
  lastMessage: string;
  timestamp: string;
  unread: number;
  online: boolean;
  isTyping: boolean;
  type: Chat["type"];
  description?: string | null;
  parentId?: string | null;
  peerId?: string | null;
  peerUsername?: string | null;
  rawChat: Chat;
}

export interface NcReplyPreview {
  id: string;
  senderName: string;
  text: string;
}

export interface NcMessage {
  id: string;
  text: string;
  isOutgoing: boolean;
  timestamp: string;
  reactions: Record<string, string[]>;
  read?: boolean;
  dateGroup: "today" | "yesterday";
  senderId: string;
  senderName: string;
  type: Message["type"];
  attachments: Attachment[];
  replyToId?: string | null;
  replyPreview?: NcReplyPreview | null;
  isEdited?: boolean;
  isDeleted?: boolean;
  createdAt: string;
  pending?: boolean;
}
