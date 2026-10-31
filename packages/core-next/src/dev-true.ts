// Runtime check that bundlers (webpack, esbuild, turbopack, rollup) fold
// based on the consumer's NODE_ENV. Without this, the published bundle bakes
// in `true` and dev-mode validation runs in every consumer's production
// build — a real footgun the v1.5/v1.6 release hit.
//
// The default build writes this same expression into every file that imports
// it (see tsup.config.ts), because an imported constant is never folded across
// modules. Keep the two in step. There it is a module constant, evaluated
// once (in a pure call), and each use is `(constant && process.env.NODE_ENV
// !== "production")`: an unbundled production run stops at the constant and
// never reads Node's slow `process.env` on a hot path, and a bundler that
// defines `process.env.NODE_ENV` as "production" folds every use to `false`
// and drops the unused constant. The `development` and `production` builds
// write the literal `true` / `false` instead (package.json `exports`
// conditions). An optional chain (`process.env?.NODE_ENV`)
// would not match a bundler's define. The `!process.env` guard keeps a
// `process` shim without `env` from throwing.
export default typeof process === "undefined"
  ? false
  : !process.env
    ? false
    : process.env.NODE_ENV !== "production";
