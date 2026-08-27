import type { NextConfig } from "next";

function getCspOrigin(value: string | undefined) {
  if (!value) return undefined;

  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const mediaOrigins = Array.from(
  new Set([getCspOrigin(process.env.NEXT_PUBLIC_API_URL), getCspOrigin(process.env.R2_PUBLIC_URL)].filter(Boolean))
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

// Clerk serves user and organization images from img.clerk.com, and its bot
// protection on sign-up is Cloudflare Turnstile.
const clerkScriptSources = clerkOrigin ? [clerkOrigin, "https://challenges.cloudflare.com"] : [];
const clerkConnectSources = clerkOrigin ? [clerkOrigin] : [];
const clerkImageSources = clerkOrigin ? [clerkOrigin, "https://img.clerk.com"] : [];
const clerkFrameSources = clerkOrigin ? [clerkOrigin, "https://challenges.cloudflare.com"] : [];

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
              // 'unsafe-inline'/'unsafe-eval' are pre-existing and tracked as
              // S2-2 in docs/SECURITY_PLAN.md. Not widened here.
              ["script-src 'self' 'unsafe-inline' 'unsafe-eval'", ...clerkScriptSources].join(" "),
              "style-src 'self' 'unsafe-inline'",
              [
                `connect-src 'self' ${process.env.NEXT_PUBLIC_API_URL} ${process.env.NEXT_PUBLIC_WS_URL}`,
                ...clerkConnectSources,
              ].join(" "),
              [`img-src ${imageSources}`, ...clerkImageSources].join(" "),
              `media-src ${mediaSources}`,
              // Clerk instantiates web workers from blob: URLs; without this
              // they fall back to default-src 'self' and are blocked.
              "worker-src 'self' blob:",
              ...(clerkFrameSources.length ? [`frame-src 'self' ${clerkFrameSources.join(" ")}`] : []),
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
