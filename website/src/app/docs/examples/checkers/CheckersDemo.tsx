"use client";

import { CodeTabs } from "@/components/CodeTabs";
import { ExampleEmbed } from "@/components/ExampleEmbed";

export function CheckersDemo({
  build,
  sources,
}: {
  build: import("@/lib/examples").ExampleBuild | null;
  sources: import("@/lib/examples").ExampleSource[];
}) {
  const gameSource = sources.find((s) => s.filename === "game.ts");
  const mainSource = sources.find((s) => s.filename === "main.ts");
  const rulesSource = sources.find((s) => s.filename === "rules.ts");

  return (
    <div className="space-y-8">
      {/* Playable game */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Play it
        </h2>

        {build ? (
          <ExampleEmbed
            name="checkers"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-[#0f172a] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{" "}
            <code className="text-slate-300">pnpm build:example checkers</code>{" "}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          2-player and vs Computer modes work in the embed. The vs Claude mode
          requires an API key and dev server proxy.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            The game is built as a{" "}
            <strong className="text-slate-900 dark:text-slate-200">
              multi-module Directive system
            </strong>{" "}
            with two modules: <code>game</code> (board logic) and{" "}
            <code>chat</code> (AI conversation). Pure game rules live in a
            separate <code>rules.ts</code> file with no Directive dependency.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Facts
              </strong>{" "}
              &ndash; Board state, current player, selection, game mode
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{" "}
              &ndash; Valid moves, highlight squares, score (auto-tracked, no
              manual deps)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Events
              </strong>{" "}
              &ndash; <code>clickSquare</code> sets selection and target
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{" "}
              &ndash; <code>executeMove</code> fires when a valid
              selection+target exists, <code>kingPiece</code> when on back row,{" "}
              <code>gameOver</code> when no moves remain
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{" "}
              &ndash; Apply the move, handle multi-jump chains, switch turns
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Effects
              </strong>{" "}
              &ndash; Log moves and game results
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
            A two-player checkers game with optional AI opponent, multi-jump
            chains, king promotion, and move validation.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{" "}
            Built as a multi-module Directive system. The <code>game</code>{" "}
            module tracks board state, selection, and turns. Derivations compute
            valid moves and highlights. Constraints fire when a valid move is
            selected, a piece reaches the back row, or no moves remain. Pure
            game rules live in <code>rules.ts</code> with no Directive
            dependency.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{" "}
            Checkers has complex cascading logic (move &rarr; capture &rarr;
            multi-jump &rarr; king &rarr; game over). Directive&rsquo;s
            constraint priorities handle the cascade automatically &ndash; the{" "}
            <code>executeMove</code> constraint fires first, then{" "}
            <code>kingPiece</code>, then <code>gameOver</code>, each reacting to
            the state the previous one left behind.
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
            gameSource && {
              filename: "game.ts",
              label: "game.ts - Directive module",
              code: gameSource.code,
              language: "typescript",
            },
            mainSource && {
              filename: "main.ts",
              label: "main.ts - DOM wiring",
              code: mainSource.code,
              language: "typescript",
            },
            rulesSource && {
              filename: "rules.ts",
              label: "rules.ts - Pure game logic",
              code: rulesSource.code,
              language: "typescript",
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  );
}
