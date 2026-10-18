/**
 * Convert `vitest bench --outputJson` output into the
 * `customSmallerIsBetter` format read by benchmark-action/github-action-benchmark.
 *
 * Usage: tsx scripts/bench-to-json.ts <vitest-bench.json> <out.json>
 *
 * Vitest reports times in milliseconds; each entry is emitted as the mean
 * time per operation in nanoseconds (smaller is better). The name is
 * "<file>.bench.ts > <group> > <bench>", which is stable across runs, so the
 * action can line a PR up against the stored history by name.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

interface VitestBench {
  name: string;
  mean: number;
  rme?: number;
  sampleCount?: number;
}
interface VitestGroup {
  fullName: string;
  benchmarks: VitestBench[];
}
interface VitestFile {
  filepath: string;
  groups: VitestGroup[];
}
interface Entry {
  name: string;
  unit: string;
  value: number;
  extra?: string;
}

export function convert(report: { files: VitestFile[] }): Entry[] {
  const entries: Entry[] = [];
  for (const file of report.files) {
    const fileName = basename(file.filepath);
    for (const group of file.groups) {
      // fullName is "<filepath> > <group...>"; drop the path, keep the groups.
      const groupPath = group.fullName.split(" > ").slice(1).join(" > ");
      for (const bench of group.benchmarks) {
        if (!Number.isFinite(bench.mean)) {
          continue;
        }
        const name = [fileName, groupPath, bench.name]
          .filter(Boolean)
          .join(" > ");
        const extra = [
          bench.sampleCount !== undefined
            ? `samples: ${bench.sampleCount}`
            : "",
          bench.rme !== undefined ? `rme: ±${bench.rme.toFixed(2)}%` : "",
        ]
          .filter(Boolean)
          .join(", ");
        entries.push({
          name,
          unit: "ns/op",
          value: Math.round(bench.mean * 1e6 * 100) / 100,
          ...(extra ? { extra } : {}),
        });
      }
    }
  }

  return entries;
}

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    "usage: tsx scripts/bench-to-json.ts <input.json> <output.json>",
  );
  process.exit(2);
}
const entries = convert(JSON.parse(readFileSync(input, "utf8")));
if (entries.length === 0) {
  console.error(`no benchmarks found in ${input}`);
  process.exit(1);
}
const names = new Set(entries.map((e) => e.name));
if (names.size !== entries.length) {
  console.error("duplicate benchmark names; history would be ambiguous");
  process.exit(1);
}
writeFileSync(output, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`wrote ${entries.length} entries to ${output}`);
