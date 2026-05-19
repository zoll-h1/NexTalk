"use client";

import { useEffect } from "react";

import { THEME_STORAGE_KEY, applyTheme } from "@/lib/appearance";

export function ThemeInit() {
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    applyTheme(saved === "light" ? "light" : "dark");
  }, []);

  return null;
}
