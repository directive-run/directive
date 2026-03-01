/**
 * SSE endpoint for live DevTools timeline events.
 *
 * Replays all existing events then streams new ones as they arrive.
 * If the orchestrator hasn't been initialized yet (no chat messages sent),
 * the stream stays open and polls until the timeline becomes available.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTimeline } from '../../chat/orchestrator-singleton'

let activeStreams = 0
const MAX_STREAMS = 10

export async function GET(request: Request) {
  if (activeStreams >= MAX_STREAMS) {
    return Response.json({ error: 'Too many DevTools connections' }, { status: 429 })
  }

  const tokenEnv = process.env.DEVTOOLS_TOKEN
  if (tokenEnv) {
    const provided = request.headers.get('X-DevTools-Token')
    if (provided !== tokenEnv) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }
  }

  activeStreams++

  let unsubscribe: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let cleaned = false

  const cleanup = () => {
    if (cleaned) {
      return
    }
    cleaned = true
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
  }

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
        const timeline = getTimeline()
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
        cleanup()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },

    cancel() {
      cleanup()
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
