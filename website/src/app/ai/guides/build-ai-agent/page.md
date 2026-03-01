---
title: Build an AI Agent
description: Build a conversational AI agent with tool calling and guardrails using Directive.
---

Create an AI agent with constraint-driven orchestration. {% .lead %}

---

## The Agent Module

{% callout type="note" %}
This guide requires the `openai` package: `npm install openai`
{% /callout %}

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { OpenAI } from 'openai';

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

const agentModule = createModule("agent", {
  schema: {
    facts: {
      messages: t.array(t.object<Message>()),
      pendingToolCall: t.object<ToolCall>().nullable(),
      isThinking: t.boolean(),
      error: t.string().nullable(),
    },
  },

  init: (facts) => {
    facts.messages = [
      { role: "system", content: "You are a helpful assistant." }
    ];
    facts.pendingToolCall = null;
    facts.isThinking = false;
    facts.error = null;
  },

  constraints: {
    needsResponse: {
      priority: 50,
      when: (facts) => {
        const lastMessage = facts.messages[facts.messages.length - 1];

        return lastMessage?.role === "user" && !facts.isThinking;
      },
      require: { type: "GENERATE_RESPONSE" },
    },

    executeToolCall: {
      priority: 100,
      when: (facts) => facts.pendingToolCall !== null,
      require: { type: "EXECUTE_TOOL" },
    },
  },

  resolvers: {
    generateResponse: {
      requirement: "GENERATE_RESPONSE",
      timeout: 30000,
      resolve: async (req, context) => {
        context.facts.isThinking = true;
        context.facts.error = null;

        try {
          const openai = new OpenAI();

          const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: context.facts.messages,
            tools: [
              {
                type: "function",
                function: {
                  name: "search",
                  description: "Search for information",
                  parameters: {
                    type: "object",
                    properties: {
                      query: { type: "string" },
                    },
                  },
                },
              },
            ],
          });

          const choice = completion.choices[0];

          if (choice.message.tool_calls?.length) {
            const call = choice.message.tool_calls[0];
            context.facts.pendingToolCall = {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments),
            };
          } else {
            context.facts.messages = [
              ...context.facts.messages,
              { role: "assistant", content: choice.message.content },
            ];
          }
        } catch (error) {
          context.facts.error = error.message;
        } finally {
          context.facts.isThinking = false;
        }
      },
    },

    executeTool: {
      requirement: "EXECUTE_TOOL",
      resolve: async (req, context) => {
        const { name, arguments: args } = context.facts.pendingToolCall;

        let result;
        switch (name) {
          case "search":
            result = await performSearch(args.query);
            break;
          default:
            result = { error: "Unknown tool" };
        }

        context.facts.messages = [
          ...context.facts.messages,
          {
            role: "assistant",
            content: `Tool result: ${JSON.stringify(result)}`,
          },
        ];

        context.facts.pendingToolCall = null;
      },
    },
  },
});
```

---

## React Chat Interface

```typescript
import { useState } from 'react';
import { useFact } from '@directive-run/react';

const system = createSystem({ module: agentModule });
system.start();

function ChatInterface() {
  const messages = useFact(system, 'messages');
  const isThinking = useFact(system, 'isThinking');
  const [input, setInput] = useState('');

  const sendMessage = () => {
    system.facts.messages = [
      ...system.facts.messages,
      { role: 'user', content: input },
    ];
    setInput('');
  };

  return (
    <div>
      <div className="messages">
        {messages.filter(m => m.role !== 'system').map((m, i) => (
          <div key={i} className={m.role}>
            {m.content}
          </div>
        ))}
        {isThinking && <div>Thinking...</div>}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
      />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}
```

---

## Next Steps

- [Running Agents](/ai/running-agents) &ndash; Agent lifecycle and configuration
- [Guardrails](/ai/guardrails) &ndash; Input/output safety
- [Streaming](/ai/streaming) &ndash; Real-time responses
- [Handle Agent Errors](/ai/guides/handle-agent-errors) &ndash; Retry and circuit breakers
