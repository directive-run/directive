---
"@directive-run/core": patch
---

An interface can now be used as an event or requirement payload

`events: { go: {} as Payload }` silently voided a module's entire schema when
`Payload` was declared as an `interface` rather than a type alias — every fact
became `unknown`, every event possibly undefined, with no error at the payload
declaration and a pile of them in consumer files describing symptoms.

TypeScript grants an implicit index signature to an object type alias and never to
an interface, so an interface failed the `Record<string, unknown>` constraint and
`createModule` fell through to the overload where the schema widens to its base
type. The value type in that constraint was already `unknown`, so the record bought
nothing but the index signature; `EventPayloadSchema` and `RequirementPayloadSchema`
are now `object`.

Also exports `ChainableStringType`, `ChainableNumberType`, `ChainableArrayType` and
`ChainableObjectType` from the package entry. They became nameable types in a
consumer's own declaration output in the previous patch, and a consumer building
with `declaration: true` could not name them.
