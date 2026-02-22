import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { ThemeLocaleDemo } from './ThemeLocaleDemo'

export const metadata = buildPageMetadata({
  title: 'Theme & Locale',
  description:
    'Interactive theme switching, locale management, and system preference detection built with Directive.',
  path: '/docs/examples/theme-locale',
  section: 'Docs',
})

export default function ThemeLocalePage() {
  const build = parseExampleBuild('theme-locale')
  const sources = readExampleSources('theme-locale', [
    'theme-locale.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Theme &amp; Locale
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Global UI preferences with persistence, system theme detection, and
          multi-locale support.
        </p>
      </header>

      <ThemeLocaleDemo build={build} sources={sources} />
    </div>
  )
}
