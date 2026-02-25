/**
 * Batch update all examples to include devtoolsPlugin with a name.
 * Run: node .claude/update-examples-devtools.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const SKIP_DIRS = ['server', 'schema-patterns']
const examplesDir = path.join(process.cwd(), 'examples')

const dirs = fs.readdirSync(examplesDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !SKIP_DIRS.includes(d.name))
  .map(d => d.name)

let updated = 0
let skipped = 0

for (const dir of dirs) {
  const name = dir

  // Collect all .ts/.tsx files that contain createSystem
  const candidates = []

  const srcDir = path.join(examplesDir, dir, 'src')
  if (fs.existsSync(srcDir)) {
    for (const f of fs.readdirSync(srcDir)) {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        candidates.push(path.join(srcDir, f))
      }
    }
  }

  // Root-level .tsx (e.g., eleven-up/App.tsx)
  for (const f of fs.readdirSync(path.join(examplesDir, dir))) {
    if (f.endsWith('.tsx')) {
      candidates.push(path.join(examplesDir, dir, f))
    }
  }

  for (const fp of candidates) {
    const content = fs.readFileSync(fp, 'utf8')
    if (!content.includes('createSystem(')) continue

    const rel = fp.replace(process.cwd() + '/', '')
    const hasDevtools = content.includes('devtoolsPlugin')
    const hasDevtoolsName = hasDevtools && /devtoolsPlugin\(\{[^}]*name:/.test(content)

    if (hasDevtoolsName) {
      console.log(`SKIP (has name): ${rel}`)
      skipped++
      continue
    }

    let out = content

    if (hasDevtools) {
      // Has devtoolsPlugin but no name — add name parameter
      out = out.replace(
        /devtoolsPlugin\(\{/g,
        `devtoolsPlugin({ name: "${name}",`
      )
      out = out.replace(
        /devtoolsPlugin\(\)/g,
        `devtoolsPlugin({ name: "${name}" })`
      )
    } else {
      // Need to add import + plugin

      // Add import
      if (out.includes('from "@directive-run/core/plugins"')) {
        out = out.replace(
          /import \{([^}]+)\} from "@directive-run\/core\/plugins"/,
          (m, imports) => `import {${imports.trim()}, devtoolsPlugin } from "@directive-run/core/plugins"`
        )
      } else if (out.includes("from '@directive-run/core/plugins'")) {
        out = out.replace(
          /import \{([^}]+)\} from '@directive-run\/core\/plugins'/,
          (m, imports) => `import {${imports.trim()}, devtoolsPlugin } from '@directive-run/core/plugins'`
        )
      } else {
        // Add new import after @directive-run/core import
        out = out.replace(
          /(import\s+\{[^}]+\}\s+from\s+["']@directive-run\/core["'];?\n)/,
          `$1import { devtoolsPlugin } from "@directive-run/core/plugins";\n`
        )
      }

      // Add plugins to createSystem
      if (out.includes('plugins: [')) {
        // Append to existing plugins array
        out = out.replace(
          /(createSystem\(\{[\s\S]*?plugins:\s*\[)\n/,
          `$1\n    devtoolsPlugin({ name: "${name}" }),\n`
        )
      } else {
        // No plugins — add before closing })
        // For simple single-line: createSystem({ module: X })
        out = out.replace(
          /createSystem\(\{\s*module:\s*(\w+)\s*\}\)/g,
          `createSystem({ module: $1, plugins: [devtoolsPlugin({ name: "${name}" })] })`
        )

        // For multi-line createSystem without plugins — find } ); patterns
        // Strategy: find "createSystem({" and inject plugins before the last "})"
        if (!out.includes('plugins:') && out.includes('createSystem(')) {
          // Multi-line: add plugins as last property
          out = out.replace(
            /(createSystem\(\{(?:[^{}]|\{[^{}]*\})*?)(,?\s*\})\)/g,
            (match, body, closing) => {
              if (body.includes('plugins:')) return match
              // Add comma if body doesn't end with one
              const trimmed = body.trimEnd()
              const needsComma = !trimmed.endsWith(',')
              return `${trimmed}${needsComma ? ',' : ''}\n  plugins: [devtoolsPlugin({ name: "${name}" })],${closing})`
            }
          )
        }
      }
    }

    if (out !== content) {
      fs.writeFileSync(fp, out)
      console.log(`UPDATED: ${rel}`)
      updated++
    } else {
      console.log(`NO CHANGE: ${rel}`)
      skipped++
    }
  }
}

console.log(`\nDone: ${updated} updated, ${skipped} skipped`)
