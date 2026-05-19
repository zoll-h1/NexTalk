export type ThemePreference = "dark" | "light";
export type BubbleStyle = "rounded" | "sharp" | "minimal";
export type BubbleColorTheme = "default" | "giraffe" | "cat" | "dog" | "ocean" | "forest" | "fire" | "candy";

export const THEME_STORAGE_KEY = "nexchat.theme";
export const WALLPAPER_STORAGE_KEY = "nexchat.wallpaper";
export const WALLPAPER_CUSTOM_DATA_KEY = "nexchat.wallpaper.custom";
export const BUBBLE_STORAGE_KEY = "nexchat.bubble";
export const BUBBLE_COLOR_STORAGE_KEY = "nexchat.bubbleColor";

export const WALLPAPERS = [
  { id: "none", label: "None", value: "" },
  { id: "space", label: "Space", value: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)" },
  { id: "ocean", label: "Ocean", value: "linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)" },
  { id: "forest", label: "Forest", value: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)" },
  { id: "sunset", label: "Sunset", value: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { id: "cyber", label: "Cyber", value: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)" },
] as const;

export function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("nexchat-light", theme === "light");
}

export function getWallpaperValue(wallpaperId: string) {
  return WALLPAPERS.find((wallpaper) => wallpaper.id === wallpaperId)?.value ?? "";
}

export const BUBBLE_COLOR_THEMES: Array<{ id: BubbleColorTheme; label: string; emoji: string; from: string; to: string }> = [
  { id: "default", label: "Violet",  emoji: "💜", from: "#6C63FF", to: "#9B5DE5" },
  { id: "giraffe", label: "Giraffe", emoji: "🦒", from: "#FF8C00", to: "#FFB347" },
  { id: "cat",     label: "Cat",     emoji: "🐱", from: "#FF6B9D", to: "#FFB6C1" },
  { id: "dog",     label: "Dog",     emoji: "🐶", from: "#8B5E3C", to: "#C4956A" },
  { id: "ocean",   label: "Ocean",   emoji: "🐬", from: "#0099CC", to: "#00CED1" },
  { id: "forest",  label: "Forest",  emoji: "🦎", from: "#2D8B4E", to: "#48CF6E" },
  { id: "fire",    label: "Fire",    emoji: "🔥", from: "#FF4E50", to: "#FC913A" },
  { id: "candy",   label: "Candy",   emoji: "🍭", from: "#FF61D2", to: "#FE9090" },
];

export function getBubbleGradient(colorTheme: BubbleColorTheme): string {
  const theme = BUBBLE_COLOR_THEMES.find((t) => t.id === colorTheme) ?? BUBBLE_COLOR_THEMES[0];
  return `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`;
}
