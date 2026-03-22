"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import type { MessageType } from "@deco/types";
import { useConversationStore } from "@/store/conversations";
import { EmojiPickerPanel } from "./EmojiPickerPanel";

interface Props {
  conversationId: string;
}

type AttachmentAction = {
  label: string;
  kind?: "image" | "video" | "file" | "audio";
  icon: ReactNode;
  enabled: boolean;
};

const attachmentActions: AttachmentAction[] = [
  {
    label: "Pictures",
    kind: "image",
    enabled: true,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75V6A2.25 2.25 0 0 1 4.5 3.75h15A2.25 2.25 0 0 1 21.75 6v12a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 18v-2.25Zm0 0 4.72-4.72a.75.75 0 0 1 1.06 0l4.72 4.72m0 0 1.78-1.78a.75.75 0 0 1 1.06 0l4.72 4.72M15 8.25h.008v.008H15V8.25Z" />
      </svg>
    ),
  },
  {
    label: "Videos",
    kind: "video",
    enabled: true,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75Z" />
      </svg>
    ),
  },
  {
    label: "Files",
    kind: "file",
    enabled: true,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h10.5A2.25 2.25 0 0 0 19.5 19.5v-5.25Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 2.25v4.5A1.5 1.5 0 0 0 15 8.25h4.5" />
      </svg>
    ),
  },
  {
    label: "Music",
    kind: "audio",
    enabled: true,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 18V5.25l10.5-2.25V15M9 18a2.25 2.25 0 1 1-4.5 0A2.25 2.25 0 0 1 9 18Zm10.5-3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    label: "Location",
    enabled: false,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-6.75-5.625-6.75-11.25a6.75 6.75 0 1 1 13.5 0C18.75 15.375 12 21 12 21Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      </svg>
    ),
  },
  {
    label: "Contacts",
    enabled: false,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372c1.035 0 2.03-.166 2.962-.472A17.94 17.94 0 0 0 18 12.75a17.94 17.94 0 0 0-2.588 6.378ZM15 19.128A17.953 17.953 0 0 1 12 19.5c-1.033 0-2.046-.087-3-.255M15 19.128a17.944 17.944 0 0 0-3-6.378m0 0A17.945 17.945 0 0 0 9 19.245m3-6.495a17.944 17.944 0 0 1 3-6.378m-3 6.378a17.944 17.944 0 0 0-3-6.378M12 4.5a17.944 17.944 0 0 1 3 6.372M12 4.5a17.944 17.944 0 0 0-3 6.372m6 0A17.943 17.943 0 0 0 12 10.5m0 0A17.943 17.943 0 0 0 9 10.872" />
      </svg>
    ),
  },
  {
    label: "Poll",
    enabled: false,
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25h16.5M3.75 12h10.5M3.75 18.75h6.75" />
      </svg>
    ),
  },
];

export function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoModeRef = useRef(false);
  const isRecordingRef = useRef(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendMessage = useConversationStore((s) => s.sendMessage);
  const sendMediaMessage = useConversationStore((s) => s.sendMediaMessage);
  const sendTyping = useConversationStore((s) => s.sendTyping);

  const hint = useMemo(() => {
    if (isRecording) {
      return videoMode ? "Release to send your video" : "Release to send your voice note";
    }
    return "End-to-end encrypted";
  }, [isRecording, videoMode]);

  useEffect(() => {
    videoModeRef.current = videoMode;
  }, [videoMode]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      sendTyping(conversationId, false);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    };
  }, [conversationId, sendTyping]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleOutside = (event: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showEmojiPicker]);

  useEffect(() => {
    if (!showAttachmentMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (attachmentMenuRef.current && !attachmentMenuRef.current.contains(event.target as Node)) {
        setShowAttachmentMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showAttachmentMenu]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    clearTypingState(typingTimeoutRef, sendTyping, conversationId);
    setText("");
    setShowEmojiPicker(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await sendMessage(conversationId, trimmed);
    } finally {
      setSending(false);
    }
  }, [conversationId, sendMessage, sendTyping, sending, text]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      const isTouchDevice = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      if (!isTouchDevice) {
        event.preventDefault();
        void handleSend();
      }
    }
  }

  function handleInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextText = event.target.value;
    setText(nextText);
    queueTypingUpdate(nextText, typingTimeoutRef, sendTyping, conversationId);

    const textarea = event.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  }

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      const nextText = `${text}${emoji}`;
      setText(nextText);
      queueTypingUpdate(nextText, typingTimeoutRef, sendTyping, conversationId);
      return;
    }

    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? text.length;
    const nextText = text.slice(0, start) + emoji + text.slice(end);
    setText(nextText);
    queueTypingUpdate(nextText, typingTimeoutRef, sendTyping, conversationId);

    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + [...emoji].length;
      textarea.focus();
    });
  }

  async function handleAttachmentSelected(file: File, type: Extract<MessageType, "image" | "video" | "audio" | "file">) {
    setShowAttachmentMenu(false);
    setSending(true);
    clearTypingState(typingTimeoutRef, sendTyping, conversationId);

    try {
      const previewUrl = type === "image" || type === "video" || type === "audio" ? URL.createObjectURL(file) : undefined;
      await sendMediaMessage(conversationId, {
        type,
        file,
        fileName: file.name,
        mimeType: file.type || fallbackMimeForType(type),
        caption: text.trim(),
        previewUrl,
      });
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    } finally {
      setSending(false);
    }
  }

  async function handleFileInput(type: Extract<MessageType, "image" | "video" | "audio" | "file">, files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    await handleAttachmentSelected(file, type);
  }

  async function startRecording() {
    try {
      const constraints = videoModeRef.current ? { video: true, audio: true } : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const isVideo = videoModeRef.current;
        const mimeType = recorder.mimeType || (isVideo ? "video/webm" : "audio/webm");
        const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunks, { type: mimeType });
        void handleRecordingFinished(blob, isVideo ? "video" : "audio", `recording-${Date.now()}.${extension}`);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    } catch {
      setIsRecording(false);
    }
  }

  async function handleRecordingFinished(
    blob: Blob,
    type: Extract<MessageType, "video" | "audio">,
    fileName: string
  ) {
    setSending(true);
    clearTypingState(typingTimeoutRef, sendTyping, conversationId);

    try {
      const previewUrl = URL.createObjectURL(blob);
      await sendMediaMessage(conversationId, {
        type,
        file: blob,
        fileName,
        mimeType: blob.type || fallbackMimeForType(type),
        caption: text.trim(),
        previewUrl,
      });
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.focus();
      }
    } finally {
      setSending(false);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingSeconds(0);
  }

  function handleMediaPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    holdTimerRef.current = setTimeout(() => {
      void startRecording();
    }, 350);
  }

  function handleMediaPointerUp() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (isRecordingRef.current) {
      stopRecording();
      return;
    }

    setVideoMode((value) => !value);
  }

  function handleMediaPointerLeave() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isRecordingRef.current) {
      stopRecording();
    }
  }

  return (
    <div className="input-bar">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handleFileInput("image", event.target.files)}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => void handleFileInput("video", event.target.files)}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => void handleFileInput("file", event.target.files)}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => void handleFileInput("audio", event.target.files)}
      />

      <div className="input-field-wrap">
        <div className="relative" ref={attachmentMenuRef}>
          <button
            className="input-action"
            title="Attach"
            aria-label="Attach"
            onClick={() => {
              setShowAttachmentMenu((value) => !value);
              setShowEmojiPicker(false);
            }}
            disabled={sending || isRecording}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
            </svg>
          </button>

          <AnimatePresence>
            {showAttachmentMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
                className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-2xl border border-sidebar bg-surface shadow-2xl"
              >
                <div className="border-b border-sidebar px-4 py-3">
                  <p className="text-sm font-semibold">Share something</p>
                  <p className="text-xs text-muted">Uploads, recordings, and more from one place.</p>
                </div>
                <div className="grid grid-cols-2 gap-2 p-3">
                  {attachmentActions.map((action, index) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled={!action.enabled || sending}
                      onClick={() => {
                        if (!action.enabled || !action.kind) return;
                        if (action.kind === "image") imageInputRef.current?.click();
                        if (action.kind === "video") videoInputRef.current?.click();
                        if (action.kind === "file") fileInputRef.current?.click();
                        if (action.kind === "audio") audioInputRef.current?.click();
                      }}
                      className={`flex min-h-[86px] flex-col items-start justify-between rounded-2xl border px-3 py-3 text-left transition-colors ${
                        action.enabled
                          ? "border-sidebar bg-background/60 hover:bg-accent"
                          : "border-sidebar/50 bg-muted/50 text-muted"
                      }`}
                    >
                      <motion.span
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className="rounded-xl bg-muted p-2"
                      >
                        {action.icon}
                      </motion.span>
                      <span className="text-sm font-medium">
                        {action.label}
                        {!action.enabled && <span className="block text-xs font-normal text-muted">Soon</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "" : "Message..."}
          className="input-field"
          disabled={isRecording || sending}
        />

        <div className="relative" ref={emojiWrapRef}>
          {showEmojiPicker && (
            <div className="absolute bottom-full right-0 z-50 mb-2 overflow-hidden rounded-2xl shadow-2xl">
              <EmojiPickerPanel onSelect={insertEmoji} />
            </div>
          )}
          <button
            className={`input-action ${showEmojiPicker ? "text-primary" : ""}`}
            title="Emoji"
            aria-label="Emoji"
            onClick={() => {
              setShowEmojiPicker((value) => !value);
              setShowAttachmentMenu(false);
            }}
            disabled={sending || isRecording}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
            </svg>
          </button>
        </div>

        {text.trim() ? (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
            disabled={sending}
            className="send-btn"
            title="Send"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
            </svg>
          </button>
        ) : isRecording ? (
          <button className="input-action p-1.5 text-red-500" title="Release to send" onPointerUp={handleMediaPointerUp}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium tabular-nums">{formatDuration(recordingSeconds)}</span>
            </span>
          </button>
        ) : (
          <button
            className="input-action p-1.5 select-none touch-none"
            title={videoMode ? "Hold to record video. Tap to switch to voice." : "Hold to record voice. Tap to switch to video."}
            aria-label={videoMode ? "Record video" : "Record voice"}
            onPointerDown={handleMediaPointerDown}
            onPointerUp={handleMediaPointerUp}
            onPointerLeave={handleMediaPointerLeave}
            onPointerCancel={handleMediaPointerLeave}
            disabled={sending}
          >
            {videoMode ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9A2.25 2.25 0 0 0 13.5 5.25h-9A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75Z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            )}
          </button>
        )}
      </div>

      <p className="input-hint">{hint}</p>
    </div>
  );
}

function queueTypingUpdate(
  text: string,
  timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  sendTyping: (conversationId: string, isTyping: boolean) => void,
  conversationId: string
) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
  }

  sendTyping(conversationId, text.trim().length > 0);
  timeoutRef.current = setTimeout(() => {
    sendTyping(conversationId, false);
  }, 1500);
}

function clearTypingState(
  timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  sendTyping: (conversationId: string, isTyping: boolean) => void,
  conversationId: string
) {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
  sendTyping(conversationId, false);
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function fallbackMimeForType(type: Extract<MessageType, "image" | "video" | "audio" | "file">) {
  switch (type) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/webm";
    case "audio":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}
