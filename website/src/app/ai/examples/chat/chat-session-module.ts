// @ts-nocheck
/**
 * Chat Session Directive Module
 *
 * Tracks live chat interaction state — message counts, character totals,
 * streaming status — so DevTools can display System tabs (Facts, Derivations,
 * Pipeline) alongside AI tabs on the AI Chat page.
 */
import { createModule, t } from '@directive-run/core'

export const chatSession = createModule('chat-session', {
  schema: {
    facts: {
      messageCount: t.number(),
      userMessages: t.number(),
      assistantMessages: t.number(),
      isStreaming: t.boolean(),
      totalCharsSent: t.number(),
      totalCharsReceived: t.number(),
      error: t.string(),
      startedAt: t.number(),
      summary: t.string(),
      warning: t.string(),
    },
    derivations: {
      avgResponseLength: t.number(),
      isActive: t.boolean(),
      responseRatio: t.number(),
    },
    events: {
      updateMessages: {
        messageCount: t.number(),
        userMessages: t.number(),
        assistantMessages: t.number(),
        totalCharsSent: t.number(),
        totalCharsReceived: t.number(),
      },
      setStreaming: { isStreaming: t.boolean() },
      setError: { error: t.string() },
    },
    requirements: {
      SUMMARIZE_CONVERSATION: {},
      USAGE_WARNING: {},
    },
  },

  init: (facts) => {
    facts.messageCount = 0
    facts.userMessages = 0
    facts.assistantMessages = 0
    facts.isStreaming = false
    facts.totalCharsSent = 0
    facts.totalCharsReceived = 0
    facts.error = ''
    facts.startedAt = Date.now()
    facts.summary = ''
    facts.warning = ''
  },

  derive: {
    avgResponseLength: (facts) => {
      if (facts.assistantMessages === 0) {
        return 0
      }

      return Math.round(facts.totalCharsReceived / facts.assistantMessages)
    },

    isActive: (facts) => facts.messageCount > 0 || facts.isStreaming,

    responseRatio: (facts) => {
      if (facts.totalCharsSent === 0) {
        return 0
      }

      return Math.round((facts.totalCharsReceived / facts.totalCharsSent) * 100) / 100
    },
  },

  events: {
    updateMessages: (facts, { messageCount, userMessages, assistantMessages, totalCharsSent, totalCharsReceived }) => {
      facts.messageCount = messageCount
      facts.userMessages = userMessages
      facts.assistantMessages = assistantMessages
      facts.totalCharsSent = totalCharsSent
      facts.totalCharsReceived = totalCharsReceived
    },

    setStreaming: (facts, { isStreaming }) => {
      facts.isStreaming = isStreaming
    },

    setError: (facts, { error }) => {
      facts.error = error
    },
  },

  constraints: {
    longConversation: {
      priority: 30,
      when: (facts) => facts.messageCount > 8 && !facts.summary,
      require: { type: 'SUMMARIZE_CONVERSATION' },
    },

    highTokenUsage: {
      priority: 20,
      when: (facts) => facts.totalCharsReceived > 5000 && !facts.warning,
      require: { type: 'USAGE_WARNING' },
    },
  },

  resolvers: {
    summarize: {
      requirement: 'SUMMARIZE_CONVERSATION',
      resolve: async (req, context) => {
        context.facts.summary = `Conversation has ${context.facts.messageCount} messages — consider summarizing.`
      },
    },

    usageWarning: {
      requirement: 'USAGE_WARNING',
      resolve: async (req, context) => {
        const kb = (context.facts.totalCharsReceived / 1024).toFixed(1)
        context.facts.warning = `High token usage: ${kb} KB received. Monitor costs.`
      },
    },
  },

  effects: {
    logActivity: {
      deps: ['messageCount'],
      run: (facts, prev) => {
        if (!prev || facts.messageCount === prev.messageCount) {
          return
        }
        if (process.env.NODE_ENV === 'development') {
          console.log(`[chat-session] ${facts.messageCount} messages (${facts.userMessages} user, ${facts.assistantMessages} assistant)`)
        }
      },
    },
  },
})
