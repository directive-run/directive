/**
 * Devtools Plugin — Shared types, constants, and utility functions
 *
 * This module is the leaf dependency for the devtools plugin.
 * It contains no DOM code and no side effects.
 */

import type { ModuleSchema, System } from "../core/types.js";

// ============================================================================
// Options
// ============================================================================

export interface DevtoolsPluginOptions {
	/** Name for this system in devtools */
	name?: string;
	/** Enable trace logging */
	trace?: boolean;
	/** Maximum number of trace events to retain (default: 1000) */
	maxEvents?: number;
	/** Show floating debug panel (dev mode only, requires browser) */
	panel?: boolean;
	/** Panel position */
	position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
	/** Start panel open */
	defaultOpen?: boolean;
}

// ============================================================================
// Circular Buffer — O(1) push with bounded capacity
// ============================================================================

export interface TraceEvent {
	timestamp: number;
	type: string;
	data: unknown;
}

export class CircularBuffer<T> {
	private buf: (T | undefined)[];
	private head = 0;
	private _size = 0;

	constructor(private capacity: number) {
		this.buf = new Array(capacity);
	}

	get size() {
		return this._size;
	}

	push(item: T) {
		this.buf[this.head] = item;
		this.head = (this.head + 1) % this.capacity;
		if (this._size < this.capacity) {
			this._size++;
		}
	}

	toArray(): T[] {
		if (this._size === 0) {
			return [];
		}
		if (this._size < this.capacity) {
			return this.buf.slice(0, this._size) as T[];
		}

		return [
			...(this.buf.slice(this.head) as T[]),
			...(this.buf.slice(0, this.head) as T[]),
		];
	}

	clear() {
		this.buf = new Array(this.capacity);
		this.head = 0;
		this._size = 0;
	}
}

// ============================================================================
// Subscriber
// ============================================================================

export type DevtoolsSubscriber = (event: TraceEvent) => void;

// ============================================================================
// Devtools State
// ============================================================================

export interface DevtoolsState {
	system: System<ModuleSchema> | null;
	events: CircularBuffer<TraceEvent>;
	maxEvents: number;
	subscribers: Set<DevtoolsSubscriber>;
}

declare global {
	interface Window {
		__DIRECTIVE__?: {
			systems: Map<string, DevtoolsState>;
			getSystem(name?: string): System<ModuleSchema> | null;
			getSystems(): string[];
			inspect(name?: string): unknown;
			getEvents(name?: string): TraceEvent[];
			explain(requirementId: string, name?: string): string | null;
			exportSession(name?: string): string | null;
			importSession(json: string, name?: string): boolean;
			clearEvents(name?: string): void;
			/** Subscribe to trace events. Returns unsubscribe function. */
			subscribe(callback: DevtoolsSubscriber, systemName?: string): () => void;
		};
	}
}

// ============================================================================
// Shared Helpers
// ============================================================================

/** Safe check for dev mode. Returns false when process is unavailable. */
export function isDevMode(): boolean {
	try {
		if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
			return false;
		}
	} catch {
		// process not available
	}
	try {
		// @ts-expect-error — import.meta.env is Vite-specific
		if (typeof import.meta !== "undefined" && import.meta.env?.MODE === "production") {
			return false;
		}
	} catch {
		// import.meta.env not available
	}
	return true;
}

export function formatValue(value: unknown): string {
	try {
		if (value === undefined) {
			return "undefined";
		}
		if (value === null) {
			return "null";
		}
		if (typeof value === "bigint") {
			return String(value) + "n";
		}
		if (typeof value === "symbol") {
			return String(value);
		}
		if (typeof value === "object") {
			const str = JSON.stringify(value, (_k, v) => {
				if (typeof v === "bigint") {
					return String(v) + "n";
				}
				if (typeof v === "symbol") {
					return String(v);
				}

				return v;
			});

			return str.length > 120 ? str.slice(0, 117) + "..." : str;
		}

		return String(value);
	} catch {
		return "<error>";
	}
}

export function truncate(str: string, max: number): string {
	if (str.length <= max) {
		return str;
	}

	return str.slice(0, max - 3) + "...";
}

export function safeInspect(system: System<ModuleSchema>) {
	try {
		return system.inspect();
	} catch {
		return null;
	}
}

/** E15: Deep-clone event data via JSON round-trip to prevent reference sharing */
export function cloneViaJSON(data: unknown): unknown {
	try {
		if (data === null || data === undefined || typeof data !== "object") {
			return data;
		}

		return JSON.parse(JSON.stringify(data));
	} catch {
		return null;
	}
}

/** M7: Validate maxEvents — floor at 1, default 1000 */
export function validateMaxEvents(value: number | undefined): number {
	if (value === undefined) {
		return 1000;
	}
	if (!Number.isFinite(value) || value < 1) {
		if (isDevMode()) {
			console.warn(`[directive:devtools] Invalid maxEvents value (${value}), using default 1000`);
		}

		return 1000;
	}

	return Math.floor(value);
}

// ============================================================================
// Performance Metrics
// ============================================================================

export interface PerfMetrics {
	reconcileCount: number;
	reconcileTotalMs: number;
	resolverStats: Map<string, { count: number; totalMs: number; errors: number }>;
	effectRunCount: number;
	effectErrorCount: number;
	lastReconcileStartMs: number;
}

export function createPerfMetrics(): PerfMetrics {
	return {
		reconcileCount: 0,
		reconcileTotalMs: 0,
		resolverStats: new Map(),
		effectRunCount: 0,
		effectErrorCount: 0,
		lastReconcileStartMs: 0,
	};
}

// ============================================================================
// Timeline/Flamechart
// ============================================================================

export const MAX_TIMELINE_ENTRIES = 200;
export const TIMELINE_SVG_W = 340;
export const TIMELINE_ROW_H = 16;
export const TIMELINE_LABEL_W = 80;
export const TIMELINE_BAR_MIN_W = 2;
export const TIMELINE_COLORS = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"] as const;

export interface TimelineEntry {
	resolver: string;
	startMs: number;
	endMs: number;
	error: boolean;
}

export interface TimelineState {
	entries: CircularBuffer<TimelineEntry>;
	/** Map of resolver → startMs for inflight resolvers */
	inflight: Map<string, number>;
}

export function createTimelineState(): TimelineState {
	return {
		entries: new CircularBuffer<TimelineEntry>(MAX_TIMELINE_ENTRIES),
		inflight: new Map(),
	};
}

// ============================================================================
// Dependency Graph Tracking
// ============================================================================

export interface DepGraph {
	/** derivation ID → fact keys it depends on */
	derivationDeps: Map<string, string[]>;
	/** currently active constraint IDs */
	activeConstraints: Set<string>;
	/** set of fact keys that recently changed (for animation) */
	recentlyChangedFacts: Set<string>;
	/** set of derivation IDs that recently recomputed */
	recentlyComputedDerivations: Set<string>;
	/** set of constraint IDs that recently evaluated to active */
	recentlyActiveConstraints: Set<string>;
	/** animation clear timer */
	animationTimer: ReturnType<typeof setTimeout> | null;
}

export function createDepGraph(): DepGraph {
	return {
		derivationDeps: new Map(),
		activeConstraints: new Set(),
		recentlyChangedFacts: new Set(),
		recentlyComputedDerivations: new Set(),
		recentlyActiveConstraints: new Set(),
		animationTimer: null,
	};
}

// ============================================================================
// Record & Replay
// ============================================================================

// C3: Recording caps to prevent unbounded growth
export const MAX_RECORDED_EVENTS = 10_000;
export const MAX_RECORDED_SNAPSHOTS = 100;

export interface RecordingState {
	isRecording: boolean;
	recordedEvents: TraceEvent[];
	snapshots: Array<{ timestamp: number; facts: Record<string, unknown> }>;
}

export function createRecordingState(): RecordingState {
	return {
		isRecording: false,
		recordedEvents: [],
		snapshots: [],
	};
}

// ============================================================================
// Panel Constants & Types
// ============================================================================

export const MAX_PANEL_EVENTS = 50;
export const MAX_RESOLVER_STATS = 200;

// Style constants — WCAG AA contrast ratios verified against #1a1a2e bg
export const S = {
	bg: "#1a1a2e",
	text: "#e0e0e0",
	accent: "#8b9aff", // 6.63:1 contrast ratio
	muted: "#b0b0d0",  // 8.10:1 contrast ratio
	border: "#333",
	rowBorder: "#2a2a4a",
	green: "#4ade80",
	yellow: "#fbbf24",
	red: "#f87171",
	closeBtn: "#aaa", // 7.34:1 contrast ratio
	font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as const;

// Flow diagram layout constants
export const FLOW = {
	nodeW: 90,
	nodeH: 16,
	nodeGap: 6,
	startY: 16,
	columns: 5, // facts, derivations, constraints, requirements, resolvers
	colGap: 20,
	fontSize: 10,
	labelMaxChars: 11,
} as const;

export interface PanelRefs {
	container: HTMLDivElement;
	toggleBtn: HTMLButtonElement;
	titleEl: HTMLElement;
	statusEl: HTMLSpanElement;
	factsBody: HTMLTableSectionElement;
	factsCount: HTMLSpanElement;
	derivBody: HTMLTableSectionElement;
	derivCount: HTMLSpanElement;
	derivSection: HTMLDetailsElement;
	inflightList: HTMLUListElement;
	inflightSection: HTMLDetailsElement;
	inflightCount: HTMLSpanElement;
	unmetList: HTMLUListElement;
	unmetSection: HTMLDetailsElement;
	unmetCount: HTMLSpanElement;
	perfSection: HTMLDetailsElement;
	perfBody: HTMLDivElement;
	timeTravelSection: HTMLDivElement;
	timeTravelLabel: HTMLSpanElement;
	undoBtn: HTMLButtonElement;
	redoBtn: HTMLButtonElement;
	flowSection: HTMLDetailsElement;
	flowSvg: SVGSVGElement;
	timelineSection: HTMLDetailsElement;
	timelineSvg: SVGSVGElement;
	eventsSection: HTMLDetailsElement;
	eventsList: HTMLDivElement;
	eventsCount: HTMLSpanElement;
	traceHint: HTMLDivElement;
	recordBtn: HTMLButtonElement;
	exportBtn: HTMLButtonElement;
}
