'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { HandFist, LinkSimple } from '@phosphor-icons/react'

import { IconButton } from '@/components/IconButton'
import {
  buildTwitterUrl,
  buildBlueskyUrl,
  buildLinkedInUrl,
  buildClipboardText,
  nativeShare,
  getRandomSharePhrase,
  type ShareContent,
} from '@/lib/share'

function getShareContent(): ShareContent {
  return {
    title: `${getRandomSharePhrase()} ${document.title}`,
    url: window.location.href.split('?')[0].split('#')[0],
  }
}

export function ShareButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasNativeShare, setHasNativeShare] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setHasNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)

    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleNativeShare = useCallback(async () => {
    await nativeShare(getShareContent())
    setIsOpen(false)
  }, [])

  const handleTwitter = useCallback(() => {
    window.open(buildTwitterUrl(getShareContent()), '_blank', 'noopener,noreferrer')
    setIsOpen(false)
  }, [])

  const handleBluesky = useCallback(() => {
    window.open(buildBlueskyUrl(getShareContent()), '_blank', 'noopener,noreferrer')
    setIsOpen(false)
  }, [])

  const handleLinkedIn = useCallback(() => {
    window.open(buildLinkedInUrl(getShareContent()), '_blank', 'noopener,noreferrer')
    setIsOpen(false)
  }, [])

  const handleCopy = useCallback(async () => {
    const text = buildClipboardText(getShareContent())
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [])

  return (
    <div className="relative" ref={panelRef}>
      <IconButton
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        active={isOpen}
        aria-label="Share this page"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <HandFist className="h-6 w-6 sm:h-5 sm:w-5" weight="duotone" />
      </IconButton>

      {isOpen && (
        <div
          className="absolute top-full right-0 mt-3 w-48 rounded-xl bg-white p-2 shadow-md ring-1 shadow-black/5 ring-black/5 dark:bg-brand-surface-raised dark:ring-white/5"
          role="menu"
        >
          <button
            onClick={handleTwitter}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            role="menuitem"
          >
            <svg className="h-4 w-4 flex-none text-black dark:text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Twitter / X
          </button>
          <button
            onClick={handleBluesky}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            role="menuitem"
          >
            <svg className="h-4 w-4 flex-none text-[#0085ff]" viewBox="0 0 600 530" fill="currentColor">
              <path d="m135.72 44.03c66.496 49.921 138.02 151.14 164.28 205.46 26.262-54.316 97.782-155.54 164.28-205.46 47.98-36.021 125.72-63.892 125.72 24.795 0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.3797-3.6904-10.832-3.7077-7.8964-0.0174-2.9357-1.1937 0.51669-3.7077 7.8964-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.4491-163.25-81.433-5.9562-21.282-16.111-152.36-16.111-170.07 0-88.687 77.742-60.816 125.72-24.795z" />
            </svg>
            Bluesky
          </button>
          <button
            onClick={handleLinkedIn}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            role="menuitem"
          >
            <svg className="h-4 w-4 flex-none text-[#0A66C2]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            LinkedIn
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-700" role="separator" />
          {hasNativeShare && (
            <button
              onClick={handleNativeShare}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              role="menuitem"
            >
              <HandFist className="h-4 w-4 flex-none text-brand-primary dark:text-brand-primary-400" weight="duotone" />
              Share&hellip;
            </button>
          )}
          <button
            onClick={handleCopy}
            className={clsx(
              'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              copied
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700',
            )}
            role="menuitem"
          >
            {copied ? (
              <svg className="h-4 w-4 flex-none" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <LinkSimple className="h-4 w-4 flex-none text-brand-accent dark:text-brand-accent-400" weight="duotone" />
            )}
            {copied ? 'Copied!' : 'Copy share text'}
          </button>
        </div>
      )}
    </div>
  )
}
