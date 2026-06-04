// Builds shareable "open this in a real editor" links for code snippets
// returned by other MCP tools (generate_module, get_example, fix_code, …).
//
// The link points at directive.run/playground — a route on the docs site
// that decompresses the source from the URL hash, shows it in a syntax-
// highlighted editor, and offers an "Open in StackBlitz" button wired to
// the same @stackblitz/sdk flow the existing example demos use. The user
// lands in a real running Directive project pre-populated with the
// snippet as src/main.ts — same interactive UX as the docs examples,
// not a generic TS Playground.
//
// The source travels in the URL hash (not the query string) for three
// reasons: (1) hashes aren't sent to the server so the source never hits
// server access logs; (2) most chat clients preserve hashes faithfully;
// (3) it mirrors the TS Playground convention so future tooling that
// reads either format can decode the same way.

import { compressToEncodedURIComponent } from "lz-string";

// Hard cap on raw source the tool will encode. Chosen because:
// - Most chat clients (Slack, Discord, Teams, iMessage) reliably
//   preserve URLs up to ~8 KB even after compression overhead.
// - The biggest realistic snippet we ship (the full traffic-light
//   module in get_example) is ~4 KB raw → fits with headroom.
// - Anything larger should be opened in a real sandbox directly
//   rather than embedded in a URL — the playground route bounces
//   oversized links to a "paste this into Stackblitz yourself" path.
export const MAX_PLAYGROUND_SOURCE_BYTES = 8_000;

const PLAYGROUND_BASE_URL = "https://directive.run/playground";

export interface BuildPlaygroundLinkInput {
  source: string;
  /**
   * Optional short label echoed back in the response so the LLM has
   * something descriptive to surface alongside the URL. Encoded into
   * the link via the `t=` hash field; the playground page reads it
   * and uses it as the editor tab title.
   */
  title?: string;
}

export interface BuildPlaygroundLinkResult {
  url: string;
  /** UTF-8 byte length of the input source. */
  sizeBytes: number;
  /** Final URL byte length, post-compression. */
  urlBytes: number;
  title?: string;
}

export class PlaygroundLinkError extends Error {
  constructor(
    message: string,
    public readonly code: "source-empty" | "source-too-large",
  ) {
    super(message);
  }
}

function assertValidSource(source: string): void {
  if (source.length === 0) {
    throw new PlaygroundLinkError("source is empty", "source-empty");
  }
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > MAX_PLAYGROUND_SOURCE_BYTES) {
    throw new PlaygroundLinkError(
      `source is ${bytes} bytes (max ${MAX_PLAYGROUND_SOURCE_BYTES}). Snippets larger than ${MAX_PLAYGROUND_SOURCE_BYTES} bytes don't fit reliably in a URL — copy the source into a fresh Stackblitz project instead.`,
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

export function buildPlaygroundLink(
  input: BuildPlaygroundLinkInput,
): BuildPlaygroundLinkResult {
  assertValidSource(input.source);

  const encoded = compressToEncodedURIComponent(input.source);
  // Fragment fields use `&`-separated `k=v` pairs so future versions
  // can extend without breaking older links. Today: `src` + optional `t`.
  const parts = [`src=${encoded}`];
  if (input.title) {
    parts.push(`t=${encodeHashTitle(input.title)}`);
  }
  const url = `${PLAYGROUND_BASE_URL}#${parts.join("&")}`;

  return {
    url,
    sizeBytes: Buffer.byteLength(input.source, "utf8"),
    urlBytes: Buffer.byteLength(url, "utf8"),
    title: input.title,
  };
}
