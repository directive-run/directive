/**
 * Devtools Plugin — Floating panel creation and DOM update helpers
 *
 * All DOM manipulation for the debug panel lives here.
 * Imported by devtools.ts; depends only on devtools-types.ts.
 */

import type { ModuleSchema, System } from "../core/types.js";
import {
  type DevtoolsPluginOptions,
  MAX_PANEL_EVENTS,
  type PanelRefs,
  type PerfMetrics,
  S,
  TIMELINE_SVG_W,
  formatValue,
  truncate,
} from "./devtools-types.js";

// ============================================================================
// Panel Creation
// ============================================================================

export function createPanel(
  systemName: string,
  position: NonNullable<DevtoolsPluginOptions["position"]>,
  defaultOpen: boolean,
  showEvents: boolean,
): {
  refs: PanelRefs;
  destroy: () => void;
  isOpen: () => boolean;
  flashTimers: Set<ReturnType<typeof setTimeout>>;
} {
  let destroyed = false;
  const posStyles: Record<string, string> = {
    position: "fixed",
    zIndex: "99999",
    ...(position.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
    ...(position.includes("right") ? { right: "12px" } : { left: "12px" }),
  };

  // Inject focus-visible styles (E3)
  const styleEl = document.createElement("style");
  styleEl.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${S.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${S.accent};outline-offset:2px}`;
  document.head.appendChild(styleEl);

  // Toggle button — 44x44px minimum touch target
  const toggleBtn = document.createElement("button");
  toggleBtn.setAttribute("aria-label", "Open Directive DevTools");
  toggleBtn.setAttribute("aria-expanded", String(defaultOpen));
  toggleBtn.title = "Ctrl+Shift+D to toggle";
  Object.assign(toggleBtn.style, {
    ...posStyles,
    background: S.bg,
    color: S.text,
    border: `1px solid ${S.border}`,
    borderRadius: "6px",
    padding: "10px 14px",
    minWidth: "44px",
    minHeight: "44px",
    cursor: "pointer",
    fontFamily: S.font,
    fontSize: "12px",
    display: defaultOpen ? "none" : "block",
  });
  toggleBtn.textContent = "Directive";

  // Container — responsive sizing
  const container = document.createElement("div");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Directive DevTools");
  container.setAttribute("data-directive-devtools", "");
  container.tabIndex = -1;
  Object.assign(container.style, {
    ...posStyles,
    background: S.bg,
    color: S.text,
    border: `1px solid ${S.border}`,
    borderRadius: "8px",
    padding: "12px",
    fontFamily: S.font,
    fontSize: "11px",
    maxWidth: "min(380px, calc(100vw - 24px))",
    maxHeight: "min(500px, calc(100vh - 24px))",
    overflow: "auto",
    boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
    display: defaultOpen ? "block" : "none",
  });

  // Header
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const titleEl = document.createElement("strong");
  titleEl.style.color = S.accent;
  titleEl.textContent =
    systemName === "default"
      ? "Directive DevTools"
      : `DevTools (${systemName})`;
  const closeBtn = document.createElement("button");
  closeBtn.setAttribute("aria-label", "Close DevTools");
  Object.assign(closeBtn.style, {
    background: "none",
    border: "none",
    color: S.closeBtn,
    cursor: "pointer",
    fontSize: "16px",
    padding: "8px 12px",
    minWidth: "44px",
    minHeight: "44px",
    lineHeight: "1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  closeBtn.textContent = "\u00D7";
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  container.appendChild(header);

  // Status
  const statusRow = document.createElement("div");
  statusRow.style.marginBottom = "6px";
  statusRow.setAttribute("aria-live", "polite");
  const statusEl = document.createElement("span");
  statusEl.style.color = S.green;
  statusEl.textContent = "Settled";
  statusRow.appendChild(statusEl);
  container.appendChild(statusRow);

  // Time-travel controls — 44px touch targets (M6)
  const timeTravelSection = document.createElement("div");
  Object.assign(timeTravelSection.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const undoBtn = document.createElement("button");
  Object.assign(undoBtn.style, {
    background: "none",
    border: `1px solid ${S.border}`,
    color: S.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: S.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  });
  undoBtn.textContent = "\u25C0 Undo";
  undoBtn.disabled = true;
  const redoBtn = document.createElement("button");
  Object.assign(redoBtn.style, {
    background: "none",
    border: `1px solid ${S.border}`,
    color: S.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: S.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  });
  redoBtn.textContent = "Redo \u25B6";
  redoBtn.disabled = true;
  const timeTravelLabel = document.createElement("span");
  timeTravelLabel.style.color = S.muted;
  timeTravelLabel.style.fontSize = "10px";
  timeTravelSection.appendChild(undoBtn);
  timeTravelSection.appendChild(redoBtn);
  timeTravelSection.appendChild(timeTravelLabel);
  container.appendChild(timeTravelSection);

  // Helper: create table section
  function createTableSection(label: string, open: boolean) {
    const details = document.createElement("details");
    if (open) {
      details.open = true;
    }
    details.style.marginBottom = "4px";
    const summary = document.createElement("summary");
    Object.assign(summary.style, {
      cursor: "pointer",
      color: S.accent,
      marginBottom: "4px",
    });
    const countSpan = document.createElement("span");
    summary.textContent = `${label} (`;
    summary.appendChild(countSpan);
    summary.appendChild(document.createTextNode(")"));
    countSpan.textContent = "0";
    details.appendChild(summary);

    const table = document.createElement("table");
    Object.assign(table.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of ["Key", "Value"]) {
      const th = document.createElement("th");
      th.scope = "col";
      Object.assign(th.style, {
        textAlign: "left",
        padding: "2px 4px",
        color: S.accent,
      });
      th.textContent = col;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    details.appendChild(table);

    return { details, tbody, countSpan };
  }

  // Helper: create list section with empty state
  function createListSection(label: string, color: string) {
    const details = document.createElement("details");
    details.style.marginBottom = "4px";
    const summary = document.createElement("summary");
    Object.assign(summary.style, {
      cursor: "pointer",
      color,
      marginBottom: "4px",
    });
    const countSpan = document.createElement("span");
    summary.textContent = `${label} (`;
    summary.appendChild(countSpan);
    summary.appendChild(document.createTextNode(")"));
    countSpan.textContent = "0";
    details.appendChild(summary);
    const list = document.createElement("ul");
    Object.assign(list.style, { margin: "0", paddingLeft: "16px" });
    details.appendChild(list);

    return { details, list, countSpan };
  }

  // Facts section
  const factsSection = createTableSection("Facts", true);
  container.appendChild(factsSection.details);

  // Derivations section (always visible, shows empty state E1)
  const derivSection = createTableSection("Derivations", false);
  container.appendChild(derivSection.details);

  // Inflight section
  const inflightSection = createListSection("Inflight", S.yellow);
  container.appendChild(inflightSection.details);

  // Unmet section
  const unmetSection = createListSection("Unmet", S.red);
  container.appendChild(unmetSection.details);

  // Performance section
  const perfDetails = document.createElement("details");
  perfDetails.style.marginBottom = "4px";
  const perfSummary = document.createElement("summary");
  Object.assign(perfSummary.style, {
    cursor: "pointer",
    color: S.accent,
    marginBottom: "4px",
  });
  perfSummary.textContent = "Performance";
  perfDetails.appendChild(perfSummary);
  const perfBody = document.createElement("div");
  perfBody.style.fontSize = "10px";
  perfBody.style.color = S.muted;
  perfBody.textContent = "No data yet";
  perfDetails.appendChild(perfBody);
  container.appendChild(perfDetails);

  // Flow diagram section (I2: full dependency graph)
  const flowDetails = document.createElement("details");
  flowDetails.style.marginBottom = "4px";
  const flowSummary = document.createElement("summary");
  Object.assign(flowSummary.style, {
    cursor: "pointer",
    color: S.accent,
    marginBottom: "4px",
  });
  flowSummary.textContent = "Dependency Graph";
  flowDetails.appendChild(flowSummary);
  const flowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  flowSvg.setAttribute("width", "100%");
  flowSvg.setAttribute("height", "120");
  flowSvg.setAttribute("role", "img");
  flowSvg.setAttribute("aria-label", "System dependency graph");
  flowSvg.style.display = "block";
  // E7: Responsive — use viewBox so SVG scales
  flowSvg.setAttribute("viewBox", "0 0 460 120");
  flowSvg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  flowDetails.appendChild(flowSvg);
  container.appendChild(flowDetails);

  // I1: Timeline/Flamechart section
  const timelineDetails = document.createElement("details");
  timelineDetails.style.marginBottom = "4px";
  const timelineSummary = document.createElement("summary");
  Object.assign(timelineSummary.style, {
    cursor: "pointer",
    color: S.accent,
    marginBottom: "4px",
  });
  timelineSummary.textContent = "Timeline";
  timelineDetails.appendChild(timelineSummary);
  const timelineSvg = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  timelineSvg.setAttribute("width", "100%");
  timelineSvg.setAttribute("height", "60");
  timelineSvg.setAttribute("role", "img");
  timelineSvg.setAttribute("aria-label", "Resolver execution timeline");
  timelineSvg.style.display = "block";
  timelineSvg.setAttribute("viewBox", `0 0 ${TIMELINE_SVG_W} 60`);
  timelineSvg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const timelineEmpty = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "text",
  );
  timelineEmpty.setAttribute("x", String(TIMELINE_SVG_W / 2));
  timelineEmpty.setAttribute("y", "30");
  timelineEmpty.setAttribute("text-anchor", "middle");
  timelineEmpty.setAttribute("fill", S.muted);
  timelineEmpty.setAttribute("font-size", "10");
  timelineEmpty.setAttribute("font-family", S.font);
  timelineEmpty.textContent = "No resolver activity yet";
  timelineSvg.appendChild(timelineEmpty);
  timelineDetails.appendChild(timelineSvg);
  container.appendChild(timelineDetails);

  // Events section
  let eventsSection: HTMLDetailsElement;
  let eventsList: HTMLDivElement;
  let eventsCount: HTMLSpanElement;
  let traceHint: HTMLDivElement;

  if (showEvents) {
    const evDetails = document.createElement("details");
    evDetails.style.marginBottom = "4px";
    const evSummary = document.createElement("summary");
    Object.assign(evSummary.style, {
      cursor: "pointer",
      color: S.accent,
      marginBottom: "4px",
    });
    eventsCount = document.createElement("span");
    eventsCount.textContent = "0";
    evSummary.textContent = "Events (";
    evSummary.appendChild(eventsCount);
    evSummary.appendChild(document.createTextNode(")"));
    evDetails.appendChild(evSummary);
    eventsList = document.createElement("div");
    Object.assign(eventsList.style, {
      maxHeight: "150px",
      overflow: "auto",
      fontSize: "10px",
    });
    eventsList.setAttribute("role", "log");
    eventsList.setAttribute("aria-live", "polite");
    eventsList.tabIndex = 0;
    // E2: Empty state for events
    const waitingMsg = document.createElement("div");
    waitingMsg.style.color = S.muted;
    waitingMsg.style.padding = "4px";
    waitingMsg.textContent = "Waiting for events...";
    waitingMsg.className = "dt-events-empty";
    eventsList.appendChild(waitingMsg);
    evDetails.appendChild(eventsList);
    container.appendChild(evDetails);
    eventsSection = evDetails;
    traceHint = document.createElement("div");
  } else {
    eventsSection = document.createElement("details");
    eventsList = document.createElement("div");
    eventsCount = document.createElement("span");
    // E13: Trace hint when trace is off
    traceHint = document.createElement("div");
    traceHint.style.fontSize = "10px";
    traceHint.style.color = S.muted;
    traceHint.style.marginTop = "4px";
    traceHint.style.fontStyle = "italic";
    traceHint.textContent = "Enable trace: true for event log";
    container.appendChild(traceHint);
  }

  // Record & export buttons (I3)
  const recordRow = document.createElement("div");
  Object.assign(recordRow.style, {
    display: "flex",
    gap: "6px",
    marginTop: "6px",
  });
  const recordBtn = document.createElement("button");
  Object.assign(recordBtn.style, {
    background: "none",
    border: `1px solid ${S.border}`,
    color: S.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: S.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  });
  recordBtn.textContent = "\u23FA Record";
  const exportBtn = document.createElement("button");
  Object.assign(exportBtn.style, {
    background: "none",
    border: `1px solid ${S.border}`,
    color: S.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: S.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  });
  exportBtn.textContent = "\u2913 Export";
  recordRow.appendChild(recordBtn);
  recordRow.appendChild(exportBtn);
  container.appendChild(recordRow);

  // E4: Scroll isolation — prevent page scroll when scrolling within panel
  container.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      const el = container;
      const atTop = el.scrollTop === 0 && e.deltaY < 0;
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
      if (atTop || atBottom) {
        e.preventDefault();
      }
    },
    { passive: false },
  );

  // Open/close logic
  let panelOpen = defaultOpen;
  const flashTimers = new Set<ReturnType<typeof setTimeout>>();

  function open() {
    panelOpen = true;
    container.style.display = "block";
    toggleBtn.style.display = "none";
    toggleBtn.setAttribute("aria-expanded", "true");
    closeBtn.focus();
  }

  function close() {
    panelOpen = false;
    container.style.display = "none";
    toggleBtn.style.display = "block";
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.focus();
  }

  toggleBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && panelOpen) {
      close();
    }
  }
  container.addEventListener("keydown", onKeyDown);

  // Global keyboard shortcut Ctrl+Shift+D / Cmd+Shift+D
  function onGlobalKeyDown(e: KeyboardEvent) {
    if (e.key === "d" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (panelOpen) {
        close();
      } else {
        open();
      }
    }
  }
  document.addEventListener("keydown", onGlobalKeyDown);

  // Mount — guard document.body (M1)
  function mount() {
    if (destroyed) {
      return;
    }
    document.body.appendChild(toggleBtn);
    document.body.appendChild(container);
  }

  if (document.body) {
    mount();
  } else {
    // Store reference for cleanup
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }

  function destroy() {
    destroyed = true;
    toggleBtn.removeEventListener("click", open);
    closeBtn.removeEventListener("click", close);
    container.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keydown", onGlobalKeyDown);
    // Clean up DOMContentLoaded listener in case body wasn't ready
    document.removeEventListener("DOMContentLoaded", mount);
    for (const id of flashTimers) {
      clearTimeout(id);
    }
    flashTimers.clear();
    toggleBtn.remove();
    container.remove();
    styleEl.remove();
  }

  return {
    refs: {
      container,
      toggleBtn,
      titleEl,
      statusEl,
      factsBody: factsSection.tbody,
      factsCount: factsSection.countSpan,
      derivBody: derivSection.tbody,
      derivCount: derivSection.countSpan,
      derivSection: derivSection.details,
      inflightList: inflightSection.list,
      inflightSection: inflightSection.details,
      inflightCount: inflightSection.countSpan,
      unmetList: unmetSection.list,
      unmetSection: unmetSection.details,
      unmetCount: unmetSection.countSpan,
      perfSection: perfDetails,
      perfBody,
      timeTravelSection,
      timeTravelLabel,
      undoBtn,
      redoBtn,
      flowSection: flowDetails,
      flowSvg,
      timelineSection: timelineDetails,
      timelineSvg,
      eventsSection,
      eventsList,
      eventsCount,
      traceHint,
      recordBtn,
      exportBtn,
    },
    destroy,
    isOpen: () => panelOpen,
    flashTimers,
  };
}

// ============================================================================
// Panel Update Helpers
// ============================================================================

/** Upsert a key/value row in a table. Returns true if the row was new. */
export function upsertTableRow(
  rowMap: Map<string, HTMLTableRowElement>,
  tbody: HTMLTableSectionElement,
  key: string,
  value: unknown,
  flash: boolean,
  flashTimers?: Set<ReturnType<typeof setTimeout>>,
) {
  const display = formatValue(value);
  let row = rowMap.get(key);

  if (row) {
    const cells = row.cells;
    if (cells[1]) {
      cells[1].textContent = display;
      if (flash && flashTimers) {
        const cell = cells[1];
        cell.style.background = "rgba(139, 154, 255, 0.25)";
        const tid = setTimeout(() => {
          cell.style.background = "";
          flashTimers.delete(tid);
        }, 300);
        flashTimers.add(tid);
      }
    }
  } else {
    row = document.createElement("tr");
    row.style.borderBottom = `1px solid ${S.rowBorder}`;
    const keyCell = document.createElement("td");
    Object.assign(keyCell.style, { padding: "2px 4px", color: S.muted });
    keyCell.textContent = key;
    const valCell = document.createElement("td");
    valCell.style.padding = "2px 4px";
    valCell.textContent = display;
    row.appendChild(keyCell);
    row.appendChild(valCell);
    tbody.appendChild(row);
    rowMap.set(key, row);
  }
}

export function removeTableRow(
  rowMap: Map<string, HTMLTableRowElement>,
  key: string,
) {
  const row = rowMap.get(key);
  if (row) {
    row.remove();
    rowMap.delete(key);
  }
}

/** Render inflight + unmet requirement lists */
export function renderRequirements(
  refs: PanelRefs,
  inflight: Array<{ id: string; resolverId: string; startedAt: number }>,
  unmet: Array<{
    id: string;
    requirement: { type: string };
    fromConstraint: string;
  }>,
) {
  refs.inflightList.replaceChildren();
  refs.inflightCount.textContent = String(inflight.length);
  if (inflight.length > 0) {
    for (const r of inflight) {
      const li = document.createElement("li");
      li.style.fontSize = "11px";
      li.textContent = `${r.resolverId} (${r.id})`;
      refs.inflightList.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.style.fontSize = "10px";
    li.style.color = S.muted;
    li.textContent = "None";
    refs.inflightList.appendChild(li);
  }

  refs.unmetList.replaceChildren();
  refs.unmetCount.textContent = String(unmet.length);
  if (unmet.length > 0) {
    for (const r of unmet) {
      const li = document.createElement("li");
      li.style.fontSize = "11px";
      li.textContent = `${r.requirement.type} from ${r.fromConstraint}`;
      refs.unmetList.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.style.fontSize = "10px";
    li.style.color = S.muted;
    li.textContent = "None";
    refs.unmetList.appendChild(li);
  }
}

/** Render status indicator */
export function renderStatus(
  refs: PanelRefs,
  inflightCount: number,
  unmetCount: number,
) {
  const isSettled = inflightCount === 0 && unmetCount === 0;
  refs.statusEl.style.color = isSettled ? S.green : S.yellow;
  refs.statusEl.textContent = isSettled ? "Settled" : "Working...";
  refs.toggleBtn.textContent = isSettled ? "Directive" : "Directive...";
  refs.toggleBtn.setAttribute(
    "aria-label",
    `Open Directive DevTools${isSettled ? "" : " (system working)"}`,
  );
}

export function updateDerivations(
  refs: PanelRefs,
  derivRowMap: Map<string, HTMLTableRowElement>,
  system: System<ModuleSchema>,
  flashTimers?: Set<ReturnType<typeof setTimeout>>,
) {
  const derivationKeys = Object.keys(system.derive);
  refs.derivCount.textContent = String(derivationKeys.length);

  // E1: Show empty state instead of hiding
  if (derivationKeys.length === 0) {
    derivRowMap.clear();
    refs.derivBody.replaceChildren();
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    cell.style.color = S.muted;
    cell.style.fontSize = "10px";
    cell.textContent = "No derivations defined";
    row.appendChild(cell);
    refs.derivBody.appendChild(row);

    return;
  }

  // Remove stale rows (E6: use Set for O(1) lookup)
  const keySet = new Set(derivationKeys);
  for (const [key, row] of derivRowMap) {
    if (!keySet.has(key)) {
      row.remove();
      derivRowMap.delete(key);
    }
  }

  // Update/add rows (E5: flash on derivation change)
  for (const key of derivationKeys) {
    let display: string;
    try {
      display = formatValue(system.read(key));
    } catch {
      display = "<error>";
    }
    upsertTableRow(
      derivRowMap,
      refs.derivBody,
      key,
      display,
      true,
      flashTimers,
    );
  }
}

// Safe event row creation — textContent only, no innerHTML
export function addEventRow(
  refs: PanelRefs,
  type: string,
  data: unknown,
  eventCount: number,
) {
  // Clear "Waiting for events..." placeholder on first event
  const empty = refs.eventsList.querySelector(".dt-events-empty");
  if (empty) {
    empty.remove();
  }

  const row = document.createElement("div");
  Object.assign(row.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${S.rowBorder}`,
    fontFamily: "inherit",
  });
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(now.getMilliseconds()).padStart(3, "0")}`;

  let preview: string;
  try {
    const str = JSON.stringify(data);
    preview = truncate(str, 60);
  } catch {
    preview = "{}";
  }

  const timeSpan = document.createElement("span");
  timeSpan.style.color = S.closeBtn;
  timeSpan.textContent = time;

  const typeSpan = document.createElement("span");
  typeSpan.style.color = S.accent;
  typeSpan.textContent = ` ${type} `;

  const previewSpan = document.createElement("span");
  previewSpan.style.color = S.muted;
  previewSpan.textContent = preview;

  row.appendChild(timeSpan);
  row.appendChild(typeSpan);
  row.appendChild(previewSpan);

  refs.eventsList.prepend(row);

  // Cap visible events
  while (refs.eventsList.childElementCount > MAX_PANEL_EVENTS) {
    refs.eventsList.lastElementChild?.remove();
  }

  refs.eventsCount.textContent = String(eventCount);
}

export function updatePerfSection(refs: PanelRefs, perf: PerfMetrics) {
  refs.perfBody.replaceChildren();

  const avgReconcile =
    perf.reconcileCount > 0
      ? (perf.reconcileTotalMs / perf.reconcileCount).toFixed(1)
      : "\u2014";

  const lines: string[] = [
    `Reconciles: ${perf.reconcileCount}  (avg ${avgReconcile}ms)`,
    `Effects: ${perf.effectRunCount} run, ${perf.effectErrorCount} errors`,
  ];

  for (const line of lines) {
    const div = document.createElement("div");
    div.style.marginBottom = "2px";
    div.textContent = line;
    refs.perfBody.appendChild(div);
  }

  if (perf.resolverStats.size > 0) {
    const resolverHeader = document.createElement("div");
    resolverHeader.style.marginTop = "4px";
    resolverHeader.style.marginBottom = "2px";
    resolverHeader.style.color = S.accent;
    resolverHeader.textContent = "Resolvers:";
    refs.perfBody.appendChild(resolverHeader);

    const sorted = [...perf.resolverStats.entries()].sort(
      (a, b) => b[1].totalMs - a[1].totalMs,
    );
    for (const [id, stats] of sorted) {
      const avg =
        stats.count > 0 ? (stats.totalMs / stats.count).toFixed(1) : "0";
      const div = document.createElement("div");
      div.style.paddingLeft = "8px";
      div.textContent = `${id}: ${stats.count}x, avg ${avg}ms${stats.errors > 0 ? `, ${stats.errors} err` : ""}`;
      if (stats.errors > 0) {
        div.style.color = S.red;
      }
      refs.perfBody.appendChild(div);
    }
  }
}

export function updateTimeTravelControls(
  refs: PanelRefs,
  system: System<ModuleSchema>,
) {
  const tt = system.debug;
  if (!tt) {
    refs.timeTravelSection.style.display = "none";

    return;
  }
  refs.timeTravelSection.style.display = "flex";

  const current = tt.currentIndex;
  const total = tt.snapshots.length;
  refs.timeTravelLabel.textContent =
    total > 0 ? `${current + 1} / ${total}` : "0 snapshots";

  const canUndo = current > 0;
  const canRedo = current < total - 1;
  refs.undoBtn.disabled = !canUndo;
  refs.undoBtn.style.opacity = canUndo ? "1" : "0.4";
  refs.redoBtn.disabled = !canRedo;
  refs.redoBtn.style.opacity = canRedo ? "1" : "0.4";
}

export function setupTimeTravelButtons(
  refs: PanelRefs,
  system: System<ModuleSchema>,
) {
  refs.undoBtn.addEventListener("click", () => {
    if (system.debug && system.debug.currentIndex > 0) {
      system.debug.goBack(1);
    }
  });
  refs.redoBtn.addEventListener("click", () => {
    if (
      system.debug &&
      system.debug.currentIndex < system.debug.snapshots.length - 1
    ) {
      system.debug.goForward(1);
    }
  });
}
