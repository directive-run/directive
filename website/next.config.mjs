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
        source: '/ai/devtools-live',
        destination: '/ai/examples/ai-chat',
        permanent: true,
      },
      {
        source: '/devtools',
        destination: '/ai/examples/ai-chat',
        permanent: true,
      },
      {
        source: '/devtools-2',
        destination: '/ai/examples/ai-research-pipeline',
        permanent: true,
      },
      {
        source: '/docs',
        destination: '/docs/quick-start',
        permanent: false,
      },
      {
        source: '/ai',
        destination: '/ai/overview',
        permanent: false,
      },
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
        destination: '/ai/resilience-routing',
        permanent: true,
      },
      // AI section moved from /docs/ai/* to /ai/*
      {
        source: '/docs/ai/:slug*',
        destination: '/ai/:slug*',
        permanent: true,
      },
      // Security section moved from /docs/security/* to /ai/security/*
      {
        source: '/docs/security/:slug*',
        destination: '/ai/security/:slug*',
        permanent: true,
      },
      // AI-themed examples: canonical URL under /ai/examples, actual page under /docs/examples
      {
        source: '/ai/examples/ai-guardrails',
        destination: '/docs/examples/ai-guardrails',
        permanent: false,
      },
      {
        source: '/ai/examples/ai-checkpoint',
        destination: '/docs/examples/ai-checkpoint',
        permanent: false,
      },
      {
        source: '/ai/examples/fraud-analysis',
        destination: '/docs/examples/fraud-analysis',
        permanent: false,
      },
      {
        source: '/ai/examples/goal-heist',
        destination: '/docs/examples/goal-heist',
        permanent: false,
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
