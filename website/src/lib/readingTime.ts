import type { Node } from "@markdoc/markdoc";

const WORDS_PER_MINUTE = 200;

/**
 * Extract text content from Markdoc nodes
 */
function extractText(node: Node): string {
  let text = "";

  if (node.type === "text" && typeof node.attributes?.content === "string") {
    text += node.attributes.content + " ";
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      text += extractText(child as Node);
    }
  }

  return text;
}

/**
 * Calculate reading time from Markdoc nodes
 */
export function calculateReadingTime(nodes: Array<Node>): number {
  let totalText = "";

  for (const node of nodes) {
    totalText += extractText(node);
  }

  const wordCount = totalText.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(wordCount / WORDS_PER_MINUTE);

  return Math.max(1, minutes);
}

/**
 * Format reading time as a human-readable string
 */
export function formatReadingTime(minutes: number): string {
  if (minutes === 1) {
    return "1 min read";
  }
  return `${minutes} min read`;
}
