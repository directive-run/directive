'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'

import { Heart } from '@phosphor-icons/react'

import { AIChatWidget } from '@/components/AIChatWidget'
import { Footer } from '@/components/Footer'
import { Hero } from '@/components/Hero'
import { Logo, Logomark } from '@/components/Logo'
import { MobileNavigation } from '@/components/MobileNavigation'
import { Navigation } from '@/components/Navigation'
import { Search } from '@/components/Search'
import { ThemeToggle } from '@/components/ThemeSelector'
import { BrandPresetSwitcher } from '@/components/BrandPresetSwitcher'
import { VersionSelector } from '@/components/VersionSelector'
import {
  useCanUseChat,
  useCanUseSearch,
  useCanUseThemeSelector,
  useCanUseBrandSwitcher,
  useCanUseVersionSelector,
} from '@/lib/feature-flags'

function HeaderLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  let pathname = usePathname()
  let isActive = pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center text-sm font-medium',
        isActive
          ? 'text-brand-primary'
          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300',
      )}
    >
      {children}
    </Link>
  )
}

function SupportLink() {
  let pathname = usePathname()
  let isActive = pathname.startsWith('/support')

  return (
    <Link
      href="/support"
      className={clsx(
        'text-sm font-medium',
        isActive
          ? 'text-brand-primary'
          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300',
      )}
    >
      Support
    </Link>
  )
}

function GitHubIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" />
    </svg>
  )
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-brand-primary focus:px-4 focus:py-2 focus:text-white focus:outline-none"
    >
      Skip to main content
    </a>
  )
}

function Header() {
  let [isScrolled, setIsScrolled] = useState(false)
  let canUseSearch = useCanUseSearch()
  let canUseThemeSelector = useCanUseThemeSelector()
  let canUseBrandSwitcher = useCanUseBrandSwitcher()

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <header
      className={clsx(
        'sticky top-0 z-50 flex flex-none flex-wrap items-center justify-between bg-white px-4 py-5 shadow-md shadow-slate-900/5 transition duration-500 sm:px-6 lg:px-8 dark:shadow-none',
        isScrolled
          ? 'dark:bg-slate-900/95 dark:backdrop-blur-sm dark:[@supports(backdrop-filter:blur(0))]:bg-slate-900/75'
          : 'dark:bg-transparent',
      )}
    >
      <div className="mr-6 flex lg:hidden">
        <MobileNavigation />
      </div>
      <div className="relative flex grow basis-0 items-center">
        <Link href="/" aria-label="Home page">
          <Logomark className="h-9 w-9 lg:hidden" />
          <Logo className="hidden h-9 w-auto fill-slate-700 lg:block dark:fill-brand-primary-100" />
        </Link>
      </div>
      {canUseSearch && (
        <div className="-my-5 mr-6 sm:mr-8 md:mr-0">
          <Search />
        </div>
      )}
      <div className="relative flex basis-0 items-center justify-end gap-6 sm:gap-8 md:grow">
        <div className="hidden items-center gap-8 sm:gap-10 md:flex">
          <HeaderLink href="/docs/quick-start">Docs</HeaderLink>
          <HeaderLink href="/blog">Blog</HeaderLink>
          <SupportLink />
        </div>
        <div className="flex items-center gap-4">
          {canUseThemeSelector && <ThemeToggle />}
          {canUseBrandSwitcher && <BrandPresetSwitcher className="relative z-10" />}
          <Link href="https://github.com/sizls/directive" className="group flex h-10 w-10 items-center justify-center sm:h-6 sm:w-6" aria-label="GitHub">
            <GitHubIcon className="h-5 w-5 fill-slate-400 group-hover:fill-slate-500 sm:h-6 sm:w-6 dark:group-hover:fill-slate-300" />
          </Link>
        </div>
      </div>
    </header>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  let pathname = usePathname()
  let isHomePage = pathname === '/'
  let canUseVersionSelector = useCanUseVersionSelector()
  let canUseChat = useCanUseChat()
  let isStandalonePage =
    pathname.startsWith('/blog') ||
    pathname.startsWith('/support') ||
    pathname.startsWith('/about')

  return (
    <div className="flex w-full flex-col">
      <SkipLink />
      <Header />

      {isHomePage && <Hero />}

      {isStandalonePage ? (
        <div id="main-content" className="relative mx-auto flex w-full max-w-8xl flex-auto px-4 sm:px-6 lg:px-8 xl:px-12">
          {children}
        </div>
      ) : (
        <div id="main-content" className="relative mx-auto flex w-full max-w-8xl flex-auto justify-center sm:px-2 lg:px-8 xl:px-12">
          <div className="hidden lg:relative lg:block lg:flex-none">
            <div className="absolute inset-y-0 right-0 w-[50vw] bg-slate-50 dark:hidden" />
            <div className="absolute top-16 right-0 bottom-0 hidden h-12 w-px bg-linear-to-t from-slate-800 dark:block" />
            <div className="absolute top-28 right-0 bottom-0 hidden w-px bg-slate-800 dark:block" />
            <div className="sticky top-19 -ml-0.5 h-[calc(100vh-4.75rem)] w-64 overflow-x-hidden overflow-y-auto py-16 pr-8 pl-0.5 xl:w-72 xl:pr-16">
              {canUseVersionSelector && (
                <div className="mb-6">
                  <VersionSelector className="w-full" />
                </div>
              )}
              <Navigation />
              <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Directive is community-sustained.
                </p>
                <Link
                  href="/support"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand-primary dark:text-slate-500 dark:hover:text-brand-primary-400"
                >
                  <Heart weight="fill" className="h-3 w-3" />
                  Support the project
                </Link>
              </div>
            </div>
          </div>
          {children}
        </div>
      )}
      <Footer />
      {canUseChat && <AIChatWidget />}
    </div>
  )
}
