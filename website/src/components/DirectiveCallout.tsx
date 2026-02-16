import Link from 'next/link'

interface DirectiveCalloutProps {
  /** What "this" refers to, e.g. "form", "signup", "page" */
  subject: string
  /** Link to related blog post or docs page */
  href: string
  /** Link label (default: "Read how it works") */
  linkLabel?: string
}

export function DirectiveCallout({
  subject,
  href,
  linkLabel = 'Read how it works',
}: DirectiveCalloutProps) {
  return (
    <div className="rounded-xl border border-brand-primary-200/60 bg-brand-primary-50/60 px-5 py-4 dark:border-brand-primary-800/20 dark:bg-brand-primary-950/10">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        <span className="font-semibold text-slate-900 dark:text-white">
          Powered by Directive.
        </span>{' '}
        This {subject} uses a Directive module with facts, derivations,
        constraints, and resolvers &ndash; zero{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">
          useState
        </code>
        , zero{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700">
          useEffect
        </code>
        .{' '}
        <Link
          href={href}
          className="font-medium text-brand-primary hover:underline dark:text-brand-primary-400"
        >
          {linkLabel} &rarr;
        </Link>
      </p>
    </div>
  )
}
