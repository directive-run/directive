"use client";

import clsx from "clsx";
import { Highlight } from "prism-react-renderer";
import { Fragment, useState } from "react";

import { CopyButton } from "./CodeTabs";

export interface CodeEditorTab {
  filename: string;
  code: string;
  language: string;
}

interface CodeEditorProps {
  tabs: CodeEditorTab[];
  className?: string;
  showLineNumbers?: boolean;
  showTrafficLights?: boolean;
}

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<"svg">) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  );
}

export function CodeEditor({
  tabs,
  className,
  showLineNumbers = true,
  showTrafficLights = true,
}: CodeEditorProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (tabs.length === 0) {
    return null;
  }

  const activeTab = tabs[activeIndex] ?? tabs[0];
  const code = activeTab.code.trimEnd();
  const lines = code.split("\n");

  return (
    <div
      className={clsx("relative rounded-2xl", className)}
      style={{
        backgroundColor: "var(--hero-editor-bg)",
        boxShadow:
          "0 0 0 1px var(--hero-editor-ring), var(--hero-editor-shadow)",
        backdropFilter: "var(--hero-editor-backdrop)",
      }}
    >
      <div className="pt-4 pl-4">
        {showTrafficLights && (
          <TrafficLightsIcon
            className="h-2.5 w-auto"
            style={{ stroke: "var(--code-traffic-stroke)" }}
          />
        )}

        {/* Tab bar */}
        <div
          className="mt-4 -ml-4 flex border-b"
          style={{ borderColor: "var(--code-title-border)" }}
        >
          {tabs.map((tab, i) => {
            const isActive = i === activeIndex;

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
              </button>
            );
          })}
        </div>
      </div>

      {/* Code area */}
      <div className="relative">
        <CopyButton code={code} />
        <div className="flex items-start px-1 pt-4 text-sm">
          {showLineNumbers && (
            <div
              aria-hidden="true"
              className="border-r pr-4 font-mono select-none"
              style={{
                borderColor: "var(--code-line-border)",
                color: "var(--code-line-text)",
              }}
            >
              {lines.map((_, index) => (
                <Fragment key={index}>
                  {(index + 1).toString().padStart(2, "0")}
                  <br />
                </Fragment>
              ))}
            </div>
          )}

          <Highlight
            code={code}
            language={activeTab.language || "text"}
            theme={{ plain: {}, styles: [] }}
          >
            {({
              className: highlightClass,
              style,
              tokens,
              getLineProps,
              getTokenProps,
            }) => (
              <pre
                className={clsx(highlightClass, "flex overflow-x-auto pb-6")}
                style={style}
              >
                <code className="px-4">
                  {tokens.map((line, lineIndex) => (
                    <div key={lineIndex} {...getLineProps({ line })}>
                      {line.map((token, tokenIndex) => (
                        <span key={tokenIndex} {...getTokenProps({ token })} />
                      ))}
                    </div>
                  ))}
                </code>
              </pre>
            )}
          </Highlight>
        </div>
      </div>
    </div>
  );
}
