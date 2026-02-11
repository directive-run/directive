'use client'

import Link from 'next/link'
import { Heart } from '@phosphor-icons/react'

import { Logomark } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeSelector'

function GitHubIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" />
    </svg>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-brand-surface dark:border-slate-800">
      <div className="mx-auto max-w-8xl px-4 py-12 sm:px-6 lg:px-8 xl:px-12">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-16">
          {/* Col 1: Brand */}
          <div>
            <div className="flex items-center gap-2">
              <Logomark className="h-7 w-7" />
              <span className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Directive
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Declare requirements. Let the runtime resolve them.
            </p>
          </div>

          {/* Col 2: Resources */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Resources
            </h3>
            <ul className="mt-3 space-y-2">
              {[
                { href: '/docs/quick-start', label: 'Docs' },
                { href: '/blog', label: 'Blog' },
                { href: '/about', label: 'About' },
                { href: 'https://github.com/sizls/directive', label: 'GitHub', external: true },
              ].map(({ href, label, external }) => (
                <li key={href}>
                  <Link
                    href={href}
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                    className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Col 3: Community */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Community
            </h3>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Directive is free and open source, sustained by the community.
            </p>
            <Link
              href="/support"
              className="mt-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
            >
              <Heart weight="fill" className="h-3.5 w-3.5" />
              Support the project
            </Link>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-400 sm:flex-row dark:border-slate-800 dark:text-slate-500">
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="https://github.com/sizls/directive"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
              aria-label="GitHub"
            >
              <GitHubIcon className="h-4 w-4 fill-slate-400 group-hover:fill-slate-500 dark:fill-slate-500 dark:group-hover:fill-slate-400" />
            </Link>
          </div>
          <span>MIT License &copy; {new Date().getFullYear()} &middot; Made possible by sponsors and contributors</span>
        </div>
      </div>
    </footer>
  )
}
