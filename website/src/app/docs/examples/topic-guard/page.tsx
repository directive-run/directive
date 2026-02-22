import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { TopicGuardDemo } from './TopicGuardDemo'

export const metadata = buildPageMetadata({
  title: 'Topic Guard',
  description:
    'Interactive topic guardrail demo built with Directive. Type messages and see which ones get blocked by input guardrails.',
  path: '/docs/examples/topic-guard',
  section: 'Docs',
})

export default function TopicGuardPage() {
  const build = parseExampleBuild('topic-guard')
  const sources = readExampleSources('topic-guard', [
    'topic-guard.ts',
    'mock-guardrails.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Topic Guard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Input guardrails that block off-topic messages before they reach the
          agent.
        </p>
      </header>

      <TopicGuardDemo build={build} sources={sources} />
    </div>
  )
}
