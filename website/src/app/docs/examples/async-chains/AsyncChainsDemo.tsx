"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { InlineInspector } from "@/components/InlineInspector";
import { StackBlitzOpen } from "@/components/StackBlitzOpen";
import type { ExampleProjectFiles } from "@/lib/examples";

export function AsyncChainsDemo({
  build,
  sources,
  projectFiles,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
  projectFiles: ExampleProjectFiles | null;
}) {
  const moduleSource = sources.find((s) => s.filename === "async-chains.ts");
  const mockApiSource = sources.find((s) => s.filename === "mock-api.ts");
  const mainSource = sources.find((s) => s.filename === "main.ts");

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <InlineInspector
            name="async-chains"
            systemName="async-chains"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example async-chains
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Start Chain&rdquo; to begin. Adjust failure rate sliders
          to see error propagation and retry behavior. Each step only runs after
          its predecessor succeeds.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Three modules form an async chain using <code>after</code> ordering:
            auth validates the session, permissions loads after auth succeeds,
            and dashboard loads after permissions.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                after ordering
              </strong>{" "}
              &ndash; <code>loadPermissions</code> uses{" "}
              <code>after: [&apos;auth::validateSession&apos;]</code> to block
              until auth&rsquo;s resolver settles; <code>loadDashboard</code>{" "}
              waits for permissions the same way
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                crossModuleDeps
              </strong>{" "}
              &ndash; each step reads facts from its predecessor to check
              success (<code>auth.isValid</code>, <code>permissions.role</code>)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Error propagation
              </strong>{" "}
              &ndash; if auth fails, permissions never evaluates (its{" "}
              <code>after</code> dependency is in rejected state), and dashboard
              is doubly blocked
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Retry
              </strong>{" "}
              &ndash; auth uses{" "}
              <code>
                retry: &#123; attempts: 2, backoff: &apos;exponential&apos;
                &#125;
              </code>
              . Restarting auth automatically resumes the chain from where it
              left off
            </li>
          </ol>
        </div>
      </section>

      {/* Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              What:
            </strong>{" "}
            A three-step async chain (auth &rarr; permissions &rarr; dashboard)
            with configurable failure rates, retry with exponential backoff, and
            visual chain status.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{" "}
            Each module&rsquo;s constraint uses <code>after</code> to depend on
            the previous step&rsquo;s constraint, plus{" "}
            <code>crossModuleDeps</code> to read success state. The logging and
            devtools plugins trace the full chain execution.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{" "}
            <code>after</code> provides hard ordering guarantees without manual
            promise chaining. Error propagation is automatic &ndash; downstream
            steps simply never evaluate when upstream fails. Retrying a single
            step resumes the entire chain.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        {projectFiles && (
          <div className="mb-3">
            <StackBlitzOpen title="Async Chains" projectFiles={projectFiles} />
          </div>
        )}
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: "async-chains.ts",
              label: "async-chains.ts - Directive modules",
              code: moduleSource.code,
              language: "typescript",
            },
            mockApiSource && {
              filename: "mock-api.ts",
              label: "mock-api.ts - Mock APIs",
              code: mockApiSource.code,
              language: "typescript",
            },
            mainSource && {
              filename: "main.ts",
              label: "main.ts - DOM wiring",
              code: mainSource.code,
              language: "typescript",
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  );
}
