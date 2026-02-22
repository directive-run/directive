import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { UrlSyncDemo } from './UrlSyncDemo'

export const metadata = buildPageMetadata({
  title: 'URL Sync',
  description:
    'Interactive URL-state synchronization demo built with Directive. Bidirectional sync, guard flags, and shareable filtered views.',
  path: '/docs/examples/url-sync',
  section: 'Docs',
})

export default function UrlSyncPage() {
  const build = parseExampleBuild('url-sync')
  const sources = readExampleSources('url-sync', [
    'url-sync.ts',
    'mock-products.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          URL Sync
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Bidirectional URL-state sync with filters, sort, and pagination
          that survive refresh and are shareable via links.
        </p>
      </header>

      <UrlSyncDemo build={build} sources={sources} />
    </div>
  )
}
