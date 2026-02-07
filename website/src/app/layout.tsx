import { type Metadata } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import clsx from 'clsx'

import { Providers } from '@/app/providers'
import { Layout } from '@/components/Layout'
import { WebsiteJsonLd, SoftwareJsonLd } from '@/components/JsonLd'

import '@/styles/tailwind.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const lexend = localFont({
  src: '../fonts/lexend.woff2',
  display: 'swap',
  variable: '--font-lexend',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://directive.run'),
  title: {
    template: '%s | Directive',
    default: 'Directive - Constraint-Driven State Management for TypeScript',
  },
  description:
    'Directive is a constraint-driven runtime for TypeScript. Declare what must be true, define how to make it true, and let Directive orchestrate the rest. Built-in retry, timeout, time-travel debugging, and AI agent support.',
  keywords: [
    'TypeScript state management',
    'constraint-driven',
    'state machine',
    'reactive state',
    'declarative state',
    'Redux alternative',
    'Zustand alternative',
    'XState alternative',
    'React state management',
    'AI agent orchestration',
  ],
  authors: [{ name: 'Sizls' }],
  creator: 'Sizls',
  publisher: 'Sizls',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://directive.run',
    siteName: 'Directive',
    title: 'Directive - Constraint-Driven State Management for TypeScript',
    description:
      'Declare what must be true. Define how to make it true. Let Directive handle the rest.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Directive - State that resolves itself',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Directive - Constraint-Driven State Management',
    description:
      'Declare what must be true. Define how to make it true. Let Directive handle the rest.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  alternates: {
    canonical: 'https://directive.run',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={clsx('h-full antialiased', inter.variable, lexend.variable)}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <WebsiteJsonLd />
        <SoftwareJsonLd />
      </head>
      <body className="flex min-h-full bg-white dark:bg-slate-900">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  )
}
