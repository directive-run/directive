'use client'

import { useEffect, useRef } from 'react'

export type ExampleBuild = {
  css: string
  html: string
  scriptSrc: string
}

/**
 * Embeds a pre-built Directive example as a light DOM custom element.
 * CSS is injected into <head> with a data attribute for cleanup.
 * Script is loaded as type="module".
 */
export function ExampleEmbed({
  name,
  css,
  html,
  scriptSrc,
}: {
  name: string
} & ExampleBuild) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tag = `directive-${name}`

  useEffect(() => {
    if (typeof customElements === 'undefined') {
      return
    }

    if (!customElements.get(tag)) {
      const capturedCss = css
      const capturedHtml = html
      const capturedScript = scriptSrc
      const capturedTag = tag

      class DirectiveExample extends HTMLElement {
        connectedCallback() {
          // Only inject styles if not already present
          if (!document.head.querySelector(`style[data-${capturedTag}]`)) {
            const style = document.createElement('style')
            style.setAttribute(`data-${capturedTag}`, '')
            style.textContent = capturedCss
            document.head.appendChild(style)
          }

          this.innerHTML = capturedHtml

          if (capturedScript) {
            // Append with cache-bust query so the module re-executes on re-mount
            const script = document.createElement('script')
            script.type = 'module'
            script.src = `${capturedScript}${capturedScript.includes('?') ? '&' : '?'}t=${Date.now()}`
            document.head.appendChild(script)
          }
        }

        disconnectedCallback() {
          document
            .querySelectorAll(`style[data-${capturedTag}]`)
            .forEach((el) => el.remove())
        }
      }

      customElements.define(capturedTag, DirectiveExample)
    }

    const host = hostRef.current
    if (host && !host.querySelector(tag)) {
      host.innerHTML = ''
      const el = document.createElement(tag)
      host.appendChild(el)
    }

    return () => {
      const host = hostRef.current
      if (host) {
        const el = host.querySelector(tag)
        if (el) {
          host.removeChild(el)
        }
      }
    }
  }, [css, html, scriptSrc, tag])

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label={`Interactive ${name} example`}
      className="min-h-[200px] overflow-hidden rounded-xl border border-[#4a4035] bg-[#161412]"
    >
      <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-500">
        Loading example&hellip;
      </div>
    </div>
  )
}
