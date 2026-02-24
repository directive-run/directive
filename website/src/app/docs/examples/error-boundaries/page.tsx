import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { ErrorBoundariesDemo } from './ErrorBoundariesDemo'

export const metadata = buildPageMetadata({
  title: 'Error Boundaries',
  description:
    'Resilient API dashboard with error boundaries, circuit breakers, retry-later backoff, and performance metrics.',
  path: '/docs/examples/error-boundaries',
  section: 'Docs',
})

export default function ErrorBoundariesPage() {
  const build = parseExampleBuild('error-boundaries')
  const sources = readExampleSources('error-boundaries', ['main.ts'])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Error Boundaries
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Resilient API dashboard with circuit breakers, retry strategies, and
          performance metrics.
        </p>
      </header>

      <ErrorBoundariesDemo build={build} sources={sources} />
    </div>
  )
}
