export type UserStatus = "online" | "offline" | "away" | "do_not_disturb";

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  display_avatar_url: string | null;
  bio: string | null;
  status: UserStatus;
  custom_status: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
  last_seen: string | null;
}

export interface Topic {
  id: string;
  chat_id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  is_archived: boolean;
}

export interface Chat {
  id: string;
  type: "direct" | "group" | "supergroup";
  name: string | null;
  display_name: string | null;
  description: string | null;
  avatar_url: string | null;
  display_avatar_url: string | null;
  invite_link: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  unread_count: number;
  peer_id: string | null;
  peer_username: string | null;
  peer_status: UserStatus | null;
}

export interface Attachment {
  id: string;
  message_id: string;
  s3_key: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  thumbnail_s3_key: string | null;
  created_at: string;
  display_url?: string | null;
}

export interface Message {
  id: string;
  chat_id: string;
  topic_id: string | null;
  sender_id: string;
  content: string | null;
  type: "text" | "image" | "video" | "audio" | "file" | "call_log" | "system";
  reply_to_id: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  attachments: Attachment[];
}

export interface UiMessage extends Message {
  temp_id?: string;
  isPending?: boolean;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, string>;
  is_read: boolean;
  created_at: string;
}

export interface CallParticipant {
  user_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface CallRecord {
  id: string;
  chat_id: string;
  initiator_id: string;
  type: "audio" | "video";
  status: "ringing" | "active" | "ended" | "missed" | "rejected";
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  participants: CallParticipant[];
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
}

export interface UploadPresignResponse {
  upload_url: string;
  s3_key: string;
  expires_in: number;
}

export interface DownloadPresignResponse {
  download_url: string;
  s3_key: string;
  expires_in: number;
}

export interface WebSocketEvent<T = unknown> {
  type: string;
  payload: T;
  request_id?: string;
}


export interface ChatMember {
  user_id: string;
  chat_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  username?: string;
  display_name?: string;
  avatar_url?: string;
}
