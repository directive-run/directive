/**
 * Time-Travel Debugging - Snapshot-based state history
 *
 * Features:
 * - Ring buffer of state snapshots
 * - Go back/forward through history
 * - Replay from any snapshot
 * - Export/import state history
 */

import type { DebugConfig, Facts, FactsStore, Schema, Snapshot, TimeTravelAPI } from "../core/types.js";
import { isPrototypeSafe } from "./utils.js";

// ============================================================================
// Time-Travel Manager
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface TimeTravelManager<_S extends Schema> extends TimeTravelAPI {
	/** Take a snapshot of current state */
	takeSnapshot(trigger: string): Snapshot;
	/** Restore facts from a snapshot */
	restore(snapshot: Snapshot): void;
	/** Check if time-travel is enabled */
	readonly isEnabled: boolean;
	/** Pause snapshot taking */
	pause(): void;
	/** Resume snapshot taking */
	resume(): void;
}

/** Options for creating a time-travel manager */
export interface CreateTimeTravelOptions<S extends Schema> {
	config: DebugConfig;
	facts: Facts<S>;
	store: FactsStore<S>;
	/** Callback when a snapshot is taken */
	onSnapshot?: (snapshot: Snapshot) => void;
	/** Callback when time-travel occurs */
	onTimeTravel?: (from: number, to: number) => void;
}

/**
 * Create a time-travel manager.
 */
export function createTimeTravelManager<S extends Schema>(
	options: CreateTimeTravelOptions<S>,
): TimeTravelManager<S> {
	const { config, facts, store, onSnapshot, onTimeTravel } = options;

	const isEnabled = config.timeTravel ?? false;
	const maxSnapshots = config.maxSnapshots ?? 100;

	// Ring buffer of snapshots
	const snapshots: Snapshot[] = [];
	let currentIndex = -1;
	let nextId = 1;
	let paused = false;

	/** Get current facts as a plain object */
	function getCurrentFacts(): Record<string, unknown> {
		return store.toObject();
	}

	/** Serialize facts to a snapshot-friendly format */
	function serializeFacts(): Record<string, unknown> {
		const factsObj = getCurrentFacts();

		// Deep clone to prevent mutation
		return JSON.parse(JSON.stringify(factsObj));
	}

	/** Deserialize and restore facts from a snapshot */
	function deserializeFacts(serialized: Record<string, unknown>): void {
		// Validate entire object tree for prototype pollution
		if (!isPrototypeSafe(serialized)) {
			console.error("[Directive] Potential prototype pollution detected in snapshot data, skipping restore");
			return;
		}

		store.batch(() => {
			for (const [key, value] of Object.entries(serialized)) {
				// Prototype pollution protection (redundant but defensive)
				if (key === "__proto__" || key === "constructor" || key === "prototype") {
					console.warn(`[Directive] Skipping dangerous key "${key}" during fact restoration`);
					continue;
				}
				// @ts-expect-error - dynamic key access
				facts[key] = value;
			}
		});
	}

	const manager: TimeTravelManager<S> = {
		get isEnabled() {
			return isEnabled;
		},

		get snapshots() {
			return [...snapshots];
		},

		get currentIndex() {
			return currentIndex;
		},

		takeSnapshot(trigger: string): Snapshot {
			if (!isEnabled || paused) {
				return { id: -1, timestamp: Date.now(), facts: {}, trigger };
			}

			const snapshot: Snapshot = {
				id: nextId++,
				timestamp: Date.now(),
				facts: serializeFacts(),
				trigger,
			};

			// If we're not at the end, truncate future snapshots
			if (currentIndex < snapshots.length - 1) {
				snapshots.splice(currentIndex + 1);
			}

			// Add new snapshot
			snapshots.push(snapshot);
			currentIndex = snapshots.length - 1;

			// Enforce max size (ring buffer)
			while (snapshots.length > maxSnapshots) {
				snapshots.shift();
				currentIndex--;
			}

			onSnapshot?.(snapshot);
			return snapshot;
		},

		restore(snapshot: Snapshot): void {
			if (!isEnabled) return;

			// Pause to prevent taking a snapshot during restore
			paused = true;

			try {
				deserializeFacts(snapshot.facts);
			} finally {
				paused = false;
			}
		},

		goBack(steps = 1): void {
			if (!isEnabled || snapshots.length === 0) return;

			const fromIndex = currentIndex;
			const toIndex = Math.max(0, currentIndex - steps);

			if (fromIndex === toIndex) return;

			currentIndex = toIndex;
			const snapshot = snapshots[currentIndex];
			if (snapshot) {
				this.restore(snapshot);
				onTimeTravel?.(fromIndex, toIndex);
			}
		},

		goForward(steps = 1): void {
			if (!isEnabled || snapshots.length === 0) return;

			const fromIndex = currentIndex;
			const toIndex = Math.min(snapshots.length - 1, currentIndex + steps);

			if (fromIndex === toIndex) return;

			currentIndex = toIndex;
			const snapshot = snapshots[currentIndex];
			if (snapshot) {
				this.restore(snapshot);
				onTimeTravel?.(fromIndex, toIndex);
			}
		},

		goTo(snapshotId: number): void {
			if (!isEnabled) return;

			const index = snapshots.findIndex((s) => s.id === snapshotId);
			if (index === -1) {
				console.warn(`[Directive] Snapshot ${snapshotId} not found`);
				return;
			}

			const fromIndex = currentIndex;
			currentIndex = index;
			const snapshot = snapshots[currentIndex];
			if (snapshot) {
				this.restore(snapshot);
				onTimeTravel?.(fromIndex, index);
			}
		},

		replay(): void {
			if (!isEnabled || snapshots.length === 0) return;

			// Start from the beginning
			currentIndex = 0;
			const snapshot = snapshots[0];
			if (snapshot) {
				this.restore(snapshot);
			}
		},

		export(): string {
			return JSON.stringify({
				version: 1,
				snapshots,
				currentIndex,
			});
		},

		import(json: string): void {
			if (!isEnabled) return;

			try {
				const data = JSON.parse(json);

				// Validate import data structure to prevent prototype pollution
				if (typeof data !== "object" || data === null) {
					throw new Error("Invalid time-travel data: expected object");
				}
				if (data.version !== 1) {
					throw new Error(`Unsupported time-travel export version: ${data.version}`);
				}
				if (!Array.isArray(data.snapshots)) {
					throw new Error("Invalid time-travel data: snapshots must be an array");
				}
				if (typeof data.currentIndex !== "number") {
					throw new Error("Invalid time-travel data: currentIndex must be a number");
				}

				// Validate each snapshot has required properties
				for (const snap of data.snapshots) {
					if (typeof snap !== "object" || snap === null) {
						throw new Error("Invalid snapshot: expected object");
					}
					if (typeof snap.id !== "number" || typeof snap.timestamp !== "number" ||
						typeof snap.trigger !== "string" || typeof snap.facts !== "object") {
						throw new Error("Invalid snapshot structure");
					}
					// Deep check for prototype pollution attacks (including nested objects)
					if (!isPrototypeSafe(snap.facts)) {
						throw new Error("Invalid fact data: potential prototype pollution detected in nested objects");
					}
				}

				snapshots.length = 0;
				snapshots.push(...data.snapshots);
				currentIndex = data.currentIndex;

				// Restore current state
				const snapshot = snapshots[currentIndex];
				if (snapshot) {
					this.restore(snapshot);
				}
			} catch (error) {
				console.error("[Directive] Failed to import time-travel data:", error);
			}
		},

		pause(): void {
			paused = true;
		},

		resume(): void {
			paused = false;
		},
	};

	return manager;
}

/**
 * Create a disabled time-travel manager (no-op).
 */
export function createDisabledTimeTravel<S extends Schema>(): TimeTravelManager<S> {
	const noopSnapshot: Snapshot = { id: -1, timestamp: 0, facts: {}, trigger: "" };

	return {
		isEnabled: false,
		snapshots: [],
		currentIndex: -1,
		takeSnapshot: () => noopSnapshot,
		restore: () => {},
		goBack: () => {},
		goForward: () => {},
		goTo: () => {},
		replay: () => {},
		export: () => "{}",
		import: () => {},
		pause: () => {},
		resume: () => {},
	};
}
