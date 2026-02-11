import type { Metadata } from 'next'
import {
  ArrowRight,
  Coffee,
  Gift,
  Heart,
  Scales,
  ShieldCheck,
  Star,
  Terminal,
} from '@phosphor-icons/react/dist/ssr'

export const metadata: Metadata = {
  title: 'Support — Directive',
  description:
    'Support the Directive project through sponsorship, donations, or by starring us on GitHub.',
}

const stats = [
  {
    label: 'Zero VC funding',
    description: 'Independent and community-sustained',
    icon: ShieldCheck,
  },
  {
    label: 'MIT Licensed',
    description: 'Free forever, for everyone',
    icon: Scales,
  },
  {
    label: 'Built in the open',
    description: 'Every line of code is public',
    icon: Terminal,
  },
]

export default function SupportPage() {
  return (
    <div className="w-full py-16">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Support Directive
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Built by a solo developer working in the open. Every contribution
          helps keep this project alive, independent, and free.
        </p>

        {/* Impact stats */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl bg-brand-primary-50/20 border border-brand-primary-100/50 px-5 py-4 dark:bg-brand-primary-950/10 dark:border-brand-primary-800/20"
            >
              <stat.icon
                weight="duotone"
                className="h-6 w-6 text-brand-primary dark:text-brand-primary-400"
              />
              <p className="mt-3 font-display text-sm font-semibold text-slate-900 dark:text-white">
                {stat.label}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {stat.description}
              </p>
            </div>
          ))}
        </div>

        {/* Tiered CTAs */}
        <div className="mt-12 space-y-4">
          {/* Primary: GitHub Sponsors */}
          <a
            href="https://github.com/sponsors/sizls"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-2xl bg-brand-primary px-6 py-5 text-white shadow-md transition-shadow hover:shadow-lg dark:bg-brand-primary-600"
          >
            <div className="flex items-center gap-4">
              <Heart weight="fill" className="h-7 w-7 shrink-0 text-white/80" />
              <div>
                <h3 className="font-display text-base font-semibold">
                  GitHub Sponsors
                </h3>
                <p className="mt-0.5 text-sm text-white/80">
                  Recurring monthly support
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 opacity-60 transition-transform group-hover:translate-x-0.5" />
          </a>

          {/* Secondary: Buy Me a Coffee + Ko-fi */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <a
              href="https://buymeacoffee.com/sizls"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-brand-primary-50/30 px-6 py-5 shadow-sm ring-1 ring-brand-primary-200/40 transition-all hover:bg-brand-primary-50/60 hover:shadow-md dark:bg-slate-800/80 dark:ring-brand-primary-400/10 dark:hover:bg-slate-700/80 dark:hover:ring-brand-primary-400/20"
            >
              <Coffee
                weight="duotone"
                className="h-6 w-6 text-slate-400 group-hover:text-brand-primary dark:text-slate-500 dark:group-hover:text-brand-primary-400"
              />
              <h3 className="mt-3 font-display text-base font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                Buy Me a Coffee
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                One-time support
              </p>
            </a>
            <a
              href="https://ko-fi.com/sizls"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl bg-brand-primary-50/30 px-6 py-5 shadow-sm ring-1 ring-brand-primary-200/40 transition-all hover:bg-brand-primary-50/60 hover:shadow-md dark:bg-slate-800/80 dark:ring-brand-primary-400/10 dark:hover:bg-slate-700/80 dark:hover:ring-brand-primary-400/20"
            >
              <Gift
                weight="duotone"
                className="h-6 w-6 text-slate-400 group-hover:text-brand-primary dark:text-slate-500 dark:group-hover:text-brand-primary-400"
              />
              <h3 className="mt-3 font-display text-base font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                Ko-fi
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                One-time support
              </p>
            </a>
          </div>

          {/* Tertiary: Star on GitHub */}
          <a
            href="https://github.com/sizls/directive"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-2xl border border-slate-200 px-6 py-5 transition-colors hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
          >
            <div className="flex items-center gap-4">
              <Star weight="fill" className="h-6 w-6 shrink-0 text-amber-400" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  Star on GitHub
                </h3>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  Free — help us reach more developers
                </p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-400 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>

        {/* Sponsors placeholder */}
        <div className="mt-16">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
            Sponsors &amp; Supporters
          </h2>
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Be the first to sponsor Directive.
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Sponsors are displayed here and on the GitHub README.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
