"use client";

import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  type BackgroundThemeId,
  BACKGROUND_THEMES,
  getBackgroundTheme,
} from "@/store/backgroundTheme";

// ─── Geometric (Three.js) ────────────────────────────────────────────────────

function FloatingShape({
  position,
  rotation,
  scale,
  color,
  speed,
  geometry,
}: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  color: string;
  speed: number;
  geometry: "icosahedron" | "torus" | "octahedron";
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x += speed * 0.4;
    meshRef.current.rotation.y += speed * 0.6;
    meshRef.current.position.y =
      position[1] + Math.sin(state.clock.elapsedTime * speed + position[0]) * 0.3;
  });
  return (
    <mesh ref={meshRef} position={position} rotation={rotation} scale={scale}>
      {geometry === "icosahedron" && <icosahedronGeometry args={[1, 0]} />}
      {geometry === "torus" && <torusGeometry args={[1, 0.35, 6, 8]} />}
      {geometry === "octahedron" && <octahedronGeometry args={[1, 0]} />}
      <meshStandardMaterial color={color} wireframe opacity={0.35} transparent />
    </mesh>
  );
}

function GeometricScene() {
  const { pointer } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const shapes = useMemo(() => {
    const geometries = ["icosahedron", "torus", "octahedron"] as const;
    const colors = ["#9333ea", "#6366f1", "#0ea5e9", "#f59e0b", "#ec4899"];
    return Array.from({ length: 18 }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 6 - 4,
      ] as [number, number, number],
      rotation: [
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      ] as [number, number, number],
      scale: 0.3 + Math.random() * 0.7,
      color: colors[i % colors.length]!,
      speed: 0.003 + Math.random() * 0.007,
      geometry: geometries[i % geometries.length]!,
    }));
  }, []);
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += (pointer.x * 0.15 - groupRef.current.rotation.y) * 0.03;
    groupRef.current.rotation.x += (-pointer.y * 0.1 - groupRef.current.rotation.x) * 0.03;
  });
  return (
    <group ref={groupRef}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      {shapes.map((shape, i) => (
        <FloatingShape key={i} {...shape} />
      ))}
    </group>
  );
}

// ─── Emoji bouncing particles ─────────────────────────────────────────────────

interface Particle {
  id: number;
  emoji: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
}

function EmojiBackground({ emojis }: { emojis: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const spansRef = useRef<(HTMLSpanElement | null)[]>([]);

  const initialParticles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        id: i,
        emoji: emojis[i % emojis.length]!,
        x: 10 + Math.random() * 80,
        y: 10 + Math.random() * 80,
        vx: (Math.random() - 0.5) * 0.06,
        vy: (Math.random() - 0.5) * 0.06,
        size: 22 + Math.random() * 20,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 0.4,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emojis.join()]
  );

  const animate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const particles = particlesRef.current;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]!;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotationSpeed;

      // Bounce off edges (percentage-based, accounting for emoji size in %)
      const sizePercX = (p.size / container.clientWidth) * 100;
      const sizePercY = (p.size / container.clientHeight) * 100;

      if (p.x <= 0) { p.x = 0; p.vx = Math.abs(p.vx); }
      if (p.x >= 100 - sizePercX) { p.x = 100 - sizePercX; p.vx = -Math.abs(p.vx); }
      if (p.y <= 0) { p.y = 0; p.vy = Math.abs(p.vy); }
      if (p.y >= 100 - sizePercY) { p.y = 100 - sizePercY; p.vy = -Math.abs(p.vy); }

      const el = spansRef.current[i];
      if (el) {
        el.style.left = `${p.x}%`;
        el.style.top = `${p.y}%`;
        el.style.transform = `rotate(${p.rotation}deg)`;
      }
    }

    rafRef.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    particlesRef.current = initialParticles.map((p) => ({ ...p }));
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [initialParticles, animate]);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {initialParticles.map((p, i) => (
        <span
          key={p.id}
          ref={(el) => { spansRef.current[i] = el; }}
          className="absolute select-none"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            fontSize: `${p.size}px`,
            lineHeight: 1,
            willChange: "transform, left, top",
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AuthBackground() {
  const [themeId, setThemeId] = useState<BackgroundThemeId>("geometric");

  useEffect(() => {
    setThemeId(getBackgroundTheme());
    const handler = (e: Event) => setThemeId((e as CustomEvent<BackgroundThemeId>).detail);
    window.addEventListener("deco-bg-theme-change", handler);
    return () => window.removeEventListener("deco-bg-theme-change", handler);
  }, []);

  const theme = BACKGROUND_THEMES.find((t) => t.id === themeId);
  const emojis = theme?.emojis;

  if (emojis) {
    return <EmojiBackground emojis={emojis} />;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        dpr={[1, 1.5]}
        gl={{ antialias: false, alpha: true }}
        style={{ pointerEvents: "none" }}
      >
        <GeometricScene />
      </Canvas>
    </div>
  );
}
