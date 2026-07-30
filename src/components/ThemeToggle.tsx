"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_THEME_MODE,
  applyTheme,
  nextThemeMode,
  readStoredThemeMode,
  resolveTheme,
  storeThemeMode,
  type ThemeMode,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const LABELS: Record<ThemeMode, string> = {
  system: "Theme: follow system",
  light: "Theme: light",
  dark: "Theme: dark",
};

const ICONS: Record<ThemeMode, typeof Monitor> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/**
 * A single button cycling system -> light -> dark.
 *
 * One control rather than a dropdown: it fits the viewer, where the whole point is that nothing
 * competes with the content, and three states are few enough to cycle through without a menu.
 */
export function ThemeToggle({ className }: { className?: string }) {
  // Starts at the default and syncs on mount. The blocking script in <head> has already painted the
  // correct theme; this state only tracks which label to show, so a first render that disagrees is
  // invisible.
  const [mode, setMode] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(readStoredThemeMode());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme(resolveTheme(mode, media.matches));

    sync();

    // Only meaningful in "system" mode, but harmless to keep attached: re-applying an explicit theme
    // is a no-op, and this avoids a listener that has to be torn down and rebuilt on every change.
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [mode, mounted]);

  const cycle = useCallback(() => {
    setMode((current) => {
      const next = nextThemeMode(current);
      storeThemeMode(next);
      return next;
    });
  }, []);

  const Icon = ICONS[mode];

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={LABELS[mode]}
      title={LABELS[mode]}
      className={cn(
        "inline-flex items-center justify-center rounded-md border bg-card/90 p-1.5 text-muted-foreground backdrop-blur transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
