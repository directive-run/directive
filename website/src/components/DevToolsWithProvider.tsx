"use client";

import { FloatingDevTools } from "@/components/FloatingDevTools";
import {
  DevToolsProvider,
  type DevToolsProviderProps,
} from "@/components/devtools/DevToolsProvider";

type DevToolsWithProviderProps = DevToolsProviderProps;

export function DevToolsWithProvider(props: DevToolsWithProviderProps) {
  const { children, ...providerProps } = props;

  return (
    <DevToolsProvider {...providerProps}>
      {children}
      <FloatingDevTools />
    </DevToolsProvider>
  );
}
