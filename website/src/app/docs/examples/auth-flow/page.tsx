import { buildPageMetadata } from '@/lib/metadata'
import { parseExampleBuild, readExampleSources } from '@/lib/examples'
import { AuthFlowDemo } from './AuthFlowDemo'

export const metadata = buildPageMetadata({
  title: 'Auth Flow',
  description:
    'Interactive authentication flow demo built with Directive. Login, token refresh with countdown, constraint ordering, and session management.',
  path: '/docs/examples/auth-flow',
  section: 'Docs',
})

export default function AuthFlowPage() {
  const build = parseExampleBuild('auth-flow')
  const sources = readExampleSources('auth-flow', [
    'auth-flow.ts',
    'mock-auth.ts',
    'main.ts',
  ])

  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">
          Examples
        </p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Auth Flow
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Login, token refresh with countdown, constraint ordering, and session
          management.
        </p>
      </header>

      <AuthFlowDemo build={build} sources={sources} />
    </div>
  )
}
