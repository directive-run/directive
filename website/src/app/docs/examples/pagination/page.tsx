import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { PaginationDemo } from './PaginationDemo'

export const metadata = buildPageMetadata({
  title: 'Pagination',
  description:
    'Interactive pagination and infinite scroll demo built with Directive. Cursor-based loading, filter-aware resets, and IntersectionObserver effects.',
  path: '/docs/examples/pagination',
  section: 'Docs',
})

export default function PaginationPage() {
  const build = parseExampleBuild('pagination')
  const sources = readExampleSources('pagination', [
    'pagination.ts',
    'mock-api.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Pagination
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cursor-based infinite scroll with filter-aware resets,
          IntersectionObserver effects, and cross-module dependencies.
        </p>
      </header>

      <PaginationDemo build={build} sources={sources} />
    </div>
  )
}
