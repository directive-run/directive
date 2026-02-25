import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { FraudAnalysisDemo } from './FraudAnalysisDemo'

export const metadata = buildPageMetadata({
  title: 'Fraud Case Analysis',
  description:
    'Multi-stage fraud detection pipeline showcasing every major Directive feature: constraints with priority and ordering, resolvers with retry, effects, derivations with composition, PII detection, checkpoints, and DevTools.',
  path: '/docs/examples/fraud-analysis',
  section: 'Docs',
})

export default function FraudAnalysisPage() {
  const build = parseExampleBuild('fraud-analysis')
  const sources = readExampleSources('fraud-analysis', [
    'fraud-analysis.ts',
    'mock-data.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Fraud Case Analysis
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Multi-stage fraud detection pipeline with constraints, resolvers,
          effects, PII detection, checkpoints, and DevTools.
        </p>
      </header>

      <FraudAnalysisDemo build={build} sources={sources} />
    </div>
  )
}
