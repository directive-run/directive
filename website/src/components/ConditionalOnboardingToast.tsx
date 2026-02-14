'use client'

import { useCanShowOnboardingToast } from '@/lib/feature-flags'
import { ThemeOnboardingToast } from '@/components/ThemeOnboardingToast'

export function ConditionalOnboardingToast() {
  const canShow = useCanShowOnboardingToast()

  if (!canShow) {
    return null
  }

  return <ThemeOnboardingToast />
}
