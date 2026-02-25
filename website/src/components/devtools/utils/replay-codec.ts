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

/**
 * Decode a compressed base64 string back to events.
 */
export function decodeReplay(encoded: string): DebugEvent[] {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const json = pako.inflate(bytes, { to: 'string' })

  return JSON.parse(json)
}
