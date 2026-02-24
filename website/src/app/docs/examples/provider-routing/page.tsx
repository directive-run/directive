import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { ProviderRoutingDemo } from './ProviderRoutingDemo'

export const metadata = buildPageMetadata({
  title: 'Provider Routing',
  description:
    'Smart provider router with constraint-based selection, circuit breakers, budget tracking, and fallback chains.',
  path: '/docs/examples/provider-routing',
  section: 'Docs',
})

export default function ProviderRoutingPage() {
  const build = parseExampleBuild('provider-routing')
  const sources = readExampleSources('provider-routing', ['main.ts'])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Provider Routing
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Constraint-based provider selection with circuit breakers, budget
          tracking, and fallback chains.
        </p>
      </header>

      <ProviderRoutingDemo build={build} sources={sources} />
    </div>
  )
}
