/**
 * Devtools Plugin — Dependency graph and timeline SVG rendering
 *
 * Imported by devtools.ts; depends only on devtools-types.ts.
 */

import type { ModuleSchema, System } from "../core/types.js";
import {
  type DepGraph,
  FLOW,
  type PanelRefs,
  S,
  TIMELINE_BAR_MIN_W,
  TIMELINE_COLORS,
  TIMELINE_LABEL_W,
  TIMELINE_ROW_H,
  TIMELINE_SVG_W,
  type TimelineState,
  safeInspect,
  truncate,
} from "./devtools-types.js";

// ============================================================================
// Graph Node Cache — avoids full SVG teardown/rebuild when topology is stable
// ============================================================================

interface CachedNode {
  g: SVGGElement;
  rect: SVGRectElement;
  text: SVGTextElement;
}

interface GraphCache {
  fingerprint: string;
  nodes: Map<string, CachedNode>;
}

const graphCaches = new WeakMap<SVGSVGElement, GraphCache>();

/** Compute a topology fingerprint (excludes animation state, which changes every reconcile). */
function computeFingerprint(
  factKeys: string[],
  derivKeys: string[],
  constraints: Array<{ id: string; active: boolean }>,
  reqMap: Map<string, { type: string; status: string }>,
  resolverIds: string[],
  activeResolverIds: string[],
): string {
  return [
    factKeys.join(","),
    derivKeys.join(","),
    constraints.map((c) => `${c.id}:${c.active}`).join(","),
    [...reqMap.entries()]
      .map(([id, r]) => `${id}:${r.status}:${r.type}`)
      .join(","),
    resolverIds.join(","),
    activeResolverIds.join(","),
  ].join("|");
}

/** Update only animation attributes (pulsing) on cached node elements. */
function updateAnimationAttrs(
  cache: GraphCache,
  depGraph: DepGraph,
  factKeys: string[],
  derivKeys: string[],
  constraintIds: string[],
) {
  for (const key of factKeys) {
    const node = cache.nodes.get(`0:${key}`);
    if (!node) {
      continue;
    }
    const pulsing = depGraph.recentlyChangedFacts.has(key);
    node.rect.setAttribute("fill", pulsing ? S.text + "33" : "none");
    node.rect.setAttribute("stroke-width", pulsing ? "2" : "1");
  }
  for (const key of derivKeys) {
    const node = cache.nodes.get(`1:${key}`);
    if (!node) {
      continue;
    }
    const pulsing = depGraph.recentlyComputedDerivations.has(key);
    node.rect.setAttribute("fill", pulsing ? S.accent + "33" : "none");
    node.rect.setAttribute("stroke-width", pulsing ? "2" : "1");
  }
  for (const id of constraintIds) {
    const node = cache.nodes.get(`2:${id}`);
    if (!node) {
      continue;
    }
    const pulsing = depGraph.recentlyActiveConstraints.has(id);
    // Active constraints use S.yellow, inactive use S.muted — these are part of the fingerprint,
    // so the color is already correct. Only update pulsing fill and stroke-width.
    const color = node.rect.getAttribute("stroke") ?? S.muted;
    node.rect.setAttribute("fill", pulsing ? color + "33" : "none");
    node.rect.setAttribute("stroke-width", pulsing ? "2" : "1");
  }
}

// ============================================================================
// Full Dependency Graph (facts→derivations→constraints→reqs→resolvers)
// ============================================================================

/** @internal Rebuild the full dependency graph SVG from current system state. */
export function updateDependencyGraph(
  refs: PanelRefs,
  system: System<ModuleSchema>,
  depGraph: DepGraph,
) {
  const inspection = safeInspect(system);
  if (!inspection) {
    return;
  }

  // Collect all nodes
  let factKeys: string[];
  try {
    factKeys = Object.keys(system.facts.$store.toObject());
  } catch {
    factKeys = [];
  }
  const derivKeys = Object.keys(system.derive);
  const allConstraints = inspection.constraints;
  const unmetReqs = inspection.unmet;
  const inflightReqs = inspection.inflight;
  const resolverIds = Object.keys(inspection.resolvers);

  // Build requirement map
  const reqMap = new Map<
    string,
    { type: string; fromConstraint: string; status: string }
  >();
  for (const u of unmetReqs) {
    reqMap.set(u.id, {
      type: u.requirement.type,
      fromConstraint: u.fromConstraint,
      status: "unmet",
    });
  }
  for (const f of inflightReqs) {
    reqMap.set(f.id, {
      type: f.resolverId,
      fromConstraint: "",
      status: "inflight",
    });
  }

  // If nothing to show at all
  if (
    factKeys.length === 0 &&
    derivKeys.length === 0 &&
    allConstraints.length === 0 &&
    resolverIds.length === 0
  ) {
    graphCaches.delete(refs.flowSvg);
    refs.flowSvg.replaceChildren();
    refs.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "230");
    text.setAttribute("y", "24");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", S.muted);
    text.setAttribute("font-size", "10");
    text.setAttribute("font-family", S.font);
    text.textContent = "No system topology";
    refs.flowSvg.appendChild(text);

    return;
  }

  // Check fingerprint — skip full rebuild if topology unchanged
  const activeResolverIds = inflightReqs.map((f) => f.resolverId).sort();
  const fingerprint = computeFingerprint(
    factKeys,
    derivKeys,
    allConstraints,
    reqMap,
    resolverIds,
    activeResolverIds,
  );

  const existingCache = graphCaches.get(refs.flowSvg);
  if (existingCache && existingCache.fingerprint === fingerprint) {
    // Topology unchanged — only update pulsing animation attributes
    updateAnimationAttrs(
      existingCache,
      depGraph,
      factKeys,
      derivKeys,
      allConstraints.map((c) => c.id),
    );

    return;
  }

  // Full rebuild — topology changed
  const colW = FLOW.nodeW + FLOW.colGap;
  const colX: [number, number, number, number, number] = [
    5,
    5 + colW,
    5 + colW * 2,
    5 + colW * 3,
    5 + colW * 4,
  ];
  const totalW = colX[4] + FLOW.nodeW + 5;

  function layoutColumn<T>(items: T[]): Array<T & { y: number }> {
    let y = FLOW.startY + 12;

    return items.map((item) => {
      const node = { ...item, y };
      y += FLOW.nodeH + FLOW.nodeGap;

      return node;
    });
  }

  const factNodes = layoutColumn(
    factKeys.map((k) => ({ id: k, label: truncate(k, FLOW.labelMaxChars) })),
  );
  const derivNodes = layoutColumn(
    derivKeys.map((k) => ({ id: k, label: truncate(k, FLOW.labelMaxChars) })),
  );
  const constraintNodes = layoutColumn(
    allConstraints.map((c) => ({
      id: c.id,
      label: truncate(c.id, FLOW.labelMaxChars),
      active: c.active,
      priority: c.priority,
    })),
  );
  const reqNodeArr = layoutColumn(
    [...reqMap.entries()].map(([id, r]) => ({
      id,
      type: r.type,
      fromConstraint: r.fromConstraint,
      status: r.status,
    })),
  );
  const resolverNodeArr = layoutColumn(
    resolverIds.map((id) => ({ id, label: truncate(id, FLOW.labelMaxChars) })),
  );

  const maxRows = Math.max(
    factNodes.length,
    derivNodes.length,
    constraintNodes.length,
    reqNodeArr.length,
    resolverNodeArr.length,
    1,
  );
  const totalH = FLOW.startY + 12 + maxRows * (FLOW.nodeH + FLOW.nodeGap) + 8;

  refs.flowSvg.replaceChildren();
  refs.flowSvg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);

  refs.flowSvg.setAttribute(
    "aria-label",
    `Dependency graph: ${factKeys.length} facts, ${derivKeys.length} derivations, ` +
      `${allConstraints.length} constraints, ${reqMap.size} requirements, ${resolverIds.length} resolvers`,
  );

  // Draw column headers
  const headers = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [i, label] of headers.entries()) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(colX[i] ?? 0));
    text.setAttribute("y", "10");
    text.setAttribute("fill", S.accent);
    text.setAttribute("font-size", String(FLOW.fontSize));
    text.setAttribute("font-family", S.font);
    text.textContent = label;
    refs.flowSvg.appendChild(text);
  }

  // Cache for diff-based updates on subsequent calls
  const newCache: GraphCache = { fingerprint, nodes: new Map() };

  // SVG helpers
  function drawNode(
    col: number,
    x: number,
    cy: number,
    nodeId: string,
    label: string,
    color: string,
    dimmed: boolean,
    pulsing: boolean,
  ) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(cy - 6));
    rect.setAttribute("width", String(FLOW.nodeW));
    rect.setAttribute("height", String(FLOW.nodeH));
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", pulsing ? color + "33" : "none");
    rect.setAttribute("stroke", color);
    rect.setAttribute("stroke-width", pulsing ? "2" : "1");
    rect.setAttribute("opacity", dimmed ? "0.35" : "1");
    g.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x + 4));
    text.setAttribute("y", String(cy + 4));
    text.setAttribute("fill", color);
    text.setAttribute("font-size", String(FLOW.fontSize));
    text.setAttribute("font-family", S.font);
    text.setAttribute("opacity", dimmed ? "0.35" : "1");
    text.textContent = label;
    g.appendChild(text);

    refs.flowSvg.appendChild(g);

    // Cache node for animation-only updates
    newCache.nodes.set(`${col}:${nodeId}`, { g, rect, text });

    return { midX: x + FLOW.nodeW / 2, midY: cy };
  }

  function drawEdge(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    dimmed: boolean,
  ) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "3,2");
    line.setAttribute("opacity", dimmed ? "0.2" : "0.7");
    refs.flowSvg.appendChild(line);
  }

  // Position maps
  const factPositions = new Map<string, { midX: number; midY: number }>();
  const derivPositions = new Map<string, { midX: number; midY: number }>();
  const constraintPositions = new Map<string, { midX: number; midY: number }>();
  const reqPositions = new Map<string, { midX: number; midY: number }>();

  // Draw fact nodes
  for (const f of factNodes) {
    const pulsing = depGraph.recentlyChangedFacts.has(f.id);
    const pos = drawNode(
      0,
      colX[0],
      f.y,
      f.id,
      f.label,
      S.text,
      false,
      pulsing,
    );
    factPositions.set(f.id, pos);
  }

  // Draw derivation nodes
  for (const d of derivNodes) {
    const pulsing = depGraph.recentlyComputedDerivations.has(d.id);
    const pos = drawNode(
      1,
      colX[1],
      d.y,
      d.id,
      d.label,
      S.accent,
      false,
      pulsing,
    );
    derivPositions.set(d.id, pos);
  }

  // Draw constraint nodes (show ALL, dim inactive)
  for (const c of constraintNodes) {
    const pulsing = depGraph.recentlyActiveConstraints.has(c.id);
    const pos = drawNode(
      2,
      colX[2],
      c.y,
      c.id,
      c.label,
      c.active ? S.yellow : S.muted,
      !c.active,
      pulsing,
    );
    constraintPositions.set(c.id, pos);
  }

  // Draw requirement nodes
  for (const r of reqNodeArr) {
    const color = r.status === "unmet" ? S.red : S.yellow;
    const pos = drawNode(
      3,
      colX[3],
      r.y,
      r.id,
      truncate(r.type, FLOW.labelMaxChars),
      color,
      false,
      false,
    );
    reqPositions.set(r.id, pos);
  }

  // Draw resolver nodes (show ALL, dim idle)
  for (const r of resolverNodeArr) {
    const isActive = inflightReqs.some((f) => f.resolverId === r.id);
    drawNode(
      4,
      colX[4],
      r.y,
      r.id,
      r.label,
      isActive ? S.green : S.muted,
      !isActive,
      false,
    );
  }

  // Edges: fact → derivation (from tracked deps)
  for (const d of derivNodes) {
    const deps = depGraph.derivationDeps.get(d.id);
    const dPos = derivPositions.get(d.id);
    if (deps && dPos) {
      for (const dep of deps) {
        const fPos = factPositions.get(dep);
        if (fPos) {
          drawEdge(
            fPos.midX + FLOW.nodeW / 2,
            fPos.midY,
            dPos.midX - FLOW.nodeW / 2,
            dPos.midY,
            S.accent,
            false,
          );
        }
      }
    }
  }

  // Edges: constraint → requirement
  for (const r of reqNodeArr) {
    const cPos = constraintPositions.get(r.fromConstraint);
    const rPos = reqPositions.get(r.id);
    if (cPos && rPos) {
      drawEdge(
        cPos.midX + FLOW.nodeW / 2,
        cPos.midY,
        rPos.midX - FLOW.nodeW / 2,
        rPos.midY,
        S.muted,
        false,
      );
    }
  }

  // Edges: requirement → resolver (for inflight)
  for (const f of inflightReqs) {
    const rPos = reqPositions.get(f.id);
    if (rPos) {
      const rn = resolverNodeArr.find((n) => n.id === f.resolverId);
      if (rn) {
        drawEdge(
          rPos.midX + FLOW.nodeW / 2,
          rPos.midY,
          colX[4],
          rn.y,
          S.green,
          false,
        );
      }
    }
  }

  // Store cache for next call
  graphCaches.set(refs.flowSvg, newCache);
}

/** Clear animation highlights after a brief delay */
export function scheduleAnimationClear(depGraph: DepGraph) {
  if (depGraph.animationTimer) {
    clearTimeout(depGraph.animationTimer);
  }
  depGraph.animationTimer = setTimeout(() => {
    depGraph.recentlyChangedFacts.clear();
    depGraph.recentlyComputedDerivations.clear();
    depGraph.recentlyActiveConstraints.clear();
    depGraph.animationTimer = null;
  }, 600);
}

// ============================================================================
// Timeline/Flamechart Rendering
// ============================================================================

/** @internal Render the resolver execution timeline SVG. */
export function updateTimeline(refs: PanelRefs, timeline: TimelineState) {
  const entries = timeline.entries.toArray();
  if (entries.length === 0) {
    return;
  }

  refs.timelineSvg.replaceChildren();

  // Compute time range from visible entries
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    if (e.startMs < minMs) {
      minMs = e.startMs;
    }
    if (e.endMs > maxMs) {
      maxMs = e.endMs;
    }
  }
  // Also include inflight resolvers
  const now = performance.now();
  for (const startMs of timeline.inflight.values()) {
    if (startMs < minMs) {
      minMs = startMs;
    }
    if (now > maxMs) {
      maxMs = now;
    }
  }

  const range = maxMs - minMs || 1;
  const barAreaW = TIMELINE_SVG_W - TIMELINE_LABEL_W - 10;

  // Group entries by resolver for swim lanes
  const resolverOrder: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!seen.has(e.resolver)) {
      seen.add(e.resolver);
      resolverOrder.push(e.resolver);
    }
  }
  // Also add inflight resolvers not yet completed
  for (const resolver of timeline.inflight.keys()) {
    if (!seen.has(resolver)) {
      seen.add(resolver);
      resolverOrder.push(resolver);
    }
  }

  // Cap visible rows
  const maxRows = 12;
  const visibleResolvers = resolverOrder.slice(-maxRows);
  const totalH = TIMELINE_ROW_H * visibleResolvers.length + 20;
  refs.timelineSvg.setAttribute("viewBox", `0 0 ${TIMELINE_SVG_W} ${totalH}`);
  refs.timelineSvg.setAttribute("height", String(Math.min(totalH, 200)));

  // Column header: time axis markers
  const markers = 5;
  for (let i = 0; i <= markers; i++) {
    const x = TIMELINE_LABEL_W + (barAreaW * i) / markers;
    const ms = (range * i) / markers;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", "8");
    text.setAttribute("fill", S.muted);
    text.setAttribute("font-size", "6");
    text.setAttribute("font-family", S.font);
    text.setAttribute("text-anchor", "middle");
    text.textContent =
      ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
    refs.timelineSvg.appendChild(text);

    // Gridline
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x));
    line.setAttribute("y1", "10");
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(totalH));
    line.setAttribute("stroke", S.border);
    line.setAttribute("stroke-width", "0.5");
    refs.timelineSvg.appendChild(line);
  }

  // Draw swim lanes
  for (let row = 0; row < visibleResolvers.length; row++) {
    const resolver = visibleResolvers[row]!;
    const y = 12 + row * TIMELINE_ROW_H;
    const colorIdx = row % TIMELINE_COLORS.length;
    const color = TIMELINE_COLORS[colorIdx]!;

    // Label
    const label = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text",
    );
    label.setAttribute("x", String(TIMELINE_LABEL_W - 4));
    label.setAttribute("y", String(y + TIMELINE_ROW_H / 2 + 3));
    label.setAttribute("fill", S.muted);
    label.setAttribute("font-size", "7");
    label.setAttribute("font-family", S.font);
    label.setAttribute("text-anchor", "end");
    label.textContent = truncate(resolver, 12);
    refs.timelineSvg.appendChild(label);

    // Draw bars for this resolver
    const resolverEntries = entries.filter((e) => e.resolver === resolver);
    for (const entry of resolverEntries) {
      const x = TIMELINE_LABEL_W + ((entry.startMs - minMs) / range) * barAreaW;
      const w = Math.max(
        ((entry.endMs - entry.startMs) / range) * barAreaW,
        TIMELINE_BAR_MIN_W,
      );

      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y + 2));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(TIMELINE_ROW_H - 4));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", entry.error ? S.red : color);
      rect.setAttribute("opacity", "0.8");

      // Tooltip: duration
      const title = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      const durationMs = entry.endMs - entry.startMs;
      title.textContent = `${resolver}: ${durationMs.toFixed(1)}ms${entry.error ? " (error)" : ""}`;
      rect.appendChild(title);

      refs.timelineSvg.appendChild(rect);
    }

    // Draw inflight bar (animated, extending to "now")
    const inflightStart = timeline.inflight.get(resolver);
    if (inflightStart !== undefined) {
      const x = TIMELINE_LABEL_W + ((inflightStart - minMs) / range) * barAreaW;
      const w = Math.max(
        ((now - inflightStart) / range) * barAreaW,
        TIMELINE_BAR_MIN_W,
      );

      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y + 2));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(TIMELINE_ROW_H - 4));
      rect.setAttribute("rx", "2");
      rect.setAttribute("fill", color);
      rect.setAttribute("opacity", "0.4");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("stroke-dasharray", "3,2");

      const title = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      title.textContent = `${resolver}: inflight ${(now - inflightStart).toFixed(0)}ms`;
      rect.appendChild(title);

      refs.timelineSvg.appendChild(rect);
    }
  }

  // Update aria-label
  refs.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${entries.length} resolver executions across ${visibleResolvers.length} resolvers`,
  );
}
