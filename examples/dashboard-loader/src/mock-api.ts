/**
 * Mock API — configurable delay and failure rate for each resource.
 * No real network calls; all data is deterministic based on userId.
 */

export interface Profile {
  name: string;
  avatar: string;
}

export interface Preferences {
  theme: string;
  locale: string;
}

export interface Permissions {
  role: string;
  features: string[];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail(failRate: number): boolean {
  return Math.random() * 100 < failRate;
}

export async function fetchMockProfile(
  userId: string,
  delay: number,
  failRate: number,
): Promise<Profile> {
  await wait(delay);

  if (shouldFail(failRate)) {
    throw new Error("Failed to fetch profile: connection timeout");
  }

  return {
    name: `User ${userId.charAt(0).toUpperCase()}${userId.slice(1)}`,
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${userId}`,
  };
}

export async function fetchMockPreferences(
  userId: string,
  delay: number,
  failRate: number,
): Promise<Preferences> {
  await wait(delay);

  if (shouldFail(failRate)) {
    throw new Error("Failed to fetch preferences: server error");
  }

  const themes = ["dark", "light", "auto"];
  const locales = ["en-US", "en-GB", "fr-FR", "de-DE", "ja-JP"];
  const hash = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);

  return {
    theme: themes[hash % themes.length],
    locale: locales[hash % locales.length],
  };
}

export async function fetchMockPermissions(
  userId: string,
  delay: number,
  failRate: number,
): Promise<Permissions> {
  await wait(delay);

  if (shouldFail(failRate)) {
    throw new Error("Failed to fetch permissions: authorization error");
  }

  const roles = ["admin", "editor", "viewer"];
  const allFeatures = ["dashboard", "reports", "settings", "billing", "api"];
  const hash = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const role = roles[hash % roles.length];
  const featureCount = role === "admin" ? 5 : role === "editor" ? 3 : 2;

  return {
    role,
    features: allFeatures.slice(0, featureCount),
  };
}
