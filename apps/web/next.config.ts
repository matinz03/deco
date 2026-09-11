import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? (isDev ? "http://localhost:8080" : "");
const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? (isDev ? "ws://localhost:8080" : "");

if (!isDev && (!process.env.NEXT_PUBLIC_API_URL || !process.env.NEXT_PUBLIC_WS_URL)) {
  throw new Error(
    "NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL must be set at build time for production; both are baked into the CSP."
  );
}

function getCspOrigin(value: string | undefined) {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const mediaOrigins = Array.from(
  new Set([
    getCspOrigin(process.env.NEXT_PUBLIC_API_URL),
    getCspOrigin(process.env.NEXT_PUBLIC_MEDIA_URL),
    getCspOrigin(process.env.R2_PUBLIC_URL),
  ].filter(Boolean))
);
const imageSources = ["'self'", "blob:", "data:", ...mediaOrigins].join(" ");
const mediaSources = ["'self'", "blob:", ...mediaOrigins].join(" ");

/**
 * Clerk's frontend API origin, decoded from the publishable key.
 *
 * The key is `pk_test_<base64(host + "$")>` / `pk_live_<...>`, so the host is
 * derivable and there is no second env var to drift out of sync with the key.
 * Returns undefined when Clerk is not configured, which leaves the CSP exactly
 * as it was.
 *
 * Without this, clerk.browser.js is blocked by `script-src 'self'` and Clerk
 * fails with `failed_to_load_clerk_js`. The build and type-check both pass in
 * that state — it is only visible in a browser.
 */
function getClerkOrigin() {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return undefined;

  const encoded = key.replace(/^pk_(test|live)_/, "");
  try {
    const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : undefined;
  } catch {
    return undefined;
  }
}

const clerkOrigin = getClerkOrigin();
const clerkProtectionOrigin = "https://*.protect.clerk.com";

// Clerk serves user and organization images from img.clerk.com, and its bot
// protection on sign-up is Cloudflare Turnstile.
const clerkScriptSources = clerkOrigin
  ? [clerkOrigin, "https://challenges.cloudflare.com", clerkProtectionOrigin]
  : [];
const clerkConnectSources = clerkOrigin ? [clerkOrigin, `${clerkProtectionOrigin}:*`] : [];
const clerkImageSources = clerkOrigin ? [clerkOrigin, "https://img.clerk.com"] : [];
const clerkFrameSources = clerkOrigin
  ? [clerkOrigin, "https://challenges.cloudflare.com", clerkProtectionOrigin]
  : [];

const nextConfig: NextConfig = {
  // Enable React strict mode for catching bugs early
  reactStrictMode: true,

  // Required for Docker: produces a self-contained server.js
  output: "standalone",

  // Transpile shared workspace packages
  transpilePackages: ["@deco/ui", "@deco/crypto", "@deco/types"],

  // Image optimization — allow your own domain + R2 CDN
  images: {
    remotePatterns: process.env.R2_PUBLIC_URL
      ? [{ protocol: "https" as const, hostname: process.env.R2_PUBLIC_URL.replace(/^https?:\/\//, "") }]
      : [],
  },

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js App Router and Clerk still require unsafe-inline unless
              // the app moves to per-request nonces. Turbopack requires
              // unsafe-eval only for development; production must omit it.
              [
                isDev
                  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
                  : "script-src 'self' 'unsafe-inline'",
                ...clerkScriptSources,
              ].join(" "),
              "style-src 'self' 'unsafe-inline'",
              [
                `connect-src 'self' ${apiUrl} ${wsUrl}`.trim(),
                ...mediaOrigins,
                ...clerkConnectSources,
              ].join(" "),
              [`img-src ${imageSources}`, ...clerkImageSources].join(" "),
              `media-src ${mediaSources}`,
              // Clerk instantiates web workers from blob: URLs; without this
              // they fall back to default-src 'self' and are blocked.
              "worker-src 'self' blob:",
              [`frame-src 'self'`, ...clerkFrameSources].join(" "),
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
