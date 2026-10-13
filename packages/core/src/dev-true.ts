// Runtime check that bundlers (webpack, esbuild, turbopack, rollup) fold
// based on the consumer's NODE_ENV. Without this, the published bundle bakes
// in `true` and dev-mode validation runs in every consumer's production
// build — a real footgun the v1.5/v1.6 release hit.
//
// The build inlines this same expression into every file that imports it
// (see tsup.config.ts), because an imported constant is never folded across
// modules. Keep the two in step. The shape matters: with
// `process.env.NODE_ENV` defined as "production", both branches are `false`
// and the side-effect-free test lets the minifier drop the whole check. An
// optional chain (`process.env?.NODE_ENV`) would not match a bundler's define.
// The `!process.env` guard keeps a `process` shim without `env` from throwing;
// it leaves a short side-effect-free residue at each site once folded.
export default typeof process === "undefined"
  ? false
  : !process.env
    ? false
    : process.env.NODE_ENV !== "production";
