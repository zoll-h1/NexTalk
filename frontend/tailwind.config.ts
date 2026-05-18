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
        // Dragon theme colors
        dragon: {
          black: "#0a0a0a",
          charcoal: "#151515",
          obsidian: "#1a1a1a",
          ash: "#242424",
          smoke: "#2d2d2d",
        },
        // Fire accents
        fire: {
          ember: "#ff4500",
          flame: "#ff6b35",
          glow: "#ffa500",
          spark: "#ffcc00",
        },
        // Emerald/green flames
        flame: {
          green: "#00ff88",
          jade: "#00d97e",
          emerald: "#10b981",
        },
        // Glass effects
        glass: {
          soft: "rgba(255,255,255,0.03)",
          surface: "rgba(255,255,255,0.05)",
          border: "rgba(255,255,255,0.08)",
          hover: "rgba(255,255,255,0.08)",
        },
      },
      boxShadow: {
        'fire': '0 0 20px rgba(255, 107, 53, 0.3)',
        'fire-lg': '0 0 40px rgba(255, 107, 53, 0.4)',
        'green': '0 0 20px rgba(0, 255, 136, 0.3)',
        'green-lg': '0 0 40px rgba(0, 255, 136, 0.4)',
        'dragon': '0 8px 32px rgba(0, 0, 0, 0.6)',
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
        "flame-flicker": "flame-flicker 1.5s ease-in-out infinite",
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
            boxShadow: "0 0 20px rgba(255, 107, 53, 0.3)",
            opacity: "1",
          },
          "50%": {
            boxShadow: "0 0 40px rgba(255, 107, 53, 0.6)",
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
        "flame-flicker": {
          "0%, 100%": { opacity: "1", filter: "brightness(1)" },
          "50%": { opacity: "0.85", filter: "brightness(1.2)" },
        },
      },
      backgroundImage: {
        'gradient-fire': 'linear-gradient(135deg, #ff6b35 0%, #ffa500 100%)',
        'gradient-green': 'linear-gradient(135deg, #00ff88 0%, #10b981 100%)',
        'gradient-dragon': 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
