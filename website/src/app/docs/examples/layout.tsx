'use client'

import { usePathname } from 'next/navigation'
import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'

// Examples that import from @directive-run/ai
const AI_EXAMPLES = new Set([
  'ai-checkpoint',
  'ai-guardrails',
  'checkers',
  'fraud-analysis',
  'goal-heist',
])

export default function ExamplesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const slug = pathname?.split('/').pop() || ''
  const mode = AI_EXAMPLES.has(slug) ? 'ai' : 'system'

  return (
    <DevToolsWithProvider key={slug} mode={mode}>
      {children}
    </DevToolsWithProvider>
  )
}
