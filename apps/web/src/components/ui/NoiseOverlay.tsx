export function NoiseOverlay() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.035] rounded-[inherit]"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <filter id="noise-filter">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.65"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#noise-filter)" />
    </svg>
  );
}
