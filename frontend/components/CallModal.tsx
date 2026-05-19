"use client";

import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface CallState {
  callId: string | null;
  callType: "audio" | "video";
  chatId: string;
  startedAt?: string;
  status: "incoming" | "ringing" | "active";
}

interface CallModalProps {
  incomingCall: CallState | null;
  activeCall: CallState | null;
  chatName: string;
  avatarUrl?: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  callError: string | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}

function useCallDuration(startedAt?: string) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return useMemo(() => {
    if (!startedAt) return "00:00";
    const diff = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [now, startedAt]);
}

export function CallModal({
  incomingCall,
  activeCall,
  chatName,
  avatarUrl,
  localStream,
  remoteStream,
  isMuted,
  isCameraOff,
  callError,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera,
}: CallModalProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const call = activeCall ?? incomingCall;
  const duration = useCallDuration(activeCall?.startedAt);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  if (!call) return null;

  const showVideo = call.callType === "video";
  const incoming = Boolean(incomingCall && !activeCall);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="relative flex h-full max-h-[720px] w-full max-w-5xl flex-col overflow-hidden rounded-[32px] border border-nc-border bg-nc-sidebar shadow-nc-glow-lg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(108,99,255,0.18),transparent_30%)]" />
        <div className="relative flex items-center justify-between border-b border-nc-border px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-nc-text">{chatName}</div>
            <div className="mt-1 text-sm text-nc-muted">
              {incoming ? "Incoming call" : activeCall?.status === "ringing" ? "Calling..." : duration}
            </div>
          </div>
          {callError && <div className="text-sm text-red-400">{callError}</div>}
        </div>

        <div className="relative flex flex-1 flex-col gap-4 p-6 md:flex-row">
          <div className="flex flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-nc-border bg-nc-surface">
            {showVideo && remoteStream ? (
              <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
            ) : (
              <CallAvatar avatarUrl={avatarUrl} chatName={chatName} subtitle={incoming ? "Incoming call" : "Connected"} />
            )}
          </div>
          <div className="flex w-full max-w-xs flex-col gap-4">
            <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-[28px] border border-nc-border bg-nc-surface2">
              {showVideo && localStream && !isCameraOff ? (
                <video ref={localVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              ) : (
                <CallAvatar avatarUrl={avatarUrl} chatName="You" subtitle={isMuted ? "Muted" : "Microphone on"} small />
              )}
            </div>
            <div className="rounded-[28px] border border-nc-border bg-nc-surface p-4 text-sm text-nc-muted">
              <div className="mb-1 text-xs uppercase tracking-widest text-nc-muted">Connection</div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${activeCall?.status === "active" ? "bg-emerald-400" : "bg-yellow-400"} animate-pulse`} />
                {activeCall?.status === "active" ? "Connected" : "Connecting..."}
              </div>
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-center gap-4 border-t border-nc-border px-6 py-5">
          {incoming ? (
            <>
              <CallActionButton color="red" onClick={onReject}>
                <PhoneOff size={22} />
                <span className="mt-1 text-[11px] font-medium">Decline</span>
              </CallActionButton>
              <CallActionButton color="green" onClick={onAccept}>
                {showVideo ? <Video size={22} /> : <Mic size={22} />}
                <span className="mt-1 text-[11px] font-medium">Accept</span>
              </CallActionButton>
            </>
          ) : (
            <>
              <ControlButton active={!isMuted} onClick={onToggleMute} label={isMuted ? "Unmute" : "Mute"}>
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </ControlButton>
              {showVideo && (
                <ControlButton active={!isCameraOff} onClick={onToggleCamera} label={isCameraOff ? "Cam On" : "Cam Off"}>
                  {isCameraOff ? <VideoOff size={18} /> : <Video size={18} />}
                </ControlButton>
              )}
              <CallActionButton color="red" onClick={onEnd}>
                <PhoneOff size={22} />
                <span className="mt-1 text-[11px] font-medium">End Call</span>
              </CallActionButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlButton({ children, active, onClick, label }: { children: React.ReactNode; active: boolean; onClick: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={`flex h-12 w-12 items-center justify-center rounded-full border transition-colors ${
          active
            ? "border-nc-primary/30 bg-nc-primary/15 text-nc-primary"
            : "border-nc-border bg-nc-surface text-nc-muted"
        }`}
      >
        {children}
      </button>
      <span className="text-[11px] text-nc-muted">{label}</span>
    </div>
  );
}

function CallActionButton({ children, color, onClick }: { children: React.ReactNode; color: "red" | "green"; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={`flex h-14 w-14 items-center justify-center rounded-full text-white transition-transform hover:scale-105 ${
          color === "red" ? "bg-red-500/90" : "bg-emerald-500"
        }`}
      >
        {children}
      </button>
    </div>
  );
}

function CallAvatar({ avatarUrl, chatName, subtitle, small }: { avatarUrl?: string | null; chatName: string; subtitle: string; small?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className={`overflow-hidden rounded-full border border-nc-primary/30 bg-nc-primary/15 shadow-nc-glow ${small ? "h-20 w-20" : "h-28 w-28"}`}>
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt={chatName} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-nc-primary">{chatName[0]}</div>
        )}
      </div>
      <div>
        <div className="text-lg font-semibold text-nc-text">{chatName}</div>
        <div className="mt-1 text-sm text-nc-muted">{subtitle}</div>
      </div>
    </div>
  );
}
