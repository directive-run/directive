"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { ExampleEmbed } from "@/components/ExampleEmbed";

export function TimeMachineDemo({
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
            name="time-machine"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">
              pnpm build:example time-machine
            </code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Draw on the canvas, then use Undo/Redo to navigate history. Export to
          save state as JSON, or use Changesets to group multiple strokes into a
          single undo step.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Each brush stroke is a fact mutation captured as a time-travel
            snapshot. Directive&rsquo;s built-in <code>TimeTravelManager</code>{" "}
            provides the full history API.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Undo / Redo
              </strong>{" "}
              &ndash; Navigate through snapshot history with{" "}
              <code>goBack()</code> and <code>goForward()</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Export / Import
              </strong>{" "}
              &ndash; Serialize all snapshots to JSON and restore them later
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Replay
              </strong>{" "}
              &ndash; Animate through the entire history to see strokes appear
              progressively
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Changesets
              </strong>{" "}
              &ndash; Group multiple mutations into a single atomic undo step
              using <code>beginChangeset()</code> / <code>endChangeset()</code>
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
