// @ts-nocheck
/**
 * Notification React Hooks
 *
 * Thin wrappers around useDerived and useEvents.
 */
import { useDerived, useEvents } from '@directive-run/react'
import { getNotificationSystem } from './config'

export function useVisibleNotifications() {
  return useDerived(getNotificationSystem(), 'visibleNotifications')
}

export function useHasNotifications() {
  return useDerived(getNotificationSystem(), 'hasVisible')
}

export function useNotificationEvents() {
  return useEvents(getNotificationSystem())
}
