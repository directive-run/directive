import { describe, expect, it, vi } from "vitest";
import {
  type DetectedPII,
  type PIIDetector,
  type PIIType,
  createEnhancedPIIGuardrail,
  createOutputPIIGuardrail,
  detectAndRedactPII,
  detectPII,
  redactPII,
  regexDetector,
} from "../../guardrails/pii-enhanced.js";
import type { GuardrailContext } from "../../types.js";

// Shared mock context for guardrail calls
const mockContext: GuardrailContext = {
  agentName: "test-agent",
  input: "",
  facts: {},
};

// ============================================================================
// regexDetector / detectPII
// ============================================================================

describe("regexDetector / detectPII", () => {
  it("detects SSN like 123-45-6789 with confidence 0.95", async () => {
    const result = await regexDetector.detect("My SSN is 123-45-6789", ["ssn"]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("ssn");
    expect(result[0]!.value).toBe("123-45-6789");
    expect(result[0]!.confidence).toBe(0.95);
  });

  it("rejects invalid SSN starting with 000", async () => {
    const result = await regexDetector.detect("SSN: 000-12-3456", ["ssn"]);

    expect(result).toHaveLength(0);
  });

  it("rejects invalid SSN starting with 666", async () => {
    const result = await regexDetector.detect("SSN: 666-12-3456", ["ssn"]);

    expect(result).toHaveLength(0);
  });

  it("rejects SSN with middle 00 like 123-00-6789", async () => {
    const result = await regexDetector.detect("SSN: 123-00-6789", ["ssn"]);

    expect(result).toHaveLength(0);
  });

  it("rejects SSN with last 0000 like 123-45-0000", async () => {
    const result = await regexDetector.detect("SSN: 123-45-0000", ["ssn"]);

    expect(result).toHaveLength(0);
  });

  it("detects credit card with Luhn validation 4111-1111-1111-1111", async () => {
    const result = await regexDetector.detect("Card: 4111-1111-1111-1111", [
      "credit_card",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("credit_card");
    expect(result[0]!.confidence).toBe(0.95);
  });

  it("rejects invalid credit card failing Luhn 1234-5678-9012-3456", async () => {
    const result = await regexDetector.detect("Card: 1234-5678-9012-3456", [
      "credit_card",
    ]);

    expect(result).toHaveLength(0);
  });

  it("detects email addresses", async () => {
    const result = await regexDetector.detect(
      "Contact me at user@example.com please",
      ["email"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("email");
    expect(result[0]!.value).toBe("user@example.com");
    expect(result[0]!.confidence).toBe(0.9);
  });

  it("detects phone numbers like (555) 555-1234", async () => {
    const result = await regexDetector.detect("Call me at (555) 555-1234", [
      "phone",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("phone");
    expect(result[0]!.confidence).toBe(0.8);
  });

  it("rejects phone with wrong digit count", async () => {
    const result = await regexDetector.detect("Phone: 555-12", ["phone"]);

    expect(result).toHaveLength(0);
  });

  it("detects public IP addresses like 8.8.8.8", async () => {
    // Private/loopback ranges are intentionally filtered (see FIX 8), so this
    // uses a public IP.
    const result = await regexDetector.detect("Server at 8.8.8.8", [
      "ip_address",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("ip_address");
    expect(result[0]!.confidence).toBe(0.9);
  });

  it("rejects invalid IP 999.999.999.999", async () => {
    const result = await regexDetector.detect("IP: 999.999.999.999", [
      "ip_address",
    ]);

    expect(result).toHaveLength(0);
  });

  it('detects "dob: 01/15/1990" as date_of_birth', async () => {
    const result = await regexDetector.detect("dob: 01/15/1990", [
      "date_of_birth",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("date_of_birth");
    expect(result[0]!.confidence).toBe(0.85);
  });

  it('detects "passport: AB1234567"', async () => {
    const result = await regexDetector.detect("passport: AB1234567", [
      "passport",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("passport");
    expect(result[0]!.confidence).toBe(0.75);
  });

  it('detects "account #12345678" as bank_account', async () => {
    const result = await regexDetector.detect("account #12345678", [
      "bank_account",
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("bank_account");
    expect(result[0]!.confidence).toBe(0.7);
  });
});

// ============================================================================
// detectAddresses (via regexDetector)
// ============================================================================

describe("detectAddresses", () => {
  it("detects US address like '123 Main Street, Anytown, CA 90210'", async () => {
    const result = await regexDetector.detect(
      "I live at 123 Main Street, Anytown, CA 90210",
      ["address"],
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("address");
    expect(result[0]!.confidence).toBe(0.7);
  });
});

// ============================================================================
// detectNames (via regexDetector)
// ============================================================================

describe("detectNames", () => {
  it('detects "Mr. John Smith"', async () => {
    // Use "Mr." directly at the start so it matches as the prefix
    const result = await regexDetector.detect("Mr. John Smith is here", [
      "name",
    ]);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const nameItem = result.find((r) => r.type === "name");
    expect(nameItem).toBeDefined();
    expect(nameItem!.confidence).toBe(0.6);
  });

  it('detects "name is Jane Doe"', async () => {
    // End sentence right after the name to avoid greedy capture of trailing words
    const result = await regexDetector.detect("My name is Jane Doe.", ["name"]);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const nameItem = result.find((r) => r.type === "name");
    expect(nameItem).toBeDefined();
    expect(nameItem!.type).toBe("name");
    expect(nameItem!.value).toContain("Jane");
    expect(nameItem!.value).toContain("Doe");
  });
});

// ============================================================================
// redactPII
// ============================================================================

describe("redactPII", () => {
  // "My SSN is 123-45-6789"
  //  0123456789...
  // SSN starts at index 10, length 11 → end 21
  const ssnItem: DetectedPII = {
    type: "ssn",
    value: "123-45-6789",
    position: { start: 10, end: 21 },
    confidence: 0.95,
  };

  it('"placeholder" style replaces with [REDACTED]', () => {
    const text = "My SSN is 123-45-6789";
    const result = redactPII(text, [ssnItem], "placeholder");

    expect(result).toBe("My SSN is [REDACTED]");
  });

  it('"typed" style replaces with [SSN], [EMAIL], etc.', () => {
    const text = "My SSN is 123-45-6789";
    const result = redactPII(text, [ssnItem], "typed");

    expect(result).toBe("My SSN is [SSN]");
  });

  it('"masked" style replaces with asterisks matching length', () => {
    const text = "My SSN is 123-45-6789";
    const result = redactPII(text, [ssnItem], "masked");

    // "123-45-6789" is 11 characters
    expect(result).toBe("My SSN is ***********");
  });

  it('"hashed" style replaces with [HASH:xxxxxxxx] (8-char hex)', () => {
    const text = "My SSN is 123-45-6789";
    const result = redactPII(text, [ssnItem], "hashed");

    expect(result).toMatch(/^My SSN is \[HASH:[0-9a-f]{8}\]$/);
  });

  it("redacts multiple items in correct positions (reverse order)", async () => {
    const text = "SSN is 123-45-6789 and email is user@example.com ok";
    // Use regexDetector to get accurate positions
    const detected = await regexDetector.detect(text, ["ssn", "email"]);

    expect(detected).toHaveLength(2);

    const result = redactPII(text, detected, "typed");

    expect(result).toBe("SSN is [SSN] and email is [EMAIL] ok");
  });
});

// ============================================================================
// createEnhancedPIIGuardrail
// ============================================================================

describe("createEnhancedPIIGuardrail", () => {
  it("returns { passed: true } for clean input", async () => {
    const guardrail = createEnhancedPIIGuardrail();
    const result = await guardrail(
      { input: "Hello, how are you?", agentName: "test" },
      mockContext,
    );

    expect(result).toEqual({ passed: true });
  });

  it('returns { passed: false } with reason "PII detected (ssn: 1)" for SSN', async () => {
    const guardrail = createEnhancedPIIGuardrail({ types: ["ssn"] });
    const result = await guardrail(
      { input: "My SSN is 123-45-6789", agentName: "test" },
      mockContext,
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toBe("PII detected (ssn: 1)");
  });

  it("redact: true returns { passed: true, transformed } with redacted text", async () => {
    const guardrail = createEnhancedPIIGuardrail({
      types: ["ssn"],
      redact: true,
      redactionStyle: "typed",
    });
    const result = await guardrail(
      { input: "My SSN is 123-45-6789", agentName: "test" },
      mockContext,
    );

    expect(result.passed).toBe(true);
    expect(result.transformed).toBe("My SSN is [SSN]");
  });

  it("minConfidence filters low-confidence items", async () => {
    // bank_account has confidence 0.7 — setting minConfidence to 0.8 should skip it
    const guardrail = createEnhancedPIIGuardrail({
      types: ["bank_account"],
      minConfidence: 0.8,
    });
    const result = await guardrail(
      { input: "account #12345678", agentName: "test" },
      mockContext,
    );

    expect(result.passed).toBe(true);
  });

  it("allowlist skips specified values (case-insensitive)", async () => {
    const guardrail = createEnhancedPIIGuardrail({
      types: ["email"],
      allowlist: ["User@Example.com"],
    });
    const result = await guardrail(
      { input: "Contact user@example.com for info", agentName: "test" },
      mockContext,
    );

    expect(result.passed).toBe(true);
  });

  it("minItemsToBlock requires N items before blocking", async () => {
    const guardrail = createEnhancedPIIGuardrail({
      types: ["ssn", "email"],
      minItemsToBlock: 2,
    });

    // Only 1 PII item — should pass
    const result = await guardrail(
      { input: "My SSN is 123-45-6789", agentName: "test" },
      mockContext,
    );

    expect(result.passed).toBe(true);
  });

  it("onDetected callback fires with detected items", async () => {
    const onDetected = vi.fn();
    const guardrail = createEnhancedPIIGuardrail({
      types: ["ssn"],
      onDetected,
    });

    await guardrail(
      { input: "My SSN is 123-45-6789", agentName: "test" },
      mockContext,
    );

    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "ssn", value: "123-45-6789" }),
      ]),
    );
  });

  it("custom detector with timeout protection", async () => {
    const slowDetector: PIIDetector = {
      name: "slow-detector",
      detect: vi.fn(
        (_text: string, _types: PIIType[]) =>
          new Promise<DetectedPII[]>((resolve) => {
            // Never resolves within timeout
            setTimeout(() => resolve([]), 60_000);
          }),
      ),
    };

    const guardrail = createEnhancedPIIGuardrail({
      detector: slowDetector,
      detectorTimeout: 50,
    });

    await expect(
      guardrail({ input: "some text", agentName: "test" }, mockContext),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});

// ============================================================================
// createOutputPIIGuardrail
// ============================================================================

describe("createOutputPIIGuardrail", () => {
  it("blocks output containing PII", async () => {
    const guardrail = createOutputPIIGuardrail({ types: ["ssn"] });
    const result = await guardrail(
      {
        output: "Your SSN is 123-45-6789",
        agentName: "test",
        input: "What is my SSN?",
        messages: [],
      },
      mockContext,
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("ssn");
  });

  it("handles object output (JSON.stringify)", async () => {
    const guardrail = createOutputPIIGuardrail({ types: ["ssn"] });
    const result = await guardrail(
      {
        output: { response: "SSN: 123-45-6789" },
        agentName: "test",
        input: "get data",
        messages: [],
      },
      mockContext,
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("ssn");
  });
});

// ============================================================================
// detectPII utility
// ============================================================================

describe("detectPII utility", () => {
  it("returns filtered items by confidence", async () => {
    // bank_account confidence is 0.7, email is 0.9
    // With minConfidence 0.8, only email should remain
    const text = "account #12345678 and email user@example.com";
    const result = await detectPII(text, {
      types: ["bank_account", "email"],
      minConfidence: 0.8,
    });

    expect(result.detected).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.type).toBe("email");
  });

  it("returns typeCounts", async () => {
    const text = "SSN 123-45-6789 and email user@example.com";
    const result = await detectPII(text, {
      types: ["ssn", "email"],
    });

    expect(result.detected).toBe(true);
    expect(result.typeCounts).toEqual({ ssn: 1, email: 1 });
    expect(result.items).toHaveLength(2);
  });
});

// ============================================================================
// FIX 1 — redactPII overlap dedup
// ============================================================================

describe("redactPII overlap dedup", () => {
  it("does not corrupt output when two items overlap, keeps higher confidence", () => {
    const text = "call 4111111111111111 now";
    const start = text.indexOf("4111111111111111");
    const end = start + 16;
    // Two overlapping detections of the same 16-digit span.
    const items: DetectedPII[] = [
      {
        type: "credit_card",
        value: "4111111111111111",
        position: { start, end },
        confidence: 0.95,
      },
      {
        type: "phone",
        value: "4111111111111111",
        position: { start, end },
        confidence: 0.8,
      },
    ];

    const redacted = redactPII(text, items, "typed");
    // Higher-confidence credit_card wins; phone span dropped.
    expect(redacted).toBe("call [CREDIT_CARD] now");
    // No raw digits left, no doubled/garbled brackets.
    expect(redacted).not.toMatch(/\d/);
    expect(redacted).not.toContain("[PHONE]");
  });

  it("drops a nested span contained within a larger kept span", () => {
    const text = "id 123456789 end";
    const start = text.indexOf("123456789");
    const items: DetectedPII[] = [
      {
        type: "ssn",
        value: "123456789",
        position: { start, end: start + 9 },
        confidence: 0.9,
      },
      // Nested 4-digit sub-span, lower confidence.
      {
        type: "bank_account",
        value: "4567",
        position: { start: start + 3, end: start + 7 },
        confidence: 0.7,
      },
    ];

    const redacted = redactPII(text, items, "typed");
    expect(redacted).toBe("id [SSN] end");
  });
});

// ============================================================================
// FIX 3 — credit-card 13-19 digit detection
// ============================================================================

describe("credit_card 13-19 digit detection", () => {
  it("detects a valid 13-digit Luhn PAN", async () => {
    // 4222222222222 is a valid 13-digit Visa test number (Luhn-valid).
    const result = await detectPII("card 4222222222222 ok", {
      types: ["credit_card"],
    });
    expect(result.detected).toBe(true);
    expect(result.items[0]!.type).toBe("credit_card");
  });

  it("detects a valid 19-digit Luhn PAN", async () => {
    // 4111111111111111110 is a 19-digit Luhn-valid number.
    const result = await detectPII("card 4111111111111111110 ok", {
      types: ["credit_card"],
    });
    expect(result.detected).toBe(true);
    expect(result.items[0]!.type).toBe("credit_card");
  });
});

// ============================================================================
// FIX 4 — national_id keyword detection
// ============================================================================

describe("national_id detection", () => {
  it("detects a keyword-anchored national ID", async () => {
    const result = await detectPII("National ID: AB1234567X here", {
      types: ["national_id"],
    });
    expect(result.detected).toBe(true);
    expect(result.items[0]!.type).toBe("national_id");
  });

  it("detects the 'nin' keyword variant", async () => {
    const result = await detectPII("NIN# QQ123456C", {
      types: ["national_id"],
    });
    expect(result.detected).toBe(true);
    expect(result.items[0]!.type).toBe("national_id");
  });
});

// ============================================================================
// FIX 6 — typed redaction hides special-category names
// ============================================================================

describe("redactPII special-category masking", () => {
  it("emits [REDACTED] for medical_id under typed style", () => {
    const text = "mrn: AB123456";
    const start = text.indexOf("AB123456");
    const items: DetectedPII[] = [
      {
        type: "medical_id",
        value: "AB123456",
        position: { start: 0, end: start + 8 },
        confidence: 0.7,
      },
    ];
    const redacted = redactPII(text, items, "typed");
    expect(redacted).toBe("[REDACTED]");
    expect(redacted).not.toContain("MEDICAL_ID");
  });

  it("still emits [TYPE] for non-special types", () => {
    const items: DetectedPII[] = [
      {
        type: "email",
        value: "a@b.com",
        position: { start: 0, end: 7 },
        confidence: 0.9,
      },
    ];
    expect(redactPII("a@b.com", items, "typed")).toBe("[EMAIL]");
  });
});

// ============================================================================
// FIX 8 — private/loopback IP false positives
// ============================================================================

describe("ip_address private/loopback filtering", () => {
  it("does not flag RFC1918 private IPs", async () => {
    const result = await detectPII("server at 10.0.0.1 and 192.168.1.5", {
      types: ["ip_address"],
    });
    expect(result.detected).toBe(false);
  });

  it("does not flag loopback 127.0.0.1", async () => {
    const result = await detectPII("localhost 127.0.0.1", {
      types: ["ip_address"],
    });
    expect(result.detected).toBe(false);
  });

  it("still flags a public IP", async () => {
    const result = await detectPII("client 8.8.8.8 connected", {
      types: ["ip_address"],
    });
    expect(result.detected).toBe(true);
    expect(result.items[0]!.type).toBe("ip_address");
  });
});

// ============================================================================
// FIX 9 — detectAndRedactPII compose helper
// ============================================================================

describe("detectAndRedactPII", () => {
  it("returns a new object with redactedText set when PII is found", async () => {
    const result = await detectAndRedactPII("My SSN is 123-45-6789", {
      types: ["ssn"],
      style: "typed",
    });
    expect(result.detected).toBe(true);
    expect(result.redactedText).toBe("My SSN is [SSN]");
  });

  it("leaves redactedText undefined when no PII is detected", async () => {
    const result = await detectAndRedactPII("nothing sensitive here", {
      types: ["ssn"],
    });
    expect(result.detected).toBe(false);
    expect(result.redactedText).toBeUndefined();
  });

  it("does not mutate the detectPII result (returns a fresh object)", async () => {
    const text = "SSN 123-45-6789";
    const detect = await detectPII(text, { types: ["ssn"] });
    const composed = await detectAndRedactPII(text, { types: ["ssn"] });
    expect(detect.redactedText).toBeUndefined();
    expect(composed).not.toBe(detect);
    expect(composed.redactedText).toBeDefined();
  });
});

// ============================================================================
// FIX 2 — no unhandled rejection from a fast custom detector
// ============================================================================

describe("detectPII timeout race hygiene", () => {
  it("does not emit an unhandled rejection when a fast detector wins", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);

    const fastDetector: PIIDetector = {
      name: "fast",
      async detect(): Promise<DetectedPII[]> {
        return [];
      },
    };

    try {
      const result = await detectPII("anything", {
        detector: fastDetector,
        timeout: 50,
      });
      expect(result.detected).toBe(false);
      // Let the (cleared) timeout's microtask flush.
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      process.off("unhandledRejection", onRejection);
    }

    expect(rejections).toHaveLength(0);
  });
});
