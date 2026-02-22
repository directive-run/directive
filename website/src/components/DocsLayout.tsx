import { type Node } from '@markdoc/markdoc'
import { headers } from 'next/headers'

import { DocsEndNudge } from '@/components/DocsEndNudge'
import { DocsHeader } from '@/components/DocsHeader'
import { PrevNextLinks } from '@/components/PrevNextLinks'
import { Prose } from '@/components/Prose'
import { TableOfContents } from '@/components/TableOfContents'
import { VersionBanner } from '@/components/VersionSelector'
import { DocumentationJsonLd, BreadcrumbJsonLd } from '@/components/JsonLd'
import { calculateReadingTime, formatReadingTime } from '@/lib/readingTime'
import { collectSections } from '@/lib/sections'
import { docsNavigation, aiNavigation, getSiteSection } from '@/lib/navigation'
import {
  getVersionFromPath,
  LATEST_VERSION,
} from '@/lib/versions'

function buildBreadcrumbs(pathname: string, version: ReturnType<typeof getVersionFromPath>): { name: string; url: string }[] {
  const base = 'https://directive.run'
  const isAIPage = getSiteSection(pathname) === 'ai'
  const items: { name: string; url: string }[] = [
    { name: 'Home', url: base },
    { name: isAIPage ? 'AI' : 'Docs', url: isAIPage ? `${base}/ai` : `${base}/docs` },
  ]

  // For versioned doc paths, strip the version prefix to match against canonical navigation
  // AI pages are never versioned, so lookupPath === pathname for them
  const lookupPath = !isAIPage && version.pathPrefix
    ? pathname.replace(`/docs${version.pathPrefix}`, '/docs')
    : pathname

  const scopedNav = isAIPage ? aiNavigation : docsNavigation
  for (const section of scopedNav) {
    for (const link of section.links) {
      if (link.href === lookupPath) {
        items.push({ name: section.title, url: `${base}${section.links[0].href}` })
        items.push({ name: link.title, url: `${base}${pathname}` })

        return items
      }
    }
  }

  return items
}

export async function DocsLayout({
  children,
  frontmatter: { title, description },
  nodes,
}: {
  children: React.ReactNode
  frontmatter: { title?: string; description?: string }
  nodes: Array<Node>
}) {
  let tableOfContents = collectSections(nodes)
  let readingTime = formatReadingTime(calculateReadingTime(nodes))

  const headersList = await headers()
  const pathname = headersList.get('x-pathname') || ''
  const version = getVersionFromPath(pathname)
  const isAIPage = getSiteSection(pathname) === 'ai'

  // Frozen versions: canonical points to the latest equivalent, noindex applied
  const isLatest = version.status === 'latest'
  const canonicalPath = version.pathPrefix
    ? pathname.replace(`/docs${version.pathPrefix}`, '/docs')
    : pathname
  const canonicalUrl = `https://directive.run${canonicalPath}`

  const breadcrumbs = buildBreadcrumbs(pathname, version)
  const ogSection = isAIPage ? 'AI' : 'Docs'

  return (
    <>
      {title && <title>{`${title} | Directive`}</title>}
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={canonicalUrl} />
      {!isLatest && <meta name="robots" content="noindex" />}
      {title && pathname !== '/' && pathname !== '' && (
        <>
          <meta property="og:title" content={`${title} | Directive`} />
          {description && <meta property="og:description" content={description} />}
          <meta property="og:url" content={canonicalUrl} />
          <meta property="og:type" content="article" />
          <meta property="og:site_name" content="Directive" />
          <meta property="og:image" content={`https://directive.run/api/og?title=${encodeURIComponent(title)}&section=${ogSection}`} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={`${title} | Directive`} />
          {description && <meta name="twitter:description" content={description} />}
          <meta name="twitter:image" content={`https://directive.run/api/og?title=${encodeURIComponent(title)}&section=${ogSection}`} />
        </>
      )}
      {title && description && (
        <DocumentationJsonLd
          title={title}
          description={description}
          url={canonicalUrl}
        />
      )}
      {breadcrumbs.length > 2 && <BreadcrumbJsonLd items={breadcrumbs} />}
      <div className="max-w-2xl min-w-0 flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
        {!isLatest && !isAIPage && <VersionBanner version={version} />}
        <article>
          <DocsHeader title={title} readingTime={readingTime} />
          <Prose>{children}</Prose>
        </article>
        <DocsEndNudge />
        <PrevNextLinks />
      </div>
      <TableOfContents tableOfContents={tableOfContents} />
    </>
  )
}
