import Link from 'next/link'

export function DocsEndNudge() {
  return (
    <div className="mt-12 flex items-center gap-3 text-sm text-slate-400 opacity-60 transition-opacity hover:opacity-100">
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      <span>
        Was this helpful?{' '}
        <Link
          href="https://github.com/sizls/directive"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          Star us on GitHub
        </Link>
        {' or '}
        <Link
          href="/support"
          className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
        >
          support the project
        </Link>
        .
      </span>
      <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}
