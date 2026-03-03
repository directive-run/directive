"use client";

import { DevToolsWithProvider } from "@/components/DevToolsWithProvider";
import { InlineChat } from "@/components/InlineChat";
import {
  ProviderConfig,
  type ProviderConfigState,
} from "@/components/ProviderConfig";
import type { DebugEvent } from "@/components/devtools/types";
import { decodeReplay } from "@/components/devtools/utils/replay-codec";
import { useCallback, useEffect, useMemo, useState } from "react";

const EXAMPLE_PROMPTS = [
  "Analyze global electric vehicle adoption trends",
  "Process recent developments in quantum computing",
  "Evaluate the impact of remote work on urban planning",
];

export default function AIDataPipelinePage() {
  const [replayData, setReplayData] = useState<DebugEvent[] | undefined>(
    undefined,
  );
  const [config, setConfig] = useState<ProviderConfigState>({
    provider: "anthropic",
    apiKey: "",
  });

  useEffect(() => {
    const hash = window.location.hash;
    const prefix = "#replay=";
    if (!hash.startsWith(prefix)) {
      return;
    }

    try {
      setReplayData(decodeReplay(hash.slice(prefix.length)));
    } catch {
      console.warn("[DevTools] Failed to decode replay URL");
    }
  }, []);

  const handleConfigChange = useCallback((next: ProviderConfigState) => {
    setConfig(next);
  }, []);

  const headers = useMemo(() => {
    if (!config.apiKey) {
      return undefined;
    }

    return { "x-api-key": config.apiKey, "x-provider": config.provider };
  }, [config.apiKey, config.provider]);

  return (
    <DevToolsWithProvider
      streamUrl="/api/data-pipeline-devtools/stream"
      snapshotUrl="/api/data-pipeline-devtools/snapshot"
      replayData={replayData}
      runtimeSystemName={null}
      label="Data Pipeline"
    >
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
        <div className="shrink-0 text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white sm:text-3xl">
            Data Pipeline
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            3 agents + 2 tasks in a mixed DAG — classify, transform, analyze,
            validate, report. Open DevTools with the button in the bottom-left
            corner.
          </p>
        </div>

        <div className="mt-4 min-h-0 flex-1">
          <InlineChat
            apiEndpoint="/api/data-pipeline-chat"
            title="Data Pipeline"
            subtitle="Mixed agent + task DAG"
            placeholder="Enter a topic to analyze..."
            examplePrompts={EXAMPLE_PROMPTS}
            emptyTitle="Send a topic to see mixed agent + task execution"
            emptySubtitle="Watch 3 agents and 2 imperative tasks execute in a DAG pipeline."
            pageUrl="/ai/examples/data-pipeline"
            headers={headers}
          />
        </div>

        <div className="mt-3 shrink-0">
          <ProviderConfig onChange={handleConfigChange} />
        </div>
      </div>
    </DevToolsWithProvider>
  );
}
