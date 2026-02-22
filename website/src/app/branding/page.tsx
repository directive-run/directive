import { buildPageMetadata } from '@/lib/metadata'
import { BrandGuide } from '@/components/BrandGuide'

export const metadata = buildPageMetadata({
  title: 'Brand Guide',
  description: 'Brand identity options and color system for Directive',
  path: '/branding',
  section: 'Brand',
})

export default function BrandGuidePage() {
  return (
    <div className="min-w-0 max-w-2xl flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
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
