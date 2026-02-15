'use client'

import { memo, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

import { getNavigationForVersion } from '@/lib/navigation'
import { useDocsVersion } from '@/lib/hooks/useDocsVersion'

function ArrowIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path d="m9.182 13.423-1.17-1.16 3.505-3.505H3V7.065h8.517l-3.506-3.5L9.181 2.4l5.512 5.511-5.511 5.512Z" />
    </svg>
  )
}

const PageLink = memo(function PageLink({
  title,
  href,
  dir = 'next',
  ...props
}: Omit<React.ComponentPropsWithoutRef<'div'>, 'dir' | 'title'> & {
  title: string
  href: string
  dir?: 'previous' | 'next'
}) {
  return (
    <div {...props}>
      <dt className="font-display text-sm font-medium text-slate-900 dark:text-white">
        {dir === 'next' ? 'Next' : 'Previous'}
      </dt>
      <dd className="mt-1">
        <Link
          href={href}
          aria-label={`Go to ${dir} page: ${title}`}
          className={clsx(
            'flex items-center gap-x-1 text-base font-semibold text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300',
            dir === 'previous' && 'flex-row-reverse',
          )}
        >
          {title}
          <ArrowIcon
            className={clsx(
              'h-4 w-4 flex-none fill-current',
              dir === 'previous' && '-scale-x-100',
            )}
          />
        </Link>
      </dd>
    </div>
  )
})

export const PrevNextLinks = memo(function PrevNextLinks() {
  const pathname = usePathname()
  const { version } = useDocsVersion()

  const allLinks = useMemo(
    () => getNavigationForVersion(version).flatMap((section) => section.links),
    [version],
  )

  const { previousPage, nextPage } = useMemo(() => {
    const linkIndex = allLinks.findIndex((link) => link.href === pathname)

    return {
      previousPage: linkIndex > -1 ? allLinks[linkIndex - 1] : null,
      nextPage: linkIndex > -1 ? allLinks[linkIndex + 1] : null,
    }
  }, [allLinks, pathname])

  if (!nextPage && !previousPage) {
    return null
  }

  return (
    <dl className="mt-16 flex border-t border-slate-200 pt-6 dark:border-slate-800">
      {previousPage && <PageLink dir="previous" {...previousPage} />}
      {nextPage && <PageLink className="ml-auto text-right" {...nextPage} />}
    </dl>
  )
})
