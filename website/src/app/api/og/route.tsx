import { ImageResponse } from 'next/og'
import { type NextRequest } from 'next/server'
import {
  findColorPreset,
  findTypoPreset,
  DEFAULT_COLOR_PRESET,
  DEFAULT_TYPO_PRESET,
  ALL_COLOR_IDS,
  ALL_TYPO_IDS,
} from '@/lib/brand-presets'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const colorId = searchParams.get('color') || 'default'
  const typoNum = parseInt(searchParams.get('typo') || '0', 10)

  if (!ALL_COLOR_IDS.includes(colorId)) {
    return new Response('Invalid color preset', { status: 400 })
  }
  if (!ALL_TYPO_IDS.includes(typoNum)) {
    return new Response('Invalid typo preset', { status: 400 })
  }

  const color = findColorPreset(colorId) || DEFAULT_COLOR_PRESET
  const typo = findTypoPreset(typoNum) || DEFAULT_TYPO_PRESET

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#0f172a',
          padding: 60,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', gap: 24, marginBottom: 40 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              backgroundColor: color.primary.hex,
            }}
          />
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              backgroundColor: color.accent.hex,
            }}
          />
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: '#ffffff',
            marginBottom: 16,
          }}
        >
          {color.name}
        </div>
        <div
          style={{
            fontSize: 28,
            color: '#94a3b8',
            marginBottom: 40,
          }}
        >
          {color.tagline}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 22,
            color: '#64748b',
          }}
        >
          <span>Typography: {typo.name}</span>
          <span style={{ color: '#334155' }}>|</span>
          <span>directive.run</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  )
}
