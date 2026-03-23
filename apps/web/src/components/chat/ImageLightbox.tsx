"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

interface Props {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
}

export function ImageLightbox({ src, alt, open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });

  // Pinch state
  const lastPinchDist = useRef<number | null>(null);
  const scaleRef = useRef(1);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setScale(1);
    setOffset({ x: 0, y: 0 });
    scaleRef.current = 1;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const clampScale = (s: number) => Math.min(Math.max(s, 1), 5);

  // Mouse wheel zoom
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const next = clampScale(scaleRef.current + delta);
    scaleRef.current = next;
    setScale(next);
    if (next === 1) setOffset({ x: 0, y: 0 });
  }

  // Mouse drag pan
  function handleMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    setOffset({
      x: offsetStart.current.x + e.clientX - dragStart.current.x,
      y: offsetStart.current.y + e.clientY - dragStart.current.y,
    });
  }, [offset]);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Touch pinch-to-zoom
  function getTouchDist(touches: React.TouchList) {
    const [a, b] = [touches[0]!, touches[1]!];
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      lastPinchDist.current = getTouchDist(e.touches);
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging.current = true;
      dragStart.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      offsetStart.current = { ...offset };
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    e.preventDefault();
    if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dist = getTouchDist(e.touches);
      const ratio = dist / lastPinchDist.current;
      const next = clampScale(scaleRef.current * ratio);
      scaleRef.current = next;
      setScale(next);
      lastPinchDist.current = dist;
      if (next === 1) setOffset({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && isDragging.current) {
      setOffset({
        x: offsetStart.current.x + e.touches[0]!.clientX - dragStart.current.x,
        y: offsetStart.current.y + e.touches[0]!.clientY - dragStart.current.y,
      });
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) lastPinchDist.current = null;
    if (e.touches.length === 0) isDragging.current = false;
  }

  function handleDoubleClick() {
    if (scale > 1) {
      scaleRef.current = 1;
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      scaleRef.current = 2.5;
      setScale(2.5);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onWheel={handleWheel}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Zoom hint */}
          {scale === 1 && (
            <p className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/60 backdrop-blur-sm select-none pointer-events-none">
              Scroll or pinch to zoom · Double-tap to zoom in
            </p>
          )}

          <motion.img
            src={src}
            alt={alt ?? "Image"}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain select-none"
            style={{
              transform: `scale(${scale}) translate(${offset.x / scale}px, ${offset.y / scale}px)`,
              cursor: scale > 1 ? "grab" : "zoom-in",
              touchAction: "none",
            }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            draggable={false}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
