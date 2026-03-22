import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        "surface-raised": "hsl(var(--surface-raised))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-fg))",
        },
        sidebar: "hsl(var(--sidebar))",
        nav: "hsl(var(--nav))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "bubble-in-sent": {
          from: { opacity: "0", transform: "translateX(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "bubble-in-received": {
          from: { opacity: "0", transform: "translateX(-6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateX(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.12s ease-out",
        "bubble-in-sent": "bubble-in-sent 0.15s ease-out",
        "bubble-in-received": "bubble-in-received 0.15s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
