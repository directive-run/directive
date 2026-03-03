"use client";

import { useDirectiveRef, useEvents, useSelector } from "@directive-run/react";
import { CheckCircle, CircleNotch } from "@phosphor-icons/react";
import Image from "next/image";
import { useCallback } from "react";

import { Button } from "@/components/Button";
import { DirectiveCallout } from "@/components/DirectiveCallout";
import blurCyanImage from "@/images/blur-cyan.png";
import blurIndigoImage from "@/images/blur-indigo.png";
import { newsletter } from "@/lib/newsletter";

export function Newsletter() {
  const system = useDirectiveRef(newsletter);

  const email = useSelector(system, (state) => state.email, "");
  const status = useSelector(system, (state) => state.status, "idle");
  const errorMessage = useSelector(system, (state) => state.errorMessage, "");
  const emailError = useSelector(system, (state) => state.emailError, "");
  const canSubmit = useSelector(system, (state) => state.canSubmit, false);

  const events = useEvents(system);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      events.updateEmail({ value: e.target.value });
    },
    [events],
  );

  const handleBlur = useCallback(() => {
    events.touchEmail();
  }, [events]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      events.submit();
    },
    [events],
  );

  return (
    <div className="relative isolate overflow-hidden border-t border-slate-200 bg-brand-surface pt-16 pb-16 sm:pt-24 sm:pb-24 dark:border-slate-800 dark:pt-24">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-4 text-center sm:px-6 lg:flex-row lg:items-center lg:text-left lg:px-8 xl:px-12">
        <h2 className="max-w-xl font-display text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:flex-auto">
          <span className="newsletter-heading-gradient inline bg-clip-text text-transparent">
            Stay in the loop. Sign up for our newsletter.
          </span>
        </h2>

        {status === "success" ? (
          <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 dark:border-emerald-400/20 dark:bg-emerald-950/20">
            <div className="flex items-center gap-2">
              <CheckCircle
                weight="duotone"
                className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
              />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
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
                className="min-w-0 flex-auto rounded-full bg-white px-4 py-2 text-base text-slate-900 outline-1 -outline-offset-1 outline-slate-300 placeholder:text-slate-400 focus:outline-2 focus:-outline-offset-2 focus:outline-brand-primary dark:bg-white/5 dark:text-white dark:outline-white/10 sm:text-sm/6"
              />
              <Button
                type="submit"
                disabled={!canSubmit}
                className="disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "submitting" ? (
                  <CircleNotch weight="bold" className="h-4 w-4 animate-spin" />
                ) : (
                  "Subscribe"
                )}
              </Button>
            </div>

            {emailError ? (
              <p className="mt-4 text-sm/6 text-red-600 dark:text-red-400">
                {emailError}
              </p>
            ) : status === "error" && errorMessage ? (
              <p className="mt-4 text-sm/6 text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
            ) : (
              <p className="mt-4 text-sm/6 text-slate-500 dark:text-slate-300">
                We care about your data. We&apos;ll never share your email.
              </p>
            )}
          </form>
        )}
      </div>

      {/* Directive callout */}
      <div className="mx-auto mt-8 max-w-5xl px-4 sm:px-6 lg:px-8 xl:px-12">
        <DirectiveCallout
          subject="signup"
          href="/blog/declarative-newsletter-with-directive"
        />
      </div>

      <Image
        className="pointer-events-none absolute -top-40 -left-40 -z-10 opacity-20 dark:opacity-40"
        src={blurCyanImage}
        alt=""
        width={530}
        height={530}
        unoptimized
      />
      <Image
        className="pointer-events-none absolute -right-40 -bottom-40 -z-10 opacity-20 dark:opacity-40"
        src={blurIndigoImage}
        alt=""
        width={567}
        height={567}
        unoptimized
      />
    </div>
  );
}
