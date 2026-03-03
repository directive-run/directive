"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { ExampleEmbed } from "@/components/ExampleEmbed";

export function ErrorBoundariesDemo({
  build,
  sources,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
}) {
  const mainSource = sources.find((s) => s.filename === "main.ts");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="error-boundaries"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example error-boundaries
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Use the fail-rate sliders to inject errors. Watch circuit breakers
          open after 3 failures and auto-recover. Switch recovery strategies to
          see retry-later backoff in action.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Three simulated API services with configurable failure rates
            demonstrate Directive&rsquo;s error handling primitives.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Circuit Breakers
              </strong>{" "}
              &ndash; Each service has its own circuit breaker. After 3
              consecutive failures the circuit opens, blocking requests. After a
              recovery timeout it enters half-open to test recovery.
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Recovery Strategies
              </strong>{" "}
              &ndash; Choose between <code>skip</code> (swallow errors),{" "}
              <code>retry-later</code> (exponential backoff), or{" "}
              <code>throw</code> to see how the system responds.
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Performance Metrics
              </strong>{" "}
              &ndash; Average latency, error rates, and request counts update in
              real-time.
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            mainSource && {
              filename: "main.ts",
              label: "main.ts - System + DOM wiring",
              code: mainSource.code,
              language: "typescript",
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  );
}
