// @ts-nocheck
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Megaphone,
  Info,
  CheckCircle,
  Warning,
  XCircle,
} from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { NotificationDef } from '@/lib/notifications'
import {
  useVisibleNotifications,
  useNotificationEvents,
} from '@/lib/notifications'

// ---------------------------------------------------------------------------
// Icon lookup
// ---------------------------------------------------------------------------

const ICONS: Record<NotificationDef['icon'], Icon> = {
  megaphone: Megaphone,
  info: Info,
  'check-circle': CheckCircle,
  warning: Warning,
}

// ---------------------------------------------------------------------------
// Color styles per notification type
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<
  NotificationDef['type'],
  { bg: string; border: string; text: string; icon: string; link: string; dismiss: string }
> = {
  warning: {
    bg: 'bg-lime-200 dark:bg-lime-300',
    border: 'border-lime-400 dark:border-lime-500',
    text: 'text-lime-950 dark:text-lime-950',
    icon: 'text-lime-700 dark:text-lime-800',
    link: 'text-lime-950 underline decoration-lime-600/60 hover:decoration-lime-950 dark:text-lime-950 dark:decoration-lime-700/60 dark:hover:decoration-lime-950',
    dismiss: 'text-lime-700 hover:text-lime-950 dark:text-lime-800 dark:hover:text-lime-950',
  },
  info: {
    bg: 'bg-sky-200 dark:bg-sky-300',
    border: 'border-sky-400 dark:border-sky-500',
    text: 'text-sky-950 dark:text-sky-950',
    icon: 'text-sky-700 dark:text-sky-800',
    link: 'text-sky-950 underline decoration-sky-600/60 hover:decoration-sky-950 dark:text-sky-950 dark:decoration-sky-700/60 dark:hover:decoration-sky-950',
    dismiss: 'text-sky-700 hover:text-sky-950 dark:text-sky-800 dark:hover:text-sky-950',
  },
  success: {
    bg: 'bg-emerald-200 dark:bg-emerald-300',
    border: 'border-emerald-400 dark:border-emerald-500',
    text: 'text-emerald-950 dark:text-emerald-950',
    icon: 'text-emerald-700 dark:text-emerald-800',
    link: 'text-emerald-950 underline decoration-emerald-600/60 hover:decoration-emerald-950 dark:text-emerald-950 dark:decoration-emerald-700/60 dark:hover:decoration-emerald-950',
    dismiss: 'text-emerald-700 hover:text-emerald-950 dark:text-emerald-800 dark:hover:text-emerald-950',
  },
  error: {
    bg: 'bg-red-200 dark:bg-red-300',
    border: 'border-red-400 dark:border-red-500',
    text: 'text-red-950 dark:text-red-950',
    icon: 'text-red-700 dark:text-red-800',
    link: 'text-red-950 underline decoration-red-600/60 hover:decoration-red-950 dark:text-red-950 dark:decoration-red-700/60 dark:hover:decoration-red-950',
    dismiss: 'text-red-700 hover:text-red-950 dark:text-red-800 dark:hover:text-red-950',
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationBanners() {
  const notifications = useVisibleNotifications()
  const events = useNotificationEvents()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    setMounted(true)

    const delay = reducedMotion.current ? 0 : 1500
    const timer = setTimeout(() => setVisible(true), delay)

    return () => clearTimeout(timer)
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      if (exitingIds.has(id)) {
        return
      }

      setExitingIds((prev) => new Set(prev).add(id))

      const delay = reducedMotion.current ? 0 : 400
      setTimeout(() => {
        events.dismiss({ id })
        setExitingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)

          return next
        })
      }, delay)
    },
    [events, exitingIds],
  )

  // Server and first client render: empty container (no hydration mismatch)
  // After mount: banners appear instantly (no transition on enter)
  if (!mounted || !visible || !notifications || notifications.length === 0) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center px-4 pb-4 sm:px-6"
    >
      {notifications.map((notification: NotificationDef, index: number) => {
        const IconComponent = ICONS[notification.icon]
        const styles = TYPE_STYLES[notification.type]
        const isExiting = exitingIds.has(notification.id)
        const staggerDelay = reducedMotion.current ? undefined : { animationDelay: `${index * 150}ms` }

        return (
          <div
            key={notification.id}
            style={isExiting ? undefined : staggerDelay}
            className={`pointer-events-auto mt-2.5 first:mt-0 w-full max-w-4xl overflow-hidden rounded-xl border shadow-lg ${styles.bg} ${styles.border} ${
              isExiting
                ? reducedMotion.current
                  ? 'hidden'
                  : 'animate-fade-out-down'
                : reducedMotion.current
                  ? ''
                  : 'animate-fade-in-up'
            }`}
          >
            <div className="flex items-center gap-3 px-4 py-3 text-sm">
              <IconComponent
                weight="duotone"
                className={`h-7 w-7 flex-none ${styles.icon}`}
              />
              <p className={`flex-1 ${styles.text}`}>
                {notification.message}
                {notification.linkText && notification.linkHref && (
                  <>
                    {' '}
                    <Link
                      href={notification.linkHref}
                      className={`font-medium ${styles.link}`}
                    >
                      {notification.linkText}
                    </Link>
                  </>
                )}
              </p>
              {notification.dismissable && (
                <button
                  onClick={() => dismiss(notification.id)}
                  className={`flex-none cursor-pointer ${styles.dismiss}`}
                  aria-label="Dismiss notification"
                >
                  <XCircle weight="bold" className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
