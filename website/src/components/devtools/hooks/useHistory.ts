"use client";

import { useSelector } from "@directive-run/react";
import { useCallback } from "react";
import { useDevToolsSystem } from "../DevToolsSystemContext";

/**
 * Shared history hook — used by DrawerPanel (header arrows) and HistoryView.
 * Encapsulates undo/redo callbacks and reactive state selectors.
 */
export function useHistory() {
  const system = useDevToolsSystem();

  const historyEnabled = useSelector(
    system,
    (s) => s.facts.runtime.historyEnabled,
  );
  const snapshotIndex = useSelector(
    system,
    (s) => s.facts.runtime.snapshotIndex,
  );
  const snapshotCount = useSelector(
    system,
    (s) => s.facts.runtime.snapshotCount,
  );
  const canUndo = useSelector(system, (s) => s.derive.runtime.canUndo);
  const canRedo = useSelector(system, (s) => s.derive.runtime.canRedo);
  const systemName = useSelector(system, (s) => s.facts.runtime.systemName);

  const handleUndo = useCallback(() => {
    if (typeof window === "undefined" || !window.__DIRECTIVE__) {
      return;
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined);
    if (sys?.history?.goBack) {
      sys.history.goBack(1);
      system.events.runtime.refresh();
    }
  }, [system, systemName]);

  const handleRedo = useCallback(() => {
    if (typeof window === "undefined" || !window.__DIRECTIVE__) {
      return;
    }

    const sys = window.__DIRECTIVE__.getSystem(systemName ?? undefined);
    if (sys?.history?.goForward) {
      sys.history.goForward(1);
      system.events.runtime.refresh();
    }
  }, [system, systemName]);

  return {
    historyEnabled,
    snapshotIndex,
    snapshotCount,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
  };
}
