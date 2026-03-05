import fs from "node:fs";
import path from "node:path";

const VALID_NAME = /^[a-z0-9-]+$/;

/**
 * Bare element selectors that need scoping to prevent CSS leakage.
 * Prefixed with `directive-[name]` when embedded in the docs site.
 */
const BARE_SELECTORS = [
  "body",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "form",
  "table",
  "img",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "div",
  "span",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "hr",
  "blockquote",
];

/**
 * Scope raw CSS so bare element selectors don't leak into the host page.
 * Prefixes selectors with `directive-[name]` (the custom element tag).
 */
export function scopeExampleCss(rawCss: string, name: string): string {
  const tag = `directive-${name}`;

  let css = rawCss
    // * { ... } → directive-[name], directive-[name] * { ... }
    .replace(/^(\s*)\*\s*\{/m, `$1${tag}, ${tag} * {`);

  // body { ... } → directive-[name] { ... }
  // h1 { ... } → directive-[name] h1 { ... }
  // button { ... } / button:pseudo / button.class → directive-[name] button...
  for (const sel of BARE_SELECTORS) {
    if (sel === "body") {
      css = css.replace(/^(\s*)body(\s*[{])/gm, `$1${tag}$2`);
    } else {
      css = css.replace(
        new RegExp(`^(\\s*)${sel}(\\s*[{:.])`, "gm"),
        `$1${tag} ${sel}$2`,
      );
    }
  }

  // body's min-height: 100vh becomes tag's min-height: 100vh after scoping —
  // viewport-relative heights don't make sense for embedded examples.
  css += `\n${tag} { min-height: auto !important; }\n`;

  return css;
}

export type ExampleBuild = {
  css: string;
  html: string;
  scriptSrc: string;
};

/**
 * Parse a built example's index.html from `website/public/examples/[name]/`.
 * Extracts CSS, body HTML, and script src. Returns `null` if build doesn't exist.
 */
export function parseExampleBuild(name: string): ExampleBuild | null {
  if (!VALID_NAME.test(name)) {
    throw new Error(`Invalid example name: "${name}"`);
  }

  const htmlPath = path.join(
    process.cwd(),
    "public",
    "examples",
    name,
    "index.html",
  );

  if (!fs.existsSync(htmlPath)) {
    return null;
  }

  const raw = fs.readFileSync(htmlPath, "utf-8");

  // Capture all <style> blocks (Vite may emit multiple)
  const styleMatches = raw.matchAll(/<style>([\s\S]*?)<\/style>/g);
  const rawCss = Array.from(styleMatches)
    .map((m) => m[1])
    .join("\n");

  const bodyMatch = raw.match(/<body>([\s\S]*?)<\/body>/);
  const html = bodyMatch?.[1]?.trim() ?? "";

  const scriptMatch = raw.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/);
  const scriptSrc = scriptMatch?.[1] ?? "";

  return {
    css: scopeExampleCss(rawCss, name),
    html,
    scriptSrc,
  };
}

export type ExampleProjectFiles = Record<string, string>;

/**
 * Read all files needed to open an example as a StackBlitz project.
 * Reads package.json, index.html, vite.config.ts, tsconfig.json, and all src/*.ts files.
 * Returns a flat file map suitable for `@stackblitz/sdk`'s `openProject({ files })`.
 */
export function readExampleProject(name: string): ExampleProjectFiles | null {
  if (!VALID_NAME.test(name)) {
    throw new Error(`Invalid example name: "${name}"`);
  }

  const exampleDir = path.join(process.cwd(), "..", "examples", name);

  if (!fs.existsSync(exampleDir)) {
    return null;
  }

  const files: ExampleProjectFiles = {};

  // Root config files
  const rootFiles = [
    "package.json",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
  ];
  for (const file of rootFiles) {
    const filePath = path.join(exampleDir, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, "utf-8");

      // Fix package.json: replace workspace:* with latest published version
      if (file === "package.json") {
        content = content.replace(/"workspace:\*"/g, '"latest"');
      }

      // Fix vite.config.ts: remove base path (StackBlitz serves from root)
      if (file === "vite.config.ts") {
        content = content.replace(/\s*base:\s*"[^"]*",?\n?/g, "\n");
      }

      files[file] = content;
    }
  }

  // Source files
  const srcDir = path.join(exampleDir, "src");
  if (fs.existsSync(srcDir)) {
    const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts"));
    for (const file of srcFiles) {
      files[`src/${file}`] = fs.readFileSync(path.join(srcDir, file), "utf-8");
    }
  }

  return Object.keys(files).length > 0 ? files : null;
}

export type ExampleSource = {
  filename: string;
  code: string;
};

/**
 * Read source files from an example package's `src/` directory.
 * Returns an array of `{ filename, code }` objects.
 */
export function readExampleSources(
  name: string,
  filenames: string[],
): ExampleSource[] {
  if (!VALID_NAME.test(name)) {
    throw new Error(`Invalid example name: "${name}"`);
  }

  return filenames.map((filename) => {
    if (filename.includes("..") || filename.includes("/")) {
      throw new Error(`Invalid source filename: "${filename}"`);
    }

    const filePath = path.join(
      process.cwd(),
      "..",
      "examples",
      name,
      "src",
      filename,
    );

    try {
      return {
        filename,
        code: fs.readFileSync(filePath, "utf-8"),
      };
    } catch {
      console.warn(`Warning: source file not found: ${filePath}`);

      return {
        filename,
        code: `// Source file "${filename}" not found`,
      };
    }
  });
}
