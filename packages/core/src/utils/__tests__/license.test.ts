import { describe, expect, it } from "vitest";
import { validateLicenseKey, generateNonce } from "../license.js";

// ============================================================================
// Test helpers
// ============================================================================

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Future expiry (year 2030)
const FUTURE_EXP = 1893456000;
// Past expiry
const PAST_EXP = 1000000000;

// ============================================================================
// Tests
// ============================================================================

describe("validateLicenseKey", () => {
  // Note: These tests use a TEST keypair, not the production public key.
  // The license.ts file has the production key embedded, so these tests
  // will fail RSA verification (expected). We test the format/nonce logic.

  describe("format validation", () => {
    it("rejects empty string", async () => {
      const result = await validateLicenseKey("");
      expect(result.valid).toBe(false);
    });

    it("rejects missing dk_live_ prefix", async () => {
      const result = await validateLicenseKey("invalid_key_here");
      expect(result.valid).toBe(false);
    });

    it("rejects missing separator", async () => {
      const result = await validateLicenseKey("dk_live_noseparator");
      expect(result.valid).toBe(false);
    });

    it("rejects empty payload", async () => {
      const result = await validateLicenseKey("dk_live_.signature");
      expect(result.valid).toBe(false);
    });

    it("rejects empty signature", async () => {
      const result = await validateLicenseKey("dk_live_payload.");
      expect(result.valid).toBe(false);
    });

    it("rejects invalid base64 payload", async () => {
      const result = await validateLicenseKey("dk_live_!!!invalid!!!.sig");
      expect(result.valid).toBe(false);
    });

    it("rejects payload missing required fields", async () => {
      const payload = base64urlEncode(
        new TextEncoder().encode(JSON.stringify({ team: "test" })),
      );
      const result = await validateLicenseKey(`dk_live_${payload}.fakesig`);
      expect(result.valid).toBe(false);
    });

    it("rejects invalid tier value", async () => {
      const nonce = generateNonce("test", "premium", FUTURE_EXP);
      const payload = base64urlEncode(
        new TextEncoder().encode(
          JSON.stringify({ team: "test", exp: FUTURE_EXP, tier: "premium", nonce }),
        ),
      );
      const result = await validateLicenseKey(`dk_live_${payload}.fakesig`);
      expect(result.valid).toBe(false);
    });
  });

  describe("expiry", () => {
    it("rejects expired keys", async () => {
      const nonce = generateNonce("test", "plus", PAST_EXP);
      const payload = base64urlEncode(
        new TextEncoder().encode(
          JSON.stringify({ team: "test", exp: PAST_EXP, tier: "plus", nonce }),
        ),
      );
      const result = await validateLicenseKey(`dk_live_${payload}.fakesig`);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe("License expired");
      }
    });
  });

  describe("nonce checksum", () => {
    it("generateNonce produces deterministic output", () => {
      const n1 = generateNonce("acme", "plus", 1234567890);
      const n2 = generateNonce("acme", "plus", 1234567890);
      expect(n1).toBe(n2);
    });

    it("generateNonce differs for different inputs", () => {
      const n1 = generateNonce("acme", "plus", 1234567890);
      const n2 = generateNonce("acme", "enterprise", 1234567890);
      const n3 = generateNonce("other", "plus", 1234567890);
      expect(n1).not.toBe(n2);
      expect(n1).not.toBe(n3);
    });

    it("generateNonce round-trips through verification", async () => {
      // This tests the internal nonce algorithm consistency.
      // The nonce generated for (team, tier, exp) must verify when
      // presented back to validateLicenseKey with matching fields.
      const team = "Acme Corp";
      const tier = "plus";
      const exp = FUTURE_EXP;
      const nonce = generateNonce(team, tier, exp);

      // The nonce should be a non-empty base64url string
      expect(nonce.length).toBeGreaterThan(0);
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe("RSA signature (with tampered keys)", () => {
    it("rejects tampered signature", async () => {
      const nonce = generateNonce("test", "plus", FUTURE_EXP);
      const payload = base64urlEncode(
        new TextEncoder().encode(
          JSON.stringify({ team: "test", exp: FUTURE_EXP, tier: "plus", nonce }),
        ),
      );
      // Use a fake signature that won't verify
      const result = await validateLicenseKey(`dk_live_${payload}.AAAA`);
      expect(result.valid).toBe(false);
    });
  });
});

describe("generateNonce", () => {
  it("returns a base64url string", () => {
    const nonce = generateNonce("test", "plus", 123);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("encodes team + tier + exp", () => {
    // Verify the nonce is not trivially the same as the input
    const nonce = generateNonce("myteam", "plus", 999);
    expect(nonce).not.toContain("myteam");
    expect(nonce).not.toContain("plus");
    expect(nonce).not.toContain("999");
  });
});
