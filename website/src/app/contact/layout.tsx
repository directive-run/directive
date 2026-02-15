import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact — Directive',
  description:
    'Get in touch with the Directive team. Questions, bug reports, feature requests, or partnership inquiries.',
}

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
