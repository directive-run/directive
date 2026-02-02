/**
 * Shared utilities for Directive
 */

/**
 * Execute a promise with a timeout, properly cleaning up the timer.
 * Used by both constraints and resolvers for timeout handling.
 *
 * @param promise - The promise to wrap with a timeout
 * @param ms - Timeout duration in milliseconds
 * @param errorMessage - Error message if timeout occurs
 * @returns The promise result
 * @throws Error if timeout is exceeded
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	errorMessage: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout>;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		clearTimeout(timeoutId!);
	}
}

/**
 * Normalize an error to an Error instance.
 * Ensures consistent error handling throughout the library.
 *
 * @param error - The error to normalize (can be anything)
 * @returns An Error instance
 */
export function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}

/**
 * Create a stable JSON string with sorted keys.
 * Handles circular references and deeply nested objects safely.
 *
 * @param value - The value to stringify
 * @param maxDepth - Maximum nesting depth (default: 50)
 * @returns A stable JSON string
 */
export function stableStringify(value: unknown, maxDepth = 50): string {
	const seen = new WeakSet();

	function stringify(val: unknown, depth: number): string {
		if (depth > maxDepth) {
			return '"[max depth exceeded]"';
		}

		if (val === null) return "null";
		if (val === undefined) return "undefined";

		const type = typeof val;

		if (type === "string") return JSON.stringify(val);
		if (type === "number" || type === "boolean") return String(val);
		if (type === "function") return '"[function]"';
		if (type === "symbol") return '"[symbol]"';

		if (Array.isArray(val)) {
			// Check for circular reference
			if (seen.has(val)) {
				return '"[circular]"';
			}
			seen.add(val);
			const result = `[${val.map((v) => stringify(v, depth + 1)).join(",")}]`;
			seen.delete(val);
			return result;
		}

		if (type === "object") {
			const obj = val as Record<string, unknown>;
			// Check for circular reference
			if (seen.has(obj)) {
				return '"[circular]"';
			}
			seen.add(obj);
			const keys = Object.keys(obj).sort();
			const pairs = keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k], depth + 1)}`);
			const result = `{${pairs.join(",")}}`;
			seen.delete(obj);
			return result;
		}

		return '"[unknown]"';
	}

	return stringify(value, 0);
}

/**
 * Check for prototype pollution in an object, including nested objects.
 * Returns true if the object is safe, false if dangerous keys are found.
 *
 * @param obj - The object to check
 * @param maxDepth - Maximum nesting depth to check (default: 50)
 * @returns True if safe, false if dangerous keys found
 */
export function isPrototypeSafe(obj: unknown, maxDepth = 50): boolean {
	const dangerousKeys = new Set(["__proto__", "constructor", "prototype"]);
	const seen = new WeakSet();

	function check(val: unknown, depth: number): boolean {
		if (depth > maxDepth) return false; // Fail safe at max depth - don't assume safety
		if (val === null || val === undefined) return true;
		if (typeof val !== "object") return true;

		const objVal = val as Record<string, unknown>;

		// Check for circular reference
		if (seen.has(objVal)) return true;
		seen.add(objVal);

		// Check array elements
		if (Array.isArray(objVal)) {
			for (const item of objVal) {
				if (!check(item, depth + 1)) {
					seen.delete(objVal);
					return false;
				}
			}
			seen.delete(objVal);
			return true;
		}

		// Check object keys and values
		for (const key of Object.keys(objVal)) {
			if (dangerousKeys.has(key)) {
				seen.delete(objVal);
				return false;
			}
			if (!check(objVal[key], depth + 1)) {
				seen.delete(objVal);
				return false;
			}
		}

		seen.delete(objVal);
		return true;
	}

	return check(obj, 0);
}

/**
 * Shallow equality comparison for objects.
 * Used by React hooks to avoid unnecessary re-renders.
 *
 * @param a - First object
 * @param b - Second object
 * @returns True if objects are shallowly equal
 */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
	if (a === b) return true;
	if (!a || !b) return false;

	const keysA = Object.keys(a);
	const keysB = Object.keys(b);

	if (keysA.length !== keysB.length) return false;

	for (const key of keysA) {
		if (a[key] !== b[key]) return false;
	}

	return true;
}
