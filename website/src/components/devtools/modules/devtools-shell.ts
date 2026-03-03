// @ts-nocheck -- TODO: fix createModule generic inference in @directive-run/core for complex schemas
import { createModule, t } from "@directive-run/core";
import type { VIEWS } from "../constants";

type ViewName = (typeof VIEWS)[number];
type DrawerPosition = "bottom" | "right";

// ---------------------------------------------------------------------------
// localStorage persistence for drawer preferences
// ---------------------------------------------------------------------------

const DRAWER_PREFS_KEY = "directive-devtools-prefs";

interface DrawerPrefs {
  position: DrawerPosition;
  height: number;
  width: number;
}

function loadDrawerPrefs(): Partial<DrawerPrefs> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = localStorage.getItem(DRAWER_PREFS_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    const result: Partial<DrawerPrefs> = {};

    // #15: Validate parsed values — reject anything out of range
    if (parsed.position === "bottom" || parsed.position === "right") {
      result.position = parsed.position;
    }
    if (
      typeof parsed.height === "number" &&
      parsed.height >= 200 &&
      parsed.height <= 2000
    ) {
      result.height = parsed.height;
    }
    if (
      typeof parsed.width === "number" &&
      parsed.width >= 320 &&
      parsed.width <= 2000
    ) {
      result.width = parsed.width;
    }

    return result;
  } catch {
    return {};
  }
}

function saveDrawerPrefs(prefs: DrawerPrefs) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    localStorage.setItem(DRAWER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Silently ignore quota errors
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const devtoolsShell = createModule("shell", {
  schema: {
    facts: {
      activeView: t.string<ViewName>(),
      isFullscreen: t.boolean(),
      confirmClear: t.boolean(),
      // Drawer state
      drawerOpen: t.boolean(),
      drawerPosition: t.string<DrawerPosition>(),
      drawerHeight: t.number(),
      drawerWidth: t.number(),
    },
    events: {
      setView: { view: t.string<ViewName>() },
      toggleFullscreen: {},
      exitFullscreen: {},
      startClear: {},
      executeClear: {},
      cancelClear: {},
      // Drawer events
      openDrawer: {},
      closeDrawer: {},
      toggleDrawer: {},
      setDrawerPosition: { position: t.string<DrawerPosition>() },
      setDrawerSize: { height: t.number(), width: t.number() },
    },
  },

  init: (facts) => {
    const prefs = loadDrawerPrefs();
    facts.activeView = "Facts";
    facts.isFullscreen = false;
    facts.confirmClear = false;
    facts.drawerOpen = false;
    facts.drawerPosition = prefs.position ?? "bottom";
    facts.drawerHeight = prefs.height ?? 400;
    facts.drawerWidth = prefs.width ?? 480;
  },

  events: {
    setView: (facts, { view }) => {
      facts.activeView = view;
    },
    toggleFullscreen: (facts) => {
      facts.isFullscreen = !facts.isFullscreen;
    },
    exitFullscreen: (facts) => {
      facts.isFullscreen = false;
    },
    startClear: (facts) => {
      facts.confirmClear = true;
    },
    executeClear: (facts) => {
      facts.confirmClear = false;
    },
    cancelClear: (facts) => {
      facts.confirmClear = false;
    },
    openDrawer: (facts) => {
      facts.drawerOpen = true;
    },
    closeDrawer: (facts) => {
      facts.drawerOpen = false;
    },
    toggleDrawer: (facts) => {
      facts.drawerOpen = !facts.drawerOpen;
    },
    setDrawerPosition: (facts, { position }) => {
      facts.drawerPosition = position;
    },
    setDrawerSize: (facts, { height, width }) => {
      if (height !== undefined) {
        facts.drawerHeight = height;
      }
      if (width !== undefined) {
        facts.drawerWidth = width;
      }
    },
  },

  // Persist drawer preferences when they change
  effects: {
    persistDrawerPrefs: {
      run: (facts, prev) => {
        if (
          prev &&
          (facts.drawerPosition !== prev.drawerPosition ||
            facts.drawerHeight !== prev.drawerHeight ||
            facts.drawerWidth !== prev.drawerWidth)
        ) {
          saveDrawerPrefs({
            position: facts.drawerPosition as DrawerPosition,
            height: facts.drawerHeight,
            width: facts.drawerWidth,
          });
        }
      },
    },
  },

  // Auto-cancel clear confirmation after 5 seconds
  constraints: {
    clearTimeout: {
      when: (facts) => facts.confirmClear === true,
      require: { type: "CANCEL_STALE_CLEAR" },
    },
  },

  resolvers: {
    cancelStaleClear: {
      requirement: "CANCEL_STALE_CLEAR",
      // Dedupe key prevents duplicate resolvers when constraint re-fires
      key: () => "cancel-stale-clear",
      resolve: async (req, context) => {
        await new Promise((r) => setTimeout(r, 5000));
        if (context.facts.confirmClear) {
          context.facts.confirmClear = false;
        }
      },
    },
  },
});
