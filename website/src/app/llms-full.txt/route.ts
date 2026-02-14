import * as fs from 'fs'
import * as path from 'path'
import glob from 'fast-glob'

import { navigation } from '@/lib/navigation'

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const data: Record<string, string> = {}
  if (!raw.startsWith('---')) {
    return { data, content: raw }
  }

  const end = raw.indexOf('---', 3)
  if (end === -1) {
    return { data, content: raw }
  }

  const frontmatter = raw.slice(3, end).trim()
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      data[key] = value
    }
  }

  const content = raw.slice(end + 3).trim()

  return { data, content }
}

export function GET() {
  const pagesDir = path.resolve('./src/app')
  const files = glob.sync('**/page.md', { cwd: pagesDir })

  const lines: string[] = [
    '# Directive – Full Documentation',
    '',
    '> Constraint-driven state management for TypeScript',
    '',
    'This document contains the complete documentation for Directive, suitable for AI ingestion.',
    '',
  ]

  // Build a map of href → file path for ordered output
  const hrefToFile = new Map<string, string>()
  for (const file of files) {
    const href = file === 'page.md' ? '/' : '/' + file.replace(/\/page\.md$/, '')
    hrefToFile.set(href, path.join(pagesDir, file))
  }

  // Output docs in navigation order
  for (const section of navigation) {
    lines.push(`## ${section.title}`)
    lines.push('')

    for (const link of section.links) {
      const filePath = hrefToFile.get(link.href)
      if (!filePath || !fs.existsSync(filePath)) {
        continue
      }

      const raw = fs.readFileSync(filePath, 'utf-8')
      const { content, data } = parseFrontmatter(raw)
      const title = data.title || link.title

      lines.push(`### ${title}`)
      if (data.description) {
        lines.push('')
        lines.push(`> ${data.description}`)
      }
      lines.push('')
      lines.push(content.trim())
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  // Append blog posts
  const blogFiles = glob.sync('blog/*/page.md', { cwd: pagesDir })
  if (blogFiles.length > 0) {
    lines.push('## Blog Posts')
    lines.push('')

    for (const file of blogFiles) {
      const filePath = path.join(pagesDir, file)
      const raw = fs.readFileSync(filePath, 'utf-8')
      const { content, data } = parseFrontmatter(raw)

      lines.push(`### ${data.title || file}`)
      if (data.date) {
        lines.push(`*Published: ${data.date}*`)
      }
      if (data.description) {
        lines.push('')
        lines.push(`> ${data.description}`)
      }
      lines.push('')
      lines.push(content.trim())
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
