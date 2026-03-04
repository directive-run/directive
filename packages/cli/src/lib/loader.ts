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
 */
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
      `No Directive system found in ${pc.dim(filePath)}\n` +
        `Export a system as default or named "system":\n\n` +
        `  ${pc.cyan("export default")} createSystem({ module: myModule });\n` +
        `  ${pc.cyan("export const system")} = createSystem({ module: myModule });`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("No Directive system")) {
      throw err;
    }

    throw new Error(
      `Failed to load ${pc.dim(filePath)}: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `Make sure the file is valid TypeScript and tsx is installed:\n` +
        `  ${pc.cyan("npm install -D tsx")}`,
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
