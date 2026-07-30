import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_MODE,
  THEME_INIT_SCRIPT,
  THEME_MODES,
  THEME_STORAGE_KEY,
  isThemeMode,
  nextThemeMode,
  resolveTheme,
} from "@/lib/theme";

describe("resolveTheme", () => {
  it("follows the system preference in system mode", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("overrides the system preference in both directions", () => {
    // Forcing light on a dark OS must work as readily as the reverse — the common bug is a stylesheet
    // where a `prefers-color-scheme: dark` block still wins over an explicit light choice.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("nextThemeMode", () => {
  it("cycles through every mode and returns to the start", () => {
    let mode = DEFAULT_THEME_MODE;
    const seen = [mode];
    for (let i = 0; i < THEME_MODES.length; i += 1) {
      mode = nextThemeMode(mode);
      seen.push(mode);
    }
    // A single control has to be able to reach all three states, and land back where it began.
    expect(new Set(seen).size).toBe(THEME_MODES.length);
    expect(seen[seen.length - 1]).toBe(DEFAULT_THEME_MODE);
  });

  it("starts from system", () => {
    expect(DEFAULT_THEME_MODE).toBe("system");
    expect(nextThemeMode("system")).toBe("light");
    expect(nextThemeMode("light")).toBe("dark");
    expect(nextThemeMode("dark")).toBe("system");
  });
});

describe("isThemeMode", () => {
  it("accepts the three modes and rejects anything else", () => {
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    // Guards against a stale or hand-edited localStorage value putting the UI in an impossible state.
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
    expect(isThemeMode(undefined)).toBe(false);
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("references the same storage key the rest of the module uses", () => {
    // The script is a string rather than compiled code, so nothing else would catch a drift here.
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("is a single self-invoking expression that swallows its own errors", () => {
    // It runs before anything else on the page; a throw here would block rendering entirely.
    expect(THEME_INIT_SCRIPT.startsWith("(function()")).toBe(true);
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch(e){}");
  });

  it("sets both the class and color-scheme", () => {
    // The class drives the tokens; color-scheme is what makes native scrollbars and form controls match.
    expect(THEME_INIT_SCRIPT).toContain("classList.toggle");
    expect(THEME_INIT_SCRIPT).toContain("colorScheme");
  });

  it("resolves an unrecognised stored value to system rather than trusting it", () => {
    expect(THEME_INIT_SCRIPT).toContain('m="system"');
  });
});
