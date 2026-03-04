/**
 * Prompt Injection Detection Guardrail
 *
 * Detects and blocks prompt injection attacks including:
 * - Direct injection attempts ("ignore previous instructions")
 * - Jailbreak patterns ("DAN mode", "pretend you can")
 * - Indirect injection via external content
 * - Encoding-based evasion attempts
 *
 * @example
 * ```typescript
 * import { createPromptInjectionGuardrail } from '@directive-run/ai';
 *
 * const guardrail = createPromptInjectionGuardrail({
 *   strictMode: true,
 *   onBlocked: (input, patterns) => logSecurityEvent(input, patterns),
 * });
 * ```
 */

import type {
  GuardrailFn,
  GuardrailResult,
  InputGuardrailData,
} from "../types.js";

// ============================================================================
// Pattern Categories
// ============================================================================

/** Pattern with metadata for better debugging */
export interface InjectionPattern {
  pattern: RegExp;
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  category: InjectionCategory;
}

/** Categories of injection attacks */
export type InjectionCategory =
  | "instruction_override" // "ignore previous instructions"
  | "jailbreak" // "DAN mode", "pretend you can"
  | "role_manipulation" // "you are now", "act as"
  | "encoding_evasion" // base64, rot13, unicode tricks
  | "delimiter_injection" // XML/JSON injection, markdown escape
  | "context_manipulation" // "system:", "assistant:", fake messages
  | "indirect_injection"; // URL loading, file inclusion

// ============================================================================
// Built-in Patterns
// ============================================================================

/** Default injection patterns - well-tested and low false-positive rate */
export const DEFAULT_INJECTION_PATTERNS: InjectionPattern[] = [
  // Instruction override patterns
  {
    pattern:
      /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    name: "ignore-previous",
    severity: "critical",
    category: "instruction_override",
  },
  {
    pattern:
      /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)/i,
    name: "disregard-previous",
    severity: "critical",
    category: "instruction_override",
  },
  {
    pattern:
      /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?)/i,
    name: "forget-previous",
    severity: "critical",
    category: "instruction_override",
  },
  {
    pattern: /override\s+(the\s+)?(system|base)\s+(prompt|instructions?)/i,
    name: "override-system",
    severity: "critical",
    category: "instruction_override",
  },

  // Jailbreak patterns
  {
    pattern: /\bDAN\s+(mode|jailbreak)\b/i,
    name: "dan-mode",
    severity: "critical",
    category: "jailbreak",
  },
  {
    pattern: /\bjailbreak(ed)?\s*(mode)?\b/i,
    name: "jailbreak-keyword",
    severity: "high",
    category: "jailbreak",
  },
  {
    pattern: /developer\s+mode\s+(enabled|activated|on)/i,
    name: "developer-mode",
    severity: "critical",
    category: "jailbreak",
  },
  {
    pattern:
      /pretend\s+(you\s+)?(are|can|have)\s+(no\s+)?(restrictions?|limits?|boundaries?|ethics)/i,
    name: "pretend-no-restrictions",
    severity: "high",
    category: "jailbreak",
  },
  {
    pattern:
      /you\s+(now\s+)?have\s+no\s+(ethical\s+)?(restrictions?|guidelines?|boundaries?)/i,
    name: "no-restrictions",
    severity: "high",
    category: "jailbreak",
  },

  // Role manipulation
  {
    pattern: /you\s+are\s+now\s+(a|an)\s+\w+\s+(that|who)\s+(can|will|must)/i,
    name: "role-assignment",
    severity: "medium",
    category: "role_manipulation",
  },
  {
    pattern: /from\s+now\s+on,?\s+(you\s+)?(will|must|should)\s+(only\s+)?/i,
    name: "from-now-on",
    severity: "medium",
    category: "role_manipulation",
  },

  // Context manipulation (fake message markers)
  {
    pattern: /^(system|assistant|user):\s*/im,
    name: "fake-role-marker",
    severity: "high",
    category: "context_manipulation",
  },
  {
    pattern: /<\|?(system|endofprompt|im_start|im_end)\|?>/i,
    name: "special-token-injection",
    severity: "critical",
    category: "context_manipulation",
  },

  // Delimiter injection
  {
    pattern: /```(system|assistant|instructions?)\n/i,
    name: "markdown-code-injection",
    severity: "medium",
    category: "delimiter_injection",
  },
  {
    pattern: /<system>|<\/system>|<instructions?>|<\/instructions?>/i,
    name: "xml-tag-injection",
    severity: "high",
    category: "delimiter_injection",
  },

  // Indirect injection indicators
  {
    pattern: /fetch\s+(content\s+)?(from|at)\s+(the\s+)?url/i,
    name: "url-fetch-instruction",
    severity: "medium",
    category: "indirect_injection",
  },
  {
    pattern: /execute\s+(the\s+)?(code|script|command)\s+(from|in|at)/i,
    name: "execute-from-source",
    severity: "high",
    category: "indirect_injection",
  },
];

/** Strict patterns - more aggressive, may have higher false positives */
export const STRICT_INJECTION_PATTERNS: InjectionPattern[] = [
  ...DEFAULT_INJECTION_PATTERNS,

  // Additional strict patterns
  {
    pattern: /act\s+as\s+(if\s+)?(you\s+)?(were|are|can)/i,
    name: "act-as",
    severity: "low",
    category: "role_manipulation",
  },
  {
    pattern: /new\s+instructions?:/i,
    name: "new-instructions",
    severity: "medium",
    category: "instruction_override",
  },
  {
    pattern: /\[system\]|\[admin\]|\[developer\]/i,
    name: "bracket-role-marker",
    severity: "medium",
    category: "context_manipulation",
  },
  {
    pattern: /base64|rot13|decode\s+(this|the)/i,
    name: "encoding-reference",
    severity: "low",
    category: "encoding_evasion",
  },
  {
    pattern: /\u200b|\u200c|\u200d|\u2060|\ufeff/,
    name: "zero-width-chars",
    severity: "medium",
    category: "encoding_evasion",
  },
];

// ============================================================================
// Detection Result Types
// ============================================================================

/** Detailed detection result */
export interface InjectionDetectionResult {
  detected: boolean;
  patterns: Array<{
    name: string;
    category: InjectionCategory;
    severity: InjectionPattern["severity"];
    match: string;
    position: number;
  }>;
  riskScore: number; // 0-100
  sanitizedInput?: string;
}

// ============================================================================
// Core Detection Function
// ============================================================================

/** Maximum input length for injection detection (100KB) */
const MAX_INJECTION_INPUT_LENGTH = 100_000;

/**
 * Detect prompt injection patterns in text.
 * Returns detailed results about what was detected.
 *
 * @throws Error if input exceeds MAX_INJECTION_INPUT_LENGTH (100KB)
 */
export function detectPromptInjection(
  text: string,
  patterns: InjectionPattern[] = DEFAULT_INJECTION_PATTERNS,
): InjectionDetectionResult {
  // Security: Prevent DoS via extremely large inputs
  if (text.length > MAX_INJECTION_INPUT_LENGTH) {
    throw new Error(
      `[Directive] Input exceeds maximum length of ${MAX_INJECTION_INPUT_LENGTH} characters for injection detection. ` +
        "Truncate input or process in chunks.",
    );
  }

  const matches: InjectionDetectionResult["patterns"] = [];

  for (const { pattern, name, severity, category } of patterns) {
    // Reset regex state
    const regex = new RegExp(pattern.source, pattern.flags);
    const match = regex.exec(text);

    if (match) {
      matches.push({
        name,
        category,
        severity,
        match: match[0],
        position: match.index,
      });
    }
  }

  // Calculate risk score based on severity and number of matches
  const severityScores = {
    low: 10,
    medium: 25,
    high: 50,
    critical: 100,
  };

  const totalScore = matches.reduce(
    (sum, m) => sum + severityScores[m.severity],
    0,
  );
  const riskScore = Math.min(100, totalScore);

  return {
    detected: matches.length > 0,
    patterns: matches,
    riskScore,
  };
}

/**
 * Sanitize text by removing detected injection patterns.
 * Warning: This is a best-effort sanitization, not a security guarantee.
 *
 * Uses a single-pass approach to prevent infinite loops where a replacement
 * could create a new pattern match.
 */
export function sanitizeInjection(
  text: string,
  patterns: InjectionPattern[] = DEFAULT_INJECTION_PATTERNS,
): string {
  // Remove zero-width characters first (always safe)
  let sanitized = text.replace(/\u200b|\u200c|\u200d|\u2060|\ufeff/g, "");

  // Build a combined regex for single-pass replacement to prevent
  // infinite loops where "[REDACTED]" could match another pattern
  const allPatterns = patterns.map((p) => `(${p.pattern.source})`);
  if (allPatterns.length === 0) return sanitized;

  // Combine all patterns with alternation, using the most permissive flags
  const hasGlobal = patterns.some((p) => p.pattern.flags.includes("g"));
  const hasIgnoreCase = patterns.some((p) => p.pattern.flags.includes("i"));
  const hasMultiline = patterns.some((p) => p.pattern.flags.includes("m"));

  const flags = `${hasGlobal ? "g" : ""}${hasIgnoreCase ? "i" : ""}${hasMultiline ? "m" : ""}`;
  const combinedRegex = new RegExp(allPatterns.join("|"), flags || "gi");

  // Single-pass replacement prevents cascade issues
  sanitized = sanitized.replace(combinedRegex, "[REDACTED]");

  return sanitized;
}

// ============================================================================
// Guardrail Factory
// ============================================================================

/** Options for prompt injection guardrail */
export interface PromptInjectionGuardrailOptions {
  /** Additional patterns to check (added to defaults) */
  additionalPatterns?: InjectionPattern[];
  /** Replace default patterns entirely */
  replacePatterns?: InjectionPattern[];
  /** Use strict mode with more aggressive detection */
  strictMode?: boolean;
  /** Minimum risk score to block (0-100, default: 50) */
  blockThreshold?: number;
  /** Attempt to sanitize instead of blocking */
  sanitize?: boolean;
  /** Callback when injection is detected */
  onBlocked?: (input: string, result: InjectionDetectionResult) => void;
  /** Categories to ignore (e.g., allow 'role_manipulation' for roleplay apps) */
  ignoreCategories?: InjectionCategory[];
}

/**
 * Create a prompt injection detection guardrail.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const guardrail = createPromptInjectionGuardrail();
 *
 * // Strict mode for high-security applications
 * const strictGuardrail = createPromptInjectionGuardrail({
 *   strictMode: true,
 *   blockThreshold: 25,
 * });
 *
 * // Allow role manipulation for roleplay apps
 * const roleplayGuardrail = createPromptInjectionGuardrail({
 *   ignoreCategories: ['role_manipulation'],
 * });
 * ```
 */
export function createPromptInjectionGuardrail(
  options: PromptInjectionGuardrailOptions = {},
): GuardrailFn<InputGuardrailData> {
  const {
    additionalPatterns = [],
    replacePatterns,
    strictMode = false,
    blockThreshold = 50,
    sanitize = false,
    onBlocked,
    ignoreCategories = [],
  } = options;

  // Build pattern list
  let patterns: InjectionPattern[];
  if (replacePatterns) {
    patterns = replacePatterns;
  } else {
    patterns = strictMode
      ? [...STRICT_INJECTION_PATTERNS]
      : [...DEFAULT_INJECTION_PATTERNS];
  }
  patterns = [...patterns, ...additionalPatterns];

  // Filter out ignored categories
  if (ignoreCategories.length > 0) {
    const ignoredSet = new Set(ignoreCategories);
    patterns = patterns.filter((p) => !ignoredSet.has(p.category));
  }

  return (data): GuardrailResult => {
    const result = detectPromptInjection(data.input, patterns);

    if (result.detected && result.riskScore >= blockThreshold) {
      onBlocked?.(data.input, result);

      if (sanitize) {
        const sanitized = sanitizeInjection(data.input, patterns);
        return {
          passed: true,
          transformed: sanitized,
        };
      }

      const topPatterns = result.patterns
        .sort((a, b) => {
          const order = { critical: 0, high: 1, medium: 2, low: 3 };
          return order[a.severity] - order[b.severity];
        })
        .slice(0, 3)
        .map((p) => p.name)
        .join(", ");

      return {
        passed: false,
        reason: `Prompt injection detected (risk: ${result.riskScore}%, patterns: ${topPatterns})`,
      };
    }

    return { passed: true };
  };
}

// ============================================================================
// Indirect Injection Defense
// ============================================================================

/**
 * Mark content as potentially untrusted (from external sources).
 * This wraps the content with markers that injection detection will scrutinize more closely.
 *
 * @example
 * ```typescript
 * const userUpload = await readFile(path);
 * const markedContent = markUntrustedContent(userUpload, 'user-upload');
 * const prompt = `Summarize this document: ${markedContent}`;
 * ```
 */
export function markUntrustedContent(content: string, source: string): string {
  // Use a delimiter that's unlikely to appear in normal content
  // and that injection patterns will trigger on
  return `[UNTRUSTED_CONTENT source="${source}"]\n${content}\n[/UNTRUSTED_CONTENT]`;
}

/**
 * Create a guardrail that applies stricter checks to marked untrusted content.
 *
 * @example
 * ```typescript
 * const guardrail = createUntrustedContentGuardrail({
 *   baseGuardrail: createPromptInjectionGuardrail({ strictMode: true }),
 * });
 * ```
 */
export function createUntrustedContentGuardrail(options: {
  /** Guardrail to apply to untrusted sections */
  baseGuardrail?: GuardrailFn<InputGuardrailData>;
  /** Block if untrusted content contains these patterns */
  additionalPatterns?: InjectionPattern[];
}): GuardrailFn<InputGuardrailData> {
  const {
    baseGuardrail = createPromptInjectionGuardrail({
      strictMode: true,
      blockThreshold: 25,
    }),
    additionalPatterns = [],
  } = options;

  const untrustedMarkerRegex =
    /\[UNTRUSTED_CONTENT source="([^"]+)"\]([\s\S]*?)\[\/UNTRUSTED_CONTENT\]/g;

  return async (data, context): Promise<GuardrailResult> => {
    // First, check the entire input
    const fullResult = await baseGuardrail(data, context);
    if (!fullResult.passed) {
      return fullResult;
    }

    // Then, apply additional scrutiny to untrusted sections
    const matches = data.input.matchAll(untrustedMarkerRegex);
    for (const match of matches) {
      const [, source, content] = match;

      // Skip if content is undefined
      if (!content) continue;

      // Check with stricter patterns
      const strictResult = detectPromptInjection(content, [
        ...STRICT_INJECTION_PATTERNS,
        ...additionalPatterns,
      ]);

      if (strictResult.detected && strictResult.riskScore >= 25) {
        return {
          passed: false,
          reason: `Untrusted content from "${source}" contains potential injection (risk: ${strictResult.riskScore}%)`,
        };
      }
    }

    return { passed: true };
  };
}

// ============================================================================
// Exports
// ============================================================================

export {
  detectPromptInjection as detect,
  sanitizeInjection as sanitize,
  createPromptInjectionGuardrail as create,
};
