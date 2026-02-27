import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild } from '@/lib/examples'
import { MultiSystemDemo } from './MultiSystemDemo'

export const metadata = buildPageMetadata({
  title: 'Multi-System DevTools',
  description:
    'Two Directive systems on one page — use the SystemSelector dropdown to switch between inspecting each system in the DevTools drawer.',
  path: '/docs/examples/multi-system-devtools',
  section: 'Docs',
})

export default function MultiSystemDevtoolsPage() {
  const counterBuild = parseExampleBuild('counter')
  const cartBuild = parseExampleBuild('shopping-cart')

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Multi-System DevTools
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Two independent systems on one page. Open DevTools and use the
          SystemSelector dropdown to switch between them.
        </p>
      </header>

      <MultiSystemDemo counterBuild={counterBuild} cartBuild={cartBuild} />
    </div>
  )
}
