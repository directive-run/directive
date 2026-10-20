// Print core-next vs alien-signals per workload from a `vitest bench
// --outputJson` file. Ratio = our mean time / alien-signals' mean time
// (1.00 = equal, above 1 = slower). Target: <= 1.15 on every workload.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node bench-ratio.mjs <bench.json>");
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, "utf8"));
const rows = [];
for (const f of data.files) {
  for (const group of f.groups) {
    const by = Object.fromEntries(group.benchmarks.map((b) => [b.name, b]));
    const ours = by["core-next"];
    const ref = by["alien-signals"];
    if (!ours || !ref) {
      continue;
    }
    const name = group.fullName.split(" > ").pop();
    rows.push([name, ours.mean * 1000, ref.mean * 1000, ours.mean / ref.mean]);
  }
}
console.log("| workload | core-next (µs) | alien-signals (µs) | ratio |");
console.log("| --- | --- | --- | --- |");
for (const [name, a, b, r] of rows) {
  console.log(
    `| ${name} | ${a.toFixed(2)} | ${b.toFixed(2)} | ${r.toFixed(2)}${r > 1.15 ? " (miss)" : ""} |`,
  );
}
