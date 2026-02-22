'use client'

import { ExampleEmbed } from '@/components/ExampleEmbed'
import { CodeTabs } from '@/components/CodeTabs'

export function PermissionsDemo({
  build,
  sources,
}: {
  build: import('@/lib/examples').ExampleBuild | null
  sources: import('@/lib/examples').ExampleSource[]
}) {
  const moduleSource = sources.find((s) => s.filename === 'permissions.ts')
  const mockApiSource = sources.find((s) => s.filename === 'mock-api.ts')
  const mainSource = sources.find((s) => s.filename === 'main.ts')

  return (
    <div className="space-y-8">
      {/* Try it */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          Try it
        </h2>

        {build ? (
          <ExampleEmbed
            name="permissions"
            css={build.css}
            html={build.html}
            scriptSrc={build.scriptSrc}
          />
        ) : (
          <div className="rounded-xl border border-slate-700/50 bg-[var(--brand-surface,#0f172a)] p-8 text-center text-sm text-slate-400">
            Example not built yet. Run{' '}
            <code className="text-slate-300">
              pnpm build:example permissions
            </code>{' '}
            to generate the embed.
          </div>
        )}

        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Switch between Alice (admin), Bob (editor), and Carol (viewer) to see
          how permissions change the UI. Action buttons appear or disappear
          based on role.
        </p>
      </section>

      {/* How it works */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
          How it works
        </h2>
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
          <p>
            Three modules compose into an RBAC system: auth owns the user
            session, permissions computes access from the role, and content
            gates actions on permission derivations.
          </p>
          <ol className="list-inside list-decimal space-y-2 pl-1">
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Facts</strong>{' '}
              &ndash; <code>role</code>, <code>permissions</code> (string
              array from API), <code>articles</code> (content list)
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Derivations</strong>{' '}
              &ndash; <code>canEdit</code>, <code>canPublish</code>,{' '}
              <code>canDelete</code>, <code>canManageUsers</code> computed
              from the permissions array; <code>isAdmin</code> composes{' '}
              <code>canManageUsers</code>
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">Constraints</strong>{' '}
              &ndash; <code>publishArticle</code> and{' '}
              <code>deleteArticle</code> check permission derivations via{' '}
              <code>crossModuleDeps</code> &ndash; the constraint never fires
              without the required permission
            </li>
            <li>
              <strong className="text-slate-900 dark:text-slate-200">UI gating</strong>{' '}
              &ndash; components read permission derivations to conditionally
              render buttons; the admin panel only appears for users with{' '}
              <code>canManageUsers</code>
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
            <strong className="text-slate-900 dark:text-slate-200">What:</strong>{' '}
            Role-based access control with three user roles, API-loaded
            permissions, conditional UI rendering, and constraint-gated
            actions.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">How:</strong>{' '}
            Permission derivations (<code>canEdit</code>,{' '}
            <code>canPublish</code>, etc.) compute access from the raw
            permissions array. Content module constraints read these
            derivations via <code>crossModuleDeps</code> to gate actions.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-slate-200">Why it works:</strong>{' '}
            Permissions are derived values, not scattered checks. Adding a
            new permission is one derivation and one cross-module dep.
            Constraints make unauthorized actions impossible at the runtime
            level, not just at the UI level.
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
            moduleSource && {
              filename: 'permissions.ts',
              label: 'permissions.ts - Directive modules',
              code: moduleSource.code,
              language: 'typescript',
            },
            mockApiSource && {
              filename: 'mock-api.ts',
              label: 'mock-api.ts - Mock APIs',
              code: mockApiSource.code,
              language: 'typescript',
            },
            mainSource && {
              filename: 'main.ts',
              label: 'main.ts - DOM wiring',
              code: mainSource.code,
              language: 'typescript',
            },
          ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
        />
      </section>
    </div>
  )
}
