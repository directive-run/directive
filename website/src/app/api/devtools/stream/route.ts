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

export async function GET(request: Request) {
  let unsubscribe: (() => void) | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

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

      const attachToTimeline = () => {
        const timeline = getTimeline()
        if (!timeline) {
          return false
        }

        // Stop polling
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
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

        return true
      }

      // Try immediately
      if (!attachToTimeline()) {
        // Poll every second until the orchestrator is initialized
        pollTimer = setInterval(() => {
          attachToTimeline()
        }, 1000)
      }

      // Clean up on client disconnect
      request.signal.addEventListener('abort', () => {
        unsubscribe?.()
        unsubscribe = null
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
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
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
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
