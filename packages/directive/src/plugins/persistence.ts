/**
 * Persistence Plugin - Save/restore facts to storage
 */

import type { Plugin, Schema, System } from "../types.js";
import { isPrototypeSafe } from "../utils.js";

export interface PersistencePluginOptions {
	/** Storage backend (localStorage, sessionStorage, or custom) */
	storage: Storage;
	/** Key to use in storage */
	key: string;
	/** Only persist these fact keys (default: all) */
	include?: string[];
	/** Exclude these fact keys from persistence */
	exclude?: string[];
	/** Debounce saves by this many ms (default: 100) */
	debounce?: number;
	/** Called when state is restored */
	onRestore?: (data: Record<string, unknown>) => void;
	/** Called when state is saved */
	onSave?: (data: Record<string, unknown>) => void;
	/** Called on error */
	onError?: (error: Error) => void;
}

/**
 * Create a persistence plugin.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [
 *     persistencePlugin({
 *       storage: localStorage,
 *       key: "my-app-state",
 *       include: ["user", "preferences"],
 *     }),
 *   ],
 * });
 * ```
 */
export function persistencePlugin<S extends Schema>(
	options: PersistencePluginOptions,
): Plugin<S> {
	const {
		storage,
		key,
		include,
		exclude = [],
		debounce = 100,
		onRestore,
		onSave,
		onError,
	} = options;

	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let system: System<S> | null = null;
	const trackedKeys = new Set<string>();

	/** Check if a key should be persisted */
	const shouldPersist = (factKey: string): boolean => {
		if (exclude.includes(factKey)) return false;
		if (include) return include.includes(factKey);
		return true;
	};

	/** Load state from storage */
	const load = (): Record<string, unknown> | null => {
		try {
			const json = storage.getItem(key);
			if (!json) return null;

			const data = JSON.parse(json);
			if (typeof data !== "object" || data === null) return null;

			// Security: Check for prototype pollution
			if (!isPrototypeSafe(data)) {
				onError?.(new Error("Potential prototype pollution detected in stored data"));
				return null;
			}

			return data as Record<string, unknown>;
		} catch (error) {
			onError?.(error instanceof Error ? error : new Error(String(error)));
			return null;
		}
	};

	/** Save state to storage */
	const save = () => {
		if (!system) return;

		try {
			const data: Record<string, unknown> = {};

			for (const factKey of trackedKeys) {
				if (shouldPersist(factKey)) {
					data[factKey] = (system.facts as Record<string, unknown>)[factKey];
				}
			}

			storage.setItem(key, JSON.stringify(data));
			onSave?.(data);
		} catch (error) {
			onError?.(error instanceof Error ? error : new Error(String(error)));
		}
	};

	/** Schedule a debounced save */
	const scheduleSave = () => {
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}
		saveTimeout = setTimeout(save, debounce);
	};

	return {
		name: "persistence",

		onInit: (sys) => {
			system = sys;

			// Restore state from storage
			const data = load();
			if (data) {
				system.facts.$store.batch(() => {
					for (const [factKey, value] of Object.entries(data)) {
						if (shouldPersist(factKey)) {
							(system!.facts as Record<string, unknown>)[factKey] = value;
							trackedKeys.add(factKey);
						}
					}
				});
				onRestore?.(data);
			}
		},

		onDestroy: () => {
			// Final save before destroy
			if (saveTimeout) {
				clearTimeout(saveTimeout);
			}
			save();
		},

		onFactSet: (factKey) => {
			trackedKeys.add(factKey);
			if (shouldPersist(factKey)) {
				scheduleSave();
			}
		},

		onFactDelete: (factKey) => {
			trackedKeys.delete(factKey);
			if (shouldPersist(factKey)) {
				scheduleSave();
			}
		},

		onFactsBatch: (changes) => {
			let shouldSave = false;
			for (const change of changes) {
				if (change.type === "set") {
					trackedKeys.add(change.key);
				} else {
					trackedKeys.delete(change.key);
				}
				if (shouldPersist(change.key)) {
					shouldSave = true;
				}
			}
			if (shouldSave) {
				scheduleSave();
			}
		},
	};
}
