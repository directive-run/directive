import withMarkdoc from '@markdoc/next.js'

import withSearch from './src/markdoc/search.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'ts', 'tsx'],
  serverExternalPackages: ['ws'],

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || []
      config.externals.push('ws')
    }
    return config
  },

  async redirects() {
    return [
      {
        source: '/articles',
        destination: '/blog',
        permanent: true,
      },
      {
        source: '/articles/:slug',
        destination: '/blog/:slug',
        permanent: true,
      },
{
        source: '/docs/type-assertions',
        destination: '/docs/schema-overview',
        permanent: true,
      },
      {
        source: '/docs/type-builders',
        destination: '/docs/schema-overview',
        permanent: true,
      },
      {
        source: '/docs/zod-integration',
        destination: '/docs/schema-overview',
        permanent: true,
      },
      {
        source: '/docs/advanced/snapshots',
        destination: '/docs/advanced/time-travel',
        permanent: true,
      },
      {
        source: '/docs/ai/production-features',
        destination: '/docs/ai/resilience-routing',
        permanent: true,
      },
      {
        source: '/docs/how-to/overview',
        destination: '/docs/how-to/loading-states',
        permanent: false,
      },
      {
        source: '/docs/migration/overview',
        destination: '/docs/works-with/overview',
        permanent: true,
      },
    ]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            // unsafe-eval ONLY for local dev (Next.js HMR). Never on Vercel (VERCEL env is always set).
            value: process.env.NODE_ENV === 'development' && !process.env.VERCEL
              ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https: https://www.google-analytics.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com; connect-src 'self' https: ws: https://www.google-analytics.com https://analytics.google.com; frame-src 'self' https://stackblitz.com https://codesandbox.io;"
              : "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https: https://www.google-analytics.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com; connect-src 'self' https: https://www.google-analytics.com https://analytics.google.com; frame-src 'self' https://stackblitz.com https://codesandbox.io;",
          },
        ],
      },
    ]
  },
}

export default withSearch(
  withMarkdoc({ schemaPath: './src/markdoc' })(nextConfig),
)
