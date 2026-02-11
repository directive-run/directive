import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Support — Directive',
  description:
    'Support the Directive project through sponsorship, donations, or by starring us on GitHub.',
}

const options = [
  {
    name: 'GitHub Sponsors',
    description: 'Sponsor the project directly on GitHub',
    emoji: '💜',
    href: 'https://github.com/sponsors/sizls',
  },
  {
    name: 'Buy Me a Coffee',
    description: 'Fuel late-night coding sessions',
    emoji: '☕',
    href: 'https://buymeacoffee.com/sizls',
  },
  {
    name: 'Ko-fi',
    description: 'Support with a one-time donation',
    emoji: '🎁',
    href: 'https://ko-fi.com/sizls',
  },
  {
    name: 'Star on GitHub',
    description: 'Free! Help us grow',
    emoji: '⭐',
    href: 'https://github.com/sizls/directive',
  },
]

export default function SupportPage() {
  return (
    <div className="w-full py-16">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Support Directive
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Directive is free, open source, and built with care. If it saves you
          time or sparks an idea, consider supporting the project.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {options.map((option) => (
            <a
              key={option.name}
              href={option.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-white p-6 shadow-md shadow-slate-900/5 ring-1 ring-slate-900/5 transition-shadow hover:shadow-lg dark:bg-slate-800 dark:ring-slate-700/50"
            >
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl [background:linear-gradient(to_bottom_right,var(--brand-primary-100),var(--brand-accent-100))] dark:[background:linear-gradient(to_bottom_right,var(--brand-primary-900),var(--brand-accent-900))]"
              >
                {option.emoji}
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                {option.name}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {option.description}
              </p>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
