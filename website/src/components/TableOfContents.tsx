'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'

import { type Section, type Subsection } from '@/lib/sections'

function ChevronIcon({ className, isOpen }: { className?: string; isOpen: boolean }) {
  return (
    <svg
      className={clsx(className, 'transition-transform', isOpen && 'rotate-180')}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function MobileTableOfContents({
  tableOfContents,
  currentSection,
  isActive,
}: {
  tableOfContents: Array<Section>
  currentSection: string | undefined
  isActive: (section: Section | Subsection) => boolean
}) {
  const [isOpen, setIsOpen] = useState(false)

  if (tableOfContents.length === 0) return null

  const currentTitle = tableOfContents.find(s => s.id === currentSection)?.title
    ?? tableOfContents[0]?.title
    ?? 'On this page'

  return (
    <div className="sticky top-14 z-40 -mx-4 bg-white px-4 py-3 shadow-sm xl:hidden dark:bg-slate-900">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between text-sm font-medium text-slate-900 dark:text-white"
        aria-expanded={isOpen}
      >
        <span className="truncate">{currentTitle}</span>
        <ChevronIcon className="h-4 w-4 flex-shrink-0 text-slate-500" isOpen={isOpen} />
      </button>
      {isOpen && (
        <nav className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          <ol role="list" className="space-y-2 text-sm">
            {tableOfContents.map((section) => (
              <li key={section.id}>
                <Link
                  href={`#${section.id}`}
                  onClick={() => setIsOpen(false)}
                  className={clsx(
                    'block py-1',
                    isActive(section)
                      ? 'text-sky-500'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-300',
                  )}
                >
                  {section.title}
                </Link>
                {section.children.length > 0 && (
                  <ol role="list" className="mt-1 space-y-1 pl-4">
                    {section.children.map((subSection) => (
                      <li key={subSection.id}>
                        <Link
                          href={`#${subSection.id}`}
                          onClick={() => setIsOpen(false)}
                          className={clsx(
                            'block py-1 text-xs',
                            isActive(subSection)
                              ? 'text-sky-500'
                              : 'text-slate-500 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-400',
                          )}
                        >
                          {subSection.title}
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
    </div>
  )
}

function DesktopTableOfContents({
  tableOfContents,
  isActive,
}: {
  tableOfContents: Array<Section>
  isActive: (section: Section | Subsection) => boolean
}) {
  return (
    <div className="hidden xl:sticky xl:top-19 xl:-mr-6 xl:block xl:h-[calc(100vh-4.75rem)] xl:flex-none xl:overflow-y-auto xl:py-16 xl:pr-6">
      <nav aria-labelledby="on-this-page-title" className="w-56">
        {tableOfContents.length > 0 && (
          <>
            <h2
              id="on-this-page-title"
              className="font-display text-sm font-medium text-slate-900 dark:text-white"
            >
              On this page
            </h2>
            <ol role="list" className="mt-4 space-y-3 text-sm">
              {tableOfContents.map((section) => (
                <li key={section.id}>
                  <h3>
                    <Link
                      href={`#${section.id}`}
                      className={clsx(
                        isActive(section)
                          ? 'text-sky-500'
                          : 'font-normal text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300',
                      )}
                    >
                      {section.title}
                    </Link>
                  </h3>
                  {section.children.length > 0 && (
                    <ol
                      role="list"
                      className="mt-2 space-y-3 pl-5 text-slate-500 dark:text-slate-400"
                    >
                      {section.children.map((subSection) => (
                        <li key={subSection.id}>
                          <Link
                            href={`#${subSection.id}`}
                            className={
                              isActive(subSection)
                                ? 'text-sky-500'
                                : 'hover:text-slate-600 dark:hover:text-slate-300'
                            }
                          >
                            {subSection.title}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </nav>
    </div>
  )
}

export function TableOfContents({
  tableOfContents,
}: {
  tableOfContents: Array<Section>
}) {
  const [currentSection, setCurrentSection] = useState(tableOfContents[0]?.id)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const headingElementsRef = useRef<Map<string, IntersectionObserverEntry>>(new Map())

  // Memoize heading IDs to avoid recalculating on every render
  const headingIds = useMemo(() => {
    return tableOfContents.flatMap((node) => [node.id, ...node.children.map((child) => child.id)])
  }, [tableOfContents])

  useEffect(() => {
    if (tableOfContents.length === 0) return

    // Clean up previous observer and entries
    headingElementsRef.current.clear()
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    const callback: IntersectionObserverCallback = (entries) => {
      entries.forEach((entry) => {
        headingElementsRef.current.set(entry.target.id, entry)
      })

      // Find the first visible heading or the last one that was scrolled past
      const visibleHeadings: IntersectionObserverEntry[] = []
      headingElementsRef.current.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleHeadings.push(entry)
        }
      })

      if (visibleHeadings.length > 0) {
        // Sort by position and use the topmost visible heading
        const sortedHeadings = visibleHeadings.sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top
        )
        setCurrentSection(sortedHeadings[0].target.id)
      } else {
        // No headings visible, find the one closest above viewport
        const allEntries = Array.from(headingElementsRef.current.values())
        const aboveViewport = allEntries.filter(
          (entry) => entry.boundingClientRect.top < 0
        )
        if (aboveViewport.length > 0) {
          const closest = aboveViewport.reduce((prev, curr) =>
            prev.boundingClientRect.top > curr.boundingClientRect.top ? prev : curr
          )
          setCurrentSection(closest.target.id)
        }
      }
    }

    const observer = new IntersectionObserver(callback, {
      rootMargin: '-80px 0px -40% 0px',
      threshold: [0, 1],
    })
    observerRef.current = observer

    // Observe all heading elements
    headingIds.forEach((id) => {
      const element = document.getElementById(id)
      if (element) {
        observer.observe(element)
      }
    })

    return () => {
      observer.disconnect()
      headingElementsRef.current.clear()
    }
  }, [headingIds, tableOfContents.length])

  const isActive = useCallback((section: Section | Subsection) => {
    if (section.id === currentSection) {
      return true
    }
    if (!section.children) {
      return false
    }
    return section.children.some((child) => child.id === currentSection)
  }, [currentSection])

  return (
    <>
      <MobileTableOfContents
        tableOfContents={tableOfContents}
        currentSection={currentSection}
        isActive={isActive}
      />
      <DesktopTableOfContents
        tableOfContents={tableOfContents}
        isActive={isActive}
      />
    </>
  )
}
