import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { AbTestingDemo } from './AbTestingDemo'

export const metadata = buildPageMetadata({
  title: 'A/B Testing',
  description:
    'A constraint-driven A/B testing engine with deterministic assignment, automatic exposure tracking, and pause/resume — all powered by Directive.',
  path: '/docs/examples/ab-testing',
  section: 'Docs',
})

export default function AbTestingPage() {
  const build = parseExampleBuild('ab-testing')
  const sources = readExampleSources('ab-testing', ['main.ts'])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          A/B Testing
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Constraint-driven experiment assignment and exposure tracking with
          deterministic hashing and pause/resume.
        </p>
      </header>

      <AbTestingDemo build={build} sources={sources} />
    </div>
  )
}
