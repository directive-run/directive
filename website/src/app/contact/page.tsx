'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import type { Metadata } from 'next'
import {
  ChatCircle,
  CheckCircle,
  CircleNotch,
  Envelope,
  GithubLogo,
  Warning,
  XCircle,
} from '@phosphor-icons/react'

import {
  useContactField,
  useContactDerived,
  useContactFormEvents,
  useCanSubmit,
  useFormStatus,
} from '@/lib/contact-form'

// ---------------------------------------------------------------------------
// Metadata (exported from a separate layout if needed; inlined for standalone)
// ---------------------------------------------------------------------------

// Note: metadata must be exported from a Server Component (layout.tsx).
// For 'use client' pages, create a layout.tsx alongside this file.

// ---------------------------------------------------------------------------
// Subject options
// ---------------------------------------------------------------------------

const SUBJECTS = [
  { value: '', label: 'Select a subject' },
  { value: 'general', label: 'General inquiry' },
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'partnership', label: 'Partnership' },
]

// ---------------------------------------------------------------------------
// Social links (SVG icons inline to avoid extra deps)
// ---------------------------------------------------------------------------

function BlueSkyIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 600 530" fill="currentColor" {...props}>
      <path d="M135.72 44.03C202.216 93.951 273.74 195.401 300 249.98c26.262-54.578 97.784-156.028 164.28-205.95C512.26 8.009 590-19.862 590 68.825c0 17.746-10.188 149.032-16.172 170.346-20.794 74.052-96.502 92.942-163.348 81.478 116.73 19.964 146.413 86.086 82.265 152.208C419.135 546.456 313.526 485.855 303.326 460.93c-1.86-4.55-2.726-9.404-3.326-13.163-.6 3.76-1.466 8.613-3.326 13.162-10.2 24.926-115.81 85.527-189.418 11.928-64.148-66.122-34.465-132.244 82.265-152.208-66.846 11.464-142.554-7.426-163.348-81.478C20.188 217.857 10 86.571 10 68.825 10-19.862 87.74 8.01 135.72 44.03Z" />
    </svg>
  )
}

function XIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

function Field({
  label,
  name,
  error,
  children,
}: {
  label: string
  name: string
  error: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
          <Warning weight="fill" className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form component
// ---------------------------------------------------------------------------

function ContactForm() {
  const name = useContactField('name')
  const email = useContactField('email')
  const subject = useContactField('subject')
  const message = useContactField('message')
  const status = useFormStatus()
  const errorMessage = useContactField('errorMessage')

  const nameError = useContactDerived('nameError')
  const emailError = useContactDerived('emailError')
  const subjectError = useContactDerived('subjectError')
  const messageError = useContactDerived('messageError')
  const charCount = useContactDerived('messageCharCount')
  const canSubmit = useCanSubmit()

  const events = useContactFormEvents()

  const handleChange = useCallback(
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      events.updateField({ field, value: e.target.value })
    },
    [events],
  )

  const handleBlur = useCallback(
    (field: string) => () => {
      events.touchField({ field })
    },
    [events],
  )

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      events.submit({})
    },
    [events],
  )

  const handleReset = useCallback(() => {
    events.reset({})
  }, [events])

  const inputClass =
    'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500 dark:focus:border-brand-primary-400 dark:focus:ring-brand-primary-400/20'

  if (status === 'success') {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-6 py-10 text-center dark:border-emerald-800/30 dark:bg-emerald-950/20">
        <CheckCircle
          weight="duotone"
          className="mx-auto h-12 w-12 text-emerald-500 dark:text-emerald-400"
        />
        <h3 className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-white">
          Message sent!
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Thanks for reaching out. We&apos;ll get back to you soon.
        </p>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          This form will reset automatically in a few seconds.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {status === 'error' && errorMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/50 px-4 py-3 dark:border-red-800/30 dark:bg-red-950/20">
          <XCircle
            weight="fill"
            className="mt-0.5 h-5 w-5 shrink-0 text-red-500 dark:text-red-400"
          />
          <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Name" name="name" error={nameError}>
          <input
            id="name"
            type="text"
            value={name}
            onChange={handleChange('name')}
            onBlur={handleBlur('name')}
            placeholder="Your name"
            className={inputClass}
          />
        </Field>

        <Field label="Email" name="email" error={emailError}>
          <input
            id="email"
            type="email"
            value={email}
            onChange={handleChange('email')}
            onBlur={handleBlur('email')}
            placeholder="you@example.com"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Subject" name="subject" error={subjectError}>
        <select
          id="subject"
          value={subject}
          onChange={handleChange('subject')}
          onBlur={handleBlur('subject')}
          className={inputClass}
        >
          {SUBJECTS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Message" name="message" error={messageError}>
        <div className="relative">
          <textarea
            id="message"
            rows={5}
            value={message}
            onChange={handleChange('message')}
            onBlur={handleBlur('message')}
            placeholder="What can we help with?"
            className={inputClass + ' resize-none'}
          />
          <span className="absolute bottom-2 right-3 text-xs text-slate-400 dark:text-slate-500">
            {charCount} / 10 min
          </span>
        </div>
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-primary-600 dark:hover:bg-brand-primary-500"
        >
          {status === 'submitting' ? (
            <>
              <CircleNotch weight="bold" className="h-4 w-4 animate-spin" />
              Sending&hellip;
            </>
          ) : (
            <>
              <Envelope weight="bold" className="h-4 w-4" />
              Send Message
            </>
          )}
        </button>

        {(name || email || subject || message) && status === 'idle' && (
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          >
            Clear form
          </button>
        )}
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ContactPage() {
  return (
    <div className="w-full py-16">
      <div className="mx-auto max-w-3xl">
        {/* Hero */}
        <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Get in Touch
        </h1>
        <p className="mt-4 text-lg text-slate-600 dark:text-slate-400">
          Questions, bug reports, feature requests, or partnership inquiries
          &ndash; we&apos;d love to hear from you.
        </p>

        {/* Form */}
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white/50 p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-800/50">
          <ContactForm />
        </div>

        {/* Directive callout */}
        <div className="mt-6 rounded-xl border border-brand-primary-100/50 bg-brand-primary-50/20 px-5 py-4 dark:border-brand-primary-800/20 dark:bg-brand-primary-950/10">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-white">Powered by Directive.</span>{' '}
            This form uses a Directive module with facts, derivations, constraints, and resolvers &ndash; zero{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">useState</code>,
            zero{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">useEffect</code>.{' '}
            <Link
              href="/blog/declarative-forms-with-directive"
              className="font-medium text-brand-primary hover:underline dark:text-brand-primary-400"
            >
              Read the blog post &rarr;
            </Link>
          </p>
        </div>

        {/* Social / alternative contact */}
        <div className="mt-12">
          <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
            Other Ways to Reach Us
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Prefer a different channel? Find us here.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <a
              href="https://github.com/directive-run/directive/discussions"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-slate-200 px-5 py-4 transition-colors hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            >
              <GithubLogo
                weight="duotone"
                className="h-8 w-8 shrink-0 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300"
              />
              <div>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  GitHub Discussions
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ask questions &amp; share ideas
                </p>
              </div>
            </a>

            <a
              href="https://x.com/directive_run"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-slate-200 px-5 py-4 transition-colors hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            >
              <XIcon className="h-7 w-7 shrink-0 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
              <div>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  X / Twitter
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Follow for updates
                </p>
              </div>
            </a>

            <a
              href="https://bsky.app/profile/directive.run"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-slate-200 px-5 py-4 transition-colors hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            >
              <BlueSkyIcon className="h-7 w-7 shrink-0 text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
              <div>
                <p className="text-sm font-semibold text-slate-900 group-hover:text-brand-primary dark:text-white dark:group-hover:text-brand-primary-400">
                  Bluesky
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Join the conversation
                </p>
              </div>
            </a>
          </div>
        </div>

        {/* Chat callout */}
        <div className="mt-8 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <ChatCircle
            weight="duotone"
            className="h-8 w-8 shrink-0 text-brand-primary dark:text-brand-primary-400"
          />
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              Try the AI chat
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Have a question about the API? The docs chatbot in the bottom-right can answer most technical questions instantly.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
