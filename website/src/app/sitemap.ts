import { MetadataRoute } from 'next'
import * as fs from 'fs'
import * as path from 'path'
import glob from 'fast-glob'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://directive.run'
  const pagesDir = path.resolve('./src/app')

  // Find all page.md files
  const files = glob.sync('**/page.md', { cwd: pagesDir })

  // Convert file paths to URLs
  const pages = files.map((file) => {
    // page.md at root becomes /
    if (file === 'page.md') return ''
    // Remove /page.md suffix to get path
    return '/' + file.replace(/\/page\.md$/, '')
  })

  // Filter out sitemap.xml and robots.txt paths if they exist
  const validPages = pages.filter(p => !p.includes('sitemap') && !p.includes('robots'))

  return validPages.map((pagePath) => {
    // Determine priority based on path
    let priority = 0.8
    if (pagePath === '') priority = 1
    else if (pagePath.includes('/quick-start')) priority = 0.9
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
}
