/**
 * Separate tsup entry that owns the ts-morph-importing rule registry.
 *
 * `index.ts` dynamically imports this module from inside `runRules` and
 * `applyFix` ONLY. Because `./executable.js` is a separate tsup entry
 * (not inlined into `dist/index.js`), the ts-morph value imports in
 * `./rules/*.ts` stay isolated — `dist/index.js` ships zero references
 * to ts-morph, and consumers that never call review_source / fix_code
 * never load it.
 */

export {
  type ExecutableRule,
  getExecutableRuleById,
  getExecutableRules,
} from "./rules.js";
