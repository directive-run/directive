import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { DynamicModulesDemo } from './DynamicModulesDemo'

export const metadata = buildPageMetadata({
  title: 'Dynamic Modules',
  description:
    'Interactive dynamic modules demo built with Directive. Runtime module registration, namespaced facts, and multi-module system composition.',
  path: '/docs/examples/dynamic-modules',
  section: 'Docs',
})

export default function DynamicModulesPage() {
  const build = parseExampleBuild('dynamic-modules')
  const sources = readExampleSources('dynamic-modules', [
    'modules.ts',
    'mock-weather.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Dynamic Modules
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Runtime module registration, namespaced fact access, and multi-module
          system composition.
        </p>
      </header>

      <DynamicModulesDemo build={build} sources={sources} />
    </div>
  )
}
