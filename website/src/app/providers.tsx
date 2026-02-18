'use client'

import { ThemeProvider } from 'next-themes'

import { ExperimentsProvider } from '@/lib/useExperiment'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="directive-theme" disableTransitionOnChange>
      <ExperimentsProvider>
        {children}
      </ExperimentsProvider>
    </ThemeProvider>
  )
}
