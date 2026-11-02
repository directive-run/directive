import { createModule, type InferFacts, type SourcePublish } from "@directive-run/core";
import { arriveRoom, isTyping, routeFromHash, showContact, showPaused, syncNav } from "../../../scene/dom";
import { attachPointer } from "../../../scene/input/pointer";
import { easeTilt } from "../../../scene/input/tilt";
import { aimOf, createMotion, depthOf, eyeDistanceOf, hasArrived, isHomeHidden, isSettling, stepMotion } from "../../../scene/motion";
import { createNoteFocus, stepNoteFocus } from "../../../scene/noteFocus";
import { createRipples, pushRipple } from "../../../scene/ripples";
import { BOOT_DONE, bootAt, exitProgress } from "../../../scene/timeline";
import { type ApertureDeps, sceneSchema } from "../schemas";

const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
const HIRE = "hire";
const RIPPLE_SPEED = 6;
const SPOTLIGHT_MS = 4500;

// a DOM listener as a source: attached on start, removed on stop
const listen = (target: EventTarget, type: string, on: (publish: SourcePublish, e: Event) => void, opts?: AddEventListenerOptions) => ({
  attach: (publish: SourcePublish) => {
    const handler = (e: Event) => on(publish, e);
    target.addEventListener(type, handler, opts);
    return () => target.removeEventListener(type, handler);
  },
});

// Everything one frame reads: what the browser reports, what the visitor chose, and what moves.
// Event handlers are the only writers and stay deterministic (randomness arrives in payloads),
// so history can rewind the scene and replay it exactly. Effects only touch the DOM.
export const createSceneModule = ({ el, view, initialParams }: ApertureDeps) => {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const roomIds = view.rooms.map((r) => r.id);
  const depthOfRoom = (id: string) => view.rooms.find((r) => r.id === id)?.z;
  const caption = (text: string, at: number) => ({ text, at });

  return createModule("scene", {
    schema: sceneSchema,

    init: (facts) => {
      const reduced = reducedQuery.matches;
      facts.reducedMotion = reduced;
      facts.tabVisible = !document.hidden;
      facts.onScreen = true;
      facts.exit = 0;
      facts.viewportSeq = 0;
      facts.tilt = { active: false, x: 0, y: 0 };
      facts.route = routeFromHash(roomIds);
      facts.paused = false;
      facts.params = { ...initialParams };
      facts.contactOpen = false;
      facts.palette = initialParams.palette;
      facts.konamiStep = 0;
      facts.typedTail = "";
      facts.focusHomeSeq = 0;
      facts.leaveRoomSeq = 0;
      facts.lastNow = performance.now();
      facts.dt = 0;
      facts.awake = true;
      facts.motion = createMotion(view.rooms.length);
      facts.boot = { ...BOOT_DONE };
      facts.bootAt = performance.now();
      facts.bootDone = reduced;
      facts.ripples = createRipples();
      facts.noteFocus = createNoteFocus();
      facts.pointer = { x: 0, y: 0, hasMoved: false, lastMoveAt: -Infinity, held: false };
      facts.spotlight = { id: "", until: 0 };
      facts.arrivedRoom = "";
      facts.homeInert = facts.route !== "home";
      facts.fps = 0;
      facts.caption = caption("", 0);
    },

    derive: {
      moving: (facts) => !facts.paused && facts.tabVisible && facts.onScreen && !facts.reducedMotion,
    },

    events: {
      // one frame: advance the clock, step the motion, light the notes, decide arrival
      tick: (facts, { now }) => {
        const { params, route } = facts;
        const reduced = facts.reducedMotion;
        const moving = !facts.paused && facts.tabVisible && facts.onScreen && !reduced;
        const dt = Math.min((now - facts.lastNow) / 1000, 0.05);

        const elapsed = (now - facts.bootAt) / 1000;
        const bootDone = facts.bootDone || reduced || elapsed > params.introDuration + 0.7;
        const boot = bootDone ? BOOT_DONE : bootAt(elapsed, params.introDuration);

        const aim = aimOf({ pointer: facts.pointer, tilt: facts.tilt, time: facts.motion.time, moving, aspect: view.aspect, params });
        const travelTarget = depthOfRoom(route) ?? 0;
        const motion = stepMotion(
          facts.motion,
          {
            dt,
            moving,
            aimX: aim.x,
            aimY: aim.y,
            eyeRange: (reduced ? 0.15 : 1) * params.parallax * boot.parallax,
            diving: facts.pointer.held && route === "home" && !reduced,
            travelTarget,
            invertTarget: facts.contactOpen ? 1 : 0,
            roomTargets: roomIds.map((id) => id === route),
          },
          params,
        );

        const depth = depthOf(motion);
        const spotlight = now < facts.spotlight.until ? view.notes.indexOf(facts.spotlight.id) : -1;
        facts.noteFocus = stepNoteFocus(facts.noteFocus, {
          positions: view.notes.positions,
          count: view.notes.count,
          eyeX: motion.eyeX,
          eyeY: motion.eyeY,
          eyeDistance: eyeDistanceOf(params, facts.exit),
          depth,
          lightX: motion.lightX,
          lightY: motion.lightY,
          radius: params.noteRevealRadius,
          dt: moving ? dt : 1,
          spotlight,
          pointer: facts.pointer.hasMoved && !aim.idle && !facts.tilt.active ? facts.pointer : null,
        });

        const arrived = route !== "home" && hasArrived(travelTarget, depth) ? route : "";
        if (arrived !== facts.arrivedRoom) facts.arrivedRoom = arrived;
        const inert = route !== "home" || isHomeHidden(depth);
        if (inert !== facts.homeInert) facts.homeInert = inert;

        facts.motion = motion;
        facts.boot = boot;
        facts.bootDone = bootDone;
        facts.lastNow = now;
        facts.dt = dt;
        facts.fps += (1 / Math.max(dt, 1e-3) - facts.fps) * 0.1;
        facts.awake =
          moving || (!bootDone && !reduced) || (!facts.paused && facts.tabVisible && isSettling(motion, travelTarget, spotlight >= 0));
      },

      pointerMoved: (facts, { x, y, speed }) => {
        if (facts.pointer.hasMoved && speed > RIPPLE_SPEED && !facts.reducedMotion) {
          facts.ripples = pushRipple(facts.ripples, x, y, facts.motion.time, Math.min(speed / 12, 1.2) * 0.6);
        }
        facts.pointer = { ...facts.pointer, x, y, hasMoved: true, lastMoveAt: facts.motion.time };
        facts.awake = true;
      },
      pointerHeld: (facts) => {
        facts.pointer = { ...facts.pointer, held: true };
        facts.awake = true;
      },
      pointerReleased: (facts, { click }) => {
        facts.pointer = { ...facts.pointer, held: false };
        if (click && !facts.reducedMotion) {
          facts.ripples = pushRipple(facts.ripples, facts.pointer.x, facts.pointer.y, facts.motion.time, 1.4);
          facts.motion = { ...facts.motion, degauss: 1 };
        }
        facts.awake = true;
      },

      keyPressed: (facts, { key, typing, column, row }) => {
        if (typing) return;
        if (key === "Escape") {
          // one Escape, one action: the open card takes it, otherwise leave the room
          if (facts.contactOpen) facts.contactOpen = false;
          else if (facts.route !== "home") facts.leaveRoomSeq += 1;
          facts.awake = true;
          return;
        }

        facts.konamiStep = key === KONAMI[facts.konamiStep] ? facts.konamiStep + 1 : key === KONAMI[0] ? 1 : 0;
        if (facts.konamiStep === KONAMI.length) {
          facts.konamiStep = 0;
          facts.palette = facts.palette === "sodium" ? "aperture" : "sodium";
          facts.motion = { ...facts.motion, degauss: 1 };
          facts.caption = caption(facts.palette === "sodium" ? "degaussed: sodium mode" : "degaussed: phosphor mode", facts.lastNow);
        }
        if (key.length !== 1) return;

        if (!facts.reducedMotion) facts.ripples = pushRipple(facts.ripples, column * view.aspect, row, facts.motion.time, 0.9);
        facts.typedTail = (facts.typedTail + key).slice(-HIRE.length);
        if (facts.typedTail === HIRE) {
          facts.typedTail = "";
          facts.contactOpen = !facts.contactOpen;
        }
        facts.awake = true;
      },

      routeChanged: (facts, { route }) => {
        if (route === "home" && facts.route !== "home") facts.focusHomeSeq += 1;
        facts.route = route;
        facts.caption = caption(route === "home" ? "back at the surface" : `travelling to ${route}`, facts.lastNow);
        facts.awake = true;
      },
      tabVisibility: (facts, { visible }) => {
        facts.tabVisible = visible;
        facts.awake = true;
      },
      onScreenChanged: (facts, { onScreen }) => {
        facts.onScreen = onScreen;
        facts.awake = true;
      },
      reducedMotionChanged: (facts, { reduced }) => {
        facts.reducedMotion = reduced;
        facts.awake = true;
      },
      scrolled: (facts, { exit }) => {
        facts.exit = exit;
        facts.awake = true;
      },
      resized: (facts) => {
        facts.viewportSeq += 1;
        facts.awake = true;
      },
      tiltRead: (facts, { x, y }) => {
        // tilt readings are noisy; ease toward each new one
        facts.tilt = easeTilt(facts.tilt, x, y);
        facts.awake = true;
      },
      togglePause: (facts) => {
        facts.paused = !facts.paused;
        facts.awake = true;
      },
      setParams: (facts, { params }) => {
        facts.params = { ...facts.params, ...params };
        facts.awake = true;
      },
      setPalette: (facts, { palette }) => {
        facts.palette = palette;
        facts.awake = true;
      },
      replayBoot: (facts, { at }) => {
        if (facts.reducedMotion) return;
        facts.bootAt = at;
        facts.bootDone = false;
        facts.awake = true;
      },
      closeContact: (facts) => {
        facts.contactOpen = false;
        facts.awake = true;
      },
      // a note card reached the room: dent it, ripple it
      landed: (facts, { x, y }) => {
        const at = view.toGlass(x, y);
        const reduced = facts.reducedMotion;
        facts.motion = { ...facts.motion, well: reduced ? 0 : 1, wellX: at.x, wellY: at.y };
        if (!reduced) facts.ripples = pushRipple(facts.ripples, at.x, at.y, facts.motion.time, 1.6);
        facts.awake = true;
      },
      noteLanded: (facts, { id, at }) => {
        facts.spotlight = { id, until: at + SPOTLIGHT_MS };
        facts.caption = caption("Your note landed in the room – it'll be public once Jason reads it.", at);
        facts.awake = true;
      },
      wake: (facts, { at }) => {
        // a fresh start for the clock, so the first frame after idling doesn't jump
        if (!facts.awake) facts.lastNow = at;
        facts.awake = true;
      },
    },

    effects: {
      draw: { run: (facts, _prev, derived) => view.draw(frameOf(facts, derived.moving), facts.dt) },
      measure: {
        run: (facts) => {
          void facts.viewportSeq;
          view.measure(facts.params);
        },
      },
      // views of state; 1.35 re-runs each after a history restore, so a rewind repaints them
      exit: { run: (facts) => view.setExit(facts.exit) },
      palette: { run: (facts) => view.setPalette(facts.palette) },
      nav: { run: (facts) => syncNav(el.nav, facts.route) },
      contact: { run: (facts) => showContact(el, facts.contactOpen) },
      pauseButton: { run: (facts) => showPaused(el.pauseBtn, facts.paused) },
      arrival: { run: (facts) => arriveRoom(el.rooms, facts.arrivedRoom) },
      homeInert: {
        run: (facts) => {
          el.content.inert = facts.homeInert;
        },
      },
      // the intro's CSS keyframes restart by removing and re-adding the class
      bootClass: {
        run: (facts) => {
          void facts.bootAt;
          el.stage.classList.remove("boot");
          if (facts.bootDone) return;
          void el.stage.offsetWidth;
          el.stage.classList.add("boot");
        },
      },
      // one-off DOM actions fire when their request counter moves, never on a rewind
      focusHome: {
        onNavigate: "skip",
        run: (facts, prev) => {
          if (prev && prev.focusHomeSeq !== facts.focusHomeSeq) el.headline.focus?.({ preventScroll: true });
        },
      },
      leaveRoom: {
        onNavigate: "skip",
        run: (facts, prev) => {
          if (prev && prev.leaveRoomSeq !== facts.leaveRoomSeq) location.hash = "";
        },
      },
    },

    sources: {
      // animation frames run only while something is moving
      frames: {
        active: (facts) => facts.awake,
        attach: (publish) => {
          let raf = requestAnimationFrame(function loop(now) {
            publish("tick", { now });
            raf = requestAnimationFrame(loop);
          });

          return () => cancelAnimationFrame(raf);
        },
      },
      pointer: {
        // re-attached when the hold time changes, so the listener never reads facts itself
        key: (facts) => String(facts.params.diveHoldMs),
        attach: (publish, _err, ctx) =>
          attachPointer({
            surface: el.stage,
            toGlass: view.toGlass,
            holdMs: () => Number(ctx?.key),
            move: (x, y, speed) => publish("pointerMoved", { x, y, speed }),
            hold: () => publish("pointerHeld"),
            release: (click) => publish("pointerReleased", { click }),
          }),
      },
      keys: listen(window, "keydown", (publish, e) => {
        const k = e as KeyboardEvent;
        if (k.metaKey || k.ctrlKey || k.altKey) return;
        // the ripple's position is chosen here, so the handler stays deterministic
        const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
        publish("keyPressed", {
          key,
          typing: isTyping(k.target),
          column: Math.round((Math.random() * 2 - 1) * 40) / 40,
          row: Math.random() * 1.6 - 0.8,
        });
      }),
      hash: listen(window, "hashchange", (publish) => publish("routeChanged", { route: routeFromHash(roomIds) })),
      visibility: listen(document, "visibilitychange", (publish) => publish("tabVisibility", { visible: !document.hidden })),
      reducedMotion: listen(reducedQuery, "change", (publish) => publish("reducedMotionChanged", { reduced: reducedQuery.matches })),
      scroll: listen(window, "scroll", (publish) => publish("scrolled", { exit: exitProgress(el.root) }), { passive: true }),
      onScreen: {
        attach: (publish) => {
          const observer = new IntersectionObserver(([entry]) => publish("onScreenChanged", { onScreen: entry.isIntersecting }));
          observer.observe(el.stage);

          return () => observer.disconnect();
        },
      },
      viewport: {
        attach: (publish) => {
          const observer = new ResizeObserver(() => publish("resized"));
          observer.observe(el.stage);
          // text masks are measured from rendered glyphs, so measure again once the fonts land
          void document.fonts.ready.then(() => publish("resized"));

          return () => observer.disconnect();
        },
      },
    },

    // time travel snapshots the moments a visitor would recognize, not every frame
    history: { snapshotEvents: ["routeChanged", "setPalette", "togglePause", "closeContact", "keyPressed"] },
  });
};

// what one draw needs, shared by the frame effect and capture()
export const frameOf = (f: Readonly<InferFacts<typeof sceneSchema>>, moving: boolean) => ({
  motion: f.motion,
  boot: f.boot,
  ripples: f.ripples.data,
  noteFocus: f.noteFocus,
  exit: f.exit,
  moving,
  reduced: f.reducedMotion,
  route: f.route,
  params: f.params,
});
