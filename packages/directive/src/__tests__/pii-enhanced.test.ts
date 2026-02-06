import { describe, expect, it, vi } from "vitest";
import {
	regexDetector,
	redactPII,
	createEnhancedPIIGuardrail,
	createOutputPIIGuardrail,
	detectPII,
	type PIIDetector,
	type PIIType,
	type DetectedPII,
	type RedactionStyle,
} from "../adapters/guardrails/pii-enhanced.js";

// ============================================================================
// Helpers
// ============================================================================

const ALL_TYPES: PIIType[] = [
	"ssn",
	"credit_card",
	"email",
	"phone",
	"address",
	"name",
	"date_of_birth",
	"ip_address",
	"bank_account",
	"passport",
	"driver_license",
	"medical_id",
	"national_id",
];

/** Minimal guardrail context for invoking guardrails */
const ctx = { agentName: "test-agent", input: "", facts: {} };

// ============================================================================
// regexDetector.detect()
// ============================================================================

describe("regexDetector.detect()", () => {
	// ---------- SSN ----------
	describe("SSN detection", () => {
		it("should detect a valid SSN with dashes", async () => {
			const items = await regexDetector.detect("My SSN is 123-45-6789", ["ssn"]);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("ssn");
			expect(items[0]!.value).toBe("123-45-6789");
			expect(items[0]!.confidence).toBe(0.95);
		});

		it("should detect a valid SSN without dashes", async () => {
			const items = await regexDetector.detect("SSN 123456789", ["ssn"]);
			expect(items).toHaveLength(1);
			expect(items[0]!.value).toBe("123456789");
		});

		it("should detect a valid SSN with spaces", async () => {
			const items = await regexDetector.detect("SSN 123 45 6789", ["ssn"]);
			expect(items).toHaveLength(1);
			expect(items[0]!.value).toBe("123 45 6789");
		});

		it("should reject SSN starting with 000", async () => {
			const items = await regexDetector.detect("SSN 000-12-3456", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should reject SSN starting with 666", async () => {
			const items = await regexDetector.detect("SSN 666-12-3456", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should reject SSN starting with 9xx", async () => {
			const items = await regexDetector.detect("SSN 900-12-3456", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should reject SSN starting with 999", async () => {
			const items = await regexDetector.detect("SSN 999-12-3456", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should reject SSN with middle digits 00", async () => {
			const items = await regexDetector.detect("SSN 123-00-6789", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should reject SSN with last four digits 0000", async () => {
			const items = await regexDetector.detect("SSN 123-45-0000", ["ssn"]);
			expect(items).toHaveLength(0);
		});

		it("should detect multiple SSNs in one string", async () => {
			const items = await regexDetector.detect(
				"SSN1: 123-45-6789, SSN2: 234-56-7890",
				["ssn"]
			);
			expect(items).toHaveLength(2);
		});
	});

	// ---------- Credit Card ----------
	describe("Credit card detection", () => {
		it("should detect a valid Visa card with dashes", async () => {
			// 4539-1488-0343-6467 passes Luhn
			const items = await regexDetector.detect(
				"Card: 4539-1488-0343-6467",
				["credit_card"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("credit_card");
			expect(items[0]!.confidence).toBe(0.95);
		});

		it("should detect a valid card with spaces", async () => {
			const items = await regexDetector.detect(
				"Card: 4539 1488 0343 6467",
				["credit_card"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect a valid card without separators", async () => {
			const items = await regexDetector.detect(
				"Card: 4539148803436467",
				["credit_card"]
			);
			expect(items).toHaveLength(1);
		});

		it("should reject a card that fails Luhn check", async () => {
			// 1234-5678-9012-3456 does not pass Luhn
			const items = await regexDetector.detect(
				"Card: 1234-5678-9012-3456",
				["credit_card"]
			);
			expect(items).toHaveLength(0);
		});

		it("should detect valid Amex 15-digit card", async () => {
			// 378282246310005 is a known Amex test number (passes Luhn)
			const items = await regexDetector.detect(
				"Amex: 378282246310005",
				["credit_card"]
			);
			expect(items).toHaveLength(1);
		});
	});

	// ---------- Email ----------
	describe("Email detection", () => {
		it("should detect a standard email", async () => {
			const items = await regexDetector.detect(
				"Contact me at user@example.com",
				["email"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("email");
			expect(items[0]!.value).toBe("user@example.com");
			expect(items[0]!.confidence).toBe(0.9);
		});

		it("should detect emails with dots and plus signs", async () => {
			const items = await regexDetector.detect(
				"Email: first.last+tag@sub.domain.org",
				["email"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.value).toBe("first.last+tag@sub.domain.org");
		});

		it("should detect multiple emails", async () => {
			const items = await regexDetector.detect(
				"a@b.com and c@d.co.uk",
				["email"]
			);
			expect(items).toHaveLength(2);
		});
	});

	// ---------- Phone ----------
	describe("Phone detection", () => {
		it("should detect US phone with parentheses", async () => {
			const items = await regexDetector.detect(
				"Call (555) 123-4567",
				["phone"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("phone");
			expect(items[0]!.confidence).toBe(0.8);
		});

		it("should detect phone with dashes only", async () => {
			const items = await regexDetector.detect(
				"Call 555-123-4567",
				["phone"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect phone with +1 prefix", async () => {
			const items = await regexDetector.detect(
				"Call +1 555 123 4567",
				["phone"]
			);
			expect(items).toHaveLength(1);
		});

		it("should reject a number with fewer than 10 digits", async () => {
			const items = await regexDetector.detect(
				"Call 555-1234",
				["phone"]
			);
			expect(items).toHaveLength(0);
		});
	});

	// ---------- Date of Birth ----------
	describe("Date of birth detection", () => {
		it("should detect DOB with 'born' prefix", async () => {
			const items = await regexDetector.detect(
				"born: 01/15/1990",
				["date_of_birth"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("date_of_birth");
			expect(items[0]!.confidence).toBe(0.85);
		});

		it("should detect DOB with 'dob' prefix", async () => {
			const items = await regexDetector.detect(
				"DOB 1990-01-15",
				["date_of_birth"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect DOB with 'date of birth' prefix", async () => {
			const items = await regexDetector.detect(
				"Date of birth: 15/01/1990",
				["date_of_birth"]
			);
			expect(items).toHaveLength(1);
		});

		it("should not detect a random date without DOB context", async () => {
			const items = await regexDetector.detect(
				"The date is 01/15/2024",
				["date_of_birth"]
			);
			expect(items).toHaveLength(0);
		});
	});

	// ---------- IP Address ----------
	describe("IP address detection", () => {
		it("should detect a valid IPv4 address", async () => {
			const items = await regexDetector.detect(
				"Server IP: 192.168.1.1",
				["ip_address"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("ip_address");
			expect(items[0]!.value).toBe("192.168.1.1");
			expect(items[0]!.confidence).toBe(0.9);
		});

		it("should detect 0.0.0.0", async () => {
			const items = await regexDetector.detect(
				"Address: 0.0.0.0",
				["ip_address"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect 255.255.255.255", async () => {
			const items = await regexDetector.detect(
				"Broadcast: 255.255.255.255",
				["ip_address"]
			);
			expect(items).toHaveLength(1);
		});

		it("should reject IP with octet > 255", async () => {
			const items = await regexDetector.detect(
				"Address: 256.100.100.100",
				["ip_address"]
			);
			expect(items).toHaveLength(0);
		});
	});

	// ---------- Bank Account ----------
	describe("Bank account detection", () => {
		it("should detect account number with 'account' prefix", async () => {
			const items = await regexDetector.detect(
				"Account: 12345678901",
				["bank_account"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("bank_account");
			expect(items[0]!.confidence).toBe(0.7);
		});

		it("should detect account number with 'acct' prefix", async () => {
			const items = await regexDetector.detect(
				"Acct# 987654321012",
				["bank_account"]
			);
			expect(items).toHaveLength(1);
		});

		it("should not detect without account prefix", async () => {
			const items = await regexDetector.detect(
				"Number: 12345678901",
				["bank_account"]
			);
			expect(items).toHaveLength(0);
		});
	});

	// ---------- Passport ----------
	describe("Passport detection", () => {
		it("should detect passport number", async () => {
			const items = await regexDetector.detect(
				"Passport# 123456789",
				["passport"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("passport");
			expect(items[0]!.confidence).toBe(0.75);
		});

		it("should detect passport with alpha-numeric value", async () => {
			const items = await regexDetector.detect(
				"Passport: AB123456",
				["passport"]
			);
			expect(items).toHaveLength(1);
		});
	});

	// ---------- Driver's License ----------
	describe("Driver's license detection", () => {
		it("should detect driver's license number", async () => {
			const items = await regexDetector.detect(
				"Driver's License: D1234567",
				["driver_license"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("driver_license");
			expect(items[0]!.confidence).toBe(0.7);
		});

		it("should detect DL abbreviation", async () => {
			const items = await regexDetector.detect(
				"DL# A12345678",
				["driver_license"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect drivers license without apostrophe", async () => {
			const items = await regexDetector.detect(
				"Drivers License: X9876543",
				["driver_license"]
			);
			expect(items).toHaveLength(1);
		});
	});

	// ---------- Medical ID ----------
	describe("Medical ID detection", () => {
		it("should detect MRN", async () => {
			const items = await regexDetector.detect(
				"MRN: ABC123456",
				["medical_id"]
			);
			expect(items).toHaveLength(1);
			expect(items[0]!.type).toBe("medical_id");
			expect(items[0]!.confidence).toBe(0.7);
		});

		it("should detect medical record number", async () => {
			const items = await regexDetector.detect(
				"Medical Record: MR-12345678",
				["medical_id"]
			);
			expect(items).toHaveLength(1);
		});

		it("should detect patient ID", async () => {
			const items = await regexDetector.detect(
				"Patient ID: P123456",
				["medical_id"]
			);
			expect(items).toHaveLength(1);
		});
	});

	// ---------- Type filtering ----------
	describe("Type filtering", () => {
		it("should only detect requested types", async () => {
			const text = "SSN 123-45-6789, email user@test.com";
			const ssnOnly = await regexDetector.detect(text, ["ssn"]);
			expect(ssnOnly).toHaveLength(1);
			expect(ssnOnly[0]!.type).toBe("ssn");

			const emailOnly = await regexDetector.detect(text, ["email"]);
			expect(emailOnly).toHaveLength(1);
			expect(emailOnly[0]!.type).toBe("email");
		});

		it("should detect multiple types simultaneously", async () => {
			const text = "SSN 123-45-6789, email user@test.com, IP 10.0.0.1";
			const items = await regexDetector.detect(text, ["ssn", "email", "ip_address"]);
			expect(items).toHaveLength(3);
			const types = items.map((i) => i.type).sort();
			expect(types).toEqual(["email", "ip_address", "ssn"]);
		});
	});

	// ---------- Position tracking ----------
	describe("Position tracking", () => {
		it("should return accurate start/end positions", async () => {
			const text = "My email is test@example.com ok?";
			const items = await regexDetector.detect(text, ["email"]);
			expect(items).toHaveLength(1);
			const item = items[0]!;
			expect(text.slice(item.position.start, item.position.end)).toBe(
				"test@example.com"
			);
		});
	});
});

// ============================================================================
// Address Detection (via regexDetector)
// ============================================================================

describe("Address detection", () => {
	it("should detect a US address", async () => {
		const items = await regexDetector.detect(
			"I live at 123 Main Street, Springfield, IL 62701",
			["address"]
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.type).toBe("address");
		expect(items[0]!.confidence).toBe(0.7);
	});

	it("should detect address with abbreviated street type", async () => {
		const items = await regexDetector.detect(
			"Office: 456 Oak Ave, Portland, OR 97201",
			["address"]
		);
		expect(items).toHaveLength(1);
	});

	it("should detect address with zip+4", async () => {
		const items = await regexDetector.detect(
			"Ship to 789 Elm Blvd, Austin, TX 78701-1234",
			["address"]
		);
		expect(items).toHaveLength(1);
	});

	it("should not detect non-address text", async () => {
		const items = await regexDetector.detect(
			"The quick brown fox jumps",
			["address"]
		);
		expect(items).toHaveLength(0);
	});
});

// ============================================================================
// Name Detection (via regexDetector)
// ============================================================================

describe("Name detection", () => {
	it("should detect name with Mr. prefix", async () => {
		const items = await regexDetector.detect(
			"Mr. John Smith, welcome",
			["name"]
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.type).toBe("name");
		// The name regex captures what follows the prefix up to word boundary
		expect(items[0]!.value).toContain("John");
		expect(items[0]!.value).toContain("Smith");
		expect(items[0]!.confidence).toBe(0.6);
	});

	it("should detect name with 'name is' prefix", async () => {
		const items = await regexDetector.detect(
			"My name is Jane Doe.",
			["name"]
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.value).toContain("Jane");
		expect(items[0]!.value).toContain("Doe");
	});

	it("should detect name with Dr prefix", async () => {
		const items = await regexDetector.detect(
			"Dr. Alice Johnson, MD",
			["name"]
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.value).toContain("Alice");
		expect(items[0]!.value).toContain("Johnson");
	});

	it("should detect name with Dear prefix", async () => {
		const items = await regexDetector.detect(
			"Dear Sarah Connor, thank you",
			["name"]
		);
		expect(items).toHaveLength(1);
		expect(items[0]!.value).toContain("Sarah");
		expect(items[0]!.value).toContain("Connor");
	});

	it("should not detect names without context prefix", async () => {
		const items = await regexDetector.detect(
			"Alice and Bob went to the store",
			["name"]
		);
		expect(items).toHaveLength(0);
	});
});

// ============================================================================
// redactPII()
// ============================================================================

describe("redactPII()", () => {
	const sampleText = "SSN is 123-45-6789, email user@test.com ok";
	//                  0123456789012345678901234567890123456789012
	//                  SSN starts at 7 (len 11 -> end 18)
	//                  email starts at 26 (len 13 -> end 39)
	const sampleItems: DetectedPII[] = [
		{
			type: "ssn",
			value: "123-45-6789",
			position: { start: 7, end: 18 },
			confidence: 0.95,
		},
		{
			type: "email",
			value: "user@test.com",
			position: { start: 26, end: 39 },
			confidence: 0.9,
		},
	];

	it("should redact with 'placeholder' style", () => {
		const result = redactPII(sampleText, sampleItems, "placeholder");
		expect(result).toBe("SSN is [REDACTED], email [REDACTED] ok");
	});

	it("should redact with 'typed' style (default)", () => {
		const result = redactPII(sampleText, sampleItems, "typed");
		expect(result).toBe("SSN is [SSN], email [EMAIL] ok");
	});

	it("should default to 'typed' style when no style provided", () => {
		const result = redactPII(sampleText, sampleItems);
		expect(result).toBe("SSN is [SSN], email [EMAIL] ok");
	});

	it("should redact with 'masked' style", () => {
		const result = redactPII(sampleText, sampleItems, "masked");
		// 123-45-6789 is 11 chars -> 11 asterisks, user@test.com is 13 chars -> 13 asterisks
		expect(result).toBe("SSN is ***********, email ************* ok");
	});

	it("should redact with 'hashed' style", () => {
		const result = redactPII(sampleText, sampleItems, "hashed");
		// Hashes should be deterministic - FNV-1a produces 8-char hex strings
		expect(result).toMatch(/SSN is \[HASH:[0-9a-f]{8}\], email \[HASH:[0-9a-f]{8}\] ok/);
	});

	it("should produce deterministic hashes for same input", () => {
		const result1 = redactPII(sampleText, sampleItems, "hashed");
		const result2 = redactPII(sampleText, sampleItems, "hashed");
		expect(result1).toBe(result2);
	});

	it("should handle empty items array", () => {
		const result = redactPII("no pii here", [], "typed");
		expect(result).toBe("no pii here");
	});

	it("should handle items provided in any order", () => {
		const reversed = [...sampleItems].reverse();
		const result = redactPII(sampleText, reversed, "typed");
		expect(result).toBe("SSN is [SSN], email [EMAIL] ok");
	});
});

// ============================================================================
// createEnhancedPIIGuardrail()
// ============================================================================

describe("createEnhancedPIIGuardrail()", () => {
	it("should block by default when PII is detected", async () => {
		const guardrail = createEnhancedPIIGuardrail();
		const result = await guardrail(
			{ input: "My SSN is 123-45-6789", agentName: "test" },
			ctx
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("ssn");
	});

	it("should pass when no PII is found", async () => {
		const guardrail = createEnhancedPIIGuardrail();
		const result = await guardrail(
			{ input: "Hello world, just a normal message", agentName: "test" },
			ctx
		);
		expect(result.passed).toBe(true);
		expect(result.reason).toBeUndefined();
	});

	// ---------- redact mode ----------
	describe("redact mode", () => {
		it("should pass with transformed text when redact is true", async () => {
			const guardrail = createEnhancedPIIGuardrail({ redact: true });
			const result = await guardrail(
				{ input: "My SSN is 123-45-6789", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
			expect(result.transformed).toBe("My SSN is [SSN]");
		});

		it("should use specified redaction style", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				redact: true,
				redactionStyle: "placeholder",
			});
			const result = await guardrail(
				{ input: "My SSN is 123-45-6789", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
			expect(result.transformed).toBe("My SSN is [REDACTED]");
		});
	});

	// ---------- minConfidence ----------
	describe("minConfidence", () => {
		it("should ignore items below minConfidence", async () => {
			// Phone has confidence 0.8; setting minConfidence to 0.9 should skip it
			const guardrail = createEnhancedPIIGuardrail({
				types: ["phone"],
				minConfidence: 0.9,
			});
			const result = await guardrail(
				{ input: "Call (555) 123-4567", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
		});

		it("should detect items at or above minConfidence", async () => {
			// SSN has confidence 0.95
			const guardrail = createEnhancedPIIGuardrail({
				types: ["ssn"],
				minConfidence: 0.95,
			});
			const result = await guardrail(
				{ input: "SSN is 123-45-6789", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(false);
		});
	});

	// ---------- allowlist ----------
	describe("allowlist", () => {
		it("should not flag allowlisted values", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				types: ["email"],
				allowlist: ["noreply@example.com"],
			});
			const result = await guardrail(
				{ input: "Send to noreply@example.com", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
		});

		it("should be case-insensitive for allowlist", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				types: ["email"],
				allowlist: ["NoReply@Example.COM"],
			});
			const result = await guardrail(
				{ input: "Send to noreply@example.com", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
		});

		it("should still flag non-allowlisted values", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				types: ["email"],
				allowlist: ["allowed@example.com"],
			});
			const result = await guardrail(
				{ input: "Send to secret@other.com", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(false);
		});
	});

	// ---------- minItemsToBlock ----------
	describe("minItemsToBlock", () => {
		it("should pass if detected items are below threshold", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				types: ["email"],
				minItemsToBlock: 2,
			});
			const result = await guardrail(
				{ input: "Email: user@test.com", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(true);
		});

		it("should block if detected items meet threshold", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				types: ["email"],
				minItemsToBlock: 2,
			});
			const result = await guardrail(
				{ input: "Email: a@b.com and c@d.com", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(false);
		});
	});

	// ---------- onDetected callback ----------
	describe("onDetected callback", () => {
		it("should call onDetected when PII is found", async () => {
			const onDetected = vi.fn();
			const guardrail = createEnhancedPIIGuardrail({
				types: ["ssn"],
				onDetected,
			});
			await guardrail(
				{ input: "SSN 123-45-6789", agentName: "test" },
				ctx
			);
			expect(onDetected).toHaveBeenCalledTimes(1);
			expect(onDetected).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ type: "ssn" }),
				])
			);
		});

		it("should not call onDetected when no PII is found", async () => {
			const onDetected = vi.fn();
			const guardrail = createEnhancedPIIGuardrail({
				types: ["ssn"],
				onDetected,
			});
			await guardrail(
				{ input: "Just a normal message", agentName: "test" },
				ctx
			);
			expect(onDetected).not.toHaveBeenCalled();
		});

		it("should not call onDetected when items are below minConfidence", async () => {
			const onDetected = vi.fn();
			const guardrail = createEnhancedPIIGuardrail({
				types: ["phone"],
				minConfidence: 0.99,
				onDetected,
			});
			await guardrail(
				{ input: "Call (555) 123-4567", agentName: "test" },
				ctx
			);
			expect(onDetected).not.toHaveBeenCalled();
		});
	});

	// ---------- custom detector ----------
	describe("custom detector", () => {
		it("should use a custom detector", async () => {
			const customDetector: PIIDetector = {
				name: "custom",
				async detect(text: string): Promise<DetectedPII[]> {
					if (text.includes("SECRET")) {
						return [
							{
								type: "national_id",
								value: "SECRET",
								position: { start: text.indexOf("SECRET"), end: text.indexOf("SECRET") + 6 },
								confidence: 1.0,
							},
						];
					}
					return [];
				},
			};
			const guardrail = createEnhancedPIIGuardrail({
				detector: customDetector,
				types: ["national_id"],
			});
			const result = await guardrail(
				{ input: "Data: SECRET", agentName: "test" },
				ctx
			);
			expect(result.passed).toBe(false);
			expect(result.reason).toContain("national_id");
		});
	});

	// ---------- detectorTimeout ----------
	describe("detectorTimeout", () => {
		it("should throw on timeout for custom detector", async () => {
			const slowDetector: PIIDetector = {
				name: "slow",
				async detect(): Promise<DetectedPII[]> {
					return new Promise((resolve) => setTimeout(() => resolve([]), 10_000));
				},
			};
			const guardrail = createEnhancedPIIGuardrail({
				detector: slowDetector,
				detectorTimeout: 50,
			});
			await expect(
				guardrail({ input: "test", agentName: "test" }, ctx)
			).rejects.toThrow("timed out after 50ms");
		});

		it("should not timeout the built-in regex detector", async () => {
			const guardrail = createEnhancedPIIGuardrail({
				detector: "regex",
				detectorTimeout: 1, // extremely short but should still work
			});
			const result = await guardrail(
				{ input: "SSN 123-45-6789", agentName: "test" },
				ctx
			);
			// Should not throw - regex detector bypasses timeout
			expect(result.passed).toBe(false);
		});
	});

	// ---------- type counts in reason ----------
	it("should include type counts in the blocked reason", async () => {
		const guardrail = createEnhancedPIIGuardrail({
			types: ["ssn", "email"],
		});
		const result = await guardrail(
			{
				input: "SSN 123-45-6789 and 234-56-7890 email test@x.com",
				agentName: "test",
			},
			ctx
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("ssn: 2");
		expect(result.reason).toContain("email: 1");
	});
});

// ============================================================================
// createOutputPIIGuardrail()
// ============================================================================

describe("createOutputPIIGuardrail()", () => {
	it("should block output containing PII", async () => {
		const guardrail = createOutputPIIGuardrail({ types: ["ssn"] });
		const result = await guardrail(
			{
				output: "Your SSN is 123-45-6789",
				agentName: "test",
				input: "What is my SSN?",
				messages: [],
			},
			ctx
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("ssn");
	});

	it("should pass output without PII", async () => {
		const guardrail = createOutputPIIGuardrail({ types: ["ssn"] });
		const result = await guardrail(
			{
				output: "I cannot share that information.",
				agentName: "test",
				input: "What is my SSN?",
				messages: [],
			},
			ctx
		);
		expect(result.passed).toBe(true);
	});

	it("should handle non-string output by JSON stringifying", async () => {
		const guardrail = createOutputPIIGuardrail({ types: ["ssn"] });
		const result = await guardrail(
			{
				output: { ssn: "123-45-6789", name: "Test" },
				agentName: "test",
				input: "Give data",
				messages: [],
			},
			ctx
		);
		expect(result.passed).toBe(false);
	});

	it("should support redact mode on output", async () => {
		const guardrail = createOutputPIIGuardrail({
			types: ["email"],
			redact: true,
		});
		const result = await guardrail(
			{
				output: "Contact user@example.com for details",
				agentName: "test",
				input: "Who to contact?",
				messages: [],
			},
			ctx
		);
		expect(result.passed).toBe(true);
		expect(result.transformed).toBe("Contact [EMAIL] for details");
	});
});

// ============================================================================
// detectPII() utility
// ============================================================================

describe("detectPII()", () => {
	it("should detect PII and return structured result", async () => {
		const result = await detectPII("My SSN is 123-45-6789");
		expect(result.detected).toBe(true);
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.type).toBe("ssn");
		expect(result.typeCounts).toEqual({ ssn: 1 });
	});

	it("should return not detected for clean text", async () => {
		const result = await detectPII("Hello world");
		expect(result.detected).toBe(false);
		expect(result.items).toHaveLength(0);
		expect(result.typeCounts).toEqual({});
	});

	it("should filter by confidence", async () => {
		// Phone confidence is 0.8, bank_account is 0.7
		const result = await detectPII("Call (555) 123-4567", {
			types: ["phone"],
			minConfidence: 0.9,
		});
		expect(result.detected).toBe(false);
		expect(result.items).toHaveLength(0);
	});

	it("should accept types filter", async () => {
		const text = "SSN 123-45-6789, email test@x.com";
		const result = await detectPII(text, { types: ["email"] });
		expect(result.items).toHaveLength(1);
		expect(result.items[0]!.type).toBe("email");
	});

	it("should detect multiple types and provide typeCounts", async () => {
		const text = "SSN 123-45-6789, SSN 234-56-7890, email a@b.com";
		const result = await detectPII(text, { types: ["ssn", "email"] });
		expect(result.detected).toBe(true);
		expect(result.typeCounts).toEqual({ ssn: 2, email: 1 });
	});

	it("should use custom detector when provided", async () => {
		const customDetector: PIIDetector = {
			name: "custom-test",
			async detect(): Promise<DetectedPII[]> {
				return [
					{
						type: "national_id",
						value: "CUSTOM123",
						position: { start: 0, end: 9 },
						confidence: 0.99,
					},
				];
			},
		};
		const result = await detectPII("anything", {
			detector: customDetector,
			types: ["national_id"],
		});
		expect(result.detected).toBe(true);
		expect(result.items[0]!.value).toBe("CUSTOM123");
	});

	it("should timeout custom detector per timeout option", async () => {
		const slowDetector: PIIDetector = {
			name: "slow-test",
			async detect(): Promise<DetectedPII[]> {
				return new Promise((resolve) => setTimeout(() => resolve([]), 10_000));
			},
		};
		await expect(
			detectPII("test", { detector: slowDetector, timeout: 50 })
		).rejects.toThrow("timed out after 50ms");
	});
});

// ============================================================================
// Input Length Limit (100KB)
// ============================================================================

describe("Input length limit", () => {
	it("should throw on input exceeding 100KB", async () => {
		const hugeInput = "a".repeat(100_001);
		await expect(
			regexDetector.detect(hugeInput, ["ssn"])
		).rejects.toThrow("exceeds maximum length");
	});

	it("should accept input at exactly 100KB", async () => {
		const maxInput = "a".repeat(100_000);
		const items = await regexDetector.detect(maxInput, ["ssn"]);
		// Should not throw, just return empty (no SSN in repeated 'a')
		expect(items).toHaveLength(0);
	});
});

// ============================================================================
// Clean Inputs (should pass)
// ============================================================================

describe("Clean inputs", () => {
	const cleanTexts = [
		"Hello, how are you today?",
		"The weather in New York is sunny.",
		"Please review the quarterly report.",
		"Version 2.0 was released on Monday.",
		"The meeting is at 3:00 PM.",
		"Order #12345 has been shipped.",
		"Your confirmation code is ABC123.",
	];

	for (const text of cleanTexts) {
		it(`should pass clean input: "${text}"`, async () => {
			const result = await detectPII(text);
			expect(result.detected).toBe(false);
		});
	}
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
	it("should handle empty input", async () => {
		const items = await regexDetector.detect("", ALL_TYPES);
		expect(items).toHaveLength(0);
	});

	it("should handle input with only whitespace", async () => {
		const items = await regexDetector.detect("   \n\t  ", ALL_TYPES);
		expect(items).toHaveLength(0);
	});

	it("should handle overlapping PII in text", async () => {
		// An SSN could overlap with a phone pattern in edge cases
		// Test that both detectors find their respective matches
		const text = "SSN 123-45-6789 phone (555) 123-4567";
		const items = await regexDetector.detect(text, ["ssn", "phone"]);
		const types = items.map((i) => i.type);
		expect(types).toContain("ssn");
		expect(types).toContain("phone");
	});

	it("should handle special characters in surrounding text", async () => {
		const items = await regexDetector.detect(
			"<div>SSN: 123-45-6789</div>",
			["ssn"]
		);
		expect(items).toHaveLength(1);
	});

	it("should handle PII at the very start of input", async () => {
		const items = await regexDetector.detect("123-45-6789 is exposed", ["ssn"]);
		expect(items).toHaveLength(1);
		expect(items[0]!.position.start).toBe(0);
	});

	it("should handle PII at the very end of input", async () => {
		const items = await regexDetector.detect("My SSN is 123-45-6789", ["ssn"]);
		expect(items).toHaveLength(1);
	});

	it("should include context in detected items", async () => {
		const text = "Some prefix text 123-45-6789 some suffix";
		const items = await regexDetector.detect(text, ["ssn"]);
		expect(items).toHaveLength(1);
		expect(items[0]!.context).toBeDefined();
		expect(items[0]!.context!.length).toBeGreaterThan(0);
	});

	it("should handle redacting adjacent PII items", () => {
		const text = "AB";
		const items: DetectedPII[] = [
			{
				type: "ssn",
				value: "A",
				position: { start: 0, end: 1 },
				confidence: 0.95,
			},
			{
				type: "email",
				value: "B",
				position: { start: 1, end: 2 },
				confidence: 0.9,
			},
		];
		const result = redactPII(text, items, "typed");
		expect(result).toBe("[SSN][EMAIL]");
	});

	it("should handle the guardrail with default options (no args)", async () => {
		const guardrail = createEnhancedPIIGuardrail();
		const result = await guardrail(
			{ input: "Nothing here", agentName: "test" },
			ctx
		);
		expect(result.passed).toBe(true);
	});
});
