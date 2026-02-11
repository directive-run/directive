import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About — Directive',
  description:
    'Learn about Directive, the constraint-driven runtime for TypeScript, and the team behind it.',
}

export default function AboutPage() {
  return (
    <div className="w-full py-16">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          About Directive
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Declare requirements. Let the runtime resolve them.
        </p>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            What is Directive?
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-400">
            Directive is a constraint-driven runtime for TypeScript. Instead of
            writing imperative state transitions, you declare what must be true
            and let the runtime figure out how to make it happen. Define
            constraints, attach resolvers, and let Directive orchestrate
            everything — from simple UI state to complex AI agent workflows.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            Created by Jason Comes
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-400">
            Directive is built by Jason Comes, a developer with 18+ years of
            experience building software. What started as frustration with
            existing state management tools evolved into a new paradigm —
            one where you describe what your system needs and the runtime takes
            care of the rest.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            Open Source
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-400">
            Directive is fully open source and MIT licensed. Contributions,
            feedback, and bug reports are always welcome.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
            Links
          </h2>
          <ul className="mt-4 space-y-3">
            {[
              { href: '/docs/quick-start', label: 'Documentation' },
              { href: '/blog', label: 'Blog' },
              {
                href: 'https://github.com/sizls/directive',
                label: 'GitHub',
                external: true,
              },
              { href: '/support', label: 'Support the Project' },
            ].map(({ href, label, external }) => (
              <li key={href}>
                {external ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-primary hover:text-brand-primary-600 dark:text-brand-primary-400 dark:hover:text-brand-primary-300"
                  >
                    {label} &rarr;
                  </a>
                ) : (
                  <Link
                    href={href}
                    className="text-brand-primary hover:text-brand-primary-600 dark:text-brand-primary-400 dark:hover:text-brand-primary-300"
                  >
                    {label} &rarr;
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
