import Image from 'next/image'

import { Button } from '@/components/Button'
import blurCyanImage from '@/images/blur-cyan.png'
import blurIndigoImage from '@/images/blur-indigo.png'

export default function NotFound() {
  return (
    <div className="relative isolate overflow-hidden bg-slate-900 py-24 sm:py-32">
      <Image
        className="absolute top-0 left-0 -translate-x-1/3 -translate-y-1/4 opacity-40"
        src={blurCyanImage}
        alt=""
        width={530}
        height={530}
        unoptimized
        priority
      />
      <Image
        className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 opacity-40"
        src={blurIndigoImage}
        alt=""
        width={567}
        height={567}
        unoptimized
        priority
      />

      <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center px-6 text-center">
        <p className="bg-gradient-to-r from-[var(--color-brand-primary-200)] via-[var(--color-brand-primary-300)] to-[var(--color-brand-accent-200)] bg-clip-text font-display text-8xl font-bold tracking-tight text-transparent sm:text-9xl">
          404
        </p>

        <h1 className="mt-4 font-display text-2xl font-semibold text-white">
          Page not found
        </h1>

        <div className="mt-8 w-full max-w-sm overflow-hidden rounded-xl bg-[#0A101F]/80 ring-1 ring-white/10 backdrop-blur-sm">
          <div className="h-px bg-gradient-to-r from-[var(--color-brand-primary-300)] via-[var(--color-brand-accent-200)] to-[var(--color-brand-primary-300)]" />
          <div className="px-5 py-4 font-mono text-sm leading-relaxed text-slate-400">
            <p>
              <span className="text-[var(--color-brand-primary-300)]">constraint</span>{' '}
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
              <span className="text-white">&quot;/...&quot;</span>
              {' }'}
            </p>
            <p className="mt-1 pl-4">
              resolver:{' '}
              <span className="text-red-400">none found</span>
            </p>
          </div>
          <div className="h-px bg-gradient-to-r from-[var(--color-brand-primary-300)] via-[var(--color-brand-accent-200)] to-[var(--color-brand-primary-300)]" />
        </div>

        <p className="mt-6 text-base text-slate-400">
          This route has no resolver. Let&apos;s get you back on track.
        </p>

        <div className="mt-8 flex gap-4">
          <Button variant="secondary" href="/">
            Go home
          </Button>
          <Button variant="secondary" href="/docs/quick-start">
            Browse docs
          </Button>
        </div>
      </div>
    </div>
  )
}
