/**
 * Local regex-based PII detection & redaction.
 * Replaces the @directive-run/ai detectPII / redactPII utilities
 * so this example has zero AI dependencies.
 */

interface DetectedPII {
  type: string;
  value: string;
  position: { start: number; end: number };
}

interface PIIDetectionResult {
  detected: boolean;
  items: DetectedPII[];
}

const PATTERNS: Record<string, RegExp> = {
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]*?){13,19}\b/g,
  bank_account: /\b\d{8,17}\b/g,
};

export async function detectPII(
  text: string,
  options?: { types?: string[] },
): Promise<PIIDetectionResult> {
  const types = options?.types ?? Object.keys(PATTERNS);
  const items: DetectedPII[] = [];

  for (const type of types) {
    const pattern = PATTERNS[type];
    if (!pattern) {
      continue;
    }

    // Reset lastIndex for global regexes
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      items.push({
        type,
        value: match[0],
        position: { start: match.index, end: match.index + match[0].length },
      });
    }
  }

  return { detected: items.length > 0, items };
}

export function redactPII(
  text: string,
  items: DetectedPII[],
  style: "typed" | "placeholder" | "masked" = "typed",
): string {
  // Sort descending by start so replacements don't shift indices
  const sorted = [...items].sort((a, b) => b.position.start - a.position.start);
  let result = text;

  for (const item of sorted) {
    let replacement: string;
    if (style === "typed") {
      replacement = `[${item.type.toUpperCase()}]`;
    } else if (style === "placeholder") {
      replacement = "[REDACTED]";
    } else {
      replacement = "*".repeat(item.value.length);
    }

    result =
      result.slice(0, item.position.start) +
      replacement +
      result.slice(item.position.end);
  }

  return result;
}
