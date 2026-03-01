import { NextRequest } from 'next/server'
import { isAllowedOrigin, forbiddenResponse } from '@/lib/origin-check'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: NextRequest) {
  if (!isAllowedOrigin(request)) {
    return forbiddenResponse(request)
  }

  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''

  if (!email || !EMAIL_REGEX.test(email)) {
    return Response.json(
      { error: 'Please provide a valid email address.' },
      { status: 400 },
    )
  }

  const apiKey = process.env.BUTTONDOWN_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: 'Newsletter service is not configured.' },
      { status: 503 },
    )
  }

  try {
    const res = await fetch('https://api.buttondown.com/v1/subscribers', {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email_address: email }),
    })

    if (res.status === 201) {
      return Response.json({ success: true })
    }

    // Buttondown returns 400 if already subscribed
    if (res.status === 400) {
      return Response.json({ success: true })
    }

    const data = await res.json().catch(() => ({}))

    return Response.json(
      { error: (data as Record<string, unknown>).detail || 'Subscription failed. Try again.' },
      { status: res.status },
    )
  } catch {
    return Response.json(
      { error: 'Could not reach the newsletter service. Try again.' },
      { status: 502 },
    )
  }
}
