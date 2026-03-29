/** Prototype-pollution keys that must never be iterated or set dynamically */
export const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
