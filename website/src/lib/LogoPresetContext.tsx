"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  DEFAULT_LOGO_PRESET,
  type LogoPreset,
  findLogoPreset,
  getStoredLogoPresetId,
  storeLogoPresetId,
} from "./logo-presets";

interface LogoPresetContextValue {
  preset: LogoPreset;
  setPreset: (preset: LogoPreset) => void;
  resetPreset: () => void;
}

const LogoPresetContext = createContext<LogoPresetContextValue>({
  preset: DEFAULT_LOGO_PRESET,
  setPreset: () => {},
  resetPreset: () => {},
});

export function LogoPresetProvider({
  children,
}: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<LogoPreset>(DEFAULT_LOGO_PRESET);

  useEffect(() => {
    const storedId = getStoredLogoPresetId();
    const found = findLogoPreset(storedId);
    if (found) {
      setPresetState(found);
    }
  }, []);

  const setPreset = useCallback((p: LogoPreset) => {
    setPresetState(p);
    storeLogoPresetId(p.id);
  }, []);

  const resetPreset = useCallback(() => {
    setPresetState(DEFAULT_LOGO_PRESET);
    storeLogoPresetId(DEFAULT_LOGO_PRESET.id);
  }, []);

  return (
    <LogoPresetContext.Provider value={{ preset, setPreset, resetPreset }}>
      {children}
    </LogoPresetContext.Provider>
  );
}

export function useLogoPreset() {
  return useContext(LogoPresetContext);
}
