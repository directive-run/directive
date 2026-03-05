"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { InlineInspector } from "@/components/InlineInspector";
import { StackBlitzOpen } from "@/components/StackBlitzOpen";
import type { ExampleProjectFiles } from "@/lib/examples";

export function DashboardLoaderDemo({
  build,
  sources,
  projectFiles,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
  projectFiles: ExampleProjectFiles | null;
}) {
  const moduleSource = sources.find(
    (s) => s.filename === "dashboard-loader.ts",
  );
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
            name="dashboard-loader"
            systemName="dashboard-loader"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example dashboard-loader
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Load&rdquo; to fetch all 3 resources. Adjust delay and
          failure rate sliders to see retry behavior and error states.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A dashboard needs profile, preferences, and permissions data before
            it can render. Each resource is fetched concurrently via
            Directive&rsquo;s constraint&ndash;resolver flow.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{" "}
              &ndash; <code>needsProfile</code> (priority 100),{" "}
              <code>needsPreferences</code> (90), <code>needsPermissions</code>{" "}
              (80) &ndash; fire concurrently when <code>userId</code> is set and
              the resource is idle
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{" "}
              &ndash; Each resolver fetches data with configurable delay and
              failure rate. Retry with exponential backoff handles transient
              failures automatically
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{" "}
              &ndash; <code>loadedCount</code>, <code>allLoaded</code>,{" "}
              <code>anyError</code>, <code>combinedStatus</code> &ndash;
              auto-tracked, no manual dependency lists
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Event Timeline
              </strong>{" "}
              &ndash; Every state change is logged so you can see the exact
              sequence of constraint evaluation, resolver execution, and retry
              attempts
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
            A dashboard data loader that concurrently fetches profile,
            preferences, and permissions with configurable mock delays and
            failure rates.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{" "}
            Three constraints fire when <code>userId</code> is set, each
            requiring a different fetch. Resolvers handle the async work with
            exponential backoff retry. Derivations automatically compute
            combined status without manual state juggling.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{" "}
            Loading states are a natural fit for constraints &ndash; each
            resource declares what it needs, and the runtime resolves them
            concurrently. No manual boolean flags, no race conditions, no
            flicker.
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
            <StackBlitzOpen title="Dashboard Loader" projectFiles={projectFiles} />
          </div>
        )}
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: "dashboard-loader.ts",
              label: "dashboard-loader.ts - Directive module",
              code: moduleSource.code,
              language: "typescript",
            },
            mockApiSource && {
              filename: "mock-api.ts",
              label: "mock-api.ts - Mock fetch logic",
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
