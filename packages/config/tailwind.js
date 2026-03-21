/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
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
        ring: "hsl(var(--ring))",
        // Chat-specific tokens
        bubble: {
          sent: "hsl(var(--bubble-sent))",
          "sent-fg": "hsl(var(--bubble-sent-foreground))",
          received: "hsl(var(--bubble-received))",
          "received-fg": "hsl(var(--bubble-received-foreground))",
        },
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
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "bubble-in-sent": {
          from: { opacity: "0", transform: "translateX(8px) scale(0.97)" },
          to: { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        "bubble-in-received": {
          from: { opacity: "0", transform: "translateX(-8px) scale(0.97)" },
          to: { opacity: "1", transform: "translateX(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "bubble-in-sent": "bubble-in-sent 0.18s ease-out",
        "bubble-in-received": "bubble-in-received 0.18s ease-out",
      },
    },
  },
  plugins: [],
};
