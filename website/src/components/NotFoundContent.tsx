'use client'

import { usePathname } from 'next/navigation'
import { Cat, Dog, Bug, Rabbit, Cow } from '@phosphor-icons/react'

const animals = [
  {
    Icon: Cat,
    subtitle: 'This page has been herding cats.',
    resolver: 'cat knocked it off the table',
  },
  {
    Icon: Dog,
    subtitle: "Even a good boy can't fetch this page.",
    resolver: 'dog ate the route',
  },
  {
    Icon: Bug,
    subtitle: "Not a bug \u2013 this page genuinely doesn't exist.",
    resolver: 'squashed, but the page is still gone',
  },
  {
    Icon: Rabbit,
    subtitle: 'This page went down the rabbit hole.',
    resolver: 'hopped to another burrow',
  },
  {
    Icon: Cow,
    subtitle: 'This page has been put out to pasture.',
    resolver: 'mooved to greener pastures',
  },
] as const

export function NotFoundContent() {
  const pathname = usePathname()
  const index =
    pathname.split('').reduce((sum, ch) => sum * 37 + ch.charCodeAt(0), 0) %
    animals.length
  const { Icon, subtitle, resolver } = animals[Math.abs(index)]

  return (
    <div suppressHydrationWarning>
      <Icon size={100} weight="duotone" className="mx-auto text-slate-500 opacity-70" />

      <p className="bg-gradient-to-r from-[var(--color-brand-primary-200)] via-[var(--color-brand-primary-300)] to-[var(--color-brand-accent-200)] bg-clip-text font-display text-8xl font-bold tracking-tight text-transparent sm:text-9xl">
        404
      </p>

      <h1 className="mt-4 font-display text-2xl font-semibold text-white" suppressHydrationWarning>
        {subtitle}
      </h1>

      <div className="mt-8 w-full max-w-lg overflow-hidden rounded-xl bg-[#0A101F]/80 ring-1 ring-white/10 backdrop-blur-sm">
        <div className="h-px bg-gradient-to-r from-[var(--color-brand-primary-300)] via-[var(--color-brand-accent-200)] to-[var(--color-brand-primary-300)]" />
        <div className="px-6 py-5 font-mono text-base leading-relaxed text-slate-400">
          <p>
            <span className="text-[var(--color-brand-primary-300)]">
              constraint
            </span>{' '}
            <span className="text-white">&quot;find-page&quot;</span>{' '}
            <span className="text-red-400">unmet</span>
          </p>
          <p className="mt-1 pl-4">
            require: {'{ '}
            <span className="text-[var(--color-brand-accent-200)]">type</span>
            {': '}
            <span className="text-white">&quot;ROUTE&quot;</span>
            {', '}
            <span className="text-[var(--color-brand-accent-200)]">path</span>
            {': '}
            <span className="text-white">&quot;{pathname}&quot;</span>
            {' }'}
          </p>
          <p className="mt-1 pl-4" suppressHydrationWarning>
            resolver:{' '}
            <span className="text-red-400">{resolver}</span>
          </p>
        </div>
        <div className="h-px bg-gradient-to-r from-[var(--color-brand-primary-300)] via-[var(--color-brand-accent-200)] to-[var(--color-brand-primary-300)]" />
      </div>

      <p className="mt-6 text-base text-slate-400">
        This route has no resolver. Let&apos;s get you back on track.
      </p>
    </div>
  )
}
