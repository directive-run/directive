"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Heart } from "@phosphor-icons/react";

import { AIChatWidget } from "@/components/AIChatWidget";
import { AIHero } from "@/components/AIHero";
import { BrandPresetSwitcher } from "@/components/BrandPresetSwitcher";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Logo, Logomark } from "@/components/Logo";
import { MobileNavigation } from "@/components/MobileNavigation";
import { Navigation } from "@/components/Navigation";
import { Newsletter } from "@/components/Newsletter";
import { NotificationBanners } from "@/components/NotificationBanners";
import { Search } from "@/components/Search";
import { ShareButton } from "@/components/ShareButton";
import { ThemeToggle } from "@/components/ThemeSelector";
import { VersionSelector } from "@/components/VersionSelector";
import { GitHubIcon } from "@/components/icons/GitHubIcon";
import {
  useCanUseChat,
  useCanUseSearch,
  useCanUseShareButton,
  useCanUseThemeSelector,
  useCanUseVersionSelector,
} from "@/lib/feature-flags";
import { aiNavigation, getSiteSection } from "@/lib/navigation";

function HeaderLink({
  href,
  activePrefix,
  children,
}: {
  href: string;
  activePrefix?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(activePrefix ?? href);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={clsx(
        "flex items-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary",
        isActive
          ? "text-brand-primary"
          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300",
      )}
    >
      {children}
    </Link>
  );
}

function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-brand-primary focus:px-4 focus:py-2 focus:text-white focus:outline-none"
    >
      Skip to main content
    </a>
  );
}

function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const canUseSearch = useCanUseSearch();
  const canUseThemeSelector = useCanUseThemeSelector();
  const canUseShareButton = useCanUseShareButton();

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 0);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <header
      className={clsx(
        "sticky top-0 z-50 flex flex-none items-center justify-between bg-brand-surface px-4 py-5 shadow-md shadow-slate-900/5 transition duration-500 sm:px-6 lg:px-8 dark:shadow-none",
        isScrolled
          ? "dark:bg-brand-surface/95 dark:backdrop-blur-sm dark:[@supports(backdrop-filter:blur(0))]:bg-brand-surface/75"
          : "dark:bg-transparent",
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
        <div className="-my-5 mr-2 min-w-0 md:mr-6 md:min-w-[190px] md:flex-1 lg:mr-8">
          <Search />
        </div>
      )}
      <div className="relative flex basis-0 items-center justify-end gap-6 sm:gap-8 md:grow">
        <div className="hidden items-center gap-8 sm:gap-10 md:flex">
          <HeaderLink href="/docs/quick-start" activePrefix="/docs">
            Docs
          </HeaderLink>
          <HeaderLink href="/ai/overview" activePrefix="/ai">
            AI
          </HeaderLink>
          <HeaderLink href="/blog">Blog</HeaderLink>
        </div>
        <div className="flex items-center gap-4">
          {canUseThemeSelector && (
            <div className="hidden lg:block">
              <ThemeToggle />
            </div>
          )}
          <div className="hidden lg:block">
            <BrandPresetSwitcher className="relative z-10" />
          </div>
          {canUseShareButton && <ShareButton />}
          <Link
            href="https://github.com/directive-run/directive"
            className="group flex h-10 w-10 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary sm:h-6 sm:w-6"
            aria-label="GitHub"
          >
            <GitHubIcon className="h-5 w-5 fill-slate-400 group-hover:fill-slate-500 sm:h-6 sm:w-6 dark:group-hover:fill-slate-300" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const section = getSiteSection(pathname);
  const isHomePage = section === "home";
  const isDocsPage = section === "home" || section === "docs";
  const isAIPage = section === "ai";
  const hasSidebar = isDocsPage || isAIPage;
  const canUseVersionSelector = useCanUseVersionSelector();
  const canUseChat = useCanUseChat();

  // Scroll to top on navigation (Link clicks), but not on back/forward
  const isPopStateRef = useRef(false);

  useEffect(() => {
    const handlePopState = () => {
      isPopStateRef.current = true;
    };

    window.addEventListener("popstate", handlePopState);

    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (isPopStateRef.current) {
      isPopStateRef.current = false;

      return;
    }

    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex w-full flex-col">
      <SkipLink />
      <NotificationBanners />
      <Header />

      {isHomePage && <Hero />}
      {pathname === "/ai/overview" && <AIHero />}

      {hasSidebar ? (
        <div
          id="main-content"
          className="relative mx-auto flex w-full max-w-8xl flex-auto justify-center sm:px-2 lg:px-8 xl:px-12"
        >
          <div className="hidden lg:relative lg:block lg:flex-none">
            <div className="absolute inset-y-0 right-0 w-[50vw] bg-brand-surface-inset" />
            <div className="absolute top-16 right-0 bottom-0 h-12 w-px bg-linear-to-t from-slate-200 dark:from-slate-800" />
            <div className="absolute top-28 right-0 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />
            <div className="sticky top-19 -ml-0.5 h-[calc(100vh-4.75rem)] w-64 overflow-x-hidden overflow-y-auto py-16 pr-8 pl-0.5 xl:w-72 xl:pr-16">
              {canUseVersionSelector && !isAIPage && (
                <div className="mb-6">
                  <VersionSelector className="w-full" />
                </div>
              )}
              <Navigation
                navigationOverride={isAIPage ? aiNavigation : undefined}
              />
              <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
                {isAIPage ? (
                  <Link
                    href="/docs/quick-start"
                    className="text-xs font-medium text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
                  >
                    &larr; Core Docs
                  </Link>
                ) : (
                  <Link
                    href="/ai/overview"
                    className="text-xs font-medium text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
                  >
                    Explore AI Docs &rarr;
                  </Link>
                )}
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
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
      ) : (
        <div id="main-content" className="relative w-full flex-auto">
          {children}
        </div>
      )}
      <Newsletter />
      <Footer />
      {canUseChat && <AIChatWidget />}
    </div>
  );
}
