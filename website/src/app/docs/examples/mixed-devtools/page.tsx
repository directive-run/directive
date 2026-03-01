import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild } from '@/lib/examples'
import { MixedDemo } from './MixedDemo'

export const metadata = buildPageMetadata({
  title: 'Mixed DevTools',
  description:
    'One system example and two AI examples on a single page — test the SystemSelector with mixed system types.',
  path: '/docs/examples/mixed-devtools',
  section: 'Docs',
})

export default function MixedDevtoolsPage() {
  const counterBuild = parseExampleBuild('counter')
  const guardrailsBuild = parseExampleBuild('ai-guardrails')
  const fraudBuild = parseExampleBuild('fraud-analysis')

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Mixed DevTools
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          One system example + two AI examples. DevTools SystemSelector lets you
          switch between all three.
        </p>
      </header>

      <MixedDemo
        counterBuild={counterBuild}
        guardrailsBuild={guardrailsBuild}
        fraudBuild={fraudBuild}
      />
    </div>
  )
}
