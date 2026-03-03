/**
 * POST /api/dag-devtools/reset — clears timeline events and memory.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { forbiddenResponse, isAllowedOrigin } from "@/lib/origin-check";
import {
  getDagMemory,
  getDagTimeline,
} from "../../dag-chat/orchestrator-singleton";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request);
  }
  const timeline = getDagTimeline();
  const memory = getDagMemory();

  timeline?.clear();
  memory?.clear();

  return Response.json({ ok: true });
}
