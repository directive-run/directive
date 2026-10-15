/**
 * Faults inside the engine's own source, from the slice-0.2 reviews. Each is
 * a one-place edit to a copy of packages/core/src; faults.test.ts loads the
 * copy as the engine under test and requires the differential suite to
 * notice. If core's source moves and a patch no longer applies, the test
 * fails and says which — re-target the patch, never drop the fault.
 */

import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRepoRoot } from "../../lib/core-entries.js";
import { type EngineHandle, engineAt } from "../engines.js";

export interface Patch {
  file: string;
  old: string;
  new: string;
}

export interface SourceFault {
  name: string;
  what: string;
  patches: Patch[];
}

const P = (file: string, old: string, replacement: string): Patch => ({
  file,
  old,
  new: replacement,
});

export const SOURCE_FAULTS: SourceFault[] = [
  {
    name: "f1a_silent_extra_compute",
    what: "a derivation computes twice per read without telling anyone",
    patches: [
      P(
        "core/derivations.ts",
        "        value = tracked.value;\n",
        '        value = tracked.value;\n        withTracking(() => def(facts, derivedProxy), "derivation");\n',
      ),
    ],
  },
  {
    name: "f1b_compute_hook_twice",
    what: "onDerivationCompute fires twice per compute",
    patches: [
      P(
        "core/derivations.ts",
        "        onCompute(id, value, oldValue, Array.from(deps, describeDep));\n",
        "        onCompute(id, value, oldValue, Array.from(deps, describeDep));\n        onCompute(id, value, oldValue, Array.from(deps, describeDep));\n",
      ),
    ],
  },
  {
    name: "f2_resolver_twice",
    what: "every resolver body runs twice",
    patches: [
      P(
        "core/resolvers.ts",
        "      ) as Promise<void>;\n    });\n\n    const timeout = def.timeout;\n",
        "      ) as Promise<void>;\n      const __second = def.resolve!(req.requirement as any, createContext(signal, [req.id], binding, controller, baseline, { resolverId, requirements: [req] })) as Promise<void>;\n      const __first = resolvePromise;\n      resolvePromise = Promise.all([__first, __second]).then(() => undefined);\n    });\n\n    const timeout = def.timeout;\n",
      ),
    ],
  },
  {
    name: "f3_notify_microtask",
    what: "store notifications move to a microtask",
    patches: [
      P(
        "core/facts.ts",
        "    keyListeners.get(key)?.forEach((listener) => listener());\n",
        "    queueMicrotask(() => keyListeners.get(key)?.forEach((listener) => listener()));\n",
      ),
    ],
  },
  {
    name: "f4_effect_order_reversed",
    what: "effects run in reverse order",
    patches: [
      P(
        "core/effects.ts",
        "      if (shouldRun(id, keys)) {\n        ids[count++] = id;\n      }\n    }\n\n    return count;\n",
        "      if (shouldRun(id, keys)) {\n        ids[count++] = id;\n      }\n    }\n    { const __r = ids.slice(0, count).reverse(); for (let i = 0; i < count; i++) ids[i] = __r[i]!; }\n\n    return count;\n",
      ),
    ],
  },
  {
    name: "f5b_glitch",
    what: "a derivation read inside a key listener returns its stale cache",
    patches: [
      P(
        "core/facts.ts",
        "    keyListeners.get(key)?.forEach((listener) => listener());\n",
        "    (globalThis as any).__dglitch = true;\n    try { keyListeners.get(key)?.forEach((listener) => listener()); } finally { (globalThis as any).__dglitch = false; }\n",
      ),
      P(
        "core/derivations.ts",
        "      if (state.isStale) {\n        computeDerivation(id as string);\n      }\n\n      return state.cachedValue as ReturnType<D[K]>;",
        "      if (state.isStale && !(globalThis as any).__dglitch) {\n        computeDerivation(id as string);\n      }\n\n      return state.cachedValue as ReturnType<D[K]>;",
      ),
    ],
  },
  {
    name: "f5_glitch_stale_during_notify",
    what: "a derivation read during a notification flush returns its stale cache",
    patches: [
      P(
        "core/facts.ts",
        "      isNotifying = true;\n      try {\n        for (const key of keys) {",
        "      isNotifying = true;\n      (globalThis as any).__dglitch = true;\n      try {\n        for (const key of keys) {",
      ),
      P(
        "core/facts.ts",
        '        drainDeferredNotifications(" during flush");\n      } finally {\n        isNotifying = false;',
        '        drainDeferredNotifications(" during flush");\n      } finally {\n        (globalThis as any).__dglitch = false;\n        isNotifying = false;',
      ),
      P(
        "core/derivations.ts",
        "      if (state.isStale) {\n        computeDerivation(id as string);\n      }\n\n      return state.cachedValue as ReturnType<D[K]>;",
        "      if (state.isStale && !(globalThis as any).__dglitch) {\n        computeDerivation(id as string);\n      }\n\n      return state.cachedValue as ReturnType<D[K]>;",
      ),
    ],
  },
  {
    name: "f6a_retry_delay_plus1",
    what: "retry backoff is 1 ms longer",
    patches: [
      P(
        "core/resolvers.ts",
        "  return Math.max(1, jittered);\n",
        "  return Math.max(1, jittered) + 1;\n",
      ),
    ],
  },
  {
    name: "f6b_timeout_plus1",
    what: "resolver timeouts fire 1 ms late",
    patches: [
      P(
        "utils/utils.ts",
        "      reject(err);\n    }, ms);\n",
        "      reject(err);\n    }, ms + 1);\n",
      ),
    ],
  },
  {
    name: "f7_no_cleanup_on_destroy",
    what: "effect cleanups do not run on destroy",
    patches: [
      P(
        "core/effects.ts",
        "      stopped = true;\n      for (const state of states.values()) {\n        runCleanup(state);\n      }\n",
        "      stopped = true;\n",
      ),
    ],
  },
  {
    name: "f8a_recoverable_flipped",
    what: "DirectiveError.recoverable is inverted",
    patches: [
      P(
        "core/errors.ts",
        '    const recoverable = source !== "system";\n',
        '    const recoverable = source === "system";\n',
      ),
    ],
  },
  {
    name: "f8b_context_dropped",
    what: "DirectiveError loses its context",
    patches: [
      P(
        "core/errors.ts",
        "    return new DirectiveError(message, source, sourceId, context, recoverable);\n",
        "    return new DirectiveError(message, source, sourceId, undefined, recoverable);\n",
      ),
    ],
  },
  {
    name: "f9a_inspect_no_hitCount",
    what: "inspect() drops constraints[].hitCount",
    patches: [P("core/engine.ts", "            hitCount: s.hitCount,\n", "")],
  },
  {
    name: "f9b_inspect_no_lastDropReason",
    what: "inspect() drops sources[].lastDropReason",
    patches: [
      P(
        "core/engine.ts",
        "          lastDropReason: row.lastDropReason,\n",
        "",
      ),
    ],
  },
  {
    name: "f10_no_warning_dedupe",
    what: "the non-JSON fact warning is no longer deduped",
    patches: [
      P(
        "core/tracking.ts",
        "  if (nonJsonWarningCache.has(cacheKey)) {\n    return;\n  }\n",
        "",
      ),
    ],
  },
];

/** A copy of core with `fault` applied, loaded as an engine. */
export function faultedEngine(fault: SourceFault): {
  engine: EngineHandle;
  dispose: () => void;
} {
  const coreRoot = join(defaultRepoRoot, "packages/core");
  const dir = mkdtempSync(join(tmpdir(), `directive-fault-${fault.name}-`));
  cpSync(join(coreRoot, "package.json"), join(dir, "package.json"));
  cpSync(join(coreRoot, "src"), join(dir, "src"), {
    recursive: true,
    filter: (src) => !/__tests__|__benchmarks__/.test(src),
  });
  for (const patch of fault.patches) {
    const path = join(dir, "src", patch.file);
    const text = readFileSync(path, "utf8");
    const count = text.split(patch.old).length - 1;
    if (count !== 1) {
      rmSync(dir, { recursive: true, force: true });
      throw new Error(
        `fault ${fault.name}: patch for ${patch.file} matches ${count} times (want 1); re-target it`,
      );
    }
    writeFileSync(path, text.replace(patch.old, patch.new));
  }

  return {
    engine: engineAt(`local+${fault.name}`, join(dir, "src/index.ts")),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
