import { DevToolsWithProvider } from '@/components/DevToolsWithProvider'

export default function ExamplesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <DevToolsWithProvider>{children}</DevToolsWithProvider>
}
