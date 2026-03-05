"use client";

import { useDirectiveRef, useSelector, useEvents } from "@directive-run/react";
import { useCallback, useEffect, useRef } from "react";
import { ExampleEmbed, type ExampleBuild } from "./ExampleEmbed";
import { DevToolsProvider } from "./devtools/DevToolsProvider";
import { InspectorFacts } from "./inspector/InspectorFacts";
import { InspectorDerivations } from "./inspector/InspectorDerivations";
import { InspectorPipeline } from "./inspector/InspectorPipeline";
import { InspectorActivity } from "./inspector/InspectorActivity";
import {
  inspectorModule,
  type InspectorTab,
} from "./inspector/inspector-module";
import "./devtools/devtools.css";

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "facts", label: "Facts" },
  { id: "derivations", label: "Derivations" },
  { id: "pipeline", label: "Pipeline" },
  { id: "activity", label: "Activity" },
];

export function InlineInspector({
  name,
  systemName,
  css,
  html,
  scriptSrc,
}: {
  name: string;
  systemName: string;
} & ExampleBuild) {
  const system = useDirectiveRef({ module: inspectorModule });
  const open = useSelector(system, (s) => s.open);
  const activeTab = useSelector(system, (s) => s.activeTab);
  const buttonLabel = useSelector(system, (s) => s.buttonLabel);
  const events = useEvents(system);
  const tablistRef = useRef<HTMLDivElement>(null);

  // Auto-open inspector on desktop
  useEffect(() => {
    if (window.matchMedia("(min-width: 640px)").matches) {
      events.open();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tabIds = TABS.map((t) => t.id);
      const currentIndex = tabIds.indexOf(activeTab);
      let nextIndex = -1;

      if (e.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % tabIds.length;
      } else if (e.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
      } else if (e.key === "Home") {
        nextIndex = 0;
      } else if (e.key === "End") {
        nextIndex = tabIds.length - 1;
      }

      if (nextIndex >= 0) {
        e.preventDefault();
        events.selectTab({ tab: tabIds[nextIndex] });
        const buttons = tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[nextIndex]?.focus();
      }
    },
    [activeTab, events],
  );

  return (
    <DevToolsProvider mode="system" runtimeSystemName={systemName}>
      <div className="overflow-hidden rounded-xl border border-slate-700/50">
        {/* Example embed — suppress ExampleEmbed's own border/rounding */}
        <div className="[&>div]:rounded-none [&>div]:border-0">
          <ExampleEmbed name={name} css={css} html={html} scriptSrc={scriptSrc} />
        </div>

        {/* Toggle button */}
        <button
          onClick={() => events.toggle()}
          className="flex w-full cursor-pointer items-center justify-center gap-2 border-t border-slate-700/50 bg-zinc-950 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
          aria-expanded={open}
          aria-controls={`inspector-${name}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z"
              clipRule="evenodd"
            />
          </svg>
          {buttonLabel}
        </button>

        {/* Inspector panel */}
        {open && (
          <div
            id={`inspector-${name}`}
            className="border-t border-slate-700/50 bg-white dark:bg-zinc-900"
          >
            {/* Tab bar */}
            <div
              ref={tablistRef}
              role="tablist"
              aria-label="Inspector panels"
              onKeyDown={handleTabKeyDown}
              className="flex overflow-x-auto border-b border-zinc-200 dark:border-zinc-700"
            >
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  id={`tab-${name}-${tab.id}`}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`tabpanel-${name}`}
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => events.selectTab({ tab: tab.id })}
                  className={`cursor-pointer whitespace-nowrap px-3 py-2 text-[11px] font-medium transition-colors ${
                    activeTab === tab.id
                      ? "border-b-2 border-sky-500 text-sky-600 dark:text-sky-400"
                      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div
              id={`tabpanel-${name}`}
              role="tabpanel"
              aria-labelledby={`tab-${name}-${activeTab}`}
              className="max-h-48 overflow-y-auto p-2 sm:max-h-64"
            >
              {activeTab === "facts" && <InspectorFacts />}
              {activeTab === "derivations" && <InspectorDerivations />}
              {activeTab === "pipeline" && <InspectorPipeline />}
              {activeTab === "activity" && <InspectorActivity />}
            </div>
          </div>
        )}
      </div>
    </DevToolsProvider>
  );
}
