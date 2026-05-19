"use client";

import { Image as ImageIcon, Mic, Paperclip, Send, Smile, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { NcMessage } from "@/lib/nexchat-mock";
import { EmojiPicker } from "./EmojiPicker";
import { GifPicker } from "./GifPicker";

interface InputBarProps {
  onSend: (text: string) => void;
  onSendGif: (url: string) => void;
  onSendFiles: (files: File[]) => void;
  onSendVoice: (blob: Blob) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  replyTo: NcMessage | null;
  onCancelReply: () => void;
  emojiPickerOpen: boolean;
  emojiCategory: string;
  gifPickerOpen: boolean;
  gifSearchQuery: string;
  uploadProgress: { label: string; progress: number } | null;
  onToggleEmojiPicker: () => void;
  onEmojiCategoryChange: (category: string) => void;
  onGifSearchChange: (query: string) => void;
  onToggleGifPicker: () => void;
}

export function InputBar({
  onSend,
  onSendGif,
  onSendFiles,
  onSendVoice,
  onTypingStart,
  onTypingStop,
  replyTo,
  onCancelReply,
  emojiPickerOpen,
  emojiCategory,
  gifPickerOpen,
  gifSearchQuery,
  uploadProgress,
  onToggleEmojiPicker,
  onEmojiCategoryChange,
  onGifSearchChange,
  onToggleGifPicker,
}: InputBarProps) {
  const [value, setValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const typingTimeoutRef = useRef<number | null>(null);
  const recordingErrorTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    if (recordingErrorTimeoutRef.current) {
      window.clearTimeout(recordingErrorTimeoutRef.current);
    }
  }, []);

  const showRecordingError = (message: string) => {
    setRecordingError(message);
    if (recordingErrorTimeoutRef.current) {
      window.clearTimeout(recordingErrorTimeoutRef.current);
    }
    recordingErrorTimeoutRef.current = window.setTimeout(() => setRecordingError(null), 3000);
  };

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const resizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  };

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    resetTextareaHeight();
    onTypingStop();
  };

  const scheduleTypingStop = () => {
    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = window.setTimeout(() => onTypingStop(), 1600);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    resizeTextarea(e.target);
    onTypingStart();
    scheduleTypingStop();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = (emoji: string) => {
    setValue((current) => `${current}${emoji}`);
    window.requestAnimationFrame(() => {
      if (textareaRef.current) {
        resizeTextarea(textareaRef.current);
        textareaRef.current.focus();
      }
    });
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onSendFiles(files);
    event.target.value = "";
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      showRecordingError("Microphone requires HTTPS. Use https://localhost");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      showRecordingError("Microphone unavailable");
      return;
    }

    try {
      setRecordingError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
      const recorder = new MediaRecorder(stream, { mimeType });
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());
        setRecordingSeconds(0);
        if (blob.size > 0) onSendVoice(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission denied"
        : "Microphone unavailable";
      showRecordingError(message);
    }
  };

  const hasText = value.trim().length > 0;

  return (
    <div className="relative shrink-0 border-t border-nc-border bg-nc-sidebar px-4 py-2">
      {replyTo && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-2xl border border-nc-primary/25 bg-nc-primary/10 px-4 py-2 text-sm">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-nc-primary">Replying to {replyTo.senderName}</div>
            <div className="truncate text-nc-text">{replyTo.text || "Attachment"}</div>
          </div>
          <button type="button" onClick={onCancelReply} className="rounded-lg p-1 text-nc-muted hover:bg-nc-surface hover:text-nc-text">
            <X size={16} />
          </button>
        </div>
      )}

      {uploadProgress && (
        <div className="mb-2 rounded-2xl border border-nc-border bg-nc-surface px-4 py-2">
          <div className="flex items-center justify-between text-[12px] text-nc-muted">
            <span>{uploadProgress.label}</span>
            <span>{uploadProgress.progress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-nc-bg">
            <div className="h-full rounded-full bg-gradient-to-r from-nc-primary to-nc-primary-end transition-all" style={{ width: `${uploadProgress.progress}%` }} />
          </div>
        </div>
      )}

      <div className="relative flex min-h-[60px] items-center gap-3">
        <EmojiPicker
          open={emojiPickerOpen}
          activeCategory={emojiCategory}
          onCategoryChange={onEmojiCategoryChange}
          onSelect={insertEmoji}
        />
        <GifPicker open={gifPickerOpen} query={gifSearchQuery} onQueryChange={onGifSearchChange} onSelect={onSendGif} />

        <button type="button" aria-label="Emoji" onClick={onToggleEmojiPicker} className="shrink-0 text-nc-muted transition-colors duration-150 hover:text-nc-primary">
          <Smile size={22} />
        </button>
        <button type="button" aria-label="GIF" onClick={onToggleGifPicker} className="shrink-0 text-nc-muted transition-colors duration-150 hover:text-nc-primary">
          <ImageIcon size={22} />
        </button>
        <button type="button" aria-label="Attach file" onClick={() => fileInputRef.current?.click()} className="shrink-0 text-nc-muted transition-colors duration-150 hover:text-nc-primary">
          <Paperclip size={22} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,audio/*,.pdf,.zip,.rar,.7z,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
          className="hidden"
          onChange={handleFileSelection}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onBlur={onTypingStop}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "Recording voice message..." : "Message..."}
          rows={1}
          disabled={isRecording}
          className="scrollbar-hide flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-nc-text outline-none placeholder-nc-muted disabled:opacity-60"
        />

        {isRecording && (
          <div className="hidden items-center gap-2 rounded-full bg-red-500/10 px-3 py-1.5 text-xs text-red-400 sm:flex">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            {new Date(recordingSeconds * 1000).toISOString().slice(14, 19)}
          </div>
        )}

        {hasText ? (
          <button
            onClick={handleSend}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nc-primary text-white transition-all duration-150 hover:shadow-nc-hover"
          >
            <Send size={17} className="translate-x-px" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void toggleRecording()}
            aria-label="Voice message"
            className={`shrink-0 transition-colors duration-150 ${isRecording ? "text-red-400" : "text-nc-muted hover:text-nc-primary"}`}
          >
            <Mic size={22} />
          </button>
        )}
      </div>

      {recordingError && <div className="mt-2 text-xs text-red-400">{recordingError}</div>}
    </div>
  );
}
