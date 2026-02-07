'use client'

import { usePathname } from 'next/navigation'

import { navigation } from '@/lib/navigation'

export function DocsHeader({
  title,
  readingTime,
}: {
  title?: string
  readingTime?: string
}) {
  let pathname = usePathname()
  let section = navigation.find((section) =>
    section.links.find((link) => link.href === pathname),
  )

  if (!title && !section) {
    return null
  }

  return (
    <header className="mb-9 space-y-1">
      <div className="flex items-center gap-3">
        {section && (
          <p className="font-display text-sm font-medium text-sky-500">
            {section.title}
          </p>
        )}
        {readingTime && (
          <>
            {section && (
              <span className="text-slate-300 dark:text-slate-600">•</span>
            )}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {readingTime}
            </p>
          </>
        )}
      </div>
      {title && (
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
      )}
    </header>
  )
}
