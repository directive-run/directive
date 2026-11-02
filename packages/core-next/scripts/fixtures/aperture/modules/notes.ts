import { createModule } from "@directive-run/core";
import { pingLanding, showCaption } from "../../../scene/dom";
import { type ApertureDeps, announcerSchema, notesSchema, sceneSchema } from "../schemas";

// the card lands near the end of its 1.3 s flight; the room reacts then
const LANDING_AT_MS = 1040;

// The guestbook: which notes are visible and what's being submitted. The rule (a draft needs
// submitting) and the work (submit it, with retry when a backend arrives) are separate pieces.
// It reads the scene's params and reduced-motion preference; it writes only its own facts.
export const createNotesModule = ({ view, card, store, live }: ApertureDeps) =>
  createModule("notes", {
    schema: notesSchema,
    crossModuleDeps: { scene: sceneSchema },

    init: (facts) => {
      facts.notes = store.listVisible();
      facts.draft = null;
      facts.submission = null;
      facts.caption = { text: "", at: 0 };
    },

    events: {
      submitNote: (facts, { draft }) => {
        facts.draft = draft;
      },
      notesChanged: (facts, { notes }) => {
        facts.notes = notes;
      },
    },

    constraints: {
      draftNeedsSubmitting: {
        when: (facts) => facts.self.draft !== null,
        require: (facts) => facts.self.draft && { type: "SUBMIT_NOTE", draft: facts.self.draft },
      },
    },

    resolvers: {
      submitNote: {
        requirement: "SUBMIT_NOTE",
        resolve: async (req, ctx) => {
          const { target, ...draft } = req.draft;
          const result = store.submit(draft);
          const seq = (ctx.facts.submission?.seq ?? 0) + 1;
          ctx.facts.submission = result.ok
            ? { seq, ok: true, noteId: result.note.id, reason: "", target }
            : { seq, ok: false, noteId: "", reason: result.reason, target };
          if (!result.ok) ctx.facts.caption = { text: result.reason, at: performance.now() };
          ctx.facts.draft = null;
        },
      },
    },

    effects: {
      // deps keep each effect re-running on its own facts only, not on every scene change it reads
      notes: { deps: ["notes"], run: (facts) => view.setNotes([...facts.self.notes], facts.scene.params) },
      // the card flies on success and shakes on failure; the room reacts when it lands
      submission: {
        deps: ["submission"],
        onNavigate: "skip",
        run: (facts) => {
          const submission = facts.self.submission;
          if (!submission) return;
          if (!submission.ok) {
            card.shake();
            return;
          }
          const reduced = facts.scene.reducedMotion;
          const { x, y } = submission.target;
          const landing = window.setTimeout(
            () => {
              live.landed(x, y);
              if (!reduced) pingLanding(x, y);
            },
            reduced ? 0 : LANDING_AT_MS,
          );
          card.fly(submission.target, reduced, () => live.noteLanded(submission.noteId));

          return () => window.clearTimeout(landing);
        },
      },
    },

    sources: {
      store: { attach: (publish) => store.subscribe(() => publish("notesChanged", { notes: store.listVisible() })) },
    },
  });

// The status line owns no state: it derives the newest caption from whichever module spoke last
export const createAnnouncerModule = ({ el }: ApertureDeps) =>
  createModule("announcer", {
    schema: announcerSchema,
    crossModuleDeps: { scene: sceneSchema, notes: notesSchema },
    derive: {
      latest: (facts) => (facts.notes.caption.at > facts.scene.caption.at ? facts.notes.caption : facts.scene.caption),
    },
    effects: {
      show: { run: (_facts, _prev, derived) => (derived.latest.text ? showCaption(el.caption, derived.latest.text) : undefined) },
    },
  });
