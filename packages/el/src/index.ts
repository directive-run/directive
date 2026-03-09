/**
 * @directive-run/el — Vanilla DOM adapter for Directive
 *
 * Typed element creation + reactive bindings.
 * The lightest adapter in the monorepo — no framework dependency.
 */

export { el } from "./el.js";
export type { ElChild } from "./el.js";
export { bind, bindText, mount } from "./bind.js";
