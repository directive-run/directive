/**
 * POST /api/devtools/reset — clears timeline events and memory.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTimeline } from '../../chat/orchestrator-singleton'

export async function POST() {
  const timeline = getTimeline()
  timeline?.clear()

  return Response.json({ ok: true })
}
