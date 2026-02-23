import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { FeatureFlagsDemo } from './FeatureFlagsDemo'

export const metadata = buildPageMetadata({
  title: 'Feature Flags',
  description:
    'The same 8-flag system running on directive.run — constraints enforce dependencies, derivations gate features, effects log changes.',
  path: '/docs/examples/feature-flags',
  section: 'Docs',
})

export default function FeatureFlagsPage() {
  const build = parseExampleBuild('feature-flags')
  const sources = readExampleSources('feature-flags', [
    'module.ts',
    'App.tsx',
    'FlagPanel.tsx',
    'Preview.tsx',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Feature Flags
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Eight flags, maintenance mode, dependency constraints, and
          localStorage persistence &mdash; the real system powering
          directive.run.
        </p>
      </header>

      <FeatureFlagsDemo build={build} sources={sources} />
    </div>
  )
}
