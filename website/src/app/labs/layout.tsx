import { buildPageMetadata } from '@/lib/metadata'

export const metadata = buildPageMetadata({
  title: 'Labs — Directive',
  description:
    'Customize your experience, toggle A/B experiments, and watch the Directive constraint-driven runtime in action.',
  path: '/labs',
})

export default function LabsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
