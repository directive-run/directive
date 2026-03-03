"use client";

import { Eye, EyeSlash, Key } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "directive-provider-config";

export type Provider = "anthropic" | "openai";

export interface ProviderConfigState {
  provider: Provider;
  apiKey: string;
}

const DEFAULT_STATE: ProviderConfigState = {
  provider: "anthropic",
  apiKey: "",
};

function loadConfig(): ProviderConfigState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(raw);

    return {
      provider: parsed.provider === "openai" ? "openai" : "anthropic",
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveConfig(config: ProviderConfigState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable
  }
}

interface ProviderConfigProps {
  onChange: (config: ProviderConfigState) => void;
}

export function ProviderConfig({ onChange }: ProviderConfigProps) {
  const [config, setConfig] = useState<ProviderConfigState>(DEFAULT_STATE);
  const [showKey, setShowKey] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const loaded = loadConfig();
    setConfig(loaded);
    onChange(loaded);
    setHydrated(true);
    // Auto-expand if user already has a key saved
    if (loaded.apiKey) {
      setExpanded(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (patch: Partial<ProviderConfigState>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch };
        saveConfig(next);
        onChange(next);

        return next;
      });
    },
    [onChange],
  );

  if (!hydrated) {
    return null;
  }

  // When user has a BYOK key active, show a compact badge
  if (config.apiKey && !expanded) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 dark:border-emerald-800 dark:bg-emerald-900/20">
        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <Key weight="bold" className="h-3 w-3" />
          Using your key (unlimited)
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="text-[10px] text-emerald-600 underline hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          Change
        </button>
      </div>
    );
  }

  // Collapsed state: just a small link
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 transition hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        <Key weight="bold" className="h-3 w-3" />
        Use your own key for unlimited access
      </button>
    );
  }

  // Expanded state: full config panel
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Provider
          <select
            value={config.provider}
            onChange={(e) => update({ provider: e.target.value as Provider })}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label className="flex flex-1 items-center gap-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">
          API Key
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={
                config.provider === "anthropic" ? "sk-ant-..." : "sk-..."
              }
              className="w-full rounded border border-zinc-300 bg-white py-1 pl-2 pr-8 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label={showKey ? "Hide API key" : "Show API key"}
            >
              {showKey ? (
                <EyeSlash weight="bold" className="h-3.5 w-3.5" />
              ) : (
                <Eye weight="bold" className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </label>

        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Collapse"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
