/**
 * License key validation for Directive Plus features.
 *
 * Validates `dk_live_` license keys offline using RSA-SHA256 (SubtleCrypto).
 * Zero dependencies — works in Node.js 18+, browsers, Deno, Bun.
 *
 * Two validation layers:
 * 1. RSA-SHA256 signature verification (public key embedded below)
 * 2. Hidden nonce checksum (steganographic integrity check)
 *
 * @internal
 */

// RSA public key (SPKI DER, base64-encoded) — used to verify license signatures.
// The corresponding private key is stored securely and never included in the package.
const PUBLIC_KEY_B64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxfDmVXmIQjcAFy7cojg5x/fjOjZzQnlP5uHtXLrjuxajABNH2fVeV/zQxbYU44IxhQi2nGGOpVasWOAtowue0Oz5bpCHcbDZisvXMD3m0w4kSJb//aYs5pDwMVbOGVqc9LN4/GlKKyomQvfy7A1166m8Sh1kXjhwm8dNN7RGQ5h3/K2t5VNZF98H6VhGd6U5qtMBFniox1WfPcME7La7GwwrNyoavNwakLfJ/7nIR2u9tDXd/PgSn6bGK9HsU4YLw5/7Vin2V4Scsvfv2RsL0aMOIlKZ4ciAzuwIBzHeJVbkeM3KPSLfbfARe5UMjD5eX1fowaCXzw+EtA2NA2K2zQIDAQAB";

// ============================================================================
// Types
// ============================================================================

/** Decoded license key payload */
export interface LicensePayload {
  /** Team or company name */
  team: string;
  /** Expiry timestamp (Unix seconds) */
  exp: number;
  /** License tier */
  tier: "plus" | "enterprise";
  /** Integrity nonce (steganographic checksum) */
  nonce: string;
}

/** Result of license key validation */
export type LicenseResult =
  | { valid: true; payload: LicensePayload }
  | { valid: false; reason: string };

// ============================================================================
// Base64url helpers (no dependencies)
// ============================================================================

function base64urlDecode(str: string): Uint8Array {
  // Convert base64url to standard base64
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

// ============================================================================
// Nonce verification (steganographic layer)
// ============================================================================

const MAGIC = 0x5a; // 'Z' — the Z in Sizls

function verifyNonce(
  nonce: string,
  team: string,
  tier: string,
  exp: number,
): boolean {
  try {
    const expected = `${team}${tier}${exp}`;
    const decoded = base64urlDecode(nonce);

    // Reverse the bytes
    const reversed = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      reversed[i] = decoded[decoded.length - 1 - i]!;
    }

    // XOR with magic constant
    const result = new Uint8Array(reversed.length);
    for (let i = 0; i < reversed.length; i++) {
      result[i] = reversed[i]! ^ MAGIC;
    }

    // Compare to expected string
    if (result.length !== expected.length) {
      return false;
    }
    for (let i = 0; i < result.length; i++) {
      if (result[i] !== expected.charCodeAt(i)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// RSA signature verification
// ============================================================================

let cachedKey: CryptoKey | null = null;

async function getPublicKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }

  const keyBytes = base64Decode(PUBLIC_KEY_B64);
  cachedKey = await crypto.subtle.importKey(
    "spki",
    keyBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return cachedKey;
}

// ============================================================================
// Main validation
// ============================================================================

/**
 * Validate a Directive license key offline.
 *
 * Key format: `dk_live_{base64url_payload}.{base64url_signature}`
 *
 * @param key - The license key string
 * @returns Validation result with decoded payload on success
 */
export async function validateLicenseKey(
  key: string,
): Promise<LicenseResult> {
  // Check prefix
  if (!key.startsWith("dk_live_")) {
    return { valid: false, reason: "Invalid key format" };
  }

  const body = key.slice("dk_live_".length);
  const dotIndex = body.indexOf(".");
  if (dotIndex === -1) {
    return { valid: false, reason: "Invalid key format" };
  }

  const payloadB64 = body.slice(0, dotIndex);
  const signatureB64 = body.slice(dotIndex + 1);

  if (!payloadB64 || !signatureB64) {
    return { valid: false, reason: "Invalid key format" };
  }

  // Decode and parse payload
  let payload: LicensePayload;
  try {
    const payloadBytes = base64urlDecode(payloadB64);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadStr);
  } catch {
    return { valid: false, reason: "Invalid key format" };
  }

  // Validate required fields
  if (
    typeof payload.team !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.nonce !== "string" ||
    (payload.tier !== "plus" && payload.tier !== "enterprise")
  ) {
    return { valid: false, reason: "Invalid license" };
  }

  // Check expiry
  if (payload.exp < Date.now() / 1000) {
    return { valid: false, reason: "License expired" };
  }

  // Layer 1: RSA-SHA256 signature verification
  try {
    const publicKey = await getPublicKey();
    const payloadBytes = new TextEncoder().encode(payloadB64);
    const signatureBytes = base64urlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signatureBytes.buffer as ArrayBuffer,
      payloadBytes.buffer as ArrayBuffer,
    );

    if (!valid) {
      return { valid: false, reason: "Invalid license" };
    }
  } catch {
    return { valid: false, reason: "Invalid license" };
  }

  // Layer 2: Nonce checksum (steganographic integrity)
  if (!verifyNonce(payload.nonce, payload.team, payload.tier, payload.exp)) {
    return { valid: false, reason: "Invalid license" };
  }

  return { valid: true, payload };
}

/**
 * Generate a nonce for a license payload.
 * Used server-side during key generation. Exported for testing only.
 *
 * @internal
 */
export function generateNonce(
  team: string,
  tier: string,
  exp: number,
): string {
  const input = `${team}${tier}${exp}`;
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) {
    bytes[i] = input.charCodeAt(i) ^ MAGIC;
  }

  // Reverse
  const reversed = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    reversed[i] = bytes[bytes.length - 1 - i]!;
  }

  // Base64url encode
  let binary = "";
  for (let i = 0; i < reversed.length; i++) {
    binary += String.fromCharCode(reversed[i]!);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
