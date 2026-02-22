import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { PermissionsDemo } from './PermissionsDemo'

export const metadata = buildPageMetadata({
  title: 'Permissions',
  description:
    'Interactive role-based permissions demo built with Directive. RBAC with derivation composition, cross-module constraints, and dynamic feature gating.',
  path: '/docs/examples/permissions',
  section: 'Docs',
})

export default function PermissionsPage() {
  const build = parseExampleBuild('permissions')
  const sources = readExampleSources('permissions', [
    'permissions.ts',
    'mock-api.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Permissions
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Role-based access control with permission derivations, cross-module
          gating, and conditional UI rendering.
        </p>
      </header>

      <PermissionsDemo build={build} sources={sources} />
    </div>
  )
}
