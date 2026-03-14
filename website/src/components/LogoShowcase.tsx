"use client";

import { useState } from "react";
import { LOGO_CONCEPTS } from "./LogoConcepts";

export function LogoShowcase() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {/* Grid of all concepts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {LOGO_CONCEPTS.map(({ id, name, rank, Component, description }) => (
          <button
            key={id}
            onClick={() => setSelected(selected === id ? null : id)}
            className={`group relative flex flex-col items-center gap-3 rounded-xl border p-4 transition-all ${
              selected === id
                ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/30"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
            }`}
          >
            {/* Rank badge */}
            {rank !== "—" && (
              <span className="absolute top-2 right-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {rank}
              </span>
            )}

            {/* Dark background preview */}
            <div className="flex items-center justify-center rounded-lg bg-[#0f172a] p-4">
              <Component size={64} />
            </div>

            {/* Label */}
            <div className="text-center">
              <p className="text-sm font-medium text-slate-900 dark:text-white">{name}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Expanded view for selected concept */}
      {selected && (() => {
        const concept = LOGO_CONCEPTS.find((c) => c.id === selected);
        if (!concept) {
          return null;
        }

        const { Component, name, description } = concept;

        return (
          <div className="space-y-6 rounded-xl border border-slate-200 p-6 dark:border-slate-700">
            <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              {name}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>

            {/* Size comparison */}
            <div className="space-y-4">
              <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">Size Comparison</h4>
              <div className="flex items-end gap-6">
                {[16, 24, 32, 48, 64, 96, 128].map((size) => (
                  <div key={size} className="flex flex-col items-center gap-2">
                    <div className="flex items-center justify-center rounded bg-[#0f172a] p-2">
                      <Component size={size} />
                    </div>
                    <span className="text-[10px] text-slate-400">{size}px</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Dark vs Light */}
            <div className="space-y-4">
              <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">Background Variants</h4>
              <div className="flex gap-4">
                <div className="flex items-center justify-center rounded-lg bg-[#0f172a] p-8">
                  <Component size={80} />
                </div>
                <div className="flex items-center justify-center rounded-lg bg-white p-8 ring-1 ring-slate-200">
                  <Component size={80} />
                </div>
                <div className="flex items-center justify-center rounded-lg bg-slate-100 p-8">
                  <Component size={80} />
                </div>
              </div>
            </div>

            {/* Lockup preview */}
            <div className="space-y-4">
              <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">Logotype Lockup</h4>
              <div className="flex items-center gap-4 rounded-lg bg-[#0f172a] p-8">
                <Component size={36} />
                <span
                  className="text-lg font-medium tracking-tight text-white"
                  style={{ fontFamily: "var(--font-lexend), system-ui, sans-serif" }}
                >
                  directive
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
