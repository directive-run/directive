// A full-featured app: derivations, constraints, resolvers, a gated source,
// history, and two modules with a cross-module dependency.
import { createModule, createSystem, t } from "@directive-run/core";

const auth = createModule("auth", {
  schema: {
    facts: { token: t.string() },
    events: { login: { token: t.string() } },
  },
  init: (facts) => {
    facts.token = "";
  },
  events: {
    login: (facts, { token }) => {
      facts.token = token;
    },
  },
});

const notes = createModule("notes", {
  schema: {
    facts: { draft: t.string(), saved: t.number(), online: t.boolean() },
    derivations: { dirty: t.boolean() },
    events: { edit: { text: t.string() }, ONLINE: { online: t.boolean() } },
    requirements: { SAVE: { text: t.string() } },
  },
  crossModuleDeps: { auth: auth.schema },
  init: (facts) => {
    facts.draft = "";
    facts.saved = 0;
    facts.online = true;
  },
  derive: {
    dirty: (facts) => facts.self.draft !== "",
  },
  events: {
    edit: (facts, { text }) => {
      facts.draft = text;
    },
    ONLINE: (facts, { online }) => {
      facts.online = online;
    },
  },
  constraints: {
    save: {
      when: (facts) =>
        facts.self.draft !== "" && facts.self.online && facts.auth.token !== "",
      require: (facts) => ({ type: "SAVE", text: facts.self.draft }),
    },
  },
  resolvers: {
    save: {
      requirement: "SAVE",
      resolve: async (req, context) => {
        await fetch("/notes", { method: "POST", body: req.text });
        context.facts.draft = "";
        context.facts.saved += 1;
      },
    },
  },
  sources: {
    connectivity: {
      active: (facts) => facts.self.draft !== "",
      attach: (publish) => {
        const onChange = () => publish("ONLINE", { online: navigator.onLine });
        window.addEventListener("online", onChange);
        window.addEventListener("offline", onChange);

        return () => {
          window.removeEventListener("online", onChange);
          window.removeEventListener("offline", onChange);
        };
      },
    },
  },
  effects: {
    render: {
      run: (facts) => {
        document.title = facts.self.draft;
      },
    },
  },
});

const system = createSystem({ modules: { auth, notes }, history: true });
system.start();
system.events.auth.login({ token: "t" });
system.events.notes.edit({ text: "hello" });
