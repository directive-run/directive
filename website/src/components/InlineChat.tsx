"use client";

import { MarkdownContent } from "@/components/ChatMarkdown";
import { PaperPlaneTilt, Sparkle } from "@phosphor-icons/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ChatState {
  messages: Message[];
  streamingContent: string;
  isLoading: boolean;
  error: string | null;
  input: string;
  hourlyRemaining: number | null;
  hourlyLimit: number | null;
  rateLimited: boolean;
}

// ---------------------------------------------------------------------------
// Store factory — each InlineChat instance gets its own isolated store so
// multiple chat panels on different pages don't share state.
// ---------------------------------------------------------------------------

function createChatStore() {
  let _state: ChatState = {
    messages: [],
    streamingContent: "",
    isLoading: false,
    error: null,
    input: "",
    hourlyRemaining: null,
    hourlyLimit: null,
    rateLimited: false,
  };

  const _listeners = new Set<() => void>();

  let _gen = 0;
  let _abortController: AbortController | null = null;

  function subscribe(listener: () => void) {
    _listeners.add(listener);

    return () => {
      _listeners.delete(listener);
    };
  }

  function getSnapshot(): ChatState {
    return _state;
  }

  function setState(patch: Partial<ChatState>) {
    _state = { ..._state, ...patch };
    const snapshot = [..._listeners];
    for (const l of snapshot) l();
  }

  async function handleSend(
    apiEndpoint: string,
    pageUrl: string,
    messageText?: string,
    extraHeaders?: Record<string, string>,
  ) {
    const text = (messageText ?? _state.input).trim();
    if (!text || _state.isLoading) {
      return;
    }

    const myGen = ++_gen;

    _abortController?.abort();
    const controller = new AbortController();
    _abortController = controller;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const history = _state.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setState({
      messages: [..._state.messages, userMessage],
      input: "",
      isLoading: true,
      streamingContent: "",
      error: null,
      rateLimited: false,
    });

    let accumulated = "";

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify({
          message: text,
          history,
          pageUrl,
        }),
        signal: controller.signal,
      });

      if (myGen !== _gen) {
        return;
      }

      // Read rate limit headers from response
      const remaining = response.headers.get("X-Hourly-Remaining");
      const limit = response.headers.get("X-Hourly-Limit");
      if (remaining !== null) {
        setState({
          hourlyRemaining: Number.parseInt(remaining, 10),
          hourlyLimit: limit ? Number.parseInt(limit, 10) : 5,
        });
      }

      if (!response.ok) {
        const errData = await response
          .json()
          .catch(() => ({ error: "Request failed" }));

        if (response.status === 429) {
          setState({
            rateLimited: true,
            error: errData.error || "You've used your free tries this hour.",
          });

          return;
        }

        throw new Error(errData.error || `Request failed (${response.status})`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        if (myGen !== _gen) {
          reader.cancel();

          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) {
            continue;
          }

          const data = line.slice(6).trim();
          if (!data) {
            continue;
          }

          try {
            const event = JSON.parse(data);
            if (event.type === "text") {
              accumulated += event.text;
              setState({ streamingContent: accumulated });
            } else if (event.type === "done") {
              setState({
                messages: [
                  ..._state.messages,
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: accumulated,
                  },
                ],
                streamingContent: "",
              });
              accumulated = "";
            } else if (event.type === "truncated") {
              accumulated += event.text;
              setState({ streamingContent: accumulated });
            } else if (event.type === "error") {
              throw new Error(event.message || "Stream error");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) {
              continue;
            }

            throw parseErr;
          }
        }
      }

      // Process any remaining partial SSE line in the buffer
      if (buffer.trim() && myGen === _gen) {
        const remaining = buffer.trim();
        if (remaining.startsWith("data: ")) {
          try {
            const event = JSON.parse(remaining.slice(6).trim());
            if (event.type === "text") {
              accumulated += event.text;
            }
          } catch {
            // Ignore malformed trailing data
          }
        }
      }

      // Flush remaining if stream ended without 'done'
      if (accumulated && myGen === _gen) {
        setState({
          messages: [
            ..._state.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: accumulated,
            },
          ],
          streamingContent: "",
        });
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }

      if (myGen !== _gen) {
        return;
      }

      const errorMessage =
        err instanceof Error ? err.message : "Something went wrong.";

      if (accumulated) {
        setState({
          messages: [
            ..._state.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: accumulated + "\n\n*[Connection interrupted]*",
            },
          ],
          streamingContent: "",
          error: errorMessage,
        });
      } else {
        setState({ error: errorMessage });
      }
    } finally {
      if (myGen === _gen) {
        setState({ isLoading: false });
      }
    }
  }

  return { subscribe, getSnapshot, setState, handleSend };
}

// ---------------------------------------------------------------------------
// InlineChat component
// ---------------------------------------------------------------------------

interface InlineChatProps {
  apiEndpoint: string;
  title: string;
  subtitle: string;
  placeholder: string;
  examplePrompts: string[];
  emptyTitle: string;
  emptySubtitle: string;
  pageUrl: string;
  headers?: Record<string, string>;
}

// Module-level store instances keyed by apiEndpoint — survives StrictMode
// double-mounts and Fast Refresh cycles.
const stores = new Map<string, ReturnType<typeof createChatStore>>();

export function getStore(key: string) {
  let store = stores.get(key);
  if (!store) {
    store = createChatStore();
    stores.set(key, store);
  }

  return store;
}

export function InlineChat({
  apiEndpoint,
  title,
  subtitle,
  placeholder,
  examplePrompts,
  emptyTitle,
  emptySubtitle,
  pageUrl,
  headers: extraHeaders,
}: InlineChatProps) {
  const store = getStore(apiEndpoint);
  const {
    messages,
    streamingContent,
    isLoading,
    error,
    input,
    hourlyRemaining,
    hourlyLimit,
    rateLimited,
  } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const resolvedPageUrl = pageUrl;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamingContent]);

  const send = (text?: string) =>
    store.handleSend(apiEndpoint, resolvedPageUrl, text, extraHeaders);

  // Check if user is using BYOK (no rate limit counter needed)
  const isByok = extraHeaders && "x-api-key" in extraHeaders;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <div className="flex h-7 w-7 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
          <Sparkle weight="duotone" className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
            {title}
          </h3>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {subtitle}
          </p>
        </div>
        {!isByok && hourlyRemaining !== null && hourlyLimit !== null && (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
            {hourlyRemaining} of {hourlyLimit} tries remaining
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full [background:linear-gradient(to_bottom_right,var(--brand-primary-500),var(--brand-accent-600))]">
              <Sparkle weight="duotone" className="h-6 w-6 text-white" />
            </div>
            <p className="text-sm font-medium text-zinc-900 dark:text-white">
              {emptyTitle}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {emptySubtitle}
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {examplePrompts.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-sky-500 dark:hover:bg-sky-900/20 dark:hover:text-sky-400"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3" role="log" aria-live="polite">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-sky-500 text-white"
                      : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {streamingContent && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl bg-zinc-100 px-3 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                  <MarkdownContent content={streamingContent} />
                </div>
              </div>
            )}

            {isLoading && !streamingContent && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400" />
                  </div>
                </div>
              </div>
            )}

            {/* Rate limit message — conversion CTA */}
            {rateLimited && (
              <div
                className="mx-auto max-w-[90%] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20"
                role="alert"
              >
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  {error}
                </p>
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  Want unlimited access? Use your own API key below.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href="https://www.npmjs.com/package/@directive-run/ai"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                  >
                    npm install
                  </a>
                  <a
                    href="/docs"
                    className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                  >
                    Read docs
                  </a>
                  <a
                    href="https://github.com/directive-run/directive"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
                  >
                    GitHub
                  </a>
                </div>
              </div>
            )}

            {/* Generic errors (non-rate-limit) */}
            {error && !rateLimited && (
              <div
                className="mx-auto flex max-w-[90%] items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                role="alert"
              >
                <span className="flex-1 text-center">{error}</span>
                <button
                  onClick={() => store.setState({ error: null })}
                  aria-label="Dismiss error"
                  className="shrink-0 rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3 w-3"
                  >
                    <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-700">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => store.setState({ input: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-400"
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-600 disabled:opacity-50"
          >
            <PaperPlaneTilt weight="fill" className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
