'use client'

import {
  Component,
  forwardRef,
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import Highlighter from 'react-highlight-words'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  type AutocompleteApi,
  type AutocompleteCollection,
  type AutocompleteState,
  createAutocomplete,
} from '@algolia/autocomplete-core'
import { Dialog, DialogPanel } from '@headlessui/react'
import clsx from 'clsx'

import { MagnifyingGlass } from '@phosphor-icons/react'

import { navigation } from '@/lib/navigation'
import { type Result } from '@/markdoc/search.mjs'

// Error boundary for search functionality
class SearchErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Search error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <button
          type="button"
          className="group flex h-10 w-10 items-center justify-center text-slate-400 sm:justify-start md:h-auto md:w-full md:rounded-lg md:py-2.5 md:pr-3.5 md:pl-4 md:text-sm md:ring-1 md:ring-slate-200"
          onClick={() => this.setState({ hasError: false })}
        >
          <span className="text-xs">Search unavailable - click to retry</span>
        </button>
      )
    }
    return this.props.children
  }
}

type EmptyObject = Record<string, never>

type Autocomplete = AutocompleteApi<
  Result,
  React.SyntheticEvent,
  React.MouseEvent,
  React.KeyboardEvent
>

// Memoized search source to prevent re-importing on every keystroke
let searchModule: { search: (query: string, options?: { limit?: number }) => Array<Result> } | null = null
const getSearchModule = async () => {
  if (!searchModule) {
    searchModule = await import('@/markdoc/search.mjs')
  }
  return searchModule
}

function useAutocomplete({
  close,
}: {
  close: (autocomplete: Autocomplete) => void
}) {
  let id = useId()
  let router = useRouter()
  let [autocompleteState, setAutocompleteState] = useState<
    AutocompleteState<Result> | EmptyObject
  >({})

  const navigate = useCallback(({ itemUrl }: { itemUrl?: string }) => {
    if (!itemUrl) {
      return
    }

    router.push(itemUrl)

    if (
      itemUrl ===
      window.location.pathname + window.location.search + window.location.hash
    ) {
      close(autocomplete)
    }
  }, [router, close])

  // Memoized getSources function to avoid recreating on every render
  const getSources = useCallback(({ query }: { query: string }) => {
    return getSearchModule().then(({ search }) => {
      return [
        {
          sourceId: 'documentation',
          getItems() {
            return search(query, { limit: 15 })
          },
          getItemUrl({ item }: { item: Result }) {
            return item.url
          },
          onSelect: navigate,
        },
      ]
    })
  }, [navigate])

  let [autocomplete] = useState<Autocomplete>(() =>
    createAutocomplete<
      Result,
      React.SyntheticEvent,
      React.MouseEvent,
      React.KeyboardEvent
    >({
      id,
      placeholder: 'Find something...',
      defaultActiveItemId: 0,
      onStateChange({ state }) {
        setAutocompleteState(state)
      },
      shouldPanelOpen({ state }) {
        return state.query !== ''
      },
      navigator: {
        navigate,
      },
      getSources,
    }),
  )

  return { autocomplete, autocompleteState }
}

function LoadingIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  let id = useId()

  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="10" cy="10" r="5.5" strokeLinejoin="round" />
      <path
        stroke={`url(#${id})`}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.5 10a5.5 5.5 0 1 0-5.5 5.5"
      />
      <defs>
        <linearGradient
          id={id}
          x1="13"
          x2="9.5"
          y1="9"
          y2="15"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function HighlightQuery({ text, query }: { text: string; query: string }) {
  return (
    <Highlighter
      highlightClassName="group-aria-selected:underline bg-transparent text-brand-primary-600 dark:text-brand-primary-400"
      searchWords={[query]}
      autoEscape={true}
      textToHighlight={text}
    />
  )
}

function SearchResult({
  result,
  autocomplete,
  collection,
  query,
}: {
  result: Result
  autocomplete: Autocomplete
  collection: AutocompleteCollection<Result>
  query: string
}) {
  let id = useId()

  let sectionTitle = navigation.find((section) =>
    section.links.find((link) => link.href === result.url.split('#')[0]),
  )?.title
  let hierarchy = [sectionTitle, result.pageTitle].filter(
    (x): x is string => typeof x === 'string',
  )

  return (
    <li
      className="group block cursor-default rounded-lg px-3 py-2 aria-selected:bg-slate-100 dark:aria-selected:bg-slate-700/30"
      aria-labelledby={`${id}-hierarchy ${id}-title`}
      {...autocomplete.getItemProps({
        item: result,
        source: collection.source,
      })}
    >
      <div
        id={`${id}-title`}
        aria-hidden="true"
        className="text-sm font-medium text-slate-700 group-aria-selected:text-brand-primary-600 dark:text-slate-300 dark:group-aria-selected:text-brand-primary-400"
      >
        <HighlightQuery text={result.title} query={query} />
      </div>
      {result.preview && (
        <div
          aria-hidden="true"
          className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400"
        >
          <HighlightQuery text={result.preview} query={query} />
        </div>
      )}
      {hierarchy.length > 0 && (
        <div
          id={`${id}-hierarchy`}
          aria-hidden="true"
          className="mt-1 truncate text-xs whitespace-nowrap text-slate-400 dark:text-slate-500"
        >
          {hierarchy.map((item, itemIndex, items) => (
            <Fragment key={itemIndex}>
              <HighlightQuery text={item} query={query} />
              <span
                className={
                  itemIndex === items.length - 1
                    ? 'sr-only'
                    : 'mx-2 text-slate-300 dark:text-slate-700'
                }
              >
                /
              </span>
            </Fragment>
          ))}
        </div>
      )}
    </li>
  )
}

function SearchResults({
  autocomplete,
  query,
  collection,
}: {
  autocomplete: Autocomplete
  query: string
  collection: AutocompleteCollection<Result>
}) {
  if (collection.items.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-700 dark:text-slate-400">
        <p>
          No results for &ldquo;
          <span className="wrap-break-word text-slate-900 dark:text-white">
            {query}
          </span>
          &rdquo;
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Try searching for &ldquo;facts&rdquo;, &ldquo;constraints&rdquo;, or &ldquo;resolvers&rdquo;
        </p>
      </div>
    )
  }

  return (
    <ul {...autocomplete.getListProps()}>
      {collection.items.map((result) => (
        <SearchResult
          key={result.url}
          result={result}
          autocomplete={autocomplete}
          collection={collection}
          query={query}
        />
      ))}
    </ul>
  )
}

const SearchInput = forwardRef<
  React.ElementRef<'input'>,
  {
    autocomplete: Autocomplete
    autocompleteState: AutocompleteState<Result> | EmptyObject
    onClose: () => void
  }
>(function SearchInput({ autocomplete, autocompleteState, onClose }, inputRef) {
  let inputProps = autocomplete.getInputProps({ inputElement: null })

  return (
    <div className="group relative flex h-12">
      <MagnifyingGlass className="pointer-events-none absolute top-0 left-4 h-full w-5 text-slate-400 dark:text-slate-500" />
      <input
        ref={inputRef}
        data-autofocus
        className={clsx(
          'flex-auto appearance-none bg-transparent pl-12 text-slate-900 outline-hidden placeholder:text-slate-400 focus:w-full focus:flex-none sm:text-sm dark:text-white [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden [&::-webkit-search-results-button]:hidden [&::-webkit-search-results-decoration]:hidden',
          autocompleteState.status === 'stalled' ? 'pr-11' : 'pr-4',
        )}
        {...inputProps}
        maxLength={200}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !autocompleteState.isOpen &&
            autocompleteState.query === ''
          ) {
            // In Safari, closing the dialog with the escape key can sometimes cause the scroll position to jump to the
            // bottom of the page. This is a workaround for that until we can figure out a proper fix in Headless UI.
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur()
            }

            onClose()
          } else {
            inputProps.onKeyDown(event)
          }
        }}
      />
      {autocompleteState.status === 'stalled' && (
        <div className="absolute inset-y-0 right-3 flex items-center">
          <LoadingIcon className="h-6 w-6 animate-spin stroke-slate-200 text-slate-400 dark:stroke-slate-700 dark:text-slate-500" />
        </div>
      )}
    </div>
  )
})

function CloseOnNavigation({
  close,
  autocomplete,
}: {
  close: (autocomplete: Autocomplete) => void
  autocomplete: Autocomplete
}) {
  let pathname = usePathname()
  let searchParams = useSearchParams()

  useEffect(() => {
    close(autocomplete)
  }, [pathname, searchParams, close, autocomplete])

  return null
}

function SearchDialog({
  open,
  setOpen,
  className,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  className?: string
}) {
  let formRef = useRef<React.ElementRef<'form'>>(null)
  let panelRef = useRef<React.ElementRef<'div'>>(null)
  let inputRef = useRef<React.ElementRef<typeof SearchInput>>(null)

  let close = useCallback(
    (autocomplete: Autocomplete) => {
      setOpen(false)
      autocomplete.setQuery('')
    },
    [setOpen],
  )

  let { autocomplete, autocompleteState } = useAutocomplete({
    close() {
      close(autocomplete)
    },
  })

  useEffect(() => {
    if (open) {
      return
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  return (
    <>
      <Suspense fallback={null}>
        <CloseOnNavigation close={close} autocomplete={autocomplete} />
      </Suspense>
      <Dialog
        open={open}
        onClose={() => close(autocomplete)}
        className={clsx('fixed inset-0 z-50', className)}
      >
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm" />

        <div className="fixed inset-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-20 md:py-32 lg:px-8 lg:py-[15vh]">
          <DialogPanel className="mx-auto transform-gpu overflow-hidden rounded-xl bg-white shadow-xl sm:max-w-xl dark:bg-brand-surface-raised dark:ring-1 dark:ring-slate-700">
            <div {...autocomplete.getRootProps({})}>
              <form
                ref={formRef}
                {...autocomplete.getFormProps({
                  inputElement: inputRef.current,
                })}
              >
                <SearchInput
                  ref={inputRef}
                  autocomplete={autocomplete}
                  autocompleteState={autocompleteState}
                  onClose={() => setOpen(false)}
                />
                <div
                  ref={panelRef}
                  className="border-t border-slate-200 bg-white px-2 py-3 empty:hidden dark:border-slate-400/10 dark:bg-brand-surface-raised"
                  {...autocomplete.getPanelProps({})}
                >
                  {autocompleteState.isOpen && (
                    <SearchResults
                      autocomplete={autocomplete}
                      query={autocompleteState.query}
                      collection={autocompleteState.collections[0]}
                    />
                  )}
                </div>
              </form>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}

function useSearchProps() {
  let buttonRef = useRef<React.ElementRef<'button'>>(null)
  let [open, setOpen] = useState(false)

  return {
    buttonProps: {
      ref: buttonRef,
      onClick() {
        setOpen(true)
      },
    },
    dialogProps: {
      open,
      setOpen: useCallback((open: boolean) => {
        let { width = 0, height = 0 } =
          buttonRef.current?.getBoundingClientRect() ?? {}
        if (!open || (width !== 0 && height !== 0)) {
          setOpen(open)
        }
      }, []),
    },
  }
}

function SearchInner() {
  let [modifierKey, setModifierKey] = useState<string>()
  let { buttonProps, dialogProps } = useSearchProps()

  useEffect(() => {
    setModifierKey(
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform) ? '⌘' : 'Ctrl ',
    )
  }, [])

  return (
    <>
      <button
        type="button"
        className="group flex h-10 w-10 items-center justify-center sm:justify-start md:h-auto md:w-full md:rounded-lg md:py-2.5 md:pr-3.5 md:pl-4 md:text-sm md:ring-1 md:ring-slate-200 md:hover:ring-slate-300 dark:md:bg-brand-surface-raised/75 dark:md:ring-white/5 dark:md:ring-inset dark:md:hover:bg-slate-700/40 dark:md:hover:ring-slate-500"
        {...buttonProps}
      >
        <MagnifyingGlass className="h-5 w-5 flex-none text-slate-400 group-hover:text-slate-500 md:group-hover:text-slate-400 dark:text-slate-500" />
        <span className="sr-only md:not-sr-only md:ml-2 md:text-slate-500 md:dark:text-slate-400">
          Search docs
        </span>
        {modifierKey && (
          <kbd className="ml-auto hidden font-medium text-slate-400 md:block dark:text-slate-500">
            <kbd className="font-sans">{modifierKey}</kbd>
            <kbd className="font-sans">K</kbd>
          </kbd>
        )}
      </button>
      <SearchDialog {...dialogProps} />
    </>
  )
}

export function Search() {
  return (
    <SearchErrorBoundary>
      <SearchInner />
    </SearchErrorBoundary>
  )
}
