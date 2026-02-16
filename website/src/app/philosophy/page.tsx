import Link from 'next/link'
import {
  buildPageMetadata,
} from '@/lib/metadata'
import {
  Scales,
  Eye,
  Database,
  Plugs,
  ShieldCheck,
  MagnifyingGlass,
  Stack,
} from '@phosphor-icons/react/dist/ssr'

export const metadata = buildPageMetadata({
  title: 'Philosophy — Directive',
  description:
    'The design principles and beliefs that shaped Directive\u2019s constraint-driven architecture.',
  path: '/philosophy',
})

const principles = [
  {
    icon: Scales,
    title: 'Constraints Over Actions',
    paragraphs: [
      'Most state management libraries are built around actions \u2013 named events that trigger state transitions. Click a button, dispatch an action, run a reducer. The developer is the orchestrator, manually wiring cause to effect.',
      'Directive starts from a different premise: model the rules, not the steps.',
      'A constraint says \u201cwhen this condition holds, this requirement must be fulfilled.\u201d It doesn\u2019t care when or how the condition became true. It doesn\u2019t need to be wired to a button click or a lifecycle hook. It simply watches reality and reacts when the world doesn\u2019t match the rules.',
      'This idea isn\u2019t new. Database triggers, CSS layout engines, spreadsheet formulas, and constraint solvers all work this way. Directive brings the same principle to application state: declare invariants, and let the runtime enforce them.',
      'The practical result is that adding a new rule doesn\u2019t require tracing every code path that might trigger it. You add the constraint, and it activates whenever its condition is met \u2013 regardless of what caused the state change.',
    ],
  },
  {
    icon: Stack,
    title: 'The Runtime Knows More Than You',
    paragraphs: [
      'In traditional state management, the developer is responsible for timing, ordering, deduplication, and error recovery. When should this API call fire? What if two components trigger it simultaneously? What if it fails?',
      'Directive\u2019s position is that these are runtime concerns, not developer concerns.',
      'When you declare a constraint and a resolver, you\u2019re expressing intent: \u201cthis must be true\u201d and \u201chere\u2019s how to make it true.\u201d The runtime handles the rest \u2013 when to execute, how to deduplicate concurrent requests, when to retry, and how to sequence dependent operations.',
      'This isn\u2019t about taking control away. It\u2019s about putting orchestration logic where it belongs: in a system designed to handle it consistently, rather than scattered across dozens of event handlers where subtle timing bugs hide.',
    ],
  },
  {
    icon: Database,
    title: 'State as Ground Truth',
    paragraphs: [
      'In Directive, facts are the single source of truth. Everything else is derived.',
    ],
    bullets: [
      { bold: 'Derivations', text: 'are computed from facts. They don\u2019t store their own state \u2013 they recompute when their dependencies change.' },
      { bold: 'Constraints', text: 'evaluate against facts. They\u2019re pure functions that inspect reality and generate requirements.' },
      { bold: 'Requirements', text: 'are transient. They exist only as long as a constraint is active and unfulfilled.' },
    ],
    afterBullets: [
      'There\u2019s no separate \u201caction log\u201d or \u201cevent history\u201d that you need to reconcile with actual state. Facts are reality. If you want to know what\u2019s true, read the facts. If you want to know what\u2019s computed, read a derivation. If you want to know what\u2019s needed, check the active requirements.',
      'This principle eliminates an entire class of bugs where derived state drifts out of sync with source state because someone forgot to update a cache or reset a flag.',
    ],
  },
  {
    icon: Plugs,
    title: 'Separation of Detection and Execution',
    paragraphs: [
      'Constraints detect what\u2019s needed. Resolvers handle how to fulfill it. These are deliberately separate concepts.',
      'A constraint doesn\u2019t know how a user gets fetched \u2013 it just knows one is needed. A resolver doesn\u2019t know why it was triggered \u2013 it just knows what requirement to fulfill.',
      'This separation makes systems composable. You can swap a resolver\u2019s implementation without touching constraints, add new constraints that reuse existing resolvers, test detection logic independently from execution logic, and have multiple constraints generate the same requirement type with a single resolver handling all of them.',
      'The same principle applies to effects. Effects observe state changes without participating in the constraint-resolution cycle. They\u2019re strictly one-way \u2013 they read facts but don\u2019t generate requirements. This keeps observation separate from orchestration.',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Resilience by Default',
    paragraphs: [
      'Most frameworks treat error handling, retries, and timeouts as afterthoughts. You build the happy path first, then bolt on error handling when things break in production.',
      'Directive treats failure as a first-class concern:',
    ],
    bullets: [
      { bold: 'Retry policies', text: 'are declared on resolvers, not implemented ad-hoc in every async function' },
      { bold: 'Timeouts', text: 'prevent resolvers from hanging indefinitely' },
      { bold: 'Error boundaries', text: 'catch failures and provide configurable recovery' },
      { bold: 'Deduplication keys', text: 'prevent redundant work automatically' },
    ],
    afterBullets: [
      'This isn\u2019t just convenience. When resilience is declarative and built into the resolution layer, it\u2019s consistent. Every resolver gets the same quality of error handling, not just the ones where someone remembered to add a try/catch.',
    ],
  },
  {
    icon: MagnifyingGlass,
    title: 'Inspectability Over Magic',
    paragraphs: [
      'Directive automates orchestration, but it doesn\u2019t hide what it\u2019s doing. Every decision the runtime makes is observable.',
    ],
    bullets: [
      { bold: 'inspect()', text: 'shows current facts, active constraints, pending requirements, and running resolvers' },
      { bold: 'explain()', text: 'traces why a particular requirement was generated \u2013 which constraint, which fact values' },
      { bold: 'Time-travel', text: 'lets you step through state changes and see exactly what happened at each point' },
    ],
    afterBullets: [
      'Automatic doesn\u2019t mean opaque. When something unexpected happens, you should be able to trace from effect back to cause without guessing. The runtime should explain itself.',
      'This is a deliberate design choice: the cost of adding inspectability is paid once in the framework. The alternative \u2013 adding logging and debugging to every ad-hoc event handler \u2013 is paid repeatedly by every developer on every project.',
    ],
  },
  {
    icon: Eye,
    title: 'Framework Agnostic, Opinion Strong',
    paragraphs: [
      'Directive works with React, Vue, Svelte, Solid, and Lit. It runs in browsers, servers, and workers. It doesn\u2019t depend on any particular rendering framework or runtime environment.',
      'But it has strong opinions about how state should flow: state changes flow through the reconciliation loop, not around it. Side effects are explicit (effects and resolvers), not implicit. Derived state is computed, not stored. Async operations are managed by the runtime, not by components.',
      'These opinions exist because they eliminate real problems. Race conditions disappear when the runtime manages async. Stale derived state disappears when derivations are auto-tracked. Scattered logic disappears when constraints centralize rules.',
      'The framework adapters are thin \u2013 they connect Directive\u2019s reactive system to each framework\u2019s rendering cycle. The core logic doesn\u2019t change regardless of which UI framework you use or where the system lives.',
    ],
  },
]

export default function PhilosophyPage() {
  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-16 sm:px-6 lg:px-8 xl:px-12">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Philosophy
        </h1>
        <p className="mt-4 text-xl text-slate-600 dark:text-slate-400">
          Directive is built on a belief: applications should declare what must
          be true, not script how to get there.
        </p>

        {/* Principles */}
        <div className="mt-16 space-y-16">
          {principles.map((principle) => (
            <section key={principle.title}>
              <div className="flex items-center gap-3">
                <principle.icon
                  weight="duotone"
                  className="h-6 w-6 shrink-0 text-brand-primary dark:text-brand-primary-400"
                />
                <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
                  {principle.title}
                </h2>
              </div>

              <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
                {principle.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>

              {principle.bullets && (
                <ul className="mt-4 space-y-2 text-base leading-relaxed text-slate-600 dark:text-slate-400">
                  {principle.bullets.map((item) => (
                    <li key={item.bold} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
                      <span>
                        <strong className="font-semibold text-slate-900 dark:text-white">
                          {item.bold}
                        </strong>{' '}
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {principle.afterBullets && (
                <div className="mt-4 space-y-4 text-base leading-relaxed text-slate-600 dark:text-slate-400">
                  {principle.afterBullets.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Next Steps */}
        <div className="mt-20 rounded-xl border border-slate-200/60 bg-slate-50/50 px-6 py-6 dark:border-slate-700/40 dark:bg-slate-800/30">
          <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
            Next Steps
          </h2>
          <ul className="mt-4 space-y-2">
            {[
              { href: '/docs/why-directive', label: 'Why Directive', description: 'The specific problems Directive solves' },
              { href: '/docs/core-concepts', label: 'Core Concepts', description: 'The technical mental model' },
              { href: '/docs/quick-start', label: 'Quick Start', description: 'Build your first module' },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="group flex items-center gap-2 text-base text-brand-primary hover:underline dark:text-brand-primary-400"
                >
                  <span className="font-semibold">{link.label}</span>
                  <span className="text-slate-400 dark:text-slate-500">
                    &ndash; {link.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
