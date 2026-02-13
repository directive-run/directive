// Social sharing utilities for theme voting
// All URLs use whitelisted preset IDs — no user input in URL construction

import { findColorPreset, findTypoPreset } from './brand-presets'

const SITE_URL = 'https://directive.run'
const HASHTAG = 'DirectiveTheme'
const HANDLE = '@directive_run'

interface ShareContext {
  colorId: string
  typoId: number
}

interface ShareContent {
  text: string
  url: string
}

function getPresetLabels(ctx: ShareContext) {
  const color = findColorPreset(ctx.colorId)
  const typo = findTypoPreset(ctx.typoId)
  return {
    colorName: color?.name ?? 'Blueprint',
    typoName: typo?.name ?? 'Foundation',
    primaryColor: color?.primary.name ?? 'Sky',
    accentColor: color?.accent.name ?? 'Indigo',
    tagline: color?.tagline ?? 'Where it all started',
  }
}

const VARIANTS = [
  (labels: ReturnType<typeof getPresetLabels>) =>
    `I'm voting for ${labels.colorName} as the default ${HANDLE} theme. ${labels.tagline} #${HASHTAG}`,
  (labels: ReturnType<typeof getPresetLabels>) =>
    `Just configured my ${HANDLE} docs — ${labels.colorName} (${labels.primaryColor} + ${labels.accentColor}). This should be the default. #${HASHTAG}`,
  (labels: ReturnType<typeof getPresetLabels>) =>
    `Team ${labels.colorName} checking in. ${HANDLE} should ship this look. #${HASHTAG}`,
  (labels: ReturnType<typeof getPresetLabels>) =>
    `My ${HANDLE} theme: ${labels.colorName} + ${labels.typoName}. Cast yours at directive.run #${HASHTAG}`,
]

function getRandomVariant(ctx: ShareContext): string {
  const labels = getPresetLabels(ctx)
  const variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)]
  return variant(labels)
}

export function buildTwitterUrl(ctx: ShareContext): string {
  const text = getRandomVariant(ctx)
  const params = new URLSearchParams({
    text,
    url: SITE_URL,
    hashtags: HASHTAG,
  })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}

export function buildBlueskyUrl(ctx: ShareContext): string {
  const text = `${getRandomVariant(ctx)} ${SITE_URL}`
  const params = new URLSearchParams({ text })
  return `https://bsky.app/intent/compose?${params.toString()}`
}

export function buildClipboardText(ctx: ShareContext): string {
  return `${getRandomVariant(ctx)} ${SITE_URL}`
}

export function getShareContent(ctx: ShareContext): ShareContent {
  return {
    text: getRandomVariant(ctx),
    url: SITE_URL,
  }
}

export async function castVote(ctx: ShareContext): Promise<void> {
  try {
    await fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color: ctx.colorId, typo: ctx.typoId }),
    })
  } catch {
    // Fire-and-forget -- don't block sharing
  }
}
