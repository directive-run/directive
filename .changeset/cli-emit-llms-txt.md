---
"@directive-run/cli": patch
---

Write `llms.txt` into the package during the build. The `./llms.txt` export and the `llms` metadata field both pointed at `dist/llms.txt`, which nothing generated — so an install resolved the export to a file that was not there. The generator runs after the bundler, since the bundler cleans the output directory, and it refuses to write an implausibly small file rather than shipping an export that exists but says nothing.
