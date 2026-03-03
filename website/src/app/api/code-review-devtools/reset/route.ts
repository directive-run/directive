/**
 * POST /api/code-review-devtools/reset — clears timeline events and memory.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { forbiddenResponse, isAllowedOrigin } from "@/lib/origin-check";
import {
  getCodeReviewMemory,
  getCodeReviewTimeline,
} from "../../code-review-chat/orchestrator-singleton";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request);
  }
  const timeline = getCodeReviewTimeline();
  const memory = getCodeReviewMemory();

  timeline?.clear();
  memory?.clear();

  return Response.json({ ok: true });
}
