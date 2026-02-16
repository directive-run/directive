import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'

export const runtime = 'edge'

const BRAND_PRIMARY = '#3b82f6'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const title = searchParams.get('title')
  const section = searchParams.get('section')

  if (!title) {
    return new Response('Missing required "title" parameter', { status: 400 })
  }

  const lexendData = await fetch(
    new URL('../../../fonts/lexend.woff2', import.meta.url),
  ).then((res) => res.arrayBuffer())

  const fontSize = title.length > 50 ? 48 : 56

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          position: 'relative',
        }}
      >
        {/* Left accent stripe */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            backgroundColor: BRAND_PRIMARY,
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '48px 64px',
          }}
        >
          {/* Top: wordmark */}
          <div
            style={{
              display: 'flex',
              fontSize: 16,
              fontWeight: 700,
              color: '#64748b',
              letterSpacing: '0.12em',
              textTransform: 'uppercase' as const,
              fontFamily: 'Lexend',
            }}
          >
            DIRECTIVE
          </div>

          {/* Middle: section label + title */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              maxWidth: 900,
            }}
          >
            {section && (
              <div
                style={{
                  display: 'flex',
                  fontSize: 14,
                  fontWeight: 600,
                  color: BRAND_PRIMARY,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const,
                  fontFamily: 'Lexend',
                }}
              >
                {section}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                fontSize,
                fontWeight: 700,
                color: '#ffffff',
                lineHeight: 1.2,
                fontFamily: 'Lexend',
              }}
            >
              {title}
            </div>
          </div>

          {/* Bottom: domain */}
          <div
            style={{
              display: 'flex',
              fontSize: 14,
              color: '#64748b',
              fontFamily: 'Lexend',
            }}
          >
            directive.run
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Lexend',
          data: lexendData,
          style: 'normal',
          weight: 700,
        },
      ],
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
  )
}
