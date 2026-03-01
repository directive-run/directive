/**
 * SSE endpoint for pitch deck DevTools timeline events.
 *
 * Same pattern as /api/devtools/stream but reads from the pitch deck orchestrator.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getPitchDeckTimeline } from '../../pitch-deck-chat/orchestrator-singleton'

let activeStreams = 0
const MAX_STREAMS = 10

export async function GET(request: Request) {
  if (activeStreams >= MAX_STREAMS) {
    return Response.json({ error: 'Too many DevTools connections' }, { status: 429 })
  }

  activeStreams++

  let unsubscribe: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (data: unknown) => {
        try {
          const payload = data as { id?: number }
          const id = payload.id
          controller.enqueue(encoder.encode(`${id != null ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      const attachToTimeline = () => {
        const timeline = getPitchDeckTimeline()
        if (!timeline) {
          return false
        }

        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }

        const existing = timeline.getEvents()
        for (const event of existing) {
          send(event)
        }

        unsubscribe = timeline.subscribe((event) => {
          send(event)
        })

        return true
      }

      if (!attachToTimeline()) {
        pollTimer = setInterval(() => {
          attachToTimeline()
        }, 1000)
      }

      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          // Stream closed
        }
      }, 15000)

      request.signal.addEventListener('abort', () => {
        activeStreams--
        unsubscribe?.()
        unsubscribe = null
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer)
          heartbeatTimer = null
        }
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },

    cancel() {
      activeStreams--
      unsubscribe?.()
      unsubscribe = null
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
