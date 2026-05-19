"use client";

import { Bell, CheckCheck } from "lucide-react";

import type { NotificationItem } from "@/lib/types";

interface NotificationPanelProps {
  notifications: NotificationItem[];
  onOpenChat: (chatId: string) => void;
  onMarkAllRead: () => void;
}

function getPreview(notification: NotificationItem) {
  return (
    notification.payload.preview ??
    notification.payload.message ??
    notification.payload.chat_id ??
    notification.payload.call_id ??
    notification.type
  );
}

export function NotificationPanel({ notifications, onOpenChat, onMarkAllRead }: NotificationPanelProps) {
  const unread = notifications.filter((item) => !item.is_read).length;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden bg-nc-bg">
      <div className="flex items-center justify-between border-b border-nc-border px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-nc-text">Notifications</h2>
          <p className="mt-1 text-sm text-nc-muted">Stay on top of new activity.</p>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          className="inline-flex items-center gap-2 rounded-xl border border-nc-border bg-nc-surface px-4 py-2 text-sm text-nc-text transition-colors hover:border-nc-primary/40 hover:text-nc-primary"
        >
          <CheckCheck size={16} />
          Mark all read
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {notifications.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-nc-border bg-nc-surface px-6 text-center text-nc-muted">
            <Bell size={32} />
            <p>No notifications yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-widest text-nc-muted">{unread} unread</div>
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`rounded-2xl border px-4 py-3 ${
                  notification.is_read
                    ? "border-nc-border bg-nc-surface"
                    : "border-nc-primary/30 bg-nc-primary/10 shadow-nc-glow"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold capitalize text-nc-text">
                      {notification.type.replace(/[:_]/g, " ")}
                    </div>
                    <div className="mt-1 text-sm text-nc-muted">{getPreview(notification)}</div>
                  </div>
                  <div className="text-[11px] text-nc-muted">
                    {new Date(notification.created_at).toLocaleString()}
                  </div>
                </div>
                {notification.payload.chat_id && (
                  <button
                    type="button"
                    onClick={() => onOpenChat(notification.payload.chat_id)}
                    className="mt-3 rounded-xl bg-nc-surface2 px-3 py-2 text-xs font-medium text-nc-primary transition-colors hover:bg-nc-bg"
                  >
                    Open chat
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
