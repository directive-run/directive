/**
 * Enhanced PII Detection Guardrail
 *
 * Provides comprehensive PII detection beyond basic regex patterns:
 * - Multiple PII types (SSN, credit cards, emails, phones, addresses, names)
 * - Pluggable detection backends (regex, custom, or external services)
 * - Context-aware detection (reduces false positives)
 * - Redaction with reversible or irreversible options
 *
 * @example
 * ```typescript
 * import { createEnhancedPIIGuardrail } from '@directive-run/ai';
 *
 * const guardrail = createEnhancedPIIGuardrail({
 *   types: ['ssn', 'credit_card', 'email'],
 *   redact: true,
 *   detector: 'regex', // or 'custom' with custom detector
 * });
 * ```
 */

import type {
  GuardrailFn,
  GuardrailResult,
  InputGuardrailData,
  OutputGuardrailData,
} from "../types.js";

// ============================================================================
// PII Types
// ============================================================================

/** Supported PII types */
export type PIIType =
  | "ssn" // Social Security Number
  | "credit_card" // Credit/debit card numbers
  | "email" // Email addresses
  | "phone" // Phone numbers (various formats)
  | "address" // Physical addresses
  | "name" // Personal names (requires context)
  | "date_of_birth" // Birth dates
  | "passport" // Passport numbers
  | "driver_license" // Driver's license numbers
  | "ip_address" // IP addresses
  | "bank_account" // Bank account numbers
  | "medical_id" // Medical record numbers
  | "national_id"; // Non-US national IDs

/** Detected PII instance */
export interface DetectedPII {
  type: PIIType;
  value: string;
  position: { start: number; end: number };
  confidence: number; // 0-1
  context?: string; // Surrounding text for debugging
}

/** PII detection result */
export interface PIIDetectionResult {
  detected: boolean;
  items: DetectedPII[];
  typeCounts: Partial<Record<PIIType, number>>;
  /** Text with PII redacted (if requested) */
  redactedText?: string;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/** PII pattern with validation */
interface PIIPattern {
  type: PIIType;
  pattern: RegExp;
  /** Additional validation function (reduces false positives) */
  validate?: (match: string, context: string) => boolean;
  /** Confidence score (0-1) */
  confidence: number;
}

/** Comprehensive PII patterns */
const PII_PATTERNS: PIIPattern[] = [
  // SSN - US Social Security Number
  {
    type: "ssn",
    pattern: /\b(\d{3}[-\s]?\d{2}[-\s]?\d{4})\b/g,
    validate: (match) => {
      // Remove separators and validate format
      const digits = match.replace(/[-\s]/g, "");
      // SSN cannot start with 000, 666, or 9xx
      if (
        digits.startsWith("000") ||
        digits.startsWith("666") ||
        digits.startsWith("9")
      ) {
        return false;
      }
      // Middle 2 digits cannot be 00
      if (digits.slice(3, 5) === "00") {
        return false;
      }
      // Last 4 digits cannot be 0000
      if (digits.slice(5) === "0000") {
        return false;
      }
      return true;
    },
    confidence: 0.95,
  },

  // Credit Card Numbers (Luhn validated)
  {
    type: "credit_card",
    pattern: /\b(\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})\b|\b(\d{15,16})\b/g,
    validate: (match) => {
      const digits = match.replace(/[-\s]/g, "");
      if (digits.length < 13 || digits.length > 19) return false;
      // Luhn algorithm
      let sum = 0;
      let isEven = false;
      for (let i = digits.length - 1; i >= 0; i--) {
        const char = digits[i];
        if (!char) continue;
        let digit = Number.parseInt(char, 10);
        if (isEven) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        isEven = !isEven;
      }
      return sum % 10 === 0;
    },
    confidence: 0.95,
  },

  // Email addresses
  {
    type: "email",
    pattern: /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi,
    confidence: 0.9,
  },

  // Phone numbers (US and international formats)
  {
    type: "phone",
    // Matches various formats: (555) 555-5555, 555-555-5555, +1 555 555 5555, etc.
    pattern: /\b(\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4})\b/g,
    validate: (match) => {
      const digits = match.replace(/\D/g, "");
      // US numbers should be 10 or 11 digits
      return digits.length >= 10 && digits.length <= 11;
    },
    confidence: 0.8,
  },

  // Date of birth patterns
  {
    type: "date_of_birth",
    // Various formats: MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY
    pattern:
      /\b(born|dob|birth.?date|date.?of.?birth)[:.\s]+(\d{1,4}[-/]\d{1,2}[-/]\d{1,4})\b/gi,
    confidence: 0.85,
  },

  // IP addresses
  {
    type: "ip_address",
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    validate: (match) => {
      const parts = match.split(".");
      return parts.every((p) => {
        const num = Number.parseInt(p, 10);
        return num >= 0 && num <= 255;
      });
    },
    confidence: 0.9,
  },

  // Bank account numbers (generic)
  {
    type: "bank_account",
    // Account number followed by routing or preceded by "account"
    pattern: /\b(account|acct)[\s#:]+(\d{8,17})\b/gi,
    confidence: 0.7,
  },

  // Passport numbers (various countries)
  {
    type: "passport",
    // US passports: 9 digits, UK: 9 digits, etc.
    pattern: /\b(passport)[\s#:]+([A-Z0-9]{6,9})\b/gi,
    confidence: 0.75,
  },

  // Driver's license (US - state specific patterns would be better)
  {
    type: "driver_license",
    pattern: /\b(driver'?s?\s*licen[cs]e|dl)[\s#:]+([A-Z0-9]{5,15})\b/gi,
    confidence: 0.7,
  },

  // Medical record numbers
  {
    type: "medical_id",
    pattern: /\b(mrn|medical.?record|patient.?id)[\s#:]+([A-Z0-9-]{6,15})\b/gi,
    confidence: 0.7,
  },
];

// ============================================================================
// Address Detection
// ============================================================================

/** Detect US physical addresses */
function detectAddresses(text: string): DetectedPII[] {
  const results: DetectedPII[] = [];

  // Simplified US address pattern to avoid ReDoS
  // Matches: "123 Main Street, City, CA 12345" or similar
  // Uses possessive-like matching and limits word count to prevent catastrophic backtracking
  const streetTypes =
    "street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|way|boulevard|blvd|circle|cir|place|pl";
  const addressPattern = new RegExp(
    `\\b(\\d{1,5}\\s+(?:\\w+\\s+){1,4}(?:${streetTypes})\\b[^\\n]{0,50}\\b[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?)\\b`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = addressPattern.exec(text)) !== null) {
    results.push({
      type: "address",
      value: match[0],
      position: { start: match.index, end: match.index + match[0].length },
      confidence: 0.7, // Lower confidence due to simpler pattern
    });
  }

  return results;
}

// ============================================================================
// Name Detection (Context-Aware)
// ============================================================================

/** Common prefixes that indicate names */
const NAME_PREFIXES = [
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "prof",
  "sir",
  "madam",
  "name is",
  "called",
  "known as",
  "signed by",
  "from",
  "dear",
  "hi",
  "hello",
  "contact",
  "recipient",
];

/** Detect personal names (requires context) */
function detectNames(text: string): DetectedPII[] {
  const results: DetectedPII[] = [];

  // Simplified name pattern to avoid ReDoS
  // Matches: "Mr. John Smith" or "name is Jane Doe"
  // Uses non-capturing groups and limits repetition
  const prefixPattern = NAME_PREFIXES.join("|");
  const nameRegex = new RegExp(
    `\\b(${prefixPattern})[.,:]?\\s+([A-Z][a-z]{1,20}(?:\\s[A-Z][a-z]{1,20}){0,2})\\b`,
    "gi",
  );

  let match: RegExpExecArray | null;

  while ((match = nameRegex.exec(text)) !== null) {
    const name = match[2];
    const prefix = match[1];
    // Skip if name is undefined
    if (!name) continue;
    // Ignore single-word names that might be common words
    if (
      name.split(/\s+/).length >= 2 ||
      (prefix && NAME_PREFIXES.some((p) => prefix.toLowerCase().includes(p)))
    ) {
      results.push({
        type: "name",
        value: name,
        position: { start: match.index, end: match.index + match[0].length },
        confidence: 0.6,
        context: match[0],
      });
    }
  }

  return results;
}

// ============================================================================
// Detection Backend Types
// ============================================================================

/** Maximum input length for PII detection (100KB) */
const MAX_PII_INPUT_LENGTH = 100_000;

/** Custom PII detector interface */
export interface PIIDetector {
  detect(text: string, types: PIIType[]): Promise<DetectedPII[]>;
  name: string;
}

/** Built-in regex detector */
export const regexDetector: PIIDetector = {
  name: "regex",
  async detect(text: string, types: PIIType[]): Promise<DetectedPII[]> {
    // Security: Prevent DoS via extremely large inputs
    if (text.length > MAX_PII_INPUT_LENGTH) {
      throw new Error(
        `[Directive] Input exceeds maximum length of ${MAX_PII_INPUT_LENGTH} characters for PII detection. ` +
          "Truncate input or process in chunks.",
      );
    }

    const results: DetectedPII[] = [];
    const typeSet = new Set(types);

    // Pattern-based detection
    for (const pattern of PII_PATTERNS) {
      if (!typeSet.has(pattern.type)) continue;

      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const value = match[1] || match[0];
        const context = text.slice(
          Math.max(0, match.index - 20),
          match.index + value.length + 20,
        );

        // Apply validation if present
        if (pattern.validate && !pattern.validate(value, context)) {
          continue;
        }

        results.push({
          type: pattern.type,
          value,
          position: { start: match.index, end: match.index + value.length },
          confidence: pattern.confidence,
          context,
        });
      }
    }

    // Address detection (separate logic)
    if (typeSet.has("address")) {
      results.push(...detectAddresses(text));
    }

    // Name detection (context-aware)
    if (typeSet.has("name")) {
      results.push(...detectNames(text));
    }

    return results;
  },
};

// ============================================================================
// Redaction Functions
// ============================================================================

/** Redaction style */
export type RedactionStyle =
  /** Replace with [REDACTED] */
  | "placeholder"
  /** Replace with type-specific placeholder like [EMAIL] */
  | "typed"
  /** Replace with asterisks preserving length */
  | "masked"
  /** Replace with hash for reversible redaction */
  | "hashed";

/** Redact detected PII from text */
export function redactPII(
  text: string,
  items: DetectedPII[],
  style: RedactionStyle = "typed",
): string {
  // Sort by position descending to avoid offset issues
  const sorted = [...items].sort((a, b) => b.position.start - a.position.start);

  let result = text;
  for (const item of sorted) {
    let replacement: string;

    switch (style) {
      case "placeholder":
        replacement = "[REDACTED]";
        break;
      case "typed":
        replacement = `[${item.type.toUpperCase()}]`;
        break;
      case "masked":
        replacement = "*".repeat(item.value.length);
        break;
      case "hashed":
        // FNV-1a hash for referential integrity (not for security)
        // Same input always produces same hash, useful for audit trails
        replacement = `[HASH:${fnv1aHash(item.value)}]`;
        break;
    }

    result =
      result.slice(0, item.position.start) +
      replacement +
      result.slice(item.position.end);
  }

  return result;
}

/**
 * FNV-1a hash function for referential integrity.
 *
 * **Note:** This is NOT a cryptographic hash. It's designed for:
 * - Consistent redaction references (same PII → same hash)
 * - Audit trail correlation (track redacted values across logs)
 *
 * For security-sensitive hashing, use Web Crypto API externally.
 *
 * @see https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
function fnv1aHash(str: string): string {
  // FNV-1a 32-bit parameters
  const FNV_PRIME = 0x01000193;
  const FNV_OFFSET = 0x811c9dc5;

  let hash = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  // Convert to unsigned 32-bit and return as hex
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ============================================================================
// Guardrail Factory
// ============================================================================

/** Options for enhanced PII guardrail */
export interface EnhancedPIIGuardrailOptions {
  /** PII types to detect (default: all) */
  types?: PIIType[];
  /** Detection backend (default: 'regex') */
  detector?: "regex" | PIIDetector;
  /** Redact instead of blocking */
  redact?: boolean;
  /** Redaction style (default: 'typed') */
  redactionStyle?: RedactionStyle;
  /** Minimum confidence to flag (0-1, default: 0.7) */
  minConfidence?: number;
  /** Callback when PII is detected */
  onDetected?: (items: DetectedPII[]) => void;
  /** Allow specific values (whitelist) */
  allowlist?: string[];
  /** Block only if count exceeds threshold */
  minItemsToBlock?: number;
  /** Timeout for custom detector in milliseconds (default: 5000) */
  detectorTimeout?: number;
}

/** Default PII types to detect */
const DEFAULT_PII_TYPES: PIIType[] = [
  "ssn",
  "credit_card",
  "email",
  "phone",
  "date_of_birth",
  "bank_account",
];

/**
 * Create an enhanced PII detection guardrail.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const guardrail = createEnhancedPIIGuardrail();
 *
 * // Redact instead of blocking
 * const redactGuardrail = createEnhancedPIIGuardrail({
 *   redact: true,
 *   redactionStyle: 'masked',
 * });
 *
 * // Custom detection with external service
 * const customGuardrail = createEnhancedPIIGuardrail({
 *   detector: myPresidioDetector,
 *   types: ['ssn', 'credit_card', 'medical_id'],
 * });
 * ```
 */
export function createEnhancedPIIGuardrail(
  options: EnhancedPIIGuardrailOptions = {},
): GuardrailFn<InputGuardrailData> {
  const {
    types = DEFAULT_PII_TYPES,
    detector = "regex",
    redact = false,
    redactionStyle = "typed",
    minConfidence = 0.7,
    onDetected,
    allowlist = [],
    minItemsToBlock = 1,
    detectorTimeout = 5000,
  } = options;

  const detectorInstance = detector === "regex" ? regexDetector : detector;
  // Normalize allowlist: lowercase and trim for consistent comparison
  const allowSet = new Set(allowlist.map((v) => v.toLowerCase().trim()));

  // Wrap detector with timeout to prevent DoS via slow external services
  async function detectWithTimeout(
    text: string,
    piiTypes: PIIType[],
  ): Promise<DetectedPII[]> {
    // Built-in regex detector doesn't need timeout (it's synchronous)
    if (detectorInstance === regexDetector) {
      return detectorInstance.detect(text, piiTypes);
    }

    // Custom detectors get a timeout
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        detectorInstance.detect(text, piiTypes),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `[Directive] PII detector '${detectorInstance.name}' timed out after ${detectorTimeout}ms`,
                ),
              ),
            detectorTimeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  return async (data): Promise<GuardrailResult> => {
    const items = await detectWithTimeout(data.input, types);

    // Filter by confidence and allowlist (normalize value for comparison)
    const filtered = items.filter((item) => {
      if (item.confidence < minConfidence) return false;
      // Normalize detected value for allowlist comparison
      if (allowSet.has(item.value.toLowerCase().trim())) return false;
      return true;
    });

    if (filtered.length > 0) {
      onDetected?.(filtered);
    }

    if (filtered.length >= minItemsToBlock) {
      if (redact) {
        const redactedText = redactPII(data.input, filtered, redactionStyle);
        return {
          passed: true,
          transformed: redactedText,
        };
      }

      const typeCounts: Record<string, number> = {};
      for (const item of filtered) {
        typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
      }

      const summary = Object.entries(typeCounts)
        .map(([type, count]) => `${type}: ${count}`)
        .join(", ");

      return {
        passed: false,
        reason: `PII detected (${summary})`,
      };
    }

    return { passed: true };
  };
}

/**
 * Create an output PII guardrail (for checking agent responses).
 *
 * @example
 * ```typescript
 * const outputGuardrail = createOutputPIIGuardrail({
 *   types: ['ssn', 'credit_card'],
 *   redact: true,
 * });
 * ```
 */
export function createOutputPIIGuardrail(
  options: EnhancedPIIGuardrailOptions = {},
): GuardrailFn<OutputGuardrailData> {
  const inputGuardrail = createEnhancedPIIGuardrail(options);

  return async (data, context): Promise<GuardrailResult> => {
    const text =
      typeof data.output === "string"
        ? data.output
        : JSON.stringify(data.output);

    return inputGuardrail({ input: text, agentName: data.agentName }, context);
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Detect PII in text without using as a guardrail.
 * Useful for analysis and logging.
 *
 * @example
 * ```typescript
 * const result = await detectPII('My SSN is 123-45-6789');
 * console.log(result.items); // [{ type: 'ssn', value: '123-45-6789', ... }]
 *
 * // With custom detector and timeout
 * const result = await detectPII(text, {
 *   detector: myPresidioDetector,
 *   timeout: 10000, // 10 seconds
 * });
 * ```
 */
export async function detectPII(
  text: string,
  options: {
    types?: PIIType[];
    detector?: "regex" | PIIDetector;
    minConfidence?: number;
    /** Timeout for custom detectors in milliseconds (default: 5000) */
    timeout?: number;
  } = {},
): Promise<PIIDetectionResult> {
  const {
    types = DEFAULT_PII_TYPES,
    detector = "regex",
    minConfidence = 0.7,
    timeout = 5000,
  } = options;

  const detectorInstance = detector === "regex" ? regexDetector : detector;

  // Apply timeout for custom detectors to prevent DoS
  let items: DetectedPII[];
  if (detectorInstance === regexDetector) {
    // Built-in regex detector is synchronous, no timeout needed
    items = await detectorInstance.detect(text, types);
  } else {
    // Custom detectors get a timeout
    let timer: ReturnType<typeof setTimeout>;
    try {
      items = await Promise.race([
        detectorInstance.detect(text, types),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `[Directive] PII detector '${detectorInstance.name}' timed out after ${timeout}ms`,
                ),
              ),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }

  const filtered = items.filter((item) => item.confidence >= minConfidence);

  const typeCounts: Partial<Record<PIIType, number>> = {};
  for (const item of filtered) {
    typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
  }

  return {
    detected: filtered.length > 0,
    items: filtered,
    typeCounts,
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  detectPII as detect,
  redactPII as redact,
  createEnhancedPIIGuardrail as create,
  createOutputPIIGuardrail as createOutput,
};
