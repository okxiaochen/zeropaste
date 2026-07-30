/**
 * Theme selection.
 *
 * Three modes rather than a light/dark switch: "system" has to remain expressible, or a user whose OS
 * follows sunrise and sunset loses that once they touch the control.
 *
 * The choice lives in localStorage and nowhere else. It is never sent to the server, which has no
 * account to attach it to and no business knowing it.
 */

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "zeropaste-theme";
export const DEFAULT_THEME_MODE: ThemeMode = "system";

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"] as const;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

/** Cycles system -> light -> dark -> system, so one control covers all three modes. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode);
  return THEME_MODES[(index + 1) % THEME_MODES.length]!;
}

export function readStoredThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    // Private browsing modes and blocked storage both throw here. Falling back to the system
    // preference is the right outcome, not an error worth surfacing.
    return DEFAULT_THEME_MODE;
  }
}

export function storeThemeMode(mode: ThemeMode): void {
  try {
    if (mode === DEFAULT_THEME_MODE) {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // A theme that does not persist is a much smaller problem than a crash on click.
  }
}

/**
 * Applies a resolved theme to the document.
 *
 * The `dark` class is what Tailwind's `dark:` variant and the token overrides in globals.css both key
 * off. Setting `color-scheme` in addition is what makes native scrollbars, form controls, and the
 * browser's own UI match; without it a dark page keeps light scrollbars.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/**
 * The script that runs before first paint.
 *
 * It must be inline and synchronous in <head>: anything deferred paints a light page first and then
 * flips it, which is far more jarring than the theme simply being wrong. Kept to one expression so it
 * costs nothing measurable.
 *
 * Note that this is the one inline script in the app, and therefore the reason the CSP still needs
 * 'unsafe-inline' in script-src. Replacing it with a nonce is tracked as a Phase 3 item.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(m!=="light"&&m!=="dark")m="system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
