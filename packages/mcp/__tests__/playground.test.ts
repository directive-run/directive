import { decompressFromEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";
import {
  MAX_PLAYGROUND_SOURCE_BYTES,
  PlaygroundLinkError,
  buildPlaygroundLink,
} from "../src/playground.js";

const PLAYGROUND_PREFIX = "https://directive.run/playground#";

function parseHash(url: string): URLSearchParams {
  const idx = url.indexOf("#");
  if (idx === -1) {
    throw new Error("expected url to contain a hash fragment");
  }
  return new URLSearchParams(url.slice(idx + 1));
}

describe("buildPlaygroundLink", () => {
  it("returns a directive.run/playground URL with the source in the hash", () => {
    const result = buildPlaygroundLink({
      source: 'console.log("hello directive");\n',
    });

    expect(result.url.startsWith(PLAYGROUND_PREFIX)).toBe(true);
    expect(result.sizeBytes).toBe(32);
    expect(result.urlBytes).toBe(result.url.length);
    expect(result.title).toBeUndefined();
  });

  it("round-trips the source through lz-string", () => {
    const source = [
      "import { createModule, t } from '@directive-run/core';",
      "",
      "export const counter = createModule('counter', {",
      "  schema: { facts: { count: t.number() } },",
      "  init: (facts) => { facts.count = 0; },",
      "});",
      "",
    ].join("\n");

    const result = buildPlaygroundLink({ source });
    const hash = parseHash(result.url);
    const encoded = hash.get("src");

    expect(encoded).not.toBeNull();
    const decoded = decompressFromEncodedURIComponent(encoded ?? "");
    expect(decoded).toBe(source);
  });

  it("encodes the title in the t= hash field when provided", () => {
    const result = buildPlaygroundLink({
      source: "const a = 1;",
      title: "Traffic-light module",
    });

    // URLSearchParams form-decodes %20 ⇒ space when reading, so the
    // value we get back here is the round-tripped original title.
    const hash = parseHash(result.url);
    expect(hash.get("t")).toBe("Traffic-light module");
    // Confirm the encoded form is in the URL so it survives transport.
    expect(result.url).toContain("t=Traffic-light%20module");
    expect(result.title).toBe("Traffic-light module");
  });

  it("rejects empty source with PlaygroundLinkError code source-empty", () => {
    expect(() => buildPlaygroundLink({ source: "" })).toThrow(
      PlaygroundLinkError,
    );
    try {
      buildPlaygroundLink({ source: "" });
    } catch (err) {
      expect(err).toBeInstanceOf(PlaygroundLinkError);
      expect((err as PlaygroundLinkError).code).toBe("source-empty");
    }
  });

  it("rejects source larger than MAX_PLAYGROUND_SOURCE_BYTES", () => {
    const oversized = "x".repeat(MAX_PLAYGROUND_SOURCE_BYTES + 1);
    expect(() => buildPlaygroundLink({ source: oversized })).toThrow(
      PlaygroundLinkError,
    );
    try {
      buildPlaygroundLink({ source: oversized });
    } catch (err) {
      expect((err as PlaygroundLinkError).code).toBe("source-too-large");
      expect((err as PlaygroundLinkError).message).toMatch(/Stackblitz/i);
    }
  });

  it("accepts source exactly at the cap", () => {
    const atCap = "x".repeat(MAX_PLAYGROUND_SOURCE_BYTES);
    expect(() => buildPlaygroundLink({ source: atCap })).not.toThrow();
  });

  it("counts UTF-8 bytes, not code units, for the size cap", () => {
    // Each `é` is 2 bytes UTF-8. Building a source of N `é`s ⇒ 2N bytes.
    const overByCount = "é".repeat(MAX_PLAYGROUND_SOURCE_BYTES / 2 + 1);
    expect(() => buildPlaygroundLink({ source: overByCount })).toThrow(
      /max 8000/,
    );
  });

  it("never includes the title field when omitted", () => {
    const result = buildPlaygroundLink({ source: "x" });
    expect(result.url.includes("&t=")).toBe(false);
    expect(result.url.includes("t=")).toBe(false);
  });
});
