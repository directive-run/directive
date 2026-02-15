// Social sharing utilities for page-level sharing

export interface ShareContent {
  title: string
  url: string
  description?: string
}

const SHARE_PHRASES = [
  'This is lowkey fire.',
  'No cap, this slaps.',
  'Main character energy right here.',
  'Ate and left no crumbs.',
  'Living rent free in my head now.',
  'Okay this goes stupid hard.',
  'Certified banger alert.',
  'Sheeeesh.',
  'Cooked. In a good way.',
  'It\'s giving "I know what I\'m doing."',
  'Understood the assignment.',
  'This hits different.',
  'Not me sharing state management content at 2am.',
  'POV: you found the good stuff.',
  'Tell me why this is so clean.',
  'Bruh. Just read it.',
  'I\'m not a runtime, but I resolve things too.',
  'Constraints? Declared. Requirements? Resolved. Hotel? Trivago.',
  'It\'s the declarative state for me.',
  'Drop what you\'re doing and peep this.',
  'Bussin\' respectfully.',
  'Big brain energy.',
  'Slay (derogatory) (affectionate) (technical).',
  'Core memory unlocked.',
  'This just works and I\'m suspicious.',
  'Ngl this might be peak.',
  'Runtime said "I got you fam."',
  'State management, but make it fashion.',
  'Hold my beer, I\'m declaring constraints.',
  'I showed this to my rubber duck and it nodded.',
]

export function getRandomSharePhrase(): string {
  return SHARE_PHRASES[Math.floor(Math.random() * SHARE_PHRASES.length)]
}

function addUtmParams(url: string, platform: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('utm_source', platform)
  parsed.searchParams.set('utm_medium', 'share')

  return parsed.toString()
}

export function buildTwitterUrl(content: ShareContent): string {
  const url = addUtmParams(content.url, 'twitter')
  const params = new URLSearchParams({
    text: content.title,
    url,
  })

  return `https://twitter.com/intent/tweet?${params.toString()}`
}

export function buildBlueskyUrl(content: ShareContent): string {
  const url = addUtmParams(content.url, 'bluesky')
  const text = `${content.title} ${url}`
  const params = new URLSearchParams({ text })

  return `https://bsky.app/intent/compose?${params.toString()}`
}

export function buildLinkedInUrl(content: ShareContent): string {
  const url = addUtmParams(content.url, 'linkedin')
  const params = new URLSearchParams({ url })

  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`
}

export function buildClipboardText(content: ShareContent): string {
  return `${content.title} ${addUtmParams(content.url, 'clipboard')}`
}

export async function nativeShare(content: ShareContent): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return false
  }

  try {
    await navigator.share({
      title: content.title,
      url: addUtmParams(content.url, 'native'),
    })

    return true
  } catch {
    return false
  }
}
