'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function ShoppingCartDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'shopping-cart.ts')
  const mockApiSource = sources.find((s) => s.filename === 'mock-api.ts')
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
            name="shopping-cart"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example shopping-cart
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Adjust quantities to exceed stock limits, try coupon codes
          &ldquo;SAVE10&rdquo; or &ldquo;HALF&rdquo;, toggle auth, and
          attempt checkout. Watch constraints enforce business rules
          automatically.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A cart module manages items, coupons, and checkout while an auth
            module gates checkout &ndash; all connected through constraints
            with priority ordering.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>subtotal</code>, <code>discount</code>,{' '}
              <code>tax</code>, <code>total</code>, and{' '}
              <code>freeShipping</code> form a composition chain where each
              depends on the previous
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>quantityLimit</code> (priority 80) clamps
              overstocked items; <code>couponValidation</code> (priority 70)
              validates codes via API; <code>checkoutReady</code> (priority 60)
              gates on auth + cart validity using <code>after</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Cross-module</strong>{' '}
              &ndash; checkout reads <code>auth.isAuthenticated</code> via{' '}
              <code>crossModuleDeps</code>. Toggling auth off blocks checkout
              even if the cart is valid
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Retry</strong>{' '}
              &ndash; the checkout resolver uses exponential backoff (2
              attempts) to handle transient server failures
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
            A shopping cart with quantity limits, coupon validation, tax
            calculation, free shipping threshold, and auth-gated checkout.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Three constraints with priority ordering handle business rules
            automatically. <code>quantityLimit</code> fires first, then{' '}
            <code>couponValidation</code>, then <code>checkoutReady</code>{' '}
            (which uses <code>after</code> to wait for the others).
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Business rules are constraints, not imperative code. Adding a
            new rule (bundle discount, minimum order) is just another
            constraint definition. Priority and <code>after</code> ordering
            ensure rules execute in the right sequence without manual
            orchestration.
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
              filename: 'shopping-cart.ts',
              label: 'shopping-cart.ts - Directive modules',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockApiSource && {
              filename: 'mock-api.ts',
              label: 'mock-api.ts - Mock APIs',
              code: mockApiSource.code,
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
