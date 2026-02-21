import type { DebugEvent } from "./types";
import { EVENT_COLORS } from "./colors";

export interface HtmlExportOptions {
  title?: string;
  /** Include only first N events */
  maxEvents?: number;
}

/**
 * Generate a self-contained HTML file with embedded events JSON and a minimal viewer.
 *
 * The viewer renders an interactive timeline with event detail, filters, and zoom
 * — no external dependencies, no WebSocket connection.
 */
export function generateStandaloneHTML(
  events: DebugEvent[],
  options: HtmlExportOptions = {},
): string {
  const title = options.title ?? "Directive DevTools Trace";
  const maxEvents = options.maxEvents ?? events.length;
  const trimmedEvents = events.slice(0, maxEvents);

  // Safely embed JSON: escape </script> sequences and Unicode line/paragraph separators
  const eventsJson = JSON.stringify(trimmedEvents)
    .replace(/<\//g, "<\\/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  // Inject EVENT_COLORS as a safe JSON object
  const colorsJson = JSON.stringify(EVENT_COLORS)
    .replace(/<\//g, "<\\/");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace; background: #09090b; color: #e4e4e7; }
  #app { display: flex; flex-direction: column; height: 100vh; }
  .toolbar { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #27272a; padding: 8px 16px; flex-shrink: 0; }
  .toolbar h1 { font-size: 13px; color: #a1a1aa; font-weight: 600; }
  .toolbar .count { font-size: 11px; color: #52525b; margin-left: auto; }
  .filter-btn { border: 1px solid #3f3f46; background: #18181b; color: #a1a1aa; padding: 2px 8px; border-radius: 12px; font-size: 10px; cursor: pointer; }
  .filter-btn.active { border-color: #3b82f6; color: #60a5fa; background: #172554; }
  .timeline { flex: 1; overflow: auto; }
  .lane { display: flex; border-bottom: 1px solid #27272a33; }
  .lane-label { width: 120px; flex-shrink: 0; padding: 8px 12px; font-size: 11px; color: #71717a; border-right: 1px solid #27272a; background: #18181b; position: sticky; left: 0; z-index: 1; display: flex; align-items: center; }
  .lane-bars { flex: 1; position: relative; min-height: 36px; padding: 0 4px; }
  .bar { position: absolute; height: 20px; border-radius: 3px; cursor: pointer; opacity: 0.85; font-size: 9px; line-height: 20px; padding: 0 4px; color: rgba(255,255,255,0.9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar:hover { opacity: 1; filter: brightness(1.2); }
  .bar.selected { opacity: 1; box-shadow: 0 0 0 2px rgba(255,255,255,0.4); z-index: 20; }
  .bar.point { width: 8px; border-radius: 50%; padding: 0; }
  .time-axis { display: flex; border-top: 1px solid #27272a; padding: 4px 16px; background: #18181b; flex-shrink: 0; }
  .time-axis .spacer { width: 120px; flex-shrink: 0; }
  .time-axis .labels { flex: 1; display: flex; justify-content: space-between; font-size: 10px; color: #52525b; }
  .detail { position: fixed; right: 0; top: 0; bottom: 0; width: 320px; background: #18181b; border-left: 1px solid #27272a; overflow: auto; padding: 16px; z-index: 50; }
  .detail h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; }
  .detail .close { float: right; background: none; border: none; color: #71717a; cursor: pointer; font-size: 16px; }
  .detail .close:hover { color: #e4e4e7; }
  .detail .prop { font-size: 11px; margin-bottom: 4px; }
  .detail .prop .key { color: #71717a; }
  .detail .prop .val { color: #a1a1aa; word-break: break-all; }
  .detail .prop .val.num { color: #60a5fa; }
  .detail .prop .val.bool { color: #34d399; }
  .detail .prop .val.str { color: #fbbf24; }
  .replay-cursor { position: absolute; top: 0; bottom: 0; width: 1px; background: #ef4444; z-index: 30; pointer-events: none; }
  .footer { border-top: 1px solid #27272a; padding: 6px 16px; font-size: 10px; color: #3f3f46; text-align: center; }
</style>
</head>
<body>
<div id="app">
  <div class="toolbar">
    <h1>${escapeHtml(title)}</h1>
    <div class="count" id="count"></div>
  </div>
  <div class="timeline" id="timeline"></div>
  <div class="time-axis">
    <div class="spacer"></div>
    <div class="labels" id="time-labels"></div>
  </div>
  <div class="footer">Directive DevTools &mdash; Exported ${new Date().toISOString()}</div>
</div>
<div class="detail" id="detail" style="display:none"></div>

<script>
(function() {
  var EVENTS = ${eventsJson};
  var COLORS = ${colorsJson};

  if (!EVENTS.length) { document.getElementById("timeline").innerHTML = '<div style="text-align:center;padding:40px;color:#52525b">No events</div>'; return; }

  var start = EVENTS[0].timestamp, end = EVENTS[EVENTS.length-1].timestamp, dur = Math.max(end - start, 1);
  document.getElementById("count").textContent = EVENTS.length + " events";

  // Text escaping (DOM-safe)
  function esc(s) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  // Time labels
  var labelsEl = document.getElementById("time-labels");
  for (var i = 0; i <= 4; i++) {
    var s = document.createElement("span");
    s.textContent = Math.round(dur * i / 4) + "ms";
    labelsEl.appendChild(s);
  }

  // Group into lanes
  var lanes = {}, agentOrder = [];
  EVENTS.forEach(function(e) {
    var lane = e.agentId || "__global__";
    if (!lanes[lane]) { lanes[lane] = []; agentOrder.push(lane); }
    lanes[lane].push(e);
  });

  var timelineEl = document.getElementById("timeline");
  var selected = null;

  agentOrder.forEach(function(laneId) {
    var evts = lanes[laneId];
    var laneEl = document.createElement("div"); laneEl.className = "lane";
    var label = document.createElement("div"); label.className = "lane-label";
    label.textContent = laneId === "__global__" ? "Global" : laneId;
    laneEl.appendChild(label);

    var barsEl = document.createElement("div"); barsEl.className = "lane-bars";
    // Row packing
    var rowEdges = [];
    evts.forEach(function(e) {
      var left = ((e.timestamp - start) / dur) * 100;
      var d = typeof e.durationMs === "number" && e.durationMs > 0 ? (e.durationMs / dur) * 100 : 0;
      var right = left + (d || 0.5);
      var row = 0;
      while (row < rowEdges.length && rowEdges[row] > left) row++;
      rowEdges[row] = right;

      var bar = document.createElement("div");
      bar.className = d > 0 ? "bar" : "bar point";
      bar.style.left = Math.min(left, 99) + "%";
      bar.style.width = d > 0 ? "max(" + d + "%, 8px)" : "8px";
      bar.style.top = (4 + row * 24) + "px";
      bar.style.backgroundColor = COLORS[e.type] || "#666";
      if (d > 3) bar.textContent = e.type.replace(/_/g, " ");
      bar.title = e.type + (e.agentId ? " (" + e.agentId + ")" : "") + (e.durationMs ? " \\u2014 " + e.durationMs + "ms" : "");
      bar.onclick = function() { showDetail(e, bar); };
      barsEl.appendChild(bar);
    });

    var maxRow = rowEdges.length;
    barsEl.style.minHeight = Math.max(36, 4 + maxRow * 24) + "px";
    laneEl.appendChild(barsEl);
    timelineEl.appendChild(laneEl);
  });

  function showDetail(e, bar) {
    if (selected) selected.classList.remove("selected");
    bar.classList.add("selected");
    selected = bar;
    var d = document.getElementById("detail");
    d.style.display = "block";

    // Build detail panel using DOM (no innerHTML with user data)
    d.textContent = "";

    var closeBtn = document.createElement("button");
    closeBtn.className = "close";
    closeBtn.textContent = "\\u00d7";
    closeBtn.onclick = function() { d.style.display = "none"; };
    d.appendChild(closeBtn);

    var h3 = document.createElement("h3");
    h3.textContent = e.type.replace(/_/g, " ");
    d.appendChild(h3);

    function addProp(key, val, cls) {
      var row = document.createElement("div");
      row.className = "prop";
      var keySpan = document.createElement("span");
      keySpan.className = "key";
      keySpan.textContent = key + ": ";
      row.appendChild(keySpan);
      var valSpan = document.createElement("span");
      valSpan.className = cls || "val";
      valSpan.textContent = String(val);
      row.appendChild(valSpan);
      d.appendChild(row);
    }

    addProp("ID", e.id, "val num");
    addProp("Time", new Date(e.timestamp).toISOString(), "val num");
    if (e.agentId) addProp("Agent", e.agentId, "val str");

    var skip = {id:1,type:1,timestamp:1,snapshotId:1,agentId:1};
    Object.keys(e).forEach(function(k) {
      if (skip[k] || e[k] == null) return;
      var v = e[k], cls = "val";
      if (typeof v === "number") cls = "val num";
      else if (typeof v === "boolean") cls = "val bool";
      else if (typeof v === "string") cls = "val str";
      else v = JSON.stringify(v);
      if (typeof v === "string" && v.length > 500) v = v.slice(0, 500) + "...";
      addProp(k, v, cls);
    });
  }
})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
