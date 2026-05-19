"use client";

import { Crown, ImageIcon, Music, Shield, User as UserIcon, UserPlus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/api";
import { getAttachmentUrl } from "@/lib/nexchat-adapters";
import type { NcChat } from "@/lib/nexchat-mock";
import type { Chat, ChatMember, Message, User } from "@/lib/types";

const ROLE_ICON = {
  owner: Crown,
  admin: Shield,
  member: UserIcon,
} as const;

const MUTE_OPTIONS = [
  { label: "Unmute", value: 0 },
  { label: "1 hour", value: 60 },
  { label: "8 hours", value: 480 },
  { label: "1 week", value: 10080 },
  { label: "Forever (10 years)", value: 5256000 },
] as const;

type GroupSettingsTab = "settings" | "members" | "media";
type MediaAttachment = {
  key: string;
  attachment: Message["attachments"][number];
  url: string;
};

function ModalShell({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">{children}</div>;
}

function formatMuteStatus(mutedUntil?: string | null) {
  if (!mutedUntil) return "Notifications active";
  const mutedDate = new Date(mutedUntil);
  if (Number.isNaN(mutedDate.getTime()) || mutedDate.getTime() <= Date.now()) return "Notifications active";
  return `Muted until ${mutedDate.toLocaleString()}`;
}

function currentMuteOptionValue(mutedUntil?: string | null) {
  if (!mutedUntil) return 0;
  const diffMinutes = Math.max(0, Math.round((new Date(mutedUntil).getTime() - Date.now()) / 60000));
  if (diffMinutes <= 0) return 0;
  if (diffMinutes <= 60) return 60;
  if (diffMinutes <= 480) return 480;
  if (diffMinutes <= 10080) return 10080;
  return 5256000;
}

function isImageAttachment(attachment: Message["attachments"][number]) {
  return attachment.mime_type.startsWith("image/");
}

function isAudioAttachment(attachment: Message["attachments"][number]) {
  return attachment.mime_type.startsWith("audio/");
}

function collectMediaAttachments(
  messages: Message[],
  predicate: (attachment: Message["attachments"][number]) => boolean,
): MediaAttachment[] {
  return messages.flatMap((message) =>
    message.attachments
      .map((attachment) => {
        const url = getAttachmentUrl(attachment);
        if (!url || !predicate(attachment)) return null;
        return {
          key: `${message.id}:${attachment.id}`,
          attachment,
          url,
        };
      })
      .filter((item): item is MediaAttachment => item !== null),
  );
}

interface NewGroupModalProps {
  open: boolean;
  token: string;
  existingGroups: NcChat[];
  onClose: () => void;
  onCreated: (chat: Chat) => void;
}

export function NewGroupModal({ open, token, existingGroups, onClose, onCreated }: NewGroupModalProps) {
  const [mode, setMode] = useState<"group" | "supergroup">("group");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [selected, setSelected] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const users = await apiRequest<User[]>(`/users/search?q=${encodeURIComponent(query.trim())}`, { accessToken: token });
        setResults(users);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query, token]);

  useEffect(() => {
    if (mode !== "supergroup") {
      setParentId("");
    }
  }, [mode]);

  useEffect(() => {
    if (open) return;
    setMode("group");
    setName("");
    setDescription("");
    setParentId("");
    setQuery("");
    setResults([]);
    setSelected([]);
  }, [open]);

  if (!open) return null;

  const toggleUser = (user: User) => {
    setSelected((current) =>
      current.some((entry) => entry.id === user.id)
        ? current.filter((entry) => entry.id !== user.id)
        : [...current, user],
    );
  };

  const createGroup = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const chat = await apiRequest<Chat>(`/chats/${mode}`, {
        method: "POST",
        accessToken: token,
        body: {
          name: name.trim(),
          description: description.trim() || null,
          ...(mode === "supergroup" ? { parent_id: parentId || null } : {}),
        },
      });
      await Promise.all(
        selected.map((user) =>
          apiRequest(`/chats/${chat.id}/members`, {
            method: "POST",
            accessToken: token,
            body: { user_id: user.id },
          }),
        ),
      );
      onCreated(chat);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell>
      <div className="w-full max-w-2xl rounded-[28px] border border-nc-border bg-nc-sidebar shadow-nc-glow-lg">
        <div className="flex items-center justify-between border-b border-nc-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-nc-text">New Group</h3>
            <p className="text-sm text-nc-muted">Create a group or supergroup without touching the design.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-nc-muted hover:bg-nc-surface hover:text-nc-text">Close</button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="inline-flex rounded-full bg-nc-surface p-1">
              {(["group", "supergroup"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  className={`rounded-full px-4 py-2 text-sm capitalize transition-colors ${
                    mode === option ? "bg-nc-primary text-white" : "text-nc-muted"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" placeholder="Team Launch" />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" placeholder="What is this group about?" />
            </Field>
            {mode === "supergroup" ? (
              <Field label="Parent Group (optional)">
                <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary">
                  <option value="">None (standalone supergroup)</option>
                  {existingGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <div className="space-y-4">
            <Field label="Add members">
              <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" placeholder="Search users" />
            </Field>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {results.map((user) => {
                const active = selected.some((entry) => entry.id === user.id);
                return (
                  <button key={user.id} type="button" onClick={() => toggleUser(user)} className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition-colors ${active ? "border-nc-primary/30 bg-nc-primary/10" : "border-nc-border bg-nc-surface hover:bg-nc-surface2"}`}>
                    <div>
                      <div className="text-sm font-medium text-nc-text">{user.display_name || user.username}</div>
                      <div className="text-xs text-nc-muted">@{user.username}</div>
                    </div>
                    <UserPlus size={16} className={active ? "text-nc-primary" : "text-nc-muted"} />
                  </button>
                );
              })}
            </div>
            <div className="rounded-2xl border border-nc-border bg-nc-surface p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-nc-text"><Users size={16} /> Members</div>
              <div className="flex flex-wrap gap-2">
                {selected.length === 0 ? <span className="text-sm text-nc-muted">No members added yet.</span> : selected.map((user) => <span key={user.id} className="rounded-full bg-nc-bg px-3 py-1 text-xs text-nc-text">{user.display_name || user.username}</span>)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-nc-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-2xl border border-nc-border px-4 py-2.5 text-sm text-nc-muted hover:bg-nc-surface">Cancel</button>
          <button type="button" onClick={() => void createGroup()} disabled={saving || !name.trim()} className="rounded-2xl bg-nc-primary px-4 py-2.5 text-sm font-semibold text-white shadow-nc-glow disabled:opacity-60">{saving ? "Creating..." : mode === "supergroup" ? "Create supergroup" : "Create group"}</button>
        </div>
      </div>
    </ModalShell>
  );
}

interface GroupSettingsModalProps {
  open: boolean;
  token: string;
  chat: Chat | null;
  members: ChatMember[];
  currentUserId: string;
  onClose: () => void;
  onUpdated: (chat: Chat) => void;
  onMembersChanged: () => void;
}

export function GroupSettingsModal({ open, token, chat, members, currentUserId, onClose, onUpdated, onMembersChanged }: GroupSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<GroupSettingsTab>("settings");
  const [name, setName] = useState(chat?.name ?? "");
  const [description, setDescription] = useState(chat?.description ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [busy, setBusy] = useState(false);
  const [onlyAdminsCanWrite, setOnlyAdminsCanWrite] = useState(chat?.only_admins_can_write ?? false);
  const [mediaMessages, setMediaMessages] = useState<Message[]>([]);
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    setName(chat?.name ?? "");
    setDescription(chat?.description ?? "");
    setOnlyAdminsCanWrite(chat?.only_admins_can_write ?? false);
    setQuery("");
    setResults([]);
    setMediaMessages([]);
    setActiveTab("settings");
  }, [chat]);

  useEffect(() => {
    if (!open || activeTab !== "members" || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const users = await apiRequest<User[]>(`/users/search?q=${encodeURIComponent(query.trim())}`, { accessToken: token });
        setResults(users.filter((user) => !members.some((member) => member.user_id === user.id)));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeTab, members, open, query, token]);

  useEffect(() => {
    if (!open || activeTab !== "media" || !chat) return;
    setLoadingMedia(true);
    apiRequest<Message[]>(`/chats/${chat.id}/messages?limit=200`, { accessToken: token })
      .then((messages) => setMediaMessages(messages ?? []))
      .catch(() => setMediaMessages([]))
      .finally(() => setLoadingMedia(false));
  }, [activeTab, chat, open, token]);

  const myMember = useMemo(() => members.find((member) => member.user_id === currentUserId) ?? null, [currentUserId, members]);
  const myRole = myMember?.role ?? "member";
  const canManage = myRole === "owner" || myRole === "admin";
  const imageAttachments = useMemo(() => collectMediaAttachments(mediaMessages, isImageAttachment), [mediaMessages]);
  const audioAttachments = useMemo(() => collectMediaAttachments(mediaMessages, isAudioAttachment), [mediaMessages]);

  if (!open || !chat) return null;

  const saveChat = async () => {
    setBusy(true);
    try {
      const updated = await apiRequest<Chat>(`/chats/${chat.id}`, {
        method: "PATCH",
        accessToken: token,
        body: { name: name.trim() || null, description: description.trim() || null },
      });
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const updateMute = async (durationMinutes: number) => {
    setBusy(true);
    try {
      await apiRequest(`/chats/${chat.id}/members/me/mute`, {
        method: "POST",
        accessToken: token,
        body: { duration_minutes: durationMinutes },
      });
      await onMembersChanged();
    } finally {
      setBusy(false);
    }
  };

  const updateOnlyAdmins = async (enabled: boolean) => {
    setBusy(true);
    try {
      const updated = await apiRequest<Chat>(`/chats/${chat.id}`, {
        method: "PATCH",
        accessToken: token,
        body: { only_admins_can_write: enabled },
      });
      setOnlyAdminsCanWrite(updated.only_admins_can_write ?? enabled);
      onUpdated(updated);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (userId: string) => {
    setBusy(true);
    try {
      await apiRequest(`/chats/${chat.id}/members`, { method: "POST", accessToken: token, body: { user_id: userId } });
      await onMembersChanged();
      setQuery("");
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    try {
      await apiRequest(`/chats/${chat.id}/members/${userId}`, { method: "DELETE", accessToken: token });
      await onMembersChanged();
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, role: "admin" | "member") => {
    setBusy(true);
    try {
      await apiRequest(`/chats/${chat.id}/members/${userId}`, { method: "PATCH", accessToken: token, body: { role } });
      await onMembersChanged();
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: GroupSettingsTab; label: string }> = [
    { id: "settings", label: "Settings" },
    { id: "members", label: "Members" },
    { id: "media", label: "Media" },
  ];

  return (
    <ModalShell>
      <div className="w-full max-w-3xl rounded-[28px] border border-nc-border bg-nc-sidebar shadow-nc-glow-lg">
        <div className="flex items-center justify-between border-b border-nc-border px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-nc-text">Group Settings</h3>
            <p className="text-sm text-nc-muted">Manage members, roles, details and shared media.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-nc-muted hover:bg-nc-surface hover:text-nc-text">Close</button>
        </div>
        <div className="border-b border-nc-border px-5 py-4">
          <div className="inline-flex rounded-full bg-nc-surface p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  activeTab === tab.id ? "bg-nc-primary text-white" : "text-nc-muted"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "settings" ? (
          <div className="space-y-4 p-5">
            <Field label="Group name">
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary disabled:opacity-60" />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage} rows={4} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary disabled:opacity-60" />
            </Field>

            <div className="rounded-2xl border border-nc-border bg-nc-surface p-4">
              <div className="mb-3 text-sm font-semibold text-nc-text">Group Settings</div>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-nc-muted">Mute notifications</label>
                  <select
                    value={String(currentMuteOptionValue(myMember?.muted_until))}
                    onChange={(event) => void updateMute(Number(event.target.value))}
                    disabled={busy}
                    className="w-full rounded-2xl border border-nc-border bg-nc-bg px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary disabled:opacity-60"
                  >
                    {MUTE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="mt-2 text-xs text-nc-muted">{formatMuteStatus(myMember?.muted_until)}</div>
                </div>

                {canManage ? (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-nc-border bg-nc-bg px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-nc-text">Only admins can write</div>
                      <div className="mt-1 text-xs text-nc-muted">Restrict sending messages to owners and admins only.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void updateOnlyAdmins(!onlyAdminsCanWrite)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${onlyAdminsCanWrite ? "bg-nc-primary" : "bg-nc-border"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${onlyAdminsCanWrite ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <button type="button" onClick={() => void saveChat()} disabled={!canManage || busy} className="w-full rounded-2xl bg-nc-primary px-4 py-3 text-sm font-semibold text-white shadow-nc-glow disabled:opacity-60">Save changes</button>
          </div>
        ) : null}

        {activeTab === "members" ? (
          <div className="grid gap-5 p-5 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="space-y-4">
              <Field label="Add member">
                <input value={query} onChange={(e) => setQuery(e.target.value)} disabled={!canManage} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary disabled:opacity-60" placeholder="Search users" />
              </Field>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {results.map((user) => (
                  <button key={user.id} type="button" disabled={!canManage || busy} onClick={() => void addMember(user.id)} className="flex w-full items-center justify-between rounded-2xl border border-nc-border bg-nc-surface px-3 py-2 text-left transition-colors hover:bg-nc-surface2 disabled:opacity-60">
                    <div>
                      <div className="text-sm font-medium text-nc-text">{user.display_name || user.username}</div>
                      <div className="text-xs text-nc-muted">@{user.username}</div>
                    </div>
                    <UserPlus size={16} className="text-nc-primary" />
                  </button>
                ))}
                {!canManage ? <p className="text-sm text-nc-muted">Only owners and admins can manage members.</p> : null}
              </div>
            </div>
            <div className="rounded-3xl border border-nc-border bg-nc-surface p-4">
              <div className="mb-3 text-sm font-semibold text-nc-text">Members</div>
              <div className="space-y-2">
                {members.map((member) => {
                  const Icon = ROLE_ICON[member.role];
                  const isSelf = member.user_id === currentUserId;
                  return (
                    <div key={member.user_id} className="rounded-2xl border border-nc-border bg-nc-bg px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-nc-text">{member.display_name || member.username || member.user_id}</div>
                          <div className="mt-1 flex items-center gap-1 text-xs capitalize text-nc-muted"><Icon size={12} /> {member.role}</div>
                        </div>
                        {!isSelf && canManage ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            {myRole === "owner" && member.role !== "owner" ? (
                              <button type="button" onClick={() => void changeRole(member.user_id, member.role === "admin" ? "member" : "admin")} className="rounded-xl bg-nc-surface2 px-3 py-1.5 text-xs text-nc-primary">
                                {member.role === "admin" ? "Demote" : "Promote"}
                              </button>
                            ) : null}
                            {member.role !== "owner" ? (
                              <button type="button" onClick={() => void removeMember(member.user_id)} className="rounded-xl bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "media" ? (
          <div className="space-y-6 p-5">
            {loadingMedia ? <p className="text-sm text-nc-muted">Loading shared media…</p> : null}

            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-nc-text">
                <ImageIcon size={14} /> Images ({imageAttachments.length})
              </div>
              {imageAttachments.length === 0 ? (
                <p className="text-sm text-nc-muted">No images shared yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {imageAttachments.map((item) => (
                    <a key={item.key} href={item.url} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-2xl border border-nc-border bg-nc-surface">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.url} alt={item.attachment.file_name} className="h-full w-full object-cover transition-opacity hover:opacity-80" />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-nc-text">
                <Music size={14} /> Audio/Music ({audioAttachments.length})
              </div>
              {audioAttachments.length === 0 ? (
                <p className="text-sm text-nc-muted">No audio shared yet.</p>
              ) : (
                <div className="space-y-2">
                  {audioAttachments.map((item) => (
                    <div key={item.key} className="flex flex-col gap-3 rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Music size={16} className="shrink-0 text-nc-primary" />
                        <span className="truncate text-sm text-nc-text">{item.attachment.file_name || "Audio file"}</span>
                      </div>
                      <audio controls src={item.url} className="h-10 w-full sm:w-64" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">{label}</div>
      {children}
    </label>
  );
}
