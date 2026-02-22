'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function ThemeLocaleDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'theme-locale.ts')
  const mainSource = sources.find((s) => s.filename === 'main.ts')

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="theme-locale"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example theme-locale
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Switch themes, change locale, and toggle the sidebar. Preferences
          persist across page reloads via the persistence plugin.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Two modules manage global UI state &ndash; preferences for user
            choices and layout for responsive breakpoints &ndash; composed into
            a single system with persistence.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>theme</code> (&ldquo;light&rdquo;/&ldquo;dark&rdquo;/&ldquo;system&rdquo;),{' '}
              <code>locale</code>, <code>sidebarOpen</code>, and{' '}
              <code>systemPrefersDark</code> (detected at runtime)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>effectiveTheme</code> resolves &ldquo;system&rdquo; to actual
              light/dark by reading <code>systemPrefersDark</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Effects</strong>{' '}
              &ndash; <code>applyTheme</code> sets <code>data-theme</code> on
              the document element; <code>detectSystemTheme</code> listens
              to <code>prefers-color-scheme</code> media query changes
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Persistence</strong>{' '}
              &ndash; <code>persistencePlugin</code> saves theme, locale, and
              sidebar state to localStorage, restoring them on reload
            </li>
          </ol>
        </div>
      </section>

      {/* Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-200">What:</strong>{' '}
            Global UI preferences (theme, locale, sidebar) with system theme
            detection, multi-language translations, and persistent storage.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            A <code>preferences</code> module holds user choices while{' '}
            <code>effectiveTheme</code> derivation resolves &ldquo;system&rdquo; to
            the actual value. Effects apply the theme to the DOM and detect
            OS-level preference changes.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Directive replaces multiple React Context providers with a single
            system. The persistence plugin handles save/restore automatically,
            and derivations ensure computed values stay in sync without manual
            wiring.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: 'theme-locale.ts',
              label: 'theme-locale.ts - Directive modules',
              code: moduleSource.code,
              language: 'typescript',
            },
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
