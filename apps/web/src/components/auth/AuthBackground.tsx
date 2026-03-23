"use client";

import { useRef, useMemo, useEffect, useState } from "react";
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

// ─── Emoji particles ─────────────────────────────────────────────────────────

function EmojiBackground({ emojis }: { emojis: string[] }) {
  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        emoji: emojis[i % emojis.length]!,
        left: Math.random() * 98,
        delay: Math.random() * 14,
        duration: 12 + Math.random() * 10,
        size: 18 + Math.random() * 22,
        drift: (Math.random() - 0.5) * 40,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emojis.join()]
  );

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute animate-emoji-float select-none"
          style={{
            left: `${p.left}%`,
            fontSize: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            marginLeft: `${p.drift}px`,
            bottom: "-10%",
            lineHeight: 1,
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
