'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { Fence } from '@/components/Fence'

export function SudokuDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const sudokuSource = sources.find((s) => s.filename === 'sudoku.ts')
  const rulesSource = sources.find((s) => s.filename === 'rules.ts')
  const generatorSource = sources.find((s) => s.filename === 'generator.ts')

  return (
    <div className="space-y-8">
      {/* Playable game */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Play it
        </h2>

        {build ? (
          <ExampleEmbed
            name="sudoku"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700 bg-[#0f172a] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example sudoku
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Use arrow keys to navigate, 1&ndash;9 to input, Backspace to clear, N
          for notes, H for hint. Ctrl+Z / Ctrl+Shift+Z for undo/redo.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Sudoku is literally a{' '}
            <strong className="text-slate-900 dark:text-slate-200">
              constraint satisfaction problem
            </strong>
            : no duplicates in rows, columns, or 3&times;3 boxes. The game
            rules map 1:1 to Directive&rsquo;s constraint&ndash;resolver flow.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Facts
              </strong>{' '}
              &ndash; Grid state, solution, givens, timer, selection, notes,
              difficulty
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{' '}
              &ndash; Conflicts, progress, timer display, same-number
              highlighting, candidates (auto-tracked, no manual deps)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Events
              </strong>{' '}
              &ndash; <code>selectCell</code>, <code>inputNumber</code>,{' '}
              <code>toggleNote</code>, <code>requestHint</code>,{' '}
              <code>tick</code>, <code>newGame</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{' '}
              &ndash; <code>timerExpired</code> (priority 200),{' '}
              <code>detectConflict</code> (100), <code>puzzleSolved</code>{' '}
              (90), <code>hintAvailable</code> (70) &ndash; evaluated by
              priority after every fact change
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{' '}
              &ndash; Handle game won/lost, increment error count, reveal hints
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Effects
              </strong>{' '}
              &ndash; Timer warnings at 60s and 30s, game result logging
            </li>
          </ol>
          <p>
            The{' '}
            <strong className="text-slate-900 dark:text-slate-200">
              constraint cascade
            </strong>{' '}
            is the key insight: when a player types &ldquo;5&rdquo;, the grid
            fact updates, derivations recompute (conflicts, progress, isSolved),
            then constraints evaluate by priority &ndash; detecting conflicts,
            checking for a win, or firing a hint.
          </p>
        </div>
      </section>

      {/* Summary */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Summary
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-200">What:</strong>{' '}
            A fully playable Sudoku puzzle with multiple difficulties, notes,
            hints, undo/redo, and a countdown timer.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            The game is a single Directive module with 14 facts tracking
            grid/selection/timer state. Derivations auto-compute conflicts,
            progress, and candidates. Four prioritized constraints cascade on
            every input to detect conflicts, check for a win, expire the timer,
            or reveal hints. Resolvers handle the outcomes. Effects fire timer
            warnings.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">
              Why it works:
            </strong>{' '}
            Sudoku is a constraint satisfaction problem &ndash;
            Directive&rsquo;s constraint&ndash;resolver flow maps 1:1 to the
            game rules. No imperative state machine needed; declare what must be
            true and Directive handles the rest.
          </p>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <div className="space-y-6">
          {sudokuSource && (
            <Fence
              language="typescript"
              title={`sudoku.ts \u2013 Directive module (${sudokuSource.code.split('\n').length} lines)`}
            >
              {sudokuSource.code}
            </Fence>
          )}
          {rulesSource && (
            <Fence
              language="typescript"
              title={`rules.ts \u2013 Pure Sudoku logic (${rulesSource.code.split('\n').length} lines)`}
            >
              {rulesSource.code}
            </Fence>
          )}
          {generatorSource && (
            <Fence
              language="typescript"
              title={`generator.ts \u2013 Puzzle generation (${generatorSource.code.split('\n').length} lines)`}
            >
              {generatorSource.code}
            </Fence>
          )}
        </div>
      </section>
    </div>
  )
}
