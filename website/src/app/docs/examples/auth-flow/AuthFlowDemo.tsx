"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { InlineInspector } from "@/components/InlineInspector";
import { StackBlitzOpen } from "@/components/StackBlitzOpen";
import type { ExampleProjectFiles } from "@/lib/examples";

export function AuthFlowDemo({
  build,
  sources,
  projectFiles,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
  projectFiles: ExampleProjectFiles | null;
}) {
  const moduleSource = sources.find((s) => s.filename === "auth-flow.ts");
  const mockAuthSource = sources.find((s) => s.filename === "mock-auth.ts");
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
            name="auth-flow"
            systemName="auth-flow"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">pnpm build:example auth-flow</code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click &ldquo;Sign In&rdquo; to authenticate. Watch the token countdown
          and auto-refresh. Use &ldquo;Force Expire&rdquo; or adjust fail rates
          to explore error handling.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            An authentication flow with token refresh, constraint ordering, and
            session management &ndash; all driven by Directive&rsquo;s
            constraint&ndash;resolver pattern.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Facts
              </strong>{" "}
              &ndash; <code>token</code>, <code>refreshToken</code>,{" "}
              <code>expiresAt</code>, <code>user</code>, <code>status</code>,
              and a ticking <code>now</code> fact updated every 1s
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{" "}
              &ndash; <code>isExpiringSoon</code> auto-tracks <code>now</code>{" "}
              and <code>expiresAt</code>, driving the <code>refreshNeeded</code>{" "}
              constraint reactively
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{" "}
              &ndash; <code>refreshNeeded</code> (priority 90) fires when the
              token is expiring soon. <code>needsUser</code> (priority 80) uses{" "}
              <code>after: [&apos;refreshNeeded&apos;]</code> to ensure the user
              profile is fetched with a fresh token
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{" "}
              &ndash; <code>login</code> handles authentication,{" "}
              <code>refreshToken</code> retries with exponential backoff,{" "}
              <code>fetchUser</code> loads the user profile
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Effects
              </strong>{" "}
              &ndash; <code>logStatusChange</code> records status transitions to
              the event timeline for observability
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
            An authentication flow with login, automatic token refresh, user
            profile fetching, and logout &ndash; all with configurable failure
            rates and token lifetimes.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{" "}
            A ticking <code>now</code> fact drives <code>isExpiringSoon</code>,
            which triggers <code>refreshNeeded</code> automatically. The{" "}
            <code>after</code> ordering on <code>needsUser</code> ensures the
            user profile is always fetched with a valid token.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{" "}
            Auth flows are full of timing-dependent, ordered operations.
            Directive&rsquo;s constraint ordering (<code>after</code>) and
            auto-tracked derivations eliminate manual timers and race
            conditions.
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
            <StackBlitzOpen title="Auth Flow" projectFiles={projectFiles} />
          </div>
        )}
        <CodeTabs
          tabs={[
            moduleSource && {
              filename: "auth-flow.ts",
              label: "auth-flow.ts - Directive module",
              code: moduleSource.code,
              language: "typescript",
            },
            mockAuthSource && {
              filename: "mock-auth.ts",
              label: "mock-auth.ts - Mock auth API",
              code: mockAuthSource.code,
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
