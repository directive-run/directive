"use client";

import { useCallback, useState } from "react";

export interface StackBlitzProjectFiles {
  [path: string]: string;
}

export function StackBlitzOpen({
  title,
  projectFiles,
}: {
  title: string;
  projectFiles: StackBlitzProjectFiles;
}) {
  const [loading, setLoading] = useState(false);

  const handleOpen = useCallback(async () => {
    setLoading(true);
    try {
      const sdk = await import("@stackblitz/sdk");
      sdk.default.openProject(
        {
          title: `Directive: ${title}`,
          template: "node",
          files: projectFiles,
        },
        { openFile: "src/main.ts" },
      );
    } catch (err) {
      console.error("[StackBlitz] Failed to open project:", err);
    } finally {
      setLoading(false);
    }
  }, [title, projectFiles]);

  return (
    <button
      onClick={handleOpen}
      disabled={loading}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-700/50 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-wait disabled:opacity-60"
    >
      <svg
        viewBox="0 0 28 28"
        fill="none"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M12.747 16.273h-7.46L18.925 1.5l-3.671 10.227h7.46L9.075 26.5l3.672-10.227Z" fill="currentColor" />
      </svg>
      {loading ? "Opening..." : "Open in StackBlitz"}
    </button>
  );
}
