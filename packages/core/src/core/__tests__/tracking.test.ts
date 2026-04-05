import { describe, expect, it } from "vitest";
import {
  getCurrentDeps,
  isTracking,
  trackAccess,
  withTracking,
  withoutTracking,
} from "../tracking.js";

describe("tracking", () => {
  describe("isTracking", () => {
    it("returns false when no tracking is active", () => {
      expect(isTracking()).toBe(false);
    });

    it("returns true inside withTracking", () => {
      withTracking(() => {
        expect(isTracking()).toBe(true);
      });
    });
  });

  describe("withTracking", () => {
    it("captures accessed keys via trackAccess", () => {
      const { deps } = withTracking(() => {
        trackAccess("foo");
        trackAccess("bar");
      });

      expect(deps).toEqual(new Set(["foo", "bar"]));
    });

    it("returns the computed value and deps", () => {
      const { value, deps } = withTracking(() => {
        trackAccess("x");

        return 42;
      });

      expect(value).toBe(42);
      expect(deps).toEqual(new Set(["x"]));
    });

    it("isolates nested contexts — inner does not leak to outer", () => {
      const { deps: outerDeps } = withTracking(() => {
        trackAccess("outer");

        const { deps: innerDeps } = withTracking(() => {
          trackAccess("inner");
        });

        expect(innerDeps).toEqual(new Set(["inner"]));
      });

      expect(outerDeps).toEqual(new Set(["outer"]));
    });

    it("deduplicates multiple trackAccess calls for the same key", () => {
      const { deps } = withTracking(() => {
        trackAccess("dup");
        trackAccess("dup");
        trackAccess("dup");
      });

      expect(deps.size).toBe(1);
      expect(deps).toEqual(new Set(["dup"]));
    });

    it("restores tracking stack when callback throws", () => {
      expect(() =>
        withTracking(() => {
          throw new Error("boom");
        }),
      ).toThrow("boom");

      expect(isTracking()).toBe(false);
    });
  });

  describe("withoutTracking", () => {
    it("suppresses tracking and returns the value", () => {
      const result = withoutTracking(() => {
        expect(isTracking()).toBe(false);

        return "hello";
      });

      expect(result).toBe("hello");
    });

    it("inside withTracking — outer tracking resumes after", () => {
      const { deps } = withTracking(() => {
        trackAccess("before");

        withoutTracking(() => {
          trackAccess("suppressed");
        });

        trackAccess("after");
      });

      expect(deps).toEqual(new Set(["before", "after"]));
    });

    it("restores tracking stack when callback throws", () => {
      withTracking(() => {
        expect(() =>
          withoutTracking(() => {
            throw new Error("fail");
          }),
        ).toThrow("fail");

        expect(isTracking()).toBe(true);
      });
    });
  });

  describe("trackAccess", () => {
    it("is a no-op when not tracking", () => {
      expect(() => trackAccess("safe")).not.toThrow();
    });
  });

  describe("getCurrentDeps", () => {
    it("returns null when not tracking", () => {
      expect(getCurrentDeps()).toBeNull();
    });

    it("returns the active dependency Set inside withTracking", () => {
      withTracking(() => {
        const deps = getCurrentDeps();

        expect(deps).not.toBeNull();
        deps!.add("manual");
        expect(deps).toContain("manual");
      });
    });
  });
});
