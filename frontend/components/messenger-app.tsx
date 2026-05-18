"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bell, Bookmark, Moon, Paperclip, Phone, Search, Send, Settings, Smile, Sun, Users, Video, X } from "lucide-react";

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

const PRIMARY_BUTTON_CLASS = "inline-flex items-center justify-center rounded-xl border border-fire-flame/30 bg-dragon-ash px-4 py-2.5 text-sm font-medium text-fire-flame transition hover:bg-fire-flame/10 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON_CLASS = "inline-flex items-center justify-center rounded-xl border border-glass-border bg-dragon-charcoal px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-dragon-ash disabled:cursor-not-allowed disabled:opacity-50";
const ICON_BUTTON_CLASS = "relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-glass-border bg-dragon-charcoal text-gray-400 transition hover:bg-fire-flame/10 hover:text-fire-flame disabled:cursor-not-allowed disabled:opacity-50";

type AuthMode = "login" | "register";
type CallKind = "audio" | "video";
type ChatTheme = "dark" | "light";
type BubbleStyle = "default" | "dog" | "cat" | "dinosaur" | "giraffe" | "dragon" | "phoenix" | "robot" | "alien";
type FontSize = "small" | "medium" | "large";

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

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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
      return "h-2.5 w-2.5 rounded-full bg-flame-green shadow-[0_0_0_4px_rgba(16,185,129,0.14)]";
    case "away":
      return "h-2.5 w-2.5 rounded-full bg-fire-glow shadow-[0_0_0_4px_rgba(255,165,0,0.14)]";
    case "do_not_disturb":
      return "h-2.5 w-2.5 rounded-full bg-rose-400 shadow-[0_0_0_4px_rgba(251,113,133,0.14)]";
    default:
      return "h-2.5 w-2.5 rounded-full bg-gray-500 shadow-[0_0_0_4px_rgba(100,116,139,0.12)]";
  }
}

function getTabButtonClass(active: boolean) {
  return [
    "rounded-full border px-4 py-2 text-sm font-medium transition",
    active
      ? "border-fire-flame/30 bg-fire-flame/10 text-fire-flame"
      : "border-transparent text-gray-400 hover:bg-dragon-ash hover:text-white",
  ].join(" ");
}

function getSidebarButtonClass(active: boolean) {
  return [
    "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all",
    active
      ? "border-fire-flame/30 bg-fire-flame/10 text-fire-flame"
      : "border-transparent text-gray-200 hover:bg-dragon-ash hover:text-white",
  ].join(" ");
}

function getTopicButtonClass(active: boolean) {
  return [
    "inline-flex items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition",
    active
      ? "border-fire-flame/30 bg-fire-flame/10 text-fire-flame"
      : "border-glass-border bg-dragon-charcoal text-gray-300 hover:bg-dragon-ash",
  ].join(" ");
}

function getMessageRowClass(isOwnMessage: boolean, isSystem: boolean) {
  return [
    "relative flex items-end gap-3 animate-fade-in-up",
    isOwnMessage && !isSystem ? "justify-end" : "",
    isSystem ? "justify-center" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getMessageBubbleClass(isOwnMessage: boolean, isPending: boolean | undefined, isSystem: boolean) {
  return [
    "message-bubble w-fit max-w-[min(85%,48rem)] min-w-0 rounded-[22px] border border-glass-border bg-dragon-charcoal/90 p-4 text-gray-100 shadow-dragon backdrop-blur-xl animate-fade-in",
    isOwnMessage ? "own self-end border-fire-flame/30 bg-gradient-to-br from-fire-flame/18 to-dragon-charcoal/90" : "self-start",
    isPending ? "pending opacity-70" : "",
    isSystem ? "system self-center border-white/5 bg-white/[0.05] text-center text-gray-300" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getReactionBubbleClass(reacted: boolean) {
  return [
    "inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-surface px-2.5 py-1 text-xs text-white transition hover:border-fire-flame/30 hover:bg-glass-hover",
    reacted ? "border-fire-flame/40 bg-fire-flame/15 text-fire-glow" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getPickerTabClass(active: boolean) {
  return [
    "inline-flex h-10 w-10 items-center justify-center rounded-xl border border-glass-border bg-dragon-charcoal text-lg text-gray-300 transition hover:bg-dragon-ash",
    active ? "border-fire-flame/30 bg-fire-flame/10 text-fire-flame" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

interface AvatarProps {
  label: string;
  size?: "sm" | "md" | "lg";
  src?: string | null;
}

function Avatar({ label, size = "md", src }: AvatarProps) {
  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-20 w-20" : "h-10 w-10";
  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-glass-border bg-gradient-to-br from-fire-flame/20 to-flame-green/20 font-semibold text-white shadow-fire ${sizeClass}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={label} className="h-full w-full object-cover" src={src} />
      ) : (
        <span className="text-sm font-semibold text-white">{getInitials(label)}</span>
      )}
    </div>
  );
}

interface AudioPlayerProps {
  fileName: string;
  src: string;
}

function AudioPlayer({ fileName, src }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      void audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    audioRef.current.currentTime = percent * duration;
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-glass-border bg-dragon-charcoal/80 p-3 shadow-dragon">
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        src={src}
      />
      <button className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-fire-flame to-fire-glow text-white transition hover:scale-105" onClick={togglePlay} type="button">
        {isPlaying ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="truncate text-sm font-medium text-white">{fileName}</div>
        <div className="cursor-pointer" onClick={handleSeek} role="progressbar">
          <div className="h-2 overflow-hidden rounded-full bg-dragon-smoke/80">
            <div className="h-full rounded-full bg-gradient-to-r from-fire-flame to-flame-green" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="text-xs text-gray-400">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>
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

const GIF_COLLECTION = [
  { id: "1", url: "https://media.giphy.com/media/3oKIPnAiaMCws8nOsE/giphy.gif", tags: ["cat", "wave"] },
  { id: "2", url: "https://media.giphy.com/media/11sBLVxNs7v6WA/giphy.gif", tags: ["dog", "funny"] },
  { id: "3", url: "https://media.giphy.com/media/QBd2kLB5qDmysEXre9/giphy.gif", tags: ["yes", "approve"] },
  { id: "4", url: "https://media.giphy.com/media/g7GKcSzwQfugw/giphy.gif", tags: ["no", "nope"] },
  { id: "5", url: "https://media.giphy.com/media/26gsjCZpPolPr3sBy/giphy.gif", tags: ["deal with it", "cool"] },
  { id: "6", url: "https://media.giphy.com/media/Lq7xHzmTHb91Q5sSWA/giphy.gif", tags: ["dance", "party"] },
  { id: "7", url: "https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif", tags: ["thumbs up", "approve"] },
  { id: "8", url: "https://media.giphy.com/media/M81p41zNM67vi/giphy.gif", tags: ["fire", "lit"] },
  { id: "9", url: "https://media.giphy.com/media/l0HlUNj5BRuYDLxFm/giphy.gif", tags: ["mind blown", "wow"] },
  { id: "10", url: "https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif", tags: ["clap", "applause"] },
  { id: "11", url: "https://media.giphy.com/media/26gscSULUIlnGWXhC/giphy.gif", tags: ["laugh", "lol"] },
  { id: "12", url: "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif", tags: ["high five", "success"] },
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
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatTheme, setChatTheme] = useState<ChatTheme>("dark");
  const [bubbleStyle, setBubbleStyle] = useState<BubbleStyle>("default");
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [accentColor, setAccentColor] = useState<'fire' | 'green' | 'blue' | 'purple' | 'pink'>('fire');
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
  const [messageReactions, setMessageReactions] = useState<Record<string, Record<string, string[]>>>({});
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
  const [gifSearchQuery, setGifSearchQuery] = useState("");
  const [chatMuteStates, setChatMuteStates] = useState<Record<string, boolean>>({});
  const [archivedChatIds, setArchivedChatIds] = useState<Set<string>>(new Set());
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [wallpaper, setWallpaper] = useState<string>("default");
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
    if (typeof window === "undefined") {
      return;
    }
    const customWallpaper = window.localStorage.getItem("nextalk.wallpaper");
    if (!customWallpaper) {
      return;
    }
    setWallpaper("custom");
    document.documentElement.style.setProperty("--custom-wallpaper-url", `url(${customWallpaper})`);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (wallpaper === "custom") {
      const customWallpaper = window.localStorage.getItem("nextalk.wallpaper");
      if (customWallpaper) {
        document.documentElement.style.setProperty("--custom-wallpaper-url", `url(${customWallpaper})`);
        return;
      }
    }
    document.documentElement.style.removeProperty("--custom-wallpaper-url");
  }, [wallpaper]);

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
    !archivedChatIds.has(chat.id) &&
    (chat.display_name ?? chat.name ?? "Direct chat")
      .toLowerCase()
      .includes(userSearchQuery.trim().toLowerCase()),
  );

  if (bootstrapping) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,107,53,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),transparent_28%),linear-gradient(160deg,#0a0a0a_0%,#151515_45%,#1a1a1a_100%)] px-4 py-10">
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float left-[8%] top-[8%] h-56 w-56 bg-fire-flame/20" />
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float right-[10%] top-[18%] h-72 w-72 bg-fire-glow/10" />
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float bottom-[10%] left-1/3 h-64 w-64 bg-flame-green/12" />
        <div className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-[''] z-10 w-full max-w-[560px] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.55)] flex flex-col gap-3 animate-scale-in">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-fire-glow">Initializing workspace</span>
            <h1 className="bg-gradient-to-r from-fire-flame to-flame-green bg-clip-text text-4xl font-bold tracking-tight text-transparent">NexTalk</h1>
            <p className="text-sm leading-6 text-gray-400">Restoring your session and connecting to the backend.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-glass-border bg-glass-surface px-4 py-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-flame-green/30 bg-flame-green/10 px-3 py-1.5 text-xs font-medium text-flame-green shadow-green">Realtime</span>
            <span className="text-gray-400">Bootstrapping your conversations…</span>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,107,53,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.16),transparent_28%),linear-gradient(160deg,#0a0a0a_0%,#151515_45%,#1a1a1a_100%)] px-4 py-10">
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float left-[8%] top-[8%] h-56 w-56 bg-fire-flame/20" />
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float right-[10%] top-[18%] h-72 w-72 bg-fire-glow/10" />
        <div className="pointer-events-none absolute rounded-full blur-3xl animate-float bottom-[10%] left-1/3 h-64 w-64 bg-flame-green/12" />
        <form className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-[''] z-10 w-full max-w-[560px] p-7 shadow-[0_30px_80px_rgba(0,0,0,0.55)] flex flex-col gap-3 animate-scale-in" onSubmit={handleAuthSubmit}>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.3em] text-fire-glow">{authMode === "login" ? "Welcome back" : "Create your account"}</span>
            <h1 className="bg-gradient-to-r from-fire-flame to-flame-green bg-clip-text text-4xl font-bold tracking-tight text-transparent">NexTalk</h1>
            <p className="text-sm leading-6 text-gray-400">
              A realtime chat space wrapped in deep glass panels, presence, calls, and live conversations.
            </p>
          </div>
          <div className="inline-flex w-fit rounded-full border border-glass-border bg-glass-surface p-1.5 backdrop-blur">
            <button
              className={getTabButtonClass(authMode === "login")}
              onClick={() => setAuthMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={getTabButtonClass(authMode === "register")}
              onClick={() => setAuthMode("register")}
              type="button"
            >
              Register
            </button>
          </div>
          {authError ? <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 shadow-lg backdrop-blur">{authError}</div> : null}
          {authMode === "register" ? (
            <>
              <div className="flex flex-col gap-2">
                <label htmlFor="display_name">Display name</label>
                <input
                  className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                  id="display_name"
                  name="display_name"
                  onChange={handleAuthField}
                  required
                  value={authForm.display_name}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="username">Username</label>
                <input
                  className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                  id="username"
                  name="username"
                  onChange={handleAuthField}
                  required
                  value={authForm.username}
                />
              </div>
            </>
          ) : null}
          <div className="flex flex-col gap-2">
            <label htmlFor="email">Email</label>
            <input
              className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
              id="email"
              name="email"
              onChange={handleAuthField}
              required
              type="email"
              value={authForm.email}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="password">Password</label>
            <input
              className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
              id="password"
              name="password"
              onChange={handleAuthField}
              required
              type="password"
              value={authForm.password}
            />
          </div>
          <button className={`${PRIMARY_BUTTON_CLASS} w-full`} disabled={authBusy} type="submit">
            {authBusy ? "Working…" : authMode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      {incomingCall ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-dragon-black/80 px-6 py-8 backdrop-blur-md">
          <div className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl w-full max-w-md p-6 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-[''] flex flex-col gap-3 animate-scale-in">
            <h3>Incoming {incomingCall.callType} call</h3>
            <p className="text-gray-400">
              {userDirectory[incomingCall.initiatorId]?.display_name ??
                userDirectory[incomingCall.initiatorId]?.username ??
                "Someone"}{" "}
              is calling in this direct chat.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button className={PRIMARY_BUTTON_CLASS} disabled={isCalling} onClick={() => void acceptIncomingCall()} type="button">
                {isCalling ? "Connecting..." : "Accept"}
              </button>
              <button className={SECONDARY_BUTTON_CLASS} onClick={rejectIncomingCall} type="button">
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isNotificationsOpen ? (
        <div className="fixed inset-0 z-50 bg-dragon-black/70 backdrop-blur-sm" onClick={() => setNotificationsOpen(false)} role="presentation">
          <aside
            aria-label="Notifications drawer"
            className="fixed inset-y-4 right-4 z-[60] flex h-[calc(100vh-2rem)] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl animate-slide-in-right before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-['']"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-glass-border px-5 py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <h3>Notifications</h3>
                <span className="text-gray-400">{unreadNotifications.length} unread</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={unreadNotifications.length === 0}
                  onClick={() => void markAllNotificationsRead()}
                  type="button"
                >
                  Mark all read
                </button>
                <button className={SECONDARY_BUTTON_CLASS} onClick={() => setNotificationsOpen(false)} type="button">
                  Close
                </button>
              </div>
            </div>
            <div className="relative z-[1] flex-1 overflow-auto px-5 py-5 flex flex-col gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span
                  className={[
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
                    socketConnected
                      ? "border-flame-green/30 bg-flame-green/10 text-flame-green shadow-green"
                      : "border-glass-border bg-glass-surface text-gray-300",
                  ].join(" ")}
                >
                  Backend: {API_BASE_URL.replace("/api/v1", "")}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass-surface px-3 py-1.5 text-xs font-medium text-gray-300">{notifications.length} total</span>
              </div>
              {notifications.length === 0 ? (
                <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400 min-h-[220px]">No notifications yet.</div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {notifications.map((notification) => (
                    <li
                      className={[
                        "rounded-3xl border border-glass-border bg-glass-surface shadow-dragon backdrop-blur transition hover:-translate-y-0.5 hover:border-fire-flame/30 hover:bg-glass-hover",
                        notification.is_read ? "" : "border-fire-flame/30 bg-fire-flame/10",
                      ].join(" ")}
                      key={notification.id}
                    >
                      <div className="flex flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <strong>{formatNotificationTitle(notification.type)}</strong>
                          <span className="text-gray-400">{formatDateLabel(notification.created_at)}</span>
                        </div>
                        <div className="text-xs leading-5 text-gray-400">{getNotificationPreview(notification)}</div>
                        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: "12px" }}>
                          {notification.payload.chat_id ? (
                            <button
                              className={PRIMARY_BUTTON_CLASS}
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
                              className={SECONDARY_BUTTON_CLASS}
                              onClick={() => void markNotificationRead(notification.id)}
                              type="button"
                            >
                              Mark read
                            </button>
                          ) : (
                            <span className="text-xs leading-5 text-gray-400">Read</span>
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
        <div className="fixed inset-0 z-50 bg-dragon-black/70 backdrop-blur-sm" onClick={() => setProfileOpen(false)}>
          <aside
            className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl absolute inset-y-4 right-4 flex h-[calc(100vh-2rem)] w-full max-w-xl flex-col before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-['']"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px" }}
          >
            <div className="relative z-[1] flex items-start justify-between gap-3 border-b border-glass-border px-5 py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <h2>Profile Settings</h2>
                <span className="text-gray-400">@{currentUser.username}</span>
              </div>
              <button className={SECONDARY_BUTTON_CLASS} onClick={() => setProfileOpen(false)} type="button">
                Close
              </button>
            </div>
            <div className="relative z-[1] flex-1 overflow-auto px-5 py-5 flex flex-col gap-3">
              <form className="flex flex-col gap-3" onSubmit={handleProfileSubmit}>
                {profileAvatarPreviewUrl ?? currentUser?.display_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt="Profile avatar"
                    className="h-24 w-24 rounded-full border border-glass-border object-cover shadow-dragon"
                    src={profileAvatarPreviewUrl ?? currentUser?.display_avatar_url ?? ""}
                  />
                ) : null}
                <div className="flex flex-col gap-2">
                  <label htmlFor="profile_display_name">Display Name</label>
                  <input
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                    id="profile_display_name"
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, display_name: event.target.value }))
                    }
                    placeholder="Display name"
                    value={profileForm.display_name}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="profile_bio">Bio</label>
                  <textarea
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20 min-h-[112px] resize-y"
                    id="profile_bio"
                    onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                    placeholder="Bio"
                    value={profileForm.bio}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="profile_custom_status">Custom Status</label>
                  <input
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                    id="profile_custom_status"
                    onChange={(event) =>
                      setProfileForm((current) => ({ ...current, custom_status: event.target.value }))
                    }
                    placeholder="Custom status"
                    value={profileForm.custom_status}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="profile_status">Status</label>
                  <select
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
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
                <div className="flex flex-col gap-2">
                  <label htmlFor="wallpaper">Chat Wallpaper</label>
                  <select
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                    id="wallpaper"
                    onChange={(e) => setWallpaper(e.target.value)}
                    value={wallpaper}
                  >
                    <option value="default">Default (Dragon Theme)</option>
                    <option value="dark">Pure Dark</option>
                    <option value="fire">Fire Gradient</option>
                    <option value="green">Green Flame</option>
                    <option value="space">Space Theme</option>
                    <option value="minimal">Minimal Gray</option>
                    <option value="custom">Custom Upload</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="profile_avatar">Avatar</label>
                  <input id="profile_avatar" onChange={(event) => setProfileAvatarFile(event.target.files?.[0] ?? null)} type="file" />
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button className={PRIMARY_BUTTON_CLASS} disabled={savingProfile} type="submit">
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </button>
                  <button className={SECONDARY_BUTTON_CLASS} onClick={() => void handleLogout()} type="button">
                    Logout
                  </button>
                </div>
              </form>
            </div>
          </aside>
        </div>
      ) : null}

      {showChatSettings ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowChatSettings(false)}
        >
          <div
            className="relative w-full max-w-2xl rounded-3xl border border-glass-border bg-dragon-obsidian/95 shadow-2xl mx-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-glass-border px-6 py-5">
              <h2 className="bg-gradient-to-r from-fire-flame to-flame-green bg-clip-text text-2xl font-bold text-transparent">Chat Settings</h2>
              <button className="text-gray-400 transition hover:text-white" onClick={() => setShowChatSettings(false)} type="button">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fire-flame">Theme</h3>
                <div className="flex gap-3">
                  <button
                    className={`flex-1 rounded-xl border px-4 py-3 transition ${
                      chatTheme === "dark"
                        ? "border-fire-flame bg-fire-flame/20 text-white"
                        : "border-glass-border bg-glass-surface text-gray-400 hover:border-fire-flame/50"
                    }`}
                    onClick={() => setChatTheme("dark")}
                    type="button"
                  >
                    <Moon className="mx-auto mb-1 h-5 w-5" />
                    Dark
                  </button>
                  <button
                    className={`flex-1 rounded-xl border px-4 py-3 transition ${
                      chatTheme === "light"
                        ? "border-fire-flame bg-fire-flame/20 text-white"
                        : "border-glass-border bg-glass-surface text-gray-400 hover:border-fire-flame/50"
                    }`}
                    onClick={() => setChatTheme("light")}
                    type="button"
                  >
                    <Sun className="mx-auto mb-1 h-5 w-5" />
                    Light
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fire-flame">Chat Wallpaper</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(['default', 'dark', 'space', 'minimal'] as const).map((wp) => (
                    <button
                      key={wp}
                      onClick={() => {
                        localStorage.removeItem("nextalk.wallpaper");
                        setWallpaper(wp);
                      }}
                      className={`rounded-xl border px-4 py-3 capitalize transition ${
                        wallpaper === wp
                          ? 'border-fire-flame bg-fire-flame/20 text-white'
                          : 'border-glass-border bg-glass-surface text-gray-400 hover:border-fire-flame/50'
                      }`}
                    >
                      {wp}
                    </button>
                  ))}
                </div>
                <div className="space-y-3 pt-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wide">Or upload custom:</label>
                  <input
                    accept="image/*"
                    className="w-full rounded-xl border border-glass-border bg-glass-surface px-4 py-3 text-sm text-white"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) {
                        return;
                      }

                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const base64 = event.target?.result as string;
                        localStorage.setItem("nextalk.wallpaper", base64);
                        setWallpaper("custom");
                      };
                      reader.readAsDataURL(file);
                    }}
                    type="file"
                  />
                  {wallpaper === "custom" ? (
                    <button
                      className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 transition hover:bg-red-500/20"
                      onClick={() => {
                        localStorage.removeItem("nextalk.wallpaper");
                        setWallpaper("default");
                      }}
                      type="button"
                    >
                      Remove Custom Wallpaper
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fire-flame">Accent Color</h3>
                <div className="flex gap-3">
                  {[
                    { name: 'fire', color: 'bg-fire-flame' },
                    { name: 'green', color: 'bg-flame-green' },
                    { name: 'blue', color: 'bg-blue-500' },
                    { name: 'purple', color: 'bg-purple-500' },
                    { name: 'pink', color: 'bg-pink-500' },
                  ].map((accent) => (
                    <button
                      key={accent.name}
                      onClick={() => setAccentColor(accent.name as any)}
                      className={`h-12 w-12 rounded-full border-2 transition ${accent.color} ${
                        accentColor === accent.name ? 'border-white scale-110' : 'border-transparent'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fire-flame">Message Size</h3>
                <div className="flex gap-3">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      className={`flex-1 rounded-xl border px-4 py-3 capitalize transition ${
                        fontSize === size
                          ? "border-fire-flame bg-fire-flame/20 text-white"
                          : "border-glass-border bg-glass-surface text-gray-400 hover:border-fire-flame/50"
                      }`}
                      onClick={() => setFontSize(size)}
                      type="button"
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-fire-flame">Message Bubble Style</h3>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { name: "default", emoji: "💬" },
                    { name: "dog", emoji: "🐕" },
                    { name: "cat", emoji: "🐱" },
                    { name: "dinosaur", emoji: "🦖" },
                    { name: "giraffe", emoji: "🦒" },
                    { name: "dragon", emoji: "🐉" },
                    { name: "phoenix", emoji: "🔥" },
                    { name: "robot", emoji: "🤖" },
                    { name: "alien", emoji: "👽" },
                  ] as const).map((style) => (
                    <button
                      key={style.name}
                      className={`rounded-xl border px-4 py-3 capitalize transition ${
                        bubbleStyle === style.name
                          ? "border-fire-flame bg-fire-flame/20 text-white"
                          : "border-glass-border bg-glass-surface text-gray-400 hover:border-fire-flame/50"
                      }`}
                      onClick={() => setBubbleStyle(style.name)}
                      type="button"
                    >
                      <span className="mb-1 block text-2xl">{style.emoji}</span>
                      {style.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* New Chat Modal */}
      {isNewChatOpen ? (
        <div className="fixed inset-0 z-50 bg-dragon-black/70 backdrop-blur-sm" onClick={() => setNewChatOpen(false)}>
          <aside
            className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl absolute inset-y-4 right-4 flex h-[calc(100vh-2rem)] w-full max-w-xl flex-col before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-['']"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px" }}
          >
            <div className="relative z-[1] flex items-start justify-between gap-3 border-b border-glass-border px-5 py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <h2>New Chat</h2>
                <span className="text-gray-400">Start a conversation or create a group</span>
              </div>
              <button className={SECONDARY_BUTTON_CLASS} onClick={() => setNewChatOpen(false)} type="button">
                Close
              </button>
            </div>
            <div className="relative z-[1] flex-1 overflow-auto px-5 py-5 flex flex-col gap-3">
              <form onSubmit={handleUserSearch}>
                <div className="flex flex-col gap-2">
                  <label htmlFor="user_search">Search Users</label>
                  <input
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                    id="user_search"
                    onChange={(event) => setUserSearchQuery(event.target.value)}
                    placeholder="Search for users..."
                    value={userSearchQuery}
                  />
                </div>
                <button className={PRIMARY_BUTTON_CLASS} disabled={userSearchBusy} type="submit">
                  <Search className="mr-2 h-4 w-4" />
                  {userSearchBusy ? "Searching…" : "Search"}
                </button>
              </form>

              {userSearchResults.length > 0 ? (
                <div className="flex flex-col gap-3" style={{ marginTop: "20px" }}>
                  <h3 style={{ margin: 0 }}>Search Results</h3>
                  <ul className="m-0 flex list-none flex-col gap-3 p-0">
                    {userSearchResults.map((user) => {
                      const isSelected = selectedGroupMemberIds.includes(user.id);
                      return (
                        <li className="rounded-3xl border border-glass-border bg-glass-surface shadow-dragon backdrop-blur transition hover:-translate-y-0.5 hover:border-fire-flame/30 hover:bg-glass-hover" key={user.id}>
                          <div className="flex flex-col gap-3 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <strong>{user.display_name}</strong>
                                <div className="text-xs leading-5 text-gray-400">@{user.username}</div>
                              </div>
                              <span className={getPresenceClass(user.status)} />
                            </div>
                            <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: "12px" }}>
                              <button className={PRIMARY_BUTTON_CLASS} onClick={() => void createDirectChat(user)} type="button">
                                Start Chat
                              </button>
                              <button
                                className={isSelected ? SECONDARY_BUTTON_CLASS : "inline-flex items-center justify-center rounded-xl border border-glass-border bg-transparent px-4 py-2.5 text-sm font-medium text-gray-300 transition hover:bg-dragon-ash"}
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

              <div className="my-1 h-px bg-glass-border" />

              <div className="flex flex-col gap-3">
                <h3 style={{ margin: 0 }}>Create Group</h3>
                <div className="inline-flex w-fit rounded-full border border-glass-border bg-glass-surface p-1.5 backdrop-blur">
                  <button
                    className={getTabButtonClass(groupForm.mode === "group")}
                    onClick={() => setGroupForm((current) => ({ ...current, mode: "group" }))}
                    type="button"
                  >
                    Group
                  </button>
                  <button
                    className={getTabButtonClass(groupForm.mode === "supergroup")}
                    onClick={() => setGroupForm((current) => ({ ...current, mode: "supergroup" }))}
                    type="button">
                    Supergroup
                  </button>
                </div>
                {groupAvatarPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Group avatar" className="h-24 w-24 rounded-full border border-glass-border object-cover shadow-dragon" src={groupAvatarPreviewUrl} />
                ) : null}
                <div className="flex flex-col gap-2">
                  <label htmlFor="group_avatar">Group Avatar</label>
                  <input id="group_avatar" onChange={(event) => setGroupAvatarFile(event.target.files?.[0] ?? null)} type="file" accept="image/*" />
                </div>
                <input
                  className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                  onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={groupForm.mode === "group" ? "Group name" : "Supergroup name"}
                  value={groupForm.name}
                />
                <textarea
                  className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20 min-h-[112px] resize-y"
                  onChange={(event) => setGroupForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Description"
                  value={groupForm.description}
                />
                {selectedGroupMemberIds.length > 0 ? (
                  <div className="text-xs leading-5 text-gray-400">
                    Selected members:{" "}
                    {selectedGroupMemberIds
                      .map((userId) => userDirectory[userId]?.display_name ?? userDirectory[userId]?.username ?? userId)
                      .join(", ")}
                  </div>
                ) : null}
                <button className={PRIMARY_BUTTON_CLASS} disabled={!!busyLabel} onClick={() => void createGroupChat()} type="button">
                  {busyLabel && busyLabel.startsWith("Creating") ? busyLabel : `Create ${groupForm.mode}`}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <main
        className={`grid h-screen overflow-hidden relative z-10 ${chatTheme === "light" ? "theme-light" : "theme-dark"} grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)] ${
          isDetailsOpen ? "2xl:grid-cols-[280px_minmax(0,1fr)_340px]" : "2xl:grid-cols-[280px_minmax(0,1fr)]"
        }`}
      >
        {/* LEFT SIDEBAR - Channels & Direct Messages */}
        <aside className="mx-4 flex flex-col overflow-y-auto rounded-2xl border border-glass-border bg-dragon-obsidian/60 p-4 shadow-dragon backdrop-blur-xl">
          <div className="px-4 py-3 border-b border-glass-border">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Realtime messenger</span>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg bg-gradient-to-br from-fire-ember to-flame-green">N</div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-fire-flame to-flame-green bg-clip-text text-transparent">NexTalk</h1>
                  <span className="text-xs text-gray-500">Deep space conversations</span>
                </div>
              </div>
            </div>
          </div>

          {/* Saved Messages & Archive */}
          <div className="py-2 border-b border-glass-border/50">
            <ul className="flex flex-col gap-0.5">
              <li>
                <button 
                  onClick={() => setSelectedChatId("saved-messages")} 
                  type="button"
                  className={getSidebarButtonClass(selectedChatId === "saved-messages")}
                >
                  <Bookmark className="h-5 w-5" />
                  <span className="text-sm font-medium">Saved Messages</span>
                </button>
              </li>
              <li>
                <button 
                  onClick={() => setShowArchivedChats(!showArchivedChats)} 
                  type="button"
                  className={getSidebarButtonClass(showArchivedChats)}
                >
                  <Archive className="h-5 w-5" />
                  <span className="text-sm font-medium flex-1 text-left">Archived</span>
                  <span className="text-xs">{showArchivedChats ? "▼" : "▶"}</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Archived Chats (Expandable) */}
          {showArchivedChats && archivedChatIds.size > 0 && (
            <div className="py-2 border-b border-glass-border/50">
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
                <span>Archived Chats</span>
              </div>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {chats
                  .filter((chat) => archivedChatIds.has(chat.id))
                  .map((chat) => {
                    const title = chat.display_name ?? chat.name ?? chat.peer_username ?? "Chat";
                    return (
                      <li key={chat.id}>
                        <button
                          className={getSidebarButtonClass(selectedChatId === chat.id)}
                          onClick={() => setSelectedChatId(chat.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setArchivedChatIds((prev) => {
                              const next = new Set(prev);
                              next.delete(chat.id);
                              return next;
                            });
                          }}
                          type="button"
                        >
                          <span className="text-fire-flame">#</span>
                          <span className="flex-1 truncate text-left text-sm font-medium text-white/90">{title}</span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}

          {/* Channels Section */}
          <div className="py-2 border-b border-glass-border/50">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
              <span>Channels</span>
            </div>
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {filteredChats
                .filter((chat) => chat.type !== "direct")
                .map((chat) => {
                  const title = chat.display_name ?? chat.name ?? "Channel";
                  return (
                    <li key={chat.id}>
                      <button
                        className={getSidebarButtonClass(selectedChatId === chat.id)}
                        onClick={() => setSelectedChatId(chat.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setArchivedChatIds((prev) => new Set([...prev, chat.id]));
                        }}
                        title="Right-click to archive"
                        type="button"
                      >
                        <span className="text-fire-flame">#</span>
                        <span className="flex-1 truncate text-left text-sm font-medium text-white/90">{title}</span>
                        {chat.unread_count > 0 ? <span className="ml-auto inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-fire-flame to-fire-glow px-1.5 text-[10px] font-semibold text-white shadow-fire">{chat.unread_count}</span> : null}
                      </button>
                    </li>
                  );
                })}
              <li>
                <button className={getSidebarButtonClass(false)} onClick={() => setNewChatOpen(true)} type="button">
                  <span className="text-fire-flame">+</span>
                  <span className="flex-1 truncate text-left text-sm font-medium text-white/90">Add channel</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Direct Messages Section */}
          <div className="py-2">
            <div className="px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
              <span>Direct messages</span>
            </div>
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {filteredChats
                .filter((chat) => chat.type === "direct")
                .map((chat) => {
                  const title = chat.display_name ?? chat.peer_username ?? "Unknown";
                  const status =
                    chat.type === "direct" ? presenceByUserId[chat.peer_id ?? ""] ?? chat.peer_status : null;
                  return (
                    <li key={chat.id}>
                      <button
                        className={getSidebarButtonClass(selectedChatId === chat.id)}
                        onClick={() => setSelectedChatId(chat.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setArchivedChatIds((prev) => new Set([...prev, chat.id]));
                        }}
                        title="Right-click to archive"
                        type="button"
                      >
                        <Avatar label={title} size="sm" src={chat.display_avatar_url ?? chat.avatar_url} />
                        <span className="flex-1 truncate text-left text-sm font-medium text-white/90">{title}</span>
                        {status ? <span className={getPresenceClass(status)} /> : null}
                        {chat.unread_count > 0 ? <span className="ml-auto inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-r from-fire-flame to-fire-glow px-1.5 text-[10px] font-semibold text-white shadow-fire">{chat.unread_count}</span> : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          {/* Bottom Actions */}
          <div className="mt-auto border-t border-glass-border pt-3">
            <div className="flex flex-col gap-2">
              <button className="flex w-full items-center gap-3 rounded-2xl border border-glass-border bg-glass-surface p-3 text-left transition hover:border-fire-flame/30 hover:bg-glass-hover" onClick={() => setProfileOpen(true)} type="button">
                <Avatar label={currentUser.display_name} size="sm" src={profileAvatarPreviewUrl ?? currentUser.display_avatar_url} />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{currentUser.display_name}</span>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={getPresenceClass(currentUser.status)} />
                    <span className="text-xs capitalize text-gray-400">{currentUser.status}</span>
                  </div>
                </div>
              </button>
              <button
                className="flex items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-fire-flame/10"
                onClick={() => setShowChatSettings(true)}
                type="button"
              >
                <Settings className="h-5 w-5" />
                <span>Chat Settings</span>
              </button>
            </div>
          </div>
        </aside>

        {/* CENTER - Chat Panel */}
        <section className="relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl flex min-h-0 flex-col bg-dragon-charcoal/60 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-['']">
          {selectedChatId === "saved-messages" ? (
            <>
              <div className="relative z-[1] flex items-start justify-between gap-3 border-b border-glass-border px-5 py-5 shrink-0">
                <div className="flex cursor-pointer items-center gap-4 rounded-2xl p-2 -m-2 text-left transition hover:bg-glass-hover">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2>💾 Saved Messages</h2>
                    </div>
                    <span className="text-gray-400">Your personal space for notes and files</span>
                  </div>
                </div>
              </div>
              <div className={`relative flex flex-1 flex-col gap-4 overflow-auto px-6 py-6 wallpaper-${wallpaper} bubble-${bubbleStyle}`}>
                <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400">
                  <div>
                    <strong>Saved Messages</strong>
                    <p className="text-gray-400">Forward messages here to keep them handy. You can also use this space to draft messages or store files.</p>
                  </div>
                </div>
              </div>
              <form className="flex flex-col gap-3 border-t border-glass-border bg-gradient-to-t from-dragon-black/50 to-transparent px-5 py-5" onSubmit={(e) => { e.preventDefault(); alert("Saved Messages is a personal note space. Backend support coming soon!"); }}>
                <div className="rounded-[28px] border border-glass-border bg-dragon-ash/50 p-4 shadow-dragon backdrop-blur-xl">
                  <textarea
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20 min-h-[104px] resize-y"
                    placeholder="Write a note to yourself..."
                    style={{ minHeight: "60px", maxHeight: "150px", resize: "none" }}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex-1" />
                    <button className={`${PRIMARY_BUTTON_CLASS} min-w-[120px]`} type="submit">
                      Save Note
                    </button>
                  </div>
                </div>
              </form>
            </>
          ) : selectedChat ? (
            <>
              <div className="relative z-[1] flex items-start justify-between gap-3 border-b border-glass-border px-5 py-5 shrink-0">
                <div className="-m-2 flex items-center gap-4 rounded-2xl p-2 text-left">
                  <Avatar label={selectedChatTitle} size="sm" src={selectedChatAvatar} />
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2>{selectedChatTitle}</h2>
                      {selectedChat.type === "direct" ? <span className={getPresenceClass(selectedChatPeerStatus)} /> : null}
                    </div>
                    <span className="text-gray-400">
                      {selectedChat.type === "direct"
                        ? `${selectedChatPeerStatus ?? "offline"} · ${selectedMessages.length} messages`
                        : `${selectedChat.type} · ${selectedMessages.length} messages`}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button className={ICON_BUTTON_CLASS} onClick={() => setNotificationsOpen(true)} type="button" title="Notifications">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications.length > 0 ? (
                      <span className="absolute -right-1.5 -top-1.5 inline-grid min-h-6 min-w-6 place-items-center rounded-full bg-gradient-to-r from-fire-flame to-fire-glow px-1.5 text-[10px] font-semibold text-white shadow-fire">{unreadNotifications.length}</span>
                    ) : null}
                  </button>
                  <button className={ICON_BUTTON_CLASS} onClick={() => setDetailsOpen((open) => !open)} type="button" title={selectedChat.type === "direct" ? "Profile details" : "Group settings"}>
                    <Settings className="h-5 w-5" />
                  </button>
                  {selectedChat.type === "direct" ? (
                    <>
                      <button className={ICON_BUTTON_CLASS} disabled={isCalling} onClick={() => void startCall("audio")} type="button" title="Audio call">
                        <Phone className="h-5 w-5" />
                      </button>
                      <button className={ICON_BUTTON_CLASS} disabled={isCalling} onClick={() => void startCall("video")} type="button" title="Video call">
                        <Video className="h-5 w-5" />
                      </button>
                      <button className={ICON_BUTTON_CLASS} onClick={() => setNewChatOpen(true)} type="button" title="Convert to group">
                        <Users className="h-5 w-5" />
                      </button>
                    </>
                  ) : (
                    <button className={ICON_BUTTON_CLASS} onClick={() => setNewChatOpen(true)} type="button" title="Add members">
                      <Users className="h-5 w-5" />
                    </button>
                  )}
                  {activeCall && activeCall.chatId === selectedChat.id ? (
                    <button className={SECONDARY_BUTTON_CLASS} onClick={endCurrentCall} type="button">
                      End call
                    </button>
                  ) : null}
                  {/* Message search toggle */}
                  <button
                    className={`${ICON_BUTTON_CLASS} ${isChatSearchOpen ? "bg-fire-flame/10 text-fire-flame" : ""}`}
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
                    <Search className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {selectedChat.type === "supergroup" ? (
                <div className="flex flex-wrap gap-2 border-b border-glass-border px-5 py-4">
                  <button
                    className={getTopicButtonClass(!selectedTopicId)}
                    onClick={() => selectTopic(null)}
                    type="button"
                  >
                    All messages
                  </button>
                  {selectedTopics
                    .filter((topic) => !topic.is_archived)
                    .map((topic) => (
                      <button
                        className={getTopicButtonClass(selectedTopicId === topic.id)}
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

              <div className={`relative flex flex-1 flex-col gap-4 overflow-auto px-6 py-6 wallpaper-${wallpaper} bubble-${bubbleStyle}`}>
                {loadingChatKey === selectedMessageKey ? (
                  <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400">Loading conversation…</div>
                ) : selectedMessages.length === 0 ? (
                  <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400">
                    <div>
                      <strong>No messages yet.</strong>
                      <p className="text-gray-400">Send the first message to kick off this chat.</p>
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
                        className={getMessageRowClass(isOwnMessage, isSystem)}
                        key={`${message.id}-${message.temp_id ?? "server"}`}
                      >
                        {/* Show sender avatar for group chats on the left of others' messages */}
                        {!isOwnMessage && isGroup && !isSystem ? (
                          <div className="self-end pb-10">
                            <Avatar label={sender?.display_name ?? sender?.username ?? "?"} size="sm" src={sender?.display_avatar_url ?? sender?.avatar_url ?? null} />
                          </div>
                        ) : null}
                        <div
                          className={[
                            "relative flex min-w-0 max-w-full flex-col",
                            isOwnMessage && !isSystem ? "items-end" : "items-start",
                            isSystem ? "items-center" : "",
                            !isSystem ? "pb-7" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <article
                            className={getMessageBubbleClass(isOwnMessage, message.isPending, isSystem)}
                          >
                            {/* Show sender name in group chats */}
                            {!isOwnMessage && isGroup && !isSystem ? (
                              <div className="flex items-start justify-between gap-3">
                                <strong style={{ color: stringToColor(message.sender_id) }}>
                                  {sender?.display_name ?? sender?.username ?? "Unknown"}
                                </strong>
                                <span className="text-gray-400">
                                  {formatTimestamp(message.created_at)}
                                  {message.is_edited ? " · edited" : ""}
                                  {message.isPending ? " · sending" : ""}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-start justify-between gap-3">
                                <span className="text-gray-400">
                                  {formatTimestamp(message.created_at)}
                                  {message.topic_id ? " · topic" : ""}
                                  {message.is_edited ? " · edited" : ""}
                                  {message.isPending ? " · sending" : ""}
                                </span>
                              </div>
                            )}
                            {message.content ? (
                              <div className={`min-w-0 break-words whitespace-pre-wrap ${fontSize === "small" ? "text-xs" : fontSize === "large" ? "text-base" : "text-sm"} leading-6 text-gray-100`}>
                                {message.content.split(/(\[GIF: (https?:\/\/[^\]]+)\])/).map((part, idx) => {
                                  if (part.startsWith('[GIF:')) {
                                    const match = part.match(/\[GIF: (https?:\/\/[^\]]+)\]/);
                                    if (match) {
                                      return (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img key={idx} alt="GIF" className="mt-2 max-h-72 w-full rounded-2xl object-cover" src={match[1]} />
                                      );
                                    }
                                  }
                                  return part && !part.startsWith('http') ? <span key={idx}>{part}</span> : null;
                                })}
                              </div>
                            ) : null}
                            {message.attachments.length > 0 ? (
                              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                                {message.attachments.map((attachment) => {
                                  const isImage = attachment.mime_type.startsWith("image/");
                                  const isAudio = attachment.mime_type.startsWith("audio/");
                                  return (
                                    <li className="overflow-hidden rounded-3xl border border-glass-border bg-glass-surface shadow-dragon backdrop-blur transition hover:-translate-y-0.5 hover:border-fire-flame/30 hover:bg-glass-hover" key={attachment.id}>
                                      {isImage && attachment.display_url ? (
                                        <div className="overflow-hidden rounded-[20px]">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            alt={attachment.file_name}
                                            className="max-h-64 w-full object-cover"
                                            src={attachment.display_url}
                                          />
                                          <div className="flex items-center justify-between gap-3 border-t border-glass-border bg-dragon-black/50 px-3 py-2 text-sm text-white">
                                            <span>{attachment.file_name}</span>
                                            <button
                                              className={SECONDARY_BUTTON_CLASS}
                                              onClick={() => void downloadAttachment(attachment)}
                                              style={{ fontSize: "11px", padding: "2px 8px", flexShrink: 0 }}
                                              type="button"
                                            >↓</button>
                                          </div>
                                        </div>
                                      ) : isAudio && attachment.display_url ? (
                                        <AudioPlayer fileName={attachment.file_name} src={attachment.display_url} />
                                      ) : (
                                        <div style={{ padding: "10px 12px" }}>
                                          <div className="flex items-start justify-between gap-3">
                                            <div style={{ minWidth: 0 }}>
                                              <strong style={{ fontSize: "13px", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{attachment.file_name}</strong>
                                              <div className="text-gray-400" style={{ fontSize: "11px" }}>
                                                {attachment.mime_type} · {formatFileSize(attachment.file_size)}
                                              </div>
                                            </div>
                                            <button
                                              className={SECONDARY_BUTTON_CLASS}
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
                          {!isSystem ? (
                            <div
                              className={[
                                "absolute -bottom-3 z-10 flex max-w-full flex-wrap gap-2",
                                isOwnMessage ? "right-0 justify-end" : "left-0",
                              ].join(" ")}
                            >
                              {messageReactions[message.id] && Object.entries(messageReactions[message.id]).map(([emoji, userIds]) => (
                                <button
                                  key={emoji}
                                  className={getReactionBubbleClass(userIds.includes(currentUser.id))}
                                  onClick={() => {
                                    setMessageReactions((prev) => {
                                      const msgReactions = { ...(prev[message.id] ?? {}) };
                                      const reactedUsers = msgReactions[emoji] ?? [];
                                      if (reactedUsers.includes(currentUser.id)) {
                                        msgReactions[emoji] = reactedUsers.filter((id) => id !== currentUser.id);
                                        if (msgReactions[emoji].length === 0) delete msgReactions[emoji];
                                      } else {
                                        msgReactions[emoji] = [...reactedUsers, currentUser.id];
                                      }
                                      return { ...prev, [message.id]: msgReactions };
                                    });
                                  }}
                                  type="button"
                                >
                                  <span>{emoji}</span>
                                  <span className="text-[11px] font-medium text-gray-300">{userIds.length}</span>
                                </button>
                              ))}
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-glass-border bg-glass-surface text-sm text-gray-300 transition hover:border-fire-flame/40 hover:text-white"
                                onClick={() => setShowReactionPicker(showReactionPicker === message.id ? null : message.id)}
                                type="button"
                              >
                                +
                              </button>
                              {showReactionPicker === message.id && (
                                <div
                                  className={[
                                    "absolute bottom-full z-20 mb-2 flex max-w-[18rem] flex-wrap gap-2 rounded-2xl border border-glass-border bg-dragon-obsidian/95 p-2 shadow-dragon",
                                    isOwnMessage ? "right-0" : "left-0",
                                  ].join(" ")}
                                >
                                  {["❤️", "👍", "👏", "😂", "😮", "😢", "🔥", "🎉"].map((emoji) => (
                                    <button
                                      key={emoji}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-glass-surface text-lg transition hover:scale-105 hover:bg-glass-hover"
                                      onClick={() => {
                                        setMessageReactions((prev) => {
                                          const msgReactions = { ...(prev[message.id] ?? {}) };
                                          const reactedUsers = msgReactions[emoji] ?? [];
                                          if (!reactedUsers.includes(currentUser.id)) {
                                            msgReactions[emoji] = [...reactedUsers, currentUser.id];
                                          }
                                          return { ...prev, [message.id]: msgReactions };
                                        });
                                        setShowReactionPicker(null);
                                      }}
                                      type="button"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {isChatSearchOpen ? (
              <div className="border-t border-glass-border px-5 py-4">
                <form onSubmit={handleMessageSearch} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                  <input
                    autoFocus
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                    placeholder="Search messages in this chat…"
                    style={{ flex: 1 }}
                    value={chatSearchQuery}
                  />
                  <button className={PRIMARY_BUTTON_CLASS} disabled={messageSearchBusy} type="submit" style={{ padding: "6px 12px" }}>
                    <Search className="mr-2 h-4 w-4" />
                    {messageSearchBusy ? "…" : "Go"}
                  </button>
                  {chatSearchResults.length > 0 ? (
                    <button
                      className={SECONDARY_BUTTON_CLASS}
                      onClick={() => { setChatSearchQuery(""); setChatSearchResults([]); }}
                      type="button"
                      style={{ padding: "6px 12px" }}
                    >
                      ✕
                    </button>
                  ) : null}
                </form>
                {chatSearchResults.length > 0 ? (
                  <ul className="m-0 flex list-none flex-col gap-3 p-0" style={{ maxHeight: "160px", overflowY: "auto" }}>
                    {chatSearchResults.map((message) => (
                      <li className="rounded-3xl border border-glass-border bg-glass-surface shadow-dragon backdrop-blur transition hover:-translate-y-0.5 hover:border-fire-flame/30 hover:bg-glass-hover" key={`search-${message.id}`}>
                        <button onClick={() => setSelectedChatId(message.chat_id)} type="button">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-sm font-semibold text-gray-50">
                              {userDirectory[message.sender_id]?.display_name ??
                                userDirectory[message.sender_id]?.username ??
                                "Unknown"}
                            </span>
                            <span className="text-gray-400">{formatDateLabel(message.created_at)}</span>
                          </div>
                          <div className="text-xs leading-5 text-gray-400">{message.content}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              ) : null}

              {typingByChat[selectedChat.id]?.length ? (
                <div className="px-6 text-xs italic text-flame-green">
                  {typingByChat[selectedChat.id]
                    .map((userId) => userDirectory[userId]?.display_name ?? userDirectory[userId]?.username ?? "Someone")
                    .join(", ")}{" "}
                  is typing…
                </div>
              ) : null}

              <form className="flex flex-col gap-3 border-t border-glass-border bg-gradient-to-t from-dragon-black/50 to-transparent px-5 py-5" onSubmit={handleMessageSubmit}>
                <div className="rounded-[28px] border border-glass-border bg-dragon-ash/50 p-4 shadow-dragon backdrop-blur-xl">
                  <textarea
                    className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20 min-h-[104px] resize-y"
                    onBlur={stopTyping}
                    onChange={handleComposerChange}
                    placeholder="Type a message…"
                    style={{ minHeight: "60px", maxHeight: "150px", resize: "none" }}
                    value={composerText}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Attach files */}
                    <label className={`${ICON_BUTTON_CLASS} h-10 w-10 cursor-pointer rounded-xl`} htmlFor="attachments" title="Attach files">
                      <Paperclip className="h-4 w-4" />
                    </label>
                    <input hidden id="attachments" multiple onChange={handleFileSelection} type="file" />
                    {/* Emoji picker trigger */}
                    <div className="relative">
                      <button
                        className={`${ICON_BUTTON_CLASS} h-10 w-10 rounded-xl`}
                        onClick={() => setIsEmojiPickerOpen((v) => !v)}
                        title="Emoji & Stickers"
                        type="button"
                        style={{ fontSize: "18px" }}
                      >
                        <Smile className="h-4 w-4" />
                      </button>
                      {isEmojiPickerOpen ? (
                        <div className="absolute bottom-full left-0 z-30 mb-3 max-w-[min(22rem,calc(100vw-2rem))]">
                          <div className="w-[min(22rem,calc(100vw-2rem))] max-h-[min(28rem,calc(100vh-8rem))] overflow-y-auto rounded-3xl border border-glass-border bg-dragon-obsidian/95 p-3 shadow-dragon backdrop-blur-xl">
                            <div className="mb-3 flex flex-wrap gap-2 border-b border-glass-border pb-3">
                              {EMOJI_CATEGORIES.map((cat, i) => (
                                <button
                                  className={getPickerTabClass(emojiPickerTab === i)}
                                  key={i}
                                  onClick={() => setEmojiPickerTab(i)}
                                  title={cat.label}
                                  type="button"
                                >
                                  {cat.icon}
                                </button>
                              ))}
                              <button
                                className={getPickerTabClass(emojiPickerTab === EMOJI_CATEGORIES.length)}
                                onClick={() => setEmojiPickerTab(EMOJI_CATEGORIES.length)}
                                title="Stickers"
                                type="button"
                              >
                                🎭
                              </button>
                              <button
                                className={getPickerTabClass(emojiPickerTab === EMOJI_CATEGORIES.length + 1)}
                                onClick={() => setEmojiPickerTab(EMOJI_CATEGORIES.length + 1)}
                                title="GIFs"
                                type="button"
                              >
                                🎬
                              </button>
                            </div>
                            {emojiPickerTab < EMOJI_CATEGORIES.length ? (
                              <div className="grid max-h-64 grid-cols-7 gap-2 overflow-y-auto pr-1">
                                {EMOJI_CATEGORIES[emojiPickerTab]?.emojis.map((emoji, j) => (
                                  <button
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-glass-surface text-xl transition hover:scale-105 hover:bg-glass-hover"
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
                            ) : emojiPickerTab === EMOJI_CATEGORIES.length ? (
                              <div className="flex flex-col gap-3">
                                <div className="flex flex-wrap gap-2">
                                  {STICKER_PACKS.map((pack, i) => (
                                    <button
                                      className={getPickerTabClass(stickerPackTab === i)}
                                      key={i}
                                      onClick={() => setStickerPackTab(i)}
                                      title={pack.label}
                                      type="button">
                                      {pack.icon}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid max-h-64 grid-cols-5 gap-2 overflow-y-auto pr-1">
                                  {STICKER_PACKS[stickerPackTab]?.stickers.map((sticker, j) => (
                                    <button
                                      className="inline-flex h-14 items-center justify-center rounded-2xl bg-glass-surface text-2xl transition hover:scale-[1.03] hover:bg-glass-hover"
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
                            ) : (
                              <div className="flex flex-col gap-3">
                                <input
                                  className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                                  onChange={(e) => setGifSearchQuery(e.target.value)}
                                  placeholder="Search GIFs..."
                                  type="text"
                                  value={gifSearchQuery}
                                />
                                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
                                  {GIF_COLLECTION.filter(gif => 
                                    !gifSearchQuery || gif.tags.some(tag => tag.includes(gifSearchQuery.toLowerCase()))
                                  ).map((gif) => (
                                    <button
                                      className="overflow-hidden rounded-2xl border border-glass-border bg-glass-surface transition hover:scale-[1.02] hover:border-fire-flame/30"
                                      key={gif.id}
                                      onClick={() => {
                                        setComposerText((t) => t + `\n[GIF: ${gif.url}]\n`);
                                        setIsEmojiPickerOpen(false);
                                        setGifSearchQuery("");
                                      }}
                                      type="button"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img alt="GIF" className="h-28 w-full object-cover" src={gif.url} />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex-1" />
                    <button className={`${PRIMARY_BUTTON_CLASS} min-w-[120px]`} disabled={!socketConnected || sendingMessage} type="submit">
                      <Send className="mr-2 h-4 w-4" />
                      {sendingMessage ? "Sending…" : !socketConnected ? "Connecting…" : "Send"}
                    </button>
                  </div>
                  {pendingFiles.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pendingFiles.map((file, index) => (
                        <div className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass-surface px-3 py-1.5 text-xs text-gray-200" key={index}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                            <polyline points="13 2 13 9 20 9"></polyline>
                          </svg>
                          <span>{file.name}</span>
                          <button
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-fire-flame/15 text-fire-glow transition hover:bg-fire-flame/25"
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
            <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400">
              <div>
                <strong>No chat selected.</strong>
                <p className="text-gray-400">Search for a user or create a group from the left.</p>
              </div>
            </div>
          )}
        </section>

        {/* RIGHT SIDEBAR - Profile Panel (Always visible like Vino) */}
        <aside
          className={[
            "relative overflow-hidden rounded-[28px] border border-glass-border bg-dragon-obsidian/70 shadow-dragon backdrop-blur-xl before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_50%)] before:content-[''] min-h-0 flex-col bg-dragon-obsidian/60",
            isDetailsOpen ? "flex" : "hidden",
          ].join(" ")}
        >
          <div className="border-b border-glass-border px-5 py-5">
            <h3>{selectedChat?.type === "direct" ? "Profile" : "Group Info"}</h3>
          </div>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            {selectedChat && selectedChat.type === "direct" ? (
              <>
                <div className="flex flex-col items-center gap-3 rounded-3xl border border-glass-border bg-glass-surface px-5 py-6 text-center">
                  <Avatar label={selectedChatTitle} size="lg" src={selectedChatAvatar} />
                  <h2 className="text-xl font-semibold text-white">{selectedChatTitle}</h2>
                  <div className="flex items-center gap-2">
                    <span className={getPresenceClass(selectedChatPeerStatus)} />
                    <span className="text-sm capitalize text-gray-400">{selectedChatPeerStatus ?? "offline"}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date().toLocaleTimeString()} local time
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button className={SECONDARY_BUTTON_CLASS} disabled={isCalling} onClick={() => void startCall("audio")} type="button">
                    <Phone className="mr-2 h-4 w-4" />
                    Call
                  </button>
                  <button className={SECONDARY_BUTTON_CLASS} disabled={isCalling} onClick={() => void startCall("video")} type="button">
                    <Video className="mr-2 h-4 w-4" />
                    Video
                  </button>
                </div>

                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4>Contact Information</h4>
                  <div className="mt-3 flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">Email Address</span>
                    <span className="text-sm text-white">{selectedChat.peer_username}@nextalk.com</span>
                  </div>
                </div>

                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4>About me</h4>
                  <p className="text-sm leading-6 text-gray-300">{userDirectory[selectedChat.peer_id ?? ""]?.bio || "No bio available"}</p>
                </div>
              </>
            ) : selectedChat ? (
              <>
                {/* Group Avatar */}
                <div className="flex flex-col items-center gap-3 rounded-3xl border border-glass-border bg-glass-surface px-5 py-6 text-center">
                  <label className="group relative inline-flex cursor-pointer" title="Change group photo">
                    <Avatar label={selectedChatTitle} size="lg" src={selectedChatAvatar} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-dragon-black/60 text-xl opacity-0 transition group-hover:opacity-100">📷</span>
                    <input
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleGroupAvatarUpload(selectedChat.id, file);
                      }}
                      type="file"
                    />
                  </label>
                  <h2 className="text-xl font-semibold text-white">{selectedChatTitle}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm capitalize text-gray-400">{selectedChat.type} · {groupMembers.length} members</span>
                  </div>
                </div>

                {/* Edit name & description */}
                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4 className="text-sm font-semibold text-white">Group Settings</h4>
                  <div className="mt-3 flex flex-col gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Group Name</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                      onChange={(e) => setGroupEditName(e.target.value)}
                      placeholder="Group name"
                      type="text"
                      value={groupEditName}
                    />
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Description</label>
                    <textarea
                      className="mt-1 w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                      onChange={(e) => setGroupEditDesc(e.target.value)}
                      placeholder="Group description"
                      rows={2}
                      value={groupEditDesc}
                    />
                  </div>
                  <button
                    className={`${PRIMARY_BUTTON_CLASS} mt-4 w-full`}
                    disabled={groupEditBusy}
                    onClick={() => void handleGroupSave(selectedChat.id)}
                    type="button"
                  >
                      <Settings className="mr-2 h-4 w-4" />
                      {groupEditBusy ? "Saving..." : "Save Changes"}
                    </button>
                </div>

                {/* Media Gallery */}
                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4 className="text-sm font-semibold text-white">Media, Links and Docs</h4>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {selectedMessages
                      .filter((msg) => msg.attachments.some((att) => att.mime_type.startsWith("image/")))
                      .slice(0, 6)
                      .map((msg) => {
                        const img = msg.attachments.find((a) => a.mime_type.startsWith("image/"));
                        return img?.display_url ? (
                          <div key={msg.id} className="overflow-hidden rounded-2xl border border-glass-border bg-dragon-charcoal/80">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt="Media" className="aspect-square h-full w-full object-cover" src={img.display_url} />
                          </div>
                        ) : null;
                      })}
                  </div>
                  {selectedMessages.filter((msg) => msg.attachments.some((att) => att.mime_type.startsWith("image/"))).length === 0 && (
                    <p className="mt-3 text-sm text-gray-400">No media shared yet</p>
                  )}
                </div>

                {/* Notification Settings */}
                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4 className="text-sm font-semibold text-white">Notifications</h4>
                  <button
                    className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-glass-border bg-dragon-charcoal px-4 py-3 text-left transition hover:bg-dragon-ash"
                    onClick={() => {
                      setChatMuteStates((prev) => ({
                        ...prev,
                        [selectedChat.id]: !prev[selectedChat.id],
                      }));
                    }}
                    type="button"
                  >
                    <Bell className="h-5 w-5 text-gray-400" />
                    <span className="text-sm font-medium text-white">
                      {chatMuteStates[selectedChat.id] ? "Unmute notifications" : "Mute notifications"}
                    </span>
                  </button>
                </div>

                {/* Members list */}
                <div className="rounded-3xl border border-glass-border bg-glass-surface p-4">
                  <h4 className="text-sm font-semibold text-white">{groupMembers.length} Members</h4>
                  {/* Add member search */}
                  <div className="mt-3">
                    <input
                      className="w-full rounded-xl border border-glass-border bg-dragon-ash/50 px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-fire-flame/60 focus:ring-2 focus:ring-fire-flame/20"
                      onChange={(e) => void handleGroupAddUserSearch(e.target.value)}
                      placeholder="Search users to add..."
                      type="text"
                      value={groupAddUserQuery}
                    />
                  </div>
                  {groupAddUserResults.length > 0 && (
                    <ul className="mt-3 flex list-none flex-col gap-2 p-0">
                      {groupAddUserResults.map((user) => (
                        <li className="flex items-center gap-3 rounded-2xl border border-glass-border bg-dragon-ash/30 p-3" key={user.id}>
                          <Avatar
                            label={user.display_name ?? user.username}
                            size="sm"
                            src={user.display_avatar_url ?? user.avatar_url}
                          />
                          <span className="flex-1 truncate text-sm font-medium text-white">{user.display_name ?? user.username}</span>
                          <button
                            className="inline-flex items-center rounded-xl border border-fire-flame/30 bg-dragon-ash px-3 py-2 text-xs font-semibold text-fire-flame transition hover:bg-fire-flame/10"
                            onClick={() => void handleGroupAddMember(selectedChat.id, user.id)}
                            type="button"
                          >
                            <Users className="mr-1.5 h-3.5 w-3.5" />
                            Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* Current members */}
                  {groupMembersLoading ? (
                    <p className="mt-3 text-sm text-gray-400">Loading members...</p>
                  ) : (
                    <ul className="mt-3 flex list-none flex-col gap-2 p-0">
                      {groupMembers.map((member) => {
                        const memberUser = userDirectory[member.user_id];
                        return (
                          <li className="flex items-center gap-3 rounded-2xl border border-glass-border bg-dragon-ash/30 p-3" key={member.user_id}>
                            <Avatar
                              label={memberUser?.display_name ?? memberUser?.username ?? member.user_id}
                              size="sm"
                              src={memberUser?.display_avatar_url ?? memberUser?.avatar_url}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-white">
                                {memberUser?.display_name ?? memberUser?.username ?? "Unknown"}
                              </span>
                              <span className="text-xs uppercase tracking-wide text-gray-500">{member.role}</span>
                            </div>
                            {member.role !== "owner" && currentUser?.id !== member.user_id && (
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-200 transition hover:bg-rose-500/20"
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
              <div className="grid h-full place-items-center rounded-[28px] border border-dashed border-glass-border bg-glass-surface px-6 py-10 text-center text-gray-400">
                <p>Select a chat to view profile</p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Full-Page Call Interface */}
      {activeCall ? (
        <div className="fixed inset-0 z-[60] bg-dragon-black">
          <div className="relative flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,107,53,0.15),transparent_28%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.12),transparent_30%),linear-gradient(180deg,#0a0a0a_0%,#151515_100%)]">
            {activeCall.callType === "video" ? (
              <>
                <video autoPlay className="h-full w-full object-cover" playsInline ref={remoteVideoRef} />
                <video autoPlay className="absolute bottom-28 right-6 h-40 w-64 rounded-2xl border border-glass-border object-cover shadow-dragon" muted playsInline ref={localVideoRef} />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-4">
                <div className="rounded-full border border-glass-border bg-glass-surface p-3 shadow-dragon">
                  <Avatar
                    label={selectedChat?.display_name ?? selectedChat?.name ?? "Call"}
                    size="lg"
                    src={selectedChat?.display_avatar_url ?? selectedChat?.avatar_url}
                  />
                </div>
                <h2 className="text-3xl font-semibold text-white">
                  {selectedChat?.display_name ?? selectedChat?.name ?? "Unknown"}
                </h2>
                <p className="text-sm text-gray-400">
                  {activeCall.status === "ringing" ? "Calling..." : "Connected"}
                </p>
              </div>
            )}
            
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-4 border-t border-glass-border bg-dragon-black/70 px-6 py-5 backdrop-blur-xl">
              <div className="flex flex-col">
                <span className="text-sm font-semibold uppercase tracking-[0.2em] text-fire-glow">
                  {activeCall.callType === "video" ? "Video Call" : "Audio Call"}
                </span>
                <span className="text-sm text-gray-400">
                  {activeCall.status === "ringing" ? "Ringing..." : "Active"}
                </span>
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-glass-border bg-glass-surface text-white transition hover:scale-105 hover:border-fire-flame/30"
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
                    className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-glass-border bg-glass-surface text-white transition hover:scale-105 hover:border-fire-flame/30"
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
                  className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-glass-border bg-glass-surface text-white transition hover:scale-105 hover:border-fire-flame/30 border-rose-400/30 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30"
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
