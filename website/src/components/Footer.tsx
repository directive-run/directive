"use client";

import { Heart, PaperPlaneTilt } from "@phosphor-icons/react";
import Link from "next/link";

import { Logomark } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeSelector";
import { GitHubIcon } from "@/components/icons/GitHubIcon";

const footerLinkClass =
  "text-[15px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-brand-surface dark:border-slate-800">
      <div className="mx-auto max-w-8xl px-4 py-12 sm:px-6 lg:px-8 xl:px-12">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-3 sm:gap-16">
          {/* Col 1: Brand */}
          <div>
            <div className="flex items-center gap-2">
              <Logomark className="h-7 w-7" />
              <span className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Directive
              </span>
            </div>
            <p className="mt-3 text-[15px] text-slate-500 dark:text-slate-400">
              Declare requirements. Let the runtime resolve them. A
              constraint-driven state management library for TypeScript that
              handles async resolution, dependency tracking, and side effects
              automatically.
            </p>
          </div>

          {/* Col 2: Resources + Help (two-column sub-grid) */}
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Resources
              </h3>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/docs/quick-start" className={footerLinkClass}>
                    Docs
                  </Link>
                </li>
                <li>
                  <Link href="/ai/overview" className={footerLinkClass}>
                    AI Docs
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className={footerLinkClass}>
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="/labs" className={footerLinkClass}>
                    Labs
                  </Link>
                </li>
                <li>
                  <Link href="/branding" className={footerLinkClass}>
                    Brand Guide
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Help
              </h3>
              <ul className="mt-3 space-y-2">
                <li>
                  <Link href="/philosophy" className={footerLinkClass}>
                    Philosophy
                  </Link>
                </li>
                <li>
                  <Link href="/about" className={footerLinkClass}>
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/docs/core-concepts" className={footerLinkClass}>
                    Core Concepts
                  </Link>
                </li>
                <li>
                  <Link href="/docs/quick-start" className={footerLinkClass}>
                    Quick Start
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Col 3: Community */}
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Community
            </h3>
            <p className="mt-3 text-[15px] text-slate-500 dark:text-slate-400">
              Directive is free and open source, sustained by the community.
              Help shape the project by contributing or sponsoring.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Link
                href="/support"
                className="inline-flex items-center gap-1.5 text-[15px] text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
              >
                <Heart weight="fill" className="h-3.5 w-3.5" />
                Support the project
              </Link>
              <Link
                href="/contact"
                className="inline-flex items-center gap-1.5 text-[15px] text-slate-500 hover:text-brand-primary dark:text-slate-400 dark:hover:text-brand-primary-400"
              >
                <PaperPlaneTilt weight="fill" className="h-3.5 w-3.5" />
                Get in touch
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-400 sm:flex-row dark:border-slate-800 dark:text-slate-500">
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="https://github.com/directive-run/directive"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200 dark:bg-brand-surface-raised dark:hover:bg-slate-700"
              aria-label="GitHub"
            >
              <GitHubIcon className="h-4 w-4 fill-slate-400 group-hover:fill-slate-500 dark:fill-slate-500 dark:group-hover:fill-slate-400" />
            </Link>
          </div>
          <span>
            MIT License &copy; {new Date().getFullYear()} Directive &middot;
            Made possible by sponsors and contributors
          </span>
        </div>
      </div>
    </footer>
  );
}
