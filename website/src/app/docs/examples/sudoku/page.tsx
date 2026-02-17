import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { SudokuDemo } from './SudokuDemo'

export const metadata = buildPageMetadata({
  title: 'Sudoku',
  description:
    'Interactive Sudoku puzzle built with Directive. Constraint satisfaction maps 1:1 to the constraint-resolver flow.',
  path: '/docs/examples/sudoku',
  section: 'Docs',
})

export default function SudokuPage() {
  const build = parseExampleBuild('sudoku')
  const sources = readExampleSources('sudoku', [
    'sudoku.ts',
    'main.ts',
    'rules.ts',
    'generator.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Sudoku
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Constraint satisfaction, powered by Directive. The game rules ARE the
          constraints.
        </p>
      </header>

      <SudokuDemo build={build} sources={sources} />
    </div>
  )
}
