"use client";

import { useState } from "react";

import { useLogoPreset } from "@/lib/LogoPresetContext";
import { contrastRatio, meetsAA } from "@/lib/logo-contrast";
import { LOGO_PRESETS, resolveColor, type LogoPreset } from "@/lib/logo-presets";
import { LogoPresetThumbnail } from "./LogoPresetThumbnail";

function ContrastBadge({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const ratio = contrastRatio(fg, bg);
  const passes = meetsAA(fg, bg);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        passes
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      }`}
    >
      {label} {ratio.toFixed(1)}:1
    </span>
  );
}

function PresetCard({
  preset,
  isActive,
  isSelected,
  onSelect,
  onApply,
}: {
  preset: LogoPreset;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onApply: () => void;
}) {
  const barLight = resolveColor("bar", "light");
  const barDark = resolveColor("bar", "dark");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      className={`group relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border p-4 transition-all ${
        isSelected
          ? "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/30"
          : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
      }`}
    >
      {isActive && (
        <span className="absolute top-2 left-2 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Active
        </span>
      )}

      {/* Dark + light preview side by side */}
      <div className="flex gap-2">
        <div className="flex items-center justify-center rounded-lg bg-[#0f172a] p-3">
          <LogoPresetThumbnail preset={preset} size={48} />
        </div>
        <div className="flex items-center justify-center rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <LogoPresetThumbnail preset={preset} size={48} />
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {preset.name}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          {preset.description}
        </p>
      </div>

      {/* Contrast badges */}
      <div className="flex flex-wrap justify-center gap-1">
        <ContrastBadge fg={barLight} bg="#ffffff" label="Light" />
        <ContrastBadge fg={barDark} bg="#0f172a" label="Dark" />
      </div>

      {/* Apply button */}
      {isSelected && !isActive && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
          className="mt-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-600"
        >
          Apply as site logo
        </button>
      )}
    </div>
  );
}

export function LogoShowcase() {
  const [selected, setSelected] = useState<string | null>(null);
  const { preset: activePreset, setPreset } = useLogoPreset();

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {LOGO_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isActive={activePreset.id === preset.id}
            isSelected={selected === preset.id}
            onSelect={() =>
              setSelected(selected === preset.id ? null : preset.id)
            }
            onApply={() => setPreset(preset)}
          />
        ))}
      </div>

      {/* Expanded detail view */}
      {selected &&
        (() => {
          const preset = LOGO_PRESETS.find((p) => p.id === selected);
          if (!preset) {
            return null;
          }

          return (
            <div className="space-y-6 rounded-xl border border-slate-200 p-6 dark:border-slate-700">
              <h3 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                {preset.name}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {preset.description}
              </p>

              {/* Size comparison */}
              <div className="space-y-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Size Comparison
                </h4>
                <div className="flex items-end gap-6">
                  {[16, 24, 32, 48, 64, 96].map((size) => (
                    <div key={size} className="flex flex-col items-center gap-2">
                      <div className="flex items-center justify-center rounded bg-[#0f172a] p-2">
                        <LogoPresetThumbnail preset={preset} size={size} />
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {size}px
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Context previews */}
              <div className="space-y-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-slate-400">
                  Context Previews
                </h4>
                <div className="flex items-center gap-6">
                  {/* Mini header */}
                  <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 ring-1 ring-slate-200">
                    <LogoPresetThumbnail preset={preset} size={24} />
                    <span
                      className="text-sm font-medium text-slate-900"
                      style={{
                        fontFamily:
                          "var(--font-lexend), system-ui, sans-serif",
                      }}
                    >
                      directive
                    </span>
                  </div>
                  {/* Mini favicon */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center justify-center rounded-md bg-[#0f172a] p-1">
                      <LogoPresetThumbnail preset={preset} size={20} />
                    </div>
                    <span className="text-[10px] text-slate-400">Favicon</span>
                  </div>
                  {/* Mini footer */}
                  <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200">
                    <LogoPresetThumbnail preset={preset} size={18} />
                    <span className="text-xs font-medium text-slate-700">
                      Directive
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
