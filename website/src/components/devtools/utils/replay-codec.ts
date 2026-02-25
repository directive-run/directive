import type { DebugEvent } from '../types'
import pako from 'pako'

/**
 * Encode events to a compressed base64 string for URL sharing.
 * Uses pako (zlib deflate) for compression.
 */
export function encodeReplay(events: DebugEvent[]): string {
  const json = JSON.stringify(events)
  const compressed = pako.deflate(json)

  return btoa(String.fromCharCode(...compressed))
}

/** Maximum encoded replay size (2 MB base64 ≈ ~1.5 MB compressed). */
const MAX_REPLAY_SIZE = 2 * 1024 * 1024

/**
 * Decode a compressed base64 string back to events.
 * Rejects payloads exceeding MAX_REPLAY_SIZE and validates the decoded shape.
 */
export function decodeReplay(encoded: string): DebugEvent[] {
  if (encoded.length > MAX_REPLAY_SIZE) {
    throw new RangeError(`Replay data too large (${encoded.length} chars, max ${MAX_REPLAY_SIZE})`)
  }

  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const json = pako.inflate(bytes, { to: 'string' })
  const parsed: unknown = JSON.parse(json)

  if (!Array.isArray(parsed)) {
    throw new TypeError('Replay data must be an array of events')
  }

  for (const item of parsed) {
    if (
      item == null ||
      typeof item !== 'object' ||
      typeof (item as DebugEvent).type !== 'string' ||
      typeof (item as DebugEvent).timestamp !== 'number'
    ) {
      throw new TypeError('Invalid event in replay data: each event must have type (string) and timestamp (number)')
    }
  }

  return parsed as DebugEvent[]
}
