// Centralized localStorage key names and safe access helpers

export const STORAGE_KEYS = {
  COLOR: 'directive-brand-color',
  TYPO: 'directive-brand-typo',
  FIRST_VISIT: 'directive-brand-first-visit',
  ONBOARDED: 'directive-brand-onboarded',
  VOTED_PREFIX: 'directive-voted-month-',
} as const

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // localStorage may be full or unavailable (private browsing, etc.)
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {}
}

function getVotedMonthKey(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `${STORAGE_KEYS.VOTED_PREFIX}${yyyy}-${mm}`
}

export function hasVotedThisMonth(): boolean {
  return safeGetItem(getVotedMonthKey()) === '1'
}

export function markVotedThisMonth(): void {
  safeSetItem(getVotedMonthKey(), '1')
}
