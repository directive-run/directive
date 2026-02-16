'use client'

import { useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CircleNotch, CheckCircle } from '@phosphor-icons/react'
import { useDirectiveRef, useSelector, useEvents } from '@directive-run/react'

import { Button } from '@/components/Button'
import { newsletter } from '@/lib/newsletter'
import blurCyanImage from '@/images/blur-cyan.png'
import blurIndigoImage from '@/images/blur-indigo.png'

export function Newsletter() {
  const system = useDirectiveRef(newsletter)

  const email = useSelector(system, (s) => s.email, '')
  const status = useSelector(system, (s) => s.status, 'idle')
  const errorMessage = useSelector(system, (s) => s.errorMessage, '')
  // Derivations are accessible through the selector proxy at runtime but not yet typed
  // @ts-expect-error -- useSelector proxy exposes derivations; type fix tracked separately
  const emailError = useSelector(system, (s) => s.emailError, '')
  // @ts-expect-error -- useSelector proxy exposes derivations; type fix tracked separately
  const canSubmit = useSelector(system, (s) => s.canSubmit, false)

  const events = useEvents(system)

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      events.updateEmail({ value: e.target.value })
    },
    [events],
  )

  const handleBlur = useCallback(() => {
    events.touchEmail()
  }, [events])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      events.submit()
    },
    [events],
  )

  return (
    <div className="relative isolate mt-12 overflow-hidden border-t border-slate-200 bg-slate-900 pt-16 pb-16 sm:pt-24 sm:pb-24 dark:mt-12 dark:border-slate-800 dark:bg-brand-surface dark:pt-24">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 sm:px-6 lg:px-8 xl:flex-row xl:items-center xl:px-12">
        <h2 className="max-w-xl font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl xl:flex-auto">
          <span className="inline bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(to right, var(--color-brand-primary-300), white, var(--color-brand-accent-200))' }}>
            Stay in the loop. Sign up for our newsletter.
          </span>
        </h2>

        {status === 'success' ? (
          <div className="w-full max-w-md rounded-xl border border-emerald-400/20 bg-emerald-950/20 px-5 py-4">
            <div className="flex items-center gap-2">
              <CheckCircle weight="duotone" className="h-5 w-5 shrink-0 text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">
                You&apos;re in! Watch for updates.
              </span>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full max-w-md">
            <div className="flex gap-x-4">
              <label htmlFor="newsletter-email" className="sr-only">
                Email address
              </label>
              <input
                id="newsletter-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Enter your email"
                className="min-w-0 flex-auto rounded-full bg-white/5 px-4 py-2 text-base text-white outline-1 -outline-offset-1 outline-white/10 placeholder:text-slate-400 focus:outline-2 focus:-outline-offset-2 focus:outline-brand-primary sm:text-sm/6"
              />
              <Button
                type="submit"
                disabled={!canSubmit}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === 'submitting' ? (
                  <CircleNotch
                    weight="bold"
                    className="h-4 w-4 animate-spin"
                  />
                ) : (
                  'Subscribe'
                )}
              </Button>
            </div>

            {emailError ? (
              <p className="mt-4 text-sm/6 text-red-400">{emailError}</p>
            ) : status === 'error' && errorMessage ? (
              <p className="mt-4 text-sm/6 text-red-400">{errorMessage}</p>
            ) : (
              <p className="mt-4 text-sm/6 text-slate-300">
                We care about your data. We&apos;ll never share your email.
              </p>
            )}
          </form>
        )}
      </div>

      {/* Directive callout */}
      <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6 lg:px-8 xl:px-12">
        <div className="rounded-xl border border-brand-primary-400/20 bg-brand-primary-950/20 px-5 py-4">
          <p className="text-sm text-slate-400">
            <span className="font-semibold text-white">Powered by Directive.</span>{' '}
            This signup uses a Directive module with facts, derivations, constraints, and resolvers &ndash; zero{' '}
            <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">useState</code>,
            zero{' '}
            <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">useEffect</code>.{' '}
            <Link
              href="/blog/declarative-newsletter-with-directive"
              className="font-medium text-brand-primary-400 hover:text-brand-primary-300"
            >
              Read how it works &rarr;
            </Link>
          </p>
        </div>
      </div>

      <Image
        className="pointer-events-none absolute -top-40 -left-40 -z-10 opacity-40"
        src={blurCyanImage}
        alt=""
        width={530}
        height={530}
        unoptimized
      />
      <Image
        className="pointer-events-none absolute -right-40 -bottom-40 -z-10 opacity-40"
        src={blurIndigoImage}
        alt=""
        width={567}
        height={567}
        unoptimized
      />
    </div>
  )
}
