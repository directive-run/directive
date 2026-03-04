import { SECTION_END, SECTION_START } from "./constants.js";

/**
 * Replace the Directive section within existing content, or append it.
 * Section markers: <!-- directive:start --> ... <!-- directive:end -->
 */
export function mergeSection(
  existingContent: string,
  newSection: string,
): string {
  const startIdx = existingContent.indexOf(SECTION_START);
  const endIdx = existingContent.indexOf(SECTION_END);

  const wrapped = `${SECTION_START}\n${newSection}\n${SECTION_END}`;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      existingContent.slice(0, startIdx) +
      wrapped +
      existingContent.slice(endIdx + SECTION_END.length)
    );
  }

  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";

  return existingContent + separator + wrapped + "\n";
}

/**
 * Check if content already has a Directive section.
 */
export function hasDirectiveSection(content: string): boolean {
  return (
    content.includes(SECTION_START) && content.includes(SECTION_END)
  );
}
