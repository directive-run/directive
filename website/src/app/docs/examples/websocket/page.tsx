import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { WebSocketDemo } from './WebSocketDemo'

export const metadata = buildPageMetadata({
  title: 'WebSocket Connections',
  description:
    'Interactive WebSocket connection demo built with Directive. Connect, auto-reconnect with exponential backoff, live message streaming, and reconnect countdown.',
  path: '/docs/examples/websocket',
  section: 'Docs',
})

export default function WebSocketPage() {
  const build = parseExampleBuild('websocket')
  const sources = readExampleSources('websocket', [
    'websocket.ts',
    'mock-ws.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          WebSocket Connections
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Connect, auto-reconnect with exponential backoff, live message
          streaming, and reconnect countdown.
        </p>
      </header>

      <WebSocketDemo build={build} sources={sources} />
    </div>
  )
}
