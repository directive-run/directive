import { notFound } from "next/navigation";

/**
 * Catch-all for unmatched /ai/* routes.
 * Specific AI pages (e.g. /ai/overview/page.md) take priority
 * over this catch-all in Next.js App Router. This only runs for
 * routes that don't have a dedicated page file.
 */
export default function AICatchAll() {
  notFound();
}
