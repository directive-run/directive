'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Dialog, DialogPanel } from '@headlessui/react'

import { Heart, List, X } from '@phosphor-icons/react'

import { Logomark } from '@/components/Logo'
import { Navigation } from '@/components/Navigation'

function CloseOnNavigation({ close }: { close: () => void }) {
  let pathname = usePathname()
  let searchParams = useSearchParams()

  useEffect(() => {
    close()
  }, [pathname, searchParams, close])

  return null
}

export function MobileNavigation() {
  let [isOpen, setIsOpen] = useState(false)
  let close = useCallback(() => setIsOpen(false), [setIsOpen])

  function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    let link = event.currentTarget
    if (
      link.pathname + link.search + link.hash ===
      window.location.pathname + window.location.search + window.location.hash
    ) {
      close()
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="relative cursor-pointer"
        aria-label="Open navigation"
      >
        <List className="h-6 w-6 text-slate-500" />
      </button>
      <Suspense fallback={null}>
        <CloseOnNavigation close={close} />
      </Suspense>
      <Dialog
        open={isOpen}
        onClose={() => close()}
        className="fixed inset-0 z-50 flex items-start overflow-y-auto bg-slate-900/50 pr-10 backdrop-blur-sm lg:hidden"
        aria-label="Navigation"
      >
        <DialogPanel className="min-h-full w-full max-w-xs bg-white px-4 pt-5 pb-12 sm:px-6 dark:bg-brand-surface">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => close()}
              className="cursor-pointer"
              aria-label="Close navigation"
            >
              <X className="h-6 w-6 text-slate-500" />
            </button>
            <Link href="/" className="ml-6" aria-label="Home page">
              <Logomark className="h-9 w-9" />
            </Link>
          </div>
          <div className="mt-5 flex flex-col gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
            <Link
              href="/docs/quick-start"
              onClick={onLinkClick}
              className="flex items-center text-base font-medium text-slate-900 hover:text-brand-primary dark:text-white dark:hover:text-brand-primary-400"
            >
              Docs
            </Link>
            <Link
              href="/blog"
              onClick={onLinkClick}
              className="flex items-center text-base font-medium text-slate-900 hover:text-brand-primary dark:text-white dark:hover:text-brand-primary-400"
            >
              Blog
            </Link>
            <Link
              href="/about"
              onClick={onLinkClick}
              className="flex items-center text-base font-medium text-slate-900 hover:text-brand-primary dark:text-white dark:hover:text-brand-primary-400"
            >
              About
            </Link>
            <Link
              href="/support"
              onClick={onLinkClick}
              className="flex items-center gap-1.5 text-base font-medium text-slate-900 hover:text-brand-primary dark:text-white dark:hover:text-brand-primary-400"
            >
              <Heart weight="fill" className="h-3.5 w-3.5 text-slate-400" />
              Support
            </Link>
          </div>
          <Navigation className="mt-5 px-1" onLinkClick={onLinkClick} />
        </DialogPanel>
      </Dialog>
    </>
  )
}
