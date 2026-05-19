"use client";

import { LogOut, Save, Upload, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BUBBLE_COLOR_THEMES, WALLPAPERS, type BubbleColorTheme, type BubbleStyle, type ThemePreference } from "@/lib/appearance";
import type { User as UserType, UserStatus } from "@/lib/types";

interface SettingsPanelProps {
  user: UserType;
  saving: boolean;
  notice: string | null;
  theme: ThemePreference;
  wallpaperId: string;
  customWallpaperDataUrl: string;
  bubbleStyle: BubbleStyle;
  bubbleColorTheme: BubbleColorTheme;
  onLogout: () => void;
  onThemeChange: (theme: ThemePreference) => void;
  onWallpaperChange: (wallpaperId: string) => void;
  onCustomWallpaperChange: (dataUrl: string) => void;
  onBubbleStyleChange: (bubbleStyle: BubbleStyle) => void;
  onBubbleColorThemeChange: (colorTheme: BubbleColorTheme) => void;
  onSave: (payload: {
    display_name: string;
    bio: string;
    custom_status: string;
    status: UserStatus;
    avatarFile: File | null;
  }) => void;
}

export function SettingsPanel({
  user,
  saving,
  notice,
  theme,
  wallpaperId,
  customWallpaperDataUrl,
  bubbleStyle,
  bubbleColorTheme,
  onLogout,
  onThemeChange,
  onWallpaperChange,
  onCustomWallpaperChange,
  onBubbleStyleChange,
  onBubbleColorThemeChange,
  onSave,
}: SettingsPanelProps) {
  const [displayName, setDisplayName] = useState(user.display_name || "");
  const [bio, setBio] = useState(user.bio || "");
  const [customStatus, setCustomStatus] = useState(user.custom_status || "");
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayName(user.display_name || "");
    setBio(user.bio || "");
    setCustomStatus(user.custom_status || "");
    setStatus(user.status);
  }, [user]);

  useEffect(() => {
    if (!avatarFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(avatarFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [avatarFile]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-nc-bg">
      <div className="shrink-0 border-b border-nc-border px-6 pb-4 pt-6">
        <h2 className="text-xl font-bold text-nc-text">Settings</h2>
      </div>

      <div className="flex max-w-3xl flex-col gap-4 p-6">
        {notice && (
          <div className="rounded-2xl border border-nc-primary/25 bg-nc-primary/10 px-4 py-3 text-sm text-nc-text shadow-nc-glow">
            {notice}
          </div>
        )}
        <div className="rounded-2xl border border-nc-border bg-nc-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-nc-primary/30 bg-nc-primary/20 shadow-nc-glow">
              {previewUrl || user.display_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl ?? user.display_avatar_url ?? ""} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <User size={32} className="text-nc-primary" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-semibold text-nc-text">Profile picture</p>
              <p className="mt-1 text-[12px] text-nc-muted">Upload a new avatar or keep the current one.</p>
              <input type="file" accept="image/*" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} className="mt-3 block text-[12px] text-nc-muted file:mr-3 file:rounded-full file:border-0 file:bg-nc-primary/15 file:px-3 file:py-2 file:text-nc-primary" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-nc-border bg-nc-surface p-5">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-nc-text">Appearance</h3>
            <p className="mt-1 text-sm text-nc-muted">Customize the theme, wallpaper, and bubble style locally.</p>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">Theme</div>
              <div className="flex gap-2">
                <AppearanceButton active={theme === "dark"} onClick={() => onThemeChange("dark")}>Dark</AppearanceButton>
                <AppearanceButton active={theme === "light"} onClick={() => onThemeChange("light")}>Light</AppearanceButton>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">Wallpaper</div>
              <div className="flex flex-wrap gap-3">
                {WALLPAPERS.map((wallpaper) => {
                  const active = wallpaperId === wallpaper.id;
                  return (
                    <button
                      key={wallpaper.id}
                      type="button"
                      onClick={() => onWallpaperChange(wallpaper.id)}
                      className={`flex flex-col items-center gap-2 rounded-2xl border p-2 text-xs transition-colors ${active ? "border-nc-primary bg-nc-primary/10 text-nc-text" : "border-nc-border bg-nc-bg text-nc-muted hover:bg-nc-surface2"}`}
                    >
                      <span
                        className={`flex h-10 w-10 items-center justify-center rounded-xl border ${wallpaper.id === "none" ? "border-dashed border-nc-border bg-transparent text-nc-muted" : "border-transparent"}`}
                        style={wallpaper.value ? { backgroundImage: wallpaper.value, backgroundSize: "cover" } : undefined}
                      >
                        {wallpaper.id === "none" ? "—" : ""}
                      </span>
                      <span>{wallpaper.label}</span>
                    </button>
                  );
                })}

                {/* Custom wallpaper swatch — shown once uploaded */}
                {customWallpaperDataUrl && (
                  <button
                    type="button"
                    onClick={() => onWallpaperChange("custom")}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-2 text-xs transition-colors ${wallpaperId === "custom" ? "border-nc-primary bg-nc-primary/10 text-nc-text" : "border-nc-border bg-nc-bg text-nc-muted hover:bg-nc-surface2"}`}
                  >
                    <span
                      className="h-10 w-10 rounded-xl border border-transparent"
                      style={{ backgroundImage: `url("${customWallpaperDataUrl}")`, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                    <span>Custom</span>
                  </button>
                )}

                {/* Upload button */}
                <button
                  type="button"
                  onClick={() => wallpaperInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-nc-border bg-nc-bg p-2 text-xs text-nc-muted transition-colors hover:bg-nc-surface2 hover:text-nc-text"
                  title="Upload custom wallpaper"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl">
                    <Upload size={18} />
                  </span>
                  <span>Upload</span>
                </button>
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      if (dataUrl) onCustomWallpaperChange(dataUrl);
                    };
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">Bubble style</div>
              <div className="flex flex-wrap gap-2">
                <AppearanceButton active={bubbleStyle === "rounded"} onClick={() => onBubbleStyleChange("rounded")}>Rounded</AppearanceButton>
                <AppearanceButton active={bubbleStyle === "sharp"} onClick={() => onBubbleStyleChange("sharp")}>Sharp</AppearanceButton>
                <AppearanceButton active={bubbleStyle === "minimal"} onClick={() => onBubbleStyleChange("minimal")}>Minimal</AppearanceButton>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-nc-muted">Bubble color theme</div>
              <div className="flex flex-wrap gap-3">
                {BUBBLE_COLOR_THEMES.map((ct) => {
                  const active = bubbleColorTheme === ct.id;
                  return (
                    <button
                      key={ct.id}
                      type="button"
                      onClick={() => onBubbleColorThemeChange(ct.id)}
                      title={ct.label}
                      className={`flex flex-col items-center gap-1.5 rounded-2xl border p-2 text-xs transition-colors ${active ? "border-nc-primary bg-nc-primary/10 text-nc-text" : "border-nc-border bg-nc-bg text-nc-muted hover:bg-nc-surface2"}`}
                    >
                      <span
                        className="h-8 w-8 rounded-full shadow-sm"
                        style={{ background: `linear-gradient(135deg, ${ct.from} 0%, ${ct.to} 100%)` }}
                      />
                      <span className="text-[11px]">{ct.emoji} {ct.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Display name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" />
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary">
              <option value="online">Online</option>
              <option value="away">Away</option>
              <option value="do_not_disturb">Do not disturb</option>
              <option value="offline">Offline</option>
            </select>
          </Field>
        </div>

        <Field label="Bio">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" />
        </Field>

        <Field label="Custom status">
          <input value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} className="w-full rounded-2xl border border-nc-border bg-nc-surface px-4 py-3 text-sm text-nc-text outline-none focus:border-nc-primary" />
        </Field>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onSave({ display_name: displayName, bio, custom_status: customStatus, status, avatarFile })}
            disabled={saving}
            className="flex items-center gap-2 rounded-2xl bg-nc-primary px-5 py-3 text-sm font-semibold text-white shadow-nc-glow transition-all hover:shadow-nc-hover disabled:opacity-60"
          >
            <Save size={16} />
            {saving ? "Saving..." : "Save profile"}
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-3 rounded-2xl border border-red-400/20 px-5 py-3.5 text-red-400 transition-colors duration-150 hover:bg-red-400/10"
          >
            <LogOut size={18} />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function AppearanceButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-2 text-sm transition-colors ${active ? "border-nc-primary bg-nc-primary/10 text-nc-text" : "border-nc-border bg-nc-bg text-nc-muted hover:bg-nc-surface2"}`}
    >
      {children}
    </button>
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
