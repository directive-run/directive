'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'

export function MultiSystemDemo({
  counterBuild,
  cartBuild,
}: {
  counterBuild: import('@/lib/examples').ExampleBuild | null
  cartBuild: import('@/lib/examples').ExampleBuild | null
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Both examples register with <code>devtoolsPlugin()</code> under
          different names. Click the Directive logo (bottom-left) or press{' '}
          <kbd className="rounded border border-slate-300 bg-slate-100 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-800">
            Cmd+Shift+D
          </kbd>{' '}
          to open DevTools, then use the SystemSelector dropdown to switch
          between &ldquo;number-match&rdquo; and &ldquo;shopping-cart&rdquo;.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Number Match
            </h3>
            {counterBuild ? (
              <ExampleEmbed
                name="counter"
                css={counterBuild.css}
                html={counterBuild.html}
                scriptSrc={counterBuild.scriptSrc}
              />
            ) : (
              <BuildPlaceholder name="counter" />
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              Shopping Cart
            </h3>
            {cartBuild ? (
              <ExampleEmbed
                name="shopping-cart"
                css={cartBuild.css}
                html={cartBuild.html}
                scriptSrc={cartBuild.scriptSrc}
              />
            ) : (
              <BuildPlaceholder name="shopping-cart" />
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Each example calls{' '}
            <code>devtoolsPlugin()</code> with a
            unique name when creating its system. Both register on{' '}
            <code>window.__DIRECTIVE__</code>, so the DevTools SystemSelector
            detects two systems and shows a dropdown.
          </p>
          <p>
            Switching systems in the dropdown detaches the DevTools from one
            system and attaches to the other. Facts, derivations, constraints,
            and requirements update to reflect the selected system.
          </p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          What to verify
        </h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-400">
          <li>
            <code>window.__DIRECTIVE__.getSystems()</code> returns both
            &ldquo;number-match&rdquo; and &ldquo;shopping-cart&rdquo;
          </li>
          <li>SystemSelector shows a dropdown (not just a single name)</li>
          <li>
            Switching systems updates Facts/Derivations/Constraints tabs with
            the correct data
          </li>
          <li>
            Each system&rsquo;s facts match the module&rsquo;s schema
          </li>
        </ul>
      </section>
    </div>
  )
}

function BuildPlaceholder({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
      Example not built yet. Run{' '}
      <code className="text-slate-300">pnpm build:example {name}</code> to
      generate the embed.
    </div>
  )
}
