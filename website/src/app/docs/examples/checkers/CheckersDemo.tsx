'use client'

import { Fence } from '@/components/Fence'
import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CollapsibleSource } from '@/components/CollapsibleSource'

const EMBED_SNIPPET = `<script>
class DirectiveCheckers extends HTMLElement {
  connectedCallback() {
    fetch('/examples/checkers/index.html')
      .then(r => r.text())
      .then(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        // Inject scoped styles
        const style = document.createElement('style');
        const rawCss = doc.querySelector('style')?.textContent || '';
        style.textContent = rawCss
          .replace(/^(\\s*)\\*\\s*\\{/m, '$1directive-checkers, directive-checkers * {')
          .replace(/^(\\s*)body\\s*\\{/m, '$1directive-checkers {')
          .replace(/^(\\s*)h1\\s*\\{/m, '$1directive-checkers h1 {')
          .replace(/^(\\s*)button(\\s*[{:.])/gm, '$1directive-checkers button$2');
        document.head.appendChild(style);
        // Inject body content
        this.innerHTML = doc.body.innerHTML;
        // Load game JS
        const src = doc.querySelector('script[src]')?.getAttribute('src');
        if (src) {
          const s = document.createElement('script');
          s.type = 'module';
          s.src = src;
          document.head.appendChild(s);
        }
      });
  }
}
customElements.define('directive-checkers', DirectiveCheckers);
</script>

<directive-checkers></directive-checkers>`

export function CheckersDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const gameSource = sources.find((s) => s.filename === 'game.ts')
  const rulesSource = sources.find((s) => s.filename === 'rules.ts')

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
            Example not built yet. Run{' '}
            <code className="text-slate-300">pnpm build:example checkers</code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          2-player and vs Computer modes work in the embed. The vs Claude mode
          requires an API key and dev server proxy.
        </p>
      </section>

      {/* Embed snippet */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Embed it
        </h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Register the custom element, then use it like any HTML tag. No iframe
          &ndash; the game renders directly in your page.
        </p>
        <Fence language="html">{EMBED_SNIPPET}</Fence>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            The game is built as a{' '}
            <strong className="text-slate-900 dark:text-slate-200">
              multi-module Directive system
            </strong>{' '}
            with two modules: <code>game</code> (board logic) and{' '}
            <code>chat</code> (AI conversation). Pure game rules live in a
            separate <code>rules.ts</code> file with no Directive dependency.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Facts
              </strong>{' '}
              &ndash; Board state, current player, selection, game mode
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Derivations
              </strong>{' '}
              &ndash; Valid moves, highlight squares, score (auto-tracked, no
              manual deps)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Events
              </strong>{' '}
              &ndash; <code>clickSquare</code> sets selection and target
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Constraints
              </strong>{' '}
              &ndash; <code>executeMove</code> fires when a valid
              selection+target exists, <code>kingPiece</code> when on back row,{' '}
              <code>gameOver</code> when no moves remain
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Resolvers
              </strong>{' '}
              &ndash; Apply the move, handle multi-jump chains, switch turns
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">
                Effects
              </strong>{' '}
              &ndash; Log moves and game results
            </li>
          </ol>
        </div>
      </section>

      {/* Source code */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Source code
        </h2>
        <div className="space-y-3">
          {gameSource && (
            <CollapsibleSource
              title={`game.ts \u2013 Directive module (${gameSource.code.split('\n').length} lines)`}
              code={gameSource.code}
              language="typescript"
            />
          )}
          {rulesSource && (
            <CollapsibleSource
              title={`rules.ts \u2013 Pure game logic (${rulesSource.code.split('\n').length} lines)`}
              code={rulesSource.code}
              language="typescript"
            />
          )}
        </div>
      </section>
    </div>
  )
}
