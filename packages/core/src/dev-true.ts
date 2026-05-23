// Runtime check that bundlers (webpack, esbuild, turbopack, rollup) inline
// based on the consumer's NODE_ENV. Without this, the published bundle bakes
// in `true` and dev-mode validation runs in every consumer's production
// build — a real footgun the v1.5/v1.6 release hit.
export default typeof process !== "undefined" &&
  process.env?.NODE_ENV !== "production";
