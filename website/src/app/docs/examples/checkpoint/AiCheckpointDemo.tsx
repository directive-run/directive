"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { InlineInspector } from "@/components/InlineInspector";
import { StackBlitzOpen } from "@/components/StackBlitzOpen";
import type { ExampleProjectFiles } from "@/lib/examples";

export function AiCheckpointDemo({
  build,
  sources,
  projectFiles,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
  projectFiles: ExampleProjectFiles | null;
}) {
  const mainSource = sources.find((s) => s.filename === "main.ts");

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <InlineInspector
            name="ai-checkpoint"
            systemName="ai-checkpoint"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example ai-checkpoint
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Use &ldquo;Auto-Run All&rdquo; to process all 4 stages, or
          &ldquo;Advance Stage&rdquo; to step through manually. Save checkpoints
          and restore them after resetting.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A 4-stage document processing pipeline (extract, summarize,
            classify, archive) with full checkpoint support using{" "}
            <code>InMemoryCheckpointStore</code> from{" "}
            <code>@directive-run/ai</code>.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Checkpointing
              </strong>{" "}
              &ndash; Save pipeline state at any stage, restore it later to
              resume from that point
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Retry with Backoff
              </strong>{" "}
              &ndash; Failed stages retry with exponential backoff (500ms base,
              2x multiplier, configurable max retries)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Failure Injection
              </strong>{" "}
              &ndash; Force any stage to fail to observe retry behavior and
              pipeline halt after max retries exhausted
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Progress Tracking
              </strong>{" "}
              &ndash; Visual progress bar, per-stage token costs, and completion
              percentage derivation
            </li>
          </ol>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        {projectFiles && (
          <div className="mb-3">
            <StackBlitzOpen title="AI Checkpoint" projectFiles={projectFiles} />
          </div>
        )}
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
