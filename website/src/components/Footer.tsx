import Link from 'next/link'
import { Heart } from '@phosphor-icons/react/dist/ssr'

import { Logomark } from '@/components/Logo'

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
          {/* Col 1: Brand */}
          <div>
            <div className="flex items-center gap-2">
              <Logomark className="h-7 w-7" />
              <span className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Directive
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Declare requirements. Let the runtime resolve them.
            </p>
            <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">
              Born from building a game engine. Created by{' '}
              <a
                href="https://www.linkedin.com/in/jasonwcomes/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
              >
                Jason Comes
              </a>
              .
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
              className="mt-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
            >
              <Heart weight="fill" className="h-3.5 w-3.5" />
              Support the project
            </Link>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-slate-200/80 pt-6 text-xs text-slate-400 sm:flex-row dark:border-slate-800 dark:text-slate-500">
          <span>MIT License &copy; {new Date().getFullYear()}</span>
          <span>Made possible by sponsors and contributors</span>
        </div>
      </div>
    </footer>
  )
}
