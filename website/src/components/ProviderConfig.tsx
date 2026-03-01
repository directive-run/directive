'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'

const STORAGE_KEY = 'directive-provider-config'

export type Provider = 'anthropic' | 'openai'

export interface ProviderConfigState {
  provider: Provider
  apiKey: string
}

const DEFAULT_STATE: ProviderConfigState = { provider: 'anthropic', apiKey: '' }

function loadConfig(): ProviderConfigState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }

    const parsed = JSON.parse(raw)

    return {
      provider: parsed.provider === 'openai' ? 'openai' : 'anthropic',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return DEFAULT_STATE
  }
}

function saveConfig(config: ProviderConfigState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // localStorage unavailable
  }
}

interface ProviderConfigProps {
  onChange: (config: ProviderConfigState) => void
}

export function ProviderConfig({ onChange }: ProviderConfigProps) {
  const [config, setConfig] = useState<ProviderConfigState>(DEFAULT_STATE)
  const [showKey, setShowKey] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const loaded = loadConfig()
    setConfig(loaded)
    onChange(loaded)
    setHydrated(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (patch: Partial<ProviderConfigState>) => {
      setConfig((prev) => {
        const next = { ...prev, ...patch }
        saveConfig(next)
        onChange(next)

        return next
      })
    },
    [onChange],
  )

  const isDev = process.env.NODE_ENV === 'development'

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
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
            type={showKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder={config.provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            className="w-full rounded border border-zinc-300 bg-white py-1 pl-2 pr-8 text-xs text-zinc-900 placeholder-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
          >
            {showKey ? (
              <EyeSlash weight="bold" className="h-3.5 w-3.5" />
            ) : (
              <Eye weight="bold" className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </label>

      {hydrated && (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {config.apiKey
            ? 'Using your key'
            : isDev
              ? 'Using server key (dev)'
              : 'Enter your API key'}
        </span>
      )}
    </div>
  )
}
