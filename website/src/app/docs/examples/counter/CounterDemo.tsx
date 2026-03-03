"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { ExampleEmbed } from "@/components/ExampleEmbed";

export function CounterDemo({
  build,
  sources,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
}) {
  const mainSource = sources.find((s) => s.filename === "main.ts");

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="counter"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">pnpm build:example counter</code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Click two numbers that add to 10 to remove them. The constraint chain
          automatically removes matched pairs, refills the grid from the pool,
          and detects game-over or win conditions.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            A single <code>number-match</code> module manages 36 numbered tiles
            (1&ndash;9, four of each). Nine are displayed on a grid at a time.
            Four constraints drive the entire game loop:
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                pairAddsTen
              </strong>{" "}
              &ndash; when two selected tiles sum to 10, emits{" "}
              <code>REMOVE_TILES</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                refillTable
              </strong>{" "}
              &ndash; when the grid has fewer than 9 tiles and the pool is
              non-empty, emits <code>REFILL_TABLE</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                noMovesLeft
              </strong>{" "}
              &ndash; when the pool is empty and no valid pairs remain, emits{" "}
              <code>END_GAME</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                allCleared
              </strong>{" "}
              &ndash; when all tiles are removed, emits <code>END_GAME</code>{" "}
              with a win message
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
            A Number Match game where you select pairs of tiles that sum to 10.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{" "}
            Four priority-ordered constraints chain together: match &rarr;
            remove &rarr; refill &rarr; end-game detection. Resolvers handle the
            multi-fact mutations.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{" "}
            The constraint chain settles automatically. Each resolver mutates
            multiple facts in a single batch, and the engine re-evaluates
            constraints until no more fire.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <CodeTabs
          tabs={[
            mainSource && {
              filename: "main.ts",
              label: "main.ts - Module + DOM wiring",
              code: mainSource.code,
              language: "typescript",
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  );
}
