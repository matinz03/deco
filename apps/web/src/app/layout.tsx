import { ClerkProvider } from "@clerk/nextjs";
import { ClerkBootstrapGate } from "@/components/auth/ClerkBootstrapGate";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Deco",
  description: "The universal messaging app",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Deco",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f0f0f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground`}>
        {/* afterSignOutUrl points at /sign-out, which clears the legacy
            bcrypt session as well. Clerk clears only its own, and proxy.ts
            accepts the legacy auth_token cookie, so without this a Clerk
            sign-out leaves the user stuck inside the app. */}
        <ClerkProvider afterSignOutUrl="/sign-out">
          <ClerkBootstrapGate />
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}