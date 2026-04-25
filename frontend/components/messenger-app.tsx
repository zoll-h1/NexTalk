"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL, ApiError, WS_BASE_URL, apiRequest } from "@/lib/api";
import type {
  AccessTokenResponse,
  Attachment,
  AuthResponse,
  CallRecord,
  Chat,
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
  const [socketConnected, setSocketConnected] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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

  const loadProfileAvatarPreview = useCallback(async () => {
    if (!currentUser?.avatar_url) {
      setProfileAvatarPreviewUrl(null);
      return;
    }
    try {
      const downloadUrl = await ensureDownloadUrl(currentUser.avatar_url);
      setProfileAvatarPreviewUrl(downloadUrl);
    } catch {
      setProfileAvatarPreviewUrl(null);
    }
  }, [currentUser?.avatar_url, ensureDownloadUrl]);

  useEffect(() => {
    void loadProfileAvatarPreview();
  }, [loadProfileAvatarPreview]);

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
  }, [callHistoryByChat, loadCallHistory, loadTopics, selectedChat, topicsByChat]);

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
    const socket = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(accessToken)}`);
    socketRef.current = socket;
    socket.addEventListener("open", () => setSocketConnected(true));
    socket.addEventListener("close", () => setSocketConnected(false));
    socket.addEventListener("error", () => setSocketConnected(false));
    socket.addEventListener("message", (incoming) => {
      const event = JSON.parse(incoming.data) as WebSocketEvent<Record<string, unknown>>;
      void handleSocketEvent(event);
    });
    return () => {
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
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
      const endpoint = groupForm.mode === "group" ? "/chats/group" : "/chats/supergroup";
      const payload =
        groupForm.mode === "group"
          ? {
              description: groupForm.description || null,
              member_ids: selectedGroupMemberIds,
              name: groupForm.name.trim(),
            }
          : {
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
      setGroupForm({ description: "", mode: "group", name: "" });
      setSelectedGroupMemberIds([]);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Unable to create the group.");
    } finally {
      setBusyLabel(null);
    }
  }, [authorizedRequest, groupForm, selectedGroupMemberIds]);

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
      if (!selectedChat || !currentUser) {
        return;
      }
      const trimmed = composerText.trim();
      if (!trimmed && pendingFiles.length === 0) {
        return;
      }
      setBusyLabel("Sending message...");
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
        setBusyLabel(null);
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
    if (!profileAvatarFile) {
      return profileForm.avatar_url || null;
    }
    const presigned = await authorizedRequest<UploadPresignResponse>("/uploads/presigned", {
      body: {
        file_name: profileAvatarFile.name,
        file_size: profileAvatarFile.size,
        mime_type: profileAvatarFile.type || "application/octet-stream",
        scope: "avatar",
      },
      method: "POST",
    });
    const uploadResponse = await fetch(presigned.upload_url, {
      body: profileAvatarFile,
      headers: { "Content-Type": profileAvatarFile.type || "application/octet-stream" },
      method: "PUT",
    });
    if (!uploadResponse.ok) {
      throw new Error("Unable to upload the avatar.");
    }
    return presigned.s3_key;
  }, [authorizedRequest, profileAvatarFile, profileForm.avatar_url]);

  const handleProfileSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!currentUser) {
        return;
      }
      setBusyLabel("Saving profile...");
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
        setBusyLabel(null);
      }
    },
    [authorizedRequest, currentUser, mergeUsers, profileForm, uploadAvatarIfNeeded],
  );

  const startCall = useCallback(
    async (callType: CallKind) => {
      if (!selectedChat || selectedChat.type !== "direct" || !currentUser) {
        return;
      }
      setCallError(null);
      setBusyLabel(`Starting ${callType} call...`);
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
        setBusyLabel(null);
      }
    },
    [cleanupCall, createPeerConnection, currentUser, prepareLocalMedia, selectedChat, sendSocketEvent],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) {
      return;
    }
    setCallError(null);
    setBusyLabel("Accepting call...");
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
      setBusyLabel(null);
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
        <div className="panel auth-card stack">
          <h1>Bootstrapping NexTalk…</h1>
          <p className="muted">Restoring your session and connecting to the backend.</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="auth-screen">
        <form className="panel auth-card stack" onSubmit={handleAuthSubmit}>
          <div className="stack">
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
            <h1>NexTalk frontend</h1>
            <p className="muted">The UI now targets the current backend and includes parity work in progress.</p>
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
          <button className="primary-button" disabled={authBusy} type="submit">
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
          <div className="panel call-modal stack">
            <h3>Incoming {incomingCall.callType} call</h3>
            <p className="muted">
              {userDirectory[incomingCall.initiatorId]?.display_name ??
                userDirectory[incomingCall.initiatorId]?.username ??
                "Someone"}{" "}
              is calling in this direct chat.
            </p>
            <div className="row wrap">
              <button className="primary-button" onClick={() => void acceptIncomingCall()} type="button">
                Accept
              </button>
              <button className="ghost-button" onClick={rejectIncomingCall} type="button">
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="app-shell">
        <aside className="panel sidebar">
          <div className="panel-header">
            <div className="brand">
              <h1>NexTalk</h1>
              <span className="muted">
                {currentUser.display_name} · {socketConnected ? "live" : "offline"}
              </span>
            </div>
            <button className="ghost-button" onClick={() => void handleLogout()} type="button">
              Logout
            </button>
          </div>

          <div className="panel-body stack">
            {appError ? <div className="inline-error">{appError}</div> : null}
            {callError ? <div className="inline-error">{callError}</div> : null}

            <form className="stack" onSubmit={handleUserSearch}>
              <div className="field-group">
                <label htmlFor="chat-filter">Find people or filter chats</label>
                <input
                  className="text-input"
                  id="chat-filter"
                  onChange={(event) => setUserSearchQuery(event.target.value)}
                  placeholder="Search users or filter chats"
                  value={userSearchQuery}
                />
              </div>
              <button className="secondary-button" disabled={userSearchBusy} type="submit">
                {userSearchBusy ? "Searching…" : "Search users"}
              </button>
            </form>

            <div className="builder-card stack">
              <div className="row wrap">
                <h3 style={{ margin: 0 }}>Create chat space</h3>
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
                    type="button"
                  >
                    Supergroup
                  </button>
                </div>
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

            {userSearchResults.length > 0 ? (
              <ul className="search-results">
                {userSearchResults.map((user) => {
                  const isSelected = selectedGroupMemberIds.includes(user.id);
                  return (
                    <li className="search-card" key={user.id}>
                      <div className="panel-body" style={{ padding: "12px 14px" }}>
                        <div className="chat-title-row">
                          <div>
                            <strong>{user.display_name}</strong>
                            <div className="helper-text">@{user.username}</div>
                          </div>
                          <span className={getPresenceClass(user.status)} />
                        </div>
                        <div className="row wrap" style={{ marginTop: "12px" }}>
                          <button className="secondary-button" onClick={() => void createDirectChat(user)} type="button">
                            Direct chat
                          </button>
                          <button
                            className={isSelected ? "primary-button" : "ghost-button"}
                            onClick={() => toggleSelectedGroupMember(user.id)}
                            type="button"
                          >
                            {isSelected ? "Selected" : "Select"}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div className="divider" />

            <ul className="chat-list">
              {filteredChats.map((chat) => {
                const title = chat.display_name ?? chat.name ?? "Direct chat";
                const subtitle = chat.type === "direct" ? `@${chat.peer_username ?? "unknown"}` : chat.description;
                const status =
                  chat.type === "direct" ? presenceByUserId[chat.peer_id ?? ""] ?? chat.peer_status : null;
                return (
                  <li className={`chat-card ${chat.id === selectedChatId ? "active" : ""}`} key={chat.id}>
                    <button onClick={() => setSelectedChatId(chat.id)} type="button">
                      <div className="chat-title-row">
                        <span className="chat-title">{title}</span>
                        <div className="row">
                          {status ? <span className={getPresenceClass(status)} /> : null}
                          {chat.unread_count > 0 ? <span className="badge">{chat.unread_count}</span> : null}
                        </div>
                      </div>
                      <div className="helper-text">{subtitle || chat.type}</div>
                      <div className="helper-text">{formatDateLabel(chat.updated_at)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <section className="panel chat-panel">
          {selectedChat ? (
            <>
              <div className="panel-header">
                <div className="brand">
                  <h2>{selectedChatTitle}</h2>
                  <span className="muted">
                    {selectedChat.type === "direct"
                      ? `${selectedChatPeerStatus ?? "offline"} · ${selectedMessages.length} messages`
                      : `${selectedChat.type} · ${selectedMessages.length} messages`}
                  </span>
                </div>
                <div className="row wrap">
                  <span className={`pill ${socketConnected ? "online" : ""}`}>
                    {socketConnected ? "WS connected" : "WS disconnected"}
                  </span>
                  {selectedChat.type === "direct" ? (
                    <>
                      <button className="secondary-button" onClick={() => void startCall("audio")} type="button">
                        Audio call
                      </button>
                      <button className="secondary-button" onClick={() => void startCall("video")} type="button">
                        Video call
                      </button>
                    </>
                  ) : null}
                  {activeCall && activeCall.chatId === selectedChat.id ? (
                    <button className="ghost-button" onClick={endCurrentCall} type="button">
                      End call
                    </button>
                  ) : null}
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

              {activeCall && activeCall.chatId === selectedChat.id ? (
                <div className="call-stage">
                  <div className="call-card">
                    <h3 style={{ margin: 0 }}>
                      {activeCall.callType === "video" ? "Video" : "Audio"} call · {activeCall.status}
                    </h3>
                    <p className="muted">
                      {activeCall.status === "ringing"
                        ? "Waiting for the other side to accept."
                        : "Realtime media is flowing through WebRTC."}
                    </p>
                    <div className="video-grid">
                      <video autoPlay className="video-tile" muted playsInline ref={localVideoRef} />
                      <video autoPlay className="video-tile" playsInline ref={remoteVideoRef} />
                    </div>
                  </div>
                </div>
              ) : null}

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
                    return (
                      <article
                        className={`message-bubble ${isOwnMessage ? "own" : ""} ${message.isPending ? "pending" : ""} ${
                          message.type === "system" ? "system" : ""
                        }`}
                        key={`${message.id}-${message.temp_id ?? "server"}`}
                      >
                        <div className="message-meta">
                          <strong>{isOwnMessage ? "You" : sender?.display_name ?? sender?.username ?? "Unknown"}</strong>
                          <span className="muted">
                            {formatTimestamp(message.created_at)}
                            {message.topic_id ? " · topic" : ""}
                            {message.is_edited ? " · edited" : ""}
                            {message.isPending ? " · sending" : ""}
                          </span>
                        </div>
                        {message.content ? <div className="message-content">{message.content}</div> : null}
                        {message.attachments.length > 0 ? (
                          <ul className="attachment-list">
                            {message.attachments.map((attachment) => (
                              <li className="attachment-card" key={attachment.id}>
                                <div className="panel-body" style={{ padding: "12px 14px" }}>
                                  <div className="attachment-meta">
                                    <div>
                                      <strong>{attachment.file_name}</strong>
                                      <div className="helper-text">
                                        {attachment.mime_type} · {formatFileSize(attachment.file_size)}
                                      </div>
                                    </div>
                                    <button
                                      className="ghost-button"
                                      onClick={() => void downloadAttachment(attachment)}
                                      type="button"
                                    >
                                      Download
                                    </button>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    );
                  })
                )}
              </div>

              <div className="message-search-results">
                <form className="row wrap" onSubmit={handleMessageSearch}>
                  <input
                    className="text-input"
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                    placeholder="Search messages in this chat"
                    value={chatSearchQuery}
                  />
                  <button className="secondary-button" disabled={messageSearchBusy} type="submit">
                    {messageSearchBusy ? "Searching…" : "Search"}
                  </button>
                  {chatSearchResults.length > 0 ? (
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setChatSearchQuery("");
                        setChatSearchResults([]);
                      }}
                      type="button"
                    >
                      Clear
                    </button>
                  ) : null}
                </form>
                {typingByChat[selectedChat.id]?.length ? (
                  <div className="helper-text">
                    {typingByChat[selectedChat.id]
                      .map((userId) => userDirectory[userId]?.display_name ?? userDirectory[userId]?.username ?? "Someone")
                      .join(", ")}{" "}
                    typing…
                  </div>
                ) : null}
                {chatSearchResults.length > 0 ? (
                  <ul className="search-results">
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

              <form className="composer" onSubmit={handleMessageSubmit}>
                <textarea
                  className="text-area"
                  onBlur={stopTyping}
                  onChange={handleComposerChange}
                  placeholder="Write a message, mention someone with @username, or attach files"
                  value={composerText}
                />
                <div className="row wrap">
                  <label className="ghost-button" htmlFor="attachments">
                    Attach files
                  </label>
                  <input hidden id="attachments" multiple onChange={handleFileSelection} type="file" />
                  {pendingFiles.length > 0 ? (
                    <span className="helper-text">{pendingFiles.map((file) => file.name).join(", ")}</span>
                  ) : (
                    <span className="helper-text">Attachments use the backend presigned upload flow.</span>
                  )}
                </div>
                <div className="row wrap">
                  <button className="primary-button" disabled={!socketConnected || !!busyLabel} type="submit">
                    {busyLabel ?? "Send message"}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      setComposerText("");
                      setPendingFiles([]);
                      stopTyping();
                    }}
                    type="button"
                  >
                    Clear
                  </button>
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

        <aside className="panel details-panel">
          <div className="panel-header">
            <div className="brand">
              <h3>Profile, calls, topics, notifications</h3>
              <span className="muted">{unreadNotifications.length} unread notifications</span>
            </div>
          </div>
          <div className="panel-body stack">
            <form className="builder-card stack" onSubmit={handleProfileSubmit}>
              <h3 style={{ margin: 0 }}>Profile settings</h3>
              {profileAvatarPreviewUrl ? (
                <Image
                  alt="Profile avatar"
                  className="avatar-preview"
                  height={96}
                  src={profileAvatarPreviewUrl}
                  unoptimized
                  width={96}
                />
              ) : null}
              <input
                className="text-input"
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, display_name: event.target.value }))
                }
                placeholder="Display name"
                value={profileForm.display_name}
              />
              <textarea
                className="text-area"
                onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                placeholder="Bio"
                value={profileForm.bio}
              />
              <input
                className="text-input"
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, custom_status: event.target.value }))
                }
                placeholder="Custom status"
                value={profileForm.custom_status}
              />
              <select
                className="text-input"
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
              <input onChange={(event) => setProfileAvatarFile(event.target.files?.[0] ?? null)} type="file" />
              <button className="primary-button" disabled={!!busyLabel} type="submit">
                Save profile
              </button>
            </form>

            {selectedChat?.type === "supergroup" ? (
              <div className="builder-card stack">
                <h3 style={{ margin: 0 }}>Topics</h3>
                <input
                  className="text-input"
                  onChange={(event) => setNewTopicName(event.target.value)}
                  placeholder="New topic name"
                  value={newTopicName}
                />
                <input
                  className="text-input"
                  onChange={(event) => setNewTopicDescription(event.target.value)}
                  placeholder="Topic description"
                  value={newTopicDescription}
                />
                <button className="secondary-button" onClick={() => void createTopic()} type="button">
                  Create topic
                </button>
                <ul className="notification-list">
                  {selectedTopics.map((topic) => (
                    <li className="notification-card" key={topic.id}>
                      <div className="panel-body" style={{ padding: "12px 14px" }}>
                        <div className="chat-title-row">
                          <strong>{topic.name}</strong>
                          {topic.is_archived ? <span className="badge">archived</span> : null}
                        </div>
                        <div className="helper-text">{topic.description || "No description"}</div>
                        <div className="row wrap" style={{ marginTop: "10px" }}>
                          {!topic.is_archived ? (
                            <>
                              <button className="ghost-button" onClick={() => selectTopic(topic.id)} type="button">
                                View
                              </button>
                              <button className="ghost-button" onClick={() => void archiveTopic(topic.id)} type="button">
                                Archive
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {selectedChat?.type === "direct" ? (
              <div className="builder-card stack">
                <h3 style={{ margin: 0 }}>Call history</h3>
                {selectedCallHistory.length === 0 ? (
                  <div className="helper-text">No calls yet.</div>
                ) : (
                  <ul className="notification-list">
                    {selectedCallHistory.map((call) => (
                      <li className="notification-card" key={call.id}>
                        <div className="panel-body" style={{ padding: "12px 14px" }}>
                          <div className="chat-title-row">
                            <strong>
                              {call.type} · {call.status}
                            </strong>
                            <span className="muted">{formatDateLabel(call.started_at)}</span>
                          </div>
                          <div className="helper-text">
                            Duration: {call.duration_s ? `${call.duration_s}s` : "not established"}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            <div className="builder-card stack">
              <div className="row wrap">
                <h3 style={{ margin: 0 }}>Notifications</h3>
                <button
                  className="ghost-button"
                  disabled={unreadNotifications.length === 0}
                  onClick={() => void markAllNotificationsRead()}
                  type="button"
                >
                  Mark all read
                </button>
              </div>
              <div className="row wrap">
                <span className={`pill ${socketConnected ? "online" : ""}`}>
                  Backend: {API_BASE_URL.replace("/api/v1", "")}
                </span>
                <span className="pill">{notifications.length} total notifications</span>
              </div>
              {notifications.length === 0 ? (
                <div className="helper-text">No notifications yet.</div>
              ) : (
                <ul className="notification-list">
                  {notifications.map((notification) => (
                    <li className="notification-card" key={notification.id}>
                      <div className="panel-body" style={{ padding: "14px" }}>
                        <div className="notification-meta">
                          <strong>{notification.type.replaceAll("_", " ")}</strong>
                          <span className="muted">{formatDateLabel(notification.created_at)}</span>
                        </div>
                        <div className="helper-text">
                          {notification.payload.preview ??
                            notification.payload.chat_id ??
                            notification.payload.call_id ??
                            "Notification payload received."}
                        </div>
                        <div className="row wrap" style={{ marginTop: "12px" }}>
                          {notification.payload.chat_id ? (
                            <button
                              className="secondary-button"
                              onClick={() => setSelectedChatId(notification.payload.chat_id)}
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
          </div>
        </aside>
      </main>
    </>
  );
}
