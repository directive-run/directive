'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function FeatureFlagsDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'module.ts')
  const appSource = sources.find((s) => s.filename === 'App.tsx')
  const flagPanelSource = sources.find((s) => s.filename === 'FlagPanel.tsx')
  const previewSource = sources.find((s) => s.filename === 'Preview.tsx')

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="feature-flags"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example feature-flags
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Toggle flags in the left panel and watch the preview update. Enable
          maintenance mode to disable four features at once. Turn off Brand
          Switcher while Onboarding Toast is on &mdash; the constraint
          auto-enables it.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A single <code>feature-flags</code> module mirrors the real flag
            system running on directive.run, built with React and the{' '}
            <code>@directive-run/react</code> adapter:
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">8 boolean facts</strong>{' '}
              &ndash; one per feature toggle, plus a{' '}
              <code>maintenanceMode</code> flag
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>canUse*</code> derivations gate features by
              combining the raw flag with maintenance mode. Components read
              derivations, not raw facts
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Dependency constraint</strong>{' '}
              &ndash; <code>onboardingRequiresBrandSwitcher</code> fires when
              onboarding toast is enabled without brand switcher, auto-enabling
              it via resolver
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Persistence</strong>{' '}
              &ndash; the <code>persistencePlugin</code> saves flag state to
              localStorage, surviving page refreshes
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
            A feature flag system with 8 toggles, maintenance mode, dependency
            enforcement, and localStorage persistence.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Derivations gate features declaratively. One constraint enforces the
            onboarding &rarr; brand-switcher dependency. The persistence plugin
            handles save/restore automatically.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Constraints replace manual dependency checks. Derivations replace
            scattered conditionals. React components subscribe to exactly one
            fact or derivation each for granular re-renders.
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
              filename: 'module.ts',
              label: 'module.ts - Directive module',
              code: moduleSource.code,
              language: 'typescript',
            },
            appSource && {
              filename: 'App.tsx',
              label: 'App.tsx - System + layout',
              code: appSource.code,
              language: 'typescript',
            },
            flagPanelSource && {
              filename: 'FlagPanel.tsx',
              label: 'FlagPanel.tsx - Toggle controls',
              code: flagPanelSource.code,
              language: 'typescript',
            },
            previewSource && {
              filename: 'Preview.tsx',
              label: 'Preview.tsx - Live preview',
              code: previewSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
