import { buildPageMetadata } from '@/lib/metadata'

export const metadata = buildPageMetadata({
  title: 'Contact — Directive',
  description:
    'Get in touch with the Directive team. Questions, bug reports, feature requests, or partnership inquiries.',
  path: '/contact',
})

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
