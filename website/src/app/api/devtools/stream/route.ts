/**
 * SSE endpoint for live DevTools timeline events.
 *
 * Replays all existing events then streams new ones as they arrive.
 * The chat orchestrator must have handled at least one request (so the
 * singleton is initialized) before this endpoint returns events.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { getTimeline } from '../../chat/orchestrator-singleton'

export async function GET(request: Request) {
  const timeline = getTimeline()

  if (!timeline) {
    return new Response(
      JSON.stringify({ error: 'No active timeline. Send a chat message first.' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '3',
        },
      },
    )
  }

  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      // Replay existing events
      const existing = timeline.getEvents()
      for (const event of existing) {
        send(event)
      }

      // Subscribe to new events
      unsubscribe = timeline.subscribe((event) => {
        send(event)
      })

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        unsubscribe?.()
        unsubscribe = null
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },

    cancel() {
      unsubscribe?.()
      unsubscribe = null
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
