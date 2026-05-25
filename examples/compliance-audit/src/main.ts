/**
 * Compliance-audit demo — eight tools, one screen.
 *
 *  - data-form `when:` constraint
 *  - predicateFromIntent (LLM emits)
 *  - doctor.checkAgainst (contradiction gate)
 *  - predict() (what facts must change)
 *  - predicateToSQL (server compile)
 *  - createAuditLedger (append-only log + hash chain + TAMPER/VERIFY)
 *  - evaluatePredicateExplained (per-clause ✓/✗)
 *
 * Mock LLM runner so the demo works in StackBlitz without an API key.
 */

import {
  createAuditLedger,
  createSystem,
  doctor,
  evaluatePredicateExplained,
  predict,
  predicateToSQL,
  type AuditEntry,
  type FactPredicate,
} from "@directive-run/core";
import { predicateFromIntent } from "@directive-run/ai";

import { checkoutModule } from "./module.js";
import { mockPredicateRunner } from "./mock-runner.js";

// ============================================================================
// System setup with ledger
// ============================================================================

const ledger = createAuditLedger({ capturePII: false });
const system = createSystem({
  module: checkoutModule,
  plugins: [ledger.plugin],
});
system.start();

// ============================================================================
// DOM helpers
// ============================================================================

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);

  return el as T;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("en-US", { hour12: false }) + "." +
    String(d.getMilliseconds()).padStart(3, "0");
}

// ============================================================================
// Top panel — Facts editor
// ============================================================================

const factsEl = $("facts");

function renderFacts(): void {
  const facts = system.facts.$store.toObject();
  factsEl.innerHTML = `
    <label class="fact-row">
      <span class="fact-key">cartTotal</span>
      <input type="number" id="fact-cartTotal" value="${facts.cartTotal as number}" />
    </label>
    <label class="fact-row">
      <span class="fact-key">region</span>
      <select id="fact-region">
        ${["US", "EU", "ASIA", "OTHER"]
          .map(
            (r) =>
              `<option value="${r}" ${r === facts.region ? "selected" : ""}>${r}</option>`,
          )
          .join("")}
      </select>
    </label>
    <label class="fact-row">
      <span class="fact-key">tier <small>(PII)</small></span>
      <select id="fact-tier">
        ${["free", "pro", "enterprise"]
          .map(
            (t) =>
              `<option value="${t}" ${t === facts.tier ? "selected" : ""}>${t}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;

  $<HTMLInputElement>("fact-cartTotal").addEventListener("input", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) system.facts.cartTotal = v;
    refreshAll();
  });
  $<HTMLSelectElement>("fact-region").addEventListener("change", (e) => {
    system.facts.region = (e.target as HTMLSelectElement)
      .value as "US" | "EU" | "ASIA" | "OTHER";
    refreshAll();
  });
  $<HTMLSelectElement>("fact-tier").addEventListener("change", (e) => {
    system.facts.tier = (e.target as HTMLSelectElement)
      .value as "free" | "pro" | "enterprise";
    refreshAll();
  });
}

// ============================================================================
// Top panel — Intent → predicate
// ============================================================================

let lastEmittedPredicate: FactPredicate<Record<string, unknown>> | null = null;

async function onEmit(): Promise<void> {
  const intent = $<HTMLInputElement>("intent-input").value;
  const out = $("intent-output");
  out.innerHTML = `<div class="muted">…calling mock LLM…</div>`;
  try {
    const predicate = await predicateFromIntent({
      intent,
      schema: checkoutModule.schema,
      runner: mockPredicateRunner,
      maxRetries: 2,
    });
    lastEmittedPredicate = predicate as FactPredicate<Record<string, unknown>>;
    out.innerHTML = `
      <div class="label">Emitted predicate (validated):</div>
      <pre class="json">${escapeHtml(JSON.stringify(predicate, null, 2))}</pre>
      <div id="doctor-verdict"></div>
      <div id="predict-verdict"></div>
      <div id="sql-output"></div>
    `;
    renderDoctor(predicate);
    renderPredict(predicate);
    renderSQL(predicate);
  } catch (err) {
    out.innerHTML = `<div class="error">Rejected after retries: ${escapeHtml(
      (err as Error).message,
    )}</div>`;
    lastEmittedPredicate = null;
  }
}

function renderDoctor(candidate: FactPredicate<Record<string, unknown>>): void {
  const verdict = $("doctor-verdict");
  const inspect = system.inspect();
  const result = doctor.checkAgainst(
    candidate,
    inspect.constraints as Array<{ id: string; whenSpec?: unknown }>,
  );
  if (result.contradictions.length === 0 && result.warnings.length === 0) {
    verdict.innerHTML = `<div class="ok">✓ doctor: no contradictions</div>`;
    return;
  }
  verdict.innerHTML = `
    <div class="label">doctor verdicts:</div>
    ${result.contradictions
      .map(
        (c) =>
          `<div class="error">✗ ${escapeHtml(c.type)} vs <code>${escapeHtml(c.constraintId)}</code>: ${escapeHtml(c.reason)}</div>`,
      )
      .join("")}
    ${result.warnings
      .map(
        (c) =>
          `<div class="warn">⚠ ${escapeHtml(c.type)} vs <code>${escapeHtml(c.constraintId)}</code>: ${escapeHtml(c.reason)}</div>`,
      )
      .join("")}
  `;
}

function renderPredict(candidate: FactPredicate<Record<string, unknown>>): void {
  const verdict = $("predict-verdict");
  const facts = system.facts.$store.toObject();
  const result = predict(candidate, facts as Record<string, unknown>);
  if (result.wouldFire) {
    verdict.innerHTML = `<div class="ok">✓ predict: would fire against current facts</div>`;
    return;
  }
  verdict.innerHTML = `
    <div class="label">predict: would NOT fire. Missing changes:</div>
    <ul class="suggestions">
      ${result.missingChanges
        .map((m) => `<li>${escapeHtml(m.suggestion)}</li>`)
        .join("")}
    </ul>
  `;
}

function renderSQL(candidate: FactPredicate<Record<string, unknown>>): void {
  const out = $("sql-output");
  try {
    const sql = predicateToSQL(candidate, {
      table: "checkouts",
      allowedKeys: ["cartTotal", "region", "tier"],
    });
    out.innerHTML = `
      <div class="label">predicateToSQL (server-ready, parameterized):</div>
      <pre class="json">${escapeHtml(sql.sql)}
params: ${escapeHtml(JSON.stringify(sql.params))}</pre>
    `;
  } catch (err) {
    out.innerHTML = `<div class="error">SQL codegen error: ${escapeHtml((err as Error).message)}</div>`;
  }
}

// ============================================================================
// Middle panel — live whenExplain on the existing constraint
// ============================================================================

function renderExplain(): void {
  const out = $("explain-out");
  const facts = system.facts.$store.toObject();
  const whenSpec = (system.inspect().constraints[0] as { whenSpec?: unknown })
    ?.whenSpec;
  if (!whenSpec) {
    out.innerHTML = `<div class="muted">No data-form whenSpec</div>`;
    return;
  }
  const explained = evaluatePredicateExplained(
    whenSpec,
    facts as Record<string, unknown>,
  );
  const active = explained.every((c) => c.pass);
  out.innerHTML = `
    <div class="constraint-header ${active ? "ok" : "fail"}">
      ${active ? "✓" : "✗"} canCheckout — ${active ? "would fire" : "blocked"}
    </div>
    <ul class="clauses">
      ${explained
        .map(
          (c) =>
            `<li class="${c.pass ? "ok" : "fail"}">
              ${c.pass ? "✓" : "✗"} ${escapeHtml(c.path)} ${escapeHtml(c.op)} ${escapeHtml(JSON.stringify(c.expected))}
              ${c.pass ? "" : ` <span class="muted">(actual: ${escapeHtml(JSON.stringify(c.actual))})</span>`}
            </li>`,
        )
        .join("")}
    </ul>
  `;
}

// ============================================================================
// Bottom panel — audit ledger w/ TAMPER + VERIFY
// ============================================================================

function renderLedger(): void {
  const out = $("ledger-out");
  const entries = ledger.recent(50);
  if (entries.length === 0) {
    out.innerHTML = `<div class="muted">No entries yet — mutate a fact to populate.</div>`;
    return;
  }
  out.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => renderLedgerEntry(e))
    .join("");
}

function renderLedgerEntry(e: AuditEntry): string {
  const ts = fmtTs(e.ts);
  switch (e.kind) {
    case "constraint.evaluate":
      return `<div class="entry ${e.active ? "ok" : "fail"}">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">constraint</span>
        <span>${escapeHtml(e.constraintId)} ${e.active ? "✓ active" : "✗ inactive"}</span>
      </div>`;
    case "fact.change":
      return `<div class="entry">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">fact</span>
        <span>${escapeHtml(e.key)}: ${escapeHtml(JSON.stringify(e.prior))} → ${escapeHtml(JSON.stringify(e.next))}</span>
      </div>`;
    case "resolver.complete":
      return `<div class="entry">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">resolver</span>
        <span>${escapeHtml(e.resolverId)} done in ${e.duration}ms</span>
      </div>`;
    case "resolver.write.rejected":
      return `<div class="entry fail">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">write rejected</span>
        <span>${escapeHtml(e.resolverId)}: ${escapeHtml(e.reason)}</span>
      </div>`;
    case "resolver.error":
      return `<div class="entry fail">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">resolver error</span>
        <span>${escapeHtml(e.resolverId)}: ${escapeHtml(e.error)}</span>
      </div>`;
    case "system.init":
    case "system.start":
    case "system.stop":
    case "system.destroy":
      return `<div class="entry muted">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">lifecycle</span>
        <span>${escapeHtml(e.kind)}</span>
      </div>`;
    case "system.snapshot":
      return `<div class="entry">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">snapshot</span>
        <span>snapshot #${e.snapshotId} (${escapeHtml(e.trigger)})</span>
      </div>`;
    case "system.history.navigate":
      return `<div class="entry">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">time-travel</span>
        <span>${e.from} → ${e.to}</span>
      </div>`;
    case "system.truncated":
      return `<div class="entry fail">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">truncated</span>
        <span>dropped ${e.droppedCount} entries (oldest seq ${e.droppedSeq})</span>
      </div>`;
    case "system.entry-erased":
      return `<div class="entry erased">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">erased</span>
        <span>entry erased (was kind ${escapeHtml(e.originalKind)})</span>
      </div>`;
    case "system.subject-erased":
      return `<div class="entry erased">
        <span class="ts">${ts}</span>
        <span class="seq">#${e.seq}</span>
        <span class="kind">subject-erased</span>
        <span>subject erased: ${e.erased} entries via filter ${escapeHtml(e.filterHash.slice(0, 8))}</span>
      </div>`;
    default: {
      // Exhaustiveness check — any new AuditEntry kind shipped from
      // core forces this default arm to widen, which the compiler
      // catches before the demo silently falls through.
      const _exhaustive: never = e;
      void _exhaustive;
      return `<div class="entry"><span class="ts">${ts}</span><span class="kind">${escapeHtml((e as { kind: string }).kind)}</span></div>`;
    }
  }
}

// Entries are frozen at write time (defense against in-process forgery)
// so we can't actually mutate the live ledger. Instead, simulate a
// tamper: clone the snapshot, mutate the clone, and rerun verify()
// against the cloned chain. The clone shows what a verifier WOULD see
// if persisted bytes were swapped on disk.
let tamperedClone:
  | { entries: import("@directive-run/core").AuditEntry[]; capturedAt: number }
  | null = null;

function onTamper(): void {
  const snap = ledger.toJSON();
  if (snap.entries.length < 2) {
    setVerifyStatus("warn", "Need at least 2 entries before tampering.");
    return;
  }
  // Deep-clone via JSON so we can mutate freely.
  const cloned = JSON.parse(JSON.stringify(snap)) as {
    entries: import("@directive-run/core").AuditEntry[];
    capturedAt: number;
  };
  const idx = Math.floor(cloned.entries.length / 2);
  const target = cloned.entries[idx] as { kind: string; seq: number };
  const originalKind = target.kind;
  target.kind = "fact.change"; // wrong kind
  tamperedClone = cloned;
  setVerifyStatus(
    "warn",
    `Tamper simulated on a CLONE of entry #${target.seq} (was kind=${originalKind}, now kind=fact.change). The live ledger is untouched — entries are frozen at write time. Click VERIFY to see what an auditor would see if the persisted bytes had been swapped.`,
  );
  renderLedger();
}

function verifyClone(
  clone: {
    entries: import("@directive-run/core").AuditEntry[];
    capturedAt: number;
  },
):
  | { valid: true; entryCount: number }
  | {
      valid: false;
      brokenAt: number;
      expectedHash: string;
      actualHash: string;
    } {
  // Re-implement the sync djb2 walk locally so we can verify the clone.
  // Pull hashObject from utils via the public surface — the ledger uses
  // it internally; if your bundle doesn't expose it, the simplest
  // pattern is to keep a copy of the chain in a sink that survives
  // the clone.
  const entries = clone.entries;
  if (entries.length === 0) return { valid: true, entryCount: 0 };
  // Minimal djb2 reimpl over stable-stringify-shaped JSON — matches the
  // core implementation closely enough for the demo verdict.
  const stableStringify = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
  };
  const djb2 = (s: string): string => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  let prevHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.prevHash !== prevHash) {
      return {
        valid: false,
        brokenAt: i,
        expectedHash: prevHash ?? "<genesis>",
        actualHash: e.prevHash ?? "<genesis>",
      };
    }
    prevHash = djb2(stableStringify(e));
  }
  return { valid: true, entryCount: entries.length };
}

function onVerify(): void {
  if (tamperedClone) {
    const result = verifyClone(tamperedClone);
    setVerifyResult(result, "clone");
    return;
  }
  // v1 ledger.verify() is sync — but the type from the compiled dist
  // may still include Promise<…> until the package is rebuilt. Narrow
  // defensively.
  const result = ledger.verify() as
    | { valid: true; entryCount: number; erasedSeqs?: number[] }
    | {
        valid: false;
        brokenAt: number;
        expectedHash: string;
        actualHash: string;
      };
  setVerifyResult(result, "live");
}

// GDPR Art.17 erasure simulation — replaces every ledger entry that
// touched `tier` with a tombstone, then appends a chained
// `system.subject-erased` summary. The hash chain still verifies
// (tombstones are sentinel-stamped); verify() reports the erased seqs
// on the valid arm instead of as tamper. Pairs with the TAMPER button:
// TAMPER shows "valid: false" (forgery); ERASE shows "valid: true,
// erasedSeqs: [...]" (legitimate Art.17 break).
function onErase(): void {
  // Drop any tampered clone — running erase against the live ledger
  // makes the clone state moot, and leaving it set would cause the
  // next VERIFY to show stale tamper info.
  tamperedClone = null;
  const { erased, markerEntry } = ledger.erase({ factPath: "tier" });
  renderLedger();
  const result = ledger.verify() as
    | { valid: true; entryCount: number; erasedSeqs?: number[] }
    | {
        valid: false;
        brokenAt: number;
        expectedHash: string;
        actualHash: string;
      };
  if (result.valid) {
    const erasedCount = result.erasedSeqs?.length ?? 0;
    // (MAJOR-3) markerEntry is null when 0 entries matched — guard the
    // string interpolation so a "marker #null" never lands in the UI.
    const markerNote = markerEntry
      ? `(marker #${markerEntry.seq})`
      : "(no marker — filter matched nothing)";
    setVerifyStatus(
      "ok",
      `⌫ erased ${erased} entries via factPath=tier ${markerNote}. ` +
        `chain still valid — ${result.entryCount} entries, ${erasedCount} tombstones recognised as legitimate breaks (not tamper).`,
    );
    return;
  }
  setVerifyStatus(
    "fail",
    `⌫ erased ${erased} entries via factPath=tier, but VERIFY broke at entry index ${result.brokenAt}. ` +
      `expected prevHash: ${result.expectedHash.slice(0, 16)}…  actual prevHash: ${result.actualHash.slice(0, 16)}…`,
  );
}

function setVerifyResult(
  result:
    | { valid: true; entryCount: number }
    | {
        valid: false;
        brokenAt: number;
        expectedHash: string;
        actualHash: string;
      },
  source: "live" | "clone",
): void {
  const label = source === "clone" ? " (tampered clone)" : "";
  if (result.valid) {
    setVerifyStatus(
      "ok",
      `✓ chain valid${label} — ${result.entryCount} entries, no tamper detected`,
    );
    return;
  }
  setVerifyStatus(
    "fail",
    `✗ TAMPER DETECTED${label} at entry index ${result.brokenAt}. ` +
      `Expected prevHash: ${result.expectedHash.slice(0, 16)}…  ` +
      `Actual prevHash: ${result.actualHash.slice(0, 16)}…`,
  );
}

function setVerifyStatus(
  klass: "ok" | "warn" | "fail",
  msg: string,
): void {
  const el = $("verify-status");
  el.className = `verify-status ${klass}`;
  el.textContent = msg;
}

// ============================================================================
// Wire-up
// ============================================================================

function refreshAll(): void {
  renderExplain();
  renderLedger();
}

renderFacts();
refreshAll();

$("intent-emit").addEventListener("click", () => {
  void onEmit();
});
$("intent-input").addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") {
    void onEmit();
  }
});
$("tamper-btn").addEventListener("click", onTamper);
$("verify-btn").addEventListener("click", onVerify);
$("erase-btn").addEventListener("click", onErase);

// Re-render the ledger every 500ms — the rest of the UI re-renders on
// user input, but the ledger grows asynchronously.
setInterval(() => {
  renderLedger();
}, 500);
