/**
 * POST /api/dag-devtools/reset — clears timeline events and memory.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getDagTimeline, getDagMemory } from '../../dag-chat/orchestrator-singleton'

export async function POST() {
  const timeline = getDagTimeline()
  const memory = getDagMemory()

  timeline?.clear()
  memory?.clear()

  return Response.json({ ok: true })
}
