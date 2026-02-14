---
title: AI Agent Example
description: Build a conversational AI agent with tool calling and guardrails.
---

Create an AI agent with constraint-driven orchestration. {% .lead %}

---

## The Agent Module

{% callout type="note" %}
This example requires the `openai` package: `npm install openai`
{% /callout %}

```typescript
import { createModule, createSystem, t } from '@directive-run/core';
import { OpenAI } from 'openai';

// Shape of each message in the conversation history
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Describes a tool the LLM wants to invoke
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

  // Seed the conversation with a system prompt
  init: (facts) => {
    facts.messages = [
      { role: "system", content: "You are a helpful assistant." }
    ];
    facts.pendingToolCall = null;
    facts.isThinking = false;
    facts.error = null;
  },

  constraints: {
    // When the user sends a message, trigger a response generation
    needsResponse: {
      priority: 50,
      when: (facts) => {
        const lastMessage = facts.messages[facts.messages.length - 1];

        return lastMessage?.role === "user" && !facts.isThinking;
      },
      require: { type: "GENERATE_RESPONSE" },
    },

    // Tool calls take priority over normal responses
    executeToolCall: {
      priority: 100,
      when: (facts) => facts.pendingToolCall !== null,
      require: { type: "EXECUTE_TOOL" },
    },
  },

  resolvers: {
    // Call the LLM and handle either a text reply or a tool call request
    generateResponse: {
      requirement: "GENERATE_RESPONSE",
      timeout: 30000,
      resolve: async (req, context) => {
        context.facts.isThinking = true;
        context.facts.error = null;

        try {
          const openai = new OpenAI();

          // Send the full conversation history with available tools
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
            // LLM wants to call a tool – park it for the executeToolCall constraint
            const call = choice.message.tool_calls[0];
            context.facts.pendingToolCall = {
              name: call.function.name,
              arguments: JSON.parse(call.function.arguments),
            };
          } else {
            // Normal text reply – append to conversation
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

    // Execute the pending tool call and feed the result back into the conversation
    executeTool: {
      requirement: "EXECUTE_TOOL",
      resolve: async (req, context) => {
        const { name, arguments: args } = context.facts.pendingToolCall;

        // Dispatch to the appropriate tool handler
        let result;
        switch (name) {
          case "search":
            result = await performSearch(args.query);
            break;
          default:
            result = { error: "Unknown tool" };
        }

        // Append the tool result so the LLM can see it on the next turn
        context.facts.messages = [
          ...context.facts.messages,
          {
            role: "assistant",
            content: `Tool result: ${JSON.stringify(result)}`,
          },
        ];

        // Clear the pending call so the constraint stops firing
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

// Boot the agent system once at module scope
const system = createSystem({ module: agentModule });
system.start();

function ChatInterface() {
  // Subscribe to reactive facts – component re-renders when these change
  const messages = useFact(system, 'messages');
  const isThinking = useFact(system, 'isThinking');
  const [input, setInput] = useState('');

  // Append a user message to facts – this triggers the needsResponse constraint
  const sendMessage = () => {
    system.facts.messages = [
      ...system.facts.messages,
      { role: 'user', content: input },
    ];
    setInput('');
  };

  return (
    <div>
      {/* Render visible messages, hiding the system prompt */}
      <div className="messages">
        {messages.filter(m => m.role !== 'system').map((m, i) => (
          <div key={i} className={m.role}>
            {m.content}
          </div>
        ))}
        {isThinking && <div>Thinking...</div>}
      </div>

      {/* Send on Enter or button click */}
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

- [OpenAI Agents](/docs/ai/orchestrator) – More patterns
- [Guardrails](/docs/ai/guardrails) – Safety
- [Streaming](/docs/ai/streaming) – Real-time responses
