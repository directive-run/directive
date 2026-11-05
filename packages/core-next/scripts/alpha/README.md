# @directive-run/core 2.0.0-alpha.0

Directive is the constraint-driven runtime for TypeScript: you declare what
must be true, and the runtime makes it happen. This package is the 2.0
engine, packed as a tarball for early testing. It is not on npm, and the
stable line (1.x, on npm as `latest`) is unchanged.

## Install

Download `directive-run-core-2.0.0-alpha.0.tgz` from the GitHub prerelease,
then install the file:

```bash
npm install ./directive-run-core-2.0.0-alpha.0.tgz
```

Install the file, not an unpacked directory: a directory install can make a
bundler see the package twice.

## What works

The same seven entry points as 1.35, for `import` and `require`:
`@directive-run/core`, `/plugins`, `/testing`, `/internals`, `/worker`,
`/migration` and `/adapter-utils`. The engine, modules, facts, derivations,
constraints, resolvers, effects, events and the persistence plugin are built
and checked against 1.35's behaviour by the conformance suite.

## What is not built yet

`/plugins`, `/testing`, `/worker`, `/migration` and `/adapter-utils` export
every 1.35 name, but some do nothing yet. A function there that is not built
throws an error whose `code` is `E_FEATURE_MISSING`, in development and
production builds alike; the message names the feature and the engine layer
it arrives in. That covers all of `/worker`, `/migration` and
`/adapter-utils`, and most of `/plugins` and `/testing`.

A few system members are not built either, such as the dynamic definition
calls (`system.registerModule`, `system.effects.register`) and
`system.getDistributableSnapshot`. A development build throws
`E_FEATURE_MISSING` from them. A production build leaves them out to keep
the bundle small, so calling one there throws a plain `TypeError` ("… is not
a function"). `system.history` and `system.trace` read `null`, as in 1.35
with those options off. Options for unbuilt features, such as `history` and
`trace`, warn once in development and are otherwise ignored.

The main entry and `/internals` leave out the 1.35 exports 2.0 has not built
(for example `predict`, `doctor`, the predicate helpers and snapshot
signing), so importing one of those fails.

Check for the code, not the wording:

```ts
try {
  createWorkerClient({ worker });
} catch (error) {
  if ((error as { code?: string }).code === "E_FEATURE_MISSING") {
    // not in this alpha yet
  }
}
```

## Links

- Documentation (1.x): https://directive.run
- Source: https://github.com/directive-run/directive (`packages/core-next`)
- Issues: https://github.com/directive-run/directive/issues

Licensed MIT OR Apache-2.0.
