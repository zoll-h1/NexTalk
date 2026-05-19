"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BUBBLE_COLOR_STORAGE_KEY, BUBBLE_STORAGE_KEY, THEME_STORAGE_KEY, WALLPAPER_CUSTOM_DATA_KEY, WALLPAPER_STORAGE_KEY, applyTheme, getWallpaperValue, type BubbleColorTheme, type BubbleStyle, type ThemePreference } from "@/lib/appearance";
import { apiRequest, WS_BASE_URL } from "@/lib/api";
import {
  chatToNc,
  dateGroup,
  formatTime,
  getMessagePreview,
  messageToNc,
} from "@/lib/nexchat-adapters";
import type { NcMessage } from "@/lib/nexchat-mock";
import type {
  Attachment,
  Chat,
  ChatMember,
  Message,
  NotificationItem,
  UiMessage,
  UploadPresignResponse,
  User,
  UserStatus,
  WebSocketEvent,
} from "@/lib/types";
import { useAuth } from "@/lib/useAuth";
import { CallModal } from "./CallModal";
import { ChatList, type ChatFolder } from "./ChatList";
import { ChatWindow } from "./ChatWindow";
import { ContactsPanel } from "./ContactsPanel";
import { GroupSettingsModal, NewGroupModal } from "./GroupModals";
import { LoginScreen } from "./LoginScreen";
import { NotificationPanel } from "./NotificationPanel";
import { SettingsPanel } from "./SettingsPanel";
import { Sidebar } from "./Sidebar";
import { UserProfilePanel } from "./UserProfilePanel";

const ARCHIVE_STORAGE_KEY = "nexchat.archived";
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "dark";
  return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

function getStoredWallpaperId() {
  if (typeof window === "undefined") return "none";
  return localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? "none";
}

function getStoredCustomWallpaper() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(WALLPAPER_CUSTOM_DATA_KEY) ?? "";
}

function getStoredBubbleStyle(): BubbleStyle {
  if (typeof window === "undefined") return "rounded";
  const stored = localStorage.getItem(BUBBLE_STORAGE_KEY);
  return stored === "sharp" || stored === "minimal" ? stored : "rounded";
}

function getStoredBubbleColorTheme(): BubbleColorTheme {
  if (typeof window === "undefined") return "default";
  const stored = localStorage.getItem(BUBBLE_COLOR_STORAGE_KEY);
  const valid: BubbleColorTheme[] = ["default", "giraffe", "cat", "dog", "ocean", "forest", "fire", "candy"];
  return valid.includes(stored as BubbleColorTheme) ? (stored as BubbleColorTheme) : "default";
}

function getCallMediaError(callType: "audio" | "video", error?: unknown) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return callType === "video"
      ? "Camera and microphone require HTTPS. Use https://localhost"
      : "Microphone requires HTTPS. Use https://localhost";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return callType === "video" ? "Camera or microphone permission denied" : "Microphone permission denied";
  }
  return callType === "video" ? "Camera or microphone unavailable" : "Microphone unavailable";
}

interface UploadProgressState {
  label: string;
  progress: number;
}

interface CallUiState {
  callId: string | null;
  callType: "audio" | "video";
  chatId: string;
  initiatorId: string;
  status: "incoming" | "ringing" | "active";
  startedAt?: string;
  sdpOffer?: RTCSessionDescriptionInit;
}

function sortChats(chats: Chat[]) {
  return [...chats].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function upsertMessage(list: UiMessage[], message: UiMessage) {
  const idx = list.findIndex((entry) => entry.id === message.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = message;
    return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return [...list, message].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function replaceChat(chats: Chat[], chat: Chat) {
  return sortChats([chat, ...chats.filter((entry) => entry.id !== chat.id)]);
}

function inferMessageType(files: File[]): UiMessage["type"] {
  const first = files[0];
  if (!first) return "text";
  if (first.type.startsWith("image/")) return "image";
  if (first.type.startsWith("video/")) return "video";
  if (first.type.startsWith("audio/")) return "audio";
  return "file";
}

function rawMessagePreview(message?: UiMessage) {
  if (!message) return "";
  if (message.content?.trim()) return message.content.trim();
  const first = message.attachments[0];
  if (!first) return message.type === "image" ? "GIF" : "Attachment";
  if (first.mime_type.startsWith("image/")) return "Photo";
  if (first.mime_type.startsWith("video/")) return "Video";
  if (first.mime_type.startsWith("audio/")) return "Audio";
  return first.file_name;
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-nc-bg">
      <div className="text-center select-none">
        <div className="w-16 h-16 rounded-2xl bg-nc-primary/10 border border-nc-primary/20 flex items-center justify-center mx-auto mb-4 shadow-nc-glow">
          <span className="text-nc-primary text-2xl font-bold tracking-widest">N</span>
        </div>
        <p className="text-nc-text text-[15px] font-semibold mb-1">NexChat</p>
        <p className="text-nc-muted text-[13px]">Select a conversation to start messaging</p>
      </div>
    </div>
  );
}

export function MessengerApp() {
  const { token, user, loading: authLoading, login, register, logout, updateUser } = useAuth();

  const [activeSidebarItem, setActiveSidebarItem] = useState("chats");
  const [folder, setFolder] = useState<ChatFolder>("all");
  const [rawChats, setRawChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messagesByChat, setMessagesByChat] = useState<Record<string, UiMessage[]>>({});
  const [typingByChat, setTypingByChat] = useState<Record<string, string[]>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, UserStatus>>({});
  const [knownUsers, setKnownUsers] = useState<Record<string, User>>({});
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [membersByChat, setMembersByChat] = useState<Record<string, ChatMember[]>>({});
  const [replyToByChat, setReplyToByChat] = useState<Record<string, NcMessage | null>>({});
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState("Smileys");
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState("");
  const [archivedChatIds, setArchivedChatIds] = useState<Set<string>>(new Set());
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [selectedProfileUser, setSelectedProfileUser] = useState<User | null>(null);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const [reactionsByMessage, setReactionsByMessage] = useState<Record<string, Record<string, string[]>>>({});
  const [incomingCall, setIncomingCall] = useState<CallUiState | null>(null);
  const [activeCall, setActiveCall] = useState<CallUiState | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(getStoredTheme);
  const [wallpaperId, setWallpaperId] = useState<string>(getStoredWallpaperId);
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>(getStoredBubbleStyle);
  const [bubbleColorTheme, setBubbleColorTheme] = useState<BubbleColorTheme>(getStoredBubbleColorTheme);

  const wsRef = useRef<WebSocket | null>(null);
  const loadedChatIds = useRef<Set<string>>(new Set());
  const userRef = useRef(user);
  const activeChatIdRef = useRef(activeChatId);
  const activeCallRef = useRef(activeCall);
  const incomingCallRef = useRef(incomingCall);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  userRef.current = user;
  activeChatIdRef.current = activeChatId;
  activeCallRef.current = activeCall;
  incomingCallRef.current = incomingCall;

  const mergeUsers = useCallback((users: User[]) => {
    setKnownUsers((current) => {
      const next = { ...current };
      users.forEach((entry) => {
        next[entry.id] = entry;
      });
      return next;
    });
  }, []);

  const activeChat = useMemo(
    () => rawChats.find((chat) => chat.id === activeChatId) ?? null,
    [activeChatId, rawChats],
  );
  const wallpaper = useMemo(() => getWallpaperValue(wallpaperId), [wallpaperId]);

  const currentRole = useMemo(() => {
    if (!activeChat || !user || activeChat.type === "direct") return null;
    return membersByChat[activeChat.id]?.find((member) => member.user_id === user.id)?.role ?? null;
  }, [activeChat, membersByChat, user]);

  const canManageOthers = currentRole === "owner" || currentRole === "admin";

  const resolveSenderName = useCallback(
    (chat: Chat, message: UiMessage) => {
      if (message.sender_id === user?.id) return user.display_name || user.username;
      if (chat.type === "direct") {
        return chat.display_name ?? chat.name ?? chat.peer_username ?? knownUsers[message.sender_id]?.display_name ?? knownUsers[message.sender_id]?.username ?? "Unknown";
      }
      const member = membersByChat[chat.id]?.find((entry) => entry.user_id === message.sender_id);
      const profile = knownUsers[message.sender_id];
      return member?.display_name ?? member?.username ?? profile?.display_name ?? profile?.username ?? "Unknown";
    },
    [knownUsers, membersByChat, user],
  );

  const activeMessages = useMemo(() => {
    if (!activeChat || !user) return [];
    const rawMessages = messagesByChat[activeChat.id] ?? [];
    const byId = new Map(rawMessages.map((message) => [message.id, message]));
    return rawMessages
      .filter((message) => !message.is_deleted)
      .map((message) => {
        const senderName = resolveSenderName(activeChat, message);
        const replyMessage = message.reply_to_id ? byId.get(message.reply_to_id) : null;
        const replyPreview = replyMessage
          ? {
              id: replyMessage.id,
              senderName: resolveSenderName(activeChat, replyMessage),
              text: rawMessagePreview(replyMessage),
            }
          : null;
        return {
          ...messageToNc(message, user.id, senderName, replyPreview),
          pending: message.isPending,
          dateGroup: dateGroup(message.created_at),
          reactions: reactionsByMessage[message.id] ?? {},
        };
      });
  }, [activeChat, messagesByChat, reactionsByMessage, resolveSenderName, user]);

  const ncChats = useMemo(() => {
    const onlineUsers = new Set(Object.entries(presenceByUserId).filter(([, status]) => status === "online").map(([id]) => id));
    return sortChats(rawChats).map((chat) => {
      const latestMessage = messagesByChat[chat.id]?.at(-1);
      return chatToNc(chat, typingByChat[chat.id] ?? [], onlineUsers, rawMessagePreview(latestMessage));
    });
  }, [messagesByChat, presenceByUserId, rawChats, typingByChat]);

  const activeNcChat = useMemo(() => ncChats.find((chat) => chat.id === activeChatId) ?? null, [activeChatId, ncChats]);
  const replyTo = activeChatId ? replyToByChat[activeChatId] ?? null : null;
  const unreadNotifications = notifications.filter((item) => !item.is_read).length;

  const sendSocketEvent = useCallback((event: WebSocketEvent) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime connection unavailable.");
    }
    wsRef.current.send(JSON.stringify(event));
  }, []);

  const loadMembers = useCallback(async (chatId: string) => {
    if (!token) return;
    const members = await apiRequest<ChatMember[]>(`/chats/${chatId}/members`, { accessToken: token });
    setMembersByChat((current) => ({ ...current, [chatId]: members }));
  }, [token]);

  const loadMessages = useCallback(async (chatId: string) => {
    if (!token || !user) return;
    const data = await apiRequest<Message[]>(`/chats/${chatId}/messages`, { accessToken: token });
    setMessagesByChat((current) => ({ ...current, [chatId]: data }));
  }, [token, user]);

  useEffect(() => {
    if (!user) return;
    mergeUsers([user]);
  }, [mergeUsers, user]);

  useEffect(() => {
    const stored = typeof window === "undefined" ? null : localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (stored) {
      try {
        setArchivedChatIds(new Set(JSON.parse(stored) as string[]));
      } catch {
        setArchivedChatIds(new Set());
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify([...archivedChatIds]));
    }
  }, [archivedChatIds]);

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, wallpaperId);
    }
  }, [wallpaperId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(BUBBLE_STORAGE_KEY, bubbleStyle);
    }
  }, [bubbleStyle]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(BUBBLE_COLOR_STORAGE_KEY, bubbleColorTheme);
    }
  }, [bubbleColorTheme]);

  useEffect(() => {
    if (!token || !user) return;
    Promise.all([
      apiRequest<Chat[]>("/chats", { accessToken: token }),
      apiRequest<NotificationItem[]>("/notifications", { accessToken: token }),
    ])
      .then(([chats, notificationItems]) => {
        setRawChats(sortChats(chats));
        setNotifications(notificationItems);
        if (!activeChatId && chats.length > 0) {
          setActiveChatId(chats[0].id);
        }
      })
      .catch((error) => setAppNotice(error instanceof Error ? error.message : "Unable to load chats."));
  }, [activeChatId, token, user]);

  useEffect(() => {
    if (!activeChatId || !token || loadedChatIds.current.has(activeChatId)) return;
    loadedChatIds.current.add(activeChatId);
    void loadMessages(activeChatId).catch((error) => {
      loadedChatIds.current.delete(activeChatId);
      setAppNotice(error instanceof Error ? error.message : "Unable to load messages.");
    });
    // Mark all messages as read when opening a chat
    void apiRequest(`/chats/${activeChatId}/read`, { method: "POST", accessToken: token })
      .then(() => {
        setRawChats((current) =>
          current.map((chat) => (chat.id === activeChatId ? { ...chat, unread_count: 0 } : chat)),
        );
      })
      .catch(() => undefined);
  }, [activeChatId, loadMessages, token]);

  useEffect(() => {
    if (!activeChat || activeChat.type === "direct") return;
    void loadMembers(activeChat.id).catch(() => undefined);
  }, [activeChat, loadMembers]);

  const cleanupCall = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    remoteStream?.getTracks().forEach((track) => track.stop());
    pendingIceCandidatesRef.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setIncomingCall(null);
    setActiveCall(null);
    setIsMuted(false);
    setIsCameraOff(false);
  }, [localStream, remoteStream]);

  const flushIceCandidates = useCallback((callId: string) => {
    if (!pendingIceCandidatesRef.current.length) return;
    pendingIceCandidatesRef.current.forEach((candidate) => {
      try {
        sendSocketEvent({ type: "call:ice_candidate", payload: { call_id: callId, candidate } });
      } catch {
        return;
      }
    });
    pendingIceCandidatesRef.current = [];
  }, [sendSocketEvent]);

  const createPeerConnection = useCallback(() => {
    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      const callId = activeCallRef.current?.callId;
      if (!callId) {
        pendingIceCandidatesRef.current.push(event.candidate.toJSON());
        return;
      }
      try {
        sendSocketEvent({
          type: "call:ice_candidate",
          payload: { call_id: callId, candidate: event.candidate.toJSON() },
        });
      } catch {
        pendingIceCandidatesRef.current.push(event.candidate.toJSON());
      }
    };
    connection.ontrack = (event) => setRemoteStream(event.streams[0] ?? null);
    peerConnectionRef.current = connection;
    return connection;
  }, [sendSocketEvent]);

  const prepareLocalMedia = useCallback(async (callType: "audio" | "video", connection: RTCPeerConnection) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(getCallMediaError(callType));
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === "video" });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
      return stream;
    } catch (error) {
      throw new Error(getCallMediaError(callType, error));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    const ws = new WebSocket(`${WS_BASE_URL}?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = async (e: MessageEvent) => {
      let event: WebSocketEvent;
      try {
        event = JSON.parse(e.data as string) as WebSocketEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "message:received": {
          const message = event.payload as Message;
          setMessagesByChat((current) => {
            const existing = current[message.chat_id] ?? [];
            const pendingIndex = existing.findIndex(
              (entry) =>
                entry.isPending &&
                entry.sender_id === message.sender_id &&
                entry.content === message.content &&
                entry.type === message.type,
            );
            if (pendingIndex >= 0) {
              const next = [...existing];
              next[pendingIndex] = message;
              return { ...current, [message.chat_id]: next };
            }
            return { ...current, [message.chat_id]: upsertMessage(existing, message) };
          });
          setRawChats((current) =>
            sortChats(
              current.map((chat) =>
                chat.id === message.chat_id ? { ...chat, updated_at: message.created_at } : chat,
              ),
            ),
          );
          return;
        }
        case "message:updated": {
          const message = event.payload as Message;
          setMessagesByChat((current) => ({
            ...current,
            [message.chat_id]: (current[message.chat_id] ?? []).map((entry) =>
              entry.id === message.id ? message : entry,
            ),
          }));
          return;
        }
        case "message:deleted": {
          const payload = event.payload as { chat_id?: string; id?: string; message_id?: string };
          const messageId = payload.message_id ?? payload.id;
          if (!messageId) return;
          setMessagesByChat((current) => {
            const next: Record<string, UiMessage[]> = {};
            Object.entries(current).forEach(([chatId, items]) => {
              next[chatId] = items.filter((entry) => entry.id !== messageId);
            });
            return next;
          });
          setReactionsByMessage((current) => {
            if (!(messageId in current)) return current;
            const next = { ...current };
            delete next[messageId];
            return next;
          });
          return;
        }
        case "typing:indicator": {
          const { chat_id, user_id, is_typing } = event.payload as {
            chat_id: string;
            user_id: string;
            is_typing: boolean;
          };
          if (user_id === userRef.current?.id) return;
          setTypingByChat((current) => {
            const next = new Set(current[chat_id] ?? []);
            if (is_typing) next.add(user_id);
            else next.delete(user_id);
            return { ...current, [chat_id]: [...next] };
          });
          return;
        }
        case "user:presence": {
          const { user_id, status } = event.payload as { user_id: string; status: UserStatus };
          setPresenceByUserId((current) => ({ ...current, [user_id]: status }));
          return;
        }
        case "chat:unread": {
          const { chat_id, unread_count } = event.payload as { chat_id: string; unread_count: number };
          setRawChats((current) =>
            current.map((chat) =>
              chat.id === chat_id ? { ...chat, unread_count } : chat,
            ),
          );
          return;
        }
        case "notification:new": {
          const notification = event.payload as NotificationItem;
          setNotifications((current) => [notification, ...current]);
          return;
        }
        case "call:incoming": {
          const payload = event.payload as {
            call_id?: string;
            id?: string;
            call_type?: "audio" | "video";
            type?: "audio" | "video";
            chat_id: string;
            initiator_id: string;
            sdp_offer: RTCSessionDescriptionInit;
          };
          setIncomingCall({
            callId: payload.call_id ?? payload.id ?? null,
            callType: payload.call_type ?? payload.type ?? "audio",
            chatId: payload.chat_id,
            initiatorId: payload.initiator_id,
            status: "incoming",
            sdpOffer: payload.sdp_offer,
          });
          return;
        }
        case "call:accepted": {
          const payload = event.payload as {
            call_id: string;
            sdp_answer: RTCSessionDescriptionInit;
          };
          if (peerConnectionRef.current) {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.sdp_answer));
          }
          setActiveCall((current) =>
            current
              ? { ...current, callId: payload.call_id, status: "active", startedAt: new Date().toISOString() }
              : current,
          );
          flushIceCandidates(payload.call_id);
          return;
        }
        case "call:ice_candidate": {
          const payload = event.payload as { candidate: RTCIceCandidateInit };
          if (peerConnectionRef.current) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
          }
          return;
        }
        case "call:rejected":
        case "call:ended": {
          cleanupCall();
          return;
        }
        default:
          return;
      }
    };

    ws.onerror = () => {
      // Only surface connection error when no call is in progress (avoids noise from ICE)
      if (!activeCallRef.current && !incomingCallRef.current) {
        setAppNotice("Realtime connection error.");
      }
    };
    ws.onclose = (ev) => {
      if (ev.code !== 1000 && !activeCallRef.current) {
        setAppNotice("Disconnected. Refresh to reconnect.");
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [cleanupCall, flushIceCandidates, token]);

  const uploadFileToPresignedUrl = useCallback(
    (uploadUrl: string, file: File, onProgress: (progress: number) => void) =>
      new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed for ${file.name}`));
        };
        xhr.onerror = () => reject(new Error(`Upload failed for ${file.name}`));
        xhr.send(file);
      }),
    [],
  );

  const uploadAttachments = useCallback(async (files: File[], chatId: string) => {
    if (!token) throw new Error("Missing access token.");
    const uploaded: Attachment[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      setUploadProgress({ label: `Uploading ${file.name}`, progress: 0 });
      const presigned = await apiRequest<UploadPresignResponse>("/uploads/presigned", {
        method: "POST",
        accessToken: token,
        body: {
          scope: "attachment",
          chat_id: chatId,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          file_size: file.size,
        },
      });
      await uploadFileToPresignedUrl(presigned.upload_url, file, (progress) => {
        const base = (index / files.length) * 100;
        const next = base + progress / files.length;
        setUploadProgress({ label: `Uploading ${file.name}`, progress: Math.min(100, Math.round(next)) });
      });
      uploaded.push({
        id: `${presigned.s3_key}-${index}`,
        message_id: "pending",
        s3_key: presigned.s3_key,
        file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        thumbnail_s3_key: null,
        created_at: new Date().toISOString(),
        display_url: URL.createObjectURL(file),
      });
    }
    setUploadProgress(null);
    return uploaded;
  }, [token, uploadFileToPresignedUrl]);

  const sendComposedMessage = useCallback(
    async ({ content, files = [], type }: { content: string; files?: File[]; type: UiMessage["type"] }) => {
      if (!activeChat || !user) return;
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const replyToId = replyTo?.id ?? null;
      let attachments: Attachment[] = [];
      try {
        if (files.length > 0) {
          attachments = await uploadAttachments(files, activeChat.id);
        }
        const createdAt = new Date().toISOString();
        const optimistic: UiMessage = {
          id: requestId,
          temp_id: requestId,
          chat_id: activeChat.id,
          topic_id: null,
          sender_id: user.id,
          content: content || null,
          type,
          reply_to_id: replyToId,
          is_edited: false,
          is_deleted: false,
          created_at: createdAt,
          updated_at: createdAt,
          attachments: attachments.map((attachment, index) => ({
            ...attachment,
            id: `${requestId}-${index}`,
            message_id: requestId,
            created_at: createdAt,
          })),
          isPending: true,
        };
        setMessagesByChat((current) => ({
          ...current,
          [activeChat.id]: upsertMessage(current[activeChat.id] ?? [], optimistic),
        }));
        setRawChats((current) =>
          sortChats(current.map((chat) => (chat.id === activeChat.id ? { ...chat, updated_at: createdAt } : chat))),
        );
        sendSocketEvent({
          type: "message:send",
          request_id: requestId,
          payload: {
            chat_id: activeChat.id,
            content: content || null,
            type,
            reply_to_id: replyToId,
            attachments: attachments.map((attachment) => ({
              s3_key: attachment.s3_key,
              file_name: attachment.file_name,
              mime_type: attachment.mime_type,
              file_size: attachment.file_size,
            })),
          },
        });
        setReplyToByChat((current) => ({ ...current, [activeChat.id]: null }));
      } catch (error) {
        setUploadProgress(null);
        setAppNotice(error instanceof Error ? error.message : "Unable to send the message.");
      }
    },
    [activeChat, replyTo, sendSocketEvent, uploadAttachments, user],
  );

  const handleSend = useCallback((text: string) => {
    void sendComposedMessage({ content: text, type: "text" });
  }, [sendComposedMessage]);

  const handleSendGif = useCallback((url: string) => {
    setGifPickerOpen(false);
    setGifSearchQuery("");
    void sendComposedMessage({ content: url, type: "image" });
  }, [sendComposedMessage]);

  const handleSendFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    void sendComposedMessage({ content: "", files, type: inferMessageType(files) });
  }, [sendComposedMessage]);

  const handleSendVoice = useCallback((blob: Blob) => {
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
    void sendComposedMessage({ content: "", files: [file], type: "audio" });
  }, [sendComposedMessage]);

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    if (!activeChat) return;
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: (current[activeChat.id] ?? []).map((entry) =>
        entry.id === messageId ? { ...entry, content, is_edited: true, updated_at: new Date().toISOString() } : entry,
      ),
    }));
    try {
      sendSocketEvent({ type: "message:edit", payload: { message_id: messageId, content } });
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Unable to edit the message.");
    }
  }, [activeChat, sendSocketEvent]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!activeChat) return;
    setMessagesByChat((current) => ({
      ...current,
      [activeChat.id]: (current[activeChat.id] ?? []).filter((entry) => entry.id !== messageId),
    }));
    setReactionsByMessage((current) => {
      if (!(messageId in current)) return current;
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    try {
      sendSocketEvent({ type: "message:delete", payload: { message_id: messageId } });
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Unable to delete the message.");
    }
  }, [activeChat, sendSocketEvent]);

  const handleReact = useCallback((messageId: string, emoji: string) => {
    if (!user) return;
    setReactionsByMessage((current) => {
      const msg = { ...(current[messageId] ?? {}) };
      const users = msg[emoji] ? [...msg[emoji]] : [];
      const idx = users.indexOf(user.id);
      if (idx >= 0) users.splice(idx, 1);
      else users.push(user.id);
      if (users.length === 0) delete msg[emoji];
      else msg[emoji] = users;
      return { ...current, [messageId]: msg };
    });
  }, [user]);

  const handleTypingStart = useCallback(() => {
    if (!activeChat) return;
    try {
      sendSocketEvent({ type: "typing:start", payload: { chat_id: activeChat.id } });
    } catch {
      return;
    }
  }, [activeChat, sendSocketEvent]);

  const handleTypingStop = useCallback(() => {
    if (!activeChat) return;
    try {
      sendSocketEvent({ type: "typing:stop", payload: { chat_id: activeChat.id } });
    } catch {
      return;
    }
  }, [activeChat, sendSocketEvent]);

  const toggleArchive = useCallback(() => {
    if (!activeChatId) return;
    setArchivedChatIds((current) => {
      const next = new Set(current);
      if (next.has(activeChatId)) next.delete(activeChatId);
      else next.add(activeChatId);
      return next;
    });
  }, [activeChatId]);

  const deleteHistory = useCallback(() => {
    if (!activeChatId) return;
    if (!window.confirm("Clear this chat history locally?")) return;
    const messageIds = (messagesByChat[activeChatId] ?? []).map((message) => message.id);
    setMessagesByChat((current) => ({ ...current, [activeChatId]: [] }));
    setReactionsByMessage((current) => {
      if (messageIds.length === 0) return current;
      const next = { ...current };
      messageIds.forEach((messageId) => {
        delete next[messageId];
      });
      return next;
    });
    setAppNotice("History cleared locally.");
  }, [activeChatId, messagesByChat]);

  const openProfile = useCallback(async () => {
    if (!activeChat || !token) return;
    setProfilePanelOpen(true);
    if (activeChat.type !== "direct" || !activeChat.peer_username) {
      setSelectedProfileUser(null);
      return;
    }
    try {
      const users = await apiRequest<User[]>(`/users/search?q=${encodeURIComponent(activeChat.peer_username)}`, { accessToken: token });
      const exact = users.find((entry) => entry.username === activeChat.peer_username) ?? users[0] ?? null;
      if (exact) {
        mergeUsers([exact]);
        setSelectedProfileUser(exact);
      }
    } catch {
      setSelectedProfileUser(null);
    }
  }, [activeChat, mergeUsers, token]);

  const handleProfileSave = useCallback(async ({ display_name, bio, custom_status, status, avatarFile }: {
    display_name: string;
    bio: string;
    custom_status: string;
    status: UserStatus;
    avatarFile: File | null;
  }) => {
    if (!token || !user) return;
    setSavingProfile(true);
    try {
      let avatarUrl = user.avatar_url;
      if (avatarFile) {
        const presigned = await apiRequest<UploadPresignResponse>("/uploads/presigned", {
          method: "POST",
          accessToken: token,
          body: {
            scope: "avatar",
            file_name: avatarFile.name,
            mime_type: avatarFile.type || "application/octet-stream",
            file_size: avatarFile.size,
          },
        });
        await uploadFileToPresignedUrl(presigned.upload_url, avatarFile, () => undefined);
        avatarUrl = presigned.s3_key;
      }
      const updatedUser = await apiRequest<User>("/users/me", {
        method: "PATCH",
        accessToken: token,
        body: {
          display_name,
          bio: bio || null,
          custom_status: custom_status || null,
          status,
          avatar_url: avatarUrl,
        },
      });
      updateUser(updatedUser);
      mergeUsers([updatedUser]);
      setAppNotice("Profile updated.");
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Unable to save the profile.");
    } finally {
      setSavingProfile(false);
    }
  }, [mergeUsers, token, updateUser, uploadFileToPresignedUrl, user]);

  const handleMarkAllNotificationsRead = useCallback(async () => {
    if (!token) return;
    try {
      await apiRequest<void>("/notifications/read-all", { method: "POST", accessToken: token });
      setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    } catch (error) {
      setAppNotice(error instanceof Error ? error.message : "Unable to mark notifications read.");
    }
  }, [token]);

  const handleChatOpened = useCallback((chat: Chat) => {
    setRawChats((current) => replaceChat(current, chat));
    setActiveSidebarItem("chats");
    setFolder("all");
    setActiveChatId(chat.id);
  }, []);

  const startCall = useCallback(async (callType: "audio" | "video") => {
    if (!activeChat || !user) return;
    setCallError(null);
    try {
      cleanupCall();
      const connection = createPeerConnection();
      await prepareLocalMedia(callType, connection);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      setActiveCall({ callId: null, callType, chatId: activeChat.id, initiatorId: user.id, status: "ringing" });
      sendSocketEvent({
        type: "call:invite",
        payload: { chat_id: activeChat.id, call_type: callType, sdp_offer: connection.localDescription?.toJSON() },
      });
    } catch (error) {
      cleanupCall();
      setCallError(error instanceof Error ? error.message : "Unable to start the call.");
    }
  }, [activeChat, cleanupCall, createPeerConnection, prepareLocalMedia, sendSocketEvent, user]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    setCallError(null);
    try {
      const connection = createPeerConnection();
      await prepareLocalMedia(incomingCall.callType, connection);
      if (incomingCall.sdpOffer) {
        await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.sdpOffer));
      }
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      setActiveCall({
        callId: incomingCall.callId,
        callType: incomingCall.callType,
        chatId: incomingCall.chatId,
        initiatorId: incomingCall.initiatorId,
        status: "active",
        startedAt: new Date().toISOString(),
      });
      setIncomingCall(null);
      sendSocketEvent({
        type: "call:accept",
        payload: { call_id: incomingCall.callId, sdp_answer: connection.localDescription?.toJSON() },
      });
      if (incomingCall.callId) flushIceCandidates(incomingCall.callId);
      setActiveChatId(incomingCall.chatId);
      setActiveSidebarItem("chats");
    } catch (error) {
      cleanupCall();
      setCallError(error instanceof Error ? error.message : "Unable to accept the call.");
    }
  }, [cleanupCall, createPeerConnection, flushIceCandidates, incomingCall, prepareLocalMedia, sendSocketEvent]);

  const rejectIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    try {
      sendSocketEvent({ type: "call:reject", payload: { call_id: incomingCall.callId } });
      setIncomingCall(null);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Unable to reject the call.");
    }
  }, [incomingCall, sendSocketEvent]);

  const endCurrentCall = useCallback(() => {
    try {
      if (activeCall?.callId) {
        sendSocketEvent({ type: "call:end", payload: { call_id: activeCall.callId } });
      }
    } catch {
      // ignore, local cleanup below
    }
    cleanupCall();
  }, [activeCall?.callId, cleanupCall, sendSocketEvent]);

  const toggleMute = useCallback(() => {
    localStream?.getAudioTracks().forEach((track) => {
      const next = !track.enabled;
      track.enabled = next;
      setIsMuted(!next);
    });
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    localStream?.getVideoTracks().forEach((track) => {
      const next = !track.enabled;
      track.enabled = next;
      setIsCameraOff(!next);
    });
  }, [localStream]);

  if (authLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-nc-bg">
        <div className="text-nc-muted text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (!token || !user) {
    return (
      <LoginScreen
        onLogin={login}
        onRegister={(username, email, password, displayName) => register(username, email, password, displayName)}
      />
    );
  }

  const callChat = rawChats.find((chat) => chat.id === (activeCall?.chatId ?? incomingCall?.chatId)) ?? activeChat ?? null;
  const activeMembers = activeChat ? membersByChat[activeChat.id] ?? [] : [];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-nc-bg">
      <Sidebar active={activeSidebarItem} unreadNotifications={unreadNotifications} onSelect={setActiveSidebarItem} />
      {activeSidebarItem === "chats" && (
        <ChatList
          chats={ncChats}
          activeId={activeChatId}
          folder={folder}
          archivedChatIds={archivedChatIds}
          onFolderChange={setFolder}
          onSelect={(id) => {
            setActiveChatId(id);
            setActiveSidebarItem("chats");
            // Mark as read immediately for already-loaded chats
            if (token) {
              void apiRequest(`/chats/${id}/read`, { method: "POST", accessToken: token })
                .then(() => setRawChats((c) => c.map((chat) => (chat.id === id ? { ...chat, unread_count: 0 } : chat))))
                .catch(() => undefined);
            }
          }}
          onCreateGroup={() => setNewGroupOpen(true)}
          onUnarchive={(id) =>
            setArchivedChatIds((current) => {
              const next = new Set(current);
              next.delete(id);
              return next;
            })
          }
        />
      )}

      <div className="relative flex-1">
        {activeSidebarItem === "chats" && appNotice && (
          <div className="absolute left-4 right-4 top-4 z-30 rounded-2xl border border-nc-primary/25 bg-nc-primary/10 px-4 py-3 text-sm text-nc-text shadow-nc-glow">
            <div className="flex items-center justify-between gap-3">
              <span>{appNotice}</span>
              <button type="button" onClick={() => setAppNotice(null)} className="text-nc-muted hover:text-nc-text">Dismiss</button>
            </div>
          </div>
        )}

        {activeSidebarItem === "contacts" ? (
          <ContactsPanel token={token} onChatOpened={handleChatOpened} />
        ) : activeSidebarItem === "notifications" ? (
          <NotificationPanel
            notifications={notifications}
            onOpenChat={(chatId) => {
              setActiveSidebarItem("chats");
              setActiveChatId(chatId);
            }}
            onMarkAllRead={() => void handleMarkAllNotificationsRead()}
          />
        ) : activeSidebarItem === "settings" || activeSidebarItem === "profile" ? (
          <SettingsPanel
            user={user}
            saving={savingProfile}
            notice={appNotice}
            theme={theme}
            wallpaperId={wallpaperId}
            bubbleStyle={bubbleStyle}
            bubbleColorTheme={bubbleColorTheme}
            onLogout={() => void logout()}
            onThemeChange={setTheme}
            onWallpaperChange={setWallpaperId}
            onBubbleStyleChange={setBubbleStyle}
            onBubbleColorThemeChange={setBubbleColorTheme}
            onSave={(payload) => void handleProfileSave(payload)}
          />
        ) : activeNcChat ? (
          <ChatWindow
            chat={activeNcChat}
            messages={activeMessages}
            canManageOthers={canManageOthers}
            currentUserId={user.id}
            isArchived={archivedChatIds.has(activeNcChat.id)}
            wallpaper={wallpaper}
            bubbleStyle={bubbleStyle}
            bubbleColorTheme={bubbleColorTheme}
            onReact={handleReact}
            emojiPickerOpen={emojiPickerOpen}
            emojiCategory={emojiCategory}
            gifPickerOpen={gifPickerOpen}
            gifSearchQuery={gifSearchQuery}
            replyTo={replyTo}
            uploadProgress={uploadProgress}
            onCreateGroup={() => setNewGroupOpen(true)}
            onDeleteHistory={deleteHistory}
            onArchiveToggle={toggleArchive}
            onOpenGroupSettings={() => setGroupSettingsOpen(true)}
            onOpenProfile={() => void openProfile()}
            onStartCall={(type) => void startCall(type)}
            onSend={handleSend}
            onSendGif={handleSendGif}
            onSendFiles={handleSendFiles}
            onSendVoice={handleSendVoice}
            onReply={(message) => setReplyToByChat((current) => ({ ...current, [activeNcChat.id]: message }))}
            onCancelReply={() => setReplyToByChat((current) => ({ ...current, [activeNcChat.id]: null }))}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            onToggleEmojiPicker={() => {
              setEmojiPickerOpen((current) => !current);
              setGifPickerOpen(false);
            }}
            onEmojiCategoryChange={setEmojiCategory}
            onGifSearchChange={setGifSearchQuery}
            onToggleGifPicker={() => {
              setGifPickerOpen((current) => !current);
              setEmojiPickerOpen(false);
            }}
          />
        ) : (
          <EmptyState />
        )}

        <UserProfilePanel
          open={profilePanelOpen}
          chat={activeNcChat}
          user={selectedProfileUser}
          memberCount={activeMembers.length}
          onClose={() => setProfilePanelOpen(false)}
          onMessage={() => {
            setProfilePanelOpen(false);
            setActiveSidebarItem("chats");
          }}
        />
      </div>

      <NewGroupModal
        open={newGroupOpen}
        token={token}
        existingGroups={ncChats.filter((chat) => chat.type === "group")}
        onClose={() => setNewGroupOpen(false)}
        onCreated={(chat) => {
          handleChatOpened(chat);
          setNewGroupOpen(false);
        }}
      />

      <GroupSettingsModal
        open={groupSettingsOpen}
        token={token}
        chat={activeChat}
        members={activeMembers}
        currentUserId={user.id}
        onClose={() => setGroupSettingsOpen(false)}
        onUpdated={(chat) => {
          setRawChats((current) => replaceChat(current, chat));
        }}
        onMembersChanged={() => void (activeChat ? loadMembers(activeChat.id) : Promise.resolve())}
      />

      <CallModal
        incomingCall={incomingCall}
        activeCall={activeCall}
        chatName={callChat?.display_name ?? callChat?.name ?? callChat?.peer_username ?? "NexChat"}
        avatarUrl={callChat?.display_avatar_url ?? callChat?.avatar_url}
        localStream={localStream}
        remoteStream={remoteStream}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
        callError={callError}
        onAccept={() => void acceptIncomingCall()}
        onReject={rejectIncomingCall}
        onEnd={endCurrentCall}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
      />
    </div>
  );
}
