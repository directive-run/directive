'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function WebSocketDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'websocket.ts')
  const mockWsSource = sources.find((s) => s.filename === 'mock-ws.ts')
  const mainSource = sources.find((s) => s.filename === 'main.ts')

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="websocket"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example websocket
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Connect&rdquo; to establish a mock WebSocket connection.
          Watch messages stream in, send your own, and use &ldquo;Force
          Error&rdquo; or adjust fail rates to explore automatic reconnection
          with exponential backoff.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A WebSocket connection manager with automatic reconnection,
            exponential backoff, live message streaming, and send
            support &ndash; all driven by Directive&rsquo;s
            constraint&ndash;resolver pattern.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>url</code>, <code>status</code>,{' '}
              <code>messages</code>, <code>retryCount</code>,{' '}
              <code>reconnectTargetTime</code>, and a ticking{' '}
              <code>now</code> fact updated every 500ms
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>shouldReconnect</code> drives the reconnect
              constraint, <code>reconnectCountdown</code> auto-tracks{' '}
              <code>now</code> and <code>reconnectTargetTime</code> for a
              live countdown display
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>needsConnection</code> (priority 100) fires on
              connect request. <code>needsReconnect</code> (priority 90) fires
              on error with exponential backoff delay
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Resolvers</strong>{' '}
              &ndash; <code>connect</code> creates a MockWebSocket and manages
              its lifecycle. <code>reconnect</code> waits the backoff delay
              then sets status to &ldquo;connecting&rdquo; to retrigger
              connection
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Effects</strong>{' '}
              &ndash; <code>logStatusChange</code> records status transitions
              to the event timeline for observability
            </li>
          </ol>
        </div>
      </section>

      {/* Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-200">What:</strong>{' '}
            A WebSocket connection manager with connect/disconnect, live message
            streaming, send with echo, automatic reconnection with exponential
            backoff, reconnect countdown, and configurable failure rates.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Constraints detect when a connection is needed or when reconnection
            should occur. Resolvers handle the actual connection lifecycle and
            backoff delays. A ticking <code>now</code> fact drives the reactive
            countdown display.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            WebSocket lifecycle management is full of timing-dependent operations
            and error recovery. Directive&rsquo;s constraint&ndash;resolver
            pattern centralizes connection logic, while derivations provide
            real-time UI feedback without manual timers.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: 'websocket.ts',
              label: 'websocket.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockWsSource && {
              filename: 'mock-ws.ts',
              label: 'mock-ws.ts - Mock WebSocket',
              code: mockWsSource.code,
              language: 'typescript',
            },
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
