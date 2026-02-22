import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { OptimisticUpdatesDemo } from './OptimisticUpdatesDemo'

export const metadata = buildPageMetadata({
  title: 'Optimistic Updates',
  description:
    'Interactive optimistic updates demo built with Directive. Instant UI mutations with automatic rollback on server failure, sync queue, and toast notifications.',
  path: '/docs/examples/optimistic-updates',
  section: 'Docs',
})

export default function OptimisticUpdatesPage() {
  const build = parseExampleBuild('optimistic-updates')
  const sources = readExampleSources('optimistic-updates', [
    'optimistic-updates.ts',
    'mock-server.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Optimistic Updates
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Instant UI mutations with automatic rollback on server failure, sync
          queue, and toast notifications.
        </p>
      </header>

      <OptimisticUpdatesDemo build={build} sources={sources} />
    </div>
  )
}
