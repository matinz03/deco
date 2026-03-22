"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useConversationStore } from "@/store/conversations";
import { EmojiPickerPanel } from "./EmojiPickerPanel";

interface Props { conversationId: string; }

export function MessageInput({ conversationId }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs so setTimeout/stop callbacks always read current values
  const videoModeRef = useRef(false);
  const isRecordingRef = useRef(false);

  const sendMessage = useConversationStore((s) => s.sendMessage);
  const sendTyping = useConversationStore((s) => s.sendTyping);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      sendTyping(conversationId, false);
    };
  }, [conversationId, sendTyping]);

  // Close emoji picker on outside click (but not on the emoji button/picker itself)
  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleDown(e: MouseEvent) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [showEmojiPicker]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      mediaRecorderRef.current?.stop();
    };
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    sendTyping(conversationId, false);
    setText("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    try {
      await sendMessage(conversationId, trimmed);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }, [text, sending, conversationId, sendMessage, sendTyping]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      const isTouchDevice = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
      if (!isTouchDevice) {
        e.preventDefault();
        void handleSend();
      }
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextText = e.target.value;
    setText(nextText);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    sendTyping(conversationId, nextText.trim().length > 0);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(conversationId, false);
    }, 1500);

    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  function insertEmoji(emoji: string) {
    const ta = textareaRef.current;
    if (!ta) { setText((prev) => prev + emoji); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + [...emoji].length;
      ta.focus();
    });
  }

  async function startRecording() {
    try {
      const constraints = videoModeRef.current
        ? { video: true, audio: true }
        : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = videoModeRef.current ? "video/webm" : "audio/webm";
        const blob = new Blob(chunks, { type });
        // TODO: send blob once backend supports media upload
        console.info("Recording ready:", blob.size, "bytes,", type);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((s) => s + 1),
        1000
      );
    } catch {
      // Permission denied or unsupported — fail silently
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setRecordingSeconds(0);
  }

  function handleMediaPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    holdTimerRef.current = setTimeout(() => void startRecording(), 350);
  }

  function handleMediaPointerUp() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isRecordingRef.current) {
      stopRecording();
    } else {
      // Quick tap → toggle voice / video mode
      const next = !videoModeRef.current;
      videoModeRef.current = next;
      setVideoMode(next);
    }
  }

  function handleMediaPointerLeave() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (isRecordingRef.current) stopRecording();
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="input-bar">
      <div className="input-field-wrap">
        {/* Attachment */}
        <button className="input-action" title="Attach file" aria-label="Attach file">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isRecording ? "" : "Message…"}
          className="input-field"
          disabled={isRecording}
        />

        {/* Emoji button + floating picker */}
        <div className="relative" ref={emojiWrapRef}>
          {showEmojiPicker && (
            <div className="absolute bottom-full right-0 mb-2 z-50 shadow-2xl rounded-2xl overflow-hidden">
              <EmojiPickerPanel onSelect={insertEmoji} />
            </div>
          )}
          <button
            className={`input-action ${showEmojiPicker ? "text-primary" : ""}`}
            title="Emoji"
            aria-label="Emoji"
            onClick={() => setShowEmojiPicker((v) => !v)}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z" />
            </svg>
          </button>
        </div>

        {/* Send / recording indicator / mic-camera toggle */}
        {text.trim() ? (
          <button
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
          <button
            className="input-action p-1.5 shrink-0 mb-0.5 text-red-500"
            title="Release to stop"
            onPointerUp={handleMediaPointerUp}
          >
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-medium tabular-nums">{fmt(recordingSeconds)}</span>
            </span>
          </button>
        ) : (
          <button
            className="input-action p-1.5 shrink-0 mb-0.5 select-none touch-none"
            title={videoMode
              ? "Hold to record video · Tap to switch to voice"
              : "Hold to record voice · Tap to switch to video"}
            aria-label={videoMode ? "Record video" : "Record voice"}
            onPointerDown={handleMediaPointerDown}
            onPointerUp={handleMediaPointerUp}
            onPointerLeave={handleMediaPointerLeave}
            onPointerCancel={handleMediaPointerLeave}
          >
            {videoMode ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
              </svg>
            )}
          </button>
        )}
      </div>

      <p className="input-hint">
        {isRecording
          ? videoMode ? "Release to stop recording video" : "Release to stop recording audio"
          : "End-to-end encrypted"}
      </p>
    </div>
  );
}
