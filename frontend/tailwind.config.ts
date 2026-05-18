import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: {
          50: "rgba(255,255,255,0.04)",
          100: "rgba(255,255,255,0.06)",
          200: "rgba(255,255,255,0.08)",
          300: "rgba(255,255,255,0.12)",
        },
        neon: {
          purple: "#8b5cf6",
          cyan: "#06b6d4",
        },
        space: {
          DEFAULT: "#080818",
          900: "#080818",
          800: "#0f0a1e",
          700: "#140e28",
        },
      },
      animation: {
        float: "float 14s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.45s ease-out both",
        shimmer: "shimmer 2.8s linear infinite",
        "slide-up": "slide-up 0.38s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in-right": "slide-in-right 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out both",
        "scale-in": "scale-in 0.25s ease-out both",
        blob: "blob 12s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -16px, 0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translate3d(0, 14px, 0)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translate3d(0, 24px, 0) scale(0.96)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0) scale(1)" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translate3d(26px, 0, 0) scale(0.98)" },
          "100%": { opacity: "1", transform: "translate3d(0, 0, 0) scale(1)" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 0 rgba(6, 182, 212, 0), 0 0 10px rgba(139, 92, 246, 0.35)",
            opacity: "1",
          },
          "50%": {
            boxShadow: "0 0 0 6px rgba(6, 182, 212, 0.12), 0 0 18px rgba(139, 92, 246, 0.75)",
            opacity: "0.9",
          },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        blob: {
          "0%": { transform: "translate3d(0, 0, 0) scale(1)" },
          "33%": { transform: "translate3d(18px, -24px, 0) scale(1.08)" },
          "66%": { transform: "translate3d(-16px, 16px, 0) scale(0.96)" },
          "100%": { transform: "translate3d(0, 0, 0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
