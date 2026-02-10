import { type Metadata } from 'next'
import {
  Space_Grotesk,
  IBM_Plex_Sans,
  IBM_Plex_Mono,
  Manrope,
  JetBrains_Mono,
  Outfit,
  DM_Sans,
} from 'next/font/google'

import { BrandGuide } from '@/components/BrandGuide'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const ibmPlexSans = IBM_Plex_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
})

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Brand Guide',
  description: 'Brand identity options and color system for Directive',
}

const fontClasses = [
  spaceGrotesk.variable,
  ibmPlexSans.variable,
  ibmPlexMono.variable,
  manrope.variable,
  jetbrainsMono.variable,
  outfit.variable,
  dmSans.variable,
].join(' ')

export default function BrandGuidePage() {
  return (
    <div
      className={`min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16 ${fontClasses}`}
    >
      <header className="mb-9 space-y-1">
        <p className="font-display text-sm font-medium text-sky-500">Brand</p>
        <h1 className="font-display text-3xl tracking-tight text-slate-900 dark:text-white">
          Brand Guide
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Complete brand identity options for team review. Toggle dark/light
          previews per section.
        </p>
      </header>
      <BrandGuide />
    </div>
  )
}
