/**
 * Outbound fetch wrapper installed in the worker BEFORE the user's
 * bundle imports anything. The validator already blocks `fetch` as a
 * free identifier AND `globalThis.fetch` property access, so the
 * user's snippet can't call fetch directly. But `@directive-run/query`
 * and `@directive-run/ai` are in the allowlist and their package code
 * calls global `fetch` internally — the validator never sees those
 * calls because they live in external module bodies.
 *
 * Threat closed: a snippet that builds a `createBaseQuery({
 * baseUrl: "http://169.254.169.254" })` triggers an outbound HTTP
 * request from the worker to AWS IMDS. On the directive.run/api/sandbox
 * Vercel surface, that's SSRF from a privileged egress.
 *
 * This wrapper rejects:
 *
 * - Loopback (127.0.0.0/8, [::1], localhost)
 * - Link-local (169.254.0.0/16 — includes IMDS at .169.254)
 * - RFC-1918 private (10.x, 172.16-31.x, 192.168.x)
 * - Multicast / broadcast / reserved ranges
 * - Non-HTTP(S) protocols (file://, ftp://, gopher://, data://, blob://)
 * - URLs without a hostname (relative paths, javascript:, etc.)
 *
 * Allows:
 *
 * - Any public IPv4 / IPv6 address
 * - Any hostname that resolves to public (resolution happens at request
 *   time; we don't pre-resolve because Node's fetch doesn't expose the
 *   resolved IP before sending. The host header is parsed for the
 *   surface-level check; DNS rebinding is theoretical here because
 *   external attackers can't control internal DNS, but documented as
 *   a known gap.)
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function isPrivateIPv4(host: string): boolean {
  // Match IPv4 dotted-quad. We don't accept octal/hex forms — Node's
  // URL parser rejects those for hostnames anyway.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  const c = Number.parseInt(m[3]!, 10);
  const d = Number.parseInt(m[4]!, 10);
  if (a > 255 || b > 255 || c > 255 || d > 255) {
    // Malformed — let it through; Node's fetch will reject the URL.
    return false;
  }
  // 0.0.0.0/8 — "this network", treated as unrouted/private here.
  if (a === 0) return true;
  // 127.0.0.0/8 — loopback.
  if (a === 127) return true;
  // 10.0.0.0/8 — RFC-1918 Class A.
  if (a === 10) return true;
  // 172.16.0.0/12 — RFC-1918 Class B.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC-1918 Class C.
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local, includes AWS/GCP/Azure IMDS at
  // 169.254.169.254. THIS is the SSRF target we care most about.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10 — carrier-grade NAT, not internet-routable.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 224.0.0.0/4 — multicast.
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 — reserved / experimental.
  if (a >= 240) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // Strip brackets the URL parser leaves in place.
  const stripped = host.replace(/^\[|\]$/g, "").toLowerCase();
  // Loopback.
  if (stripped === "::1") return true;
  // Unspecified / "any".
  if (stripped === "::") return true;
  // Link-local fe80::/10
  if (stripped.startsWith("fe80:") || stripped.startsWith("fe8")) return true;
  // Unique local fc00::/7 (fc and fd prefixes).
  if (stripped.startsWith("fc") || stripped.startsWith("fd")) return true;
  // IPv4-mapped IPv6 (::ffff:169.254.169.254) — extract the v4 tail
  // and re-check. Node's URL parser may normalize the literal-IPv4
  // form to its hex equivalent (`::ffff:a9fe:a9fe`), so handle both.
  const mappedV4 = stripped.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedV4 && isPrivateIPv4(mappedV4[1]!)) {
    return true;
  }
  const mappedHex = stripped.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1]!, 16);
    const lo = Number.parseInt(mappedHex[2]!, 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >> 8) & 0xff;
      const d = lo & 0xff;
      if (isPrivateIPv4(`${a}.${b}.${c}.${d}`)) {
        return true;
      }
    }
  }
  return false;
}

function isLocalHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  if (lower === "localhost.localdomain") return true;
  if (lower.endsWith(".local")) return true;
  if (lower.endsWith(".internal")) return true;
  return false;
}

interface UrlCheck {
  allow: boolean;
  reason?: string;
}

export function checkSandboxFetchUrl(rawUrl: string): UrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allow: false, reason: `not a valid URL: "${rawUrl}"` };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      allow: false,
      reason: `protocol "${parsed.protocol}" is not allowed (only http:, https:)`,
    };
  }
  const host = parsed.hostname;
  if (!host) {
    return { allow: false, reason: "URL has no hostname" };
  }
  if (isLocalHostname(host)) {
    return {
      allow: false,
      reason: `hostname "${host}" resolves to localhost or internal-only`,
    };
  }
  if (isPrivateIPv4(host)) {
    return {
      allow: false,
      reason: `IPv4 ${host} is in a private / loopback / link-local range`,
    };
  }
  if (isPrivateIPv6(host)) {
    return {
      allow: false,
      reason: `IPv6 ${host} is in a private / loopback / link-local range`,
    };
  }
  return { allow: true };
}

/**
 * Pre-resolve a hostname via `dns.lookup` and reject if ANY resolved
 * address lands in a private / loopback / link-local range. Closes
 * the DNS-rebinding gap the original wrapper acknowledged: a snippet
 * that fetches `http://attacker.example.com/` whose A record resolves
 * to 169.254.169.254 (or whose record rotates between checks) would
 * otherwise reach the IMDS surface. We resolve once and check the
 * actual IPs, not just the hostname spelling.
 *
 * Returns `null` if every resolved address is public; returns a
 * reason string for the first private hit.
 */
export async function checkResolvedAddresses(host: string): Promise<string | null> {
  // Skip DNS resolution for hostnames that are already IP literals —
  // the hostname-level check already covered them.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return null;
  if (host.includes(":")) return null; // IPv6 literal (URL parser leaves it bracketed but hostname strips them)
  try {
    const { lookup } = await import("node:dns/promises");
    const records = await lookup(host, { all: true });
    for (const r of records) {
      if (r.family === 4 && isPrivateIPv4(r.address)) {
        return `hostname "${host}" resolves to private IPv4 ${r.address}`;
      }
      if (r.family === 6 && isPrivateIPv6(r.address)) {
        return `hostname "${host}" resolves to private IPv6 ${r.address}`;
      }
    }
    return null;
  } catch {
    // DNS failure: fall through and let the underlying fetch report
    // the resolution error to the caller. The wrapper isn't the place
    // to swallow DNS noise — we only block when we KNOW the address
    // is private.
    return null;
  }
}

/**
 * Install the wrapper on `globalThis.fetch`. Called from the worker
 * BEFORE the bundle is imported so any `fetch` calls inside the user's
 * code or inside allowlisted packages (`@directive-run/query`,
 * `@directive-run/ai`) hit the wrapper.
 *
 * Safe to call when `fetch` is undefined (older Node); just installs
 * the rejection wrapper.
 */
export function installFetchWrapper(): void {
  const original =
    (globalThis as { fetch?: typeof fetch }).fetch ??
    ((async () => {
      throw new Error("fetch is not available in this Node version");
    }) as typeof fetch);

  const wrapped: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const decision = checkSandboxFetchUrl(rawUrl);
    if (!decision.allow) {
      throw new Error(
        `sandbox: outbound fetch blocked — ${decision.reason ?? "denied"}`,
      );
    }
    // DNS rebinding defence — pre-resolve and reject before the
    // outbound socket opens. The original wrapper acknowledged this
    // gap in its preamble; closing it now that node:dns/promises is
    // a stable surface.
    let parsedHost = "";
    try {
      parsedHost = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
    } catch {
      // already rejected above; defensive
    }
    if (parsedHost) {
      const dnsReason = await checkResolvedAddresses(parsedHost);
      if (dnsReason !== null) {
        throw new Error(`sandbox: outbound fetch blocked — ${dnsReason}`);
      }
    }
    return original(input, init);
  };

  (globalThis as { fetch: typeof fetch }).fetch = wrapped;
}
