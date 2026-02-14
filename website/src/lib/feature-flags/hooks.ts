// @ts-nocheck
/**
 * Feature Flag React Hooks
 *
 * Thin wrappers around useDerived for each composite flag.
 */
import { useDerived } from '@directive-run/react'
import { getFeatureFlagSystem } from './config'

export function useCanUseChat() {
  return useDerived(getFeatureFlagSystem(), 'canUseChat')
}

export function useCanUseSearch() {
  return useDerived(getFeatureFlagSystem(), 'canUseSearch')
}

export function useCanUsePlayground() {
  return useDerived(getFeatureFlagSystem(), 'canUsePlayground')
}

export function useCanUseBrandSwitcher() {
  return useDerived(getFeatureFlagSystem(), 'canUseBrandSwitcher')
}

export function useCanUseThemeSelector() {
  return useDerived(getFeatureFlagSystem(), 'canUseThemeSelector')
}

export function useCanShowOnboardingToast() {
  return useDerived(getFeatureFlagSystem(), 'canShowOnboardingToast')
}

export function useCanUseVersionSelector() {
  return useDerived(getFeatureFlagSystem(), 'canUseVersionSelector')
}

export function useCanUseVoteApi() {
  return useDerived(getFeatureFlagSystem(), 'canUseVoteApi')
}
