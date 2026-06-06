// Builds shareable "open this in a real editor" links for code snippets
// returned by other MCP tools (generate_module, get_example, fix_code, …).
//
// The link points at directive.run/playground — a route on the docs site
// that decompresses the source from the URL hash, shows it in a syntax-
// highlighted editor, and offers an "Open in StackBlitz" button wired to
// the same @stackblitz/sdk flow the existing example demos use. The user
// lands in a real running Directive project pre-populated with either a
// single `src/main.ts` (when called with a single `source`) or a paired
// `src/<name>.ts` + `src/main.ts` bundle (when called with a `files`
// array, e.g. the output of `generate_module` which produces both a
// library and a runner driver).
//
// Two modes:
// - `mode: "preview"` (default) — directive.run/playground. Page shows
//   the code with syntax highlighting + an "Open in StackBlitz" button.
//   The only Directive-branded surface in the flow and the one a first-
//   time user is most likely to land on, so this stays the default.
// - `mode: "instant"` — directive.run/run. Thin redirect that server-
//   renders the StackBlitz POST form and auto-submits it on load. Skips
//   the preview UI; lands the user in the StackBlitz editor in ~600ms.
//   Use when the user has already road-tested one link in this
//   conversation, or when they explicitly want "just open it".
//
// Payload travels in the URL hash (not the query string) for three
// reasons: (1) hashes aren't sent to the server so the source never
// hits server access logs; (2) most chat clients preserve hashes
// faithfully; (3) it mirrors the TS Playground convention so future
// tooling that reads either format can decode the same way.

import { compressToEncodedURIComponent } from "lz-string";

// Hard cap on raw input the tool will encode. Chosen because:
// - Most chat clients (Slack, Discord, Teams, iMessage) reliably
//   preserve URLs up to ~8 KB even after compression overhead.
// - The biggest realistic snippet we ship (the full traffic-light
//   module in get_example) is ~4 KB raw → fits with headroom.
// - Anything larger should be opened in a real sandbox directly
//   rather than embedded in a URL.
//
// Applied to single-source input directly, and to the JSON-encoded
// files-array for multi-file input (the per-file boundary is fuzzier
// but the post-compress URL stays bounded).
export const MAX_PLAYGROUND_SOURCE_BYTES = 8_000;

const PREVIEW_BASE_URL = "https://directive.run/playground";
const INSTANT_BASE_URL = "https://directive.run/run";

export type PlaygroundMode = "preview" | "instant";

export interface PlaygroundFile {
  /** Relative path inside the StackBlitz project, e.g. "src/main.ts". */
  path: string;
  /** File contents. */
  source: string;
}

export interface BuildPlaygroundLinkInput {
  /**
   * Single-file shortcut. Mutually exclusive with `files`. Used by
   * tools whose output is already a runnable program (`get_example`,
   * `fix_code`). Mapped onto `src/main.ts` server-side.
   */
  source?: string;
  /**
   * Multi-file payload. Used by `generate_module`'s paired output
   * (library + runner) so the StackBlitz project boots a real demo.
   * The page treats one of these as `src/main.ts`; convention is
   * the runner.
   */
  files?: PlaygroundFile[];
  /**
   * Optional short label echoed back in the response so the LLM has
   * something descriptive to surface alongside the URL. Encoded into
   * the link via the `t=` hash field; the playground page reads it
   * and uses it as the editor tab title.
   */
  title?: string;
  /**
   * Which landing page the URL targets. Default `"preview"`.
   * - `"preview"` → directive.run/playground (code + Open-in-StackBlitz button)
   * - `"instant"` → directive.run/run (auto-submit form to StackBlitz)
   */
  mode?: PlaygroundMode;
}

export interface BuildPlaygroundLinkResult {
  url: string;
  /** UTF-8 byte length of the canonical encoded payload. */
  sizeBytes: number;
  /** Final URL byte length, post-compression. */
  urlBytes: number;
  /** Number of files in the encoded payload. 1 for single-file input. */
  fileCount: number;
  /** Echoed mode. */
  mode: PlaygroundMode;
  title?: string;
}

export class PlaygroundLinkError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "source-empty"
      | "source-too-large"
      | "no-input"
      | "both-source-and-files"
      | "invalid-file",
  ) {
    super(message);
  }
}

function assertByteBudget(bytes: number): void {
  if (bytes > MAX_PLAYGROUND_SOURCE_BYTES) {
    throw new PlaygroundLinkError(
      `payload is ${bytes} bytes (max ${MAX_PLAYGROUND_SOURCE_BYTES}). Payloads larger than ${MAX_PLAYGROUND_SOURCE_BYTES} bytes don't fit reliably in a URL — copy the source into a fresh Stackblitz project instead.`,
      "source-too-large",
    );
  }
}

function encodeHashTitle(title: string): string {
  // RFC 3986 reserves a handful of characters in fragments; the
  // standard fragment grammar lets unreserved chars + `-._~` through
  // raw. encodeURIComponent is overzealous but always safe.
  return encodeURIComponent(title);
}

function baseUrlForMode(mode: PlaygroundMode): string {
  return mode === "instant" ? INSTANT_BASE_URL : PREVIEW_BASE_URL;
}

function buildSingleFileUrl(
  source: string,
  title: string | undefined,
  mode: PlaygroundMode,
): BuildPlaygroundLinkResult {
  if (source.length === 0) {
    throw new PlaygroundLinkError("source is empty", "source-empty");
  }
  const bytes = Buffer.byteLength(source, "utf8");
  assertByteBudget(bytes);

  const encoded = compressToEncodedURIComponent(source);
  const parts = [`src=${encoded}`];
  if (title) {
    parts.push(`t=${encodeHashTitle(title)}`);
  }
  const url = `${baseUrlForMode(mode)}#${parts.join("&")}`;
  return {
    url,
    sizeBytes: bytes,
    urlBytes: Buffer.byteLength(url, "utf8"),
    fileCount: 1,
    mode,
    title,
  };
}

function buildMultiFileUrl(
  files: PlaygroundFile[],
  title: string | undefined,
  mode: PlaygroundMode,
): BuildPlaygroundLinkResult {
  if (files.length === 0) {
    throw new PlaygroundLinkError("files array is empty", "source-empty");
  }
  for (const file of files) {
    if (typeof file.path !== "string" || file.path.length === 0) {
      throw new PlaygroundLinkError(
        "every file must have a non-empty path",
        "invalid-file",
      );
    }
    if (typeof file.source !== "string" || file.source.length === 0) {
      throw new PlaygroundLinkError(
        `file '${file.path}' has empty source`,
        "invalid-file",
      );
    }
  }

  // JSON-encode the files array, then enforce the byte budget against
  // the JSON wrapper (not the per-file raw bytes), so the URL itself
  // stays within the 8 KB ceiling regardless of how the files split.
  const json = JSON.stringify(files);
  const bytes = Buffer.byteLength(json, "utf8");
  assertByteBudget(bytes);

  const encoded = compressToEncodedURIComponent(json);
  const parts = [`files=${encoded}`];
  if (title) {
    parts.push(`t=${encodeHashTitle(title)}`);
  }
  const url = `${baseUrlForMode(mode)}#${parts.join("&")}`;
  return {
    url,
    sizeBytes: bytes,
    urlBytes: Buffer.byteLength(url, "utf8"),
    fileCount: files.length,
    mode,
    title,
  };
}

export function buildPlaygroundLink(
  input: BuildPlaygroundLinkInput,
): BuildPlaygroundLinkResult {
  const mode: PlaygroundMode = input.mode ?? "preview";

  const hasSource = typeof input.source === "string";
  const hasFiles = Array.isArray(input.files);
  if (hasSource && hasFiles) {
    throw new PlaygroundLinkError(
      "pass either `source` or `files`, not both",
      "both-source-and-files",
    );
  }
  if (!hasSource && !hasFiles) {
    throw new PlaygroundLinkError(
      "pass either `source` (single file) or `files` (multi-file array)",
      "no-input",
    );
  }

  if (hasFiles) {
    return buildMultiFileUrl(input.files!, input.title, mode);
  }
  return buildSingleFileUrl(input.source!, input.title, mode);
}
