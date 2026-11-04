// Consumer check for the alpha tarball (RELEASING.md, "alpha.0 as a tarball").
//
// The Aperture lab is the gate: it must build and keep its parity result on
// the alpha exactly as it does on 1.35. For each tarball (1.35, then the
// alpha) this copies the lab to a scratch directory (the lab itself is only
// read), points its `@directive-run/core` dependency at the tarball, runs
// `npm install`, `npm run build`, serves the build with `vite preview` and
// runs `npm run parity` against it. The two parity reports are then compared
// row by row (checkpoint, implementation, field; page errors by message).
// Any row in one report and not the other fails the check unless it is
// listed in consumer-approved.json with a reason.
//
// Usage: pnpm --filter @directive-run/core-next consumer:alpha <alpha.tgz>
//          [--baseline <core-1.35.tgz>]  default: `npm pack @directive-run/core@1.35.0`
//          [--lab <dir>]                 default: $APERTURE_LAB or
//                                        ~/Desktop/directive-size-plan/research/deep-dx/lab
//          [--all]                       compare every implementation, not only directive
//          [--port <n>]                  default 5199
//          [--keep]                      keep the scratch directory
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);

  return index === -1 ? undefined : args[index + 1];
};
const cwd = process.env.INIT_CWD ?? process.cwd();
const positional = args.filter(
  (arg, i) =>
    !arg.startsWith("--") && !args[i - 1]?.match(/^--(baseline|lab|port)$/),
);
if (positional.length !== 1) {
  console.error(
    "usage: consumer:alpha <alpha.tgz> [--baseline <tgz>] [--lab <dir>] [--all] [--port <n>] [--keep]",
  );
  process.exit(2);
}
const alpha = resolve(cwd, positional[0]);
const lab = resolve(
  cwd,
  option("--lab") ??
    process.env.APERTURE_LAB ??
    join(homedir(), "Desktop/directive-size-plan/research/deep-dx/lab"),
);
const port = Number(option("--port") ?? 5199);
const approved = JSON.parse(
  readFileSync(new URL("consumer-approved.json", import.meta.url), "utf8"),
).rows;
for (const entry of approved) {
  if (typeof entry.row !== "string" || !entry.reason?.trim()) {
    console.error("consumer-approved.json: every row needs { row, reason }");
    process.exit(2);
  }
}
if (!existsSync(join(lab, "package.json"))) {
  console.error(`no Aperture lab at ${lab} (pass --lab or set APERTURE_LAB)`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "directive-alpha-consumer-"));
const log = (file, text) => writeFileSync(join(work, file), text);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Runs a command to completion, keeping its output in a log file; returns
// the exit code (never throws on a non-zero one).
const run = (name, cmd, cmdArgs, options) => {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    });
    log(`${name}.log`, out);

    return { code: 0, out };
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    log(`${name}.log`, out);

    return { code: error.status ?? 1, out };
  }
};

// Parity's report as rows: one per differing field per checkpoint, one per
// page error. Values are left out: homeOpacity is mid-animation and moves
// within parity's own tolerance between runs.
const parityRows = (out) => {
  const rows = [];
  let checkpoint = "";
  for (const line of out.split("\n")) {
    const head = line.match(/^[✓✗] (.+)$/);
    const diff = line.match(/^ {2}(\S+)\s+(\S+)\s+expected /);
    const error = line.match(/^ {2}([^\s:]+): (.+)$/);
    if (head) {
      checkpoint = head[1];
    } else if (diff) {
      rows.push(`${checkpoint} | ${diff[1]} | ${diff[2]}`);
    } else if (error) {
      rows.push(`error | ${error[1]} | ${error[2]}`);
    }
  }

  return rows;
};

const check = async (name, tarball, version) => {
  const dir = join(work, name);
  cpSync(lab, dir, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|dist|\.git)$/.test(src),
  });
  const manifestPath = join(dir, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.dependencies["@directive-run/core"] = `file:${tarball}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const install = run(
    `${name}-install`,
    "npm",
    ["install", "--no-audit", "--no-fund"],
    { cwd: dir },
  );
  const installed = JSON.parse(
    readFileSync(
      join(dir, "node_modules/@directive-run/core/package.json"),
      "utf8",
    ),
  ).version;
  if (install.code !== 0 || installed !== version) {
    return {
      name,
      failed: `install exit ${install.code}, installed ${installed}, wanted ${version}`,
    };
  }
  const build = run(`${name}-build`, "npm", ["run", "build"], { cwd: dir });
  if (build.code !== 0) {
    return {
      name,
      failed: `npm run build exit ${build.code} (see ${name}-build.log)`,
    };
  }

  const server = spawn(
    join(dir, "node_modules/.bin/vite"),
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: dir, stdio: "ignore" },
  );
  try {
    const url = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = await fetch(url).then(
        (r) => r.ok,
        () => false,
      );
      if (!up) {
        await sleep(500);
      }
    }
    if (!up) {
      return { name, failed: `vite preview did not answer on ${url}` };
    }
    const env = { ...process.env, CANVAS_LAB_URL: url };
    if (!args.includes("--all")) {
      env.CANVAS_LAB_ONLY = "directive";
    }
    const parity = run(`${name}-parity`, "npm", ["run", "parity"], {
      cwd: dir,
      env,
    });
    const summary = parity.out.match(/PARITY: .+/)?.[0] ?? "no PARITY line";
    if (parity.code !== 0 || !parity.out.includes("PARITY:")) {
      return { name, failed: `npm run parity exit ${parity.code}, ${summary}` };
    }

    return { name, summary, rows: parityRows(parity.out) };
  } finally {
    server.kill();
    await sleep(500);
  }
};

let exitCode = 0;
try {
  let baseline = option("--baseline");
  if (baseline) {
    baseline = resolve(cwd, baseline);
  } else {
    const packed = run(
      "baseline-pack",
      "npm",
      ["pack", "@directive-run/core@1.35.0", "--pack-destination", work],
      { cwd: work },
    );
    if (packed.code !== 0) {
      throw new Error(
        "npm pack @directive-run/core@1.35.0 failed (pass --baseline <tgz>)",
      );
    }
    baseline = join(work, "directive-run-core-1.35.0.tgz");
  }
  const base = await check("v135", baseline, "1.35.0");
  const next = await check("alpha", alpha, "2.0.0-alpha.0");
  const lines = [];
  for (const result of [base, next]) {
    lines.push(
      `${result.name}: ${result.failed ? `FAILED ${result.failed}` : `build ok, ${result.summary}, ${result.rows.length} rows`}`,
    );
  }
  if (base.failed || next.failed) {
    exitCode = 1;
  } else {
    const approvedRows = new Set(approved.map((entry) => entry.row));
    const only = (a, b) => a.rows.filter((row) => !b.rows.includes(row));
    for (const [side, rows] of [
      ["only on 1.35", only(base, next)],
      ["only on the alpha", only(next, base)],
    ]) {
      for (const row of rows) {
        const ok = approvedRows.has(row);
        lines.push(`${ok ? "approved" : "DIFFERENT"} (${side}): ${row}`);
        if (!ok) {
          exitCode = 1;
        }
      }
    }
  }
  lines.push(
    exitCode === 0
      ? "CONSUMER CHECK: same as 1.35"
      : "CONSUMER CHECK: differs from 1.35",
  );
  log("summary.txt", `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
} catch (error) {
  console.error(String(error?.stack ?? error));
  exitCode = 1;
} finally {
  if (args.includes("--keep") || exitCode !== 0) {
    console.log(`logs in ${work}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
}
process.exit(exitCode);
