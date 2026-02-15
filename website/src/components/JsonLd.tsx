export function WebsiteJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Directive',
    description:
      'Constraint-driven state management for TypeScript. Declare what must be true, define how to make it true, let Directive orchestrate the rest.',
    url: 'https://directive.run',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://directive.run/docs?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export function SoftwareJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Directive',
    description:
      'Constraint-driven state management for TypeScript. Declare what must be true, define how to make it true, let Directive orchestrate the rest.',
    codeRepository: 'https://github.com/directive-run/directive',
    programmingLanguage: {
      '@type': 'ComputerLanguage',
      name: 'TypeScript',
    },
    runtimePlatform: 'Node.js',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Organization',
      name: 'Sizls',
      url: 'https://sizls.com',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export function ArticleJsonLd({
  title,
  description,
  url,
  datePublished,
  dateModified,
}: {
  title: string
  description: string
  url: string
  datePublished?: string | Date
  dateModified?: string | Date
}) {
  const published = datePublished instanceof Date ? datePublished.toISOString() : datePublished
  const modified = dateModified instanceof Date ? dateModified.toISOString() : dateModified

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description: description,
    url: url,
    datePublished: published || new Date().toISOString(),
    dateModified: modified || new Date().toISOString(),
    author: {
      '@type': 'Organization',
      name: 'Sizls',
      url: 'https://sizls.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Directive',
      url: 'https://directive.run',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export function DocumentationJsonLd({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description: description,
    url: url,
    author: {
      '@type': 'Organization',
      name: 'Sizls',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Directive',
      url: 'https://directive.run',
    },
    about: {
      '@type': 'SoftwareApplication',
      name: 'Directive',
      applicationCategory: 'DeveloperApplication',
    },
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[]
}) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
