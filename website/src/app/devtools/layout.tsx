import { buildPageMetadata } from '@/lib/metadata'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'

export const metadata = buildPageMetadata({
  title: 'DevTools Live Demo — Directive',
  description:
    'Watch Directive\'s AI agent lifecycle in real time. Send a message and see guardrails, constraints, token usage, and agent events stream live.',
  path: '/devtools',
})

export default function DevToolsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DevToolsWithProvider>{children}</DevToolsWithProvider>
}
