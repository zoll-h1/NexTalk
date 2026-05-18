"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL, ApiError, WS_BASE_URL, apiRequest } from "@/lib/api";
import type {
  AccessTokenResponse,
  Attachment,
  AuthResponse,
  CallRecord,
  Chat,
  ChatMember,
  DownloadPresignResponse,
  Message,
  NotificationItem,
  Topic,
  UiMessage,
  UploadPresignResponse,
  User,
  UserStatus,
  WebSocketEvent,
} from "@/lib/types";

const ACCESS_TOKEN_KEY = "nextalk.access-token";
const TYPING_IDLE_MS = 1200;
const ROOT_TOPIC_KEY = "__all__";

type AuthMode = "login" | "register";
type CallKind = "audio" | "video";

type IncomingCall = {
  callId: string;
  callType: CallKind;
  chatId: string;
  initiatorId: string;
  sdpOffer: RTCSessionDescriptionInit;
};

type ActiveCall = {
  callId: string | null;
  callType: CallKind;
  chatId: string;
  initiatorId: string;
  status: "ringing" | "active";
};

interface AuthFormState {
  display_name: string;
  email: string;
  password: string;
  username: string;
}

interface GroupFormState {
  description: string;
  mode: "group" | "supergroup";
  name: string;
}

interface ProfileFormState {
  avatar_url: string;
  bio: string;
  custom_status: string;
  display_name: string;
  status: UserStatus;
}

function readStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

function persistAccessToken(token: string) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

function clearStoredAccessToken() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatNotificationTitle(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getNotificationPreview(notification: NotificationItem) {
  return (
    notification.payload.preview ??
    notification.payload.chat_id ??
    notification.payload.call_id ??
    "Notification payload received."
  );
}

function getPresenceClass(status: UserStatus | null | undefined) {
  switch (status) {
    case "online":
      return "presence-dot online";
    case "away":
      return "presence-dot away";
    case "do_not_disturb":
      return "presence-dot do_not_disturb";
    default:
      return "presence-dot";
  }
}

interface AvatarProps {
  label: string;
  size?: "sm" | "md" | "lg";
  src?: string | null;
}

function Avatar({ label, size = "md", src }: AvatarProps) {
  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-20 w-20" : "h-10 w-10";
  return (
    <div className={`avatar ${sizeClass}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={label} className="avatar-image" src={src} />
      ) : (
        <span className="avatar-initials">{getInitials(label)}</span>
      )}
    </div>
  );
}

function inferMessageType(files: File[]): UiMessage["type"] {
  if (files.length === 0) {
    return "text";
  }
  const firstType = files[0]?.type ?? "";
  if (files.length === 1 && firstType.startsWith("image/")) {
    return "image";
  }
  if (files.length === 1 && firstType.startsWith("video/")) {
    return "video";
  }
  if (files.length === 1 && firstType.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

function sortMessages(messages: UiMessage[]) {
  return [...messages].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

function upsertMessage(messages: UiMessage[], nextMessage: UiMessage) {
  const filtered = messages.filter(
    (message) => message.id !== nextMessage.id && message.temp_id !== nextMessage.temp_id,
  );
  filtered.push(nextMessage);
  return sortMessages(filtered);
}

function removeTypingUser(current: string[], userId: string) {
  return current.filter((id) => id !== userId);
}

function getMessageKey(chatId: string, topicId: string | null) {
  return `${chatId}:${topicId ?? ROOT_TOPIC_KEY}`;
}

function getIceServers() {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnServer = process.env.NEXT_PUBLIC_TURN_SERVER;
  const turnUser = process.env.NEXT_PUBLIC_TURN_USER;
  const turnPass = process.env.NEXT_PUBLIC_TURN_PASS;
  if (turnServer && turnUser && turnPass) {
    servers.push({ urls: turnServer, username: turnUser, credential: turnPass });
  }
  return servers;
}

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ["#60a5fa","#34d399","#f87171","#a78bfa","#fb923c","#38bdf8","#f472b6","#4ade80","#facc15","#e879f9"];
  return colors[Math.abs(hash) % colors.length] ?? "#60a5fa";
}

const EMOJI_CATEGORIES = [
  { icon: "😀", label: "Smileys", emojis: ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","🥰","😘","🤩","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🫡","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕"] },
  { icon: "👍", label: "Gestures", emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","🫵","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","🫶","👐","🤲","🙏","✍️","💅","🤳","💪","🦾","🦿","🦵","🦶","👂","🦻","👃","👀","👁️","👄","🫦","🦷","👅","🫀","🫁","🧠","🦴","🦷"] },
  { icon: "❤️", label: "Hearts", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","❤️‍🔥","❤️‍🩹","💔","💕","💞","💓","💗","💖","💘","💝","💟","☮️","✝️","☪️","🔯","☸️","✡️","🕉️","⛎","♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","💯","💢","💥","💫","💦","💨","🕳️","💬","💭","💤"] },
  { icon: "🎉", label: "Celebration", emojis: ["🎉","🎊","🎈","🎁","🎀","🎗️","🏆","🥇","🥈","🥉","🏅","🎖️","🎗️","🎫","🎟️","🎪","🤹","🎭","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🎷","🎺","🎸","🪕","🎻","🪗","🎮","🕹️","🎲","♟️","🧩","🧸","🪆","🎯","🎳","🎱","🏓","🏸","🥊","🥋","🎽","🛹","🛼","🛷","⛸️"] },
  { icon: "🌟", label: "Nature", emojis: ["🌸","🌺","🌻","🌹","🌷","💐","🌼","🪷","🪻","🌱","🌿","☘️","🍀","🎋","🎍","🍃","🍂","🍁","🪺","🌾","🐚","🪸","🌵","🎄","🌲","🌳","🌴","🪵","🌊","🌈","⛅","🌤️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","☃️","⛄","🌬️","💨","🌪️","🌫️","🌊","🌙","🌛","🌜","☀️","🌞","⭐","🌟","💫","✨","🌠","☄️","🌏"] },
  { icon: "🍕", label: "Food", emojis: ["🍕","🍔","🌮","🌯","🥙","🧆","🥚","🍳","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍟","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍘","🍥","🍡","🥮","🍢","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🧃","🥤","🧋","☕","🍵","🫖","🍺","🍻","🥂","🍷","🥃","🍸","🍹"] },
  { icon: "🚀", label: "Travel", emojis: ["🚀","✈️","🛸","🚁","🛺","🚂","🚃","🚄","🚅","🚆","🚇","🚈","🚉","🚊","🚝","🚞","🚋","🚌","🚍","🚎","🏎️","🚐","🚑","🚒","🚓","🚔","🚕","🚖","🚗","🚘","🚙","🛻","🚚","🚛","🚜","🛵","🏍️","🛺","🚲","🛴","🛹","🛼","🚏","🛣️","🛤️","⛽","🚨","🚥","🚦","🚧","⚓","🛟","⛵","🚤","🛥️","🛳️","⛴️","🚢","🛩️","💺"] },
  { icon: "🐱", label: "Animals", emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🦆","🐧","🐦","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🪲","🦟","🦗","🪳","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅"] },
];

const STICKER_PACKS = [
  {
    icon: "🥳",
    label: "Party",
    stickers: ["🥳","🎉","🎊","🎈","🥂","🍾","🎆","🎇","✨","🎁","🎀","🎗️","🏆","🎖️","🥇","🎭","🪅","🎠","🎡","🎢"],
  },
  {
    icon: "😎",
    label: "Cool",
    stickers: ["😎","🤩","😏","🥸","🤓","😜","🤪","😝","🤑","🤠","😈","👿","💀","☠️","👻","🤖","👾","🎃","🤡","👹","👺"],
  },
  {
    icon: "🐱",
    label: "Animals",
    stickers: ["🐶","🐱","🐻","🐼","🐨","🐯","🦁","🐮","🐸","🐵","🦊","🐺","🐗","🦄","🐙","🦋","🐢","🦎","🦆","🦉","🐧"],
  },
  {
    icon: "❤️",
    label: "Love",
    stickers: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","❤️‍🔥","💔","💕","💞","💓","💗","💖","💘","💝","🫶","💌","💋"],
  },
  {
    icon: "🔥",
    label: "Fire",
    stickers: ["🔥","💥","⚡","🌊","🌪️","🌈","🌟","✨","💫","⭐","🌠","☄️","🌙","☀️","🌞","🌝","🌚","🌑","🌒","🌓","🌔"],
  },
  {
    icon: "🚀",
    label: "Space",
    stickers: ["🚀","🛸","🌍","🌕","🌙","☀️","⭐","🌟","💫","✨","🌠","☄️","🔭","🛰️","👨‍🚀","👩‍🚀","🧑‍🚀","🪐","🌌","🔬","🧬"],
  },
];

export function MessengerApp() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authForm, setAuthForm] = useState<AuthFormState>({
    display_name: "",
    email: "",
    password: "",
    username: "",
  });
  const [profileForm, setProfileForm] = useState<ProfileFormState>({
    avatar_url: "",
    bio: "",
    custom_status: "",
    display_name: "",
    status: "offline",
  });
  const [profileAvatarFile, setProfileAvatarFile] = useState<File | null>(null);
  const [profileAvatarPreviewUrl, setProfileAvatarPreviewUrl] = useState<string | null>(null);
  const [groupAvatarFile, setGroupAvatarFile] = useState<File | null>(null);
  const [groupAvatarPreviewUrl, setGroupAvatarPreviewUrl] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormState>({
    description: "",
    mode: "group",
    name: "",
  });
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [newTopicName, setNewTopicName] = useState("");
  const [newTopicDescription, setNewTopicDescription] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isNotificationsOpen, setNotificationsOpen] = useState(false);
  const [isProfileOpen, setProfileOpen] = useState(false);
  const [isNewChatOpen, setNewChatOpen] = useState(false);
  const [isDetailsOpen, setDetailsOpen] = useState(false);
  // Group settings state
  const [groupMembers, setGroupMembers] = useState<ChatMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [groupEditName, setGroupEditName] = useState("");
  const [groupEditDesc, setGroupEditDesc] = useState("");
  const [groupEditBusy, setGroupEditBusy] = useState(false);
  const [groupAddUserQuery, setGroupAddUserQuery] = useState("");
  const [groupAddUserResults, setGroupAddUserResults] = useState<User[]>([]);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [emojiPickerTab, setEmojiPickerTab] = useState(0);
  const [stickerPackTab, setStickerPackTab] = useState(0);
  const [messagesByKey, setMessagesByKey] = useState<Record<string, UiMessage[]>>({});
  const [topicsByChat, setTopicsByChat] = useState<Record<string, Topic[]>>({});
  const [selectedTopicIdByChat, setSelectedTopicIdByChat] = useState<Record<string, string | null>>({});
  const [callHistoryByChat, setCallHistoryByChat] = useState<Record<string, CallRecord[]>>({});
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchResults, setChatSearchResults] = useState<UiMessage[]>([]);
  const [messageSearchBusy, setMessageSearchBusy] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [userSearchBusy, setUserSearchBusy] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [typingByChat, setTypingByChat] = useState<Record<string, string[]>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, UserStatus>>({});
  const [userDirectory, setUserDirectory] = useState<Record<string, User>>({});
  const [loadingChatKey, setLoadingChatKey] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const socketReconnectTimeoutRef = useRef<number | null>(null);
  const socketReconnectAttemptsRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const selectedChatIdRef = useRef<string | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const knownReadIdsRef = useRef<Set<string>>(new Set());
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
  }, [selectedChatId]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    setProfileForm({
      avatar_url: currentUser.avatar_url ?? "",
      bio: currentUser.bio ?? "",
      custom_status: currentUser.custom_status ?? "",
      display_name: currentUser.display_name,
      status: currentUser.status,
    });
  }, [currentUser]);

  useEffect(() => {
    if (profileAvatarFile) {
      const url = URL.createObjectURL(profileAvatarFile);
      setProfileAvatarPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setProfileAvatarPreviewUrl(null);
    }
  }, [profileAvatarFile]);

  useEffect(() => {
    if (groupAvatarFile) {
      const url = URL.createObjectURL(groupAvatarFile);
      setGroupAvatarPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setGroupAvatarPreviewUrl(null);
    }
  }, [groupAvatarFile]);

  const mergeUsers = useCallback((users: User[]) => {
    if (users.length === 0) {
      return;
    }
    setUserDirectory((current) => {
      const next = { ...current };
      for (const user of users) {
        next[user.id] = user;
      }
      return next;
    });
  }, []);

  const refreshAccessToken = useCallback(async () => {
    const response = await apiRequest<AccessTokenResponse>("/auth/refresh", { method: "POST" });
    setAccessToken(response.access_token);
    persistAccessToken(response.access_token);
    return response.access_token;
  }, []);

  const clearSession = useCallback(async () => {
    socketRef.current?.close();
    socketRef.current = null;
    clearStoredAccessToken();
    setAccessToken(null);
    setCurrentUser(null);
    setChats([]);
    setNotifications([]);
    setMessagesByKey({});
    setTopicsByChat({});
    setCallHistoryByChat({});
    setSelectedChatId(null);
    setSelectedTopicIdByChat({});
    setChatSearchResults([]);
    setUserSearchResults([]);
    setComposerText("");
    setPendingFiles([]);
    setTypingByChat({});
    setPresenceByUserId({});
    setSocketConnected(false);
    setIncomingCall(null);
    setActiveCall(null);
    setLocalStream(null);
    setRemoteStream(null);
    knownReadIdsRef.current = new Set();
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingIceCandidatesRef.current = [];
  }, []);

  const authorizedRequest = useCallback(
    async <T,>(path: string, options: Parameters<typeof apiRequest<T>>[1] = {}) => {
      const token = accessToken ?? readStoredAccessToken();
      if (!token) {
        throw new Error("Please sign in first.");
      }

      try {
        return await apiRequest<T>(path, { ...options, accessToken: token });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const refreshedToken = await refreshAccessToken();
          return await apiRequest<T>(path, { ...options, accessToken: refreshedToken });
        }
        throw error;
      }
    },
    [accessToken, refreshAccessToken],
  );

  const fetchUserById = useCallback(
    async (userId: string) => {
      if (userDirectory[userId]) {
        return userDirectory[userId];
      }
      const user = await authorizedRequest<User>(`/users/${userId}`);
      mergeUsers([user]);
      return user;
    },
    [authorizedRequest, mergeUsers, userDirectory],
  );

  const syncUserReferences = useCallback(
    async (messages: Message[]) => {
      const missingSenderIds = Array.from(
        new Set(messages.map((message) => message.sender_id).filter((senderId) => !userDirectory[senderId])),
      );
      if (missingSenderIds.length === 0) {
        return;
      }
      const resolved = await Promise.all(missingSenderIds.map((senderId) => fetchUserById(senderId)));
      mergeUsers(resolved);
    },
    [fetchUserById, mergeUsers, userDirectory],
  );

  const ensureDownloadUrl = useCallback(
    async (s3Key: string | null) => {
      if (!s3Key) {
        return null;
      }
      const payload = await authorizedRequest<DownloadPresignResponse>(`/uploads/download/${s3Key}`);
      return payload.download_url;
    },
    [authorizedRequest],
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      const storedToken = readStoredAccessToken();
      if (!storedToken) {
        setBootstrapping(false);
        return;
      }

      try {
        const me = await apiRequest<User>("/auth/me", { accessToken: storedToken });
        if (!active) {
          return;
        }
        setAccessToken(storedToken);
        setCurrentUser(me);
        mergeUsers([me]);
      } catch {
        try {
          const newToken = await refreshAccessToken();
          const me = await apiRequest<User>("/auth/me", { accessToken: newToken });
          if (!active) {
            return;
          }
          setCurrentUser(me);
          mergeUsers([me]);
        } catch {
          if (active) {
            await clearSession();
          }
        }
      } finally {
        if (active) {
          setBootstrapping(false);
        }
      }
    }

    void bootstrap();
    return () => {
      active = false;
    };
  }, [clearSession, mergeUsers, refreshAccessToken]);

  const loadWorkspace = useCallback(async () => {
    if (!currentUser) {
      return;
    }
    setBusyLabel("Loading chats and notifications...");
    try {
      const [nextChats, nextNotifications] = await Promise.all([
        authorizedRequest<Chat[]>("/chats"),
        authorizedRequest<NotificationItem[]>("/notifications"),
      ]);
      setChats(nextChats);
      setNotifications(nextNotifications);
      setSelectedChatId((current) =>
        current && nextChats.some((chat) => chat.id === current) ? current : nextChats[0]?.id ?? null,
      );
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Unable to load your workspace.");
    } finally {
      setBusyLabel(null);
    }
  }, [authorizedRequest, currentUser]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }
    void loadWorkspace();
  }, [currentUser, loadWorkspace]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) ?? null,
    [chats, selectedChatId],
  );
  const selectedTopicId = selectedChatId ? selectedTopicIdByChat[selectedChatId] ?? null : null;
  const selectedMessageKey = selectedChatId ? getMessageKey(selectedChatId, selectedTopicId) : null;
  const selectedMessages = useMemo(
    () => (selectedMessageKey ? messagesByKey[selectedMessageKey] ?? [] : []),
    [messagesByKey, selectedMessageKey],
  );
  const selectedTopics = useMemo(
    () => (selectedChat ? topicsByChat[selectedChat.id] ?? [] : []),
    [selectedChat, topicsByChat],
  );
  const selectedCallHistory = useMemo(
    () => (selectedChat ? callHistoryByChat[selectedChat.id] ?? [] : []),
    [callHistoryByChat, selectedChat],
  );

  const sendSocketEvent = useCallback((event: Record<string, unknown>) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("Realtime connection is not ready yet.");
    }
    socketRef.current.send(JSON.stringify(event));
  }, []);

  const sendQueuedIceCandidates = useCallback(
    (callId: string) => {
      if (pendingIceCandidatesRef.current.length === 0) {
        return;
      }
      for (const candidate of pendingIceCandidatesRef.current) {
        sendSocketEvent({
          type: "call:ice_candidate",
          request_id: `ice-${callId}-${crypto.randomUUID()}`,
          payload: { call_id: callId, candidate },
        });
      }
      pendingIceCandidatesRef.current = [];
    },
    [sendSocketEvent],
  );

  const createPeerConnection = useCallback(() => {
    const connection = new RTCPeerConnection({ iceServers: getIceServers() });
    const nextRemoteStream = new MediaStream();
    setRemoteStream(nextRemoteStream);
    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => nextRemoteStream.addTrack(track));
      setRemoteStream(nextRemoteStream);
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }
      const currentCall = activeCallRef.current;
      const candidate = event.candidate.toJSON();
      if (currentCall?.callId) {
        try {
          sendSocketEvent({
            type: "call:ice_candidate",
            request_id: `ice-${currentCall.callId}-${crypto.randomUUID()}`,
            payload: { call_id: currentCall.callId, candidate },
          });
        } catch {
          pendingIceCandidatesRef.current.push(candidate);
        }
      } else {
        pendingIceCandidatesRef.current.push(candidate);
      }
    };
    peerConnectionRef.current?.close();
    peerConnectionRef.current = connection;
    return connection;
  }, [sendSocketEvent]);

  const cleanupCall = useCallback(() => {
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    localStream?.getTracks().forEach((track) => track.stop());
    remoteStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setIncomingCall(null);
    setActiveCall(null);
    pendingIceCandidatesRef.current = [];
  }, [localStream, remoteStream]);

  const prepareLocalMedia = useCallback(async (callType: CallKind, connection: RTCPeerConnection) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "video",
    });
    setLocalStream(stream);
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    return stream;
  }, []);

  const loadCallHistory = useCallback(
    async (chatId: string) => {
      try {
        const history = await authorizedRequest<CallRecord[]>(`/chats/${chatId}/calls`);
        setCallHistoryByChat((current) => ({ ...current, [chatId]: history }));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to load call history.");
      }
    },
    [authorizedRequest],
  );

  const loadTopics = useCallback(
    async (chatId: string) => {
      try {
        const topics = await authorizedRequest<Topic[]>(`/chats/${chatId}/topics`);
        setTopicsByChat((current) => ({ ...current, [chatId]: topics }));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to load topics.");
      }
    },
    [authorizedRequest],
  );

  const sendReadReceipts = useCallback(
    (chatId: string, messages: UiMessage[]) => {
      const me = currentUserRef.current;
      if (!me) {
        return;
      }
      for (const message of messages) {
        if (message.sender_id === me.id || knownReadIdsRef.current.has(message.id) || message.isPending) {
          continue;
        }
        knownReadIdsRef.current.add(message.id);
        try {
          sendSocketEvent({
            type: "message:read",
            request_id: `read-${message.id}`,
            payload: { chat_id: chatId, message_id: message.id },
          });
        } catch {
          return;
        }
      }
    },
    [sendSocketEvent],
  );

  const fetchGroupMembers = useCallback(
    async (chatId: string) => {
      setGroupMembersLoading(true);
      try {
        const members = await authorizedRequest<ChatMember[]>(`/chats/${chatId}/members`);
        setGroupMembers(members);
      } catch {
        // ignore
      } finally {
        setGroupMembersLoading(false);
      }
    },
    [authorizedRequest],
  );

  const loadMessages = useCallback(
    async (chatId: string, topicId: string | null) => {
      const key = getMessageKey(chatId, topicId);
      setLoadingChatKey(key);
      try {
        const path = topicId
          ? `/chats/${chatId}/topics/${topicId}/messages`
          : `/chats/${chatId}/messages`;
        const messages = await authorizedRequest<Message[]>(path);
        const normalized = sortMessages(messages.map((message) => ({ ...message })));
        setMessagesByKey((current) => ({ ...current, [key]: normalized }));
        await syncUserReferences(messages);
        if (selectedChatIdRef.current === chatId) {
          sendReadReceipts(chatId, normalized);
        }
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to load messages.");
      } finally {
        setLoadingChatKey((current) => (current === key ? null : current));
      }
    },
    [authorizedRequest, sendReadReceipts, syncUserReferences],
  );

  useEffect(() => {
    if (!selectedChat) {
      return;
    }
    if (selectedChat.type === "direct" && !callHistoryByChat[selectedChat.id]) {
      void loadCallHistory(selectedChat.id);
    }
    if (selectedChat.type === "supergroup" && !topicsByChat[selectedChat.id]) {
      void loadTopics(selectedChat.id);
    }
    if (selectedChat.type === "group" || selectedChat.type === "supergroup") {
      setGroupEditName(selectedChat.name ?? "");
      setGroupEditDesc(selectedChat.description ?? "");
      void fetchGroupMembers(selectedChat.id);
    }
  }, [callHistoryByChat, fetchGroupMembers, loadCallHistory, loadTopics, selectedChat, topicsByChat]);

  useEffect(() => {
    if (!selectedChatId || !selectedMessageKey || messagesByKey[selectedMessageKey]) {
      return;
    }
    void loadMessages(selectedChatId, selectedTopicId);
  }, [loadMessages, messagesByKey, selectedChatId, selectedMessageKey, selectedTopicId]);

  useEffect(() => {
    if (!selectedChatId || selectedMessages.length === 0) {
      return;
    }
    sendReadReceipts(selectedChatId, selectedMessages);
  }, [selectedChatId, selectedMessages, sendReadReceipts]);

  const hydrateChatListMessage = useCallback((chatId: string, createdAt: string) => {
    setChats((current) => {
      const next = current.map((chat) =>
        chat.id === chatId ? { ...chat, updated_at: createdAt } : chat,
      );
      return [...next].sort(
        (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      );
    });
  }, []);

  const updateCallHistoryItem = useCallback((call: CallRecord) => {
    setCallHistoryByChat((current) => {
      const history = current[call.chat_id] ?? [];
      const next = [call, ...history.filter((entry) => entry.id !== call.id)];
      return { ...current, [call.chat_id]: next };
    });
  }, []);

  const handleSocketEvent = useCallback(
    async (event: WebSocketEvent<Record<string, unknown>>) => {
      const payload = event.payload;
      const me = currentUserRef.current;

      switch (event.type) {
        case "message:received": {
          const nextMessage = payload as unknown as UiMessage;
          const rootKey = getMessageKey(nextMessage.chat_id, null);
          const topicKey = nextMessage.topic_id ? getMessageKey(nextMessage.chat_id, nextMessage.topic_id) : null;
          setMessagesByKey((current) => {
            const next = {
              ...current,
              [rootKey]: upsertMessage(current[rootKey] ?? [], { ...nextMessage, isPending: false }),
            };
            if (topicKey) {
              next[topicKey] = upsertMessage(current[topicKey] ?? [], { ...nextMessage, isPending: false });
            }
            return next;
          });
          hydrateChatListMessage(nextMessage.chat_id, nextMessage.created_at);
          if (me && nextMessage.sender_id !== me.id) {
            void fetchUserById(nextMessage.sender_id);
            if (selectedChatIdRef.current === nextMessage.chat_id) {
              sendReadReceipts(nextMessage.chat_id, [nextMessage]);
            }
          }
          return;
        }
        case "message:updated": {
          const { message_id: messageId, content } = payload as { content: string; message_id: string };
          setMessagesByKey((current) => {
            const next = { ...current };
            for (const key of Object.keys(next)) {
              next[key] = next[key].map((message) =>
                message.id === messageId ? { ...message, content, is_edited: true, isPending: false } : message,
              );
            }
            return next;
          });
          return;
        }
        case "message:deleted": {
          const { message_id: messageId } = payload as { message_id: string };
          setMessagesByKey((current) => {
            const next = { ...current };
            for (const key of Object.keys(next)) {
              next[key] = next[key].map((message) =>
                message.id === messageId
                  ? { ...message, content: "Message deleted", is_deleted: true, isPending: false }
                  : message,
              );
            }
            return next;
          });
          return;
        }
        case "typing:indicator": {
          const { chat_id: chatId, is_typing: isTyping, user_id: userId } = payload as {
            chat_id: string;
            is_typing: boolean;
            user_id: string;
          };
          setTypingByChat((current) => {
            const activeIds = current[chatId] ?? [];
            const nextIds = isTyping
              ? Array.from(new Set([...activeIds, userId]))
              : removeTypingUser(activeIds, userId);
            return { ...current, [chatId]: nextIds };
          });
          return;
        }
        case "user:presence": {
          const { user_id: userId, status } = payload as { status: UserStatus; user_id: string };
          setPresenceByUserId((current) => ({ ...current, [userId]: status }));
          return;
        }
        case "notification:new": {
          const notification = payload as unknown as NotificationItem;
          setNotifications((current) => [notification, ...current]);
          return;
        }
        case "chat:unread": {
          const { chat_id: chatId, unread_count: unreadCount } = payload as {
            chat_id: string;
            unread_count: number;
          };
          setChats((current) =>
            current.map((chat) => (chat.id === chatId ? { ...chat, unread_count: unreadCount } : chat)),
          );
          return;
        }
        case "call:incoming": {
          const call = payload as unknown as CallRecord & { sdp_offer: RTCSessionDescriptionInit };
          setIncomingCall({
            callId: call.id,
            callType: call.type,
            chatId: call.chat_id,
            initiatorId: call.initiator_id,
            sdpOffer: call.sdp_offer,
          });
          updateCallHistoryItem(call);
          return;
        }
        case "call:accepted": {
          const call = payload as unknown as CallRecord & { sdp_answer: RTCSessionDescriptionInit };
          updateCallHistoryItem(call);
          setSelectedChatId(call.chat_id);
          setActiveCall({
            callId: call.id,
            callType: call.type,
            chatId: call.chat_id,
            initiatorId: call.initiator_id,
            status: "active",
          });
          if (peerConnectionRef.current && call.sdp_answer) {
            await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(call.sdp_answer));
          }
          sendQueuedIceCandidates(call.id);
          return;
        }
        case "call:rejected": {
          const call = payload as unknown as CallRecord;
          updateCallHistoryItem(call);
          cleanupCall();
          return;
        }
        case "call:ice_candidate": {
          const { candidate } = payload as { candidate: RTCIceCandidateInit };
          if (peerConnectionRef.current) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          }
          return;
        }
        case "call:ended": {
          const call = payload as unknown as CallRecord;
          updateCallHistoryItem(call);
          cleanupCall();
          return;
        }
        case "chat:new": {
          const newChat = payload as unknown as Chat;
          setChats((current) => {
            if (current.some((c) => c.id === newChat.id)) return current;
            return [newChat, ...current];
          });
          return;
        }
        default:
          return;
      }
    },
    [
      cleanupCall,
      fetchUserById,
      hydrateChatListMessage,
      sendQueuedIceCandidates,
      sendReadReceipts,
      updateCallHistoryItem,
    ],
  );

  useEffect(() => {
    if (!accessToken || !currentUser) {
      return;
    }

    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const socket = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(accessToken!)}`);
      socketRef.current = socket;
      console.log("[DEBUG] WebSocket connecting to:", WS_BASE_URL);

      socket.addEventListener("open", () => {
        if (destroyed) { socket.close(); return; }
        console.log("[DEBUG] WebSocket connected");
        socketReconnectAttemptsRef.current = 0;
        setSocketConnected(true);
      });

      socket.addEventListener("close", (ev) => {
        console.log("[DEBUG] WebSocket closed", ev.code, ev.reason);
        setSocketConnected(false);
        if (socketRef.current === socket) socketRef.current = null;
        // Force logout on auth errors (4001) — stale token / user not found
        if (ev.code === 4001) {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          window.location.href = "/login";
          return;
        }
        if (destroyed) return;
        const delay = Math.min(1000 * 2 ** socketReconnectAttemptsRef.current, 30000);
        socketReconnectAttemptsRef.current += 1;
        console.log(`[DEBUG] WebSocket reconnecting in ${delay}ms`);
        socketReconnectTimeoutRef.current = window.setTimeout(connect, delay);
      });

      socket.addEventListener("error", (error) => {
        console.error("[DEBUG] WebSocket error:", error);
        setSocketConnected(false);
      });

      socket.addEventListener("message", (incoming) => {
        const event = JSON.parse(incoming.data) as WebSocketEvent<Record<string, unknown>>;
        void handleSocketEvent(event);
      });
    }

    connect();

    return () => {
      destroyed = true;
      if (socketReconnectTimeoutRef.current) {
        window.clearTimeout(socketReconnectTimeoutRef.current);
        socketReconnectTimeoutRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [accessToken, currentUser, handleSocketEvent]);

  const handleAuthField = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    setAuthForm((current) => ({ ...current, [name]: value }));
  }, []);

  const handleAuthSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthBusy(true);
      setAuthError(null);
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const body =
        authMode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;
      try {
        const response = await apiRequest<AuthResponse>(endpoint, { body, method: "POST" });
        setAccessToken(response.access_token);
        persistAccessToken(response.access_token);
        setCurrentUser(response.user);
        mergeUsers([response.user]);
        setAuthForm({ display_name: "", email: "", password: "", username: "" });
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Authentication failed.");
      } finally {
        setAuthBusy(false);
      }
    },
    [authForm, authMode, mergeUsers],
  );

  const handleLogout = useCallback(async () => {
    try {
      await apiRequest<void>("/auth/logout", { method: "POST" });
    } finally {
      await clearSession();
    }
  }, [clearSession]);

  const handleUserSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const query = userSearchQuery.trim();
      if (!query) {
        setUserSearchResults([]);
        return;
      }
      setUserSearchBusy(true);
      setAppError(null);
      try {
        const users = await authorizedRequest<User[]>(`/users/search?q=${encodeURIComponent(query)}`);
        mergeUsers(users);
        setUserSearchResults(currentUser ? users.filter((user) => user.id !== currentUser.id) : users);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to search users.");
      } finally {
        setUserSearchBusy(false);
      }
    },
    [authorizedRequest, currentUser, mergeUsers, userSearchQuery],
  );

  const createDirectChat = useCallback(
    async (user: User) => {
      setBusyLabel(`Starting a chat with ${user.display_name}...`);
      try {
        const chat = await authorizedRequest<Chat>("/chats/direct", {
          body: { user_id: user.id },
          method: "POST",
        });
        setChats((current) => {
          const next = [chat, ...current.filter((entry) => entry.id !== chat.id)];
          return next.sort(
            (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
          );
        });
        setSelectedChatId(chat.id);
        setUserSearchResults([]);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to create the chat.");
      } finally {
        setBusyLabel(null);
      }
    },
    [authorizedRequest],
  );

  const toggleSelectedGroupMember = useCallback((userId: string) => {
    setSelectedGroupMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }, []);

  const createGroupChat = useCallback(async () => {
    if (!groupForm.name.trim()) {
      setAppError("Enter a group or supergroup name first.");
      return;
    }
    setBusyLabel(`Creating ${groupForm.mode}...`);
    try {
      let avatarUrl = null;
      if (groupAvatarFile) {
        const presigned = await authorizedRequest<UploadPresignResponse>("/uploads/presigned", {
          body: {
            file_name: groupAvatarFile.name,
            file_size: groupAvatarFile.size,
            mime_type: groupAvatarFile.type || "application/octet-stream",
            scope: "avatar",
          },
          method: "POST",
        });
        const uploadResponse = await fetch(presigned.upload_url, {
          body: groupAvatarFile,
          headers: { "Content-Type": groupAvatarFile.type || "application/octet-stream" },
          method: "PUT",
        });
        if (uploadResponse.ok) {
          avatarUrl = presigned.s3_key;
        }
      }
      const endpoint = groupForm.mode === "group" ? "/chats/group" : "/chats/supergroup";
      const payload =
        groupForm.mode === "group"
          ? {
              avatar_url: avatarUrl,
              description: groupForm.description || null,
              member_ids: selectedGroupMemberIds,
              name: groupForm.name.trim(),
            }
          : {
              avatar_url: avatarUrl,
              description: groupForm.description || null,
              name: groupForm.name.trim(),
            };
      const chat = await authorizedRequest<Chat>(endpoint, { body: payload, method: "POST" });
      if (groupForm.mode === "supergroup" && selectedGroupMemberIds.length > 0) {
        await Promise.all(
          selectedGroupMemberIds.map((userId) =>
            authorizedRequest(`/chats/${chat.id}/members`, { body: { user_id: userId }, method: "POST" }),
          ),
        );
      }
      setChats((current) => [chat, ...current.filter((entry) => entry.id !== chat.id)]);
      setSelectedChatId(chat.id);
      setNewChatOpen(false);
      setGroupForm({ description: "", mode: "group", name: "" });
      setSelectedGroupMemberIds([]);
      setGroupAvatarFile(null);
      setGroupAvatarPreviewUrl(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Unable to create the group.");
    } finally {
      setBusyLabel(null);
    }
  }, [authorizedRequest, groupForm, selectedGroupMemberIds, groupAvatarFile]);

  const uploadAttachments = useCallback(
    async (chatId: string, files: File[]) => {
      const attachments: Array<{
        file_name: string;
        file_size: number;
        mime_type: string;
        s3_key: string;
      }> = [];
      for (const file of files) {
        const presigned = await authorizedRequest<UploadPresignResponse>("/uploads/presigned", {
          body: {
            chat_id: chatId,
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || "application/octet-stream",
            scope: "attachment",
          },
          method: "POST",
        });
        const uploadResponse = await fetch(presigned.upload_url, {
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
          method: "PUT",
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }
        attachments.push({
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || "application/octet-stream",
          s3_key: presigned.s3_key,
        });
      }
      return attachments;
    },
    [authorizedRequest],
  );

  const handleFileSelection = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setPendingFiles(Array.from(event.target.files ?? []));
  }, []);

  const stopTyping = useCallback(() => {
    if (!typingActiveRef.current || !selectedChatIdRef.current) {
      return;
    }
    typingActiveRef.current = false;
    try {
      sendSocketEvent({
        type: "typing:stop",
        request_id: `typing-stop-${selectedChatIdRef.current}`,
        payload: { chat_id: selectedChatIdRef.current, topic_id: selectedTopicId },
      });
    } catch {
      return;
    }
  }, [selectedTopicId, sendSocketEvent]);

  const handleComposerChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setComposerText(value);
      if (!selectedChatIdRef.current || !socketConnected) {
        return;
      }
      if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        try {
          sendSocketEvent({
            type: "typing:start",
            request_id: `typing-start-${selectedChatIdRef.current}`,
            payload: { chat_id: selectedChatIdRef.current, topic_id: selectedTopicId },
          });
        } catch {
          return;
        }
      }
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => stopTyping(), TYPING_IDLE_MS);
    },
    [selectedTopicId, sendSocketEvent, socketConnected, stopTyping],
  );

  const handleMessageSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      console.log("[DEBUG] handleMessageSubmit called", { 
        socketConnected, 
        selectedChat: selectedChat?.id, 
        currentUser: currentUser?.id,
        composerTextLength: composerText.length,
        pendingFilesCount: pendingFiles.length
      });
      if (!selectedChat || !currentUser) {
        console.log("[DEBUG] No selected chat or current user");
        return;
      }
      const trimmed = composerText.trim();
      if (!trimmed && pendingFiles.length === 0) {
        console.log("[DEBUG] No text or files to send");
        return;
      }
      if (!socketConnected) {
        console.log("[DEBUG] Socket not connected, cannot send message");
        return;
      }
      setSendingMessage(true);
      try {
        const attachments = await uploadAttachments(selectedChat.id, pendingFiles);
        const tempId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        const optimisticMessage: UiMessage = {
          attachments: attachments.map((attachment) => ({
            ...attachment,
            created_at: createdAt,
            id: `${tempId}-${attachment.s3_key}`,
            message_id: tempId,
            thumbnail_s3_key: null,
          })),
          chat_id: selectedChat.id,
          content: trimmed || null,
          created_at: createdAt,
          id: tempId,
          is_deleted: false,
          is_edited: false,
          isPending: true,
          reply_to_id: null,
          sender_id: currentUser.id,
          temp_id: tempId,
          topic_id: selectedTopicId,
          type: inferMessageType(pendingFiles),
          updated_at: createdAt,
        };
        setMessagesByKey((current) => {
          const rootKey = getMessageKey(selectedChat.id, null);
          const topicKey = getMessageKey(selectedChat.id, selectedTopicId);
          const next = {
            ...current,
            [rootKey]: upsertMessage(current[rootKey] ?? [], optimisticMessage),
          };
          next[topicKey] = upsertMessage(current[topicKey] ?? [], optimisticMessage);
          return next;
        });
        hydrateChatListMessage(selectedChat.id, createdAt);
        sendSocketEvent({
          type: "message:send",
          request_id: tempId,
          payload: {
            attachments,
            chat_id: selectedChat.id,
            content: trimmed || null,
            temp_id: tempId,
            topic_id: selectedTopicId,
            type: inferMessageType(pendingFiles),
          },
        });
        setComposerText("");
        setPendingFiles([]);
        stopTyping();
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to send the message.");
      } finally {
        setSendingMessage(false);
      }
    },
    [
      composerText,
      currentUser,
      hydrateChatListMessage,
      pendingFiles,
      selectedChat,
      selectedTopicId,
      sendSocketEvent,
      socketConnected,
      stopTyping,
      uploadAttachments,
    ],
  );

  const handleMessageSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedChatId) {
        return;
      }
      const query = chatSearchQuery.trim();
      if (!query) {
        setChatSearchResults([]);
        return;
      }
      setMessageSearchBusy(true);
      try {
        const suffix = selectedTopicId ? `&topic_id=${encodeURIComponent(selectedTopicId)}` : "";
        const results = await authorizedRequest<Message[]>(
          `/chats/${selectedChatId}/messages/search?q=${encodeURIComponent(query)}${suffix}`,
        );
        const normalized = sortMessages(results.map((message) => ({ ...message })));
        setChatSearchResults(normalized);
        await syncUserReferences(results);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to search messages.");
      } finally {
        setMessageSearchBusy(false);
      }
    },
    [authorizedRequest, chatSearchQuery, selectedChatId, selectedTopicId, syncUserReferences],
  );

  const downloadAttachment = useCallback(
    async (attachment: Attachment) => {
      try {
        const download = await authorizedRequest<DownloadPresignResponse>(
          `/uploads/download/${attachment.s3_key}`,
        );
        window.open(download.download_url, "_blank", "noopener,noreferrer");
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to open the attachment.");
      }
    },
    [authorizedRequest],
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      try {
        const updated = await authorizedRequest<NotificationItem>(`/notifications/${notificationId}`, {
          method: "PATCH",
        });
        setNotifications((current) =>
          current.map((notification) =>
            notification.id === updated.id ? { ...notification, is_read: updated.is_read } : notification,
          ),
        );
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to mark notification read.");
      }
    },
    [authorizedRequest],
  );

  const markAllNotificationsRead = useCallback(async () => {
    try {
      await authorizedRequest<void>("/notifications/read-all", { method: "POST" });
      setNotifications((current) => current.map((notification) => ({ ...notification, is_read: true })));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Unable to mark all notifications read.");
    }
  }, [authorizedRequest]);

  const selectTopic = useCallback(
    (topicId: string | null) => {
      if (!selectedChatId) {
        return;
      }
      setSelectedTopicIdByChat((current) => ({ ...current, [selectedChatId]: topicId }));
      const key = getMessageKey(selectedChatId, topicId);
      if (!messagesByKey[key]) {
        void loadMessages(selectedChatId, topicId);
      }
    },
    [loadMessages, messagesByKey, selectedChatId],
  );

  const createTopic = useCallback(async () => {
    if (!selectedChat || !newTopicName.trim()) {
      return;
    }
    try {
      const topic = await authorizedRequest<Topic>(`/chats/${selectedChat.id}/topics`, {
        body: { description: newTopicDescription || null, name: newTopicName.trim() },
        method: "POST",
      });
      setTopicsByChat((current) => ({
        ...current,
        [selectedChat.id]: [...(current[selectedChat.id] ?? []), topic],
      }));
      setNewTopicName("");
      setNewTopicDescription("");
      setSelectedTopicIdByChat((current) => ({ ...current, [selectedChat.id]: topic.id }));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Unable to create topic.");
    }
  }, [authorizedRequest, newTopicDescription, newTopicName, selectedChat]);

  const archiveTopic = useCallback(
    async (topicId: string) => {
      if (!selectedChat) {
        return;
      }
      try {
        const topic = await authorizedRequest<Topic>(`/chats/${selectedChat.id}/topics/${topicId}`, {
          method: "DELETE",
        });
        setTopicsByChat((current) => ({
          ...current,
          [selectedChat.id]: (current[selectedChat.id] ?? []).map((entry) =>
            entry.id === topic.id ? topic : entry,
          ),
        }));
        if (selectedTopicId === topic.id) {
          setSelectedTopicIdByChat((current) => ({ ...current, [selectedChat.id]: null }));
        }
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to archive topic.");
      }
    },
    [authorizedRequest, selectedChat, selectedTopicId],
  );

  const uploadAvatarIfNeeded = useCallback(async () => {
    console.log("[DEBUG] uploadAvatarIfNeeded called", { 
      hasFile: !!profileAvatarFile,
      fileName: profileAvatarFile?.name,
      fileSize: profileAvatarFile?.size,
      currentAvatarUrl: profileForm.avatar_url
    });
    if (!profileAvatarFile) {
      return profileForm.avatar_url || null;
    }
    console.log("[DEBUG] Requesting presigned URL for avatar upload");
    const presigned = await authorizedRequest<UploadPresignResponse>("/uploads/presigned", {
      body: {
        file_name: profileAvatarFile.name,
        file_size: profileAvatarFile.size,
        mime_type: profileAvatarFile.type || "application/octet-stream",
        scope: "avatar",
      },
      method: "POST",
    });
    console.log("[DEBUG] Got presigned URL, uploading file");
    const uploadResponse = await fetch(presigned.upload_url, {
      body: profileAvatarFile,
      headers: { "Content-Type": profileAvatarFile.type || "application/octet-stream" },
      method: "PUT",
    });
    if (!uploadResponse.ok) {
      console.error("[DEBUG] Avatar upload failed", uploadResponse.status, uploadResponse.statusText);
      throw new Error("Unable to upload the avatar.");
    }
    console.log("[DEBUG] Avatar uploaded successfully, S3 key:", presigned.s3_key);
    return presigned.s3_key;
  }, [authorizedRequest, profileAvatarFile, profileForm.avatar_url]);

  const handleProfileSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!currentUser) {
        return;
      }
      setSavingProfile(true);
      try {
        const avatarUrl = await uploadAvatarIfNeeded();
        const user = await authorizedRequest<User>("/users/me", {
          body: {
            avatar_url: avatarUrl,
            bio: profileForm.bio || null,
            custom_status: profileForm.custom_status || null,
            display_name: profileForm.display_name,
            status: profileForm.status,
          },
          method: "PATCH",
        });
        setCurrentUser(user);
        mergeUsers([user]);
        setProfileAvatarFile(null);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to save the profile.");
      } finally {
        setSavingProfile(false);
      }
    },
    [authorizedRequest, currentUser, mergeUsers, profileForm, uploadAvatarIfNeeded],
  );

  const handleGroupSave = useCallback(
    async (chatId: string) => {
      setGroupEditBusy(true);
      try {
        const updated = await authorizedRequest<Chat>(`/chats/${chatId}`, {
          method: "PATCH",
          body: { name: groupEditName, description: groupEditDesc },
        });
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, ...updated } : c)));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to update group.");
      } finally {
        setGroupEditBusy(false);
      }
    },
    [authorizedRequest, groupEditDesc, groupEditName],
  );

  const handleGroupAvatarUpload = useCallback(
    async (chatId: string, file: File) => {
      try {
        const presigned = await authorizedRequest<UploadPresignResponse>("/uploads/presigned", {
          body: { file_name: file.name, file_size: file.size, mime_type: file.type || "application/octet-stream", scope: "avatar" },
          method: "POST",
        });
        const uploadResponse = await fetch(presigned.upload_url, {
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
          method: "PUT",
        });
        if (!uploadResponse.ok) throw new Error("Upload failed");
        const updated = await authorizedRequest<Chat>(`/chats/${chatId}`, {
          method: "PATCH",
          body: { avatar_url: presigned.s3_key },
        });
        setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, ...updated } : c)));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to upload avatar.");
      }
    },
    [authorizedRequest],
  );

  const handleGroupAddMember = useCallback(
    async (chatId: string, userId: string) => {
      try {
        await authorizedRequest(`/chats/${chatId}/members`, {
          method: "POST",
          body: { user_id: userId },
        });
        await fetchGroupMembers(chatId);
        setGroupAddUserQuery("");
        setGroupAddUserResults([]);
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to add member.");
      }
    },
    [authorizedRequest, fetchGroupMembers],
  );

  const handleGroupRemoveMember = useCallback(
    async (chatId: string, userId: string) => {
      try {
        await authorizedRequest(`/chats/${chatId}/members/${userId}`, { method: "DELETE" });
        setGroupMembers((prev) => prev.filter((m) => m.user_id !== userId));
      } catch (error) {
        setAppError(error instanceof Error ? error.message : "Unable to remove member.");
      }
    },
    [authorizedRequest],
  );

  const handleGroupAddUserSearch = useCallback(
    async (query: string) => {
      setGroupAddUserQuery(query);
      if (!query.trim()) {
        setGroupAddUserResults([]);
        return;
      }
      try {
        const users = await authorizedRequest<User[]>(`/users/search?q=${encodeURIComponent(query.trim())}`);
        mergeUsers(users);
        setGroupAddUserResults(currentUser ? users.filter((u) => u.id !== currentUser.id) : users);
      } catch {
        setGroupAddUserResults([]);
      }
    },
    [authorizedRequest, currentUser, mergeUsers],
  );

  const startCall = useCallback(
    async (callType: CallKind) => {
      if (!selectedChat || !currentUser) {
        return;
      }
      setCallError(null);
      setIsCalling(true);
      try {
        cleanupCall();
        const connection = createPeerConnection();
        await prepareLocalMedia(callType, connection);
        const offer = await connection.createOffer();
        await connection.setLocalDescription(offer);
        setActiveCall({
          callId: null,
          callType,
          chatId: selectedChat.id,
          initiatorId: currentUser.id,
          status: "ringing",
        });
        sendSocketEvent({
          type: "call:invite",
          request_id: `call-invite-${crypto.randomUUID()}`,
          payload: {
            call_type: callType,
            chat_id: selectedChat.id,
            sdp_offer: connection.localDescription?.toJSON(),
          },
        });
      } catch (error) {
        cleanupCall();
        setCallError(error instanceof Error ? error.message : "Unable to start the call.");
      } finally {
        setIsCalling(false);
      }
    },
    [cleanupCall, createPeerConnection, currentUser, prepareLocalMedia, selectedChat, sendSocketEvent],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) {
      return;
    }
    setCallError(null);
    setIsCalling(true);
    try {
      const connection = createPeerConnection();
      await prepareLocalMedia(incomingCall.callType, connection);
      await connection.setRemoteDescription(new RTCSessionDescription(incomingCall.sdpOffer));
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      setActiveCall({
        callId: incomingCall.callId,
        callType: incomingCall.callType,
        chatId: incomingCall.chatId,
        initiatorId: incomingCall.initiatorId,
        status: "active",
      });
      sendSocketEvent({
        type: "call:accept",
        request_id: `call-accept-${incomingCall.callId}`,
        payload: {
          call_id: incomingCall.callId,
          sdp_answer: connection.localDescription?.toJSON(),
        },
      });
      sendQueuedIceCandidates(incomingCall.callId);
      setSelectedChatId(incomingCall.chatId);
      setIncomingCall(null);
    } catch (error) {
      cleanupCall();
      setCallError(error instanceof Error ? error.message : "Unable to accept the call.");
    } finally {
      setIsCalling(false);
    }
  }, [cleanupCall, createPeerConnection, incomingCall, prepareLocalMedia, sendQueuedIceCandidates, sendSocketEvent]);

  const rejectIncomingCall = useCallback(() => {
    if (!incomingCall) {
      return;
    }
    try {
      sendSocketEvent({
        type: "call:reject",
        request_id: `call-reject-${incomingCall.callId}`,
        payload: { call_id: incomingCall.callId },
      });
      setIncomingCall(null);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Unable to reject the call.");
    }
  }, [incomingCall, sendSocketEvent]);

  const endCurrentCall = useCallback(() => {
    if (!activeCall?.callId) {
      cleanupCall();
      return;
    }
    try {
      sendSocketEvent({
        type: "call:end",
        request_id: `call-end-${activeCall.callId}`,
        payload: { call_id: activeCall.callId },
      });
    } catch (error) {
      cleanupCall();
      setCallError(error instanceof Error ? error.message : "Unable to end the call.");
    }
  }, [activeCall?.callId, cleanupCall, sendSocketEvent]);

  const selectedChatTitle = selectedChat?.display_name ?? selectedChat?.name ?? "Direct chat";
  const selectedChatAvatar = selectedChat?.display_avatar_url ?? selectedChat?.avatar_url;
  const selectedChatPeerStatus =
    selectedChat?.type === "direct"
      ? presenceByUserId[selectedChat.peer_id ?? ""] ?? selectedChat.peer_status
      : null;
  const unreadNotifications = notifications.filter((notification) => !notification.is_read);
  const filteredChats = chats.filter((chat) =>
    (chat.display_name ?? chat.name ?? "Direct chat")
      .toLowerCase()
      .includes(userSearchQuery.trim().toLowerCase()),
  );

  if (bootstrapping) {
    return (
      <div className="auth-screen">
        <div className="auth-orb auth-orb-primary" />
        <div className="auth-orb auth-orb-secondary" />
        <div className="auth-orb auth-orb-tertiary" />
        <div className="panel glass-panel auth-card stack animate-scale-in">
          <div className="auth-copy">
            <span className="auth-kicker">Initializing workspace</span>
            <h1 className="auth-title">NexTalk</h1>
            <p className="auth-subtitle">Restoring your session and connecting to the backend.</p>
          </div>
          <div className="inline-status">
            <span className="pill online">Realtime</span>
            <span className="muted">Bootstrapping your conversations…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-screen">
        <div className="auth-orb auth-orb-primary" />
        <div className="auth-orb auth-orb-secondary" />
        <div className="auth-orb auth-orb-tertiary" />
        <form className="panel glass-panel auth-card stack animate-scale-in" onSubmit={handleAuthSubmit}>
          <div className="auth-copy">
            <span className="auth-kicker">{authMode === "login" ? "Welcome back" : "Create your account"}</span>
            <h1 className="auth-title">NexTalk</h1>
            <p className="auth-subtitle">
              A realtime chat space wrapped in deep glass panels, presence, calls, and live conversations.
            </p>
          </div>
          <div className="auth-tabs">
            <button
              className={`auth-tab ${authMode === "login" ? "active" : ""}`}
              onClick={() => setAuthMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={`auth-tab ${authMode === "register" ? "active" : ""}`}
              onClick={() => setAuthMode("register")}
              type="button"
            >
              Register
            </button>
          </div>
          {authError ? <div className="inline-error">{authError}</div> : null}
          {authMode === "register" ? (
            <>
              <div className="field-group">
                <label htmlFor="display_name">Display name</label>
                <input
                  className="text-input"
                  id="display_name"
                  name="display_name"
                  onChange={handleAuthField}
                  required
                  value={authForm.display_name}
                />
              </div>
              <div className="field-group">
                <label htmlFor="username">Username</label>
                <input
                  className="text-input"
                  id="username"
                  name="username"
                  onChange={handleAuthField}
                  required
                  value={authForm.username}
                />
              </div>
            </>
          ) : null}
          <div className="field-group">
            <label htmlFor="email">Email</label>
            <input
              className="text-input"
              id="email"
              name="email"
              onChange={handleAuthField}
              required
              type="email"
              value={authForm.email}
            />
          </div>
          <div className="field-group">
            <label htmlFor="password">Password</label>
            <input
              className="text-input"
              id="password"
              name="password"
              onChange={handleAuthField}
              required
              type="password"
              value={authForm.password}
            />
          </div>
          <button className="primary-button w-full" disabled={authBusy} type="submit">
            {authBusy ? "Working…" : authMode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {incomingCall ? (
        <div className="call-overlay">
          <div className="panel call-modal glass-panel stack animate-scale-in">
            <h3>Incoming {incomingCall.callType} call</h3>
            <p className="muted">
              {userDirectory[incomingCall.initiatorId]?.display_name ??
                userDirectory[incomingCall.initiatorId]?.username ??
                "Someone"}{" "}
              is calling in this direct chat.
            </p>
            <div className="row wrap">
              <button className="primary-button" disabled={isCalling} onClick={() => void acceptIncomingCall()} type="button">
                {isCalling ? "Connecting..." : "Accept"}
              </button>
              <button className="ghost-button" onClick={rejectIncomingCall} type="button">
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isNotificationsOpen ? (
        <div className="sheet-overlay" onClick={() => setNotificationsOpen(false)} role="presentation">
          <aside
            aria-label="Notifications drawer"
            className="panel notifications-drawer glass-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div className="brand">
                <h3>Notifications</h3>
                <span className="muted">{unreadNotifications.length} unread</span>
              </div>
              <div className="row wrap">
                <button
                  className="ghost-button"
                  disabled={unreadNotifications.length === 0}
                  onClick={() => void markAllNotificationsRead()}
                  type="button"
                >
                  Mark all read
                </button>
                <button className="ghost-button" onClick={() => setNotificationsOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>
            <div className="panel-body stack">
              <div className="row wrap">
                <span className={`pill ${socketConnected ? "online" : ""}`}>
                  Backend: {API_BASE_URL.replace("/api/v1", "")}
                </span>
                <span className="pill">{notifications.length} total</span>
              </div>
              {notifications.length === 0 ? (
                <div className="empty-state drawer-empty">No notifications yet.</div>
              ) : (
                <ul className="notification-list">
                  {notifications.map((notification) => (
                    <li className={`notification-card ${notification.is_read ? "" : "unread"}`} key={notification.id}>
                      <div className="notification-card-inner">
                        <div className="notification-meta">
                          <strong>{formatNotificationTitle(notification.type)}</strong>
                          <span className="muted">{formatDateLabel(notification.created_at)}</span>
                        </div>
                        <div className="helper-text">{getNotificationPreview(notification)}</div>
                        <div className="row wrap" style={{ marginTop: "12px" }}>
                          {notification.payload.chat_id ? (
                            <button
                              className="secondary-button"
                              onClick={() => {
                                setSelectedChatId(notification.payload.chat_id);
                                setNotificationsOpen(false);
                              }}
                              type="button"
                            >
                              Open chat
                            </button>
                          ) : null}
                          {!notification.is_read ? (
                            <button
                              className="ghost-button"
                              onClick={() => void markNotificationRead(notification.id)}
                              type="button"
                            >
                              Mark read
                            </button>
                          ) : (
                            <span className="helper-text">Read</span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {/* Profile Modal */}
      {isProfileOpen ? (
        <div className="sheet-overlay" onClick={() => setProfileOpen(false)}>
          <aside
            className="panel notifications-drawer glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px" }}
          >
            <div className="panel-header">
              <div className="brand">
                <h2>Profile Settings</h2>
                <span className="muted">@{currentUser.username}</span>
              </div>
              <button className="ghost-button" onClick={() => setProfileOpen(false)} type="button">
                Close
              </button>
            </div>
            <div className="panel-body stack">
              <form className="stack" onSubmit={handleProfileSubmit}>
                {profileAvatarPreviewUrl ?? currentUser?.display_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Profile avatar"
                    className="avatar-preview"
                    src={profileAvatarPreviewUrl ?? currentUser?.display_avatar_url ?? ""}
                  />
                ) : null}
                <div className="field-group">
                  <label htmlFor="profile_display_name">Display Name</label>
                  <input
                    className="text-input"
                    id="profile_display_name"
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, display_name: event.target.value }))
                    }
                    placeholder="Display name"
                    value={profileForm.display_name}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="profile_bio">Bio</label>
                  <textarea
                    className="text-area"
                    id="profile_bio"
                    onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                    placeholder="Bio"
                    value={profileForm.bio}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="profile_custom_status">Custom Status</label>
                  <input
                    className="text-input"
                    id="profile_custom_status"
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, custom_status: event.target.value }))
                    }
                    placeholder="Custom status"
                    value={profileForm.custom_status}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="profile_status">Status</label>
                  <select
                    className="text-input"
                    id="profile_status"
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, status: event.target.value as UserStatus }))
                    }
                    value={profileForm.status}
                  >
                    <option value="online">online</option>
                    <option value="away">away</option>
                    <option value="do_not_disturb">do_not_disturb</option>
                    <option value="offline">offline</option>
                  </select>
                </div>
                <div className="field-group">
                  <label htmlFor="profile_avatar">Avatar</label>
                  <input id="profile_avatar" onChange={(event) => setProfileAvatarFile(event.target.files?.[0] ?? null)} type="file" />
                </div>
                <div className="row wrap">
                  <button className="primary-button" disabled={savingProfile} type="submit">
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </button>
                  <button className="ghost-button" onClick={() => void handleLogout()} type="button">
                    Logout
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      ) : null}

      {/* New Chat Modal */}
      {isNewChatOpen ? (
        <div className="sheet-overlay" onClick={() => setNewChatOpen(false)}>
          <aside
            className="panel notifications-drawer glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px" }}
          >
            <div className="panel-header">
              <div className="brand">
                <h2>New Chat</h2>
                <span className="muted">Start a conversation or create a group</span>
              </div>
              <button className="ghost-button" onClick={() => setNewChatOpen(false)} type="button">
                Close
              </button>
            </div>
            <div className="panel-body stack">
              <form onSubmit={handleUserSearch}>
                <div className="field-group">
                  <label htmlFor="user_search">Search Users</label>
                  <input
                    className="text-input"
                    id="user_search"
                    onChange={(event) => setUserSearchQuery(event.target.value)}
                    placeholder="Search for users..."
                    value={userSearchQuery}
                  />
                </div>
                <button className="secondary-button" disabled={userSearchBusy} type="submit">
                  {userSearchBusy ? "Searching…" : "Search"}
                </button>
              </form>

              {userSearchResults.length > 0 ? (
                <div className="stack" style={{ marginTop: "20px" }}>
                  <h3 style={{ margin: 0 }}>Search Results</h3>
                  <ul className="notification-list">
                    {userSearchResults.map((user) => {
                      const isSelected = selectedGroupMemberIds.includes(user.id);
                      return (
                        <li className="notification-card" key={user.id}>
                          <div className="notification-card-inner">
                            <div className="chat-title-row">
                              <div>
                                <strong>{user.display_name}</strong>
                                <div className="helper-text">@{user.username}</div>
                              </div>
                              <span className={getPresenceClass(user.status)} />
                            </div>
                            <div className="row wrap" style={{ marginTop: "12px" }}>
                              <button className="primary-button" onClick={() => void createDirectChat(user)} type="button">
                                Start Chat
                              </button>
                              <button
                                className={isSelected ? "secondary-button" : "ghost-button"}
                                onClick={() => toggleSelectedGroupMember(user.id)}
                                type="button"
                              >
                                {isSelected ? "✓ Selected" : "Select for Group"}
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <div className="divider" />

              <div className="stack">
                <h3 style={{ margin: 0 }}>Create Group</h3>
                <div className="auth-tabs">
                  <button
                    className={`auth-tab ${groupForm.mode === "group" ? "active" : ""}`}
                    onClick={() => setGroupForm((current) => ({ ...current, mode: "group" }))}
                    type="button"
                  >
                    Group
                  </button>
                  <button
                    className={`auth-tab ${groupForm.mode === "supergroup" ? "active" : ""}`}
                    onClick={() => setGroupForm((current) => ({ ...current, mode: "supergroup" }))}
                    type="button">
                    Supergroup
                  </button>
                </div>
                {groupAvatarPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Group avatar" className="avatar-preview" src={groupAvatarPreviewUrl} />
                ) : null}
                <div className="field-group">
                  <label htmlFor="group_avatar">Group Avatar</label>
                  <input id="group_avatar" onChange={(event) => setGroupAvatarFile(event.target.files?.[0] ?? null)} type="file" accept="image/*" />
                </div>
                <input
                  className="text-input"
                  onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={groupForm.mode === "group" ? "Group name" : "Supergroup name"}
                  value={groupForm.name}
                />
                <textarea
                  className="text-area"
                  onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Description"
                  value={groupForm.description}
                />
                {selectedGroupMemberIds.length > 0 ? (
                  <div className="helper-text">
                    Selected members:{" "}
                    {selectedGroupMemberIds
                      .map((userId) => userDirectory[userId]?.display_name ?? userDirectory[userId]?.username ?? userId)
                      .join(", ")}
                  </div>
                ) : null}
                <button className="primary-button" disabled={!!busyLabel} onClick={() => void createGroupChat()} type="button">
                  {busyLabel && busyLabel.startsWith("Creating") ? busyLabel : `Create ${groupForm.mode}`}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <main className="app-shell">
        {/* LEFT SIDEBAR - Channels & Direct Messages */}
        <aside className="panel vino-sidebar glass-panel">
          <div className="vino-brand">
            <div className="brand">
              <span className="brand-kicker">Realtime messenger</span>
              <div className="brand-title-row">
                <div className="brand-mark">N</div>
                <div className="brand-copy">
                  <h1 className="brand-title-gradient">NexTalk</h1>
                  <span className="muted">Deep space conversations</span>
                </div>
              </div>
            </div>
          </div>

          {/* Channels Section */}
          <div className="vino-section">
            <div className="vino-section-header">
              <span>Channels</span>
            </div>
            <ul className="vino-channel-list">
              {filteredChats
                .filter((chat) => chat.type !== "direct")
                .map((chat) => {
                  const title = chat.display_name ?? chat.name ?? "Channel";
                  return (
                    <li className={selectedChatId === chat.id ? "active" : ""} key={chat.id}>
                      <button onClick={() => setSelectedChatId(chat.id)} type="button">
                        <span className="channel-hash">#</span>
                        <span className="channel-name">{title}</span>
                        {chat.unread_count > 0 ? <span className="unread-badge">{chat.unread_count}</span> : null}
                      </button>
                    </li>
                  );
                })}
              <li>
                <button onClick={() => setNewChatOpen(true)} type="button">
                  <span className="channel-hash">+</span>
                  <span className="channel-name">Add channel</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Direct Messages Section */}
          <div className="vino-section">
            <div className="vino-section-header">
              <span>Direct messages</span>
            </div>
            <ul className="vino-dm-list">
              {filteredChats
                .filter((chat) => chat.type === "direct")
                .map((chat) => {
                  const title = chat.display_name ?? chat.peer_username ?? "Unknown";
                  const status =
                    chat.type === "direct" ? presenceByUserId[chat.peer_id ?? ""] ?? chat.peer_status : null;
                  return (
                    <li className={selectedChatId === chat.id ? "active" : ""} key={chat.id}>
                      <button onClick={() => setSelectedChatId(chat.id)} type="button">
                        <Avatar label={title} size="sm" src={chat.display_avatar_url ?? chat.avatar_url} />
                        <span className="dm-name">{title}</span>
                        {status ? <span className={getPresenceClass(status)} /> : null}
                        {chat.unread_count > 0 ? <span className="unread-badge">{chat.unread_count}</span> : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          {/* Bottom Actions */}
          <div className="vino-sidebar-footer">
            <button className="vino-footer-button" onClick={() => setProfileOpen(true)} type="button">
              <Avatar label={currentUser.display_name} size="sm" src={profileAvatarPreviewUrl ?? currentUser.display_avatar_url} />
              <div className="footer-user-info">
                <span className="footer-username">{currentUser.display_name}</span>
                <div className="footer-status-row">
                  <span className={getPresenceClass(currentUser.status)} />
                  <span className="footer-status">{currentUser.status}</span>
                </div>
              </div>
            </button>
          </div>
        </aside>

        {/* CENTER - Chat Panel */}
        <section className="panel chat-panel glass-panel">
          {selectedChat ? (
            <>
              <div className="panel-header chat-panel-header">
                <button className="chat-header-main" onClick={() => setDetailsOpen(!isDetailsOpen)} type="button" title="Chat info">
                  <Avatar label={selectedChatTitle} size="sm" src={selectedChatAvatar} />
                  <div className="brand">
                    <div className="chat-title-row">
                      <h2>{selectedChatTitle}</h2>
                      {selectedChat.type === "direct" ? <span className={getPresenceClass(selectedChatPeerStatus)} /> : null}
                    </div>
                    <span className="muted">
                      {selectedChat.type === "direct"
                        ? `${selectedChatPeerStatus ?? "offline"} · ${selectedMessages.length} messages`
                        : `${selectedChat.type} · ${selectedMessages.length} messages`}
                    </span>
                  </div>
                </button>
                <div className="header-actions">
                  <button className="icon-button" onClick={() => setNotificationsOpen(true)} type="button" title="Notifications">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    {unreadNotifications.length > 0 ? (
                      <span className="icon-badge">{unreadNotifications.length}</span>
                    ) : null}
                  </button>
                  <button className="icon-button" onClick={() => setDetailsOpen(!isDetailsOpen)} type="button" title="Info">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                  </button>
                  {selectedChat.type === "direct" ? (
                    <>
                      <button className="icon-button" disabled={isCalling} onClick={() => void startCall("audio")} type="button" title="Audio call">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                        </svg>
                      </button>
                      <button className="icon-button" disabled={isCalling} onClick={() => void startCall("video")} type="button" title="Video call">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"></polygon>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                      </button>
                      <button className="icon-button" onClick={() => setNewChatOpen(true)} type="button" title="Convert to group">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <line x1="19" y1="8" x2="19" y2="14"></line>
                          <line x1="22" y1="11" x2="16" y2="11"></line>
                        </svg>
                      </button>
                    </>
                  ) : (
                    <button className="icon-button" onClick={() => setNewChatOpen(true)} type="button" title="Add members">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="8.5" cy="7" r="4"></circle>
                        <line x1="20" y1="8" x2="20" y2="14"></line>
                        <line x1="23" y1="11" x2="17" y2="11"></line>
                      </svg>
                    </button>
                  )}
                  {activeCall && activeCall.chatId === selectedChat.id ? (
                    <button className="ghost-button" onClick={endCurrentCall} type="button">
                      End call
                    </button>
                  ) : null}
                  {/* Message search toggle */}
                  <button
                    className={`icon-button ${isChatSearchOpen ? "text-cyan-400" : ""}`}
                    onClick={() => {
                      setIsChatSearchOpen((v) => !v);
                      if (isChatSearchOpen) {
                        setChatSearchQuery("");
                        setChatSearchResults([]);
                      }
                    }}
                    title="Search messages"
                    type="button"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                  </button>
                </div>
              </div>

              {selectedChat.type === "supergroup" ? (
                <div className="topic-toolbar">
                  <button
                    className={`ghost-button ${selectedTopicId ? "" : "active-pill"}`}
                    onClick={() => selectTopic(null)}
                    type="button"
                  >
                    All messages
                  </button>
                  {selectedTopics
                    .filter((topic) => !topic.is_archived)
                    .map((topic) => (
                      <button
                        className={`ghost-button ${selectedTopicId === topic.id ? "active-pill" : ""}`}
                        key={topic.id}
                        onClick={() => selectTopic(topic.id)}
                        type="button"
                      >
                        {topic.name}
                      </button>
                    ))}
                </div>
              ) : null}

              {activeCall && activeCall.chatId === selectedChat.id ? null : null}

              <div className="messages-scroll">
                {loadingChatKey === selectedMessageKey ? (
                  <div className="empty-state">Loading conversation…</div>
                ) : selectedMessages.length === 0 ? (
                  <div className="empty-state">
                    <div>
                      <strong>No messages yet.</strong>
                      <p className="muted">Send the first message to kick off this chat.</p>
                    </div>
                  </div>
                ) : (
                  selectedMessages.map((message) => {
                    const sender =
                      message.sender_id === currentUser.id
                        ? currentUser
                        : userDirectory[message.sender_id] ??
                          (selectedChat.peer_id === message.sender_id
                            ? {
                                ...currentUser,
                                id: selectedChat.peer_id,
                                display_name: selectedChat.display_name ?? selectedChat.peer_username ?? "Peer",
                                username: selectedChat.peer_username ?? "peer",
                              }
                            : undefined);
                    const isOwnMessage = message.sender_id === currentUser.id;
                    const isGroup = selectedChat.type !== "direct";
                    const isSystem = message.type === "system";
                    return (
                      <div
                        className={`message-row animate-fade-in-up ${isOwnMessage ? "own" : ""} ${isSystem ? "justify-center" : ""}`}
                        key={`${message.id}-${message.temp_id ?? "server"}`}
                      >
                        {/* Show sender avatar for group chats on the left of others' messages */}
                        {!isOwnMessage && isGroup && !isSystem ? (
                          <div className="sender-avatar">
                            <Avatar label={sender?.display_name ?? sender?.username ?? "?"} size="sm" src={sender?.display_avatar_url ?? sender?.avatar_url ?? null} />
                          </div>
                        ) : null}
                        <article
                          className={`message-bubble max-w-[60%] animate-fade-in ${isOwnMessage ? "own" : ""} ${message.isPending ? "pending" : ""} ${isSystem ? "system" : ""}`}
                        >
                          {/* Show sender name in group chats */}
                          {!isOwnMessage && isGroup && !isSystem ? (
                            <div className="message-meta">
                              <strong style={{ color: stringToColor(message.sender_id) }}>
                                {sender?.display_name ?? sender?.username ?? "Unknown"}
                              </strong>
                              <span className="muted">
                                {formatTimestamp(message.created_at)}
                                {message.is_edited ? " · edited" : ""}
                                {message.isPending ? " · sending" : ""}
                              </span>
                            </div>
                          ) : (
                            <div className="message-meta">
                              <span className="muted">
                                {formatTimestamp(message.created_at)}
                                {message.topic_id ? " · topic" : ""}
                                {message.is_edited ? " · edited" : ""}
                                {message.isPending ? " · sending" : ""}
                              </span>
                            </div>
                          )}
                          {message.content ? <div className="message-content">{message.content}</div> : null}
                          {message.attachments.length > 0 ? (
                            <ul className="attachment-list">
                              {message.attachments.map((attachment) => {
                                const isImage = attachment.mime_type.startsWith("image/");
                                const isAudio = attachment.mime_type.startsWith("audio/");
                                return (
                                  <li className="attachment-card" key={attachment.id}>
                                    {isImage && attachment.display_url ? (
                                      <div className="attachment-image-wrapper">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          alt={attachment.file_name}
                                          className="attachment-image-preview"
                                          src={attachment.display_url}
                                        />
                                        <div className="attachment-image-caption">
                                          <span>{attachment.file_name}</span>
                                          <button
                                            className="ghost-button"
                                            onClick={() => void downloadAttachment(attachment)}
                                            style={{ fontSize: "11px", padding: "2px 8px", flexShrink: 0 }}
                                            type="button"
                                          >↓</button>
                                        </div>
                                      </div>
                                    ) : isAudio && attachment.display_url ? (
                                      <div style={{ padding: "10px 12px" }}>
                                        <div style={{ fontSize: "12px", marginBottom: "6px", opacity: 0.7 }}>{attachment.file_name}</div>
                                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                        <audio className="attachment-audio-player" controls src={attachment.display_url} />
                                      </div>
                                    ) : (
                                      <div style={{ padding: "10px 12px" }}>
                                        <div className="attachment-meta">
                                          <div style={{ minWidth: 0 }}>
                                            <strong style={{ fontSize: "13px", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.file_name}</strong>
                                            <div className="muted" style={{ fontSize: "11px" }}>
                                              {attachment.mime_type} · {formatFileSize(attachment.file_size)}
                                            </div>
                                          </div>
                                          <button
                                            className="ghost-button"
                                            onClick={() => void downloadAttachment(attachment)}
                                            style={{ fontSize: "12px", padding: "4px 10px", flexShrink: 0 }}
                                            type="button"
                                          >
                                            ↓
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </article>
                      </div>
                    );
                  })
                )}
              </div>

              {isChatSearchOpen ? (
              <div className="search-panel-container">
                <form onSubmit={handleMessageSearch} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <input
                    autoFocus
                    className="text-input"
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                    placeholder="Search messages in this chat…"
                    style={{ flex: 1 }}
                    value={chatSearchQuery}
                  />
                  <button className="secondary-button" disabled={messageSearchBusy} type="submit" style={{ padding: "6px 12px" }}>
                    {messageSearchBusy ? "…" : "Go"}
                  </button>
                  {chatSearchResults.length > 0 ? (
                    <button
                      className="ghost-button"
                      onClick={() => { setChatSearchQuery(""); setChatSearchResults([]); }}
                      type="button"
                      style={{ padding: "6px 12px" }}
                    >
                      ✕
                    </button>
                  ) : null}
                </form>
                {chatSearchResults.length > 0 ? (
                  <ul className="search-results" style={{ maxHeight: "160px", overflowY: "auto" }}>
                    {chatSearchResults.map((message) => (
                      <li className="search-card" key={`search-${message.id}`}>
                        <button onClick={() => setSelectedChatId(message.chat_id)} type="button">
                          <div className="chat-title-row">
                            <span className="chat-title">
                              {userDirectory[message.sender_id]?.display_name ??
                                userDirectory[message.sender_id]?.username ??
                                "Unknown"}
                            </span>
                            <span className="muted">{formatDateLabel(message.created_at)}</span>
                          </div>
                          <div className="helper-text">{message.content}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              ) : null}

              {typingByChat[selectedChat.id]?.length ? (
                <div className="typing-indicator">
                  {typingByChat[selectedChat.id]
                    .map((userId) => userDirectory[userId]?.display_name ?? userDirectory[userId]?.username ?? "Someone")
                    .join(", ")}{" "}
                  is typing…
                </div>
              ) : null}

              <form className="composer" onSubmit={handleMessageSubmit}>
                <div className="composer-shell">
                  <textarea
                    className="text-area composer-textarea"
                    onBlur={stopTyping}
                    onChange={handleComposerChange}
                    placeholder="Type a message…"
                    style={{ minHeight: "60px", maxHeight: "150px", resize: "none" }}
                    value={composerText}
                  />
                  <div className="composer-toolbar">
                    {/* Attach files */}
                    <label className="attach-btn" htmlFor="attachments" title="Attach files">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                      </svg>
                    </label>
                    <input hidden id="attachments" multiple onChange={handleFileSelection} type="file" />
                    {/* Emoji picker trigger */}
                    <div className="composer-emoji-shell">
                      <button
                        className="attach-btn"
                        onClick={() => setIsEmojiPickerOpen((v) => !v)}
                        title="Emoji & Stickers"
                        type="button"
                        style={{ fontSize: "18px" }}
                      >
                        😊
                      </button>
                      {isEmojiPickerOpen ? (
                        <div className="emoji-picker-wrapper">
                          <div className="emoji-picker-panel">
                            <div className="emoji-picker-tabs">
                              {EMOJI_CATEGORIES.map((cat, i) => (
                                <button
                                  className={`emoji-tab-btn ${emojiPickerTab === i ? "active" : ""}`}
                                  key={i}
                                  onClick={() => setEmojiPickerTab(i)}
                                  title={cat.label}
                                  type="button"
                                >
                                  {cat.icon}
                                </button>
                              ))}
                              <button
                                className={`emoji-tab-btn ${emojiPickerTab === EMOJI_CATEGORIES.length ? "active" : ""}`}
                                onClick={() => setEmojiPickerTab(EMOJI_CATEGORIES.length)}
                                title="Stickers"
                                type="button"
                              >
                                🎭
                              </button>
                            </div>
                            {emojiPickerTab < EMOJI_CATEGORIES.length ? (
                              <div className="emoji-grid">
                                {EMOJI_CATEGORIES[emojiPickerTab]?.emojis.map((emoji, j) => (
                                  <button
                                    className="emoji-item"
                                    key={j}
                                    onClick={() => {
                                      setComposerText((t) => t + emoji);
                                      setIsEmojiPickerOpen(false);
                                    }}
                                    type="button"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="sticker-panel">
                                <div className="sticker-pack-tabs">
                                  {STICKER_PACKS.map((pack, i) => (
                                    <button
                                      className={`sticker-pack-tab ${stickerPackTab === i ? "active" : ""}`}
                                      key={i}
                                      onClick={() => setStickerPackTab(i)}
                                      title={pack.label}
                                      type="button"
                                    >
                                      {pack.icon}
                                    </button>
                                  ))}
                                </div>
                                <div className="sticker-grid">
                                  {STICKER_PACKS[stickerPackTab]?.stickers.map((sticker, j) => (
                                    <button
                                      className="sticker-item"
                                      key={j}
                                      onClick={() => {
                                        setComposerText((t) => t + sticker + " ");
                                        setIsEmojiPickerOpen(false);
                                      }}
                                      type="button"
                                    >
                                      {sticker}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="composer-spacer" />
                    <button className="primary-button composer-send-button" disabled={!socketConnected || sendingMessage} type="submit">
                      {sendingMessage ? "Sending…" : !socketConnected ? "Connecting…" : "Send"}
                    </button>
                  </div>
                  {pendingFiles.length > 0 ? (
                    <div className="pending-files-bar">
                      {pendingFiles.map((file, index) => (
                        <div className="pending-file-chip" key={index}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                          </svg>
                          <span>{file.name}</span>
                          <button
                            className="pending-file-remove"
                            onClick={() => setPendingFiles(pendingFiles.filter((_, i) => i !== index))}
                            title="Remove"
                            type="button"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <div>
                <strong>No chat selected.</strong>
                <p className="muted">Search for a user or create a group from the left.</p>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT SIDEBAR - Profile Panel (Always visible like Vino) */}
        <aside className="panel vino-profile-panel glass-panel">
          <div className="vino-profile-header">
            <h3>{selectedChat?.type === "direct" ? "Profile" : "Group Info"}</h3>
          </div>
          <div className="vino-profile-body">
            {selectedChat && selectedChat.type === "direct" ? (
              <>
                <div className="vino-profile-avatar-section">
                  <Avatar label={selectedChatTitle} size="lg" src={selectedChatAvatar} />
                  <h2 className="vino-profile-name">{selectedChatTitle}</h2>
                  <div className="vino-profile-status">
                    <span className={getPresenceClass(selectedChatPeerStatus)} />
                    <span className="status-text">{selectedChatPeerStatus ?? "offline"}</span>
                  </div>
                  <div className="vino-profile-local-time">
                    {new Date().toLocaleTimeString()} local time
                  </div>
                </div>

                <div className="vino-profile-actions">
                  <button className="vino-action-button" disabled={isCalling} onClick={() => void startCall("audio")} type="button">
                    📞 Call
                  </button>
                  <button className="vino-action-button" disabled={isCalling} onClick={() => void startCall("video")} type="button">
                    📹 Video
                  </button>
                </div>

                <div className="vino-profile-section">
                  <h4>Contact Information</h4>
                  <div className="vino-profile-info-item">
                    <span className="info-label">Email Address</span>
                    <span className="info-value">{selectedChat.peer_username}@nextalk.com</span>
                  </div>
                </div>

                <div className="vino-profile-section">
                  <h4>About me</h4>
                  <p className="vino-profile-bio">{userDirectory[selectedChat.peer_id ?? ""]?.bio || "No bio available"}</p>
                </div>
              </>
            ) : selectedChat ? (
              <>
                {/* Group Avatar */}
                <div className="vino-profile-avatar-section">
                  <label className="group-avatar-upload-label" title="Change group photo">
                    <Avatar label={selectedChatTitle} size="lg" src={selectedChatAvatar} />
                    <span className="group-avatar-overlay">📷</span>
                    <input
                      accept="image/*"
                      className="hidden-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleGroupAvatarUpload(selectedChat.id, file);
                      }}
                      type="file"
                    />
                  </label>
                  <h2 className="vino-profile-name">{selectedChatTitle}</h2>
                  <div className="vino-profile-status">
                    <span className="status-text">{selectedChat.type} · {groupMembers.length} members</span>
                  </div>
                </div>

                {/* Edit name & description */}
                <div className="vino-profile-section">
                  <h4>Group Settings</h4>
                  <div className="group-edit-field">
                    <label className="group-edit-label">Name</label>
                    <input
                      className="group-edit-input"
                      onChange={(e) => setGroupEditName(e.target.value)}
                      placeholder="Group name"
                      type="text"
                      value={groupEditName}
                    />
                  </div>
                  <div className="group-edit-field">
                    <label className="group-edit-label">Description</label>
                    <textarea
                      className="group-edit-input"
                      onChange={(e) => setGroupEditDesc(e.target.value)}
                      placeholder="Group description"
                      rows={2}
                      value={groupEditDesc}
                    />
                  </div>
                  <button
                    className="vino-action-button"
                    disabled={groupEditBusy}
                    onClick={() => void handleGroupSave(selectedChat.id)}
                    type="button"
                  >
                    {groupEditBusy ? "Saving..." : "Save Changes"}
                  </button>
                </div>

                {/* Members list */}
                <div className="vino-profile-section">
                  <h4>Members</h4>
                  {/* Add member search */}
                  <div className="group-add-member-row">
                    <input
                      className="group-edit-input"
                      onChange={(e) => void handleGroupAddUserSearch(e.target.value)}
                      placeholder="Search users to add..."
                      type="text"
                      value={groupAddUserQuery}
                    />
                  </div>
                  {groupAddUserResults.length > 0 && (
                    <ul className="group-user-search-results">
                      {groupAddUserResults.map((user) => (
                        <li className="group-user-search-item" key={user.id}>
                          <span className="user-search-name">{user.display_name ?? user.username}</span>
                          <button
                            className="group-add-member-btn"
                            onClick={() => void handleGroupAddMember(selectedChat.id, user.id)}
                            type="button"
                          >
                            + Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Current members */}
                  {groupMembersLoading ? (
                    <p className="muted">Loading members...</p>
                  ) : (
                    <ul className="group-members-list">
                      {groupMembers.map((member) => {
                        const memberUser = userDirectory[member.user_id];
                        return (
                          <li className="group-member-item" key={member.user_id}>
                            <Avatar
                              label={memberUser?.display_name ?? memberUser?.username ?? member.user_id}
                              size="sm"
                              src={memberUser?.display_avatar_url ?? memberUser?.avatar_url}
                            />
                            <div className="group-member-info">
                              <span className="group-member-name">
                                {memberUser?.display_name ?? memberUser?.username ?? "Unknown"}
                              </span>
                              <span className="group-member-role muted">{member.role}</span>
                            </div>
                            {member.role !== "owner" && currentUser?.id !== member.user_id && (
                              <button
                                className="group-remove-member-btn"
                                onClick={() => void handleGroupRemoveMember(selectedChat.id, member.user_id)}
                                title="Remove member"
                                type="button"
                              >
                                ✕
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <div className="vino-profile-empty">
                <p>Select a chat to view profile</p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Full-Page Call Interface */}
      {activeCall ? (
        <div className="call-fullscreen-overlay">
          <div className="call-fullscreen-content">
            {activeCall.callType === "video" ? (
              <>
                <video autoPlay className="call-remote-video" playsInline ref={remoteVideoRef} />
                <video autoPlay className="call-local-video" muted playsInline ref={localVideoRef} />
              </>
            ) : (
              <div className="call-audio-container">
                <div className="call-avatar-large">
                  <Avatar
                    label={selectedChat?.display_name ?? selectedChat?.name ?? "Call"}
                    size="lg"
                    src={selectedChat?.display_avatar_url ?? selectedChat?.avatar_url}
                  />
                </div>
                <h2 className="call-participant-name">
                  {selectedChat?.display_name ?? selectedChat?.name ?? "Unknown"}
                </h2>
                <p className="call-status-text">
                  {activeCall.status === "ringing" ? "Calling..." : "Connected"}
                </p>
              </div>
            )}
            
            <div className="call-controls-bar">
              <div className="call-info">
                <span className="call-type-label">
                  {activeCall.callType === "video" ? "Video Call" : "Audio Call"}
                </span>
                <span className="call-duration">
                  {activeCall.status === "ringing" ? "Ringing..." : "Active"}
                </span>
              </div>
              
              <div className="call-action-buttons">
                <button
                  className="call-control-btn"
                  onClick={() => {
                    if (localStream) {
                      const audioTrack = localStream.getAudioTracks()[0];
                      if (audioTrack) {
                        audioTrack.enabled = !audioTrack.enabled;
                      }
                    }
                  }}
                  title="Toggle microphone"
                  type="button"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                </button>
                
                {activeCall.callType === "video" ? (
                  <button
                    className="call-control-btn"
                    onClick={() => {
                      if (localStream) {
                        const videoTrack = localStream.getVideoTracks()[0];
                        if (videoTrack) {
                          videoTrack.enabled = !videoTrack.enabled;
                        }
                      }
                    }}
                    title="Toggle camera"
                    type="button"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="23 7 16 12 23 17 23 7"></polygon>
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    </svg>
                  </button>
                ) : null}
                
                <button
                  className="call-control-btn call-end-btn"
                  onClick={endCurrentCall}
                  title="End call"
                  type="button"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
