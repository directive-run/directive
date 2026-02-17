'use client'

import { ThemeProvider } from 'next-themes'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" storageKey="directive-theme" disableTransitionOnChange>
      {children}
    </ThemeProvider>
  )
}
