/**
 * Strip absolute paths from a stack trace before it crosses the
 * worker→host→client boundary. Stack traces leak the sandbox host's
 * filesystem layout — `/Users/<name>/`, `/home/<user>/`, the mkdtemp
 * bundle directory, and on serverless surfaces `/var/task/...`. These
 * become a fingerprint of the host environment any sandbox client can
 * read. Sanitize once at the boundary so every error path benefits.
 *
 * Lives in its own module because `worker.ts` throws at top-level when
 * loaded outside a worker_threads context — extracting `sanitizeStack`
 * lets the unit test suite import the function directly.
 *
 * Terminator characters in the patterns below intentionally include
 * matched-delimiter punctuation (`)`, `]`, `>`, `"`, `'`, `,`) so a
 * path inside an `at fn (…)` frame or a JSON-stringified `"path"`
 * field is bounded correctly. The character class is shared across
 * POSIX + Windows patterns to keep the boundary consistent.
 */
const PATH_TERMINATOR = "[^\\s)\\]>\"',]";

export function sanitizeStack(s: string | undefined): string {
  if (!s) return "";
  const TAIL = `${PATH_TERMINATOR}+`;
  return (
    s
      // file:// URLs
      .replace(new RegExp(`file:\\/\\/\\/${PATH_TERMINATOR}+`, "g"), "<sandbox>")
      // UNC paths — must run BEFORE the generic `\\` Windows pattern so
      // `\\server\share\file` becomes `<unc>`, not `<unc>\share\file`.
      .replace(new RegExp(`\\\\\\\\${TAIL}`, "g"), "<unc>")
      // Windows drive paths — `C:\Users\<user>\...` and friends.
      // Captures any drive letter + `\Users\<name>` or `\Documents and Settings\<name>`.
      .replace(/[A-Za-z]:\\Users\\[^\\\s)\]>"',]+/g, "<home>")
      .replace(
        /[A-Za-z]:\\Documents and Settings\\[^\\\s)\]>"',]+/g,
        "<home>",
      )
      // Generic Windows absolute paths — `C:\<anything-not-Users>` that
      // didn't match above. Catches CI runners (`D:\a\_work\…`) and
      // tempdirs.
      .replace(/[A-Za-z]:\\[^\\\s)\]>"',]+(?:\\[^\\\s)\]>"',]+)+/g, "<path>")
      // POSIX dev-machine home directories — macOS + Linux
      .replace(new RegExp(`\\/Users\\/${TAIL}`, "g"), "/<home>")
      .replace(new RegExp(`\\/home\\/${TAIL}`, "g"), "/<home>")
      // macOS private-var prefix
      .replace(new RegExp(`\\/private\\/var\\/${TAIL}`, "g"), "<tmp>")
      // serverless lambda / vercel function task root
      .replace(new RegExp(`\\/var\\/task\\/${TAIL}`, "g"), "<task>")
      // generic tmp + lambda-runtime task paths
      .replace(new RegExp(`\\/tmp\\/${TAIL}`, "g"), "<tmp>")
      // /opt and /usr/local — common Linux distro prefixes that leak
      // package layout (e.g. `/opt/render/project/src/...`).
      .replace(new RegExp(`\\/opt\\/${TAIL}`, "g"), "<opt>")
      .replace(new RegExp(`\\/usr\\/local\\/${TAIL}`, "g"), "<usr-local>")
      // Common deploy roots — Heroku/Render/Docker/Codespaces/GitHub
      // Actions all root applications under one of these. Without
      // these, a worker error from a containerized host leaks the
      // deploy layout + package versions inside `/app/node_modules/`.
      .replace(new RegExp(`\\/app\\/${TAIL}`, "g"), "<app>")
      .replace(new RegExp(`\\/srv\\/${TAIL}`, "g"), "<srv>")
      .replace(new RegExp(`\\/workspace\\/${TAIL}`, "g"), "<workspace>")
      .replace(new RegExp(`\\/data\\/${TAIL}`, "g"), "<data>")
      // /etc and /root — high-sensitivity Linux paths (config files,
      // root home). A snippet that throws referencing one of these
      // should not echo the absolute path back to the caller.
      .replace(new RegExp(`\\/etc\\/${TAIL}`, "g"), "<etc>")
      .replace(new RegExp(`\\/root\\/${TAIL}`, "g"), "<root>")
  );
}
