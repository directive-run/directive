/**
 * Mock Auth API — configurable failure rate and TTL.
 * No real network calls; all data is deterministic.
 */

export interface AuthTokens {
  token: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldFail(failRate: number): boolean {
  return Math.random() * 100 < failRate;
}

function randomHex(length: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

export async function mockLogin(
  email: string,
  _password: string,
  failRate: number,
  ttl: number,
): Promise<AuthTokens> {
  await wait(800);

  if (!email.trim()) {
    throw new Error("Email is required");
  }

  if (shouldFail(failRate)) {
    throw new Error("Login failed: invalid credentials");
  }

  return {
    token: `tok_${randomHex(16)}`,
    refreshToken: `ref_${randomHex(16)}`,
    expiresIn: ttl,
  };
}

export async function mockRefresh(
  _refreshToken: string,
  failRate: number,
  ttl: number,
): Promise<AuthTokens> {
  await wait(500);

  if (shouldFail(failRate)) {
    throw new Error("Token refresh failed: session expired");
  }

  return {
    token: `tok_${randomHex(16)}`,
    refreshToken: `ref_${randomHex(16)}`,
    expiresIn: ttl,
  };
}

export async function mockFetchUser(token: string): Promise<User> {
  await wait(400);

  const hash = token.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const names = ["Alice Johnson", "Bob Smith", "Carol White", "Dan Brown"];
  const roles = ["admin", "viewer", "editor", "moderator"];
  const emails = [
    "alice@test.com",
    "bob@test.com",
    "carol@test.com",
    "dan@test.com",
  ];

  return {
    id: `user_${hash % 1000}`,
    name: names[hash % names.length],
    email: emails[hash % emails.length],
    role: roles[hash % roles.length],
  };
}
