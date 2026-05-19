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
  /**
   * Capture group holding the PII value itself. Defaults to 1.
   * Keyword-anchored patterns set this to 2 — group 1 is the keyword
   * ("account", "passport", …) and group 2 is the actual identifier.
   * The detector redacts the value group's span, never the keyword.
   */
  valueGroup?: number;
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
    // One capture group wraps both branches so the value group is always 1
    // (default valueGroup): the 4-4-4-4 separated grouping, or an unseparated
    // \d{13,19} run matching the Luhn validator's 13-19 range (previously
    // \d{15,16} left 13/14/17/18/19-digit PANs undetected).
    pattern: /\b((?:\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})|\d{13,19})\b/g,
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

  // Phone numbers (US/NANP only — not international)
  {
    type: "phone",
    // Matches US/NANP formats only: (555) 555-5555, 555-555-5555,
    // +1 555 555 5555. Does NOT support non-NANP international numbers.
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
    valueGroup: 2,
    confidence: 0.85,
  },

  // IP addresses (IPv4 only — IPv6 deferred)
  {
    type: "ip_address",
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    validate: (match) => {
      const parts = match.split(".");
      const octets = parts.map((p) => Number.parseInt(p, 10));
      // Each octet must be a valid 0-255 number
      if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
        return false;
      }
      const [a, b] = octets as [number, number, number, number];
      // Skip non-PII infrastructure noise: RFC1918 private ranges,
      // loopback, link-local, and the unspecified/broadcast addresses.
      if (a === 10) return false; // 10.0.0.0/8 private
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12 private
      if (a === 192 && b === 168) return false; // 192.168.0.0/16 private
      if (a === 127) return false; // 127.0.0.0/8 loopback
      if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local
      if (match === "0.0.0.0" || match === "255.255.255.255") return false;

      return true;
    },
    confidence: 0.9,
  },

  // Bank account numbers (generic)
  {
    type: "bank_account",
    // Account number followed by routing or preceded by "account"
    pattern: /\b(account|acct)[\s#:]+(\d{8,17})\b/gi,
    valueGroup: 2,
    confidence: 0.7,
  },

  // Passport numbers (various countries)
  {
    type: "passport",
    // US passports: 9 digits, UK: 9 digits, etc.
    pattern: /\b(passport)[\s#:]+([A-Z0-9]{6,9})\b/gi,
    valueGroup: 2,
    confidence: 0.75,
  },

  // Driver's license (US - state specific patterns would be better)
  {
    type: "driver_license",
    pattern: /\b(driver'?s?\s*licen[cs]e|dl)[\s#:]+([A-Z0-9]{5,15})\b/gi,
    valueGroup: 2,
    confidence: 0.7,
  },

  // Medical record numbers
  {
    type: "medical_id",
    pattern: /\b(mrn|medical.?record|patient.?id)[\s#:]+([A-Z0-9-]{6,15})\b/gi,
    valueGroup: 2,
    confidence: 0.7,
  },

  // National IDs (non-US) — keyword-anchored, alphanumeric ID 6-20 chars
  {
    type: "national_id",
    pattern:
      /\b(national.?id|nin|identity.?number|identity.?card|id.?number)[\s#:]+([A-Z0-9-]{6,20})\b/gi,
    valueGroup: 2,
    confidence: 0.85,
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

/**
 * Run a single PII pattern over `text` and collect every (validated) match.
 * Keyword-anchored patterns capture the value in group 2; the `d` flag gives
 * per-group indices so we redact the value's exact span, never the keyword.
 */
function matchPattern(pattern: PIIPattern, text: string): DetectedPII[] {
  const results: DetectedPII[] = [];
  const flags = pattern.pattern.flags.includes("d")
    ? pattern.pattern.flags
    : `${pattern.pattern.flags}d`;
  const regex = new RegExp(pattern.pattern.source, flags);
  const group = pattern.valueGroup ?? 1;
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
  while ((match = regex.exec(text)) !== null) {
    const value = match[group] ?? match[0];
    // Prefer the value group's real offsets; fall back to the whole match
    // only if indices are unavailable (older runtimes).
    const groupIndices = match.indices?.[group];
    const start = groupIndices ? groupIndices[0] : match.index;
    const end = groupIndices ? groupIndices[1] : match.index + value.length;
    const context = text.slice(Math.max(0, start - 20), end + 20);

    if (pattern.validate && !pattern.validate(value, context)) {
      continue;
    }

    results.push({
      type: pattern.type,
      value,
      position: { start, end },
      confidence: pattern.confidence,
      context,
    });
  }

  return results;
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
      if (typeSet.has(pattern.type)) {
        results.push(...matchPattern(pattern, text));
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
  /**
   * Replace with a fixed-width `****` mask plus the last 4 characters
   * (e.g. `****6789`). Does not preserve or reveal the original length.
   */
  | "masked"
  /**
   * Replace with a deterministic FNV-1a hash.
   *
   * **WARNING — this is PSEUDONYMIZATION, not anonymization.** FNV-1a is a
   * fast, non-cryptographic 32-bit hash. For low-entropy structured PII (SSNs,
   * card numbers, phone numbers) the output is trivially RE-IDENTIFIABLE via
   * brute force or a precomputed rainbow table. It MUST NOT be relied on for
   * GDPR / HIPAA de-identification. Use it only for referential integrity
   * (correlating the same value across audit logs).
   */
  | "hashed";

/**
 * PII types whose *category name* is itself sensitive. For these, `typed`
 * redaction emits a generic `[REDACTED]` instead of the type name so the
 * redacted text does not reveal that the user has, e.g., an SSN, a credit
 * card, a medical record, a passport, or a bank account on file. Only the
 * mundane contact/network types (email, phone, name, address, ip_address)
 * keep their `[TYPE]` label.
 */
const SENSITIVE_CATEGORY_TYPES: ReadonlySet<PIIType> = new Set<PIIType>([
  "ssn",
  "credit_card",
  "date_of_birth",
  "medical_id",
  "national_id",
  "passport",
  "driver_license",
  "bank_account",
]);

/** Whether a detected item's span is a valid, in-bounds slice of `text`. */
function hasValidSpan(item: DetectedPII, textLength: number): boolean {
  const { start, end } = item.position;

  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= textLength
  );
}

/** Build the replacement string for one detected item under a given style. */
function buildRedactionReplacement(
  item: DetectedPII,
  style: RedactionStyle,
): string {
  switch (style) {
    case "placeholder":
      return "[REDACTED]";
    case "typed":
      // FIX (category leak): for sensitive-category types, emit a generic
      // [REDACTED] — the category name itself would otherwise reveal the
      // presence of, e.g., medical, passport, or national-ID data.
      return SENSITIVE_CATEGORY_TYPES.has(item.type)
        ? "[REDACTED]"
        : `[${item.type.toUpperCase()}]`;
    case "masked": {
      // FIX (length leak): a full-length `*` run reveals the exact digit
      // count of structured PII. Use a fixed-width `****` mask. Only a
      // credit-card PAN may show a last-4 tail (PCI-permitted for display);
      // the tail is digit-normalized so separators never leak. Every other
      // type — SSN especially, whose last 4 are an auth token — is fully
      // masked.
      if (item.type !== "credit_card") {
        return "****";
      }

      const digits = item.value.replace(/\D/g, "");

      return `****${digits.length > 4 ? digits.slice(-4) : ""}`;
    }
    case "hashed":
      // FNV-1a hash for referential integrity (not for security). Same
      // input always produces same hash, useful for audit trails.
      return `[HASH:${fnv1aHash(item.value)}]`;
  }
}

/** Redact detected PII from text */
export function redactPII(
  text: string,
  items: DetectedPII[],
  style: RedactionStyle = "typed",
): string {
  // Items may come from an untrusted custom PIIDetector. Drop any with a
  // malformed span before splicing — a negative, fractional, out-of-range,
  // or inverted range would corrupt offsets and could re-expose raw PII.
  const safeItems = items.filter((item) => hasValidSpan(item, text.length));

  // FIX (overlap corruption): the same span can be matched by multiple
  // patterns (e.g. a 16-digit number flagged as BOTH credit_card and phone).
  // Splicing overlapping/nested ranges shifts offsets and can leave raw PII
  // in the output. Dedupe first, order-independently: sort by confidence
  // (then longer span, then earlier start) so the strongest match claims its
  // range first, and keep a later item only if it overlaps NOTHING already
  // kept. This handles chains of 3+ overlapping spans, which a first-conflict
  // scan does not.
  const byPriority = [...safeItems].sort((a, b) => {
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }

    const aSpan = a.position.end - a.position.start;
    const bSpan = b.position.end - b.position.start;
    if (bSpan !== aSpan) {
      return bSpan - aSpan;
    }

    return a.position.start - b.position.start;
  });

  const kept: DetectedPII[] = [];
  for (const item of byPriority) {
    const overlaps = kept.some(
      (k) =>
        item.position.start < k.position.end &&
        k.position.start < item.position.end,
    );

    if (!overlaps) {
      kept.push(item);
    }
  }

  // Redact the surviving non-overlapping set descending by start so earlier
  // splices do not shift the offsets of later ones.
  const sorted = kept.sort((a, b) => b.position.start - a.position.start);

  let result = text;
  for (const item of sorted) {
    const replacement = buildRedactionReplacement(item, style);

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
 * **WARNING — PSEUDONYMIZATION, NOT ANONYMIZATION.** This is NOT a
 * cryptographic hash. FNV-1a 32-bit is fast and unkeyed, so for low-entropy
 * structured PII (SSNs, card numbers, phone numbers) the hash is trivially
 * RE-IDENTIFIABLE by brute force or a precomputed rainbow table. The output
 * MUST NOT be treated as de-identified data under GDPR or HIPAA.
 *
 * It is designed only for:
 * - Consistent redaction references (same PII → same hash)
 * - Audit trail correlation (track redacted values across logs)
 *
 * For security-sensitive hashing, use a keyed cryptographic hash via the
 * Web Crypto API externally.
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

    // Custom detectors get a timeout.
    // FIX (unhandled rejection): whichever promise loses the race still
    // settles afterwards. Attach a no-op .catch() to each so the loser's
    // rejection (timeout firing after detector wins, or detector throwing
    // after timeout wins) never surfaces as an unhandledRejection.
    let timer: ReturnType<typeof setTimeout>;
    const detectPromise = detectorInstance.detect(text, piiTypes);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `[Directive] PII detector '${detectorInstance.name}' timed out after ${detectorTimeout}ms`,
            ),
          ),
        detectorTimeout,
      );
    });
    detectPromise.catch(() => {});
    timeoutPromise.catch(() => {});
    try {
      return await Promise.race([detectPromise, timeoutPromise]);
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
    // Custom detectors get a timeout.
    // FIX (unhandled rejection): attach a no-op .catch() to each racer so the
    // losing promise's rejection (timeout after detector wins, or detector
    // throwing after timeout wins) never surfaces as an unhandledRejection.
    let timer: ReturnType<typeof setTimeout>;
    const detectPromise = detectorInstance.detect(text, types);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `[Directive] PII detector '${detectorInstance.name}' timed out after ${timeout}ms`,
            ),
          ),
        timeout,
      );
    });
    detectPromise.catch(() => {});
    timeoutPromise.catch(() => {});
    try {
      items = await Promise.race([detectPromise, timeoutPromise]);
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

/**
 * Detect PII in text and return a result whose `redactedText` is populated.
 *
 * This composes {@link detectPII} and {@link redactPII} so callers do not have
 * to manually wire the two together (and do not have to mutate the detection
 * result). When no PII is detected, `redactedText` is left `undefined` — it is
 * deliberately NOT defaulted to the raw input.
 *
 * @example
 * ```typescript
 * const result = await detectAndRedactPII('My SSN is 123-45-6789', {
 *   types: ['ssn'],
 *   style: 'typed',
 * });
 * console.log(result.detected);      // true
 * console.log(result.redactedText);  // 'My SSN is [SSN]'
 *
 * const clean = await detectAndRedactPII('nothing here', { types: ['ssn'] });
 * console.log(clean.detected);       // false
 * console.log(clean.redactedText);   // undefined
 * ```
 */
export async function detectAndRedactPII(
  text: string,
  options: {
    types?: PIIType[];
    detector?: "regex" | PIIDetector;
    minConfidence?: number;
    /** Timeout for custom detectors in milliseconds (default: 5000) */
    timeout?: number;
    /** Redaction style applied when PII is detected (default: 'typed') */
    style?: RedactionStyle;
  } = {},
): Promise<PIIDetectionResult> {
  const result = await detectPII(text, options);

  if (!result.detected) {
    return { ...result };
  }

  return {
    ...result,
    redactedText: redactPII(text, result.items, options.style ?? "typed"),
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
