// Centralized localStorage key names and safe access helpers

export const STORAGE_KEYS = {
  COLOR: "directive-brand-color",
  TYPO: "directive-brand-typo",
  FIRST_VISIT: "directive-brand-first-visit",
  FONT_SIZE: "directive-brand-font-size",
  LOGO: "directive-brand-logo",
  EXPERIMENTS: "directive-labs-experiments",
  DISMISSED_NOTIFICATIONS: "directive-dismissed-notifications",
} as const;

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be full or unavailable (private browsing, etc.)
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {}
}
