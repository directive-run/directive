(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const o of document.querySelectorAll('link[rel="modulepreload"]')) i(o);
  new MutationObserver((o) => {
    for (const s of o)
      if (s.type === "childList")
        for (const u of s.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && i(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function a(o) {
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
    const s = a(o);
    fetch(o.href, s);
  }
})();
var Ne = class extends Error {
    constructor(t, a, i, o, s = !0) {
      super(t),
        (this.source = a),
        (this.sourceId = i),
        (this.context = o),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  pe = [];
function mt() {
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
var gt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function ht() {
  return pe[pe.length - 1] ?? gt;
}
function Ce(e) {
  const t = mt();
  pe.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    pe.pop();
  }
}
function Fe(e) {
  const t = pe.splice(0, pe.length);
  try {
    return e();
  } finally {
    pe.push(...t);
  }
}
function Ie(e) {
  ht().track(e);
}
function yt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function ke(e = [], t, a, i, o, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: a,
    _transform: i,
    _description: o,
    _refinements: s,
    validate(u) {
      return ke([...e, u], t, a, i, o, s);
    },
  };
}
function ee(e, t, a, i, o, s) {
  return {
    ...ke(e, t, a, i, o, s),
    default(u) {
      return ee(e, t, u, i, o, s);
    },
    transform(u) {
      return ee(
        [],
        t,
        void 0,
        (d) => {
          const h = i ? i(d) : d;
          return u(h);
        },
        o,
      );
    },
    brand() {
      return ee(e, `Branded<${t}>`, a, i, o, s);
    },
    describe(u) {
      return ee(e, t, a, i, u, s);
    },
    refine(u, d) {
      const h = [...(s ?? []), { predicate: u, message: d }];
      return ee([...e, u], t, a, i, o, h);
    },
    nullable() {
      return ee(
        [(u) => u === null || e.every((d) => d(u))],
        `${t} | null`,
        a,
        i,
        o,
      );
    },
    optional() {
      return ee(
        [(u) => u === void 0 || e.every((d) => d(u))],
        `${t} | undefined`,
        a,
        i,
        o,
      );
    },
  };
}
var ie = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, a, i, o, s) => ({
      ...ee(t, "number", a, i, o, s),
      min(u) {
        return e([...t, (d) => d >= u], a, i, o, s);
      },
      max(u) {
        return e([...t, (d) => d <= u], a, i, o, s);
      },
      default(u) {
        return e(t, u, i, o, s);
      },
      describe(u) {
        return e(t, a, i, u, s);
      },
      refine(u, d) {
        const h = [...(s ?? []), { predicate: u, message: d }];
        return e([...t, u], a, i, o, h);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, a, i, o, s) => {
      const u = ee(t, "array", i, void 0, o),
        d = s ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return d.value;
        },
        set _lastFailedIndex(h) {
          d.value = h;
        },
        of(h) {
          const p = { value: -1 };
          return e(
            [
              ...t,
              (c) => {
                for (let x = 0; x < c.length; x++) {
                  const I = c[x];
                  if (!h._validators.every((A) => A(I)))
                    return (p.value = x), !1;
                }
                return !0;
              },
            ],
            h,
            i,
            o,
            p,
          );
        },
        nonEmpty() {
          return e([...t, (h) => h.length > 0], a, i, o, d);
        },
        maxLength(h) {
          return e([...t, (p) => p.length <= h], a, i, o, d);
        },
        minLength(h) {
          return e([...t, (p) => p.length >= h], a, i, o, d);
        },
        default(h) {
          return e(t, a, h, o, d);
        },
        describe(h) {
          return e(t, a, i, h, d);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, a, i) => ({
      ...ee(t, "object", a, void 0, i),
      shape(o) {
        return e(
          [
            ...t,
            (s) => {
              for (const [u, d] of Object.entries(o)) {
                const h = s[u],
                  p = d;
                if (p && !p._validators.every((c) => c(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          i,
        );
      },
      nonNull() {
        return e([...t, (o) => o != null], a, i);
      },
      hasKeys(...o) {
        return e([...t, (s) => o.every((u) => u in s)], a, i);
      },
      default(o) {
        return e(t, o, i);
      },
      describe(o) {
        return e(t, a, o);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return ee(
      [(a) => typeof a == "string" && t.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === null ? !0 : e._validators.every((i) => i(a)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === void 0 ? !0 : e._validators.every((i) => i(a)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [(a) => e.some((i) => i._validators.every((o) => o(a)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return ee(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((i) => e._validators.every((o) => o(i))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((i, o) => i._validators.every((s) => s(a[o]))),
      ],
      `[${t.join(", ")}]`,
    );
  },
  date() {
    return ee([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ee([(t) => typeof t == "string" && e.test(t)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return ee([(t) => typeof t == "string" && e.test(t)], "email");
  },
  url() {
    return ee(
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
    return ee([(e) => typeof e == "bigint"], "bigint");
  },
};
function vt(e) {
  const { schema: t, onChange: a, onBatch: i } = e;
  Object.keys(t).length;
  let o = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    d = new Map(),
    h = new Set(),
    p = new Map(),
    c = new Set(),
    x = 0,
    I = [],
    A = new Set(),
    j = !1,
    D = [],
    k = 100;
  function O(f) {
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
  function N(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (O(f)) {
      const w = f._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function _(f) {
    return u ? "[redacted]" : yt(f);
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
    if (O(w)) {
      const P = w.safeParse(b);
      if (!P.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          C = _(b),
          r =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          n = N(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${C}. ${r}`,
        );
      }
      return;
    }
    const q = w,
      F = q._validators;
    if (!F || !Array.isArray(F) || F.length === 0) return;
    const K = q._typeName ?? "unknown";
    for (let P = 0; P < F.length; P++) {
      const y = F[P];
      if (typeof y == "function" && !y(b)) {
        let C = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          r = _(b),
          n = "";
        typeof q._lastFailedIndex == "number" &&
          q._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${q._lastFailedIndex} failed)`),
          (q._lastFailedIndex = -1));
        const l = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${K}, got ${C} ${r}${l}${n}`,
        );
      }
    }
  }
  function E(f) {
    p.get(f)?.forEach((b) => b());
  }
  function v() {
    c.forEach((f) => f());
  }
  function $(f, b, w) {
    if (j) {
      D.push({ key: f, value: b, prev: w });
      return;
    }
    j = !0;
    try {
      a?.(f, b, w), E(f), v();
      let q = 0;
      while (D.length > 0) {
        if (++q > k)
          throw (
            ((D.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const F = [...D];
        D.length = 0;
        for (const K of F) a?.(K.key, K.value, K.prev), E(K.key);
        v();
      }
    } finally {
      j = !1;
    }
  }
  function R() {
    if (!(x > 0)) {
      if ((i && I.length > 0 && i([...I]), A.size > 0)) {
        j = !0;
        try {
          for (const b of A) E(b);
          v();
          let f = 0;
          while (D.length > 0) {
            if (++f > k)
              throw (
                ((D.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${k} iterations.`,
                ))
              );
            const b = [...D];
            D.length = 0;
            for (const w of b) a?.(w.key, w.value, w.prev), E(w.key);
            v();
          }
        } finally {
          j = !1;
        }
      }
      (I.length = 0), A.clear();
    }
  }
  const z = {
    get(f) {
      return Ie(f), d.get(f);
    },
    has(f) {
      return Ie(f), d.has(f);
    },
    set(f, b) {
      m(f, b);
      const w = d.get(f);
      Object.is(w, b) ||
        (d.set(f, b),
        h.add(f),
        x > 0
          ? (I.push({ key: f, value: b, prev: w, type: "set" }), A.add(f))
          : $(f, b, w));
    },
    delete(f) {
      const b = d.get(f);
      d.delete(f),
        h.delete(f),
        x > 0
          ? (I.push({ key: f, value: void 0, prev: b, type: "delete" }),
            A.add(f))
          : $(f, void 0, b);
    },
    batch(f) {
      x++;
      try {
        f();
      } finally {
        x--, R();
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
      for (const b of h) d.has(b) && (f[b] = d.get(b));
      return f;
    },
  };
  return (
    (z.registerKeys = (f) => {
      for (const b of Object.keys(f)) ve.has(b) || ((t[b] = f[b]), h.add(b));
    }),
    z
  );
}
var ve = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function bt(e, t) {
  const a = () => ({
    get: (i) => Fe(() => e.get(i)),
    has: (i) => Fe(() => e.has(i)),
  });
  return new Proxy(
    {},
    {
      get(i, o) {
        if (o === "$store") return e;
        if (o === "$snapshot") return a;
        if (typeof o != "symbol" && !ve.has(o)) return e.get(o);
      },
      set(i, o, s) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          ve.has(o)
          ? !1
          : (e.set(o, s), !0);
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" ||
          o === "$store" ||
          o === "$snapshot" ||
          ve.has(o)
          ? !1
          : (e.delete(o), !0);
      },
      has(i, o) {
        return o === "$store" || o === "$snapshot"
          ? !0
          : typeof o == "symbol" || ve.has(o)
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
function wt(e) {
  const t = vt(e),
    a = bt(t, e.schema);
  return { store: t, facts: a };
}
function St(e, t) {
  const a = "crossModuleDeps" in t ? t.crossModuleDeps : void 0;
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
    crossModuleDeps: a,
  };
}
async function xe(e, t, a) {
  let i,
    o = new Promise((s, u) => {
      i = setTimeout(() => u(new Error(a)), t);
    });
  try {
    return await Promise.race([e, o]);
  } finally {
    clearTimeout(i);
  }
}
function it(e, t = 50) {
  const a = new WeakSet();
  function i(o, s) {
    if (s > t) return '"[max depth exceeded]"';
    if (o === null) return "null";
    if (o === void 0) return "undefined";
    const u = typeof o;
    if (u === "string") return JSON.stringify(o);
    if (u === "number" || u === "boolean") return String(o);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(o)) {
      if (a.has(o)) return '"[circular]"';
      a.add(o);
      const d = `[${o.map((h) => i(h, s + 1)).join(",")}]`;
      return a.delete(o), d;
    }
    if (u === "object") {
      const d = o;
      if (a.has(d)) return '"[circular]"';
      a.add(d);
      const h = `{${Object.keys(d)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${i(d[p], s + 1)}`)
        .join(",")}}`;
      return a.delete(d), h;
    }
    return '"[unknown]"';
  }
  return i(e, 0);
}
function be(e, t = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    i = new WeakSet();
  function o(s, u) {
    if (u > t) return !1;
    if (s == null || typeof s != "object") return !0;
    const d = s;
    if (i.has(d)) return !0;
    if ((i.add(d), Array.isArray(d))) {
      for (const h of d) if (!o(h, u + 1)) return i.delete(d), !1;
      return i.delete(d), !0;
    }
    for (const h of Object.keys(d))
      if (a.has(h) || !o(d[h], u + 1)) return i.delete(d), !1;
    return i.delete(d), !0;
  }
  return o(e, 0);
}
function xt(e) {
  let t = it(e),
    a = 5381;
  for (let i = 0; i < t.length; i++) a = ((a << 5) + a) ^ t.charCodeAt(i);
  return (a >>> 0).toString(16);
}
function Et(e, t) {
  if (t) return t(e);
  const { type: a, ...i } = e,
    o = it(i);
  return `${a}:${o}`;
}
function $t(e, t, a) {
  return { requirement: e, id: Et(e, a), fromConstraint: t };
}
var qe = class ot {
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
      const t = new ot();
      for (const a of this.map.values()) t.add(a);
      return t;
    }
    diff(t) {
      const a = [],
        i = [],
        o = [];
      for (const s of this.map.values()) t.has(s.id) ? o.push(s) : a.push(s);
      for (const s of t.map.values()) this.map.has(s.id) || i.push(s);
      return { added: a, removed: i, unchanged: o };
    }
  },
  Ct = 5e3;
function kt(e) {
  let {
      definitions: t,
      facts: a,
      requirementKeys: i = {},
      defaultTimeout: o = Ct,
      onEvaluate: s,
      onError: u,
    } = e,
    d = new Map(),
    h = new Set(),
    p = new Set(),
    c = new Map(),
    x = new Map(),
    I = new Set(),
    A = new Map(),
    j = new Map(),
    D = !1,
    k = new Set(),
    O = new Set(),
    N = new Map(),
    _ = [],
    m = new Map();
  function E() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const l of n.after)
          t[l] && (N.has(l) || N.set(l, new Set()), N.get(l).add(r));
  }
  function v() {
    const r = new Set(),
      n = new Set(),
      l = [];
    function g(S, M) {
      if (r.has(S)) return;
      if (n.has(S)) {
        const W = M.indexOf(S),
          B = [...M.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${B}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), M.push(S);
      const L = t[S];
      if (L?.after) for (const W of L.after) t[W] && g(W, M);
      M.pop(), n.delete(S), r.add(S), l.push(S);
    }
    for (const S of Object.keys(t)) g(S, []);
    (_ = l), (m = new Map(_.map((S, M) => [S, M])));
  }
  v(), E();
  function $(r, n) {
    return n.async !== void 0 ? n.async : !!p.has(r);
  }
  function R(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const l = $(r, n);
    l && p.add(r);
    const g = {
      id: r,
      priority: n.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return d.set(r, g), g;
  }
  function z(r) {
    return d.get(r) ?? R(r);
  }
  function f(r, n) {
    const l = c.get(r) ?? new Set();
    for (const g of l) {
      const S = x.get(g);
      S?.delete(r), S && S.size === 0 && x.delete(g);
    }
    for (const g of n) x.has(g) || x.set(g, new Set()), x.get(g).add(r);
    c.set(r, n);
  }
  function b(r) {
    const n = t[r];
    if (!n) return !1;
    const l = z(r);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(a)), A.set(r, new Set(n.deps));
      else {
        const S = Ce(() => n.when(a));
        (g = S.value), A.set(r, S.deps);
      }
      return g instanceof Promise
        ? (p.add(r),
          (l.isAsync = !0),
          g
            .then(
              (S) => ((l.lastResult = S), (l.isEvaluating = !1), s?.(r, S), S),
            )
            .catch(
              (S) => (
                (l.error = S instanceof Error ? S : new Error(String(S))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                u?.(r, S),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), s?.(r, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(r, g),
        !1
      );
    }
  }
  async function w(r) {
    const n = t[r];
    if (!n) return !1;
    const l = z(r),
      g = n.timeout ?? o;
    if (((l.isEvaluating = !0), (l.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      f(r, S), A.set(r, S);
    }
    try {
      const S = n.when(a),
        M = await xe(S, g, `Constraint "${r}" timed out after ${g}ms`);
      return (l.lastResult = M), (l.isEvaluating = !1), s?.(r, M), M;
    } catch (S) {
      return (
        (l.error = S instanceof Error ? S : new Error(String(S))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(r, S),
        !1
      );
    }
  }
  function q(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((g) => g != null) : [r];
  }
  function F(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const l = n.require;
    if (typeof l == "function") {
      const { value: g, deps: S } = Ce(() => l(a));
      return { requirements: q(g), deps: S };
    }
    return { requirements: q(l), deps: new Set() };
  }
  function K(r, n) {
    if (n.size === 0) return;
    const l = c.get(r) ?? new Set();
    for (const g of n)
      l.add(g), x.has(g) || x.set(g, new Set()), x.get(g).add(r);
    c.set(r, l);
  }
  let P = null;
  function y() {
    return (
      P ||
        (P = Object.keys(t).sort((r, n) => {
          const l = z(r),
            g = z(n).priority - l.priority;
          if (g !== 0) return g;
          const S = m.get(r) ?? 0,
            M = m.get(n) ?? 0;
          return S - M;
        })),
      P
    );
  }
  for (const r of Object.keys(t)) R(r);
  function C(r) {
    const n = d.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const l of n.after)
      if (t[l] && !h.has(l) && !O.has(l) && !k.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new qe();
      O.clear();
      let l = y().filter((B) => !h.has(B)),
        g;
      if (!D || !r || r.size === 0) (g = l), (D = !0);
      else {
        const B = new Set();
        for (const U of r) {
          const Y = x.get(U);
          if (Y) for (const te of Y) h.has(te) || B.add(te);
        }
        for (const U of I) h.has(U) || B.add(U);
        I.clear(), (g = [...B]);
        for (const U of l)
          if (!B.has(U)) {
            const Y = j.get(U);
            if (Y) for (const te of Y) n.add(te);
          }
      }
      function S(B, U) {
        if (h.has(B)) return;
        const Y = A.get(B);
        if (!U) {
          Y !== void 0 && f(B, Y), O.add(B), j.set(B, []);
          return;
        }
        O.delete(B);
        let te, Z;
        try {
          const X = F(B);
          (te = X.requirements), (Z = X.deps);
        } catch (X) {
          u?.(B, X), Y !== void 0 && f(B, Y), j.set(B, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const G of Z) X.add(G);
          f(B, X);
        } else K(B, Z);
        if (te.length > 0) {
          const X = i[B],
            G = te.map((V) => $t(V, B, X));
          for (const V of G) n.add(V);
          j.set(B, G);
        } else j.set(B, []);
      }
      async function M(B) {
        const U = [],
          Y = [];
        for (const G of B)
          if (C(G)) Y.push(G);
          else {
            U.push(G);
            const V = j.get(G);
            if (V) for (const J of V) n.add(J);
          }
        if (Y.length === 0) return U;
        const te = [],
          Z = [];
        for (const G of Y) z(G).isAsync ? Z.push(G) : te.push(G);
        const X = [];
        for (const G of te) {
          const V = b(G);
          if (V instanceof Promise) {
            X.push({ id: G, promise: V });
            continue;
          }
          S(G, V);
        }
        if (X.length > 0) {
          const G = await Promise.all(
            X.map(async ({ id: V, promise: J }) => ({
              id: V,
              active: await J,
            })),
          );
          for (const { id: V, active: J } of G) S(V, J);
        }
        if (Z.length > 0) {
          const G = await Promise.all(
            Z.map(async (V) => ({ id: V, active: await w(V) })),
          );
          for (const { id: V, active: J } of G) S(V, J);
        }
        return U;
      }
      let L = g,
        W = g.length + 1;
      while (L.length > 0 && W > 0) {
        const B = L.length;
        if (((L = await M(L)), L.length === B)) break;
        W--;
      }
      return n.all();
    },
    getState(r) {
      return d.get(r);
    },
    getAllStates() {
      return [...d.values()];
    },
    disable(r) {
      h.add(r), (P = null), j.delete(r);
      const n = c.get(r);
      if (n) {
        for (const l of n) {
          const g = x.get(l);
          g && (g.delete(r), g.size === 0 && x.delete(l));
        }
        c.delete(r);
      }
      A.delete(r);
    },
    enable(r) {
      h.delete(r), (P = null), I.add(r);
    },
    invalidate(r) {
      const n = x.get(r);
      if (n) for (const l of n) I.add(l);
    },
    markResolved(r) {
      k.add(r);
      const n = d.get(r);
      n && (n.lastResolvedAt = Date.now());
      const l = N.get(r);
      if (l) for (const g of l) I.add(g);
    },
    isResolved(r) {
      return k.has(r);
    },
    registerDefinitions(r) {
      for (const [n, l] of Object.entries(r)) (t[n] = l), R(n), I.add(n);
      (P = null), v(), E();
    },
  };
}
function Rt(e) {
  let {
      definitions: t,
      facts: a,
      onCompute: i,
      onInvalidate: o,
      onError: s,
    } = e,
    u = new Map(),
    d = new Map(),
    h = new Map(),
    p = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    x = 0,
    I = new Set(),
    A = !1,
    j = 100,
    D;
  function k(v) {
    if (!t[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const $ = {
      id: v,
      compute: () => N(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(v, $), $;
  }
  function O(v) {
    return u.get(v) ?? k(v);
  }
  function N(v) {
    const $ = O(v),
      R = t[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if ($.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    $.isComputing = !0;
    try {
      const { value: z, deps: f } = Ce(() => R(a, D));
      return (
        ($.cachedValue = z), ($.isStale = !1), _(v, f), i?.(v, z, [...f]), z
      );
    } catch (z) {
      throw (s?.(v, z), z);
    } finally {
      $.isComputing = !1;
    }
  }
  function _(v, $) {
    const R = O(v),
      z = R.dependencies;
    for (const f of z)
      if (u.has(f)) {
        const b = p.get(f);
        b?.delete(v), b && b.size === 0 && p.delete(f);
      } else {
        const b = h.get(f);
        b?.delete(v), b && b.size === 0 && h.delete(f);
      }
    for (const f of $)
      t[f]
        ? (p.has(f) || p.set(f, new Set()), p.get(f).add(v))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(v));
    R.dependencies = $;
  }
  function m() {
    if (!(x > 0 || A)) {
      A = !0;
      try {
        let v = 0;
        while (I.size > 0) {
          if (++v > j) {
            const R = [...I];
            throw (
              (I.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${j} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const $ = [...I];
          I.clear();
          for (const R of $) d.get(R)?.forEach((z) => z());
        }
      } finally {
        A = !1;
      }
    }
  }
  function E(v, $ = new Set()) {
    if ($.has(v)) return;
    $.add(v);
    const R = u.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), o?.(v), I.add(v);
    const z = p.get(v);
    if (z) for (const f of z) E(f, $);
  }
  return (
    (D = new Proxy(
      {},
      {
        get(v, $) {
          if (typeof $ == "symbol" || c.has($)) return;
          Ie($);
          const R = O($);
          return R.isStale && N($), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const $ = O(v);
        return $.isStale && N(v), $.cachedValue;
      },
      isStale(v) {
        return u.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const $ = h.get(v);
        if ($) {
          x++;
          try {
            for (const R of $) E(R);
          } finally {
            x--, m();
          }
        }
      },
      invalidateMany(v) {
        x++;
        try {
          for (const $ of v) {
            const R = h.get($);
            if (R) for (const z of R) E(z);
          }
        } finally {
          x--, m();
        }
      },
      invalidateAll() {
        x++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), I.add(v.id));
        } finally {
          x--, m();
        }
      },
      subscribe(v, $) {
        for (const R of v) {
          const z = R;
          d.has(z) || d.set(z, new Set()), d.get(z).add($);
        }
        return () => {
          for (const R of v) {
            const z = R,
              f = d.get(z);
            f?.delete($), f && f.size === 0 && d.delete(z);
          }
        };
      },
      getProxy() {
        return D;
      },
      getDependencies(v) {
        return O(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [$, R] of Object.entries(v)) (t[$] = R), k($);
      },
    }
  );
}
function At(e) {
  let { definitions: t, facts: a, store: i, onRun: o, onError: s } = e,
    u = new Map(),
    d = null,
    h = !1;
  function p(k) {
    const O = t[k];
    if (!O) throw new Error(`[Directive] Unknown effect: ${k}`);
    const N = {
      id: k,
      enabled: !0,
      hasExplicitDeps: !!O.deps,
      dependencies: O.deps ? new Set(O.deps) : null,
      cleanup: null,
    };
    return u.set(k, N), N;
  }
  function c(k) {
    return u.get(k) ?? p(k);
  }
  function x() {
    return i.toObject();
  }
  function I(k, O) {
    const N = c(k);
    if (!N.enabled) return !1;
    if (N.dependencies) {
      for (const _ of N.dependencies) if (O.has(_)) return !0;
      return !1;
    }
    return !0;
  }
  function A(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (O) {
        s?.(k.id, O),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            O,
          );
      }
      k.cleanup = null;
    }
  }
  function j(k, O) {
    if (typeof O == "function")
      if (h)
        try {
          O();
        } catch (N) {
          s?.(k.id, N),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              N,
            );
        }
      else k.cleanup = O;
  }
  async function D(k) {
    const O = c(k),
      N = t[k];
    if (!(!O.enabled || !N)) {
      A(O), o?.(k);
      try {
        if (O.hasExplicitDeps) {
          let _;
          if (
            (i.batch(() => {
              _ = N.run(a, d);
            }),
            _ instanceof Promise)
          ) {
            const m = await _;
            j(O, m);
          } else j(O, _);
        } else {
          let _ = null,
            m,
            E = Ce(
              () => (
                i.batch(() => {
                  m = N.run(a, d);
                }),
                m
              ),
            );
          _ = E.deps;
          let v = E.value;
          v instanceof Promise && (v = await v),
            j(O, v),
            (O.dependencies = _.size > 0 ? _ : null);
        }
      } catch (_) {
        s?.(k, _),
          console.error(`[Directive] Effect "${k}" threw an error:`, _);
      }
    }
  }
  for (const k of Object.keys(t)) p(k);
  return {
    async runEffects(k) {
      const O = [];
      for (const N of Object.keys(t)) I(N, k) && O.push(N);
      await Promise.all(O.map(D)), (d = x());
    },
    async runAll() {
      const k = Object.keys(t);
      await Promise.all(
        k.map((O) => (c(O).enabled ? D(O) : Promise.resolve())),
      ),
        (d = x());
    },
    disable(k) {
      const O = c(k);
      O.enabled = !1;
    },
    enable(k) {
      const O = c(k);
      O.enabled = !0;
    },
    isEnabled(k) {
      return c(k).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const k of u.values()) A(k);
    },
    registerDefinitions(k) {
      for (const [O, N] of Object.entries(k)) (t[O] = N), p(O);
    },
  };
}
function Ot(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: i = 2,
      maxDelayMs: o = 3e4,
    } = e,
    s = new Map();
  function u(d) {
    const h = t * Math.pow(i, d - 1);
    return Math.min(h, o);
  }
  return {
    scheduleRetry(d, h, p, c, x) {
      if (c > a) return null;
      const I = u(c),
        A = {
          source: d,
          sourceId: h,
          context: p,
          attempt: c,
          nextRetryTime: Date.now() + I,
          callback: x,
        };
      return s.set(h, A), A;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const d = Date.now(),
        h = [];
      for (const [p, c] of s) c.nextRetryTime <= d && (h.push(c), s.delete(p));
      return h;
    },
    cancelRetry(d) {
      s.delete(d);
    },
    clearAll() {
      s.clear();
    },
  };
}
var jt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Dt(e = {}) {
  const { config: t = {}, onError: a, onRecovery: i } = e,
    o = [],
    s = 100,
    u = Ot(t.retryLater),
    d = new Map();
  function h(c, x, I, A) {
    if (I instanceof Ne) return I;
    const j = I instanceof Error ? I.message : String(I),
      D = c !== "system";
    return new Ne(j, c, x, A, D);
  }
  function p(c, x, I) {
    const A = (() => {
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
    if (typeof A == "function") {
      try {
        A(I, x);
      } catch (j) {
        console.error("[Directive] Error in error handler callback:", j);
      }
      return "skip";
    }
    return typeof A == "string" ? A : jt[c];
  }
  return {
    handleError(c, x, I, A) {
      const j = h(c, x, I, A);
      o.push(j), o.length > s && o.shift();
      try {
        a?.(j);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        t.onError?.(j);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let D = p(c, x, I instanceof Error ? I : new Error(String(I)));
      if (D === "retry-later") {
        const k = (d.get(x) ?? 0) + 1;
        d.set(x, k),
          u.scheduleRetry(c, x, A, k) ||
            ((D = "skip"), d.delete(x), typeof process < "u");
      }
      try {
        i?.(j, D);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (D === "throw") throw j;
      return D;
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
      return u;
    },
    processDueRetries() {
      return u.processDueRetries();
    },
    clearRetryAttempts(c) {
      d.delete(c), u.cancelRetry(c);
    },
  };
}
function Mt() {
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
  async function a(i) {
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
      for (const o of e) await a(() => o.onInit?.(i));
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
      for (const u of e) t(() => u.onFactSet?.(i, o, s));
    },
    emitFactDelete(i, o) {
      for (const s of e) t(() => s.onFactDelete?.(i, o));
    },
    emitFactsBatch(i) {
      for (const o of e) t(() => o.onFactsBatch?.(i));
    },
    emitDerivationCompute(i, o, s) {
      for (const u of e) t(() => u.onDerivationCompute?.(i, o, s));
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
      for (const u of e) t(() => u.onResolverComplete?.(i, o, s));
    },
    emitResolverError(i, o, s) {
      for (const u of e) t(() => u.onResolverError?.(i, o, s));
    },
    emitResolverRetry(i, o, s) {
      for (const u of e) t(() => u.onResolverRetry?.(i, o, s));
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
var We = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ke = { enabled: !1, windowMs: 50 };
function He(e, t) {
  let { backoff: a, initialDelay: i = 100, maxDelay: o = 3e4 } = e,
    s;
  switch (a) {
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
function It(e) {
  const {
      definitions: t,
      facts: a,
      store: i,
      onStart: o,
      onComplete: s,
      onError: u,
      onRetry: d,
      onCancel: h,
      onResolutionComplete: p,
    } = e,
    c = new Map(),
    x = new Map(),
    I = 1e3,
    A = new Map(),
    j = new Map(),
    D = 1e3;
  function k() {
    if (x.size > I) {
      const f = x.size - I,
        b = x.keys();
      for (let w = 0; w < f; w++) {
        const q = b.next().value;
        q && x.delete(q);
      }
    }
  }
  function O(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "string"
    );
  }
  function N(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function _(f, b) {
    return O(f) ? b.type === f.requirement : N(f) ? f.requirement(b) : !1;
  }
  function m(f) {
    const b = f.type,
      w = j.get(b);
    if (w)
      for (const q of w) {
        const F = t[q];
        if (F && _(F, f)) return q;
      }
    for (const [q, F] of Object.entries(t))
      if (_(F, f)) {
        if (!j.has(b)) {
          if (j.size >= D) {
            const P = j.keys().next().value;
            P !== void 0 && j.delete(P);
          }
          j.set(b, []);
        }
        const K = j.get(b);
        return K.includes(q) || K.push(q), q;
      }
    return null;
  }
  function E(f) {
    return { facts: a, signal: f, snapshot: () => a.$snapshot() };
  }
  async function v(f, b, w) {
    const q = t[f];
    if (!q) return;
    let F = { ...We, ...q.retry },
      K = null;
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
        const C = E(w.signal);
        if (q.resolve) {
          let n;
          i.batch(() => {
            n = q.resolve(b.requirement, C);
          });
          const l = q.timeout;
          l && l > 0
            ? await xe(n, l, `Resolver "${f}" timed out after ${l}ms`)
            : await n;
        }
        const r = Date.now() - (y?.startedAt ?? Date.now());
        x.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: r,
        }),
          k(),
          s?.(f, b, r);
        return;
      } catch (C) {
        if (
          ((K = C instanceof Error ? C : new Error(String(C))),
          w.signal.aborted)
        )
          return;
        if (F.shouldRetry && !F.shouldRetry(K, P)) break;
        if (P < F.attempts) {
          if (w.signal.aborted) return;
          const r = He(F, P);
          if (
            (d?.(f, b, P + 1),
            await new Promise((n) => {
              const l = setTimeout(n, r),
                g = () => {
                  clearTimeout(l), n();
                };
              w.signal.addEventListener("abort", g, { once: !0 });
            }),
            w.signal.aborted)
          )
            return;
        }
      }
    }
    x.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: K,
      failedAt: Date.now(),
      attempts: F.attempts,
    }),
      k(),
      u?.(f, b, K);
  }
  async function $(f, b) {
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
    let q = { ...We, ...w.retry },
      F = { ...Ke, ...w.batch },
      K = new AbortController(),
      P = Date.now(),
      y = null,
      C = F.timeoutMs ?? w.timeout;
    for (let r = 1; r <= q.attempts; r++) {
      if (K.signal.aborted) return;
      try {
        const n = E(K.signal),
          l = b.map((g) => g.requirement);
        if (w.resolveBatchWithResults) {
          let g, S;
          if (
            (i.batch(() => {
              S = w.resolveBatchWithResults(l, n);
            }),
            C && C > 0
              ? (g = await xe(
                  S,
                  C,
                  `Batch resolver "${f}" timed out after ${C}ms`,
                ))
              : (g = await S),
            g.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${g.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let M = Date.now() - P,
            L = !1;
          for (let W = 0; W < b.length; W++) {
            const B = b[W],
              U = g[W];
            if (U.success)
              x.set(B.id, {
                state: "success",
                requirementId: B.id,
                completedAt: Date.now(),
                duration: M,
              }),
                s?.(f, B, M);
            else {
              L = !0;
              const Y = U.error ?? new Error("Batch item failed");
              x.set(B.id, {
                state: "error",
                requirementId: B.id,
                error: Y,
                failedAt: Date.now(),
                attempts: r,
              }),
                u?.(f, B, Y);
            }
          }
          if (!L || b.some((W, B) => g[B]?.success)) return;
        } else {
          let g;
          i.batch(() => {
            g = w.resolveBatch(l, n);
          }),
            C && C > 0
              ? await xe(g, C, `Batch resolver "${f}" timed out after ${C}ms`)
              : await g;
          const S = Date.now() - P;
          for (const M of b)
            x.set(M.id, {
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
          K.signal.aborted)
        )
          return;
        if (q.shouldRetry && !q.shouldRetry(y, r)) break;
        if (r < q.attempts) {
          const l = He(q, r);
          for (const g of b) d?.(f, g, r + 1);
          if (
            (await new Promise((g) => {
              const S = setTimeout(g, l),
                M = () => {
                  clearTimeout(S), g();
                };
              K.signal.addEventListener("abort", M, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const r of b)
      x.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: y,
        failedAt: Date.now(),
        attempts: q.attempts,
      }),
        u?.(f, r, y);
    k();
  }
  function R(f, b) {
    const w = t[f];
    if (!w) return;
    const q = { ...Ke, ...w.batch };
    A.has(f) || A.set(f, { resolverId: f, requirements: [], timer: null });
    const F = A.get(f);
    F.requirements.push(b),
      F.timer && clearTimeout(F.timer),
      (F.timer = setTimeout(() => {
        z(f);
      }, q.windowMs));
  }
  function z(f) {
    const b = A.get(f);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      $(f, w).then(() => {
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
        K = {
          requirementId: f.id,
          resolverId: b,
          controller: q,
          startedAt: F,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: F },
          originalRequirement: f,
        };
      c.set(f.id, K),
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
        x.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        k(),
        h?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of c) this.cancel(f);
      for (const f of A.values()) f.timer && clearTimeout(f.timer);
      A.clear();
    },
    getStatus(f) {
      const b = c.get(f);
      return b ? b.status : x.get(f) || { state: "idle" };
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
      for (const f of A.keys()) z(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) t[b] = w;
      j.clear();
    },
  };
}
function qt(e) {
  let { config: t, facts: a, store: i, onSnapshot: o, onTimeTravel: s } = e,
    u = t.timeTravel ?? !1,
    d = t.maxSnapshots ?? 100,
    h = [],
    p = -1,
    c = 1,
    x = !1,
    I = !1,
    A = [],
    j = null,
    D = -1;
  function k() {
    return i.toObject();
  }
  function O() {
    const _ = k();
    return structuredClone(_);
  }
  function N(_) {
    if (!be(_)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    i.batch(() => {
      for (const [m, E] of Object.entries(_)) {
        if (m === "__proto__" || m === "constructor" || m === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${m}" during fact restoration`,
          );
          continue;
        }
        a[m] = E;
      }
    });
  }
  return {
    get isEnabled() {
      return u;
    },
    get isRestoring() {
      return I;
    },
    get isPaused() {
      return x;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(_) {
      if (!u || x)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: _ };
      const m = { id: c++, timestamp: Date.now(), facts: O(), trigger: _ };
      for (
        p < h.length - 1 && h.splice(p + 1), h.push(m), p = h.length - 1;
        h.length > d;
      )
        h.shift(), p--;
      return o?.(m), m;
    },
    restore(_) {
      if (u) {
        (x = !0), (I = !0);
        try {
          N(_.facts);
        } finally {
          (x = !1), (I = !1);
        }
      }
    },
    goBack(_ = 1) {
      if (!u || h.length === 0) return;
      let m = p,
        E = p,
        v = A.find((R) => p > R.startIndex && p <= R.endIndex);
      if (v) E = v.startIndex;
      else if (A.find((R) => p === R.startIndex)) {
        const R = A.find((z) => z.endIndex < p && p - z.endIndex <= _);
        E = R ? R.startIndex : Math.max(0, p - _);
      } else E = Math.max(0, p - _);
      if (m === E) return;
      p = E;
      const $ = h[p];
      $ && (this.restore($), s?.(m, E));
    },
    goForward(_ = 1) {
      if (!u || h.length === 0) return;
      let m = p,
        E = p,
        v = A.find((R) => p >= R.startIndex && p < R.endIndex);
      if ((v ? (E = v.endIndex) : (E = Math.min(h.length - 1, p + _)), m === E))
        return;
      p = E;
      const $ = h[p];
      $ && (this.restore($), s?.(m, E));
    },
    goTo(_) {
      if (!u) return;
      const m = h.findIndex(($) => $.id === _);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${_} not found`);
        return;
      }
      const E = p;
      p = m;
      const v = h[p];
      v && (this.restore(v), s?.(E, m));
    },
    replay() {
      if (!u || h.length === 0) return;
      p = 0;
      const _ = h[0];
      _ && this.restore(_);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: p });
    },
    import(_) {
      if (u)
        try {
          const m = JSON.parse(_);
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
            if (!be(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...m.snapshots), (p = m.currentIndex);
          const E = h[p];
          E && this.restore(E);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(_) {
      u && ((j = _), (D = p));
    },
    endChangeset() {
      !u ||
        j === null ||
        (p > D && A.push({ label: j, startIndex: D, endIndex: p }),
        (j = null),
        (D = -1));
    },
    pause() {
      x = !0;
    },
    resume() {
      x = !1;
    },
  };
}
function Tt() {
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
var se = new Set(["__proto__", "constructor", "prototype"]);
function st(e) {
  const t = Object.create(null),
    a = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    s = Object.create(null),
    u = Object.create(null);
  for (const r of e.modules) {
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (se.has(S))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${S}" in ${g}. This could indicate a prototype pollution attempt.`,
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
      r.events && Object.assign(a, r.events),
      r.derive && Object.assign(i, r.derive),
      r.effects && Object.assign(o, r.effects),
      r.constraints && Object.assign(s, r.constraints),
      r.resolvers && Object.assign(u, r.resolvers);
  }
  let d = null;
  if (e.modules.some((r) => r.snapshotEvents)) {
    d = new Set();
    for (const r of e.modules) {
      const n = r;
      if (n.snapshotEvents) for (const l of n.snapshotEvents) d.add(l);
      else if (n.events) for (const l of Object.keys(n.events)) d.add(l);
    }
  }
  let h = 0,
    p = !1,
    c = Mt();
  for (const r of e.plugins ?? []) c.register(r);
  let x = Dt({
      config: e.errorBoundary,
      onError: (r) => c.emitError(r),
      onRecovery: (r, n) => c.emitErrorRecovery(r, n),
    }),
    I = () => {},
    A = () => {},
    j = null,
    { store: D, facts: k } = wt({
      schema: t,
      onChange: (r, n, l) => {
        c.emitFactSet(r, n, l),
          I(r),
          !j?.isRestoring && (h === 0 && (p = !0), w.changedKeys.add(r), q());
      },
      onBatch: (r) => {
        c.emitFactsBatch(r);
        const n = [];
        for (const l of r) n.push(l.key);
        if ((A(n), !j?.isRestoring)) {
          h === 0 && (p = !0);
          for (const l of r) w.changedKeys.add(l.key);
          q();
        }
      },
    }),
    O = Rt({
      definitions: i,
      facts: k,
      onCompute: (r, n, l) => c.emitDerivationCompute(r, n, l),
      onInvalidate: (r) => c.emitDerivationInvalidate(r),
      onError: (r, n) => {
        x.handleError("derivation", r, n);
      },
    });
  (I = (r) => O.invalidate(r)), (A = (r) => O.invalidateMany(r));
  const N = At({
      definitions: o,
      facts: k,
      store: D,
      onRun: (r) => c.emitEffectRun(r),
      onError: (r, n) => {
        x.handleError("effect", r, n), c.emitEffectError(r, n);
      },
    }),
    _ = kt({
      definitions: s,
      facts: k,
      onEvaluate: (r, n) => c.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        x.handleError("constraint", r, n), c.emitConstraintError(r, n);
      },
    }),
    m = It({
      definitions: u,
      facts: k,
      store: D,
      onStart: (r, n) => c.emitResolverStart(r, n),
      onComplete: (r, n, l) => {
        c.emitResolverComplete(r, n, l),
          c.emitRequirementMet(n, r),
          _.markResolved(n.fromConstraint);
      },
      onError: (r, n, l) => {
        x.handleError("resolver", r, l, n), c.emitResolverError(r, n, l);
      },
      onRetry: (r, n, l) => c.emitResolverRetry(r, n, l),
      onCancel: (r, n) => {
        c.emitResolverCancel(r, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        z(), q();
      },
    }),
    E = new Set();
  function v() {
    for (const r of E) r();
  }
  const $ = e.debug?.timeTravel
    ? qt({
        config: e.debug,
        facts: k,
        store: D,
        onSnapshot: (r) => {
          c.emitSnapshot(r), v();
        },
        onTimeTravel: (r, n) => {
          c.emitTimeTravel(r, n), v();
        },
      })
    : Tt();
  j = $;
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
      previousRequirements: new qe(),
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
          ((d === null || p) &&
            $.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (p = !1));
        const r = k.$snapshot();
        c.emitReconcileStart(r), await N.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const l = await _.evaluate(n),
          g = new qe();
        for (const B of l) g.add(B), c.emitRequirementCreated(B);
        const { added: S, removed: M } = g.diff(w.previousRequirements);
        for (const B of M) m.cancel(B.id);
        for (const B of S) m.resolve(B);
        w.previousRequirements = g;
        const L = m.getInflightInfo(),
          W = {
            unmet: l.filter((B) => !m.isResolving(B.id)),
            inflight: L,
            completed: [],
            canceled: M.map((B) => ({
              id: B.id,
              resolverId: L.find((U) => U.id === B.id)?.resolverId ?? "unknown",
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
  const K = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !se.has(n)) return O.get(n);
        },
        has(r, n) {
          return typeof n == "symbol" || se.has(n) ? !1 : n in i;
        },
        ownKeys() {
          return Object.keys(i);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !se.has(n) && n in i)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    P = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !se.has(n))
            return (l) => {
              const g = a[n];
              if (g) {
                h++, (d === null || d.has(n)) && (p = !0);
                try {
                  D.batch(() => {
                    g(k, { type: n, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(r, n) {
          return typeof n == "symbol" || se.has(n) ? !1 : n in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !se.has(n) && n in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: k,
      debug: $.isEnabled ? $ : null,
      derive: K,
      events: P,
      constraints: { disable: (r) => _.disable(r), enable: (r) => _.enable(r) },
      effects: {
        disable: (r) => N.disable(r),
        enable: (r) => N.enable(r),
        isEnabled: (r) => N.isEnabled(r),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              D.batch(() => {
                r.init(k);
              });
          e.onAfterModuleInit &&
            D.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const r of Object.keys(i)) O.get(r);
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
          (w.isRunning = !1), m.cancelAll(), N.cleanupAll();
          for (const r of e.modules) r.hooks?.onStop?.(y);
          c.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (w.isDestroyed = !0),
          R.clear(),
          E.clear(),
          c.emitDestroy(y);
      },
      dispatch(r) {
        if (se.has(r.type)) return;
        const n = a[r.type];
        if (n) {
          h++, (d === null || d.has(r.type)) && (p = !0);
          try {
            D.batch(() => {
              n(k, r);
            });
          } finally {
            h--;
          }
        }
      },
      read(r) {
        return O.get(r);
      },
      subscribe(r, n) {
        const l = [],
          g = [];
        for (const M of r) M in i ? l.push(M) : M in t && g.push(M);
        const S = [];
        return (
          l.length > 0 && S.push(O.subscribe(l, n)),
          g.length > 0 && S.push(D.subscribe(g, n)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(r, n, l) {
        const g = l?.equalityFn
          ? (M, L) => l.equalityFn(M, L)
          : (M, L) => Object.is(M, L);
        if (r in i) {
          let M = O.get(r);
          return O.subscribe([r], () => {
            const L = O.get(r);
            if (!g(L, M)) {
              const W = M;
              (M = L), n(L, W);
            }
          });
        }
        let S = D.get(r);
        return D.subscribe([r], () => {
          const M = D.get(r);
          if (!g(M, S)) {
            const L = S;
            (S = M), n(M, L);
          }
        });
      },
      when(r, n) {
        return new Promise((l, g) => {
          const S = D.toObject();
          if (r(S)) {
            l();
            return;
          }
          let M,
            L,
            W = () => {
              M?.(), L !== void 0 && clearTimeout(L);
            };
          (M = D.subscribeAll(() => {
            const B = D.toObject();
            r(B) && (W(), l());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (L = setTimeout(() => {
                W(),
                  g(
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
          constraints: _.getAllStates().map((r) => ({
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
        const n = w.previousRequirements.all().find((U) => U.id === r);
        if (!n) return null;
        const l = _.getState(n.fromConstraint),
          g = m.getStatus(r),
          S = {},
          M = D.toObject();
        for (const [U, Y] of Object.entries(M)) S[U] = Y;
        const L = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, Y]) => `${U}=${JSON.stringify(Y)}`)
            .join(", ");
        W && L.push(`├─ Requirement payload: { ${W} }`);
        const B = Object.entries(S).slice(0, 10);
        return (
          B.length > 0 &&
            (L.push("└─ Relevant facts:"),
            B.forEach(([U, Y], te) => {
              const Z = te === B.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              L.push(
                `${Z} ${U} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          L.join(`
`)
        );
      },
      async settle(r = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const l = this.inspect();
          if (
            l.inflight.length === 0 &&
            !w.isReconciling &&
            !w.reconcileScheduled
          )
            return;
          if (Date.now() - n > r) {
            const g = [];
            l.inflight.length > 0 &&
              g.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((M) => M.resolverId).join(", ")}`,
              ),
              w.isReconciling && g.push("reconciliation in progress"),
              w.reconcileScheduled && g.push("reconcile scheduled");
            const S = w.previousRequirements.all();
            throw (
              (S.length > 0 &&
                g.push(
                  `${S.length} unmet requirements: ${S.map((M) => M.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${r}ms. ${g.join("; ")}`,
              ))
            );
          }
          await new Promise((g) => setTimeout(g, 10));
        }
      },
      getSnapshot() {
        return { facts: D.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: S,
            metadata: M,
            includeVersion: L,
          } = r,
          W = {},
          B = Object.keys(i),
          U;
        if ((n ? (U = n.filter((Z) => B.includes(Z))) : (U = B), l)) {
          const Z = new Set(l);
          U = U.filter((X) => !Z.has(X));
        }
        for (const Z of U)
          try {
            W[Z] = O.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = D.toObject();
          for (const X of g) X in Z && (W[X] = Z[X]);
        }
        const Y = Date.now(),
          te = { data: W, createdAt: Y };
        return (
          S !== void 0 && S > 0 && (te.expiresAt = Y + S * 1e3),
          L && (te.version = xt(W)),
          M && (te.metadata = M),
          te
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: l, excludeDerivations: g } = r,
          S = Object.keys(i),
          M;
        if ((l ? (M = l.filter((W) => S.includes(W))) : (M = S), g)) {
          const W = new Set(g);
          M = M.filter((B) => !W.has(B));
        }
        if (M.length === 0) return () => {};
        let L = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return O.subscribe(M, () => {
          const W = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          W.version !== L && ((L = W.version), n(W));
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
        if (!be(r))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [n, l] of Object.entries(r.facts))
            se.has(n) || D.set(n, l);
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
          E.add(r),
          () => {
            E.delete(r);
          }
        );
      },
      batch(r) {
        D.batch(r);
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
  function C(r) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" on a destroyed system.`,
      );
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (se.has(S))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${S}" in ${g}.`,
            );
      }
    };
    n(r.schema, "schema"),
      n(r.events, "events"),
      n(r.derive, "derive"),
      n(r.effects, "effects"),
      n(r.constraints, "constraints"),
      n(r.resolvers, "resolvers");
    for (const l of Object.keys(r.schema))
      if (l in t)
        throw new Error(
          `[Directive] Schema collision: Fact "${l}" already exists. Cannot register module "${r.id}".`,
        );
    if (r.snapshotEvents) {
      d === null && (d = new Set(Object.keys(a)));
      for (const l of r.snapshotEvents) d.add(l);
    } else if (d !== null && r.events)
      for (const l of Object.keys(r.events)) d.add(l);
    Object.assign(t, r.schema),
      r.events && Object.assign(a, r.events),
      r.derive && (Object.assign(i, r.derive), O.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(o, r.effects), N.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(s, r.constraints), _.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(u, r.resolvers), m.registerDefinitions(r.resolvers)),
      D.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        D.batch(() => {
          r.init(k);
        }),
      r.hooks?.onInit?.(y),
      w.isRunning && (r.hooks?.onStart?.(y), q());
  }
  (y.registerModule = C), c.emitInit(y);
  for (const r of e.modules) r.hooks?.onInit?.(y);
  return y;
}
var re = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function _t(e) {
  const t = Object.keys(e),
    a = new Set(),
    i = new Set(),
    o = [],
    s = [];
  function u(d) {
    if (a.has(d)) return;
    if (i.has(d)) {
      const p = s.indexOf(d),
        c = [...s.slice(p), d].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    i.add(d), s.push(d);
    const h = e[d];
    if (h?.crossModuleDeps)
      for (const p of Object.keys(h.crossModuleDeps)) t.includes(p) && u(p);
    s.pop(), i.delete(d), a.add(d), o.push(d);
  }
  for (const d of t) u(d);
  return o;
}
var Ge = new WeakMap(),
  Ue = new WeakMap(),
  Ve = new WeakMap(),
  Ye = new WeakMap();
function Bt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Nt(e);
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
  return zt(t);
}
function zt(e) {
  const t = e.modules,
    a = new Set(Object.keys(t)),
    i = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let o,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      E = Object.keys(t).filter((v) => !m.includes(v));
    if (E.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${E.join(", ")}. All modules must be included in the explicit order.`,
      );
    o = m;
  } else s === "declaration" ? (o = Object.keys(t)) : (o = _t(t));
  let u = e.debug,
    d = e.errorBoundary;
  e.zeroConfig &&
    ((u = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (d = {
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
    const E = t[m];
    if (E) {
      for (const v of Object.keys(E.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const h = [];
  for (const m of o) {
    const E = t[m];
    if (!E) continue;
    const v = E.crossModuleDeps && Object.keys(E.crossModuleDeps).length > 0,
      $ = v ? Object.keys(E.crossModuleDeps) : [],
      R = {};
    for (const [y, C] of Object.entries(E.schema.facts)) R[`${m}${H}${y}`] = C;
    const z = {};
    if (E.schema.derivations)
      for (const [y, C] of Object.entries(E.schema.derivations))
        z[`${m}${H}${y}`] = C;
    const f = {};
    if (E.schema.events)
      for (const [y, C] of Object.entries(E.schema.events))
        f[`${m}${H}${y}`] = C;
    const b = E.init
        ? (y) => {
            const C = ne(y, m);
            E.init(C);
          }
        : void 0,
      w = {};
    if (E.derive)
      for (const [y, C] of Object.entries(E.derive))
        w[`${m}${H}${y}`] = (r, n) => {
          const l = v ? le(r, m, $) : ne(r, m),
            g = Te(n, m);
          return C(l, g);
        };
    const q = {};
    if (E.events)
      for (const [y, C] of Object.entries(E.events))
        q[`${m}${H}${y}`] = (r, n) => {
          const l = ne(r, m);
          C(l, n);
        };
    const F = {};
    if (E.constraints)
      for (const [y, C] of Object.entries(E.constraints)) {
        const r = C;
        F[`${m}${H}${y}`] = {
          ...r,
          deps: r.deps?.map((n) => `${m}${H}${n}`),
          when: (n) => {
            const l = v ? le(n, m, $) : ne(n, m);
            return r.when(l);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const l = v ? le(n, m, $) : ne(n, m);
                  return r.require(l);
                }
              : r.require,
        };
      }
    const K = {};
    if (E.resolvers)
      for (const [y, C] of Object.entries(E.resolvers)) {
        const r = C;
        K[`${m}${H}${y}`] = {
          ...r,
          resolve: async (n, l) => {
            const g = Ae(l.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: g[m], signal: l.signal });
          },
        };
      }
    const P = {};
    if (E.effects)
      for (const [y, C] of Object.entries(E.effects)) {
        const r = C;
        P[`${m}${H}${y}`] = {
          ...r,
          run: (n, l) => {
            const g = v ? le(n, m, $) : ne(n, m),
              S = l ? (v ? le(l, m, $) : ne(l, m)) : void 0;
            return r.run(g, S);
          },
          deps: r.deps?.map((n) => `${m}${H}${n}`),
        };
      }
    h.push({
      id: E.id,
      schema: {
        facts: R,
        derivations: z,
        events: f,
        requirements: E.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: q,
      effects: P,
      constraints: F,
      resolvers: K,
      hooks: E.hooks,
      snapshotEvents:
        i && !i.has(m) ? [] : E.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let p = null,
    c = null;
  function x(m) {
    for (const [E, v] of Object.entries(m))
      if (!re.has(E) && a.has(E)) {
        if (v && typeof v == "object" && !be(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${E}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [$, R] of Object.entries(v))
          re.has($) || (c.facts[`${E}${H}${$}`] = R);
      }
  }
  c = st({
    modules: h.map((m) => ({
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
    debug: u,
    errorBoundary: d,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && x(e.initialFacts), p && (x(p), (p = null));
    },
  });
  const I = new Map();
  for (const m of Object.keys(t)) {
    const E = t[m];
    if (!E) continue;
    const v = [];
    for (const $ of Object.keys(E.schema.facts)) v.push(`${m}${H}${$}`);
    if (E.schema.derivations)
      for (const $ of Object.keys(E.schema.derivations)) v.push(`${m}${H}${$}`);
    I.set(m, v);
  }
  const A = { names: null };
  function j() {
    return A.names === null && (A.names = Object.keys(t)), A.names;
  }
  let D = Ae(c.facts, t, j),
    k = Pt(c.derive, t, j),
    O = Lt(c, t, j),
    N = null,
    _ = e.tickMs;
  return {
    _mode: "namespaced",
    facts: D,
    debug: c.debug,
    derive: k,
    events: O,
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
      const E = await m();
      E && typeof E == "object" && (p = E);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), _ && _ > 0)) {
        const m = Object.keys(h[0]?.events ?? {}).find((E) =>
          E.endsWith(`${H}tick`),
        );
        m &&
          (N = setInterval(() => {
            c.dispatch({ type: m });
          }, _));
      }
    },
    stop() {
      N && (clearInterval(N), (N = null)), c.stop();
    },
    destroy() {
      this.stop(), c.destroy();
    },
    dispatch(m) {
      c.dispatch(m);
    },
    batch: c.batch.bind(c),
    read(m) {
      return c.read(ce(m));
    },
    subscribe(m, E) {
      const v = [];
      for (const $ of m)
        if ($.endsWith(".*")) {
          const R = $.slice(0, -2),
            z = I.get(R);
          z && v.push(...z);
        } else v.push(ce($));
      return c.subscribe(v, E);
    },
    subscribeModule(m, E) {
      const v = I.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, E);
    },
    watch(m, E, v) {
      return c.watch(ce(m), E, v);
    },
    when(m, E) {
      return c.when(() => m(D), E);
    },
    onSettledChange: c.onSettledChange.bind(c),
    onTimeTravelChange: c.onTimeTravelChange.bind(c),
    inspect: c.inspect.bind(c),
    settle: c.settle.bind(c),
    explain: c.explain.bind(c),
    getSnapshot: c.getSnapshot.bind(c),
    restore: c.restore.bind(c),
    getDistributableSnapshot(m) {
      const E = {
          ...m,
          includeDerivations: m?.includeDerivations?.map(ce),
          excludeDerivations: m?.excludeDerivations?.map(ce),
          includeFacts: m?.includeFacts?.map(ce),
        },
        v = c.getDistributableSnapshot(E),
        $ = {};
      for (const [R, z] of Object.entries(v.data)) {
        const f = R.indexOf(H);
        if (f > 0) {
          const b = R.slice(0, f),
            w = R.slice(f + H.length);
          $[b] || ($[b] = {}), ($[b][w] = z);
        } else $._root || ($._root = {}), ($._root[R] = z);
      }
      return { ...v, data: $ };
    },
    watchDistributableSnapshot(m, E) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ce),
        excludeDerivations: m?.excludeDerivations?.map(ce),
        includeFacts: m?.includeFacts?.map(ce),
      };
      return c.watchDistributableSnapshot(v, ($) => {
        const R = {};
        for (const [z, f] of Object.entries($.data)) {
          const b = z.indexOf(H);
          if (b > 0) {
            const w = z.slice(0, b),
              q = z.slice(b + H.length);
            R[w] || (R[w] = {}), (R[w][q] = f);
          } else R._root || (R._root = {}), (R._root[z] = f);
        }
        E({ ...$, data: R });
      });
    },
    registerModule(m, E) {
      if (a.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(H))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${H}".`,
        );
      if (re.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys(E.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${H}".`,
          );
      const v = E,
        $ = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = $ ? Object.keys(v.crossModuleDeps) : [],
        z = {};
      for (const [y, C] of Object.entries(v.schema.facts))
        z[`${m}${H}${y}`] = C;
      const f = v.init
          ? (y) => {
              const C = ne(y, m);
              v.init(C);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, C] of Object.entries(v.derive))
          b[`${m}${H}${y}`] = (r, n) => {
            const l = $ ? le(r, m, R) : ne(r, m),
              g = Te(n, m);
            return C(l, g);
          };
      const w = {};
      if (v.events)
        for (const [y, C] of Object.entries(v.events))
          w[`${m}${H}${y}`] = (r, n) => {
            const l = ne(r, m);
            C(l, n);
          };
      const q = {};
      if (v.constraints)
        for (const [y, C] of Object.entries(v.constraints)) {
          const r = C;
          q[`${m}${H}${y}`] = {
            ...r,
            deps: r.deps?.map((n) => `${m}${H}${n}`),
            when: (n) => {
              const l = $ ? le(n, m, R) : ne(n, m);
              return r.when(l);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const l = $ ? le(n, m, R) : ne(n, m);
                    return r.require(l);
                  }
                : r.require,
          };
        }
      const F = {};
      if (v.resolvers)
        for (const [y, C] of Object.entries(v.resolvers)) {
          const r = C;
          F[`${m}${H}${y}`] = {
            ...r,
            resolve: async (n, l) => {
              const g = Ae(l.facts, t, j);
              await r.resolve(n, { facts: g[m], signal: l.signal });
            },
          };
        }
      const K = {};
      if (v.effects)
        for (const [y, C] of Object.entries(v.effects)) {
          const r = C;
          K[`${m}${H}${y}`] = {
            ...r,
            run: (n, l) => {
              const g = $ ? le(n, m, R) : ne(n, m),
                S = l ? ($ ? le(l, m, R) : ne(l, m)) : void 0;
              return r.run(g, S);
            },
            deps: r.deps?.map((n) => `${m}${H}${n}`),
          };
        }
      a.add(m), (t[m] = v), (A.names = null);
      const P = [];
      for (const y of Object.keys(v.schema.facts)) P.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          P.push(`${m}${H}${y}`);
      I.set(m, P),
        c.registerModule({
          id: v.id,
          schema: z,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(q).length > 0 ? q : void 0,
          resolvers: Object.keys(F).length > 0 ? F : void 0,
          hooks: v.hooks,
          snapshotEvents:
            i && !i.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${H}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [t, ...a] = e.split(".");
    return `${t}${H}${a.join(H)}`;
  }
  return e;
}
function ne(e, t) {
  let a = Ge.get(e);
  if (a) {
    const o = a.get(t);
    if (o) return o;
  } else (a = new Map()), Ge.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !re.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${t}${H}${s}`];
      },
      set(o, s, u) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : ((e[`${t}${H}${s}`] = u), !0);
      },
      has(o, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${t}${H}${s}` in e;
      },
      deleteProperty(o, s) {
        return typeof s == "symbol" || re.has(s)
          ? !1
          : (delete e[`${t}${H}${s}`], !0);
      },
    },
  );
  return a.set(t, i), i;
}
function Ae(e, t, a) {
  const i = Ue.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !re.has(u) && Object.hasOwn(t, u))
          return ne(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || re.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ue.set(e, o), o;
}
var Je = new WeakMap();
function le(e, t, a) {
  let i = `${t}:${JSON.stringify([...a].sort())}`,
    o = Je.get(e);
  if (o) {
    const h = o.get(i);
    if (h) return h;
  } else (o = new Map()), Je.set(e, o);
  const s = new Set(a),
    u = ["self", ...a],
    d = new Proxy(
      {},
      {
        get(h, p) {
          if (typeof p != "symbol" && !re.has(p)) {
            if (p === "self") return ne(e, t);
            if (s.has(p)) return ne(e, p);
          }
        },
        has(h, p) {
          return typeof p == "symbol" || re.has(p)
            ? !1
            : p === "self" || s.has(p);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(h, p) {
          if (typeof p != "symbol" && (p === "self" || s.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return o.set(i, d), d;
}
function Te(e, t) {
  let a = Ye.get(e);
  if (a) {
    const o = a.get(t);
    if (o) return o;
  } else (a = new Map()), Ye.set(e, a);
  const i = new Proxy(
    {},
    {
      get(o, s) {
        if (typeof s != "symbol" && !re.has(s)) return e[`${t}${H}${s}`];
      },
      has(o, s) {
        return typeof s == "symbol" || re.has(s) ? !1 : `${t}${H}${s}` in e;
      },
    },
  );
  return a.set(t, i), i;
}
function Pt(e, t, a) {
  const i = Ve.get(e);
  if (i) return i;
  const o = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !re.has(u) && Object.hasOwn(t, u))
          return Te(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || re.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ve.set(e, o), o;
}
var Xe = new WeakMap();
function Lt(e, t, a) {
  let i = Xe.get(e);
  return (
    i || ((i = new Map()), Xe.set(e, i)),
    new Proxy(
      {},
      {
        get(o, s) {
          if (typeof s == "symbol" || re.has(s) || !Object.hasOwn(t, s)) return;
          const u = i.get(s);
          if (u) return u;
          const d = new Proxy(
            {},
            {
              get(h, p) {
                if (typeof p != "symbol" && !re.has(p))
                  return (c) => {
                    e.dispatch({ type: `${s}${H}${p}`, ...c });
                  };
              },
            },
          );
          return i.set(s, d), d;
        },
        has(o, s) {
          return typeof s == "symbol" || re.has(s) ? !1 : Object.hasOwn(t, s);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(o, s) {
          if (typeof s != "symbol" && Object.hasOwn(t, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Nt(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !be(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let a = e.debug,
    i = e.errorBoundary;
  e.zeroConfig &&
    ((a = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (i = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let o = null,
    s = null;
  s = st({
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
    debug: a,
    errorBoundary: i,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, c] of Object.entries(e.initialFacts))
          re.has(p) || (s.facts[p] = c);
      if (o) {
        for (const [p, c] of Object.entries(o)) re.has(p) || (s.facts[p] = c);
        o = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(p, c) {
          if (typeof c != "symbol" && !re.has(c))
            return (x) => {
              s.dispatch({ type: c, ...x });
            };
        },
      },
    ),
    d = null,
    h = e.tickMs;
  return {
    _mode: "single",
    facts: s.facts,
    debug: s.debug,
    derive: s.derive,
    events: u,
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
        h &&
          h > 0 &&
          t.events &&
          "tick" in t.events &&
          (d = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      d && (clearInterval(d), (d = null)), s.stop();
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
    watch(p, c, x) {
      return s.watch(p, c, x);
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
var lt = class {
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
function Be() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function at(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (a, i) =>
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
function fe(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function Ee(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Ft(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Wt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Be() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function Kt() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var Ht = 200,
  Re = 340,
  me = 16,
  ge = 80,
  Qe = 2,
  Ze = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Gt() {
  return { entries: new lt(Ht), inflight: new Map() };
}
function Ut() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var Vt = 1e4,
  Yt = 100;
function Jt() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var Xt = 50,
  et = 200,
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
  Q = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function Qt(e, t, a, i) {
  let o = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${T.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${T.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const d = document.createElement("button");
  d.setAttribute("aria-label", "Open Directive DevTools"),
    d.setAttribute("aria-expanded", String(a)),
    (d.title = "Ctrl+Shift+D to toggle"),
    Object.assign(d.style, {
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
      display: a ? "none" : "block",
    }),
    (d.textContent = "Directive");
  const h = document.createElement("div");
  h.setAttribute("role", "region"),
    h.setAttribute("aria-label", "Directive DevTools"),
    h.setAttribute("data-directive-devtools", ""),
    (h.tabIndex = -1),
    Object.assign(h.style, {
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
      display: a ? "block" : "none",
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
  const x = document.createElement("button");
  x.setAttribute("aria-label", "Close DevTools"),
    Object.assign(x.style, {
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
    (x.textContent = "×"),
    p.appendChild(c),
    p.appendChild(x),
    h.appendChild(p);
  const I = document.createElement("div");
  (I.style.marginBottom = "6px"), I.setAttribute("aria-live", "polite");
  const A = document.createElement("span");
  (A.style.color = T.green),
    (A.textContent = "Settled"),
    I.appendChild(A),
    h.appendChild(I);
  const j = document.createElement("div");
  Object.assign(j.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const D = document.createElement("button");
  Object.assign(D.style, {
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
    (D.textContent = "◀ Undo"),
    (D.disabled = !0);
  const k = document.createElement("button");
  Object.assign(k.style, {
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
    (k.textContent = "Redo ▶"),
    (k.disabled = !0);
  const O = document.createElement("span");
  (O.style.color = T.muted),
    (O.style.fontSize = "10px"),
    j.appendChild(D),
    j.appendChild(k),
    j.appendChild(O),
    h.appendChild(j);
  function N(G, V) {
    const J = document.createElement("details");
    V && (J.open = !0), (J.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: T.accent,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (oe.textContent = `${G} (`),
      oe.appendChild(de),
      oe.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      J.appendChild(oe);
    const ue = document.createElement("table");
    Object.assign(ue.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const ze = document.createElement("thead"),
      Pe = document.createElement("tr");
    for (const pt of ["Key", "Value"]) {
      const Se = document.createElement("th");
      (Se.scope = "col"),
        Object.assign(Se.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: T.accent,
        }),
        (Se.textContent = pt),
        Pe.appendChild(Se);
    }
    ze.appendChild(Pe), ue.appendChild(ze);
    const Le = document.createElement("tbody");
    return (
      ue.appendChild(Le),
      J.appendChild(ue),
      { details: J, tbody: Le, countSpan: de }
    );
  }
  function _(G, V) {
    const J = document.createElement("details");
    J.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: V,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (oe.textContent = `${G} (`),
      oe.appendChild(de),
      oe.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      J.appendChild(oe);
    const ue = document.createElement("ul");
    return (
      Object.assign(ue.style, { margin: "0", paddingLeft: "16px" }),
      J.appendChild(ue),
      { details: J, list: ue, countSpan: de }
    );
  }
  const m = N("Facts", !0);
  h.appendChild(m.details);
  const E = N("Derivations", !1);
  h.appendChild(E.details);
  const v = _("Inflight", T.yellow);
  h.appendChild(v.details);
  const $ = _("Unmet", T.red);
  h.appendChild($.details);
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
    h.appendChild(R);
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
    h.appendChild(b);
  const F = document.createElement("details");
  F.style.marginBottom = "4px";
  const K = document.createElement("summary");
  Object.assign(K.style, {
    cursor: "pointer",
    color: T.accent,
    marginBottom: "4px",
  }),
    (K.textContent = "Timeline"),
    F.appendChild(K);
  const P = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  P.setAttribute("width", "100%"),
    P.setAttribute("height", "60"),
    P.setAttribute("role", "img"),
    P.setAttribute("aria-label", "Resolver execution timeline"),
    (P.style.display = "block"),
    P.setAttribute("viewBox", `0 0 ${Re} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Re / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", T.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", T.font),
    (y.textContent = "No resolver activity yet"),
    P.appendChild(y),
    F.appendChild(P),
    h.appendChild(F);
  let C, r, n, l;
  if (i) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const V = document.createElement("summary");
    Object.assign(V.style, {
      cursor: "pointer",
      color: T.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (V.textContent = "Events ("),
      V.appendChild(n),
      V.appendChild(document.createTextNode(")")),
      G.appendChild(V),
      (r = document.createElement("div")),
      Object.assign(r.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      r.setAttribute("role", "log"),
      r.setAttribute("aria-live", "polite"),
      (r.tabIndex = 0);
    const J = document.createElement("div");
    (J.style.color = T.muted),
      (J.style.padding = "4px"),
      (J.textContent = "Waiting for events..."),
      (J.className = "dt-events-empty"),
      r.appendChild(J),
      G.appendChild(r),
      h.appendChild(G),
      (C = G),
      (l = document.createElement("div"));
  } else
    (C = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (l = document.createElement("div")),
      (l.style.fontSize = "10px"),
      (l.style.color = T.muted),
      (l.style.marginTop = "4px"),
      (l.style.fontStyle = "italic"),
      (l.textContent = "Enable trace: true for event log"),
      h.appendChild(l);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
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
    g.appendChild(S),
    g.appendChild(M),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (G) => {
        const V = h,
          J = V.scrollTop === 0 && G.deltaY < 0,
          oe = V.scrollTop + V.clientHeight >= V.scrollHeight && G.deltaY > 0;
        (J || oe) && G.preventDefault();
      },
      { passive: !1 },
    );
  let L = a,
    W = new Set();
  function B() {
    (L = !0),
      (h.style.display = "block"),
      (d.style.display = "none"),
      d.setAttribute("aria-expanded", "true"),
      x.focus();
  }
  function U() {
    (L = !1),
      (h.style.display = "none"),
      (d.style.display = "block"),
      d.setAttribute("aria-expanded", "false"),
      d.focus();
  }
  d.addEventListener("click", B), x.addEventListener("click", U);
  function Y(G) {
    G.key === "Escape" && L && U();
  }
  h.addEventListener("keydown", Y);
  function te(G) {
    G.key === "d" &&
      G.shiftKey &&
      (G.ctrlKey || G.metaKey) &&
      (G.preventDefault(), L ? U() : B());
  }
  document.addEventListener("keydown", te);
  function Z() {
    o || (document.body.appendChild(d), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function X() {
    (o = !0),
      d.removeEventListener("click", B),
      x.removeEventListener("click", U),
      h.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", te),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const G of W) clearTimeout(G);
    W.clear(), d.remove(), h.remove(), u.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: d,
      titleEl: c,
      statusEl: A,
      factsBody: m.tbody,
      factsCount: m.countSpan,
      derivBody: E.tbody,
      derivCount: E.countSpan,
      derivSection: E.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: $.list,
      unmetSection: $.details,
      unmetCount: $.countSpan,
      perfSection: R,
      perfBody: f,
      timeTravelSection: j,
      timeTravelLabel: O,
      undoBtn: D,
      redoBtn: k,
      flowSection: b,
      flowSvg: q,
      timelineSection: F,
      timelineSvg: P,
      eventsSection: C,
      eventsList: r,
      eventsCount: n,
      traceHint: l,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: X,
    isOpen: () => L,
    flashTimers: W,
  };
}
function $e(e, t, a, i, o, s) {
  let u = at(i),
    d = e.get(a);
  if (d) {
    const h = d.cells;
    if (h[1] && ((h[1].textContent = u), o && s)) {
      const p = h[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (p.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (d = document.createElement("tr")),
      (d.style.borderBottom = `1px solid ${T.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: T.muted }),
      (h.textContent = a);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = u),
      d.appendChild(h),
      d.appendChild(p),
      t.appendChild(d),
      e.set(a, d);
  }
}
function Zt(e, t) {
  const a = e.get(t);
  a && (a.remove(), e.delete(t));
}
function Oe(e, t, a) {
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
    (e.unmetCount.textContent = String(a.length)),
    a.length > 0)
  )
    for (const i of a) {
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
function je(e, t, a) {
  const i = t === 0 && a === 0;
  (e.statusEl.style.color = i ? T.green : T.yellow),
    (e.statusEl.textContent = i ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = i ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${i ? "" : " (system working)"}`,
    );
}
function tt(e, t, a, i) {
  const o = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(o.length)), o.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      d = document.createElement("td");
    (d.colSpan = 2),
      (d.style.color = T.muted),
      (d.style.fontSize = "10px"),
      (d.textContent = "No derivations defined"),
      u.appendChild(d),
      e.derivBody.appendChild(u);
    return;
  }
  const s = new Set(o);
  for (const [u, d] of t) s.has(u) || (d.remove(), t.delete(u));
  for (const u of o) {
    let d;
    try {
      d = at(a.read(u));
    } catch {
      d = "<error>";
    }
    $e(t, e.derivBody, u, d, !0, i);
  }
}
function er(e, t, a, i) {
  const o = e.eventsList.querySelector(".dt-events-empty");
  o && o.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${T.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    d = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const I = JSON.stringify(a);
    h = fe(I, 60);
  } catch {
    h = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = T.closeBtn), (p.textContent = d);
  const c = document.createElement("span");
  (c.style.color = T.accent), (c.textContent = ` ${t} `);
  const x = document.createElement("span");
  for (
    x.style.color = T.muted,
      x.textContent = h,
      s.appendChild(p),
      s.appendChild(c),
      s.appendChild(x),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > Xt;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(i);
}
function tr(e, t) {
  e.perfBody.replaceChildren();
  const a =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    i = [
      `Reconciles: ${t.reconcileCount}  (avg ${a}ms)`,
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
      (u, d) => d[1].totalMs - u[1].totalMs,
    );
    for (const [u, d] of s) {
      const h = d.count > 0 ? (d.totalMs / d.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${u}: ${d.count}x, avg ${h}ms${d.errors > 0 ? `, ${d.errors} err` : ""}`),
        d.errors > 0 && (p.style.color = T.red),
        e.perfBody.appendChild(p);
    }
  }
}
function rt(e, t) {
  const a = t.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const i = a.currentIndex,
    o = a.snapshots.length;
  e.timeTravelLabel.textContent = o > 0 ? `${i + 1} / ${o}` : "0 snapshots";
  const s = i > 0,
    u = i < o - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function rr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var De = new WeakMap();
function nr(e, t, a, i, o, s) {
  return [
    e.join(","),
    t.join(","),
    a.map((u) => `${u.id}:${u.active}`).join(","),
    [...i.entries()].map(([u, d]) => `${u}:${d.status}:${d.type}`).join(","),
    o.join(","),
    s.join(","),
  ].join("|");
}
function ir(e, t, a, i, o) {
  for (const s of a) {
    const u = e.nodes.get(`0:${s}`);
    if (!u) continue;
    const d = t.recentlyChangedFacts.has(s);
    u.rect.setAttribute("fill", d ? T.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of i) {
    const u = e.nodes.get(`1:${s}`);
    if (!u) continue;
    const d = t.recentlyComputedDerivations.has(s);
    u.rect.setAttribute("fill", d ? T.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of o) {
    const u = e.nodes.get(`2:${s}`);
    if (!u) continue;
    const d = t.recentlyActiveConstraints.has(s),
      h = u.rect.getAttribute("stroke") ?? T.muted;
    u.rect.setAttribute("fill", d ? h + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
}
function nt(e, t, a) {
  const i = Ee(t);
  if (!i) return;
  let o;
  try {
    o = Object.keys(t.facts.$store.toObject());
  } catch {
    o = [];
  }
  const s = Object.keys(t.derive),
    u = i.constraints,
    d = i.unmet,
    h = i.inflight,
    p = Object.keys(i.resolvers),
    c = new Map();
  for (const y of d)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (o.length === 0 && s.length === 0 && u.length === 0 && p.length === 0) {
    De.delete(e.flowSvg),
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
  const x = h.map((y) => y.resolverId).sort(),
    I = nr(o, s, u, c, p, x),
    A = De.get(e.flowSvg);
  if (A && A.fingerprint === I) {
    ir(
      A,
      a,
      o,
      s,
      u.map((y) => y.id),
    );
    return;
  }
  const j = Q.nodeW + Q.colGap,
    D = [5, 5 + j, 5 + j * 2, 5 + j * 3, 5 + j * 4],
    k = D[4] + Q.nodeW + 5;
  function O(y) {
    let C = Q.startY + 12;
    return y.map((r) => {
      const n = { ...r, y: C };
      return (C += Q.nodeH + Q.nodeGap), n;
    });
  }
  const N = O(o.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    _ = O(s.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    m = O(
      u.map((y) => ({
        id: y.id,
        label: fe(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    E = O(
      [...c.entries()].map(([y, C]) => ({
        id: y,
        type: C.type,
        fromConstraint: C.fromConstraint,
        status: C.status,
      })),
    ),
    v = O(p.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    $ = Math.max(N.length, _.length, m.length, E.length, v.length, 1),
    R = Q.startY + 12 + $ * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${o.length} facts, ${s.length} derivations, ${u.length} constraints, ${c.size} requirements, ${p.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, C] of z.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(D[y] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", T.accent),
      r.setAttribute("font-size", String(Q.fontSize)),
      r.setAttribute("font-family", T.font),
      (r.textContent = C),
      e.flowSvg.appendChild(r);
  }
  const f = { fingerprint: I, nodes: new Map() };
  function b(y, C, r, n, l, g, S, M) {
    const L = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(C)),
      W.setAttribute("y", String(r - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      L.appendChild(W);
    const B = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      B.setAttribute("x", String(C + 4)),
      B.setAttribute("y", String(r + 4)),
      B.setAttribute("fill", g),
      B.setAttribute("font-size", String(Q.fontSize)),
      B.setAttribute("font-family", T.font),
      B.setAttribute("opacity", S ? "0.35" : "1"),
      (B.textContent = l),
      L.appendChild(B),
      e.flowSvg.appendChild(L),
      f.nodes.set(`${y}:${n}`, { g: L, rect: W, text: B }),
      { midX: C + Q.nodeW / 2, midY: r }
    );
  }
  function w(y, C, r, n, l, g) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(C)),
      S.setAttribute("x2", String(r)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", l),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const q = new Map(),
    F = new Map(),
    K = new Map(),
    P = new Map();
  for (const y of N) {
    const C = a.recentlyChangedFacts.has(y.id),
      r = b(0, D[0], y.y, y.id, y.label, T.text, !1, C);
    q.set(y.id, r);
  }
  for (const y of _) {
    const C = a.recentlyComputedDerivations.has(y.id),
      r = b(1, D[1], y.y, y.id, y.label, T.accent, !1, C);
    F.set(y.id, r);
  }
  for (const y of m) {
    const C = a.recentlyActiveConstraints.has(y.id),
      r = b(
        2,
        D[2],
        y.y,
        y.id,
        y.label,
        y.active ? T.yellow : T.muted,
        !y.active,
        C,
      );
    K.set(y.id, r);
  }
  for (const y of E) {
    const C = y.status === "unmet" ? T.red : T.yellow,
      r = b(3, D[3], y.y, y.id, fe(y.type, Q.labelMaxChars), C, !1, !1);
    P.set(y.id, r);
  }
  for (const y of v) {
    const C = h.some((r) => r.resolverId === y.id);
    b(4, D[4], y.y, y.id, y.label, C ? T.green : T.muted, !C, !1);
  }
  for (const y of _) {
    const C = a.derivationDeps.get(y.id),
      r = F.get(y.id);
    if (C && r)
      for (const n of C) {
        const l = q.get(n);
        l &&
          w(
            l.midX + Q.nodeW / 2,
            l.midY,
            r.midX - Q.nodeW / 2,
            r.midY,
            T.accent,
          );
      }
  }
  for (const y of E) {
    const C = K.get(y.fromConstraint),
      r = P.get(y.id);
    C &&
      r &&
      w(C.midX + Q.nodeW / 2, C.midY, r.midX - Q.nodeW / 2, r.midY, T.muted);
  }
  for (const y of h) {
    const C = P.get(y.id);
    if (C) {
      const r = v.find((n) => n.id === y.resolverId);
      r && w(C.midX + Q.nodeW / 2, C.midY, D[4], r.y, T.green);
    }
  }
  De.set(e.flowSvg, f);
}
function or(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function sr(e, t) {
  const a = t.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let i = 1 / 0,
    o = -1 / 0;
  for (const A of a)
    A.startMs < i && (i = A.startMs), A.endMs > o && (o = A.endMs);
  const s = performance.now();
  for (const A of t.inflight.values()) A < i && (i = A), s > o && (o = s);
  const u = o - i || 1,
    d = Re - ge - 10,
    h = [],
    p = new Set();
  for (const A of a)
    p.has(A.resolver) || (p.add(A.resolver), h.push(A.resolver));
  for (const A of t.inflight.keys()) p.has(A) || (p.add(A), h.push(A));
  const c = h.slice(-12),
    x = me * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Re} ${x}`),
    e.timelineSvg.setAttribute("height", String(Math.min(x, 200)));
  const I = 5;
  for (let A = 0; A <= I; A++) {
    const j = ge + (d * A) / I,
      D = (u * A) / I,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(j)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", T.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", T.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        D < 1e3 ? `${D.toFixed(0)}ms` : `${(D / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "line");
    O.setAttribute("x1", String(j)),
      O.setAttribute("y1", "10"),
      O.setAttribute("x2", String(j)),
      O.setAttribute("y2", String(x)),
      O.setAttribute("stroke", T.border),
      O.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(O);
  }
  for (let A = 0; A < c.length; A++) {
    const j = c[A],
      D = 12 + A * me,
      k = A % Ze.length,
      O = Ze[k],
      N = document.createElementNS("http://www.w3.org/2000/svg", "text");
    N.setAttribute("x", String(ge - 4)),
      N.setAttribute("y", String(D + me / 2 + 3)),
      N.setAttribute("fill", T.muted),
      N.setAttribute("font-size", "7"),
      N.setAttribute("font-family", T.font),
      N.setAttribute("text-anchor", "end"),
      (N.textContent = fe(j, 12)),
      e.timelineSvg.appendChild(N);
    const _ = a.filter((E) => E.resolver === j);
    for (const E of _) {
      const v = ge + ((E.startMs - i) / u) * d,
        $ = Math.max(((E.endMs - E.startMs) / u) * d, Qe),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(D + 2)),
        R.setAttribute("width", String($)),
        R.setAttribute("height", String(me - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", E.error ? T.red : O),
        R.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = E.endMs - E.startMs;
      (z.textContent = `${j}: ${f.toFixed(1)}ms${E.error ? " (error)" : ""}`),
        R.appendChild(z),
        e.timelineSvg.appendChild(R);
    }
    const m = t.inflight.get(j);
    if (m !== void 0) {
      const E = ge + ((m - i) / u) * d,
        v = Math.max(((s - m) / u) * d, Qe),
        $ = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      $.setAttribute("x", String(E)),
        $.setAttribute("y", String(D + 2)),
        $.setAttribute("width", String(v)),
        $.setAttribute("height", String(me - 4)),
        $.setAttribute("rx", "2"),
        $.setAttribute("fill", O),
        $.setAttribute("opacity", "0.4"),
        $.setAttribute("stroke", O),
        $.setAttribute("stroke-width", "1"),
        $.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${j}: inflight ${(s - m).toFixed(0)}ms`),
        $.appendChild(R),
        e.timelineSvg.appendChild($);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${c.length} resolvers`,
  );
}
function lr() {
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
        getSystem(a) {
          return a
            ? (e.get(a)?.system ?? null)
            : (e.values().next().value?.system ?? null);
        },
        getSystems() {
          return [...e.keys()];
        },
        inspect(a) {
          return this.getSystem(a)?.inspect() ?? null;
        },
        getEvents(a) {
          return a
            ? (e.get(a)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(a, i) {
          return this.getSystem(i)?.explain(a) ?? null;
        },
        subscribe(a, i) {
          const o = i ? e.get(i) : e.values().next().value;
          if (!o) {
            let s = !1,
              u = setInterval(() => {
                const h = i ? e.get(i) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              d = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(d);
              for (const h of e.values()) h.subscribers.delete(a);
            };
          }
          return (
            o.subscribers.add(a),
            () => {
              o.subscribers.delete(a);
            }
          );
        },
        exportSession(a) {
          const i = a ? e.get(a) : e.values().next().value;
          return i
            ? JSON.stringify({
                version: 1,
                name: a ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: i.events.toArray(),
              })
            : null;
        },
        importSession(a, i) {
          try {
            if (a.length > 10 * 1024 * 1024) return !1;
            const o = JSON.parse(a);
            if (
              !o ||
              typeof o != "object" ||
              Array.isArray(o) ||
              !Array.isArray(o.events)
            )
              return !1;
            const s = i ? e.get(i) : e.values().next().value;
            if (!s) return !1;
            const u = s.maxEvents,
              d = o.events,
              h = d.length > u ? d.length - u : 0;
            s.events.clear();
            for (let p = h; p < d.length; p++) {
              const c = d[p];
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
        clearEvents(a) {
          const i = a ? e.get(a) : e.values().next().value;
          i && i.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Be(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function ar(e = {}) {
  const {
      name: t = "default",
      trace: a = !1,
      maxEvents: i,
      panel: o = !1,
      position: s = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    d = Wt(i),
    h = lr(),
    p = {
      system: null,
      events: new lt(d),
      maxEvents: d,
      subscribers: new Set(),
    };
  h.systems.set(t, p);
  let c = (n, l) => {
      const g = { timestamp: Date.now(), type: n, data: l };
      a && p.events.push(g);
      for (const S of p.subscribers)
        try {
          S(g);
        } catch {}
    },
    x = null,
    I = new Map(),
    A = new Map(),
    j = Kt(),
    D = Ut(),
    k = Jt(),
    O = Gt(),
    N = o && typeof window < "u" && typeof document < "u" && Be(),
    _ = null,
    m = 0,
    E = 1,
    v = 2,
    $ = 4,
    R = 8,
    z = 16,
    f = 32,
    b = 64,
    w = 128,
    q = new Map(),
    F = new Set(),
    K = null;
  function P(n) {
    (m |= n),
      _ === null &&
        typeof requestAnimationFrame < "u" &&
        (_ = requestAnimationFrame(y));
  }
  function y() {
    if (((_ = null), !x || !p.system)) {
      m = 0;
      return;
    }
    const n = x.refs,
      l = p.system,
      g = m;
    if (((m = 0), g & E)) {
      for (const S of F) Zt(I, S);
      F.clear();
      for (const [S, { value: M, flash: L }] of q)
        $e(I, n.factsBody, S, M, L, x.flashTimers);
      q.clear(), (n.factsCount.textContent = String(I.size));
    }
    if ((g & v && tt(n, A, l, x.flashTimers), g & R))
      if (K) je(n, K.inflight.length, K.unmet.length);
      else {
        const S = Ee(l);
        S && je(n, S.inflight.length, S.unmet.length);
      }
    if (g & $)
      if (K) Oe(n, K.inflight, K.unmet);
      else {
        const S = Ee(l);
        S && Oe(n, S.inflight, S.unmet);
      }
    g & z && tr(n, j),
      g & f && nt(n, l, D),
      g & b && rt(n, l),
      g & w && sr(n, O);
  }
  function C(n, l) {
    x && a && er(x.refs, n, l, p.events.size);
  }
  function r(n, l) {
    k.isRecording &&
      k.recordedEvents.length < Vt &&
      k.recordedEvents.push({ timestamp: Date.now(), type: n, data: Ft(l) });
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
        N)
      ) {
        const l = p.system;
        x = Qt(t, s, u, a);
        const g = x.refs;
        try {
          const M = l.facts.$store.toObject();
          for (const [L, W] of Object.entries(M)) $e(I, g.factsBody, L, W, !1);
          g.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        tt(g, A, l);
        const S = Ee(l);
        S &&
          (je(g, S.inflight.length, S.unmet.length),
          Oe(g, S.inflight, S.unmet)),
          rt(g, l),
          rr(g, l),
          nt(g, l, D),
          g.recordBtn.addEventListener("click", () => {
            if (
              ((k.isRecording = !k.isRecording),
              (g.recordBtn.textContent = k.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = k.isRecording ? T.red : T.text),
              k.isRecording)
            ) {
              (k.recordedEvents = []), (k.snapshots = []);
              try {
                k.snapshots.push({
                  timestamp: Date.now(),
                  facts: l.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          g.exportBtn.addEventListener("click", () => {
            const M =
                k.recordedEvents.length > 0
                  ? k.recordedEvents
                  : p.events.toArray(),
              L = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: M,
                  snapshots: k.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([L], { type: "application/json" }),
              B = URL.createObjectURL(W),
              U = document.createElement("a");
            (U.href = B),
              (U.download = `directive-session-${t}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(B);
          });
      }
    },
    onStart: (n) => {
      c("start", {}), C("start", {}), r("start", {});
    },
    onStop: (n) => {
      c("stop", {}), C("stop", {}), r("stop", {});
    },
    onDestroy: (n) => {
      c("destroy", {}),
        h.systems.delete(t),
        _ !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(_), (_ = null)),
        D.animationTimer && clearTimeout(D.animationTimer),
        x && (x.destroy(), (x = null), I.clear(), A.clear());
    },
    onFactSet: (n, l, g) => {
      c("fact.set", { key: n, value: l, prev: g }),
        r("fact.set", { key: n, value: l, prev: g }),
        D.recentlyChangedFacts.add(n),
        x &&
          p.system &&
          (q.set(n, { value: l, flash: !0 }),
          F.delete(n),
          P(E),
          C("fact.set", { key: n, value: l }));
    },
    onFactDelete: (n, l) => {
      c("fact.delete", { key: n, prev: l }),
        r("fact.delete", { key: n, prev: l }),
        x && (F.add(n), q.delete(n), P(E), C("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        x && p.system)
      ) {
        for (const l of n)
          l.type === "delete"
            ? (F.add(l.key), q.delete(l.key))
            : (D.recentlyChangedFacts.add(l.key),
              q.set(l.key, { value: l.value, flash: !0 }),
              F.delete(l.key));
        P(E), C("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, l, g) => {
      c("derivation.compute", { id: n, value: l, deps: g }),
        r("derivation.compute", { id: n, deps: g }),
        D.derivationDeps.set(n, g),
        D.recentlyComputedDerivations.add(n),
        C("derivation.compute", { id: n, deps: g });
    },
    onDerivationInvalidate: (n) => {
      c("derivation.invalidate", { id: n }),
        C("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      c("reconcile.start", {}),
        (j.lastReconcileStartMs = performance.now()),
        C("reconcile.start", {}),
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
        j.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - j.lastReconcileStartMs;
        j.reconcileCount++,
          (j.reconcileTotalMs += l),
          (j.lastReconcileStartMs = 0);
      }
      if (k.isRecording && p.system && k.snapshots.length < Yt)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      x &&
        p.system &&
        ((K = n),
        or(D),
        P(v | R | $ | z | f | b),
        C("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, l) => {
      c("constraint.evaluate", { id: n, active: l }),
        r("constraint.evaluate", { id: n, active: l }),
        l
          ? (D.activeConstraints.add(n), D.recentlyActiveConstraints.add(n))
          : D.activeConstraints.delete(n),
        C("constraint.evaluate", { id: n, active: l });
    },
    onConstraintError: (n, l) => {
      c("constraint.error", { id: n, error: String(l) }),
        C("constraint.error", { id: n, error: String(l) });
    },
    onRequirementCreated: (n) => {
      c("requirement.created", { id: n.id, type: n.requirement.type }),
        r("requirement.created", { id: n.id, type: n.requirement.type }),
        C("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, l) => {
      c("requirement.met", { id: n.id, byResolver: l }),
        r("requirement.met", { id: n.id, byResolver: l }),
        C("requirement.met", { id: n.id, byResolver: l });
    },
    onRequirementCanceled: (n) => {
      c("requirement.canceled", { id: n.id }),
        r("requirement.canceled", { id: n.id }),
        C("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, l) => {
      c("resolver.start", { resolver: n, requirementId: l.id }),
        r("resolver.start", { resolver: n, requirementId: l.id }),
        O.inflight.set(n, performance.now()),
        x &&
          p.system &&
          (P($ | R | w),
          C("resolver.start", { resolver: n, requirementId: l.id }));
    },
    onResolverComplete: (n, l, g) => {
      c("resolver.complete", { resolver: n, requirementId: l.id, duration: g }),
        r("resolver.complete", {
          resolver: n,
          requirementId: l.id,
          duration: g,
        });
      const S = j.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += g),
        j.resolverStats.set(n, S),
        j.resolverStats.size > et)
      ) {
        const L = j.resolverStats.keys().next().value;
        L !== void 0 && j.resolverStats.delete(L);
      }
      const M = O.inflight.get(n);
      O.inflight.delete(n),
        M !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        x &&
          p.system &&
          (P($ | R | z | w),
          C("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, l, g) => {
      c("resolver.error", {
        resolver: n,
        requirementId: l.id,
        error: String(g),
      }),
        r("resolver.error", {
          resolver: n,
          requirementId: l.id,
          error: String(g),
        });
      const S = j.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, j.resolverStats.set(n, S), j.resolverStats.size > et)) {
        const L = j.resolverStats.keys().next().value;
        L !== void 0 && j.resolverStats.delete(L);
      }
      const M = O.inflight.get(n);
      O.inflight.delete(n),
        M !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        x &&
          p.system &&
          (P($ | R | z | w),
          C("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, l, g) => {
      c("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        r("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        C("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, l) => {
      c("resolver.cancel", { resolver: n, requirementId: l.id }),
        r("resolver.cancel", { resolver: n, requirementId: l.id }),
        O.inflight.delete(n),
        C("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        r("effect.run", { id: n }),
        j.effectRunCount++,
        C("effect.run", { id: n });
    },
    onEffectError: (n, l) => {
      c("effect.error", { id: n, error: String(l) }),
        j.effectErrorCount++,
        C("effect.error", { id: n, error: String(l) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        x && p.system && P(b),
        C("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, l) => {
      if (
        (c("timetravel.jump", { from: n, to: l }),
        r("timetravel.jump", { from: n, to: l }),
        x && p.system)
      ) {
        const g = p.system;
        try {
          const S = g.facts.$store.toObject();
          I.clear(), x.refs.factsBody.replaceChildren();
          for (const [M, L] of Object.entries(S))
            $e(I, x.refs.factsBody, M, L, !1);
          x.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        A.clear(),
          D.derivationDeps.clear(),
          x.refs.derivBody.replaceChildren(),
          (K = null),
          P(v | R | $ | f | b),
          C("timetravel.jump", { from: n, to: l });
      }
    },
    onError: (n) => {
      c("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        r("error", { source: n.source, message: n.message }),
        C("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, l) => {
      c("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: l,
      }),
        C("error.recovery", { source: n.source, strategy: l });
    },
  };
}
const cr = [
  { pattern: /recipe|cooking|food|bake|ingredient/i, category: "cooking" },
  {
    pattern: /politic|election|vote|democrat|republican/i,
    category: "politics",
  },
  {
    pattern: /sport|game score|nfl|nba|mlb|soccer|football score/i,
    category: "sports",
  },
];
function ur(e) {
  for (const { pattern: t, category: a } of cr)
    if (t.test(e))
      return {
        blocked: !0,
        guardrailName: "keyword",
        reason: `Matched off-topic category: ${a}`,
      };
  return {
    blocked: !1,
    guardrailName: "keyword",
    reason: "No off-topic keywords detected",
  };
}
const dr = {
  product: /product|feature|plan|upgrade|downgrade|pricing/i,
  billing: /bill|invoice|charge|payment|subscription|refund/i,
  support: /help|issue|problem|broken|error|bug|fix|reset|password/i,
  technical: /api|integrate|sdk|webhook|endpoint|config/i,
};
function fr(e, t) {
  for (const a of t) {
    const i = dr[a];
    if (i && i.test(e))
      return {
        blocked: !1,
        guardrailName: "classifier",
        reason: `Matched allowed topic: ${a}`,
      };
  }
  return /^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(e.trim())
    ? {
        blocked: !1,
        guardrailName: "classifier",
        reason: "Greeting or acknowledgment — allowed",
      }
    : {
        blocked: !0,
        guardrailName: "classifier",
        reason: "No allowed topic detected in input",
      };
}
const pr = [
  {
    pattern: /password|reset/i,
    response:
      "To reset your password, go to Settings > Security > Reset Password. You'll receive a confirmation email.",
  },
  {
    pattern: /bill|invoice|charge|payment/i,
    response:
      "You can view your billing history at Settings > Billing. For refund requests, please include your invoice number.",
  },
  {
    pattern: /pricing|plan|upgrade/i,
    response:
      "We offer Free, Pro ($29/mo), and Enterprise plans. Visit our pricing page for a full comparison.",
  },
  {
    pattern: /api|sdk|webhook|endpoint/i,
    response:
      "Our API docs are at docs.example.com/api. Rate limits are 1000 req/min on Pro, 10000 on Enterprise.",
  },
  {
    pattern: /bug|error|broken|issue/i,
    response:
      "I'm sorry to hear that! Could you share the error message? In the meantime, try clearing your cache and refreshing.",
  },
  {
    pattern: /feature|request/i,
    response:
      "Thanks for the suggestion! I've logged this as a feature request. Our product team reviews these weekly.",
  },
  {
    pattern: /refund/i,
    response:
      "Refund requests are processed within 5-7 business days. Please provide your invoice number and I'll start the process.",
  },
  {
    pattern: /cancel|subscription/i,
    response:
      "To cancel your subscription, go to Settings > Billing > Cancel Plan. Your access continues until the end of the billing period.",
  },
];
function mr(e) {
  for (const { pattern: t, response: a } of pr) if (t.test(e)) return a;
  return "I'd be happy to help! Could you tell me more about what you need assistance with? I can help with billing, account settings, technical questions, and more.";
}
const _e = {
    facts: {
      input: ie.string(),
      messages: ie.object(),
      isProcessing: ie.boolean(),
      lastGuardrailResult: ie.object(),
      guardrailLog: ie.object(),
      allowedTopics: ie.object(),
    },
    derivations: {
      messageCount: ie.number(),
      blockedCount: ie.number(),
      allowedCount: ie.number(),
      blockRate: ie.string(),
      canSend: ie.boolean(),
      lastMessageBlocked: ie.boolean(),
    },
    events: {
      send: {},
      clear: {},
      setInput: { value: ie.string() },
      toggleTopic: { topic: ie.string() },
    },
    requirements: {
      BLOCK_MESSAGE: { reason: ie.string(), guardrailName: ie.string() },
      ALLOW_MESSAGE: {},
    },
  },
  gr = St("topic-guard", {
    schema: _e,
    init: (e) => {
      (e.input = ""),
        (e.messages = []),
        (e.isProcessing = !1),
        (e.lastGuardrailResult = null),
        (e.guardrailLog = []),
        (e.allowedTopics = ["product", "billing", "support", "technical"]);
    },
    derive: {
      messageCount: (e) => e.messages.filter((t) => t.role === "user").length,
      blockedCount: (e) =>
        e.messages.filter((t) => t.role === "user" && t.blocked).length,
      allowedCount: (e) =>
        e.messages.filter((t) => t.role === "user" && !t.blocked).length,
      blockRate: (e, t) => {
        const a = t.messageCount;
        if (a === 0) return "0%";
        const i = t.blockedCount;
        return `${Math.round((i / a) * 100)}%`;
      },
      canSend: (e) => e.input.trim().length > 0 && !e.isProcessing,
      lastMessageBlocked: (e) => {
        const t = e.messages;
        return t.length === 0 ? !1 : t[t.length - 1].blocked;
      },
    },
    events: {
      send: (e) => {
        const t = e.input.trim();
        if (t.length === 0 || e.isProcessing) return;
        const a = [...e.messages];
        a.push({ role: "user", text: t, blocked: !1 }), (e.messages = a);
        const i = ur(t);
        if (i.blocked) {
          (e.lastGuardrailResult = i), (e.isProcessing = !0), (e.input = "");
          return;
        }
        const o = fr(t, e.allowedTopics);
        (e.lastGuardrailResult = o), (e.isProcessing = !0), (e.input = "");
      },
      clear: (e) => {
        (e.messages = []),
          (e.guardrailLog = []),
          (e.lastGuardrailResult = null),
          (e.isProcessing = !1);
      },
      setInput: (e, { value: t }) => {
        e.input = t;
      },
      toggleTopic: (e, { topic: t }) => {
        const a = [...e.allowedTopics],
          i = a.indexOf(t);
        i >= 0 ? a.splice(i, 1) : a.push(t), (e.allowedTopics = a);
      },
    },
    constraints: {
      offTopicDetected: {
        priority: 100,
        when: (e) => e.lastGuardrailResult?.blocked === !0 && e.isProcessing,
        require: (e) => {
          const t = e.lastGuardrailResult;
          return {
            type: "BLOCK_MESSAGE",
            reason: t.reason,
            guardrailName: t.guardrailName,
          };
        },
      },
      onTopicConfirmed: {
        priority: 90,
        when: (e) => e.lastGuardrailResult?.blocked === !1 && e.isProcessing,
        require: () => ({ type: "ALLOW_MESSAGE" }),
      },
    },
    resolvers: {
      blockMessage: {
        requirement: "BLOCK_MESSAGE",
        resolve: async (e, t) => {
          const a = [...t.facts.messages],
            i = a.length - 1;
          i >= 0 &&
            (a[i] = { ...a[i], blocked: !0, guardrail: e.guardrailName }),
            a.push({
              role: "system",
              text: "I can only help with product-related questions.",
              blocked: !0,
              guardrail: e.guardrailName,
            }),
            (t.facts.messages = a),
            (t.facts.isProcessing = !1);
        },
      },
      allowMessage: {
        requirement: "ALLOW_MESSAGE",
        resolve: async (e, t) => {
          const a = [...t.facts.messages],
            i = a.filter((s) => s.role === "user").pop(),
            o = mr(i?.text ?? "");
          a.push({ role: "agent", text: o, blocked: !1 }),
            (t.facts.messages = a),
            (t.facts.isProcessing = !1);
        },
      },
    },
    effects: {
      logGuardrailResult: {
        deps: ["lastGuardrailResult"],
        run: (e) => {
          const t = e.lastGuardrailResult;
          if (!t) return;
          const i = [...e.messages].reverse().find((s) => s.role === "user"),
            o = [...e.guardrailLog];
          o.push({ timestamp: Date.now(), input: i?.text ?? "", result: t }),
            (e.guardrailLog = o);
        },
      },
    },
  }),
  ae = Bt({ module: gr, plugins: [ar({ name: "topic-guard" })] });
ae.start();
const hr = [...Object.keys(_e.facts), ...Object.keys(_e.derivations)],
  we = document.getElementById("topic-guard-input"),
  ct = document.getElementById("topic-guard-send"),
  yr = document.getElementById("topic-guard-clear"),
  he = document.getElementById("topic-guard-messages"),
  Me = document.getElementById("topic-guard-log"),
  vr = document.getElementById("topic-guard-allowed-count"),
  br = document.getElementById("topic-guard-blocked-count"),
  wr = document.getElementById("topic-guard-block-rate"),
  ut = document.getElementById("topic-guard-topics");
function dt() {
  const e = ae.facts,
    t = ae.derive,
    a = e.messages,
    i = e.guardrailLog,
    o = t.canSend,
    s = t.blockedCount,
    u = t.allowedCount,
    d = t.blockRate;
  if (
    ((ct.disabled = !o),
    (vr.textContent = String(u)),
    (br.textContent = String(s)),
    (wr.textContent = d),
    a.length === 0
      ? (he.innerHTML =
          '<div class="tg-empty-state">Send a message to see guardrails in action</div>')
      : ((he.innerHTML = ""),
        a.forEach((c, x) => {
          const I = document.createElement("div");
          (I.className = `tg-message ${c.role}`),
            c.blocked && I.classList.add("blocked"),
            (I.dataset.testid = `topic-guard-message-${x}`);
          let A = ye(c.text);
          c.blocked &&
            c.guardrail &&
            (A += `<div class="tg-guardrail-badge">${ye(c.guardrail)} guardrail</div>`),
            (I.innerHTML = A),
            he.appendChild(I);
        }),
        (he.scrollTop = he.scrollHeight)),
    i.length === 0)
  )
    Me.innerHTML =
      '<div class="tg-log-empty">No guardrail evaluations yet</div>';
  else {
    Me.innerHTML = "";
    for (let c = i.length - 1; c >= 0; c--) {
      const x = i[c],
        I = document.createElement("div");
      I.className = `tg-log-entry ${x.result.blocked ? "blocked" : "allowed"}`;
      const j = new Date(x.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (I.innerHTML = `
        <div class="tg-log-time">${j}</div>
        <span class="tg-log-input">${ye(Sr(x.input, 40))}</span>
        <span class="tg-log-result ${x.result.blocked ? "blocked" : "allowed"}">
          ${x.result.blocked ? "✕ Blocked" : "✓ Allowed"}
        </span>
        <span class="tg-log-guardrail">${ye(x.result.guardrailName)} &mdash; ${ye(x.result.reason)}</span>
      `),
        Me.appendChild(I);
    }
  }
  const h = e.allowedTopics;
  ut.querySelectorAll("input[data-topic]").forEach((c) => {
    c.checked = h.includes(c.dataset.topic);
  });
}
ae.subscribe(hr, dt);
function ft() {
  ae.derive.canSend && ae.events.send();
}
ct.addEventListener("click", ft);
we.addEventListener("keydown", (e) => {
  e.key === "Enter" && (e.preventDefault(), ft());
});
we.addEventListener("input", () => {
  ae.events.setInput({ value: we.value });
});
yr.addEventListener("click", () => {
  ae.events.clear();
});
document.querySelectorAll(".tg-chip[data-example]").forEach((e) => {
  e.addEventListener("click", () => {
    const t = e.dataset.example;
    (we.value = t), ae.events.setInput({ value: t }), we.focus();
  });
});
ut.addEventListener("change", (e) => {
  const t = e.target;
  t.dataset.topic && ae.events.toggleTopic({ topic: t.dataset.topic });
});
function ye(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function Sr(e, t) {
  return e.length <= t ? e : e.slice(0, t) + "...";
}
dt();
document.body.setAttribute("data-topic-guard-ready", "true");
