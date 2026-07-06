import { existsSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";

/**
 * Loads a Directive system from a user's TypeScript file.
 *
 * Uses tsx to handle TypeScript imports. Looks for:
 * 1. Default export of a System instance
 * 2. Named "system" export
 *
 * Returns the live System object for inspection/explain/graph commands.
 *
 * Note: Returns `any` intentionally — the loaded module is user code with
 * unknown types. Duck-type validation via `isSystem()` ensures the returned
 * object has the required shape (start, stop, inspect, facts).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSystem(filePath: string): Promise<any> {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  // Use tsx register to handle TypeScript imports
  try {
    // Dynamic import with tsx — tsx must be available
    const mod = await import(resolved);

    // Look for default export first
    if (mod.default && isSystem(mod.default)) {
      return mod.default;
    }

    // Look for named "system" export
    if (mod.system && isSystem(mod.system)) {
      return mod.system;
    }

    // Look for any export that looks like a System
    for (const key of Object.keys(mod)) {
      if (isSystem(mod[key])) {
        return mod[key];
      }
    }

    throw new Error(
      `No Directive system found in ${pc.dim(filePath)}\nExport a system as default or named "system":\n\n  ${pc.cyan("export default")} createSystem({ module: myModule });\n  ${pc.cyan("export const system")} = createSystem({ module: myModule });`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("No Directive system")) {
      throw err;
    }

    throw new Error(
      `Failed to load ${pc.dim(filePath)}: ${err instanceof Error ? err.message : String(err)}\n\nMake sure the file is valid TypeScript and tsx is installed:\n  ${pc.cyan("npm install -D tsx")}`,
    );
  }
}

/**
 * Duck-type check for a Directive System object.
 */
function isSystem(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const sys = obj as Record<string, unknown>;

  return (
    typeof sys.inspect === "function" &&
    typeof sys.start === "function" &&
    typeof sys.stop === "function" &&
    "facts" in sys
  );
}

/**
 * Loads a Directive system *factory* from a user's TypeScript file.
 *
 * Where {@link loadSystem} returns a one-shot started system instance,
 * `loadSystemFactory()` returns a callable that produces a fresh,
 * started system on every invocation. This is the contract that
 * `directive bisect` needs — each midpoint replay must start from the
 * same hermetic initial state, so we re-instantiate per attempt.
 *
 * Lookup order (first match wins):
 *   1. Named export `createSystem` (function).
 *   2. Named export `systemFactory` (function).
 *   3. Default export, if it's a function.
 *
 * The factory may return either a System directly or a Promise<System>.
 * Whatever it returns must satisfy {@link isSystem}'s duck-type
 * (`inspect`/`start`/`stop`/`facts`). The factory is responsible for
 * calling `start()` itself — the bisect runner does NOT call start.
 *
 * @example
 * ```ts
 * // User's bisect-system.ts:
 * import { createSystem as makeSys } from "@directive-run/core";
 * import { counterModule } from "./modules/counter";
 *
 * export function createSystem() {
 *   const sys = makeSys({ module: counterModule });
 *   sys.start();
 *   return sys;
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadSystemFactory(
  filePath: string,
): Promise<() => Promise<any>> {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  let mod: Record<string, unknown>;
  try {
    mod = (await import(resolved)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to load ${pc.dim(filePath)}: ${err instanceof Error ? err.message : String(err)}\n\nMake sure the file is valid TypeScript and tsx is installed:\n  ${pc.cyan("npm install -D tsx")}`,
    );
  }

  const candidates: [string, unknown][] = [
    ["createSystem", mod.createSystem],
    ["systemFactory", mod.systemFactory],
    ["default", mod.default],
  ];

  for (const [name, candidate] of candidates) {
    if (typeof candidate === "function") {
      // Wrap so we always return a Promise and validate the result
      // shape after each call (catches "factory exists but returns
      // junk" — common when the user forgets to call sys.start()).
      return async () => {
        const result = await Promise.resolve((candidate as () => unknown)());
        if (!isSystem(result)) {
          throw new Error(
            `Factory '${name}' from ${pc.dim(filePath)} returned a value that is not a started Directive system.\nExpected an object with inspect/start/stop/facts. The factory must call sys.start() before returning.`,
          );
        }
        return result;
      };
    }
  }

  // Detect the most common confusion — user passed a file
  // that exports a STARTED system (the shape `directive replay` wants)
  // and got a confusing "no factory" error. Surface a targeted message
  // explaining how to wrap it.
  const hasStartedInstance =
    isSystem(mod.default) ||
    isSystem(mod.system) ||
    Object.values(mod).some(isSystem);

  if (hasStartedInstance) {
    throw new Error(
      `Found a started Directive system in ${pc.dim(filePath)}, but bisect needs a factory.\nBisect instantiates a fresh system for every midpoint replay (so each attempt is hermetic),\nwhich means it can't reuse a singleton instance the way ${pc.cyan("directive replay")} does.\n\nWrap the existing export in a function:\n\n  ${pc.cyan("export function createSystem()")} {\n    const sys = createSystem({ module: yourModule });\n    sys.start();\n    return sys;\n  }`,
    );
  }

  throw new Error(
    `No system factory found in ${pc.dim(filePath)}\nBisect needs to instantiate a fresh system per midpoint replay. Export one of:\n\n  ${pc.cyan("export function createSystem()")} { ... return sys; }\n  ${pc.cyan("export const systemFactory")} = () => { ... return sys; };\n  ${pc.cyan("export default")} () => { ... return sys; };\n\nThe factory MUST call sys.start() and return the started system.\n(Did you forget ${pc.cyan("sys.start()")} before returning?)`,
  );
}
