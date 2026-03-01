import { MetadataRoute } from 'next'
import * as path from 'path'
import glob from 'fast-glob'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://directive.run'
  const pagesDir = path.resolve('./src/app')

  // Find all page files (md and tsx)
  const files = glob.sync('**/page.{md,tsx}', { cwd: pagesDir })

  // Convert file paths to URLs
  const pages = files.map((file) => {
    // page.md or page.tsx at root becomes /
    if (file === 'page.md' || file === 'page.tsx') return ''
    // Remove /page.{md,tsx} suffix to get path
    return '/' + file.replace(/\/page\.(md|tsx)$/, '')
  })

  // Filter out sitemap.xml, robots.txt, catch-all routes, and API routes
  const validPages = pages.filter(p =>
    !p.includes('sitemap') &&
    !p.includes('robots') &&
    !p.includes('[[') &&
    !p.includes('/api/')
  )

  const entries: MetadataRoute.Sitemap = validPages.map((pagePath) => {
    // Determine priority based on path
    let priority = 0.8
    if (pagePath === '') priority = 1
    else if (pagePath.includes('/quick-start')) priority = 0.9
    else if (pagePath.includes('/blog/')) priority = 0.7
    else if (pagePath.includes('/docs/') && !pagePath.includes('/docs/advanced/')) priority = 0.85

    // Determine change frequency
    let changeFrequency: 'weekly' | 'monthly' = 'monthly'
    if (pagePath === '') changeFrequency = 'weekly'

    return {
      url: `${baseUrl}${pagePath}`,
      lastModified: new Date(),
      changeFrequency,
      priority,
    }
  })

  // TSX pages aren't auto-discovered by the .md glob
  const tsxPages = [
    { path: '/blog', priority: 0.8, changeFrequency: 'weekly' as const },
    { path: '/about', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/support', priority: 0.6, changeFrequency: 'monthly' as const },
    { path: '/ai/examples/chat', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/ai/examples/research-pipeline', priority: 0.7, changeFrequency: 'monthly' as const },
    { path: '/branding', priority: 0.5, changeFrequency: 'monthly' as const },
  ]

  for (const page of tsxPages) {
    entries.push({
      url: `${baseUrl}${page.path}`,
      lastModified: new Date(),
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })
  }

  return entries
}
