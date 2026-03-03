"use client";

import { Check, Copy } from "@phosphor-icons/react";
import { Highlight } from "prism-react-renderer";
import { Fragment, memo, useCallback, useState } from "react";

export interface CodeTab {
  filename: string;
  label?: string;
  code: string;
  language: string;
}

interface CodeTabsProps {
  tabs: CodeTab[];
}

export const CopyButton = memo(function CopyButton({
  code,
}: {
  code: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(
        "Failed to copy:",
        err instanceof Error ? err.message : "Unknown error",
      );
    }
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      className="code-copy-btn cursor-pointer absolute right-2 top-2 z-10 rounded-md px-2 py-1 text-xs opacity-50 transition hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      aria-label={copied ? "Copied!" : "Copy code"}
    >
      {copied ? (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" weight="bold" />
          Copied
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Copy className="h-3 w-3" />
          Copy
        </span>
      )}
    </button>
  );
});

export const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const trimmed = code.trimEnd();

  return (
    <>
      <CopyButton code={trimmed} />
      <Highlight
        code={trimmed}
        language={language || "text"}
        theme={{ plain: {}, styles: [] }}
      >
        {({ className, style, tokens, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto p-5 text-[0.875em] leading-7`}
            style={style}
          >
            <code>
              {tokens.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line
                    .filter((token) => !token.empty)
                    .map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  {"\n"}
                </Fragment>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </>
  );
});

export const CodeTabs = memo(function CodeTabs({ tabs }: CodeTabsProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (tabs.length === 0) {
    return null;
  }

  const activeTab = tabs[activeIndex] ?? tabs[0];
  const isSingle = tabs.length === 1;

  return (
    <div
      className="group relative overflow-hidden rounded-xl"
      style={{
        backgroundColor: "var(--code-bg)",
        boxShadow: "0 0 0 1px var(--code-ring), var(--code-shadow)",
      }}
    >
      {/* Header: single title or tab bar */}
      {isSingle ? (
        <div
          className="border-b px-5 pt-3 pb-2 font-mono text-xs"
          style={{
            borderColor: "var(--code-title-border)",
            color: "var(--code-title-text)",
          }}
        >
          {activeTab.filename}
        </div>
      ) : (
        <div
          className="flex border-b"
          style={{ borderColor: "var(--code-title-border)" }}
          data-testid="code-tabs-bar"
        >
          {tabs.map((tab, i) => {
            const isActive = i === activeIndex;
            const lines = tab.code.trimEnd().split("\n").length;

            return (
              <button
                key={tab.filename}
                onClick={() => setActiveIndex(i)}
                className={
                  isActive
                    ? "cursor-pointer px-4 pt-3 pb-2 font-mono text-xs transition-colors border-b-2 border-brand-primary"
                    : "code-tab-inactive cursor-pointer px-4 pt-3 pb-2 font-mono text-xs transition-colors"
                }
                style={
                  isActive
                    ? { color: "var(--code-tab-active-text)" }
                    : undefined
                }
              >
                {tab.filename}
                <span
                  className="ml-1.5"
                  style={{ color: "var(--code-line-count)" }}
                >
                  ({lines})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Code block */}
      <CodeBlock code={activeTab.code} language={activeTab.language} />
    </div>
  );
});
