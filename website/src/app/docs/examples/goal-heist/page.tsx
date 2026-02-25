import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { GoalHeistDemo } from './GoalHeistDemo'

export const metadata = buildPageMetadata({
  title: 'Goal Heist',
  description:
    'Multi-agent goal execution pattern: a heist crew with dependency-driven agents, satisfaction scoring, stall detection, relaxation tiers, and real AI or mock fallback.',
  path: '/docs/examples/goal-heist',
  section: 'Docs',
})

export default function GoalHeistPage() {
  const build = parseExampleBuild('goal-heist')
  const sources = readExampleSources('goal-heist', [
    'agents.ts',
    'goal-module.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          The Directive Job
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Multi-agent goal execution with constraint-driven orchestration,
          satisfaction scoring, and relaxation tiers.
        </p>
      </header>

      <GoalHeistDemo build={build} sources={sources} />
    </div>
  )
}
