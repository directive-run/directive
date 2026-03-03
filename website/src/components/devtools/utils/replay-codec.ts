import pako from "pako";
import type { DebugEvent } from "../types";

/**
 * Encode events to a compressed base64 string for URL sharing.
 * Uses pako (zlib deflate) for compression.
 */
export function encodeReplay(events: DebugEvent[]): string {
  const json = JSON.stringify(events);
  const compressed = pako.deflate(json);

  // Chunked conversion to avoid stack overflow on large payloads
  const CHUNK = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < compressed.length; i += CHUNK) {
    chunks.push(
      String.fromCharCode.apply(
        null,
        compressed.subarray(i, i + CHUNK) as unknown as number[],
      ),
    );
  }

  return btoa(chunks.join(""));
}

/** Maximum encoded replay size (2 MB base64 ≈ ~1.5 MB compressed). */
const MAX_REPLAY_SIZE = 2 * 1024 * 1024;

/** Maximum decompressed size (10 MB) to prevent zip bomb attacks. */
const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024;

/**
 * Decode a compressed base64 string back to events.
 * Rejects payloads exceeding MAX_REPLAY_SIZE and validates the decoded shape.
 */
export function decodeReplay(encoded: string): DebugEvent[] {
  if (encoded.length > MAX_REPLAY_SIZE) {
    throw new RangeError(
      `Replay data too large (${encoded.length} chars, max ${MAX_REPLAY_SIZE})`,
    );
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new TypeError("Invalid base64 in replay data");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  // Incremental decompression with size limit to prevent zip bombs
  const inflator = new pako.Inflate({ to: "string" });
  let totalSize = 0;
  const CHUNK_SIZE = 65536;

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    inflator.push(chunk, i + CHUNK_SIZE >= bytes.length);

    if (inflator.result) {
      totalSize += (inflator.result as string).length;
    }

    if (totalSize > MAX_DECOMPRESSED_SIZE) {
      throw new RangeError(
        `Decompressed replay too large (>${MAX_DECOMPRESSED_SIZE} bytes), aborting`,
      );
    }

    if (inflator.err) {
      throw new Error(`Decompression error: ${inflator.msg}`);
    }
  }

  const json = inflator.result as string;

  if (!json || json.length > MAX_DECOMPRESSED_SIZE) {
    throw new RangeError(
      `Decompressed replay too large (${json?.length ?? 0} bytes, max ${MAX_DECOMPRESSED_SIZE})`,
    );
  }
  const parsed: unknown = JSON.parse(json);

  if (!Array.isArray(parsed)) {
    throw new TypeError("Replay data must be an array of events");
  }

  for (const item of parsed) {
    if (
      item == null ||
      typeof item !== "object" ||
      typeof (item as DebugEvent).type !== "string" ||
      typeof (item as DebugEvent).timestamp !== "number"
    ) {
      throw new TypeError(
        "Invalid event in replay data: each event must have type (string) and timestamp (number)",
      );
    }
  }

  return parsed as DebugEvent[];
}
