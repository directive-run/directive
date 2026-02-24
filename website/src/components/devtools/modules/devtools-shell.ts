// @ts-nocheck
import { createModule, t } from '@directive-run/core'
import { VIEWS } from '../constants'

type ViewName = (typeof VIEWS)[number]

export const devtoolsShell = createModule('shell', {
  schema: {
    facts: {
      activeView: t.string<ViewName>(),
      isFullscreen: t.boolean(),
      confirmClear: t.boolean(),
    },
    events: {
      setView: { view: t.string<ViewName>() },
      toggleFullscreen: {},
      exitFullscreen: {},
      startClear: {},
      executeClear: {},
      cancelClear: {},
    },
  },

  init: (facts) => {
    facts.activeView = 'Timeline'
    facts.isFullscreen = false
    facts.confirmClear = false
  },

  events: {
    setView: (facts, { view }) => {
      facts.activeView = view
    },
    toggleFullscreen: (facts) => {
      facts.isFullscreen = !facts.isFullscreen
    },
    exitFullscreen: (facts) => {
      facts.isFullscreen = false
    },
    startClear: (facts) => {
      facts.confirmClear = true
    },
    executeClear: (facts) => {
      facts.confirmClear = false
    },
    cancelClear: (facts) => {
      facts.confirmClear = false
    },
  },

  // Auto-cancel clear confirmation after 5 seconds
  constraints: {
    clearTimeout: {
      when: (facts) => facts.confirmClear === true,
      require: { type: 'CANCEL_STALE_CLEAR' },
    },
  },

  resolvers: {
    cancelStaleClear: {
      requirement: 'CANCEL_STALE_CLEAR',
      resolve: async (req, context) => {
        await new Promise((r) => setTimeout(r, 5000))
        if (context.facts.confirmClear) {
          context.facts.confirmClear = false
        }
      },
    },
  },
})
