/**
 * POST /api/devtools/reset — clears timeline events and memory.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getTimeline } from "../../chat/orchestrator-singleton";

export async function POST(request: Request) {
  const tokenEnv = process.env.DEVTOOLS_TOKEN;
  if (tokenEnv) {
    const provided = request.headers.get("X-DevTools-Token");
    if (provided !== tokenEnv) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }
  }

  const timeline = getTimeline();
  timeline?.clear();

  return Response.json({ ok: true });
}
