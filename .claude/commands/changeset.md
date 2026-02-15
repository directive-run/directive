---
description: Create a changeset for unreleased changes
---

# Changeset

Create a changeset file describing unreleased changes for versioning and changelogs.

## Step 1: List Packages

Read all `packages/*/package.json` files to list every package name and current version.

Show the two **fixed groups** (packages in a fixed group always share the same version):

**Core + Frameworks:**
- `@directive-run/core`
- `@directive-run/react`
- `@directive-run/vue`
- `@directive-run/svelte`
- `@directive-run/solid`
- `@directive-run/lit`

**AI:**
- `@directive-run/ai`

**Ignored (not versioned by changesets):** `directive`, `vite-plugin-api-proxy`. These are excluded from changesets and must be versioned manually if needed.

## Step 2: Select Packages

**Use AskUserQuestion:** Which group or individual packages changed?

Options:
- Core + Frameworks (all 6 packages)
- AI (1 package)
- Both groups
- Individual packages (let user specify)

## Step 3: Select Bump Type

**Use AskUserQuestion:** What type of version bump?

Options:
- **patch** (0.1.0 -> 0.1.1) – Bug fixes, docs, internal changes
- **minor** (0.1.0 -> 0.2.0) – New features, non-breaking additions
- **major** (0.1.0 -> 1.0.0) – Breaking changes

Note: Fixed group packages all receive the same bump.

## Step 4: Summary

**Use AskUserQuestion:** Ask for a human-readable summary of the changes (1-3 sentences).

## Step 5: Generate Changeset

Generate a unique changeset filename (adjective-noun-verb pattern, e.g., `funny-dogs-dance.md`).

Write the file to `.changeset/<name>.md`:

```markdown
---
"@directive-run/core": minor
"@directive-run/react": minor
---

Summary of changes here.
```

For fixed groups, list every package in the group even though they share versions.

## Step 6: Confirm

Show the created changeset file path and contents. Remind the user:

> Run `/release` when ready to publish, or create more changesets for additional changes.
