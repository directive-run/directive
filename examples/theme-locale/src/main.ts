/**
 * Theme & Locale — DOM Rendering & System Wiring
 *
 * Creates the Directive system with two modules (preferences + layout),
 * subscribes to state changes, and renders theme controls, locale selector,
 * sidebar toggle, and translated preview area.
 */

import { createSystem } from "@directive-run/core";
import { devtoolsPlugin, persistencePlugin } from "@directive-run/core/plugins";
import {
  type Breakpoint,
  type ThemeChoice,
  type Translations,
  layoutModule,
  preferencesModule,
} from "./theme-locale.js";

// ============================================================================
// System
// ============================================================================

const system = createSystem({
  modules: {
    preferences: preferencesModule,
    layout: layoutModule,
  },
  plugins: [
    devtoolsPlugin({ name: "theme-locale" }),
    persistencePlugin({
      storage: localStorage,
      key: "directive-theme-locale-example",
      include: [
        "preferences::theme",
        "preferences::locale",
        "preferences::sidebarOpen",
      ],
    }),
  ],
});
system.start();

const allKeys = ["preferences.*", "layout.*"];

// ============================================================================
// System dark-mode media query
// ============================================================================

const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
system.events.preferences.setSystemPreference({ value: darkMq.matches });
darkMq.addEventListener("change", (e) => {
  system.events.preferences.setSystemPreference({ value: e.matches });
});

// ============================================================================
// Responsive breakpoint tracking
// ============================================================================

function detectBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w < 640) {
    return "mobile";
  }
  if (w < 1024) {
    return "tablet";
  }

  return "desktop";
}

system.events.layout.setBreakpoint({ value: detectBreakpoint() });
window.addEventListener("resize", () => {
  system.events.layout.setBreakpoint({ value: detectBreakpoint() });
});

// ============================================================================
// DOM References
// ============================================================================

const themeLightBtn = document.getElementById(
  "tl-theme-light",
) as HTMLButtonElement;
const themeDarkBtn = document.getElementById(
  "tl-theme-dark",
) as HTMLButtonElement;
const themeSystemBtn = document.getElementById(
  "tl-theme-system",
) as HTMLButtonElement;
const localeSelect = document.getElementById(
  "tl-locale-select",
) as HTMLSelectElement;
const sidebarToggle = document.getElementById(
  "tl-sidebar-toggle",
) as HTMLButtonElement;

const effectiveThemeEl = document.getElementById("tl-effective-theme")!;
const headerLocaleEl = document.getElementById("tl-header-locale")!;
const headerBreakpointEl = document.getElementById("tl-header-breakpoint")!;

const previewEl = document.getElementById("tl-preview")!;

// ============================================================================
// Render
// ============================================================================

function render(): void {
  const facts = system.facts;
  const derive = system.derive;

  const theme = facts.preferences.theme as ThemeChoice;
  const locale = facts.preferences.locale as string;
  const sidebarOpen = facts.preferences.sidebarOpen as boolean;
  const translations = facts.preferences.translations as Translations;
  const effectiveTheme = derive.preferences.effectiveTheme as string;
  const isRTL = derive.preferences.isRTL as boolean;
  const breakpoint = facts.layout.breakpoint as Breakpoint;

  // --- Header ---
  effectiveThemeEl.textContent = effectiveTheme;
  effectiveThemeEl.className = `tl-badge tl-badge-${effectiveTheme}`;
  headerLocaleEl.textContent = locale.toUpperCase();
  headerBreakpointEl.textContent = breakpoint;

  // --- Theme buttons ---
  const themeButtons = [
    { el: themeLightBtn, value: "light" },
    { el: themeDarkBtn, value: "dark" },
    { el: themeSystemBtn, value: "system" },
  ];
  for (const btn of themeButtons) {
    btn.el.classList.toggle("tl-btn-active", theme === btn.value);
  }

  // --- Locale select ---
  localeSelect.value = locale;

  // --- Sidebar toggle ---
  sidebarToggle.textContent = sidebarOpen ? "Hide Sidebar" : "Show Sidebar";
  sidebarToggle.classList.toggle("tl-btn-active", sidebarOpen);

  // --- Preview area ---
  const themeColors =
    effectiveTheme === "dark"
      ? { bg: "#1e293b", text: "#cbd5e1", accent: "#5ba3a3", muted: "#94a3b8" }
      : { bg: "#f8fafc", text: "#1e293b", accent: "#0d9488", muted: "#64748b" };

  previewEl.style.background = themeColors.bg;
  previewEl.style.color = themeColors.text;
  previewEl.setAttribute("dir", isRTL ? "rtl" : "ltr");

  previewEl.innerHTML = `
    <div class="tl-preview-header" style="color: ${themeColors.accent}; font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem;">
      ${escapeHtml(translations.greeting)}!
    </div>
    <div class="tl-preview-grid">
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${themeColors.muted};">${escapeHtml(translations.settings)}</span>
        <span class="tl-preview-icon">&#9881;</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${themeColors.muted};">${escapeHtml(translations.theme)}</span>
        <span class="tl-preview-icon">${effectiveTheme === "dark" ? "&#9790;" : "&#9728;"}</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${themeColors.muted};">${escapeHtml(translations.language)}</span>
        <span class="tl-preview-icon">${escapeHtml(locale.toUpperCase())}</span>
      </div>
      <div class="tl-preview-item">
        <span class="tl-preview-label" style="color: ${themeColors.muted};">${escapeHtml(translations.sidebar)}</span>
        <span class="tl-preview-icon">${sidebarOpen ? "&#9776;" : "&#10005;"}</span>
      </div>
    </div>
  `;
}

// ============================================================================
// Subscribe
// ============================================================================

system.subscribe(allKeys, render);

// ============================================================================
// Controls
// ============================================================================

themeLightBtn.addEventListener("click", () => {
  system.events.preferences.setTheme({ value: "light" });
});

themeDarkBtn.addEventListener("click", () => {
  system.events.preferences.setTheme({ value: "dark" });
});

themeSystemBtn.addEventListener("click", () => {
  system.events.preferences.setTheme({ value: "system" });
});

localeSelect.addEventListener("change", () => {
  system.events.preferences.setLocale({ value: localeSelect.value });
});

sidebarToggle.addEventListener("click", () => {
  system.events.preferences.toggleSidebar();
});

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;

  return div.innerHTML;
}

// ============================================================================
// Initial Render
// ============================================================================

render();

// Signal to tests that the module script has fully initialized
document.body.setAttribute("data-theme-locale-ready", "true");
