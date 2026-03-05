import { createModule, t } from "@directive-run/core";

export type InspectorTab = "facts" | "derivations" | "pipeline" | "activity";

export const inspectorModule = createModule("inspector", {
  schema: {
    facts: {
      open: t.boolean(),
      activeTab: t.string<InspectorTab>(),
    },
    derivations: {
      buttonLabel: t.string(),
    },
    events: {
      toggle: {},
      open: {},
      selectTab: { tab: t.string<InspectorTab>() },
    },
  },

  init: (facts) => {
    facts.open = false;
    facts.activeTab = "facts";
  },

  derive: {
    buttonLabel: (facts) =>
      facts.open ? "Hide Inspector" : "Inspect Runtime",
  },

  events: {
    toggle: (facts) => {
      facts.open = !facts.open;
    },
    open: (facts) => {
      facts.open = true;
    },
    selectTab: (facts, { tab }) => {
      facts.activeTab = tab;
    },
  },
});
