/**
 * POST /api/data-pipeline-devtools/reset — clears timeline events and memory.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { isAllowedOrigin, forbiddenResponse } from '@/lib/origin-check'
import { getDataPipelineTimeline, getDataPipelineMemory } from '../../data-pipeline-chat/orchestrator-singleton'

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request)
  }
  const timeline = getDataPipelineTimeline()
  const memory = getDataPipelineMemory()

  timeline?.clear()
  memory?.clear()

  return Response.json({ ok: true })
}
