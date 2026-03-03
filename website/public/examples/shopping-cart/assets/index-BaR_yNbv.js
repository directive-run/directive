(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const o of document.querySelectorAll('link[rel="modulepreload"]')) i(o);
  new MutationObserver((o) => {
    for (const s of o)
      if (s.type === "childList")
        for (const d of s.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && i(d);
  }).observe(document, { childList: !0, subtree: !0 });
  function l(o) {
    const s = {};
    return (
      o.integrity && (s.integrity = o.integrity),
      o.referrerPolicy && (s.referrerPolicy = o.referrerPolicy),
      o.crossOrigin === "use-credentials"
        ? (s.credentials = "include")
        : o.crossOrigin === "anonymous"
          ? (s.credentials = "omit")
          : (s.credentials = "same-origin"),
      s
    );
  }
  function i(o) {
    if (o.ep) return;
    o.ep = !0;
    const s = l(o);
    fetch(o.href, s);
  }
})();
var Ke = class extends Error {
    constructor(t, l, i, o, s = !0) {
      super(t),
        (this.source = l),
        (this.sourceId = i),
        (this.context = o),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  he = [];
function Et() {
  const e = new Set();
  return {
    get isTracking() {
      return !0;
    },
    track(t) {
      e.add(t);
    },
    getDependencies() {
      return e;
    },
  };
}
var $t = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function Ct() {
  return he[he.length - 1] ?? $t;
}
function Re(e) {
  const t = Et();
  he.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    he.pop();
  }
}
function Ve(e) {
  const t = he.splice(0, he.length);
  try {
    return e();
  } finally {
    he.push(...t);
  }
}
function _e(e) {
  Ct().track(e);
}
function kt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Ae(e = [], t, l, i, o, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: i,
    _description: o,
    _refinements: s,
    validate(d) {
      return Ae([...e, d], t, l, i, o, s);
    },
  };
}
function te(e, t, l, i, o, s) {
  return {
    ...Ae(e, t, l, i, o, s),
    default(d) {
      return te(e, t, d, i, o, s);
    },
    transform(d) {
      return te(
        [],
        t,
        void 0,
        (u) => {
          const g = i ? i(u) : u;
          return d(g);
        },
        o,
      );
    },
    brand() {
      return te(e, `Branded<${t}>`, l, i, o, s);
    },
    describe(d) {
      return te(e, t, l, i, d, s);
    },
    refine(d, u) {
      const g = [...(s ?? []), { predicate: d, message: u }];
      return te([...e, d], t, l, i, o, g);
    },
    nullable() {
      return te(
        [(d) => d === null || e.every((u) => u(d))],
        `${t} | null`,
        l,
        i,
        o,
      );
    },
    optional() {
      return te(
        [(d) => d === void 0 || e.every((u) => u(d))],
        `${t} | undefined`,
        l,
        i,
        o,
      );
    },
  };
}
var G = {
  string() {
    return te([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, l, i, o, s) => ({
      ...te(t, "number", l, i, o, s),
      min(d) {
        return e([...t, (u) => u >= d], l, i, o, s);
      },
      max(d) {
        return e([...t, (u) => u <= d], l, i, o, s);
      },
      default(d) {
        return e(t, d, i, o, s);
      },
      describe(d) {
        return e(t, l, i, d, s);
      },
      refine(d, u) {
        const g = [...(s ?? []), { predicate: d, message: u }];
        return e([...t, d], l, i, o, g);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return te([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, i, o, s) => {
      const d = te(t, "array", i, void 0, o),
        u = s ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(g) {
          u.value = g;
        },
        of(g) {
          const p = { value: -1 };
          return e(
            [
              ...t,
              (c) => {
                for (let E = 0; E < c.length; E++) {
                  const _ = c[E];
                  if (!g._validators.every((O) => O(_)))
                    return (p.value = E), !1;
                }
                return !0;
              },
            ],
            g,
            i,
            o,
            p,
          );
        },
        nonEmpty() {
          return e([...t, (g) => g.length > 0], l, i, o, u);
        },
        maxLength(g) {
          return e([...t, (p) => p.length <= g], l, i, o, u);
        },
        minLength(g) {
          return e([...t, (p) => p.length >= g], l, i, o, u);
        },
        default(g) {
          return e(t, l, g, o, u);
        },
        describe(g) {
          return e(t, l, i, g, u);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, i) => ({
      ...te(t, "object", l, void 0, i),
      shape(o) {
        return e(
          [
            ...t,
            (s) => {
              for (const [d, u] of Object.entries(o)) {
                const g = s[d],
                  p = u;
                if (p && !p._validators.every((c) => c(g))) return !1;
              }
              return !0;
            },
          ],
          l,
          i,
        );
      },
      nonNull() {
        return e([...t, (o) => o != null], l, i);
      },
      hasKeys(...o) {
        return e([...t, (s) => o.every((d) => d in s)], l, i);
      },
      default(o) {
        return e(t, o, i);
      },
      describe(o) {
        return e(t, l, o);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return te(
      [(l) => typeof l == "string" && t.has(l)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return te([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return Ae(
      [(l) => (l === null ? !0 : e._validators.every((i) => i(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Ae(
      [(l) => (l === void 0 ? !0 : e._validators.every((i) => i(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return te(
      [(l) => e.some((i) => i._validators.every((o) => o(l)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return te(
      [
        (l) =>
          typeof l != "object" || l === null || Array.isArray(l)
            ? !1
            : Object.values(l).every((i) => e._validators.every((o) => o(i))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return te(
      [
        (l) =>
          !Array.isArray(l) || l.length !== e.length
            ? !1
            : e.every((i, o) => i._validators.every((s) => s(l[o]))),
      ],
      `[${t.join(", ")}]`,
    );
  },
  date() {
    return te([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return te([(t) => typeof t == "string" && e.test(t)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return te([(t) => typeof t == "string" && e.test(t)], "email");
  },
  url() {
    return te(
      [
        (e) => {
          if (typeof e != "string") return !1;
          try {
            return new URL(e), !0;
          } catch {
            return !1;
          }
        },
      ],
      "url",
    );
  },
  bigint() {
    return te([(e) => typeof e == "bigint"], "bigint");
  },
};
function Rt(e) {
  const { schema: t, onChange: l, onBatch: i } = e;
  Object.keys(t).length;
  let o = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    u = new Map(),
    g = new Set(),
    p = new Map(),
    c = new Set(),
    E = 0,
    _ = [],
    O = new Set(),
    D = !1,
    j = [],
    $ = 100;
  function A(f) {
    return (
      f !== null &&
      typeof f == "object" &&
      "safeParse" in f &&
      typeof f.safeParse == "function" &&
      "_def" in f &&
      "parse" in f &&
      typeof f.parse == "function"
    );
  }
  function L(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (A(f)) {
      const w = f._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function I(f) {
    return d ? "[redacted]" : kt(f);
  }
  function m(f, b) {
    if (!o) return;
    const w = t[f];
    if (!w) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (A(w)) {
      const P = w.safeParse(b);
      if (!P.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          k = I(b),
          r =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          n = L(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${k}. ${r}`,
        );
      }
      return;
    }
    const q = w,
      F = q._validators;
    if (!F || !Array.isArray(F) || F.length === 0) return;
    const U = q._typeName ?? "unknown";
    for (let P = 0; P < F.length; P++) {
      const y = F[P];
      if (typeof y == "function" && !y(b)) {
        let k = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          r = I(b),
          n = "";
        typeof q._lastFailedIndex == "number" &&
          q._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${q._lastFailedIndex} failed)`),
          (q._lastFailedIndex = -1));
        const a = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${U}, got ${k} ${r}${a}${n}`,
        );
      }
    }
  }
  function x(f) {
    p.get(f)?.forEach((b) => b());
  }
  function v() {
    c.forEach((f) => f());
  }
  function C(f, b, w) {
    if (D) {
      j.push({ key: f, value: b, prev: w });
      return;
    }
    D = !0;
    try {
      l?.(f, b, w), x(f), v();
      let q = 0;
      while (j.length > 0) {
        if (++q > $)
          throw (
            ((j.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${$} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const F = [...j];
        j.length = 0;
        for (const U of F) l?.(U.key, U.value, U.prev), x(U.key);
        v();
      }
    } finally {
      D = !1;
    }
  }
  function R() {
    if (!(E > 0)) {
      if ((i && _.length > 0 && i([..._]), O.size > 0)) {
        D = !0;
        try {
          for (const b of O) x(b);
          v();
          let f = 0;
          while (j.length > 0) {
            if (++f > $)
              throw (
                ((j.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${$} iterations.`,
                ))
              );
            const b = [...j];
            j.length = 0;
            for (const w of b) l?.(w.key, w.value, w.prev), x(w.key);
            v();
          }
        } finally {
          D = !1;
        }
      }
      (_.length = 0), O.clear();
    }
  }
  const z = {
    get(f) {
      return _e(f), u.get(f);
    },
    has(f) {
      return _e(f), u.has(f);
    },
    set(f, b) {
      m(f, b);
      const w = u.get(f);
      Object.is(w, b) ||
        (u.set(f, b),
        g.add(f),
        E > 0
          ? (_.push({ key: f, value: b, prev: w, type: "set" }), O.add(f))
          : C(f, b, w));
    },
    delete(f) {
      const b = u.get(f);
      u.delete(f),
        g.delete(f),
        E > 0
          ? (_.push({ key: f, value: void 0, prev: b, type: "delete" }),
            O.add(f))
          : C(f, void 0, b);
    },
    batch(f) {
      E++;
      try {
        f();
      } finally {
        E--, R();
      }
    },
    subscribe(f, b) {
      for (const w of f) {
        const q = w;
        p.has(q) || p.set(q, new Set()), p.get(q).add(b);
      }
      return () => {
        for (const w of f) {
          const q = p.get(w);
          q && (q.delete(b), q.size === 0 && p.delete(w));
        }
      };
    },
    subscribeAll(f) {
      return c.add(f), () => c.delete(f);
    },
    toObject() {
      const f = {};
      for (const b of g) u.has(b) && (f[b] = u.get(b));
      return f;
    },
  };
  return (
    (z.registerKeys = (f) => {
      for (const b of Object.keys(f)) we.has(b) || ((t[b] = f[b]), g.add(b));
    }),
    z
  );
}
var we = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function At(e, t) {
  const l = () => ({
    get: (i) => Ve(() => e.get(i)),
    has: (i) => Ve(() => e.has(i)),
  });
  return new Proxy(
    {},
    {
      get(i, o) {
        if (o === "$store") return e;
        if (o === "$snapshot") return l;
        if (typeof o != "symbol" && !we.has(o)) return e.get(o);
      },
      set(i, o, s) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          we.has(o)
          ? !1
          : (e.set(o, s), !0);
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          we.has(o)
          ? !1
          : (e.delete(o), !0);
      },
      has(i, o) {
        return o === "$store" || o === "$snapshot"
          ? !0
          : typeof o == "symbol" || we.has(o)
            ? !1
            : e.has(o);
      },
      ownKeys() {
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(i, o) {
        return o === "$store" || o === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Ot(e) {
  const t = Rt(e),
    l = At(t, e.schema);
  return { store: t, facts: l };
}
function pt(e, t) {
  const l = "crossModuleDeps" in t ? t.crossModuleDeps : void 0;
  return {
    id: e,
    schema: t.schema,
    init: t.init,
    derive: t.derive ?? {},
    events: t.events ?? {},
    effects: t.effects,
    constraints: t.constraints,
    resolvers: t.resolvers,
    hooks: t.hooks,
    snapshotEvents: t.snapshotEvents,
    crossModuleDeps: l,
  };
}
async function Ee(e, t, l) {
  let i,
    o = new Promise((s, d) => {
      i = setTimeout(() => d(new Error(l)), t);
    });
  try {
    return await Promise.race([e, o]);
  } finally {
    clearTimeout(i);
  }
}
function mt(e, t = 50) {
  const l = new WeakSet();
  function i(o, s) {
    if (s > t) return '"[max depth exceeded]"';
    if (o === null) return "null";
    if (o === void 0) return "undefined";
    const d = typeof o;
    if (d === "string") return JSON.stringify(o);
    if (d === "number" || d === "boolean") return String(o);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(o)) {
      if (l.has(o)) return '"[circular]"';
      l.add(o);
      const u = `[${o.map((g) => i(g, s + 1)).join(",")}]`;
      return l.delete(o), u;
    }
    if (d === "object") {
      const u = o;
      if (l.has(u)) return '"[circular]"';
      l.add(u);
      const g = `{${Object.keys(u)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${i(u[p], s + 1)}`)
        .join(",")}}`;
      return l.delete(u), g;
    }
    return '"[unknown]"';
  }
  return i(e, 0);
}
function Se(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    i = new WeakSet();
  function o(s, d) {
    if (d > t) return !1;
    if (s == null || typeof s != "object") return !0;
    const u = s;
    if (i.has(u)) return !0;
    if ((i.add(u), Array.isArray(u))) {
      for (const g of u) if (!o(g, d + 1)) return i.delete(u), !1;
      return i.delete(u), !0;
    }
    for (const g of Object.keys(u))
      if (l.has(g) || !o(u[g], d + 1)) return i.delete(u), !1;
    return i.delete(u), !0;
  }
  return o(e, 0);
}
function Dt(e) {
  let t = mt(e),
    l = 5381;
  for (let i = 0; i < t.length; i++) l = ((l << 5) + l) ^ t.charCodeAt(i);
  return (l >>> 0).toString(16);
}
function jt(e, t) {
  if (t) return t(e);
  const { type: l, ...i } = e,
    o = mt(i);
  return `${l}:${o}`;
}
function It(e, t, l) {
  return { requirement: e, id: jt(e, l), fromConstraint: t };
}
var Be = class ht {
    map = new Map();
    add(t) {
      this.map.has(t.id) || this.map.set(t.id, t);
    }
    remove(t) {
      return this.map.delete(t);
    }
    has(t) {
      return this.map.has(t);
    }
    get(t) {
      return this.map.get(t);
    }
    all() {
      return [...this.map.values()];
    }
    ids() {
      return [...this.map.keys()];
    }
    get size() {
      return this.map.size;
    }
    clear() {
      this.map.clear();
    }
    clone() {
      const t = new ht();
      for (const l of this.map.values()) t.add(l);
      return t;
    }
    diff(t) {
      const l = [],
        i = [],
        o = [];
      for (const s of this.map.values()) t.has(s.id) ? o.push(s) : l.push(s);
      for (const s of t.map.values()) this.map.has(s.id) || i.push(s);
      return { added: l, removed: i, unchanged: o };
    }
  },
  Mt = 5e3;
function qt(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: i = {},
      defaultTimeout: o = Mt,
      onEvaluate: s,
      onError: d,
    } = e,
    u = new Map(),
    g = new Set(),
    p = new Set(),
    c = new Map(),
    E = new Map(),
    _ = new Set(),
    O = new Map(),
    D = new Map(),
    j = !1,
    $ = new Set(),
    A = new Set(),
    L = new Map(),
    I = [],
    m = new Map();
  function x() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const a of n.after)
          t[a] && (L.has(a) || L.set(a, new Set()), L.get(a).add(r));
  }
  function v() {
    const r = new Set(),
      n = new Set(),
      a = [];
    function h(S, M) {
      if (r.has(S)) return;
      if (n.has(S)) {
        const W = M.indexOf(S),
          B = [...M.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${B}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), M.push(S);
      const N = t[S];
      if (N?.after) for (const W of N.after) t[W] && h(W, M);
      M.pop(), n.delete(S), r.add(S), a.push(S);
    }
    for (const S of Object.keys(t)) h(S, []);
    (I = a), (m = new Map(I.map((S, M) => [S, M])));
  }
  v(), x();
  function C(r, n) {
    return n.async !== void 0 ? n.async : !!p.has(r);
  }
  function R(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const a = C(r, n);
    a && p.add(r);
    const h = {
      id: r,
      priority: n.priority ?? 0,
      isAsync: a,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return u.set(r, h), h;
  }
  function z(r) {
    return u.get(r) ?? R(r);
  }
  function f(r, n) {
    const a = c.get(r) ?? new Set();
    for (const h of a) {
      const S = E.get(h);
      S?.delete(r), S && S.size === 0 && E.delete(h);
    }
    for (const h of n) E.has(h) || E.set(h, new Set()), E.get(h).add(r);
    c.set(r, n);
  }
  function b(r) {
    const n = t[r];
    if (!n) return !1;
    const a = z(r);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let h;
      if (n.deps) (h = n.when(l)), O.set(r, new Set(n.deps));
      else {
        const S = Re(() => n.when(l));
        (h = S.value), O.set(r, S.deps);
      }
      return h instanceof Promise
        ? (p.add(r),
          (a.isAsync = !0),
          h
            .then(
              (S) => ((a.lastResult = S), (a.isEvaluating = !1), s?.(r, S), S),
            )
            .catch(
              (S) => (
                (a.error = S instanceof Error ? S : new Error(String(S))),
                (a.lastResult = !1),
                (a.isEvaluating = !1),
                d?.(r, S),
                !1
              ),
            ))
        : ((a.lastResult = h), (a.isEvaluating = !1), s?.(r, h), h);
    } catch (h) {
      return (
        (a.error = h instanceof Error ? h : new Error(String(h))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(r, h),
        !1
      );
    }
  }
  async function w(r) {
    const n = t[r];
    if (!n) return !1;
    const a = z(r),
      h = n.timeout ?? o;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      f(r, S), O.set(r, S);
    }
    try {
      const S = n.when(l),
        M = await Ee(S, h, `Constraint "${r}" timed out after ${h}ms`);
      return (a.lastResult = M), (a.isEvaluating = !1), s?.(r, M), M;
    } catch (S) {
      return (
        (a.error = S instanceof Error ? S : new Error(String(S))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(r, S),
        !1
      );
    }
  }
  function q(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((h) => h != null) : [r];
  }
  function F(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: h, deps: S } = Re(() => a(l));
      return { requirements: q(h), deps: S };
    }
    return { requirements: q(a), deps: new Set() };
  }
  function U(r, n) {
    if (n.size === 0) return;
    const a = c.get(r) ?? new Set();
    for (const h of n)
      a.add(h), E.has(h) || E.set(h, new Set()), E.get(h).add(r);
    c.set(r, a);
  }
  let P = null;
  function y() {
    return (
      P ||
        (P = Object.keys(t).sort((r, n) => {
          const a = z(r),
            h = z(n).priority - a.priority;
          if (h !== 0) return h;
          const S = m.get(r) ?? 0,
            M = m.get(n) ?? 0;
          return S - M;
        })),
      P
    );
  }
  for (const r of Object.keys(t)) R(r);
  function k(r) {
    const n = u.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (t[a] && !g.has(a) && !A.has(a) && !$.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new Be();
      A.clear();
      let a = y().filter((B) => !g.has(B)),
        h;
      if (!j || !r || r.size === 0) (h = a), (j = !0);
      else {
        const B = new Set();
        for (const V of r) {
          const J = E.get(V);
          if (J) for (const re of J) g.has(re) || B.add(re);
        }
        for (const V of _) g.has(V) || B.add(V);
        _.clear(), (h = [...B]);
        for (const V of a)
          if (!B.has(V)) {
            const J = D.get(V);
            if (J) for (const re of J) n.add(re);
          }
      }
      function S(B, V) {
        if (g.has(B)) return;
        const J = O.get(B);
        if (!V) {
          J !== void 0 && f(B, J), A.add(B), D.set(B, []);
          return;
        }
        A.delete(B);
        let re, ee;
        try {
          const X = F(B);
          (re = X.requirements), (ee = X.deps);
        } catch (X) {
          d?.(B, X), J !== void 0 && f(B, J), D.set(B, []);
          return;
        }
        if (J !== void 0) {
          const X = new Set(J);
          for (const K of ee) X.add(K);
          f(B, X);
        } else U(B, ee);
        if (re.length > 0) {
          const X = i[B],
            K = re.map((Y) => It(Y, B, X));
          for (const Y of K) n.add(Y);
          D.set(B, K);
        } else D.set(B, []);
      }
      async function M(B) {
        const V = [],
          J = [];
        for (const K of B)
          if (k(K)) J.push(K);
          else {
            V.push(K);
            const Y = D.get(K);
            if (Y) for (const Q of Y) n.add(Q);
          }
        if (J.length === 0) return V;
        const re = [],
          ee = [];
        for (const K of J) z(K).isAsync ? ee.push(K) : re.push(K);
        const X = [];
        for (const K of re) {
          const Y = b(K);
          if (Y instanceof Promise) {
            X.push({ id: K, promise: Y });
            continue;
          }
          S(K, Y);
        }
        if (X.length > 0) {
          const K = await Promise.all(
            X.map(async ({ id: Y, promise: Q }) => ({
              id: Y,
              active: await Q,
            })),
          );
          for (const { id: Y, active: Q } of K) S(Y, Q);
        }
        if (ee.length > 0) {
          const K = await Promise.all(
            ee.map(async (Y) => ({ id: Y, active: await w(Y) })),
          );
          for (const { id: Y, active: Q } of K) S(Y, Q);
        }
        return V;
      }
      let N = h,
        W = h.length + 1;
      while (N.length > 0 && W > 0) {
        const B = N.length;
        if (((N = await M(N)), N.length === B)) break;
        W--;
      }
      return n.all();
    },
    getState(r) {
      return u.get(r);
    },
    getAllStates() {
      return [...u.values()];
    },
    disable(r) {
      g.add(r), (P = null), D.delete(r);
      const n = c.get(r);
      if (n) {
        for (const a of n) {
          const h = E.get(a);
          h && (h.delete(r), h.size === 0 && E.delete(a));
        }
        c.delete(r);
      }
      O.delete(r);
    },
    enable(r) {
      g.delete(r), (P = null), _.add(r);
    },
    invalidate(r) {
      const n = E.get(r);
      if (n) for (const a of n) _.add(a);
    },
    markResolved(r) {
      $.add(r);
      const n = u.get(r);
      n && (n.lastResolvedAt = Date.now());
      const a = L.get(r);
      if (a) for (const h of a) _.add(h);
    },
    isResolved(r) {
      return $.has(r);
    },
    registerDefinitions(r) {
      for (const [n, a] of Object.entries(r)) (t[n] = a), R(n), _.add(n);
      (P = null), v(), x();
    },
  };
}
function Tt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: i,
      onInvalidate: o,
      onError: s,
    } = e,
    d = new Map(),
    u = new Map(),
    g = new Map(),
    p = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    E = 0,
    _ = new Set(),
    O = !1,
    D = 100,
    j;
  function $(v) {
    if (!t[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const C = {
      id: v,
      compute: () => L(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(v, C), C;
  }
  function A(v) {
    return d.get(v) ?? $(v);
  }
  function L(v) {
    const C = A(v),
      R = t[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    C.isComputing = !0;
    try {
      const { value: z, deps: f } = Re(() => R(l, j));
      return (
        (C.cachedValue = z), (C.isStale = !1), I(v, f), i?.(v, z, [...f]), z
      );
    } catch (z) {
      throw (s?.(v, z), z);
    } finally {
      C.isComputing = !1;
    }
  }
  function I(v, C) {
    const R = A(v),
      z = R.dependencies;
    for (const f of z)
      if (d.has(f)) {
        const b = p.get(f);
        b?.delete(v), b && b.size === 0 && p.delete(f);
      } else {
        const b = g.get(f);
        b?.delete(v), b && b.size === 0 && g.delete(f);
      }
    for (const f of C)
      t[f]
        ? (p.has(f) || p.set(f, new Set()), p.get(f).add(v))
        : (g.has(f) || g.set(f, new Set()), g.get(f).add(v));
    R.dependencies = C;
  }
  function m() {
    if (!(E > 0 || O)) {
      O = !0;
      try {
        let v = 0;
        while (_.size > 0) {
          if (++v > D) {
            const R = [..._];
            throw (
              (_.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${D} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [..._];
          _.clear();
          for (const R of C) u.get(R)?.forEach((z) => z());
        }
      } finally {
        O = !1;
      }
    }
  }
  function x(v, C = new Set()) {
    if (C.has(v)) return;
    C.add(v);
    const R = d.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), o?.(v), _.add(v);
    const z = p.get(v);
    if (z) for (const f of z) x(f, C);
  }
  return (
    (j = new Proxy(
      {},
      {
        get(v, C) {
          if (typeof C == "symbol" || c.has(C)) return;
          _e(C);
          const R = A(C);
          return R.isStale && L(C), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const C = A(v);
        return C.isStale && L(v), C.cachedValue;
      },
      isStale(v) {
        return d.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const C = g.get(v);
        if (C) {
          E++;
          try {
            for (const R of C) x(R);
          } finally {
            E--, m();
          }
        }
      },
      invalidateMany(v) {
        E++;
        try {
          for (const C of v) {
            const R = g.get(C);
            if (R) for (const z of R) x(z);
          }
        } finally {
          E--, m();
        }
      },
      invalidateAll() {
        E++;
        try {
          for (const v of d.values())
            v.isStale || ((v.isStale = !0), _.add(v.id));
        } finally {
          E--, m();
        }
      },
      subscribe(v, C) {
        for (const R of v) {
          const z = R;
          u.has(z) || u.set(z, new Set()), u.get(z).add(C);
        }
        return () => {
          for (const R of v) {
            const z = R,
              f = u.get(z);
            f?.delete(C), f && f.size === 0 && u.delete(z);
          }
        };
      },
      getProxy() {
        return j;
      },
      getDependencies(v) {
        return A(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [C, R] of Object.entries(v)) (t[C] = R), $(C);
      },
    }
  );
}
function _t(e) {
  let { definitions: t, facts: l, store: i, onRun: o, onError: s } = e,
    d = new Map(),
    u = null,
    g = !1;
  function p($) {
    const A = t[$];
    if (!A) throw new Error(`[Directive] Unknown effect: ${$}`);
    const L = {
      id: $,
      enabled: !0,
      hasExplicitDeps: !!A.deps,
      dependencies: A.deps ? new Set(A.deps) : null,
      cleanup: null,
    };
    return d.set($, L), L;
  }
  function c($) {
    return d.get($) ?? p($);
  }
  function E() {
    return i.toObject();
  }
  function _($, A) {
    const L = c($);
    if (!L.enabled) return !1;
    if (L.dependencies) {
      for (const I of L.dependencies) if (A.has(I)) return !0;
      return !1;
    }
    return !0;
  }
  function O($) {
    if ($.cleanup) {
      try {
        $.cleanup();
      } catch (A) {
        s?.($.id, A),
          console.error(
            `[Directive] Effect "${$.id}" cleanup threw an error:`,
            A,
          );
      }
      $.cleanup = null;
    }
  }
  function D($, A) {
    if (typeof A == "function")
      if (g)
        try {
          A();
        } catch (L) {
          s?.($.id, L),
            console.error(
              `[Directive] Effect "${$.id}" cleanup threw an error:`,
              L,
            );
        }
      else $.cleanup = A;
  }
  async function j($) {
    const A = c($),
      L = t[$];
    if (!(!A.enabled || !L)) {
      O(A), o?.($);
      try {
        if (A.hasExplicitDeps) {
          let I;
          if (
            (i.batch(() => {
              I = L.run(l, u);
            }),
            I instanceof Promise)
          ) {
            const m = await I;
            D(A, m);
          } else D(A, I);
        } else {
          let I = null,
            m,
            x = Re(
              () => (
                i.batch(() => {
                  m = L.run(l, u);
                }),
                m
              ),
            );
          I = x.deps;
          let v = x.value;
          v instanceof Promise && (v = await v),
            D(A, v),
            (A.dependencies = I.size > 0 ? I : null);
        }
      } catch (I) {
        s?.($, I),
          console.error(`[Directive] Effect "${$}" threw an error:`, I);
      }
    }
  }
  for (const $ of Object.keys(t)) p($);
  return {
    async runEffects($) {
      const A = [];
      for (const L of Object.keys(t)) _(L, $) && A.push(L);
      await Promise.all(A.map(j)), (u = E());
    },
    async runAll() {
      const $ = Object.keys(t);
      await Promise.all(
        $.map((A) => (c(A).enabled ? j(A) : Promise.resolve())),
      ),
        (u = E());
    },
    disable($) {
      const A = c($);
      A.enabled = !1;
    },
    enable($) {
      const A = c($);
      A.enabled = !0;
    },
    isEnabled($) {
      return c($).enabled;
    },
    cleanupAll() {
      g = !0;
      for (const $ of d.values()) O($);
    },
    registerDefinitions($) {
      for (const [A, L] of Object.entries($)) (t[A] = L), p(A);
    },
  };
}
function Bt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: i = 2,
      maxDelayMs: o = 3e4,
    } = e,
    s = new Map();
  function d(u) {
    const g = t * Math.pow(i, u - 1);
    return Math.min(g, o);
  }
  return {
    scheduleRetry(u, g, p, c, E) {
      if (c > l) return null;
      const _ = d(c),
        O = {
          source: u,
          sourceId: g,
          context: p,
          attempt: c,
          nextRetryTime: Date.now() + _,
          callback: E,
        };
      return s.set(g, O), O;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const u = Date.now(),
        g = [];
      for (const [p, c] of s) c.nextRetryTime <= u && (g.push(c), s.delete(p));
      return g;
    },
    cancelRetry(u) {
      s.delete(u);
    },
    clearAll() {
      s.clear();
    },
  };
}
var zt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Pt(e = {}) {
  const { config: t = {}, onError: l, onRecovery: i } = e,
    o = [],
    s = 100,
    d = Bt(t.retryLater),
    u = new Map();
  function g(c, E, _, O) {
    if (_ instanceof Ke) return _;
    const D = _ instanceof Error ? _.message : String(_),
      j = c !== "system";
    return new Ke(D, c, E, O, j);
  }
  function p(c, E, _) {
    const O = (() => {
      switch (c) {
        case "constraint":
          return t.onConstraintError;
        case "resolver":
          return t.onResolverError;
        case "effect":
          return t.onEffectError;
        case "derivation":
          return t.onDerivationError;
        default:
          return;
      }
    })();
    if (typeof O == "function") {
      try {
        O(_, E);
      } catch (D) {
        console.error("[Directive] Error in error handler callback:", D);
      }
      return "skip";
    }
    return typeof O == "string" ? O : zt[c];
  }
  return {
    handleError(c, E, _, O) {
      const D = g(c, E, _, O);
      o.push(D), o.length > s && o.shift();
      try {
        l?.(D);
      } catch ($) {
        console.error("[Directive] Error in onError callback:", $);
      }
      try {
        t.onError?.(D);
      } catch ($) {
        console.error("[Directive] Error in config.onError callback:", $);
      }
      let j = p(c, E, _ instanceof Error ? _ : new Error(String(_)));
      if (j === "retry-later") {
        const $ = (u.get(E) ?? 0) + 1;
        u.set(E, $),
          d.scheduleRetry(c, E, O, $) ||
            ((j = "skip"), u.delete(E), typeof process < "u");
      }
      try {
        i?.(D, j);
      } catch ($) {
        console.error("[Directive] Error in onRecovery callback:", $);
      }
      if (j === "throw") throw D;
      return j;
    },
    getLastError() {
      return o[o.length - 1] ?? null;
    },
    getAllErrors() {
      return [...o];
    },
    clearErrors() {
      o.length = 0;
    },
    getRetryLaterManager() {
      return d;
    },
    processDueRetries() {
      return d.processDueRetries();
    },
    clearRetryAttempts(c) {
      u.delete(c), d.cancelRetry(c);
    },
  };
}
function Lt() {
  const e = [];
  function t(i) {
    if (i)
      try {
        return i();
      } catch (o) {
        console.error("[Directive] Plugin error:", o);
        return;
      }
  }
  async function l(i) {
    if (i)
      try {
        return await i();
      } catch (o) {
        console.error("[Directive] Plugin error:", o);
        return;
      }
  }
  return {
    register(i) {
      e.some((o) => o.name === i.name) &&
        (console.warn(
          `[Directive] Plugin "${i.name}" is already registered, replacing...`,
        ),
        this.unregister(i.name)),
        e.push(i);
    },
    unregister(i) {
      const o = e.findIndex((s) => s.name === i);
      o !== -1 && e.splice(o, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(i) {
      for (const o of e) await l(() => o.onInit?.(i));
    },
    emitStart(i) {
      for (const o of e) t(() => o.onStart?.(i));
    },
    emitStop(i) {
      for (const o of e) t(() => o.onStop?.(i));
    },
    emitDestroy(i) {
      for (const o of e) t(() => o.onDestroy?.(i));
    },
    emitFactSet(i, o, s) {
      for (const d of e) t(() => d.onFactSet?.(i, o, s));
    },
    emitFactDelete(i, o) {
      for (const s of e) t(() => s.onFactDelete?.(i, o));
    },
    emitFactsBatch(i) {
      for (const o of e) t(() => o.onFactsBatch?.(i));
    },
    emitDerivationCompute(i, o, s) {
      for (const d of e) t(() => d.onDerivationCompute?.(i, o, s));
    },
    emitDerivationInvalidate(i) {
      for (const o of e) t(() => o.onDerivationInvalidate?.(i));
    },
    emitReconcileStart(i) {
      for (const o of e) t(() => o.onReconcileStart?.(i));
    },
    emitReconcileEnd(i) {
      for (const o of e) t(() => o.onReconcileEnd?.(i));
    },
    emitConstraintEvaluate(i, o) {
      for (const s of e) t(() => s.onConstraintEvaluate?.(i, o));
    },
    emitConstraintError(i, o) {
      for (const s of e) t(() => s.onConstraintError?.(i, o));
    },
    emitRequirementCreated(i) {
      for (const o of e) t(() => o.onRequirementCreated?.(i));
    },
    emitRequirementMet(i, o) {
      for (const s of e) t(() => s.onRequirementMet?.(i, o));
    },
    emitRequirementCanceled(i) {
      for (const o of e) t(() => o.onRequirementCanceled?.(i));
    },
    emitResolverStart(i, o) {
      for (const s of e) t(() => s.onResolverStart?.(i, o));
    },
    emitResolverComplete(i, o, s) {
      for (const d of e) t(() => d.onResolverComplete?.(i, o, s));
    },
    emitResolverError(i, o, s) {
      for (const d of e) t(() => d.onResolverError?.(i, o, s));
    },
    emitResolverRetry(i, o, s) {
      for (const d of e) t(() => d.onResolverRetry?.(i, o, s));
    },
    emitResolverCancel(i, o) {
      for (const s of e) t(() => s.onResolverCancel?.(i, o));
    },
    emitEffectRun(i) {
      for (const o of e) t(() => o.onEffectRun?.(i));
    },
    emitEffectError(i, o) {
      for (const s of e) t(() => s.onEffectError?.(i, o));
    },
    emitSnapshot(i) {
      for (const o of e) t(() => o.onSnapshot?.(i));
    },
    emitTimeTravel(i, o) {
      for (const s of e) t(() => s.onTimeTravel?.(i, o));
    },
    emitError(i) {
      for (const o of e) t(() => o.onError?.(i));
    },
    emitErrorRecovery(i, o) {
      for (const s of e) t(() => s.onErrorRecovery?.(i, o));
    },
  };
}
var Ye = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Je = { enabled: !1, windowMs: 50 };
function Ge(e, t) {
  let { backoff: l, initialDelay: i = 100, maxDelay: o = 3e4 } = e,
    s;
  switch (l) {
    case "none":
      s = i;
      break;
    case "linear":
      s = i * t;
      break;
    case "exponential":
      s = i * Math.pow(2, t - 1);
      break;
    default:
      s = i;
  }
  return Math.max(1, Math.min(s, o));
}
function Nt(e) {
  const {
      definitions: t,
      facts: l,
      store: i,
      onStart: o,
      onComplete: s,
      onError: d,
      onRetry: u,
      onCancel: g,
      onResolutionComplete: p,
    } = e,
    c = new Map(),
    E = new Map(),
    _ = 1e3,
    O = new Map(),
    D = new Map(),
    j = 1e3;
  function $() {
    if (E.size > _) {
      const f = E.size - _,
        b = E.keys();
      for (let w = 0; w < f; w++) {
        const q = b.next().value;
        q && E.delete(q);
      }
    }
  }
  function A(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "string"
    );
  }
  function L(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function I(f, b) {
    return A(f) ? b.type === f.requirement : L(f) ? f.requirement(b) : !1;
  }
  function m(f) {
    const b = f.type,
      w = D.get(b);
    if (w)
      for (const q of w) {
        const F = t[q];
        if (F && I(F, f)) return q;
      }
    for (const [q, F] of Object.entries(t))
      if (I(F, f)) {
        if (!D.has(b)) {
          if (D.size >= j) {
            const P = D.keys().next().value;
            P !== void 0 && D.delete(P);
          }
          D.set(b, []);
        }
        const U = D.get(b);
        return U.includes(q) || U.push(q), q;
      }
    return null;
  }
  function x(f) {
    return { facts: l, signal: f, snapshot: () => l.$snapshot() };
  }
  async function v(f, b, w) {
    const q = t[f];
    if (!q) return;
    let F = { ...Ye, ...q.retry },
      U = null;
    for (let P = 1; P <= F.attempts; P++) {
      if (w.signal.aborted) return;
      const y = c.get(b.id);
      y &&
        ((y.attempt = P),
        (y.status = {
          state: "running",
          requirementId: b.id,
          startedAt: y.startedAt,
          attempt: P,
        }));
      try {
        const k = x(w.signal);
        if (q.resolve) {
          let n;
          i.batch(() => {
            n = q.resolve(b.requirement, k);
          });
          const a = q.timeout;
          a && a > 0
            ? await Ee(n, a, `Resolver "${f}" timed out after ${a}ms`)
            : await n;
        }
        const r = Date.now() - (y?.startedAt ?? Date.now());
        E.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: r,
        }),
          $(),
          s?.(f, b, r);
        return;
      } catch (k) {
        if (
          ((U = k instanceof Error ? k : new Error(String(k))),
          w.signal.aborted)
        )
          return;
        if (F.shouldRetry && !F.shouldRetry(U, P)) break;
        if (P < F.attempts) {
          if (w.signal.aborted) return;
          const r = Ge(F, P);
          if (
            (u?.(f, b, P + 1),
            await new Promise((n) => {
              const a = setTimeout(n, r),
                h = () => {
                  clearTimeout(a), n();
                };
              w.signal.addEventListener("abort", h, { once: !0 });
            }),
            w.signal.aborted)
          )
            return;
        }
      }
    }
    E.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: U,
      failedAt: Date.now(),
      attempts: F.attempts,
    }),
      $(),
      d?.(f, b, U);
  }
  async function C(f, b) {
    const w = t[f];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((r) => {
          const n = new AbortController();
          return v(f, r, n);
        }),
      );
      return;
    }
    let q = { ...Ye, ...w.retry },
      F = { ...Je, ...w.batch },
      U = new AbortController(),
      P = Date.now(),
      y = null,
      k = F.timeoutMs ?? w.timeout;
    for (let r = 1; r <= q.attempts; r++) {
      if (U.signal.aborted) return;
      try {
        const n = x(U.signal),
          a = b.map((h) => h.requirement);
        if (w.resolveBatchWithResults) {
          let h, S;
          if (
            (i.batch(() => {
              S = w.resolveBatchWithResults(a, n);
            }),
            k && k > 0
              ? (h = await Ee(
                  S,
                  k,
                  `Batch resolver "${f}" timed out after ${k}ms`,
                ))
              : (h = await S),
            h.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${h.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let M = Date.now() - P,
            N = !1;
          for (let W = 0; W < b.length; W++) {
            const B = b[W],
              V = h[W];
            if (V.success)
              E.set(B.id, {
                state: "success",
                requirementId: B.id,
                completedAt: Date.now(),
                duration: M,
              }),
                s?.(f, B, M);
            else {
              N = !0;
              const J = V.error ?? new Error("Batch item failed");
              E.set(B.id, {
                state: "error",
                requirementId: B.id,
                error: J,
                failedAt: Date.now(),
                attempts: r,
              }),
                d?.(f, B, J);
            }
          }
          if (!N || b.some((W, B) => h[B]?.success)) return;
        } else {
          let h;
          i.batch(() => {
            h = w.resolveBatch(a, n);
          }),
            k && k > 0
              ? await Ee(h, k, `Batch resolver "${f}" timed out after ${k}ms`)
              : await h;
          const S = Date.now() - P;
          for (const M of b)
            E.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: S,
            }),
              s?.(f, M, S);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          U.signal.aborted)
        )
          return;
        if (q.shouldRetry && !q.shouldRetry(y, r)) break;
        if (r < q.attempts) {
          const a = Ge(q, r);
          for (const h of b) u?.(f, h, r + 1);
          if (
            (await new Promise((h) => {
              const S = setTimeout(h, a),
                M = () => {
                  clearTimeout(S), h();
                };
              U.signal.addEventListener("abort", M, { once: !0 });
            }),
            U.signal.aborted)
          )
            return;
        }
      }
    }
    for (const r of b)
      E.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: y,
        failedAt: Date.now(),
        attempts: q.attempts,
      }),
        d?.(f, r, y);
    $();
  }
  function R(f, b) {
    const w = t[f];
    if (!w) return;
    const q = { ...Je, ...w.batch };
    O.has(f) || O.set(f, { resolverId: f, requirements: [], timer: null });
    const F = O.get(f);
    F.requirements.push(b),
      F.timer && clearTimeout(F.timer),
      (F.timer = setTimeout(() => {
        z(f);
      }, q.windowMs));
  }
  function z(f) {
    const b = O.get(f);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      C(f, w).then(() => {
        p?.();
      });
  }
  return {
    resolve(f) {
      if (c.has(f.id)) return;
      const b = m(f.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${f.id}`);
        return;
      }
      const w = t[b];
      if (!w) return;
      if (w.batch?.enabled) {
        R(b, f);
        return;
      }
      const q = new AbortController(),
        F = Date.now(),
        U = {
          requirementId: f.id,
          resolverId: b,
          controller: q,
          startedAt: F,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: F },
          originalRequirement: f,
        };
      c.set(f.id, U),
        o?.(b, f),
        v(b, f, q).finally(() => {
          c.delete(f.id) && p?.();
        });
    },
    cancel(f) {
      const b = c.get(f);
      b &&
        (b.controller.abort(),
        c.delete(f),
        E.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        $(),
        g?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of c) this.cancel(f);
      for (const f of O.values()) f.timer && clearTimeout(f.timer);
      O.clear();
    },
    getStatus(f) {
      const b = c.get(f);
      return b ? b.status : E.get(f) || { state: "idle" };
    },
    getInflight() {
      return [...c.keys()];
    },
    getInflightInfo() {
      return [...c.values()].map((f) => ({
        id: f.requirementId,
        resolverId: f.resolverId,
        startedAt: f.startedAt,
      }));
    },
    isResolving(f) {
      return c.has(f);
    },
    processBatches() {
      for (const f of O.keys()) z(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) t[b] = w;
      D.clear();
    },
  };
}
function Ft(e) {
  let { config: t, facts: l, store: i, onSnapshot: o, onTimeTravel: s } = e,
    d = t.timeTravel ?? !1,
    u = t.maxSnapshots ?? 100,
    g = [],
    p = -1,
    c = 1,
    E = !1,
    _ = !1,
    O = [],
    D = null,
    j = -1;
  function $() {
    return i.toObject();
  }
  function A() {
    const I = $();
    return structuredClone(I);
  }
  function L(I) {
    if (!Se(I)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    i.batch(() => {
      for (const [m, x] of Object.entries(I)) {
        if (m === "__proto__" || m === "constructor" || m === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${m}" during fact restoration`,
          );
          continue;
        }
        l[m] = x;
      }
    });
  }
  return {
    get isEnabled() {
      return d;
    },
    get isRestoring() {
      return _;
    },
    get isPaused() {
      return E;
    },
    get snapshots() {
      return [...g];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(I) {
      if (!d || E)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: I };
      const m = { id: c++, timestamp: Date.now(), facts: A(), trigger: I };
      for (
        p < g.length - 1 && g.splice(p + 1), g.push(m), p = g.length - 1;
        g.length > u;
      )
        g.shift(), p--;
      return o?.(m), m;
    },
    restore(I) {
      if (d) {
        (E = !0), (_ = !0);
        try {
          L(I.facts);
        } finally {
          (E = !1), (_ = !1);
        }
      }
    },
    goBack(I = 1) {
      if (!d || g.length === 0) return;
      let m = p,
        x = p,
        v = O.find((R) => p > R.startIndex && p <= R.endIndex);
      if (v) x = v.startIndex;
      else if (O.find((R) => p === R.startIndex)) {
        const R = O.find((z) => z.endIndex < p && p - z.endIndex <= I);
        x = R ? R.startIndex : Math.max(0, p - I);
      } else x = Math.max(0, p - I);
      if (m === x) return;
      p = x;
      const C = g[p];
      C && (this.restore(C), s?.(m, x));
    },
    goForward(I = 1) {
      if (!d || g.length === 0) return;
      let m = p,
        x = p,
        v = O.find((R) => p >= R.startIndex && p < R.endIndex);
      if ((v ? (x = v.endIndex) : (x = Math.min(g.length - 1, p + I)), m === x))
        return;
      p = x;
      const C = g[p];
      C && (this.restore(C), s?.(m, x));
    },
    goTo(I) {
      if (!d) return;
      const m = g.findIndex((C) => C.id === I);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${I} not found`);
        return;
      }
      const x = p;
      p = m;
      const v = g[p];
      v && (this.restore(v), s?.(x, m));
    },
    replay() {
      if (!d || g.length === 0) return;
      p = 0;
      const I = g[0];
      I && this.restore(I);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: g, currentIndex: p });
    },
    import(I) {
      if (d)
        try {
          const m = JSON.parse(I);
          if (typeof m != "object" || m === null)
            throw new Error("Invalid time-travel data: expected object");
          if (m.version !== 1)
            throw new Error(
              `Unsupported time-travel export version: ${m.version}`,
            );
          if (!Array.isArray(m.snapshots))
            throw new Error(
              "Invalid time-travel data: snapshots must be an array",
            );
          if (typeof m.currentIndex != "number")
            throw new Error(
              "Invalid time-travel data: currentIndex must be a number",
            );
          for (const v of m.snapshots) {
            if (typeof v != "object" || v === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof v.id != "number" ||
              typeof v.timestamp != "number" ||
              typeof v.trigger != "string" ||
              typeof v.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!Se(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (g.length = 0), g.push(...m.snapshots), (p = m.currentIndex);
          const x = g[p];
          x && this.restore(x);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(I) {
      d && ((D = I), (j = p));
    },
    endChangeset() {
      !d ||
        D === null ||
        (p > j && O.push({ label: D, startIndex: j, endIndex: p }),
        (D = null),
        (j = -1));
    },
    pause() {
      E = !0;
    },
    resume() {
      E = !1;
    },
  };
}
function Wt() {
  const e = { id: -1, timestamp: 0, facts: {}, trigger: "" };
  return {
    isEnabled: !1,
    isRestoring: !1,
    isPaused: !1,
    snapshots: [],
    currentIndex: -1,
    takeSnapshot: () => e,
    restore: () => {},
    goBack: () => {},
    goForward: () => {},
    goTo: () => {},
    replay: () => {},
    export: () => "{}",
    import: () => {},
    beginChangeset: () => {},
    endChangeset: () => {},
    pause: () => {},
    resume: () => {},
  };
}
var ae = new Set(["__proto__", "constructor", "prototype"]);
function gt(e) {
  const t = Object.create(null),
    l = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    s = Object.create(null),
    d = Object.create(null);
  for (const r of e.modules) {
    const n = (a, h) => {
      if (a) {
        for (const S of Object.keys(a))
          if (ae.has(S))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${S}" in ${h}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    n(r.schema, "schema"),
      n(r.events, "events"),
      n(r.derive, "derive"),
      n(r.effects, "effects"),
      n(r.constraints, "constraints"),
      n(r.resolvers, "resolvers"),
      Object.assign(t, r.schema),
      r.events && Object.assign(l, r.events),
      r.derive && Object.assign(i, r.derive),
      r.effects && Object.assign(o, r.effects),
      r.constraints && Object.assign(s, r.constraints),
      r.resolvers && Object.assign(d, r.resolvers);
  }
  let u = null;
  if (e.modules.some((r) => r.snapshotEvents)) {
    u = new Set();
    for (const r of e.modules) {
      const n = r;
      if (n.snapshotEvents) for (const a of n.snapshotEvents) u.add(a);
      else if (n.events) for (const a of Object.keys(n.events)) u.add(a);
    }
  }
  let g = 0,
    p = !1,
    c = Lt();
  for (const r of e.plugins ?? []) c.register(r);
  let E = Pt({
      config: e.errorBoundary,
      onError: (r) => c.emitError(r),
      onRecovery: (r, n) => c.emitErrorRecovery(r, n),
    }),
    _ = () => {},
    O = () => {},
    D = null,
    { store: j, facts: $ } = Ot({
      schema: t,
      onChange: (r, n, a) => {
        c.emitFactSet(r, n, a),
          _(r),
          !D?.isRestoring && (g === 0 && (p = !0), w.changedKeys.add(r), q());
      },
      onBatch: (r) => {
        c.emitFactsBatch(r);
        const n = [];
        for (const a of r) n.push(a.key);
        if ((O(n), !D?.isRestoring)) {
          g === 0 && (p = !0);
          for (const a of r) w.changedKeys.add(a.key);
          q();
        }
      },
    }),
    A = Tt({
      definitions: i,
      facts: $,
      onCompute: (r, n, a) => c.emitDerivationCompute(r, n, a),
      onInvalidate: (r) => c.emitDerivationInvalidate(r),
      onError: (r, n) => {
        E.handleError("derivation", r, n);
      },
    });
  (_ = (r) => A.invalidate(r)), (O = (r) => A.invalidateMany(r));
  const L = _t({
      definitions: o,
      facts: $,
      store: j,
      onRun: (r) => c.emitEffectRun(r),
      onError: (r, n) => {
        E.handleError("effect", r, n), c.emitEffectError(r, n);
      },
    }),
    I = qt({
      definitions: s,
      facts: $,
      onEvaluate: (r, n) => c.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        E.handleError("constraint", r, n), c.emitConstraintError(r, n);
      },
    }),
    m = Nt({
      definitions: d,
      facts: $,
      store: j,
      onStart: (r, n) => c.emitResolverStart(r, n),
      onComplete: (r, n, a) => {
        c.emitResolverComplete(r, n, a),
          c.emitRequirementMet(n, r),
          I.markResolved(n.fromConstraint);
      },
      onError: (r, n, a) => {
        E.handleError("resolver", r, a, n), c.emitResolverError(r, n, a);
      },
      onRetry: (r, n, a) => c.emitResolverRetry(r, n, a),
      onCancel: (r, n) => {
        c.emitResolverCancel(r, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        z(), q();
      },
    }),
    x = new Set();
  function v() {
    for (const r of x) r();
  }
  const C = e.debug?.timeTravel
    ? Ft({
        config: e.debug,
        facts: $,
        store: j,
        onSnapshot: (r) => {
          c.emitSnapshot(r), v();
        },
        onTimeTravel: (r, n) => {
          c.emitTimeTravel(r, n), v();
        },
      })
    : Wt();
  D = C;
  const R = new Set();
  function z() {
    for (const r of R) r();
  }
  let f = 50,
    b = 0,
    w = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Be(),
      readyPromise: null,
      readyResolve: null,
    };
  function q() {
    !w.isRunning ||
      w.reconcileScheduled ||
      w.isInitializing ||
      ((w.reconcileScheduled = !0),
      z(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && F().catch((r) => {});
      }));
  }
  async function F() {
    if (!w.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), z();
      try {
        w.changedKeys.size > 0 &&
          ((u === null || p) &&
            C.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (p = !1));
        const r = $.$snapshot();
        c.emitReconcileStart(r), await L.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const a = await I.evaluate(n),
          h = new Be();
        for (const B of a) h.add(B), c.emitRequirementCreated(B);
        const { added: S, removed: M } = h.diff(w.previousRequirements);
        for (const B of M) m.cancel(B.id);
        for (const B of S) m.resolve(B);
        w.previousRequirements = h;
        const N = m.getInflightInfo(),
          W = {
            unmet: a.filter((B) => !m.isResolving(B.id)),
            inflight: N,
            completed: [],
            canceled: M.map((B) => ({
              id: B.id,
              resolverId: N.find((V) => V.id === B.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(W),
          w.isReady ||
            ((w.isReady = !0),
            w.readyResolve && (w.readyResolve(), (w.readyResolve = null)));
      } finally {
        (w.isReconciling = !1),
          w.changedKeys.size > 0 ? q() : w.reconcileScheduled || (b = 0),
          z();
      }
    }
  }
  const U = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ae.has(n)) return A.get(n);
        },
        has(r, n) {
          return typeof n == "symbol" || ae.has(n) ? !1 : n in i;
        },
        ownKeys() {
          return Object.keys(i);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ae.has(n) && n in i)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    P = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ae.has(n))
            return (a) => {
              const h = l[n];
              if (h) {
                g++, (u === null || u.has(n)) && (p = !0);
                try {
                  j.batch(() => {
                    h($, { type: n, ...a });
                  });
                } finally {
                  g--;
                }
              }
            };
        },
        has(r, n) {
          return typeof n == "symbol" || ae.has(n) ? !1 : n in l;
        },
        ownKeys() {
          return Object.keys(l);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ae.has(n) && n in l)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: $,
      debug: C.isEnabled ? C : null,
      derive: U,
      events: P,
      constraints: { disable: (r) => I.disable(r), enable: (r) => I.enable(r) },
      effects: {
        disable: (r) => L.disable(r),
        enable: (r) => L.enable(r),
        isEnabled: (r) => L.isEnabled(r),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              j.batch(() => {
                r.init($);
              });
          e.onAfterModuleInit &&
            j.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const r of Object.keys(i)) A.get(r);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const r of e.modules) r.hooks?.onStart?.(y);
          c.emitStart(y), q();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), m.cancelAll(), L.cleanupAll();
          for (const r of e.modules) r.hooks?.onStop?.(y);
          c.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (w.isDestroyed = !0),
          R.clear(),
          x.clear(),
          c.emitDestroy(y);
      },
      dispatch(r) {
        if (ae.has(r.type)) return;
        const n = l[r.type];
        if (n) {
          g++, (u === null || u.has(r.type)) && (p = !0);
          try {
            j.batch(() => {
              n($, r);
            });
          } finally {
            g--;
          }
        }
      },
      read(r) {
        return A.get(r);
      },
      subscribe(r, n) {
        const a = [],
          h = [];
        for (const M of r) M in i ? a.push(M) : M in t && h.push(M);
        const S = [];
        return (
          a.length > 0 && S.push(A.subscribe(a, n)),
          h.length > 0 && S.push(j.subscribe(h, n)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(r, n, a) {
        const h = a?.equalityFn
          ? (M, N) => a.equalityFn(M, N)
          : (M, N) => Object.is(M, N);
        if (r in i) {
          let M = A.get(r);
          return A.subscribe([r], () => {
            const N = A.get(r);
            if (!h(N, M)) {
              const W = M;
              (M = N), n(N, W);
            }
          });
        }
        let S = j.get(r);
        return j.subscribe([r], () => {
          const M = j.get(r);
          if (!h(M, S)) {
            const N = S;
            (S = M), n(M, N);
          }
        });
      },
      when(r, n) {
        return new Promise((a, h) => {
          const S = j.toObject();
          if (r(S)) {
            a();
            return;
          }
          let M,
            N,
            W = () => {
              M?.(), N !== void 0 && clearTimeout(N);
            };
          (M = j.subscribeAll(() => {
            const B = j.toObject();
            r(B) && (W(), a());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (N = setTimeout(() => {
                W(),
                  h(
                    new Error(
                      `[Directive] when: timed out after ${n.timeout}ms`,
                    ),
                  );
              }, n.timeout));
        });
      },
      inspect() {
        return {
          unmet: w.previousRequirements.all(),
          inflight: m.getInflightInfo(),
          constraints: I.getAllStates().map((r) => ({
            id: r.id,
            active: r.lastResult ?? !1,
            priority: r.priority,
          })),
          resolvers: Object.fromEntries(
            m.getInflight().map((r) => [r, m.getStatus(r)]),
          ),
        };
      },
      explain(r) {
        const n = w.previousRequirements.all().find((V) => V.id === r);
        if (!n) return null;
        const a = I.getState(n.fromConstraint),
          h = m.getStatus(r),
          S = {},
          M = j.toObject();
        for (const [V, J] of Object.entries(M)) S[V] = J;
        const N = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${h.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([V]) => V !== "type")
            .map(([V, J]) => `${V}=${JSON.stringify(J)}`)
            .join(", ");
        W && N.push(`├─ Requirement payload: { ${W} }`);
        const B = Object.entries(S).slice(0, 10);
        return (
          B.length > 0 &&
            (N.push("└─ Relevant facts:"),
            B.forEach(([V, J], re) => {
              const ee = re === B.length - 1 ? "   └─" : "   ├─",
                X = typeof J == "object" ? JSON.stringify(J) : String(J);
              N.push(
                `${ee} ${V} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          N.join(`
`)
        );
      },
      async settle(r = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((h) => setTimeout(h, 0));
          const a = this.inspect();
          if (
            a.inflight.length === 0 &&
            !w.isReconciling &&
            !w.reconcileScheduled
          )
            return;
          if (Date.now() - n > r) {
            const h = [];
            a.inflight.length > 0 &&
              h.push(
                `${a.inflight.length} resolvers inflight: ${a.inflight.map((M) => M.resolverId).join(", ")}`,
              ),
              w.isReconciling && h.push("reconciliation in progress"),
              w.reconcileScheduled && h.push("reconcile scheduled");
            const S = w.previousRequirements.all();
            throw (
              (S.length > 0 &&
                h.push(
                  `${S.length} unmet requirements: ${S.map((M) => M.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${r}ms. ${h.join("; ")}`,
              ))
            );
          }
          await new Promise((h) => setTimeout(h, 10));
        }
      },
      getSnapshot() {
        return { facts: j.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: a,
            includeFacts: h,
            ttlSeconds: S,
            metadata: M,
            includeVersion: N,
          } = r,
          W = {},
          B = Object.keys(i),
          V;
        if ((n ? (V = n.filter((ee) => B.includes(ee))) : (V = B), a)) {
          const ee = new Set(a);
          V = V.filter((X) => !ee.has(X));
        }
        for (const ee of V)
          try {
            W[ee] = A.get(ee);
          } catch {}
        if (h && h.length > 0) {
          const ee = j.toObject();
          for (const X of h) X in ee && (W[X] = ee[X]);
        }
        const J = Date.now(),
          re = { data: W, createdAt: J };
        return (
          S !== void 0 && S > 0 && (re.expiresAt = J + S * 1e3),
          N && (re.version = Dt(W)),
          M && (re.metadata = M),
          re
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: a, excludeDerivations: h } = r,
          S = Object.keys(i),
          M;
        if ((a ? (M = a.filter((W) => S.includes(W))) : (M = S), h)) {
          const W = new Set(h);
          M = M.filter((B) => !W.has(B));
        }
        if (M.length === 0) return () => {};
        let N = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return A.subscribe(M, () => {
          const W = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          W.version !== N && ((N = W.version), n(W));
        });
      },
      restore(r) {
        if (!r || typeof r != "object")
          throw new Error(
            "[Directive] restore() requires a valid snapshot object",
          );
        if (!r.facts || typeof r.facts != "object")
          throw new Error(
            "[Directive] restore() snapshot must have a facts object",
          );
        if (!Se(r))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        j.batch(() => {
          for (const [n, a] of Object.entries(r.facts))
            ae.has(n) || j.set(n, a);
        });
      },
      onSettledChange(r) {
        return (
          R.add(r),
          () => {
            R.delete(r);
          }
        );
      },
      onTimeTravelChange(r) {
        return (
          x.add(r),
          () => {
            x.delete(r);
          }
        );
      },
      batch(r) {
        j.batch(r);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !w.isReconciling &&
          !w.reconcileScheduled
        );
      },
      get isRunning() {
        return w.isRunning;
      },
      get isInitialized() {
        return w.isInitialized;
      },
      get isReady() {
        return w.isReady;
      },
      whenReady() {
        return w.isReady
          ? Promise.resolve()
          : w.isRunning
            ? (w.readyPromise ||
                (w.readyPromise = new Promise((r) => {
                  w.readyResolve = r;
                })),
              w.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function k(r) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" on a destroyed system.`,
      );
    const n = (a, h) => {
      if (a) {
        for (const S of Object.keys(a))
          if (ae.has(S))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${S}" in ${h}.`,
            );
      }
    };
    n(r.schema, "schema"),
      n(r.events, "events"),
      n(r.derive, "derive"),
      n(r.effects, "effects"),
      n(r.constraints, "constraints"),
      n(r.resolvers, "resolvers");
    for (const a of Object.keys(r.schema))
      if (a in t)
        throw new Error(
          `[Directive] Schema collision: Fact "${a}" already exists. Cannot register module "${r.id}".`,
        );
    if (r.snapshotEvents) {
      u === null && (u = new Set(Object.keys(l)));
      for (const a of r.snapshotEvents) u.add(a);
    } else if (u !== null && r.events)
      for (const a of Object.keys(r.events)) u.add(a);
    Object.assign(t, r.schema),
      r.events && Object.assign(l, r.events),
      r.derive && (Object.assign(i, r.derive), A.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(o, r.effects), L.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(s, r.constraints), I.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(d, r.resolvers), m.registerDefinitions(r.resolvers)),
      j.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        j.batch(() => {
          r.init($);
        }),
      r.hooks?.onInit?.(y),
      w.isRunning && (r.hooks?.onStart?.(y), q());
  }
  (y.registerModule = k), c.emitInit(y);
  for (const r of e.modules) r.hooks?.onInit?.(y);
  return y;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Ut(e) {
  const t = Object.keys(e),
    l = new Set(),
    i = new Set(),
    o = [],
    s = [];
  function d(u) {
    if (l.has(u)) return;
    if (i.has(u)) {
      const p = s.indexOf(u),
        c = [...s.slice(p), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    i.add(u), s.push(u);
    const g = e[u];
    if (g?.crossModuleDeps)
      for (const p of Object.keys(g.crossModuleDeps)) t.includes(p) && d(p);
    s.pop(), i.delete(u), l.add(u), o.push(u);
  }
  for (const u of t) d(u);
  return o;
}
var Qe = new WeakMap(),
  Xe = new WeakMap(),
  Ze = new WeakMap(),
  et = new WeakMap();
function Ht(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Jt(e);
  }
  const t = e;
  if (Array.isArray(t.modules))
    throw new Error(`[Directive] createSystem expects modules as an object, not an array.

Instead of:
  createSystem({ modules: [authModule, dataModule] })

Use:
  createSystem({ modules: { auth: authModule, data: dataModule } })

Or for a single module:
  createSystem({ module: counterModule })`);
  return Kt(t);
}
function Kt(e) {
  const t = e.modules,
    l = new Set(Object.keys(t)),
    i = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let o,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      x = Object.keys(t).filter((v) => !m.includes(v));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    o = m;
  } else s === "declaration" ? (o = Object.keys(t)) : (o = Ut(t));
  let d = e.debug,
    u = e.errorBoundary;
  e.zeroConfig &&
    ((d = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (u = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const m of Object.keys(t)) {
    if (m.includes(H))
      throw new Error(
        `[Directive] Module name "${m}" contains the reserved separator "${H}". Module names cannot contain "${H}".`,
      );
    const x = t[m];
    if (x) {
      for (const v of Object.keys(x.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const g = [];
  for (const m of o) {
    const x = t[m];
    if (!x) continue;
    const v = x.crossModuleDeps && Object.keys(x.crossModuleDeps).length > 0,
      C = v ? Object.keys(x.crossModuleDeps) : [],
      R = {};
    for (const [y, k] of Object.entries(x.schema.facts)) R[`${m}${H}${y}`] = k;
    const z = {};
    if (x.schema.derivations)
      for (const [y, k] of Object.entries(x.schema.derivations))
        z[`${m}${H}${y}`] = k;
    const f = {};
    if (x.schema.events)
      for (const [y, k] of Object.entries(x.schema.events))
        f[`${m}${H}${y}`] = k;
    const b = x.init
        ? (y) => {
            const k = oe(y, m);
            x.init(k);
          }
        : void 0,
      w = {};
    if (x.derive)
      for (const [y, k] of Object.entries(x.derive))
        w[`${m}${H}${y}`] = (r, n) => {
          const a = v ? ce(r, m, C) : oe(r, m),
            h = ze(n, m);
          return k(a, h);
        };
    const q = {};
    if (x.events)
      for (const [y, k] of Object.entries(x.events))
        q[`${m}${H}${y}`] = (r, n) => {
          const a = oe(r, m);
          k(a, n);
        };
    const F = {};
    if (x.constraints)
      for (const [y, k] of Object.entries(x.constraints)) {
        const r = k;
        F[`${m}${H}${y}`] = {
          ...r,
          deps: r.deps?.map((n) => `${m}${H}${n}`),
          when: (n) => {
            const a = v ? ce(n, m, C) : oe(n, m);
            return r.when(a);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const a = v ? ce(n, m, C) : oe(n, m);
                  return r.require(a);
                }
              : r.require,
        };
      }
    const U = {};
    if (x.resolvers)
      for (const [y, k] of Object.entries(x.resolvers)) {
        const r = k;
        U[`${m}${H}${y}`] = {
          ...r,
          resolve: async (n, a) => {
            const h = Ie(a.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: h[m], signal: a.signal });
          },
        };
      }
    const P = {};
    if (x.effects)
      for (const [y, k] of Object.entries(x.effects)) {
        const r = k;
        P[`${m}${H}${y}`] = {
          ...r,
          run: (n, a) => {
            const h = v ? ce(n, m, C) : oe(n, m),
              S = a ? (v ? ce(a, m, C) : oe(a, m)) : void 0;
            return r.run(h, S);
          },
          deps: r.deps?.map((n) => `${m}${H}${n}`),
        };
      }
    g.push({
      id: x.id,
      schema: {
        facts: R,
        derivations: z,
        events: f,
        requirements: x.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: q,
      effects: P,
      constraints: F,
      resolvers: U,
      hooks: x.hooks,
      snapshotEvents:
        i && !i.has(m) ? [] : x.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let p = null,
    c = null;
  function E(m) {
    for (const [x, v] of Object.entries(m))
      if (!ne.has(x) && l.has(x)) {
        if (v && typeof v == "object" && !Se(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, R] of Object.entries(v))
          ne.has(C) || (c.facts[`${x}${H}${C}`] = R);
      }
  }
  c = gt({
    modules: g.map((m) => ({
      id: m.id,
      schema: m.schema.facts,
      requirements: m.schema.requirements,
      init: m.init,
      derive: m.derive,
      events: m.events,
      effects: m.effects,
      constraints: m.constraints,
      resolvers: m.resolvers,
      hooks: m.hooks,
      snapshotEvents: m.snapshotEvents,
    })),
    plugins: e.plugins,
    debug: d,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && E(e.initialFacts), p && (E(p), (p = null));
    },
  });
  const _ = new Map();
  for (const m of Object.keys(t)) {
    const x = t[m];
    if (!x) continue;
    const v = [];
    for (const C of Object.keys(x.schema.facts)) v.push(`${m}${H}${C}`);
    if (x.schema.derivations)
      for (const C of Object.keys(x.schema.derivations)) v.push(`${m}${H}${C}`);
    _.set(m, v);
  }
  const O = { names: null };
  function D() {
    return O.names === null && (O.names = Object.keys(t)), O.names;
  }
  let j = Ie(c.facts, t, D),
    $ = Vt(c.derive, t, D),
    A = Yt(c, t, D),
    L = null,
    I = e.tickMs;
  return {
    _mode: "namespaced",
    facts: j,
    debug: c.debug,
    derive: $,
    events: A,
    constraints: c.constraints,
    effects: c.effects,
    get isRunning() {
      return c.isRunning;
    },
    get isSettled() {
      return c.isSettled;
    },
    get isInitialized() {
      return c.isInitialized;
    },
    get isReady() {
      return c.isReady;
    },
    whenReady: c.whenReady.bind(c),
    async hydrate(m) {
      if (c.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const x = await m();
      x && typeof x == "object" && (p = x);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), I && I > 0)) {
        const m = Object.keys(g[0]?.events ?? {}).find((x) =>
          x.endsWith(`${H}tick`),
        );
        m &&
          (L = setInterval(() => {
            c.dispatch({ type: m });
          }, I));
      }
    },
    stop() {
      L && (clearInterval(L), (L = null)), c.stop();
    },
    destroy() {
      this.stop(), c.destroy();
    },
    dispatch(m) {
      c.dispatch(m);
    },
    batch: c.batch.bind(c),
    read(m) {
      return c.read(ue(m));
    },
    subscribe(m, x) {
      const v = [];
      for (const C of m)
        if (C.endsWith(".*")) {
          const R = C.slice(0, -2),
            z = _.get(R);
          z && v.push(...z);
        } else v.push(ue(C));
      return c.subscribe(v, x);
    },
    subscribeModule(m, x) {
      const v = _.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, x);
    },
    watch(m, x, v) {
      return c.watch(ue(m), x, v);
    },
    when(m, x) {
      return c.when(() => m(j), x);
    },
    onSettledChange: c.onSettledChange.bind(c),
    onTimeTravelChange: c.onTimeTravelChange.bind(c),
    inspect: c.inspect.bind(c),
    settle: c.settle.bind(c),
    explain: c.explain.bind(c),
    getSnapshot: c.getSnapshot.bind(c),
    restore: c.restore.bind(c),
    getDistributableSnapshot(m) {
      const x = {
          ...m,
          includeDerivations: m?.includeDerivations?.map(ue),
          excludeDerivations: m?.excludeDerivations?.map(ue),
          includeFacts: m?.includeFacts?.map(ue),
        },
        v = c.getDistributableSnapshot(x),
        C = {};
      for (const [R, z] of Object.entries(v.data)) {
        const f = R.indexOf(H);
        if (f > 0) {
          const b = R.slice(0, f),
            w = R.slice(f + H.length);
          C[b] || (C[b] = {}), (C[b][w] = z);
        } else C._root || (C._root = {}), (C._root[R] = z);
      }
      return { ...v, data: C };
    },
    watchDistributableSnapshot(m, x) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ue),
        excludeDerivations: m?.excludeDerivations?.map(ue),
        includeFacts: m?.includeFacts?.map(ue),
      };
      return c.watchDistributableSnapshot(v, (C) => {
        const R = {};
        for (const [z, f] of Object.entries(C.data)) {
          const b = z.indexOf(H);
          if (b > 0) {
            const w = z.slice(0, b),
              q = z.slice(b + H.length);
            R[w] || (R[w] = {}), (R[w][q] = f);
          } else R._root || (R._root = {}), (R._root[z] = f);
        }
        x({ ...C, data: R });
      });
    },
    registerModule(m, x) {
      if (l.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(H))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${H}".`,
        );
      if (ne.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys(x.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${H}".`,
          );
      const v = x,
        C = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = C ? Object.keys(v.crossModuleDeps) : [],
        z = {};
      for (const [y, k] of Object.entries(v.schema.facts))
        z[`${m}${H}${y}`] = k;
      const f = v.init
          ? (y) => {
              const k = oe(y, m);
              v.init(k);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, k] of Object.entries(v.derive))
          b[`${m}${H}${y}`] = (r, n) => {
            const a = C ? ce(r, m, R) : oe(r, m),
              h = ze(n, m);
            return k(a, h);
          };
      const w = {};
      if (v.events)
        for (const [y, k] of Object.entries(v.events))
          w[`${m}${H}${y}`] = (r, n) => {
            const a = oe(r, m);
            k(a, n);
          };
      const q = {};
      if (v.constraints)
        for (const [y, k] of Object.entries(v.constraints)) {
          const r = k;
          q[`${m}${H}${y}`] = {
            ...r,
            deps: r.deps?.map((n) => `${m}${H}${n}`),
            when: (n) => {
              const a = C ? ce(n, m, R) : oe(n, m);
              return r.when(a);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const a = C ? ce(n, m, R) : oe(n, m);
                    return r.require(a);
                  }
                : r.require,
          };
        }
      const F = {};
      if (v.resolvers)
        for (const [y, k] of Object.entries(v.resolvers)) {
          const r = k;
          F[`${m}${H}${y}`] = {
            ...r,
            resolve: async (n, a) => {
              const h = Ie(a.facts, t, D);
              await r.resolve(n, { facts: h[m], signal: a.signal });
            },
          };
        }
      const U = {};
      if (v.effects)
        for (const [y, k] of Object.entries(v.effects)) {
          const r = k;
          U[`${m}${H}${y}`] = {
            ...r,
            run: (n, a) => {
              const h = C ? ce(n, m, R) : oe(n, m),
                S = a ? (C ? ce(a, m, R) : oe(a, m)) : void 0;
              return r.run(h, S);
            },
            deps: r.deps?.map((n) => `${m}${H}${n}`),
          };
        }
      l.add(m), (t[m] = v), (O.names = null);
      const P = [];
      for (const y of Object.keys(v.schema.facts)) P.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          P.push(`${m}${H}${y}`);
      _.set(m, P),
        c.registerModule({
          id: v.id,
          schema: z,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(U).length > 0 ? U : void 0,
          constraints: Object.keys(q).length > 0 ? q : void 0,
          resolvers: Object.keys(F).length > 0 ? F : void 0,
          hooks: v.hooks,
          snapshotEvents:
            i && !i.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${H}${y}`),
        });
    },
  };
}
function ue(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${H}${l.join(H)}`;
  }
  return e;
}
function oe(e, t) {
  let l = Qe.get(e);
  if (l) {
    const o = l.get(t);
    if (o) return o;
  } else (l = new Map()), Qe.set(e, l);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !ne.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${t}${H}${s}`];
      },
      set(o, s, d) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : ((e[`${t}${H}${s}`] = d), !0);
      },
      has(o, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${t}${H}${s}` in e;
      },
      deleteProperty(o, s) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : (delete e[`${t}${H}${s}`], !0);
      },
    },
  );
  return l.set(t, i), i;
}
function Ie(e, t, l) {
  const i = Xe.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(t, d))
          return oe(e, d);
      },
      has(s, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(t, d);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, d) {
        if (typeof d != "symbol" && Object.hasOwn(t, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Xe.set(e, o), o;
}
var tt = new WeakMap();
function ce(e, t, l) {
  let i = `${t}:${JSON.stringify([...l].sort())}`,
    o = tt.get(e);
  if (o) {
    const g = o.get(i);
    if (g) return g;
  } else (o = new Map()), tt.set(e, o);
  const s = new Set(l),
    d = ["self", ...l],
    u = new Proxy(
      {},
      {
        get(g, p) {
          if (typeof p != "symbol" && !ne.has(p)) {
            if (p === "self") return oe(e, t);
            if (s.has(p)) return oe(e, p);
          }
        },
        has(g, p) {
          return typeof p == "symbol" || ne.has(p)
            ? !1
            : p === "self" || s.has(p);
        },
        ownKeys() {
          return d;
        },
        getOwnPropertyDescriptor(g, p) {
          if (typeof p != "symbol" && (p === "self" || s.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return o.set(i, u), u;
}
function ze(e, t) {
  let l = et.get(e);
  if (l) {
    const o = l.get(t);
    if (o) return o;
  } else (l = new Map()), et.set(e, l);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !ne.has(s)) return e[`${t}${H}${s}`];
      },
      has(o, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${t}${H}${s}` in e;
      },
    },
  );
  return l.set(t, i), i;
}
function Vt(e, t, l) {
  const i = Ze.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(t, d))
          return ze(e, d);
      },
      has(s, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(t, d);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, d) {
        if (typeof d != "symbol" && Object.hasOwn(t, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ze.set(e, o), o;
}
var rt = new WeakMap();
function Yt(e, t, l) {
  let i = rt.get(e);
  return (
    i || ((i = new Map()), rt.set(e, i)),
    new Proxy(
      {},
      {
        get(o, s) {
          if (typeof s == "symbol" || ne.has(s) || !Object.hasOwn(t, s)) return;
          const d = i.get(s);
          if (d) return d;
          const u = new Proxy(
            {},
            {
              get(g, p) {
                if (typeof p != "symbol" && !ne.has(p))
                  return (c) => {
                    e.dispatch({ type: `${s}${H}${p}`, ...c });
                  };
              },
            },
          );
          return i.set(s, u), u;
        },
        has(o, s) {
          return typeof s == "symbol" || ne.has(s) ? !1 : Object.hasOwn(t, s);
        },
        ownKeys() {
          return l();
        },
        getOwnPropertyDescriptor(o, s) {
          if (typeof s != "symbol" && Object.hasOwn(t, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Jt(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !Se(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let l = e.debug,
    i = e.errorBoundary;
  e.zeroConfig &&
    ((l = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (i = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let o = null,
    s = null;
  s = gt({
    modules: [
      {
        id: t.id,
        schema: t.schema.facts,
        requirements: t.schema.requirements,
        init: t.init,
        derive: t.derive,
        events: t.events,
        effects: t.effects,
        constraints: t.constraints,
        resolvers: t.resolvers,
        hooks: t.hooks,
        snapshotEvents: t.snapshotEvents,
      },
    ],
    plugins: e.plugins,
    debug: l,
    errorBoundary: i,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, c] of Object.entries(e.initialFacts))
          ne.has(p) || (s.facts[p] = c);
      if (o) {
        for (const [p, c] of Object.entries(o)) ne.has(p) || (s.facts[p] = c);
        o = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(p, c) {
          if (typeof c != "symbol" && !ne.has(c))
            return (E) => {
              s.dispatch({ type: c, ...E });
            };
        },
      },
    ),
    u = null,
    g = e.tickMs;
  return {
    _mode: "single",
    facts: s.facts,
    debug: s.debug,
    derive: s.derive,
    events: d,
    constraints: s.constraints,
    effects: s.effects,
    get isRunning() {
      return s.isRunning;
    },
    get isSettled() {
      return s.isSettled;
    },
    get isInitialized() {
      return s.isInitialized;
    },
    get isReady() {
      return s.isReady;
    },
    whenReady: s.whenReady.bind(s),
    async hydrate(p) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await p();
      c && typeof c == "object" && (o = c);
    },
    initialize() {
      s.initialize();
    },
    start() {
      s.start(),
        g &&
          g > 0 &&
          t.events &&
          "tick" in t.events &&
          (u = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, g));
    },
    stop() {
      u && (clearInterval(u), (u = null)), s.stop();
    },
    destroy() {
      this.stop(), s.destroy();
    },
    dispatch(p) {
      s.dispatch(p);
    },
    batch: s.batch.bind(s),
    read(p) {
      return s.read(p);
    },
    subscribe(p, c) {
      return s.subscribe(p, c);
    },
    watch(p, c, E) {
      return s.watch(p, c, E);
    },
    when(p, c) {
      return s.when(p, c);
    },
    onSettledChange: s.onSettledChange.bind(s),
    onTimeTravelChange: s.onTimeTravelChange.bind(s),
    inspect: s.inspect.bind(s),
    settle: s.settle.bind(s),
    explain: s.explain.bind(s),
    getSnapshot: s.getSnapshot.bind(s),
    restore: s.restore.bind(s),
    getDistributableSnapshot: s.getDistributableSnapshot.bind(s),
    watchDistributableSnapshot: s.watchDistributableSnapshot.bind(s),
    registerModule(p) {
      s.registerModule({
        id: p.id,
        schema: p.schema.facts,
        requirements: p.schema.requirements,
        init: p.init,
        derive: p.derive,
        events: p.events,
        effects: p.effects,
        constraints: p.constraints,
        resolvers: p.resolvers,
        hooks: p.hooks,
        snapshotEvents: p.snapshotEvents,
      });
    },
  };
}
var yt = class {
  constructor(e) {
    (this.capacity = e), (this.buf = new Array(e));
  }
  buf;
  head = 0;
  _size = 0;
  get size() {
    return this._size;
  }
  push(e) {
    (this.buf[this.head] = e),
      (this.head = (this.head + 1) % this.capacity),
      this._size < this.capacity && this._size++;
  }
  toArray() {
    return this._size === 0
      ? []
      : this._size < this.capacity
        ? this.buf.slice(0, this._size)
        : [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }
  clear() {
    (this.buf = new Array(this.capacity)), (this.head = 0), (this._size = 0);
  }
};
function Ne() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function vt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (l, i) =>
        typeof i == "bigint"
          ? String(i) + "n"
          : typeof i == "symbol"
            ? String(i)
            : i,
      );
      return t.length > 120 ? t.slice(0, 117) + "..." : t;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function me(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function $e(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Gt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Qt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Ne() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function Xt() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var Zt = 200,
  Oe = 340,
  ye = 16,
  ve = 80,
  nt = 2,
  it = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function er() {
  return { entries: new yt(Zt), inflight: new Map() };
}
function tr() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var rr = 1e4,
  nr = 100;
function ir() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var or = 50,
  ot = 200,
  T = {
    bg: "#1a1a2e",
    text: "#e0e0e0",
    accent: "#8b9aff",
    muted: "#b0b0d0",
    border: "#333",
    rowBorder: "#2a2a4a",
    green: "#4ade80",
    yellow: "#fbbf24",
    red: "#f87171",
    closeBtn: "#aaa",
    font: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  Z = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function sr(e, t, l, i) {
  let o = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${T.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const u = document.createElement("button");
  u.setAttribute("aria-label", "Open Directive DevTools"),
    u.setAttribute("aria-expanded", String(l)),
    (u.title = "Ctrl+Shift+D to toggle"),
    Object.assign(u.style, {
      ...s,
      background: T.bg,
      color: T.text,
      border: `1px solid ${T.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: T.font,
      fontSize: "12px",
      display: l ? "none" : "block",
    }),
    (u.textContent = "Directive");
  const g = document.createElement("div");
  g.setAttribute("role", "region"),
    g.setAttribute("aria-label", "Directive DevTools"),
    g.setAttribute("data-directive-devtools", ""),
    (g.tabIndex = -1),
    Object.assign(g.style, {
      ...s,
      background: T.bg,
      color: T.text,
      border: `1px solid ${T.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: T.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: l ? "block" : "none",
    });
  const p = document.createElement("div");
  Object.assign(p.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const c = document.createElement("strong");
  (c.style.color = T.accent),
    (c.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const E = document.createElement("button");
  E.setAttribute("aria-label", "Close DevTools"),
    Object.assign(E.style, {
      background: "none",
      border: "none",
      color: T.closeBtn,
      cursor: "pointer",
      fontSize: "16px",
      padding: "8px 12px",
      minWidth: "44px",
      minHeight: "44px",
      lineHeight: "1",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }),
    (E.textContent = "×"),
    p.appendChild(c),
    p.appendChild(E),
    g.appendChild(p);
  const _ = document.createElement("div");
  (_.style.marginBottom = "6px"), _.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = T.green),
    (O.textContent = "Settled"),
    _.appendChild(O),
    g.appendChild(_);
  const D = document.createElement("div");
  Object.assign(D.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const j = document.createElement("button");
  Object.assign(j.style, {
    background: "none",
    border: `1px solid ${T.border}`,
    color: T.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: T.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (j.textContent = "◀ Undo"),
    (j.disabled = !0);
  const $ = document.createElement("button");
  Object.assign($.style, {
    background: "none",
    border: `1px solid ${T.border}`,
    color: T.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: T.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    ($.textContent = "Redo ▶"),
    ($.disabled = !0);
  const A = document.createElement("span");
  (A.style.color = T.muted),
    (A.style.fontSize = "10px"),
    D.appendChild(j),
    D.appendChild($),
    D.appendChild(A),
    g.appendChild(D);
  function L(K, Y) {
    const Q = document.createElement("details");
    Y && (Q.open = !0), (Q.style.marginBottom = "4px");
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: T.accent,
      marginBottom: "4px",
    });
    const pe = document.createElement("span");
    (se.textContent = `${K} (`),
      se.appendChild(pe),
      se.appendChild(document.createTextNode(")")),
      (pe.textContent = "0"),
      Q.appendChild(se);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const We = document.createElement("thead"),
      Ue = document.createElement("tr");
    for (const xt of ["Key", "Value"]) {
      const xe = document.createElement("th");
      (xe.scope = "col"),
        Object.assign(xe.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: T.accent,
        }),
        (xe.textContent = xt),
        Ue.appendChild(xe);
    }
    We.appendChild(Ue), de.appendChild(We);
    const He = document.createElement("tbody");
    return (
      de.appendChild(He),
      Q.appendChild(de),
      { details: Q, tbody: He, countSpan: pe }
    );
  }
  function I(K, Y) {
    const Q = document.createElement("details");
    Q.style.marginBottom = "4px";
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: Y,
      marginBottom: "4px",
    });
    const pe = document.createElement("span");
    (se.textContent = `${K} (`),
      se.appendChild(pe),
      se.appendChild(document.createTextNode(")")),
      (pe.textContent = "0"),
      Q.appendChild(se);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      Q.appendChild(de),
      { details: Q, list: de, countSpan: pe }
    );
  }
  const m = L("Facts", !0);
  g.appendChild(m.details);
  const x = L("Derivations", !1);
  g.appendChild(x.details);
  const v = I("Inflight", T.yellow);
  g.appendChild(v.details);
  const C = I("Unmet", T.red);
  g.appendChild(C.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const z = document.createElement("summary");
  Object.assign(z.style, {
    cursor: "pointer",
    color: T.accent,
    marginBottom: "4px",
  }),
    (z.textContent = "Performance"),
    R.appendChild(z);
  const f = document.createElement("div");
  (f.style.fontSize = "10px"),
    (f.style.color = T.muted),
    (f.textContent = "No data yet"),
    R.appendChild(f),
    g.appendChild(R);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const w = document.createElement("summary");
  Object.assign(w.style, {
    cursor: "pointer",
    color: T.accent,
    marginBottom: "4px",
  }),
    (w.textContent = "Dependency Graph"),
    b.appendChild(w);
  const q = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  q.setAttribute("width", "100%"),
    q.setAttribute("height", "120"),
    q.setAttribute("role", "img"),
    q.setAttribute("aria-label", "System dependency graph"),
    (q.style.display = "block"),
    q.setAttribute("viewBox", "0 0 460 120"),
    q.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    b.appendChild(q),
    g.appendChild(b);
  const F = document.createElement("details");
  F.style.marginBottom = "4px";
  const U = document.createElement("summary");
  Object.assign(U.style, {
    cursor: "pointer",
    color: T.accent,
    marginBottom: "4px",
  }),
    (U.textContent = "Timeline"),
    F.appendChild(U);
  const P = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  P.setAttribute("width", "100%"),
    P.setAttribute("height", "60"),
    P.setAttribute("role", "img"),
    P.setAttribute("aria-label", "Resolver execution timeline"),
    (P.style.display = "block"),
    P.setAttribute("viewBox", `0 0 ${Oe} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Oe / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", T.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", T.font),
    (y.textContent = "No resolver activity yet"),
    P.appendChild(y),
    F.appendChild(P),
    g.appendChild(F);
  let k, r, n, a;
  if (i) {
    const K = document.createElement("details");
    K.style.marginBottom = "4px";
    const Y = document.createElement("summary");
    Object.assign(Y.style, {
      cursor: "pointer",
      color: T.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (Y.textContent = "Events ("),
      Y.appendChild(n),
      Y.appendChild(document.createTextNode(")")),
      K.appendChild(Y),
      (r = document.createElement("div")),
      Object.assign(r.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      r.setAttribute("role", "log"),
      r.setAttribute("aria-live", "polite"),
      (r.tabIndex = 0);
    const Q = document.createElement("div");
    (Q.style.color = T.muted),
      (Q.style.padding = "4px"),
      (Q.textContent = "Waiting for events..."),
      (Q.className = "dt-events-empty"),
      r.appendChild(Q),
      K.appendChild(r),
      g.appendChild(K),
      (k = K),
      (a = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (a = document.createElement("div")),
      (a.style.fontSize = "10px"),
      (a.style.color = T.muted),
      (a.style.marginTop = "4px"),
      (a.style.fontStyle = "italic"),
      (a.textContent = "Enable trace: true for event log"),
      g.appendChild(a);
  const h = document.createElement("div");
  Object.assign(h.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const S = document.createElement("button");
  Object.assign(S.style, {
    background: "none",
    border: `1px solid ${T.border}`,
    color: T.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: T.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (S.textContent = "⏺ Record");
  const M = document.createElement("button");
  Object.assign(M.style, {
    background: "none",
    border: `1px solid ${T.border}`,
    color: T.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: T.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (M.textContent = "⤓ Export"),
    h.appendChild(S),
    h.appendChild(M),
    g.appendChild(h),
    g.addEventListener(
      "wheel",
      (K) => {
        const Y = g,
          Q = Y.scrollTop === 0 && K.deltaY < 0,
          se = Y.scrollTop + Y.clientHeight >= Y.scrollHeight && K.deltaY > 0;
        (Q || se) && K.preventDefault();
      },
      { passive: !1 },
    );
  let N = l,
    W = new Set();
  function B() {
    (N = !0),
      (g.style.display = "block"),
      (u.style.display = "none"),
      u.setAttribute("aria-expanded", "true"),
      E.focus();
  }
  function V() {
    (N = !1),
      (g.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", B), E.addEventListener("click", V);
  function J(K) {
    K.key === "Escape" && N && V();
  }
  g.addEventListener("keydown", J);
  function re(K) {
    K.key === "d" &&
      K.shiftKey &&
      (K.ctrlKey || K.metaKey) &&
      (K.preventDefault(), N ? V() : B());
  }
  document.addEventListener("keydown", re);
  function ee() {
    o || (document.body.appendChild(u), document.body.appendChild(g));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function X() {
    (o = !0),
      u.removeEventListener("click", B),
      E.removeEventListener("click", V),
      g.removeEventListener("keydown", J),
      document.removeEventListener("keydown", re),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const K of W) clearTimeout(K);
    W.clear(), u.remove(), g.remove(), d.remove();
  }
  return {
    refs: {
      container: g,
      toggleBtn: u,
      titleEl: c,
      statusEl: O,
      factsBody: m.tbody,
      factsCount: m.countSpan,
      derivBody: x.tbody,
      derivCount: x.countSpan,
      derivSection: x.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: C.list,
      unmetSection: C.details,
      unmetCount: C.countSpan,
      perfSection: R,
      perfBody: f,
      timeTravelSection: D,
      timeTravelLabel: A,
      undoBtn: j,
      redoBtn: $,
      flowSection: b,
      flowSvg: q,
      timelineSection: F,
      timelineSvg: P,
      eventsSection: k,
      eventsList: r,
      eventsCount: n,
      traceHint: a,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: X,
    isOpen: () => N,
    flashTimers: W,
  };
}
function Ce(e, t, l, i, o, s) {
  let d = vt(i),
    u = e.get(l);
  if (u) {
    const g = u.cells;
    if (g[1] && ((g[1].textContent = d), o && s)) {
      const p = g[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (p.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${T.rowBorder}`);
    const g = document.createElement("td");
    Object.assign(g.style, { padding: "2px 4px", color: T.muted }),
      (g.textContent = l);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = d),
      u.appendChild(g),
      u.appendChild(p),
      t.appendChild(u),
      e.set(l, u);
  }
}
function lr(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function Me(e, t, l) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const i of t) {
      const o = document.createElement("li");
      (o.style.fontSize = "11px"),
        (o.textContent = `${i.resolverId} (${i.id})`),
        e.inflightList.appendChild(o);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = T.muted),
      (i.textContent = "None"),
      e.inflightList.appendChild(i);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(l.length)),
    l.length > 0)
  )
    for (const i of l) {
      const o = document.createElement("li");
      (o.style.fontSize = "11px"),
        (o.textContent = `${i.requirement.type} from ${i.fromConstraint}`),
        e.unmetList.appendChild(o);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = T.muted),
      (i.textContent = "None"),
      e.unmetList.appendChild(i);
  }
}
function qe(e, t, l) {
  const i = t === 0 && l === 0;
  (e.statusEl.style.color = i ? T.green : T.yellow),
    (e.statusEl.textContent = i ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = i ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${i ? "" : " (system working)"}`,
    );
}
function st(e, t, l, i) {
  const o = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(o.length)), o.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = T.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      d.appendChild(u),
      e.derivBody.appendChild(d);
    return;
  }
  const s = new Set(o);
  for (const [d, u] of t) s.has(d) || (u.remove(), t.delete(d));
  for (const d of o) {
    let u;
    try {
      u = vt(l.read(d));
    } catch {
      u = "<error>";
    }
    Ce(t, e.derivBody, d, u, !0, i);
  }
}
function ar(e, t, l, i) {
  const o = e.eventsList.querySelector(".dt-events-empty");
  o && o.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${T.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    u = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    g;
  try {
    const _ = JSON.stringify(l);
    g = me(_, 60);
  } catch {
    g = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = T.closeBtn), (p.textContent = u);
  const c = document.createElement("span");
  (c.style.color = T.accent), (c.textContent = ` ${t} `);
  const E = document.createElement("span");
  for (
    E.style.color = T.muted,
      E.textContent = g,
      s.appendChild(p),
      s.appendChild(c),
      s.appendChild(E),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > or;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(i);
}
function cr(e, t) {
  e.perfBody.replaceChildren();
  const l =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    i = [
      `Reconciles: ${t.reconcileCount}  (avg ${l}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const o of i) {
    const s = document.createElement("div");
    (s.style.marginBottom = "2px"),
      (s.textContent = o),
      e.perfBody.appendChild(s);
  }
  if (t.resolverStats.size > 0) {
    const o = document.createElement("div");
    (o.style.marginTop = "4px"),
      (o.style.marginBottom = "2px"),
      (o.style.color = T.accent),
      (o.textContent = "Resolvers:"),
      e.perfBody.appendChild(o);
    const s = [...t.resolverStats.entries()].sort(
      (d, u) => u[1].totalMs - d[1].totalMs,
    );
    for (const [d, u] of s) {
      const g = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${d}: ${u.count}x, avg ${g}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (p.style.color = T.red),
        e.perfBody.appendChild(p);
    }
  }
}
function lt(e, t) {
  const l = t.debug;
  if (!l) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const i = l.currentIndex,
    o = l.snapshots.length;
  e.timeTravelLabel.textContent = o > 0 ? `${i + 1} / ${o}` : "0 snapshots";
  const s = i > 0,
    d = i < o - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function ur(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Te = new WeakMap();
function dr(e, t, l, i, o, s) {
  return [
    e.join(","),
    t.join(","),
    l.map((d) => `${d.id}:${d.active}`).join(","),
    [...i.entries()].map(([d, u]) => `${d}:${u.status}:${u.type}`).join(","),
    o.join(","),
    s.join(","),
  ].join("|");
}
function fr(e, t, l, i, o) {
  for (const s of l) {
    const d = e.nodes.get(`0:${s}`);
    if (!d) continue;
    const u = t.recentlyChangedFacts.has(s);
    d.rect.setAttribute("fill", u ? T.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of i) {
    const d = e.nodes.get(`1:${s}`);
    if (!d) continue;
    const u = t.recentlyComputedDerivations.has(s);
    d.rect.setAttribute("fill", u ? T.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of o) {
    const d = e.nodes.get(`2:${s}`);
    if (!d) continue;
    const u = t.recentlyActiveConstraints.has(s),
      g = d.rect.getAttribute("stroke") ?? T.muted;
    d.rect.setAttribute("fill", u ? g + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function at(e, t, l) {
  const i = $e(t);
  if (!i) return;
  let o;
  try {
    o = Object.keys(t.facts.$store.toObject());
  } catch {
    o = [];
  }
  const s = Object.keys(t.derive),
    d = i.constraints,
    u = i.unmet,
    g = i.inflight,
    p = Object.keys(i.resolvers),
    c = new Map();
  for (const y of u)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of g)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (o.length === 0 && s.length === 0 && d.length === 0 && p.length === 0) {
    Te.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
    y.setAttribute("x", "230"),
      y.setAttribute("y", "24"),
      y.setAttribute("text-anchor", "middle"),
      y.setAttribute("fill", T.muted),
      y.setAttribute("font-size", "10"),
      y.setAttribute("font-family", T.font),
      (y.textContent = "No system topology"),
      e.flowSvg.appendChild(y);
    return;
  }
  const E = g.map((y) => y.resolverId).sort(),
    _ = dr(o, s, d, c, p, E),
    O = Te.get(e.flowSvg);
  if (O && O.fingerprint === _) {
    fr(
      O,
      l,
      o,
      s,
      d.map((y) => y.id),
    );
    return;
  }
  const D = Z.nodeW + Z.colGap,
    j = [5, 5 + D, 5 + D * 2, 5 + D * 3, 5 + D * 4],
    $ = j[4] + Z.nodeW + 5;
  function A(y) {
    let k = Z.startY + 12;
    return y.map((r) => {
      const n = { ...r, y: k };
      return (k += Z.nodeH + Z.nodeGap), n;
    });
  }
  const L = A(o.map((y) => ({ id: y, label: me(y, Z.labelMaxChars) }))),
    I = A(s.map((y) => ({ id: y, label: me(y, Z.labelMaxChars) }))),
    m = A(
      d.map((y) => ({
        id: y.id,
        label: me(y.id, Z.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    x = A(
      [...c.entries()].map(([y, k]) => ({
        id: y,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    v = A(p.map((y) => ({ id: y, label: me(y, Z.labelMaxChars) }))),
    C = Math.max(L.length, I.length, m.length, x.length, v.length, 1),
    R = Z.startY + 12 + C * (Z.nodeH + Z.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${$} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${o.length} facts, ${s.length} derivations, ${d.length} constraints, ${c.size} requirements, ${p.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, k] of z.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(j[y] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", T.accent),
      r.setAttribute("font-size", String(Z.fontSize)),
      r.setAttribute("font-family", T.font),
      (r.textContent = k),
      e.flowSvg.appendChild(r);
  }
  const f = { fingerprint: _, nodes: new Map() };
  function b(y, k, r, n, a, h, S, M) {
    const N = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(k)),
      W.setAttribute("y", String(r - 6)),
      W.setAttribute("width", String(Z.nodeW)),
      W.setAttribute("height", String(Z.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? h + "33" : "none"),
      W.setAttribute("stroke", h),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      N.appendChild(W);
    const B = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      B.setAttribute("x", String(k + 4)),
      B.setAttribute("y", String(r + 4)),
      B.setAttribute("fill", h),
      B.setAttribute("font-size", String(Z.fontSize)),
      B.setAttribute("font-family", T.font),
      B.setAttribute("opacity", S ? "0.35" : "1"),
      (B.textContent = a),
      N.appendChild(B),
      e.flowSvg.appendChild(N),
      f.nodes.set(`${y}:${n}`, { g: N, rect: W, text: B }),
      { midX: k + Z.nodeW / 2, midY: r }
    );
  }
  function w(y, k, r, n, a, h) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(k)),
      S.setAttribute("x2", String(r)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", a),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const q = new Map(),
    F = new Map(),
    U = new Map(),
    P = new Map();
  for (const y of L) {
    const k = l.recentlyChangedFacts.has(y.id),
      r = b(0, j[0], y.y, y.id, y.label, T.text, !1, k);
    q.set(y.id, r);
  }
  for (const y of I) {
    const k = l.recentlyComputedDerivations.has(y.id),
      r = b(1, j[1], y.y, y.id, y.label, T.accent, !1, k);
    F.set(y.id, r);
  }
  for (const y of m) {
    const k = l.recentlyActiveConstraints.has(y.id),
      r = b(
        2,
        j[2],
        y.y,
        y.id,
        y.label,
        y.active ? T.yellow : T.muted,
        !y.active,
        k,
      );
    U.set(y.id, r);
  }
  for (const y of x) {
    const k = y.status === "unmet" ? T.red : T.yellow,
      r = b(3, j[3], y.y, y.id, me(y.type, Z.labelMaxChars), k, !1, !1);
    P.set(y.id, r);
  }
  for (const y of v) {
    const k = g.some((r) => r.resolverId === y.id);
    b(4, j[4], y.y, y.id, y.label, k ? T.green : T.muted, !k, !1);
  }
  for (const y of I) {
    const k = l.derivationDeps.get(y.id),
      r = F.get(y.id);
    if (k && r)
      for (const n of k) {
        const a = q.get(n);
        a &&
          w(
            a.midX + Z.nodeW / 2,
            a.midY,
            r.midX - Z.nodeW / 2,
            r.midY,
            T.accent,
          );
      }
  }
  for (const y of x) {
    const k = U.get(y.fromConstraint),
      r = P.get(y.id);
    k &&
      r &&
      w(k.midX + Z.nodeW / 2, k.midY, r.midX - Z.nodeW / 2, r.midY, T.muted);
  }
  for (const y of g) {
    const k = P.get(y.id);
    if (k) {
      const r = v.find((n) => n.id === y.resolverId);
      r && w(k.midX + Z.nodeW / 2, k.midY, j[4], r.y, T.green);
    }
  }
  Te.set(e.flowSvg, f);
}
function pr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function mr(e, t) {
  const l = t.entries.toArray();
  if (l.length === 0) return;
  e.timelineSvg.replaceChildren();
  let i = 1 / 0,
    o = -1 / 0;
  for (const O of l)
    O.startMs < i && (i = O.startMs), O.endMs > o && (o = O.endMs);
  const s = performance.now();
  for (const O of t.inflight.values()) O < i && (i = O), s > o && (o = s);
  const d = o - i || 1,
    u = Oe - ve - 10,
    g = [],
    p = new Set();
  for (const O of l)
    p.has(O.resolver) || (p.add(O.resolver), g.push(O.resolver));
  for (const O of t.inflight.keys()) p.has(O) || (p.add(O), g.push(O));
  const c = g.slice(-12),
    E = ye * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Oe} ${E}`),
    e.timelineSvg.setAttribute("height", String(Math.min(E, 200)));
  const _ = 5;
  for (let O = 0; O <= _; O++) {
    const D = ve + (u * O) / _,
      j = (d * O) / _,
      $ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    $.setAttribute("x", String(D)),
      $.setAttribute("y", "8"),
      $.setAttribute("fill", T.muted),
      $.setAttribute("font-size", "6"),
      $.setAttribute("font-family", T.font),
      $.setAttribute("text-anchor", "middle"),
      ($.textContent =
        j < 1e3 ? `${j.toFixed(0)}ms` : `${(j / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild($);
    const A = document.createElementNS("http://www.w3.org/2000/svg", "line");
    A.setAttribute("x1", String(D)),
      A.setAttribute("y1", "10"),
      A.setAttribute("x2", String(D)),
      A.setAttribute("y2", String(E)),
      A.setAttribute("stroke", T.border),
      A.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(A);
  }
  for (let O = 0; O < c.length; O++) {
    const D = c[O],
      j = 12 + O * ye,
      $ = O % it.length,
      A = it[$],
      L = document.createElementNS("http://www.w3.org/2000/svg", "text");
    L.setAttribute("x", String(ve - 4)),
      L.setAttribute("y", String(j + ye / 2 + 3)),
      L.setAttribute("fill", T.muted),
      L.setAttribute("font-size", "7"),
      L.setAttribute("font-family", T.font),
      L.setAttribute("text-anchor", "end"),
      (L.textContent = me(D, 12)),
      e.timelineSvg.appendChild(L);
    const I = l.filter((x) => x.resolver === D);
    for (const x of I) {
      const v = ve + ((x.startMs - i) / d) * u,
        C = Math.max(((x.endMs - x.startMs) / d) * u, nt),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(j + 2)),
        R.setAttribute("width", String(C)),
        R.setAttribute("height", String(ye - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", x.error ? T.red : A),
        R.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = x.endMs - x.startMs;
      (z.textContent = `${D}: ${f.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        R.appendChild(z),
        e.timelineSvg.appendChild(R);
    }
    const m = t.inflight.get(D);
    if (m !== void 0) {
      const x = ve + ((m - i) / d) * u,
        v = Math.max(((s - m) / d) * u, nt),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String(x)),
        C.setAttribute("y", String(j + 2)),
        C.setAttribute("width", String(v)),
        C.setAttribute("height", String(ye - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", A),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", A),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${D}: inflight ${(s - m).toFixed(0)}ms`),
        C.appendChild(R),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${l.length} resolver executions across ${c.length} resolvers`,
  );
}
function hr() {
  if (typeof window > "u")
    return {
      systems: new Map(),
      getSystem: () => null,
      getSystems: () => [],
      inspect: () => null,
      getEvents: () => [],
      explain: () => null,
      exportSession: () => null,
      importSession: () => !1,
      clearEvents: () => {},
      subscribe: () => () => {},
    };
  if (!window.__DIRECTIVE__) {
    const e = new Map(),
      t = {
        systems: e,
        getSystem(l) {
          return l
            ? (e.get(l)?.system ?? null)
            : (e.values().next().value?.system ?? null);
        },
        getSystems() {
          return [...e.keys()];
        },
        inspect(l) {
          return this.getSystem(l)?.inspect() ?? null;
        },
        getEvents(l) {
          return l
            ? (e.get(l)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(l, i) {
          return this.getSystem(i)?.explain(l) ?? null;
        },
        subscribe(l, i) {
          const o = i ? e.get(i) : e.values().next().value;
          if (!o) {
            let s = !1,
              d = setInterval(() => {
                const g = i ? e.get(i) : e.values().next().value;
                g && !s && ((s = !0), g.subscribers.add(l));
              }, 100),
              u = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(u);
              for (const g of e.values()) g.subscribers.delete(l);
            };
          }
          return (
            o.subscribers.add(l),
            () => {
              o.subscribers.delete(l);
            }
          );
        },
        exportSession(l) {
          const i = l ? e.get(l) : e.values().next().value;
          return i
            ? JSON.stringify({
                version: 1,
                name: l ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: i.events.toArray(),
              })
            : null;
        },
        importSession(l, i) {
          try {
            if (l.length > 10 * 1024 * 1024) return !1;
            const o = JSON.parse(l);
            if (
              !o ||
              typeof o != "object" ||
              Array.isArray(o) ||
              !Array.isArray(o.events)
            )
              return !1;
            const s = i ? e.get(i) : e.values().next().value;
            if (!s) return !1;
            const d = s.maxEvents,
              u = o.events,
              g = u.length > d ? u.length - d : 0;
            s.events.clear();
            for (let p = g; p < u.length; p++) {
              const c = u[p];
              c &&
                typeof c == "object" &&
                !Array.isArray(c) &&
                typeof c.timestamp == "number" &&
                typeof c.type == "string" &&
                c.type !== "__proto__" &&
                c.type !== "constructor" &&
                c.type !== "prototype" &&
                s.events.push({
                  timestamp: c.timestamp,
                  type: c.type,
                  data: c.data ?? null,
                });
            }
            return !0;
          } catch {
            return !1;
          }
        },
        clearEvents(l) {
          const i = l ? e.get(l) : e.values().next().value;
          i && i.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Ne(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function gr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: i,
      panel: o = !1,
      position: s = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    u = Qt(i),
    g = hr(),
    p = {
      system: null,
      events: new yt(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  g.systems.set(t, p);
  let c = (n, a) => {
      const h = { timestamp: Date.now(), type: n, data: a };
      l && p.events.push(h);
      for (const S of p.subscribers)
        try {
          S(h);
        } catch {}
    },
    E = null,
    _ = new Map(),
    O = new Map(),
    D = Xt(),
    j = tr(),
    $ = ir(),
    A = er(),
    L = o && typeof window < "u" && typeof document < "u" && Ne(),
    I = null,
    m = 0,
    x = 1,
    v = 2,
    C = 4,
    R = 8,
    z = 16,
    f = 32,
    b = 64,
    w = 128,
    q = new Map(),
    F = new Set(),
    U = null;
  function P(n) {
    (m |= n),
      I === null &&
        typeof requestAnimationFrame < "u" &&
        (I = requestAnimationFrame(y));
  }
  function y() {
    if (((I = null), !E || !p.system)) {
      m = 0;
      return;
    }
    const n = E.refs,
      a = p.system,
      h = m;
    if (((m = 0), h & x)) {
      for (const S of F) lr(_, S);
      F.clear();
      for (const [S, { value: M, flash: N }] of q)
        Ce(_, n.factsBody, S, M, N, E.flashTimers);
      q.clear(), (n.factsCount.textContent = String(_.size));
    }
    if ((h & v && st(n, O, a, E.flashTimers), h & R))
      if (U) qe(n, U.inflight.length, U.unmet.length);
      else {
        const S = $e(a);
        S && qe(n, S.inflight.length, S.unmet.length);
      }
    if (h & C)
      if (U) Me(n, U.inflight, U.unmet);
      else {
        const S = $e(a);
        S && Me(n, S.inflight, S.unmet);
      }
    h & z && cr(n, D),
      h & f && at(n, a, j),
      h & b && lt(n, a),
      h & w && mr(n, A);
  }
  function k(n, a) {
    E && l && ar(E.refs, n, a, p.events.size);
  }
  function r(n, a) {
    $.isRecording &&
      $.recordedEvents.length < rr &&
      $.recordedEvents.push({ timestamp: Date.now(), type: n, data: Gt(a) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((p.system = n),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        L)
      ) {
        const a = p.system;
        E = sr(t, s, d, l);
        const h = E.refs;
        try {
          const M = a.facts.$store.toObject();
          for (const [N, W] of Object.entries(M)) Ce(_, h.factsBody, N, W, !1);
          h.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        st(h, O, a);
        const S = $e(a);
        S &&
          (qe(h, S.inflight.length, S.unmet.length),
          Me(h, S.inflight, S.unmet)),
          lt(h, a),
          ur(h, a),
          at(h, a, j),
          h.recordBtn.addEventListener("click", () => {
            if (
              (($.isRecording = !$.isRecording),
              (h.recordBtn.textContent = $.isRecording ? "⏹ Stop" : "⏺ Record"),
              (h.recordBtn.style.color = $.isRecording ? T.red : T.text),
              $.isRecording)
            ) {
              ($.recordedEvents = []), ($.snapshots = []);
              try {
                $.snapshots.push({
                  timestamp: Date.now(),
                  facts: a.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          h.exportBtn.addEventListener("click", () => {
            const M =
                $.recordedEvents.length > 0
                  ? $.recordedEvents
                  : p.events.toArray(),
              N = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: M,
                  snapshots: $.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([N], { type: "application/json" }),
              B = URL.createObjectURL(W),
              V = document.createElement("a");
            (V.href = B),
              (V.download = `directive-session-${t}-${Date.now()}.json`),
              V.click(),
              URL.revokeObjectURL(B);
          });
      }
    },
    onStart: (n) => {
      c("start", {}), k("start", {}), r("start", {});
    },
    onStop: (n) => {
      c("stop", {}), k("stop", {}), r("stop", {});
    },
    onDestroy: (n) => {
      c("destroy", {}),
        g.systems.delete(t),
        I !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(I), (I = null)),
        j.animationTimer && clearTimeout(j.animationTimer),
        E && (E.destroy(), (E = null), _.clear(), O.clear());
    },
    onFactSet: (n, a, h) => {
      c("fact.set", { key: n, value: a, prev: h }),
        r("fact.set", { key: n, value: a, prev: h }),
        j.recentlyChangedFacts.add(n),
        E &&
          p.system &&
          (q.set(n, { value: a, flash: !0 }),
          F.delete(n),
          P(x),
          k("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      c("fact.delete", { key: n, prev: a }),
        r("fact.delete", { key: n, prev: a }),
        E && (F.add(n), q.delete(n), P(x), k("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        E && p.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (F.add(a.key), q.delete(a.key))
            : (j.recentlyChangedFacts.add(a.key),
              q.set(a.key, { value: a.value, flash: !0 }),
              F.delete(a.key));
        P(x), k("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, a, h) => {
      c("derivation.compute", { id: n, value: a, deps: h }),
        r("derivation.compute", { id: n, deps: h }),
        j.derivationDeps.set(n, h),
        j.recentlyComputedDerivations.add(n),
        k("derivation.compute", { id: n, deps: h });
    },
    onDerivationInvalidate: (n) => {
      c("derivation.invalidate", { id: n }),
        k("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      c("reconcile.start", {}),
        (D.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        r("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (c("reconcile.end", n),
        r("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
          completed: n.completed.length,
        }),
        D.lastReconcileStartMs > 0)
      ) {
        const a = performance.now() - D.lastReconcileStartMs;
        D.reconcileCount++,
          (D.reconcileTotalMs += a),
          (D.lastReconcileStartMs = 0);
      }
      if ($.isRecording && p.system && $.snapshots.length < nr)
        try {
          $.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      E &&
        p.system &&
        ((U = n),
        pr(j),
        P(v | R | C | z | f | b),
        k("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, a) => {
      c("constraint.evaluate", { id: n, active: a }),
        r("constraint.evaluate", { id: n, active: a }),
        a
          ? (j.activeConstraints.add(n), j.recentlyActiveConstraints.add(n))
          : j.activeConstraints.delete(n),
        k("constraint.evaluate", { id: n, active: a });
    },
    onConstraintError: (n, a) => {
      c("constraint.error", { id: n, error: String(a) }),
        k("constraint.error", { id: n, error: String(a) });
    },
    onRequirementCreated: (n) => {
      c("requirement.created", { id: n.id, type: n.requirement.type }),
        r("requirement.created", { id: n.id, type: n.requirement.type }),
        k("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, a) => {
      c("requirement.met", { id: n.id, byResolver: a }),
        r("requirement.met", { id: n.id, byResolver: a }),
        k("requirement.met", { id: n.id, byResolver: a });
    },
    onRequirementCanceled: (n) => {
      c("requirement.canceled", { id: n.id }),
        r("requirement.canceled", { id: n.id }),
        k("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, a) => {
      c("resolver.start", { resolver: n, requirementId: a.id }),
        r("resolver.start", { resolver: n, requirementId: a.id }),
        A.inflight.set(n, performance.now()),
        E &&
          p.system &&
          (P(C | R | w),
          k("resolver.start", { resolver: n, requirementId: a.id }));
    },
    onResolverComplete: (n, a, h) => {
      c("resolver.complete", { resolver: n, requirementId: a.id, duration: h }),
        r("resolver.complete", {
          resolver: n,
          requirementId: a.id,
          duration: h,
        });
      const S = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += h),
        D.resolverStats.set(n, S),
        D.resolverStats.size > ot)
      ) {
        const N = D.resolverStats.keys().next().value;
        N !== void 0 && D.resolverStats.delete(N);
      }
      const M = A.inflight.get(n);
      A.inflight.delete(n),
        M !== void 0 &&
          A.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        E &&
          p.system &&
          (P(C | R | z | w),
          k("resolver.complete", { resolver: n, duration: h }));
    },
    onResolverError: (n, a, h) => {
      c("resolver.error", {
        resolver: n,
        requirementId: a.id,
        error: String(h),
      }),
        r("resolver.error", {
          resolver: n,
          requirementId: a.id,
          error: String(h),
        });
      const S = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, D.resolverStats.set(n, S), D.resolverStats.size > ot)) {
        const N = D.resolverStats.keys().next().value;
        N !== void 0 && D.resolverStats.delete(N);
      }
      const M = A.inflight.get(n);
      A.inflight.delete(n),
        M !== void 0 &&
          A.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        E &&
          p.system &&
          (P(C | R | z | w),
          k("resolver.error", { resolver: n, error: String(h) }));
    },
    onResolverRetry: (n, a, h) => {
      c("resolver.retry", { resolver: n, requirementId: a.id, attempt: h }),
        r("resolver.retry", { resolver: n, requirementId: a.id, attempt: h }),
        k("resolver.retry", { resolver: n, attempt: h });
    },
    onResolverCancel: (n, a) => {
      c("resolver.cancel", { resolver: n, requirementId: a.id }),
        r("resolver.cancel", { resolver: n, requirementId: a.id }),
        A.inflight.delete(n),
        k("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        r("effect.run", { id: n }),
        D.effectRunCount++,
        k("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      c("effect.error", { id: n, error: String(a) }),
        D.effectErrorCount++,
        k("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        E && p.system && P(b),
        k("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (c("timetravel.jump", { from: n, to: a }),
        r("timetravel.jump", { from: n, to: a }),
        E && p.system)
      ) {
        const h = p.system;
        try {
          const S = h.facts.$store.toObject();
          _.clear(), E.refs.factsBody.replaceChildren();
          for (const [M, N] of Object.entries(S))
            Ce(_, E.refs.factsBody, M, N, !1);
          E.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        O.clear(),
          j.derivationDeps.clear(),
          E.refs.derivBody.replaceChildren(),
          (U = null),
          P(v | R | C | f | b),
          k("timetravel.jump", { from: n, to: a });
      }
    },
    onError: (n) => {
      c("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        r("error", { source: n.source, message: n.message }),
        k("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, a) => {
      c("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: a,
      }),
        k("error.recovery", { source: n.source, strategy: a });
    },
  };
}
function bt(e) {
  return new Promise((t) => setTimeout(t, e));
}
async function yr(e) {
  await bt(500);
  const t = e.toUpperCase().trim();
  return t === "SAVE10"
    ? { valid: !0, discount: 10 }
    : t === "HALF"
      ? { valid: !0, discount: 50 }
      : { valid: !1, discount: 0 };
}
async function vr(e, t) {
  if ((await bt(1e3), Math.random() < 0.1))
    throw new Error("Payment processing failed. Please try again.");
  return {
    orderId: `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    success: !0,
  };
}
const De = {
    facts: { isAuthenticated: G.boolean(), userName: G.string() },
    derivations: { isAuthenticated: G.boolean() },
    events: { toggleAuth: {} },
    requirements: {},
  },
  br = pt("auth", {
    schema: De,
    init: (e) => {
      (e.isAuthenticated = !0), (e.userName = "Demo User");
    },
    derive: { isAuthenticated: (e) => e.isAuthenticated },
    events: {
      toggleAuth: (e) => {
        (e.isAuthenticated = !e.isAuthenticated),
          e.isAuthenticated ? (e.userName = "Demo User") : (e.userName = "");
      },
    },
  }),
  Pe = {
    facts: {
      items: G.array(),
      couponCode: G.string(),
      couponDiscount: G.number(),
      couponStatus: G.string(),
      checkoutRequested: G.boolean(),
      checkoutStatus: G.string(),
      checkoutError: G.string(),
    },
    derivations: {
      subtotal: G.number(),
      itemCount: G.number(),
      isEmpty: G.boolean(),
      discount: G.number(),
      tax: G.number(),
      total: G.number(),
      hasOverstockedItem: G.boolean(),
      freeShipping: G.boolean(),
    },
    events: {
      addItem: {
        id: G.string(),
        name: G.string(),
        price: G.number(),
        maxStock: G.number(),
        image: G.string(),
      },
      removeItem: { id: G.string() },
      updateQuantity: { id: G.string(), quantity: G.number() },
      applyCoupon: { code: G.string() },
      clearCoupon: {},
      requestCheckout: {},
      resetCheckout: {},
    },
    requirements: {
      ADJUST_QUANTITY: {},
      VALIDATE_COUPON: { code: G.string() },
      PROCESS_CHECKOUT: {},
    },
  },
  wr = pt("cart", {
    schema: Pe,
    crossModuleDeps: { auth: De },
    init: (e) => {
      (e.items = [
        {
          id: "headphones-1",
          name: "Wireless Headphones",
          price: 79.99,
          quantity: 1,
          maxStock: 5,
          image: "headphones",
        },
        {
          id: "keyboard-1",
          name: "Mechanical Keyboard",
          price: 129.99,
          quantity: 1,
          maxStock: 3,
          image: "keyboard",
        },
        {
          id: "hub-1",
          name: "USB-C Hub",
          price: 49.99,
          quantity: 2,
          maxStock: 10,
          image: "hub",
        },
      ]),
        (e.couponCode = ""),
        (e.couponDiscount = 0),
        (e.couponStatus = "idle"),
        (e.checkoutRequested = !1),
        (e.checkoutStatus = "idle"),
        (e.checkoutError = "");
    },
    derive: {
      subtotal: (e) =>
        e.self.items.reduce((t, l) => t + l.price * l.quantity, 0),
      itemCount: (e) => e.self.items.reduce((t, l) => t + l.quantity, 0),
      isEmpty: (e) => e.self.items.length === 0,
      discount: (e, t) => t.subtotal * (e.self.couponDiscount / 100),
      tax: (e, t) => {
        const l = t.subtotal,
          i = t.discount;
        return (l - i) * 0.08;
      },
      total: (e, t) => {
        const l = t.subtotal,
          i = t.discount,
          o = t.tax;
        return l - i + o;
      },
      hasOverstockedItem: (e) =>
        e.self.items.some((t) => t.quantity > t.maxStock),
      freeShipping: (e, t) => t.subtotal >= 75,
    },
    events: {
      addItem: (e, { id: t, name: l, price: i, maxStock: o, image: s }) => {
        e.items.find((u) => u.id === t)
          ? (e.items = e.items.map((u) =>
              u.id === t
                ? { ...u, quantity: Math.min(u.quantity + 1, u.maxStock) }
                : u,
            ))
          : (e.items = [
              ...e.items,
              { id: t, name: l, price: i, quantity: 1, maxStock: o, image: s },
            ]);
      },
      removeItem: (e, { id: t }) => {
        e.items = e.items.filter((l) => l.id !== t);
      },
      updateQuantity: (e, { id: t, quantity: l }) => {
        if (l <= 0) {
          e.items = e.items.filter((i) => i.id !== t);
          return;
        }
        e.items = e.items.map((i) => (i.id === t ? { ...i, quantity: l } : i));
      },
      applyCoupon: (e, { code: t }) => {
        (e.couponCode = t), (e.couponStatus = "idle"), (e.couponDiscount = 0);
      },
      clearCoupon: (e) => {
        (e.couponCode = ""), (e.couponDiscount = 0), (e.couponStatus = "idle");
      },
      requestCheckout: (e) => {
        (e.checkoutRequested = !0),
          (e.checkoutStatus = "idle"),
          (e.checkoutError = "");
      },
      resetCheckout: (e) => {
        (e.checkoutRequested = !1),
          (e.checkoutStatus = "idle"),
          (e.checkoutError = "");
      },
    },
    constraints: {
      quantityLimit: {
        priority: 80,
        when: (e) => e.self.items.some((l) => l.quantity > l.maxStock),
        require: { type: "ADJUST_QUANTITY" },
      },
      couponValidation: {
        priority: 70,
        when: (e) => e.self.couponCode !== "" && e.self.couponStatus === "idle",
        require: (e) => ({ type: "VALIDATE_COUPON", code: e.self.couponCode }),
      },
      checkoutReady: {
        priority: 60,
        after: ["quantityLimit", "couponValidation"],
        when: (e) => {
          const t = e.self.items,
            l = t.length > 0,
            i = !t.some((o) => o.quantity > o.maxStock);
          return (
            e.self.checkoutRequested === !0 &&
            l &&
            i &&
            e.auth.isAuthenticated === !0
          );
        },
        require: { type: "PROCESS_CHECKOUT" },
      },
    },
    resolvers: {
      adjustQuantity: {
        requirement: "ADJUST_QUANTITY",
        resolve: async (e, t) => {
          t.facts.items = t.facts.items.map((l) =>
            l.quantity > l.maxStock ? { ...l, quantity: l.maxStock } : l,
          );
        },
      },
      validateCoupon: {
        requirement: "VALIDATE_COUPON",
        key: (e) => `coupon-${e.code}`,
        resolve: async (e, t) => {
          t.facts.couponStatus = "checking";
          const l = await yr(e.code);
          l.valid
            ? ((t.facts.couponDiscount = l.discount),
              (t.facts.couponStatus = "valid"))
            : ((t.facts.couponDiscount = 0),
              (t.facts.couponStatus = "invalid"));
        },
      },
      processCheckout: {
        requirement: "PROCESS_CHECKOUT",
        retry: { attempts: 2, backoff: "exponential" },
        resolve: async (e, t) => {
          t.facts.checkoutStatus = "processing";
          try {
            const l = t.facts.items.map((i) => ({
              id: i.id,
              name: i.name,
              quantity: i.quantity,
              price: i.price,
            }));
            await vr(l, t.facts.couponCode),
              (t.facts.checkoutStatus = "complete"),
              (t.facts.items = []),
              (t.facts.couponCode = ""),
              (t.facts.couponDiscount = 0),
              (t.facts.couponStatus = "idle"),
              (t.facts.checkoutRequested = !1);
          } catch (l) {
            const i = l instanceof Error ? l.message : "Checkout failed";
            throw (
              ((t.facts.checkoutStatus = "failed"),
              (t.facts.checkoutError = i),
              (t.facts.checkoutRequested = !1),
              l)
            );
          }
        },
      },
    },
  }),
  ie = Ht({
    modules: { cart: wr, auth: br },
    plugins: [gr({ name: "shopping-cart", panel: !0 })],
    debug: { timeTravel: !0, maxSnapshots: 50 },
  });
ie.start();
const ct = document.getElementById("sc-item-list"),
  Sr = document.getElementById("sc-subtotal"),
  ut = document.getElementById("sc-discount-row"),
  xr = document.getElementById("sc-discount"),
  Er = document.getElementById("sc-tax"),
  $r = document.getElementById("sc-total"),
  dt = document.getElementById("sc-free-shipping"),
  Cr = document.getElementById("sc-item-count"),
  je = document.getElementById("sc-coupon-input"),
  wt = document.getElementById("sc-coupon-apply"),
  le = document.getElementById("sc-coupon-status"),
  St = document.getElementById("sc-coupon-clear"),
  ke = document.getElementById("sc-checkout-btn"),
  be = document.getElementById("sc-checkout-status"),
  Le = document.getElementById("sc-auth-toggle"),
  ft = document.getElementById("sc-auth-status");
function fe(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function ge(e) {
  return `$${e.toFixed(2)}`;
}
function Fe() {
  const e = ie.facts,
    t = ie.derive,
    l = e.cart.items,
    i = e.cart.couponCode,
    o = e.cart.couponStatus,
    s = e.cart.couponDiscount,
    d = e.cart.checkoutStatus,
    u = e.cart.checkoutError,
    g = e.cart.checkoutRequested,
    p = t.cart.subtotal,
    c = t.cart.discount,
    E = t.cart.tax,
    _ = t.cart.total,
    O = t.cart.itemCount,
    D = t.cart.isEmpty,
    j = t.cart.freeShipping,
    $ = e.auth.isAuthenticated,
    A = e.auth.userName;
  (Cr.textContent = `${O} item${O !== 1 ? "s" : ""}`),
    D
      ? (ct.innerHTML = `
      <div class="sc-empty-cart">
        <div class="sc-empty-icon">&#128722;</div>
        <p>Your cart is empty</p>
      </div>
    `)
      : (ct.innerHTML = l
          .map((I) => {
            const m = I.quantity > I.maxStock,
              x = I.price * I.quantity;
            return `
          <div class="sc-item${m ? " sc-item-overstock" : ""}" data-item-id="${fe(I.id)}">
            <div class="sc-item-icon sc-icon-${fe(I.image)}"></div>
            <div class="sc-item-details">
              <div class="sc-item-name">${fe(I.name)}</div>
              <div class="sc-item-price">${ge(I.price)} each</div>
              ${m ? `<div class="sc-stock-warning">Only ${I.maxStock} in stock</div>` : ""}
            </div>
            <div class="sc-item-controls">
              <button class="sc-qty-btn" data-action="decrease" data-id="${fe(I.id)}" ${I.quantity <= 1 ? "disabled" : ""}>-</button>
              <span class="sc-qty-value">${I.quantity}</span>
              <button class="sc-qty-btn" data-action="increase" data-id="${fe(I.id)}" ${I.quantity >= I.maxStock ? "disabled" : ""}>+</button>
            </div>
            <div class="sc-item-total">${ge(x)}</div>
            <button class="sc-remove-btn" data-action="remove" data-id="${fe(I.id)}" title="Remove item">&times;</button>
          </div>
        `;
          })
          .join("")),
    (Sr.textContent = ge(p)),
    c > 0
      ? ((ut.style.display = "flex"), (xr.textContent = `-${ge(c)}`))
      : (ut.style.display = "none"),
    (Er.textContent = ge(E)),
    ($r.textContent = ge(_)),
    j && !D ? (dt.style.display = "flex") : (dt.style.display = "none"),
    (le.className = "sc-coupon-badge"),
    o === "checking"
      ? ((le.className = "sc-coupon-badge sc-coupon-checking"),
        (le.textContent = "Checking..."),
        (le.style.display = "inline-block"))
      : o === "valid"
        ? ((le.className = "sc-coupon-badge sc-coupon-valid"),
          (le.textContent = `${s}% off applied`),
          (le.style.display = "inline-block"))
        : o === "invalid"
          ? ((le.className = "sc-coupon-badge sc-coupon-invalid"),
            (le.textContent = "Invalid code"),
            (le.style.display = "inline-block"))
          : (le.style.display = "none"),
    (St.style.display = i !== "" ? "inline-block" : "none"),
    (wt.disabled = o === "checking");
  const L = d === "processing" || g;
  (ke.disabled = D || !$ || L),
    d === "processing"
      ? (ke.innerHTML = '<span class="sc-spinner"></span> Processing...')
      : (ke.textContent = "Checkout"),
    d === "complete"
      ? ((be.innerHTML = `
      <div class="sc-overlay sc-overlay-success">
        <div class="sc-overlay-icon">&#10003;</div>
        <div class="sc-overlay-title">Order Complete!</div>
        <div class="sc-overlay-detail">Thank you for your purchase.</div>
        <button class="sc-overlay-btn" id="sc-reset-btn">Continue Shopping</button>
      </div>
    `),
        (be.style.display = "flex"))
      : d === "failed"
        ? ((be.innerHTML = `
      <div class="sc-overlay sc-overlay-error">
        <div class="sc-overlay-icon">&#10007;</div>
        <div class="sc-overlay-title">Checkout Failed</div>
        <div class="sc-overlay-detail">${fe(u)}</div>
        <button class="sc-overlay-btn" id="sc-retry-checkout-btn">Try Again</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-dismiss-btn">Dismiss</button>
      </div>
    `),
          (be.style.display = "flex"))
        : (be.style.display = "none"),
    $
      ? ((Le.textContent = "Sign Out"),
        (ft.innerHTML = `<span class="sc-auth-badge sc-auth-in">Signed in as ${fe(A)}</span>`))
      : ((Le.textContent = "Sign In"),
        (ft.innerHTML =
          '<span class="sc-auth-badge sc-auth-out">Not signed in</span>'));
}
const kr = [
  ...Object.keys(Pe.facts).map((e) => `cart::${e}`),
  ...Object.keys(Pe.derivations).map((e) => `cart::${e}`),
  ...Object.keys(De.facts).map((e) => `auth::${e}`),
  ...Object.keys(De.derivations).map((e) => `auth::${e}`),
];
ie.subscribe(kr, Fe);
setInterval(Fe, 200);
document.addEventListener("click", (e) => {
  const t = e.target,
    l = t.dataset.action,
    i = t.dataset.id;
  if (!(!l || !i))
    if (l === "increase") {
      const o = ie.facts.cart.items.find((s) => s.id === i);
      o && ie.events.cart.updateQuantity({ id: i, quantity: o.quantity + 1 });
    } else if (l === "decrease") {
      const o = ie.facts.cart.items.find((s) => s.id === i);
      o && ie.events.cart.updateQuantity({ id: i, quantity: o.quantity - 1 });
    } else l === "remove" && ie.events.cart.removeItem({ id: i });
});
document.addEventListener("click", (e) => {
  const t = e.target;
  t.id === "sc-reset-btn"
    ? ie.events.cart.resetCheckout()
    : t.id === "sc-retry-checkout-btn"
      ? (ie.events.cart.resetCheckout(), ie.events.cart.requestCheckout())
      : t.id === "sc-dismiss-btn" && ie.events.cart.resetCheckout();
});
wt.addEventListener("click", () => {
  const e = je.value.trim();
  e !== "" && ie.events.cart.applyCoupon({ code: e });
});
je.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const t = je.value.trim();
    if (t === "") return;
    ie.events.cart.applyCoupon({ code: t });
  }
});
St.addEventListener("click", () => {
  (je.value = ""), ie.events.cart.clearCoupon();
});
ke.addEventListener("click", () => {
  ie.events.cart.requestCheckout();
});
Le.addEventListener("click", () => {
  ie.events.auth.toggleAuth();
});
Fe();
document.body.setAttribute("data-shopping-cart-ready", "true");
