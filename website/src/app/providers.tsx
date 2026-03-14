"use client";

import { ThemeProvider } from "next-themes";

import { LogoPresetProvider } from "@/lib/LogoPresetContext";
import { ExperimentsProvider } from "@/lib/useExperiment";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      storageKey="directive-theme"
      disableTransitionOnChange
    >
      <ExperimentsProvider>
        <LogoPresetProvider>{children}</LogoPresetProvider>
      </ExperimentsProvider>
    </ThemeProvider>
  );
}
