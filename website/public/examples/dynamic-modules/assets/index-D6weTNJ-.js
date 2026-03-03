(() => {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) o(i);
  new MutationObserver((i) => {
    for (const s of i)
      if (s.type === "childList")
        for (const u of s.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && o(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function a(i) {
    const s = {};
    return (
      i.integrity && (s.integrity = i.integrity),
      i.referrerPolicy && (s.referrerPolicy = i.referrerPolicy),
      i.crossOrigin === "use-credentials"
        ? (s.credentials = "include")
        : i.crossOrigin === "anonymous"
          ? (s.credentials = "omit")
          : (s.credentials = "same-origin"),
      s
    );
  }
  function o(i) {
    if (i.ep) return;
    i.ep = !0;
    const s = a(i);
    fetch(i.href, s);
  }
})();
var Ve = class extends Error {
    constructor(r, a, o, i, s = !0) {
      super(r),
        (this.source = a),
        (this.sourceId = o),
        (this.context = i),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  me = [];
function Et() {
  const e = new Set();
  return {
    get isTracking() {
      return !0;
    },
    track(r) {
      e.add(r);
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
  return me[me.length - 1] ?? $t;
}
function Ce(e) {
  const r = Et();
  me.push(r);
  try {
    return { value: e(), deps: r.getDependencies() };
  } finally {
    me.pop();
  }
}
function Je(e) {
  const r = me.splice(0, me.length);
  try {
    return e();
  } finally {
    me.push(...r);
  }
}
function Te(e) {
  Ct().track(e);
}
function kt(e, r = 100) {
  try {
    return JSON.stringify(e)?.slice(0, r) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function ke(e = [], r, a, o, i, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: r,
    _default: a,
    _transform: o,
    _description: i,
    _refinements: s,
    validate(u) {
      return ke([...e, u], r, a, o, i, s);
    },
  };
}
function re(e, r, a, o, i, s) {
  return {
    ...ke(e, r, a, o, i, s),
    default(u) {
      return re(e, r, u, o, i, s);
    },
    transform(u) {
      return re(
        [],
        r,
        void 0,
        (d) => {
          const h = o ? o(d) : d;
          return u(h);
        },
        i,
      );
    },
    brand() {
      return re(e, `Branded<${r}>`, a, o, i, s);
    },
    describe(u) {
      return re(e, r, a, o, u, s);
    },
    refine(u, d) {
      const h = [...(s ?? []), { predicate: u, message: d }];
      return re([...e, u], r, a, o, i, h);
    },
    nullable() {
      return re(
        [(u) => u === null || e.every((d) => d(u))],
        `${r} | null`,
        a,
        o,
        i,
      );
    },
    optional() {
      return re(
        [(u) => u === void 0 || e.every((d) => d(u))],
        `${r} | undefined`,
        a,
        o,
        i,
      );
    },
  };
}
var te = {
  string() {
    return re([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (r, a, o, i, s) => ({
      ...re(r, "number", a, o, i, s),
      min(u) {
        return e([...r, (d) => d >= u], a, o, i, s);
      },
      max(u) {
        return e([...r, (d) => d <= u], a, o, i, s);
      },
      default(u) {
        return e(r, u, o, i, s);
      },
      describe(u) {
        return e(r, a, o, u, s);
      },
      refine(u, d) {
        const h = [...(s ?? []), { predicate: u, message: d }];
        return e([...r, u], a, o, i, h);
      },
    });
    return e([(r) => typeof r == "number"]);
  },
  boolean() {
    return re([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (r, a, o, i, s) => {
      const u = re(r, "array", o, void 0, i),
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
          const m = { value: -1 };
          return e(
            [
              ...r,
              (c) => {
                for (let E = 0; E < c.length; E++) {
                  const B = c[E];
                  if (!h._validators.every((O) => O(B)))
                    return (m.value = E), !1;
                }
                return !0;
              },
            ],
            h,
            o,
            i,
            m,
          );
        },
        nonEmpty() {
          return e([...r, (h) => h.length > 0], a, o, i, d);
        },
        maxLength(h) {
          return e([...r, (m) => m.length <= h], a, o, i, d);
        },
        minLength(h) {
          return e([...r, (m) => m.length >= h], a, o, i, d);
        },
        default(h) {
          return e(r, a, h, i, d);
        },
        describe(h) {
          return e(r, a, o, h, d);
        },
      };
    };
    return e([(r) => Array.isArray(r)]);
  },
  object() {
    const e = (r, a, o) => ({
      ...re(r, "object", a, void 0, o),
      shape(i) {
        return e(
          [
            ...r,
            (s) => {
              for (const [u, d] of Object.entries(i)) {
                const h = s[u],
                  m = d;
                if (m && !m._validators.every((c) => c(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          o,
        );
      },
      nonNull() {
        return e([...r, (i) => i != null], a, o);
      },
      hasKeys(...i) {
        return e([...r, (s) => i.every((u) => u in s)], a, o);
      },
      default(i) {
        return e(r, i, o);
      },
      describe(i) {
        return e(r, a, i);
      },
    });
    return e([(r) => typeof r == "object" && r !== null && !Array.isArray(r)]);
  },
  enum(...e) {
    const r = new Set(e);
    return re(
      [(a) => typeof a == "string" && r.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return re([(r) => r === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const r = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === null ? !0 : e._validators.every((o) => o(a)))],
      `${r} | null`,
    );
  },
  optional(e) {
    const r = e._typeName ?? "unknown";
    return ke(
      [(a) => (a === void 0 ? !0 : e._validators.every((o) => o(a)))],
      `${r} | undefined`,
    );
  },
  union(...e) {
    const r = e.map((a) => a._typeName ?? "unknown");
    return re(
      [(a) => e.some((o) => o._validators.every((i) => i(a)))],
      r.join(" | "),
    );
  },
  record(e) {
    const r = e._typeName ?? "unknown";
    return re(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((o) => e._validators.every((i) => i(o))),
      ],
      `Record<string, ${r}>`,
    );
  },
  tuple(...e) {
    const r = e.map((a) => a._typeName ?? "unknown");
    return re(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((o, i) => o._validators.every((s) => s(a[i]))),
      ],
      `[${r.join(", ")}]`,
    );
  },
  date() {
    return re([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return re([(r) => typeof r == "string" && e.test(r)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re([(r) => typeof r == "string" && e.test(r)], "email");
  },
  url() {
    return re(
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
    return re([(e) => typeof e == "bigint"], "bigint");
  },
};
function Rt(e) {
  const { schema: r, onChange: a, onBatch: o } = e;
  Object.keys(r).length;
  let i = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    d = new Map(),
    h = new Set(),
    m = new Map(),
    c = new Set(),
    E = 0,
    B = [],
    O = new Set(),
    M = !1,
    D = [],
    k = 100;
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
  function N(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (A(f)) {
      const w = f._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function T(f) {
    return u ? "[redacted]" : kt(f);
  }
  function p(f, b) {
    if (!i) return;
    const w = r[f];
    if (!w) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (A(w)) {
      const z = w.safeParse(b);
      if (!z.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          C = T(b),
          t =
            z.error?.message ??
            z.error?.issues?.[0]?.message ??
            "Validation failed",
          n = N(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${C}. ${t}`,
        );
      }
      return;
    }
    const I = w,
      P = I._validators;
    if (!P || !Array.isArray(P) || P.length === 0) return;
    const H = I._typeName ?? "unknown";
    for (let z = 0; z < P.length; z++) {
      const y = P[z];
      if (typeof y == "function" && !y(b)) {
        let C = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          t = T(b),
          n = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const l = z === 0 ? "" : ` (validator ${z + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${H}, got ${C} ${t}${l}${n}`,
        );
      }
    }
  }
  function x(f) {
    m.get(f)?.forEach((b) => b());
  }
  function v() {
    c.forEach((f) => f());
  }
  function $(f, b, w) {
    if (M) {
      D.push({ key: f, value: b, prev: w });
      return;
    }
    M = !0;
    try {
      a?.(f, b, w), x(f), v();
      let I = 0;
      while (D.length > 0) {
        if (++I > k)
          throw (
            ((D.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const P = [...D];
        D.length = 0;
        for (const H of P) a?.(H.key, H.value, H.prev), x(H.key);
        v();
      }
    } finally {
      M = !1;
    }
  }
  function R() {
    if (!(E > 0)) {
      if ((o && B.length > 0 && o([...B]), O.size > 0)) {
        M = !0;
        try {
          for (const b of O) x(b);
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
            for (const w of b) a?.(w.key, w.value, w.prev), x(w.key);
            v();
          }
        } finally {
          M = !1;
        }
      }
      (B.length = 0), O.clear();
    }
  }
  const L = {
    get(f) {
      return Te(f), d.get(f);
    },
    has(f) {
      return Te(f), d.has(f);
    },
    set(f, b) {
      p(f, b);
      const w = d.get(f);
      Object.is(w, b) ||
        (d.set(f, b),
        h.add(f),
        E > 0
          ? (B.push({ key: f, value: b, prev: w, type: "set" }), O.add(f))
          : $(f, b, w));
    },
    delete(f) {
      const b = d.get(f);
      d.delete(f),
        h.delete(f),
        E > 0
          ? (B.push({ key: f, value: void 0, prev: b, type: "delete" }),
            O.add(f))
          : $(f, void 0, b);
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
        const I = w;
        m.has(I) || m.set(I, new Set()), m.get(I).add(b);
      }
      return () => {
        for (const w of f) {
          const I = m.get(w);
          I && (I.delete(b), I.size === 0 && m.delete(w));
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
    (L.registerKeys = (f) => {
      for (const b of Object.keys(f)) ye.has(b) || ((r[b] = f[b]), h.add(b));
    }),
    L
  );
}
var ye = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function At(e, r) {
  const a = () => ({
    get: (o) => Je(() => e.get(o)),
    has: (o) => Je(() => e.has(o)),
  });
  return new Proxy(
    {},
    {
      get(o, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return a;
        if (typeof i != "symbol" && !ye.has(i)) return e.get(i);
      },
      set(o, i, s) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.set(i, s), !0);
      },
      deleteProperty(o, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(o, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || ye.has(i)
            ? !1
            : e.has(i);
      },
      ownKeys() {
        return Object.keys(r);
      },
      getOwnPropertyDescriptor(o, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Dt(e) {
  const r = Rt(e),
    a = At(r, e.schema);
  return { store: r, facts: a };
}
function De(e, r) {
  const a = "crossModuleDeps" in r ? r.crossModuleDeps : void 0;
  return {
    id: e,
    schema: r.schema,
    init: r.init,
    derive: r.derive ?? {},
    events: r.events ?? {},
    effects: r.effects,
    constraints: r.constraints,
    resolvers: r.resolvers,
    hooks: r.hooks,
    snapshotEvents: r.snapshotEvents,
    crossModuleDeps: a,
  };
}
async function xe(e, r, a) {
  let o,
    i = new Promise((s, u) => {
      o = setTimeout(() => u(new Error(a)), r);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(o);
  }
}
function mt(e, r = 50) {
  const a = new WeakSet();
  function o(i, s) {
    if (s > r) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const u = typeof i;
    if (u === "string") return JSON.stringify(i);
    if (u === "number" || u === "boolean") return String(i);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (a.has(i)) return '"[circular]"';
      a.add(i);
      const d = `[${i.map((h) => o(h, s + 1)).join(",")}]`;
      return a.delete(i), d;
    }
    if (u === "object") {
      const d = i;
      if (a.has(d)) return '"[circular]"';
      a.add(d);
      const h = `{${Object.keys(d)
        .sort()
        .map((m) => `${JSON.stringify(m)}:${o(d[m], s + 1)}`)
        .join(",")}}`;
      return a.delete(d), h;
    }
    return '"[unknown]"';
  }
  return o(e, 0);
}
function ve(e, r = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, u) {
    if (u > r) return !1;
    if (s == null || typeof s != "object") return !0;
    const d = s;
    if (o.has(d)) return !0;
    if ((o.add(d), Array.isArray(d))) {
      for (const h of d) if (!i(h, u + 1)) return o.delete(d), !1;
      return o.delete(d), !0;
    }
    for (const h of Object.keys(d))
      if (a.has(h) || !i(d[h], u + 1)) return o.delete(d), !1;
    return o.delete(d), !0;
  }
  return i(e, 0);
}
function Ot(e) {
  let r = mt(e),
    a = 5381;
  for (let o = 0; o < r.length; o++) a = ((a << 5) + a) ^ r.charCodeAt(o);
  return (a >>> 0).toString(16);
}
function Mt(e, r) {
  if (r) return r(e);
  const { type: a, ...o } = e,
    i = mt(o);
  return `${a}:${i}`;
}
function jt(e, r, a) {
  return { requirement: e, id: Mt(e, a), fromConstraint: r };
}
var _e = class pt {
    map = new Map();
    add(r) {
      this.map.has(r.id) || this.map.set(r.id, r);
    }
    remove(r) {
      return this.map.delete(r);
    }
    has(r) {
      return this.map.has(r);
    }
    get(r) {
      return this.map.get(r);
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
      const r = new pt();
      for (const a of this.map.values()) r.add(a);
      return r;
    }
    diff(r) {
      const a = [],
        o = [],
        i = [];
      for (const s of this.map.values()) r.has(s.id) ? i.push(s) : a.push(s);
      for (const s of r.map.values()) this.map.has(s.id) || o.push(s);
      return { added: a, removed: o, unchanged: i };
    }
  },
  It = 5e3;
function qt(e) {
  let {
      definitions: r,
      facts: a,
      requirementKeys: o = {},
      defaultTimeout: i = It,
      onEvaluate: s,
      onError: u,
    } = e,
    d = new Map(),
    h = new Set(),
    m = new Set(),
    c = new Map(),
    E = new Map(),
    B = new Set(),
    O = new Map(),
    M = new Map(),
    D = !1,
    k = new Set(),
    A = new Set(),
    N = new Map(),
    T = [],
    p = new Map();
  function x() {
    for (const [t, n] of Object.entries(r))
      if (n.after)
        for (const l of n.after)
          r[l] && (N.has(l) || N.set(l, new Set()), N.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      n = new Set(),
      l = [];
    function g(S, j) {
      if (t.has(S)) return;
      if (n.has(S)) {
        const W = j.indexOf(S),
          _ = [...j.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${_}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), j.push(S);
      const F = r[S];
      if (F?.after) for (const W of F.after) r[W] && g(W, j);
      j.pop(), n.delete(S), t.add(S), l.push(S);
    }
    for (const S of Object.keys(r)) g(S, []);
    (T = l), (p = new Map(T.map((S, j) => [S, j])));
  }
  v(), x();
  function $(t, n) {
    return n.async !== void 0 ? n.async : !!m.has(t);
  }
  function R(t) {
    const n = r[t];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const l = $(t, n);
    l && m.add(t);
    const g = {
      id: t,
      priority: n.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return d.set(t, g), g;
  }
  function L(t) {
    return d.get(t) ?? R(t);
  }
  function f(t, n) {
    const l = c.get(t) ?? new Set();
    for (const g of l) {
      const S = E.get(g);
      S?.delete(t), S && S.size === 0 && E.delete(g);
    }
    for (const g of n) E.has(g) || E.set(g, new Set()), E.get(g).add(t);
    c.set(t, n);
  }
  function b(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(a)), O.set(t, new Set(n.deps));
      else {
        const S = Ce(() => n.when(a));
        (g = S.value), O.set(t, S.deps);
      }
      return g instanceof Promise
        ? (m.add(t),
          (l.isAsync = !0),
          g
            .then(
              (S) => ((l.lastResult = S), (l.isEvaluating = !1), s?.(t, S), S),
            )
            .catch(
              (S) => (
                (l.error = S instanceof Error ? S : new Error(String(S))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                u?.(t, S),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), s?.(t, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(t, g),
        !1
      );
    }
  }
  async function w(t) {
    const n = r[t];
    if (!n) return !1;
    const l = L(t),
      g = n.timeout ?? i;
    if (((l.isEvaluating = !0), (l.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      f(t, S), O.set(t, S);
    }
    try {
      const S = n.when(a),
        j = await xe(S, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = j), (l.isEvaluating = !1), s?.(t, j), j;
    } catch (S) {
      return (
        (l.error = S instanceof Error ? S : new Error(String(S))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        u?.(t, S),
        !1
      );
    }
  }
  function I(t, n) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function P(t) {
    const n = r[t];
    if (!n) return { requirements: [], deps: new Set() };
    const l = n.require;
    if (typeof l == "function") {
      const { value: g, deps: S } = Ce(() => l(a));
      return { requirements: I(g), deps: S };
    }
    return { requirements: I(l), deps: new Set() };
  }
  function H(t, n) {
    if (n.size === 0) return;
    const l = c.get(t) ?? new Set();
    for (const g of n)
      l.add(g), E.has(g) || E.set(g, new Set()), E.get(g).add(t);
    c.set(t, l);
  }
  let z = null;
  function y() {
    return (
      z ||
        (z = Object.keys(r).sort((t, n) => {
          const l = L(t),
            g = L(n).priority - l.priority;
          if (g !== 0) return g;
          const S = p.get(t) ?? 0,
            j = p.get(n) ?? 0;
          return S - j;
        })),
      z
    );
  }
  for (const t of Object.keys(r)) R(t);
  function C(t) {
    const n = d.get(t);
    if (!n || n.after.length === 0) return !0;
    for (const l of n.after)
      if (r[l] && !h.has(l) && !A.has(l) && !k.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const n = new _e();
      A.clear();
      let l = y().filter((_) => !h.has(_)),
        g;
      if (!D || !t || t.size === 0) (g = l), (D = !0);
      else {
        const _ = new Set();
        for (const V of t) {
          const Y = E.get(V);
          if (Y) for (const ne of Y) h.has(ne) || _.add(ne);
        }
        for (const V of B) h.has(V) || _.add(V);
        B.clear(), (g = [..._]);
        for (const V of l)
          if (!_.has(V)) {
            const Y = M.get(V);
            if (Y) for (const ne of Y) n.add(ne);
          }
      }
      function S(_, V) {
        if (h.has(_)) return;
        const Y = O.get(_);
        if (!V) {
          Y !== void 0 && f(_, Y), A.add(_), M.set(_, []);
          return;
        }
        A.delete(_);
        let ne, ee;
        try {
          const X = P(_);
          (ne = X.requirements), (ee = X.deps);
        } catch (X) {
          u?.(_, X), Y !== void 0 && f(_, Y), M.set(_, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const U of ee) X.add(U);
          f(_, X);
        } else H(_, ee);
        if (ne.length > 0) {
          const X = o[_],
            U = ne.map((J) => jt(J, _, X));
          for (const J of U) n.add(J);
          M.set(_, U);
        } else M.set(_, []);
      }
      async function j(_) {
        const V = [],
          Y = [];
        for (const U of _)
          if (C(U)) Y.push(U);
          else {
            V.push(U);
            const J = M.get(U);
            if (J) for (const G of J) n.add(G);
          }
        if (Y.length === 0) return V;
        const ne = [],
          ee = [];
        for (const U of Y) L(U).isAsync ? ee.push(U) : ne.push(U);
        const X = [];
        for (const U of ne) {
          const J = b(U);
          if (J instanceof Promise) {
            X.push({ id: U, promise: J });
            continue;
          }
          S(U, J);
        }
        if (X.length > 0) {
          const U = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of U) S(J, G);
        }
        if (ee.length > 0) {
          const U = await Promise.all(
            ee.map(async (J) => ({ id: J, active: await w(J) })),
          );
          for (const { id: J, active: G } of U) S(J, G);
        }
        return V;
      }
      let F = g,
        W = g.length + 1;
      while (F.length > 0 && W > 0) {
        const _ = F.length;
        if (((F = await j(F)), F.length === _)) break;
        W--;
      }
      return n.all();
    },
    getState(t) {
      return d.get(t);
    },
    getAllStates() {
      return [...d.values()];
    },
    disable(t) {
      h.add(t), (z = null), M.delete(t);
      const n = c.get(t);
      if (n) {
        for (const l of n) {
          const g = E.get(l);
          g && (g.delete(t), g.size === 0 && E.delete(l));
        }
        c.delete(t);
      }
      O.delete(t);
    },
    enable(t) {
      h.delete(t), (z = null), B.add(t);
    },
    invalidate(t) {
      const n = E.get(t);
      if (n) for (const l of n) B.add(l);
    },
    markResolved(t) {
      k.add(t);
      const n = d.get(t);
      n && (n.lastResolvedAt = Date.now());
      const l = N.get(t);
      if (l) for (const g of l) B.add(g);
    },
    isResolved(t) {
      return k.has(t);
    },
    registerDefinitions(t) {
      for (const [n, l] of Object.entries(t)) (r[n] = l), R(n), B.add(n);
      (z = null), v(), x();
    },
  };
}
function Tt(e) {
  let {
      definitions: r,
      facts: a,
      onCompute: o,
      onInvalidate: i,
      onError: s,
    } = e,
    u = new Map(),
    d = new Map(),
    h = new Map(),
    m = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    E = 0,
    B = new Set(),
    O = !1,
    M = 100,
    D;
  function k(v) {
    if (!r[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
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
  function A(v) {
    return u.get(v) ?? k(v);
  }
  function N(v) {
    const $ = A(v),
      R = r[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if ($.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    $.isComputing = !0;
    try {
      const { value: L, deps: f } = Ce(() => R(a, D));
      return (
        ($.cachedValue = L), ($.isStale = !1), T(v, f), o?.(v, L, [...f]), L
      );
    } catch (L) {
      throw (s?.(v, L), L);
    } finally {
      $.isComputing = !1;
    }
  }
  function T(v, $) {
    const R = A(v),
      L = R.dependencies;
    for (const f of L)
      if (u.has(f)) {
        const b = m.get(f);
        b?.delete(v), b && b.size === 0 && m.delete(f);
      } else {
        const b = h.get(f);
        b?.delete(v), b && b.size === 0 && h.delete(f);
      }
    for (const f of $)
      r[f]
        ? (m.has(f) || m.set(f, new Set()), m.get(f).add(v))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(v));
    R.dependencies = $;
  }
  function p() {
    if (!(E > 0 || O)) {
      O = !0;
      try {
        let v = 0;
        while (B.size > 0) {
          if (++v > M) {
            const R = [...B];
            throw (
              (B.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${M} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const $ = [...B];
          B.clear();
          for (const R of $) d.get(R)?.forEach((L) => L());
        }
      } finally {
        O = !1;
      }
    }
  }
  function x(v, $ = new Set()) {
    if ($.has(v)) return;
    $.add(v);
    const R = u.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), i?.(v), B.add(v);
    const L = m.get(v);
    if (L) for (const f of L) x(f, $);
  }
  return (
    (D = new Proxy(
      {},
      {
        get(v, $) {
          if (typeof $ == "symbol" || c.has($)) return;
          Te($);
          const R = A($);
          return R.isStale && N($), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const $ = A(v);
        return $.isStale && N(v), $.cachedValue;
      },
      isStale(v) {
        return u.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const $ = h.get(v);
        if ($) {
          E++;
          try {
            for (const R of $) x(R);
          } finally {
            E--, p();
          }
        }
      },
      invalidateMany(v) {
        E++;
        try {
          for (const $ of v) {
            const R = h.get($);
            if (R) for (const L of R) x(L);
          }
        } finally {
          E--, p();
        }
      },
      invalidateAll() {
        E++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), B.add(v.id));
        } finally {
          E--, p();
        }
      },
      subscribe(v, $) {
        for (const R of v) {
          const L = R;
          d.has(L) || d.set(L, new Set()), d.get(L).add($);
        }
        return () => {
          for (const R of v) {
            const L = R,
              f = d.get(L);
            f?.delete($), f && f.size === 0 && d.delete(L);
          }
        };
      },
      getProxy() {
        return D;
      },
      getDependencies(v) {
        return A(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [$, R] of Object.entries(v)) (r[$] = R), k($);
      },
    }
  );
}
function _t(e) {
  let { definitions: r, facts: a, store: o, onRun: i, onError: s } = e,
    u = new Map(),
    d = null,
    h = !1;
  function m(k) {
    const A = r[k];
    if (!A) throw new Error(`[Directive] Unknown effect: ${k}`);
    const N = {
      id: k,
      enabled: !0,
      hasExplicitDeps: !!A.deps,
      dependencies: A.deps ? new Set(A.deps) : null,
      cleanup: null,
    };
    return u.set(k, N), N;
  }
  function c(k) {
    return u.get(k) ?? m(k);
  }
  function E() {
    return o.toObject();
  }
  function B(k, A) {
    const N = c(k);
    if (!N.enabled) return !1;
    if (N.dependencies) {
      for (const T of N.dependencies) if (A.has(T)) return !0;
      return !1;
    }
    return !0;
  }
  function O(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (A) {
        s?.(k.id, A),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            A,
          );
      }
      k.cleanup = null;
    }
  }
  function M(k, A) {
    if (typeof A == "function")
      if (h)
        try {
          A();
        } catch (N) {
          s?.(k.id, N),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              N,
            );
        }
      else k.cleanup = A;
  }
  async function D(k) {
    const A = c(k),
      N = r[k];
    if (!(!A.enabled || !N)) {
      O(A), i?.(k);
      try {
        if (A.hasExplicitDeps) {
          let T;
          if (
            (o.batch(() => {
              T = N.run(a, d);
            }),
            T instanceof Promise)
          ) {
            const p = await T;
            M(A, p);
          } else M(A, T);
        } else {
          let T = null,
            p,
            x = Ce(
              () => (
                o.batch(() => {
                  p = N.run(a, d);
                }),
                p
              ),
            );
          T = x.deps;
          let v = x.value;
          v instanceof Promise && (v = await v),
            M(A, v),
            (A.dependencies = T.size > 0 ? T : null);
        }
      } catch (T) {
        s?.(k, T),
          console.error(`[Directive] Effect "${k}" threw an error:`, T);
      }
    }
  }
  for (const k of Object.keys(r)) m(k);
  return {
    async runEffects(k) {
      const A = [];
      for (const N of Object.keys(r)) B(N, k) && A.push(N);
      await Promise.all(A.map(D)), (d = E());
    },
    async runAll() {
      const k = Object.keys(r);
      await Promise.all(
        k.map((A) => (c(A).enabled ? D(A) : Promise.resolve())),
      ),
        (d = E());
    },
    disable(k) {
      const A = c(k);
      A.enabled = !1;
    },
    enable(k) {
      const A = c(k);
      A.enabled = !0;
    },
    isEnabled(k) {
      return c(k).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const k of u.values()) O(k);
    },
    registerDefinitions(k) {
      for (const [A, N] of Object.entries(k)) (r[A] = N), m(A);
    },
  };
}
function Bt(e = {}) {
  const {
      delayMs: r = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: o = 2,
      maxDelayMs: i = 3e4,
    } = e,
    s = new Map();
  function u(d) {
    const h = r * Math.pow(o, d - 1);
    return Math.min(h, i);
  }
  return {
    scheduleRetry(d, h, m, c, E) {
      if (c > a) return null;
      const B = u(c),
        O = {
          source: d,
          sourceId: h,
          context: m,
          attempt: c,
          nextRetryTime: Date.now() + B,
          callback: E,
        };
      return s.set(h, O), O;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const d = Date.now(),
        h = [];
      for (const [m, c] of s) c.nextRetryTime <= d && (h.push(c), s.delete(m));
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
var Lt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function zt(e = {}) {
  const { config: r = {}, onError: a, onRecovery: o } = e,
    i = [],
    s = 100,
    u = Bt(r.retryLater),
    d = new Map();
  function h(c, E, B, O) {
    if (B instanceof Ve) return B;
    const M = B instanceof Error ? B.message : String(B),
      D = c !== "system";
    return new Ve(M, c, E, O, D);
  }
  function m(c, E, B) {
    const O = (() => {
      switch (c) {
        case "constraint":
          return r.onConstraintError;
        case "resolver":
          return r.onResolverError;
        case "effect":
          return r.onEffectError;
        case "derivation":
          return r.onDerivationError;
        default:
          return;
      }
    })();
    if (typeof O == "function") {
      try {
        O(B, E);
      } catch (M) {
        console.error("[Directive] Error in error handler callback:", M);
      }
      return "skip";
    }
    return typeof O == "string" ? O : Lt[c];
  }
  return {
    handleError(c, E, B, O) {
      const M = h(c, E, B, O);
      i.push(M), i.length > s && i.shift();
      try {
        a?.(M);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        r.onError?.(M);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let D = m(c, E, B instanceof Error ? B : new Error(String(B)));
      if (D === "retry-later") {
        const k = (d.get(E) ?? 0) + 1;
        d.set(E, k),
          u.scheduleRetry(c, E, O, k) ||
            ((D = "skip"), d.delete(E), typeof process < "u");
      }
      try {
        o?.(M, D);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (D === "throw") throw M;
      return D;
    },
    getLastError() {
      return i[i.length - 1] ?? null;
    },
    getAllErrors() {
      return [...i];
    },
    clearErrors() {
      i.length = 0;
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
function Ft() {
  const e = [];
  function r(o) {
    if (o)
      try {
        return o();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  async function a(o) {
    if (o)
      try {
        return await o();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  return {
    register(o) {
      e.some((i) => i.name === o.name) &&
        (console.warn(
          `[Directive] Plugin "${o.name}" is already registered, replacing...`,
        ),
        this.unregister(o.name)),
        e.push(o);
    },
    unregister(o) {
      const i = e.findIndex((s) => s.name === o);
      i !== -1 && e.splice(i, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(o) {
      for (const i of e) await a(() => i.onInit?.(o));
    },
    emitStart(o) {
      for (const i of e) r(() => i.onStart?.(o));
    },
    emitStop(o) {
      for (const i of e) r(() => i.onStop?.(o));
    },
    emitDestroy(o) {
      for (const i of e) r(() => i.onDestroy?.(o));
    },
    emitFactSet(o, i, s) {
      for (const u of e) r(() => u.onFactSet?.(o, i, s));
    },
    emitFactDelete(o, i) {
      for (const s of e) r(() => s.onFactDelete?.(o, i));
    },
    emitFactsBatch(o) {
      for (const i of e) r(() => i.onFactsBatch?.(o));
    },
    emitDerivationCompute(o, i, s) {
      for (const u of e) r(() => u.onDerivationCompute?.(o, i, s));
    },
    emitDerivationInvalidate(o) {
      for (const i of e) r(() => i.onDerivationInvalidate?.(o));
    },
    emitReconcileStart(o) {
      for (const i of e) r(() => i.onReconcileStart?.(o));
    },
    emitReconcileEnd(o) {
      for (const i of e) r(() => i.onReconcileEnd?.(o));
    },
    emitConstraintEvaluate(o, i) {
      for (const s of e) r(() => s.onConstraintEvaluate?.(o, i));
    },
    emitConstraintError(o, i) {
      for (const s of e) r(() => s.onConstraintError?.(o, i));
    },
    emitRequirementCreated(o) {
      for (const i of e) r(() => i.onRequirementCreated?.(o));
    },
    emitRequirementMet(o, i) {
      for (const s of e) r(() => s.onRequirementMet?.(o, i));
    },
    emitRequirementCanceled(o) {
      for (const i of e) r(() => i.onRequirementCanceled?.(o));
    },
    emitResolverStart(o, i) {
      for (const s of e) r(() => s.onResolverStart?.(o, i));
    },
    emitResolverComplete(o, i, s) {
      for (const u of e) r(() => u.onResolverComplete?.(o, i, s));
    },
    emitResolverError(o, i, s) {
      for (const u of e) r(() => u.onResolverError?.(o, i, s));
    },
    emitResolverRetry(o, i, s) {
      for (const u of e) r(() => u.onResolverRetry?.(o, i, s));
    },
    emitResolverCancel(o, i) {
      for (const s of e) r(() => s.onResolverCancel?.(o, i));
    },
    emitEffectRun(o) {
      for (const i of e) r(() => i.onEffectRun?.(o));
    },
    emitEffectError(o, i) {
      for (const s of e) r(() => s.onEffectError?.(o, i));
    },
    emitSnapshot(o) {
      for (const i of e) r(() => i.onSnapshot?.(o));
    },
    emitTimeTravel(o, i) {
      for (const s of e) r(() => s.onTimeTravel?.(o, i));
    },
    emitError(o) {
      for (const i of e) r(() => i.onError?.(o));
    },
    emitErrorRecovery(o, i) {
      for (const s of e) r(() => s.onErrorRecovery?.(o, i));
    },
  };
}
var Ye = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ge = { enabled: !1, windowMs: 50 };
function Xe(e, r) {
  let { backoff: a, initialDelay: o = 100, maxDelay: i = 3e4 } = e,
    s;
  switch (a) {
    case "none":
      s = o;
      break;
    case "linear":
      s = o * r;
      break;
    case "exponential":
      s = o * Math.pow(2, r - 1);
      break;
    default:
      s = o;
  }
  return Math.max(1, Math.min(s, i));
}
function Nt(e) {
  const {
      definitions: r,
      facts: a,
      store: o,
      onStart: i,
      onComplete: s,
      onError: u,
      onRetry: d,
      onCancel: h,
      onResolutionComplete: m,
    } = e,
    c = new Map(),
    E = new Map(),
    B = 1e3,
    O = new Map(),
    M = new Map(),
    D = 1e3;
  function k() {
    if (E.size > B) {
      const f = E.size - B,
        b = E.keys();
      for (let w = 0; w < f; w++) {
        const I = b.next().value;
        I && E.delete(I);
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
  function N(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function T(f, b) {
    return A(f) ? b.type === f.requirement : N(f) ? f.requirement(b) : !1;
  }
  function p(f) {
    const b = f.type,
      w = M.get(b);
    if (w)
      for (const I of w) {
        const P = r[I];
        if (P && T(P, f)) return I;
      }
    for (const [I, P] of Object.entries(r))
      if (T(P, f)) {
        if (!M.has(b)) {
          if (M.size >= D) {
            const z = M.keys().next().value;
            z !== void 0 && M.delete(z);
          }
          M.set(b, []);
        }
        const H = M.get(b);
        return H.includes(I) || H.push(I), I;
      }
    return null;
  }
  function x(f) {
    return { facts: a, signal: f, snapshot: () => a.$snapshot() };
  }
  async function v(f, b, w) {
    const I = r[f];
    if (!I) return;
    let P = { ...Ye, ...I.retry },
      H = null;
    for (let z = 1; z <= P.attempts; z++) {
      if (w.signal.aborted) return;
      const y = c.get(b.id);
      y &&
        ((y.attempt = z),
        (y.status = {
          state: "running",
          requirementId: b.id,
          startedAt: y.startedAt,
          attempt: z,
        }));
      try {
        const C = x(w.signal);
        if (I.resolve) {
          let n;
          o.batch(() => {
            n = I.resolve(b.requirement, C);
          });
          const l = I.timeout;
          l && l > 0
            ? await xe(n, l, `Resolver "${f}" timed out after ${l}ms`)
            : await n;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        E.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: t,
        }),
          k(),
          s?.(f, b, t);
        return;
      } catch (C) {
        if (
          ((H = C instanceof Error ? C : new Error(String(C))),
          w.signal.aborted)
        )
          return;
        if (P.shouldRetry && !P.shouldRetry(H, z)) break;
        if (z < P.attempts) {
          if (w.signal.aborted) return;
          const t = Xe(P, z);
          if (
            (d?.(f, b, z + 1),
            await new Promise((n) => {
              const l = setTimeout(n, t),
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
    E.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: H,
      failedAt: Date.now(),
      attempts: P.attempts,
    }),
      k(),
      u?.(f, b, H);
  }
  async function $(f, b) {
    const w = r[f];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((t) => {
          const n = new AbortController();
          return v(f, t, n);
        }),
      );
      return;
    }
    let I = { ...Ye, ...w.retry },
      P = { ...Ge, ...w.batch },
      H = new AbortController(),
      z = Date.now(),
      y = null,
      C = P.timeoutMs ?? w.timeout;
    for (let t = 1; t <= I.attempts; t++) {
      if (H.signal.aborted) return;
      try {
        const n = x(H.signal),
          l = b.map((g) => g.requirement);
        if (w.resolveBatchWithResults) {
          let g, S;
          if (
            (o.batch(() => {
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
          let j = Date.now() - z,
            F = !1;
          for (let W = 0; W < b.length; W++) {
            const _ = b[W],
              V = g[W];
            if (V.success)
              E.set(_.id, {
                state: "success",
                requirementId: _.id,
                completedAt: Date.now(),
                duration: j,
              }),
                s?.(f, _, j);
            else {
              F = !0;
              const Y = V.error ?? new Error("Batch item failed");
              E.set(_.id, {
                state: "error",
                requirementId: _.id,
                error: Y,
                failedAt: Date.now(),
                attempts: t,
              }),
                u?.(f, _, Y);
            }
          }
          if (!F || b.some((W, _) => g[_]?.success)) return;
        } else {
          let g;
          o.batch(() => {
            g = w.resolveBatch(l, n);
          }),
            C && C > 0
              ? await xe(g, C, `Batch resolver "${f}" timed out after ${C}ms`)
              : await g;
          const S = Date.now() - z;
          for (const j of b)
            E.set(j.id, {
              state: "success",
              requirementId: j.id,
              completedAt: Date.now(),
              duration: S,
            }),
              s?.(f, j, S);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          H.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, t)) break;
        if (t < I.attempts) {
          const l = Xe(I, t);
          for (const g of b) d?.(f, g, t + 1);
          if (
            (await new Promise((g) => {
              const S = setTimeout(g, l),
                j = () => {
                  clearTimeout(S), g();
                };
              H.signal.addEventListener("abort", j, { once: !0 });
            }),
            H.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of b)
      E.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        u?.(f, t, y);
    k();
  }
  function R(f, b) {
    const w = r[f];
    if (!w) return;
    const I = { ...Ge, ...w.batch };
    O.has(f) || O.set(f, { resolverId: f, requirements: [], timer: null });
    const P = O.get(f);
    P.requirements.push(b),
      P.timer && clearTimeout(P.timer),
      (P.timer = setTimeout(() => {
        L(f);
      }, I.windowMs));
  }
  function L(f) {
    const b = O.get(f);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      $(f, w).then(() => {
        m?.();
      });
  }
  return {
    resolve(f) {
      if (c.has(f.id)) return;
      const b = p(f.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${f.id}`);
        return;
      }
      const w = r[b];
      if (!w) return;
      if (w.batch?.enabled) {
        R(b, f);
        return;
      }
      const I = new AbortController(),
        P = Date.now(),
        H = {
          requirementId: f.id,
          resolverId: b,
          controller: I,
          startedAt: P,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: P },
          originalRequirement: f,
        };
      c.set(f.id, H),
        i?.(b, f),
        v(b, f, I).finally(() => {
          c.delete(f.id) && m?.();
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
        k(),
        h?.(b.resolverId, b.originalRequirement));
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
      for (const f of O.keys()) L(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) r[b] = w;
      M.clear();
    },
  };
}
function Pt(e) {
  let { config: r, facts: a, store: o, onSnapshot: i, onTimeTravel: s } = e,
    u = r.timeTravel ?? !1,
    d = r.maxSnapshots ?? 100,
    h = [],
    m = -1,
    c = 1,
    E = !1,
    B = !1,
    O = [],
    M = null,
    D = -1;
  function k() {
    return o.toObject();
  }
  function A() {
    const T = k();
    return structuredClone(T);
  }
  function N(T) {
    if (!ve(T)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    o.batch(() => {
      for (const [p, x] of Object.entries(T)) {
        if (p === "__proto__" || p === "constructor" || p === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${p}" during fact restoration`,
          );
          continue;
        }
        a[p] = x;
      }
    });
  }
  return {
    get isEnabled() {
      return u;
    },
    get isRestoring() {
      return B;
    },
    get isPaused() {
      return E;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return m;
    },
    takeSnapshot(T) {
      if (!u || E)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: T };
      const p = { id: c++, timestamp: Date.now(), facts: A(), trigger: T };
      for (
        m < h.length - 1 && h.splice(m + 1), h.push(p), m = h.length - 1;
        h.length > d;
      )
        h.shift(), m--;
      return i?.(p), p;
    },
    restore(T) {
      if (u) {
        (E = !0), (B = !0);
        try {
          N(T.facts);
        } finally {
          (E = !1), (B = !1);
        }
      }
    },
    goBack(T = 1) {
      if (!u || h.length === 0) return;
      let p = m,
        x = m,
        v = O.find((R) => m > R.startIndex && m <= R.endIndex);
      if (v) x = v.startIndex;
      else if (O.find((R) => m === R.startIndex)) {
        const R = O.find((L) => L.endIndex < m && m - L.endIndex <= T);
        x = R ? R.startIndex : Math.max(0, m - T);
      } else x = Math.max(0, m - T);
      if (p === x) return;
      m = x;
      const $ = h[m];
      $ && (this.restore($), s?.(p, x));
    },
    goForward(T = 1) {
      if (!u || h.length === 0) return;
      let p = m,
        x = m,
        v = O.find((R) => m >= R.startIndex && m < R.endIndex);
      if ((v ? (x = v.endIndex) : (x = Math.min(h.length - 1, m + T)), p === x))
        return;
      m = x;
      const $ = h[m];
      $ && (this.restore($), s?.(p, x));
    },
    goTo(T) {
      if (!u) return;
      const p = h.findIndex(($) => $.id === T);
      if (p === -1) {
        console.warn(`[Directive] Snapshot ${T} not found`);
        return;
      }
      const x = m;
      m = p;
      const v = h[m];
      v && (this.restore(v), s?.(x, p));
    },
    replay() {
      if (!u || h.length === 0) return;
      m = 0;
      const T = h[0];
      T && this.restore(T);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: m });
    },
    import(T) {
      if (u)
        try {
          const p = JSON.parse(T);
          if (typeof p != "object" || p === null)
            throw new Error("Invalid time-travel data: expected object");
          if (p.version !== 1)
            throw new Error(
              `Unsupported time-travel export version: ${p.version}`,
            );
          if (!Array.isArray(p.snapshots))
            throw new Error(
              "Invalid time-travel data: snapshots must be an array",
            );
          if (typeof p.currentIndex != "number")
            throw new Error(
              "Invalid time-travel data: currentIndex must be a number",
            );
          for (const v of p.snapshots) {
            if (typeof v != "object" || v === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof v.id != "number" ||
              typeof v.timestamp != "number" ||
              typeof v.trigger != "string" ||
              typeof v.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!ve(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...p.snapshots), (m = p.currentIndex);
          const x = h[m];
          x && this.restore(x);
        } catch (p) {
          console.error("[Directive] Failed to import time-travel data:", p);
        }
    },
    beginChangeset(T) {
      u && ((M = T), (D = m));
    },
    endChangeset() {
      !u ||
        M === null ||
        (m > D && O.push({ label: M, startIndex: D, endIndex: m }),
        (M = null),
        (D = -1));
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
var le = new Set(["__proto__", "constructor", "prototype"]);
function ht(e) {
  const r = Object.create(null),
    a = Object.create(null),
    o = Object.create(null),
    i = Object.create(null),
    s = Object.create(null),
    u = Object.create(null);
  for (const t of e.modules) {
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (le.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    n(t.schema, "schema"),
      n(t.events, "events"),
      n(t.derive, "derive"),
      n(t.effects, "effects"),
      n(t.constraints, "constraints"),
      n(t.resolvers, "resolvers"),
      Object.assign(r, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && Object.assign(o, t.derive),
      t.effects && Object.assign(i, t.effects),
      t.constraints && Object.assign(s, t.constraints),
      t.resolvers && Object.assign(u, t.resolvers);
  }
  let d = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    d = new Set();
    for (const t of e.modules) {
      const n = t;
      if (n.snapshotEvents) for (const l of n.snapshotEvents) d.add(l);
      else if (n.events) for (const l of Object.keys(n.events)) d.add(l);
    }
  }
  let h = 0,
    m = !1,
    c = Ft();
  for (const t of e.plugins ?? []) c.register(t);
  let E = zt({
      config: e.errorBoundary,
      onError: (t) => c.emitError(t),
      onRecovery: (t, n) => c.emitErrorRecovery(t, n),
    }),
    B = () => {},
    O = () => {},
    M = null,
    { store: D, facts: k } = Dt({
      schema: r,
      onChange: (t, n, l) => {
        c.emitFactSet(t, n, l),
          B(t),
          !M?.isRestoring && (h === 0 && (m = !0), w.changedKeys.add(t), I());
      },
      onBatch: (t) => {
        c.emitFactsBatch(t);
        const n = [];
        for (const l of t) n.push(l.key);
        if ((O(n), !M?.isRestoring)) {
          h === 0 && (m = !0);
          for (const l of t) w.changedKeys.add(l.key);
          I();
        }
      },
    }),
    A = Tt({
      definitions: o,
      facts: k,
      onCompute: (t, n, l) => c.emitDerivationCompute(t, n, l),
      onInvalidate: (t) => c.emitDerivationInvalidate(t),
      onError: (t, n) => {
        E.handleError("derivation", t, n);
      },
    });
  (B = (t) => A.invalidate(t)), (O = (t) => A.invalidateMany(t));
  const N = _t({
      definitions: i,
      facts: k,
      store: D,
      onRun: (t) => c.emitEffectRun(t),
      onError: (t, n) => {
        E.handleError("effect", t, n), c.emitEffectError(t, n);
      },
    }),
    T = qt({
      definitions: s,
      facts: k,
      onEvaluate: (t, n) => c.emitConstraintEvaluate(t, n),
      onError: (t, n) => {
        E.handleError("constraint", t, n), c.emitConstraintError(t, n);
      },
    }),
    p = Nt({
      definitions: u,
      facts: k,
      store: D,
      onStart: (t, n) => c.emitResolverStart(t, n),
      onComplete: (t, n, l) => {
        c.emitResolverComplete(t, n, l),
          c.emitRequirementMet(n, t),
          T.markResolved(n.fromConstraint);
      },
      onError: (t, n, l) => {
        E.handleError("resolver", t, l, n), c.emitResolverError(t, n, l);
      },
      onRetry: (t, n, l) => c.emitResolverRetry(t, n, l),
      onCancel: (t, n) => {
        c.emitResolverCancel(t, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        L(), I();
      },
    }),
    x = new Set();
  function v() {
    for (const t of x) t();
  }
  const $ = e.debug?.timeTravel
    ? Pt({
        config: e.debug,
        facts: k,
        store: D,
        onSnapshot: (t) => {
          c.emitSnapshot(t), v();
        },
        onTimeTravel: (t, n) => {
          c.emitTimeTravel(t, n), v();
        },
      })
    : Wt();
  M = $;
  const R = new Set();
  function L() {
    for (const t of R) t();
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
      previousRequirements: new _e(),
      readyPromise: null,
      readyResolve: null,
    };
  function I() {
    !w.isRunning ||
      w.reconcileScheduled ||
      w.isInitializing ||
      ((w.reconcileScheduled = !0),
      L(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && P().catch((t) => {});
      }));
  }
  async function P() {
    if (!w.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), L();
      try {
        w.changedKeys.size > 0 &&
          ((d === null || m) &&
            $.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (m = !1));
        const t = k.$snapshot();
        c.emitReconcileStart(t), await N.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const l = await T.evaluate(n),
          g = new _e();
        for (const _ of l) g.add(_), c.emitRequirementCreated(_);
        const { added: S, removed: j } = g.diff(w.previousRequirements);
        for (const _ of j) p.cancel(_.id);
        for (const _ of S) p.resolve(_);
        w.previousRequirements = g;
        const F = p.getInflightInfo(),
          W = {
            unmet: l.filter((_) => !p.isResolving(_.id)),
            inflight: F,
            completed: [],
            canceled: j.map((_) => ({
              id: _.id,
              resolverId: F.find((V) => V.id === _.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(W),
          w.isReady ||
            ((w.isReady = !0),
            w.readyResolve && (w.readyResolve(), (w.readyResolve = null)));
      } finally {
        (w.isReconciling = !1),
          w.changedKeys.size > 0 ? I() : w.reconcileScheduled || (b = 0),
          L();
      }
    }
  }
  const H = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n)) return A.get(n);
        },
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in o;
        },
        ownKeys() {
          return Object.keys(o);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in o)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    z = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n))
            return (l) => {
              const g = a[n];
              if (g) {
                h++, (d === null || d.has(n)) && (m = !0);
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
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: k,
      debug: $.isEnabled ? $ : null,
      derive: H,
      events: z,
      constraints: { disable: (t) => T.disable(t), enable: (t) => T.enable(t) },
      effects: {
        disable: (t) => N.disable(t),
        enable: (t) => N.enable(t),
        isEnabled: (t) => N.isEnabled(t),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              D.batch(() => {
                t.init(k);
              });
          e.onAfterModuleInit &&
            D.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const t of Object.keys(o)) A.get(t);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(y);
          c.emitStart(y), I();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), p.cancelAll(), N.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
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
      dispatch(t) {
        if (le.has(t.type)) return;
        const n = a[t.type];
        if (n) {
          h++, (d === null || d.has(t.type)) && (m = !0);
          try {
            D.batch(() => {
              n(k, t);
            });
          } finally {
            h--;
          }
        }
      },
      read(t) {
        return A.get(t);
      },
      subscribe(t, n) {
        const l = [],
          g = [];
        for (const j of t) j in o ? l.push(j) : j in r && g.push(j);
        const S = [];
        return (
          l.length > 0 && S.push(A.subscribe(l, n)),
          g.length > 0 && S.push(D.subscribe(g, n)),
          () => {
            for (const j of S) j();
          }
        );
      },
      watch(t, n, l) {
        const g = l?.equalityFn
          ? (j, F) => l.equalityFn(j, F)
          : (j, F) => Object.is(j, F);
        if (t in o) {
          let j = A.get(t);
          return A.subscribe([t], () => {
            const F = A.get(t);
            if (!g(F, j)) {
              const W = j;
              (j = F), n(F, W);
            }
          });
        }
        let S = D.get(t);
        return D.subscribe([t], () => {
          const j = D.get(t);
          if (!g(j, S)) {
            const F = S;
            (S = j), n(j, F);
          }
        });
      },
      when(t, n) {
        return new Promise((l, g) => {
          const S = D.toObject();
          if (t(S)) {
            l();
            return;
          }
          let j,
            F,
            W = () => {
              j?.(), F !== void 0 && clearTimeout(F);
            };
          (j = D.subscribeAll(() => {
            const _ = D.toObject();
            t(_) && (W(), l());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (F = setTimeout(() => {
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
          inflight: p.getInflightInfo(),
          constraints: T.getAllStates().map((t) => ({
            id: t.id,
            active: t.lastResult ?? !1,
            priority: t.priority,
          })),
          resolvers: Object.fromEntries(
            p.getInflight().map((t) => [t, p.getStatus(t)]),
          ),
        };
      },
      explain(t) {
        const n = w.previousRequirements.all().find((V) => V.id === t);
        if (!n) return null;
        const l = T.getState(n.fromConstraint),
          g = p.getStatus(t),
          S = {},
          j = D.toObject();
        for (const [V, Y] of Object.entries(j)) S[V] = Y;
        const F = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([V]) => V !== "type")
            .map(([V, Y]) => `${V}=${JSON.stringify(Y)}`)
            .join(", ");
        W && F.push(`├─ Requirement payload: { ${W} }`);
        const _ = Object.entries(S).slice(0, 10);
        return (
          _.length > 0 &&
            (F.push("└─ Relevant facts:"),
            _.forEach(([V, Y], ne) => {
              const ee = ne === _.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              F.push(
                `${ee} ${V} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          F.join(`
`)
        );
      },
      async settle(t = 5e3) {
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
          if (Date.now() - n > t) {
            const g = [];
            l.inflight.length > 0 &&
              g.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((j) => j.resolverId).join(", ")}`,
              ),
              w.isReconciling && g.push("reconciliation in progress"),
              w.reconcileScheduled && g.push("reconcile scheduled");
            const S = w.previousRequirements.all();
            throw (
              (S.length > 0 &&
                g.push(
                  `${S.length} unmet requirements: ${S.map((j) => j.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${t}ms. ${g.join("; ")}`,
              ))
            );
          }
          await new Promise((g) => setTimeout(g, 10));
        }
      },
      getSnapshot() {
        return { facts: D.toObject(), version: 1 };
      },
      getDistributableSnapshot(t = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: S,
            metadata: j,
            includeVersion: F,
          } = t,
          W = {},
          _ = Object.keys(o),
          V;
        if ((n ? (V = n.filter((ee) => _.includes(ee))) : (V = _), l)) {
          const ee = new Set(l);
          V = V.filter((X) => !ee.has(X));
        }
        for (const ee of V)
          try {
            W[ee] = A.get(ee);
          } catch {}
        if (g && g.length > 0) {
          const ee = D.toObject();
          for (const X of g) X in ee && (W[X] = ee[X]);
        }
        const Y = Date.now(),
          ne = { data: W, createdAt: Y };
        return (
          S !== void 0 && S > 0 && (ne.expiresAt = Y + S * 1e3),
          F && (ne.version = Ot(W)),
          j && (ne.metadata = j),
          ne
        );
      },
      watchDistributableSnapshot(t, n) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          S = Object.keys(o),
          j;
        if ((l ? (j = l.filter((W) => S.includes(W))) : (j = S), g)) {
          const W = new Set(g);
          j = j.filter((_) => !W.has(_));
        }
        if (j.length === 0) return () => {};
        let F = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return A.subscribe(j, () => {
          const W = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          W.version !== F && ((F = W.version), n(W));
        });
      },
      restore(t) {
        if (!t || typeof t != "object")
          throw new Error(
            "[Directive] restore() requires a valid snapshot object",
          );
        if (!t.facts || typeof t.facts != "object")
          throw new Error(
            "[Directive] restore() snapshot must have a facts object",
          );
        if (!ve(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [n, l] of Object.entries(t.facts))
            le.has(n) || D.set(n, l);
        });
      },
      onSettledChange(t) {
        return (
          R.add(t),
          () => {
            R.delete(t);
          }
        );
      },
      onTimeTravelChange(t) {
        return (
          x.add(t),
          () => {
            x.delete(t);
          }
        );
      },
      batch(t) {
        D.batch(t);
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
                (w.readyPromise = new Promise((t) => {
                  w.readyResolve = t;
                })),
              w.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function C(t) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" on a destroyed system.`,
      );
    const n = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (le.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}.`,
            );
      }
    };
    n(t.schema, "schema"),
      n(t.events, "events"),
      n(t.derive, "derive"),
      n(t.effects, "effects"),
      n(t.constraints, "constraints"),
      n(t.resolvers, "resolvers");
    for (const l of Object.keys(t.schema))
      if (l in r)
        throw new Error(
          `[Directive] Schema collision: Fact "${l}" already exists. Cannot register module "${t.id}".`,
        );
    if (t.snapshotEvents) {
      d === null && (d = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) d.add(l);
    } else if (d !== null && t.events)
      for (const l of Object.keys(t.events)) d.add(l);
    Object.assign(r, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(o, t.derive), A.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(i, t.effects), N.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(s, t.constraints), T.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(u, t.resolvers), p.registerDefinitions(t.resolvers)),
      D.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        D.batch(() => {
          t.init(k);
        }),
      t.hooks?.onInit?.(y),
      w.isRunning && (t.hooks?.onStart?.(y), I());
  }
  (y.registerModule = C), c.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var ie = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  K = "::";
function Ht(e) {
  const r = Object.keys(e),
    a = new Set(),
    o = new Set(),
    i = [],
    s = [];
  function u(d) {
    if (a.has(d)) return;
    if (o.has(d)) {
      const m = s.indexOf(d),
        c = [...s.slice(m), d].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    o.add(d), s.push(d);
    const h = e[d];
    if (h?.crossModuleDeps)
      for (const m of Object.keys(h.crossModuleDeps)) r.includes(m) && u(m);
    s.pop(), o.delete(d), a.add(d), i.push(d);
  }
  for (const d of r) u(d);
  return i;
}
var Qe = new WeakMap(),
  Ze = new WeakMap(),
  et = new WeakMap(),
  tt = new WeakMap();
function gt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Jt(e);
  }
  const r = e;
  if (Array.isArray(r.modules))
    throw new Error(`[Directive] createSystem expects modules as an object, not an array.

Instead of:
  createSystem({ modules: [authModule, dataModule] })

Use:
  createSystem({ modules: { auth: authModule, data: dataModule } })

Or for a single module:
  createSystem({ module: counterModule })`);
  return Kt(r);
}
function Kt(e) {
  const r = e.modules,
    a = new Set(Object.keys(r)),
    o = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const p = s,
      x = Object.keys(r).filter((v) => !p.includes(v));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = p;
  } else s === "declaration" ? (i = Object.keys(r)) : (i = Ht(r));
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
  for (const p of Object.keys(r)) {
    if (p.includes(K))
      throw new Error(
        `[Directive] Module name "${p}" contains the reserved separator "${K}". Module names cannot contain "${K}".`,
      );
    const x = r[p];
    if (x) {
      for (const v of Object.keys(x.schema.facts))
        if (v.includes(K))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${p}" contains the reserved separator "${K}". Schema keys cannot contain "${K}".`,
          );
    }
  }
  const h = [];
  for (const p of i) {
    const x = r[p];
    if (!x) continue;
    const v = x.crossModuleDeps && Object.keys(x.crossModuleDeps).length > 0,
      $ = v ? Object.keys(x.crossModuleDeps) : [],
      R = {};
    for (const [y, C] of Object.entries(x.schema.facts)) R[`${p}${K}${y}`] = C;
    const L = {};
    if (x.schema.derivations)
      for (const [y, C] of Object.entries(x.schema.derivations))
        L[`${p}${K}${y}`] = C;
    const f = {};
    if (x.schema.events)
      for (const [y, C] of Object.entries(x.schema.events))
        f[`${p}${K}${y}`] = C;
    const b = x.init
        ? (y) => {
            const C = oe(y, p);
            x.init(C);
          }
        : void 0,
      w = {};
    if (x.derive)
      for (const [y, C] of Object.entries(x.derive))
        w[`${p}${K}${y}`] = (t, n) => {
          const l = v ? ae(t, p, $) : oe(t, p),
            g = Be(n, p);
          return C(l, g);
        };
    const I = {};
    if (x.events)
      for (const [y, C] of Object.entries(x.events))
        I[`${p}${K}${y}`] = (t, n) => {
          const l = oe(t, p);
          C(l, n);
        };
    const P = {};
    if (x.constraints)
      for (const [y, C] of Object.entries(x.constraints)) {
        const t = C;
        P[`${p}${K}${y}`] = {
          ...t,
          deps: t.deps?.map((n) => `${p}${K}${n}`),
          when: (n) => {
            const l = v ? ae(n, p, $) : oe(n, p);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (n) => {
                  const l = v ? ae(n, p, $) : oe(n, p);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const H = {};
    if (x.resolvers)
      for (const [y, C] of Object.entries(x.resolvers)) {
        const t = C;
        H[`${p}${K}${y}`] = {
          ...t,
          resolve: async (n, l) => {
            const g = Oe(l.facts, r, () => Object.keys(r));
            await t.resolve(n, { facts: g[p], signal: l.signal });
          },
        };
      }
    const z = {};
    if (x.effects)
      for (const [y, C] of Object.entries(x.effects)) {
        const t = C;
        z[`${p}${K}${y}`] = {
          ...t,
          run: (n, l) => {
            const g = v ? ae(n, p, $) : oe(n, p),
              S = l ? (v ? ae(l, p, $) : oe(l, p)) : void 0;
            return t.run(g, S);
          },
          deps: t.deps?.map((n) => `${p}${K}${n}`),
        };
      }
    h.push({
      id: x.id,
      schema: {
        facts: R,
        derivations: L,
        events: f,
        requirements: x.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: I,
      effects: z,
      constraints: P,
      resolvers: H,
      hooks: x.hooks,
      snapshotEvents:
        o && !o.has(p) ? [] : x.snapshotEvents?.map((y) => `${p}${K}${y}`),
    });
  }
  let m = null,
    c = null;
  function E(p) {
    for (const [x, v] of Object.entries(p))
      if (!ie.has(x) && a.has(x)) {
        if (v && typeof v == "object" && !ve(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [$, R] of Object.entries(v))
          ie.has($) || (c.facts[`${x}${K}${$}`] = R);
      }
  }
  c = ht({
    modules: h.map((p) => ({
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
    })),
    plugins: e.plugins,
    debug: u,
    errorBoundary: d,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && E(e.initialFacts), m && (E(m), (m = null));
    },
  });
  const B = new Map();
  for (const p of Object.keys(r)) {
    const x = r[p];
    if (!x) continue;
    const v = [];
    for (const $ of Object.keys(x.schema.facts)) v.push(`${p}${K}${$}`);
    if (x.schema.derivations)
      for (const $ of Object.keys(x.schema.derivations)) v.push(`${p}${K}${$}`);
    B.set(p, v);
  }
  const O = { names: null };
  function M() {
    return O.names === null && (O.names = Object.keys(r)), O.names;
  }
  let D = Oe(c.facts, r, M),
    k = Ut(c.derive, r, M),
    A = Vt(c, r, M),
    N = null,
    T = e.tickMs;
  return {
    _mode: "namespaced",
    facts: D,
    debug: c.debug,
    derive: k,
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
    async hydrate(p) {
      if (c.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const x = await p();
      x && typeof x == "object" && (m = x);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), T && T > 0)) {
        const p = Object.keys(h[0]?.events ?? {}).find((x) =>
          x.endsWith(`${K}tick`),
        );
        p &&
          (N = setInterval(() => {
            c.dispatch({ type: p });
          }, T));
      }
    },
    stop() {
      N && (clearInterval(N), (N = null)), c.stop();
    },
    destroy() {
      this.stop(), c.destroy();
    },
    dispatch(p) {
      c.dispatch(p);
    },
    batch: c.batch.bind(c),
    read(p) {
      return c.read(de(p));
    },
    subscribe(p, x) {
      const v = [];
      for (const $ of p)
        if ($.endsWith(".*")) {
          const R = $.slice(0, -2),
            L = B.get(R);
          L && v.push(...L);
        } else v.push(de($));
      return c.subscribe(v, x);
    },
    subscribeModule(p, x) {
      const v = B.get(p);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, x);
    },
    watch(p, x, v) {
      return c.watch(de(p), x, v);
    },
    when(p, x) {
      return c.when(() => p(D), x);
    },
    onSettledChange: c.onSettledChange.bind(c),
    onTimeTravelChange: c.onTimeTravelChange.bind(c),
    inspect: c.inspect.bind(c),
    settle: c.settle.bind(c),
    explain: c.explain.bind(c),
    getSnapshot: c.getSnapshot.bind(c),
    restore: c.restore.bind(c),
    getDistributableSnapshot(p) {
      const x = {
          ...p,
          includeDerivations: p?.includeDerivations?.map(de),
          excludeDerivations: p?.excludeDerivations?.map(de),
          includeFacts: p?.includeFacts?.map(de),
        },
        v = c.getDistributableSnapshot(x),
        $ = {};
      for (const [R, L] of Object.entries(v.data)) {
        const f = R.indexOf(K);
        if (f > 0) {
          const b = R.slice(0, f),
            w = R.slice(f + K.length);
          $[b] || ($[b] = {}), ($[b][w] = L);
        } else $._root || ($._root = {}), ($._root[R] = L);
      }
      return { ...v, data: $ };
    },
    watchDistributableSnapshot(p, x) {
      const v = {
        ...p,
        includeDerivations: p?.includeDerivations?.map(de),
        excludeDerivations: p?.excludeDerivations?.map(de),
        includeFacts: p?.includeFacts?.map(de),
      };
      return c.watchDistributableSnapshot(v, ($) => {
        const R = {};
        for (const [L, f] of Object.entries($.data)) {
          const b = L.indexOf(K);
          if (b > 0) {
            const w = L.slice(0, b),
              I = L.slice(b + K.length);
            R[w] || (R[w] = {}), (R[w][I] = f);
          } else R._root || (R._root = {}), (R._root[L] = f);
        }
        x({ ...$, data: R });
      });
    },
    registerModule(p, x) {
      if (a.has(p))
        throw new Error(
          `[Directive] Module namespace "${p}" already exists. Cannot register a duplicate namespace.`,
        );
      if (p.includes(K))
        throw new Error(
          `[Directive] Module name "${p}" contains the reserved separator "${K}".`,
        );
      if (ie.has(p))
        throw new Error(
          `[Directive] Module name "${p}" is a blocked property.`,
        );
      for (const y of Object.keys(x.schema.facts))
        if (y.includes(K))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${p}" contains the reserved separator "${K}".`,
          );
      const v = x,
        $ = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = $ ? Object.keys(v.crossModuleDeps) : [],
        L = {};
      for (const [y, C] of Object.entries(v.schema.facts))
        L[`${p}${K}${y}`] = C;
      const f = v.init
          ? (y) => {
              const C = oe(y, p);
              v.init(C);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, C] of Object.entries(v.derive))
          b[`${p}${K}${y}`] = (t, n) => {
            const l = $ ? ae(t, p, R) : oe(t, p),
              g = Be(n, p);
            return C(l, g);
          };
      const w = {};
      if (v.events)
        for (const [y, C] of Object.entries(v.events))
          w[`${p}${K}${y}`] = (t, n) => {
            const l = oe(t, p);
            C(l, n);
          };
      const I = {};
      if (v.constraints)
        for (const [y, C] of Object.entries(v.constraints)) {
          const t = C;
          I[`${p}${K}${y}`] = {
            ...t,
            deps: t.deps?.map((n) => `${p}${K}${n}`),
            when: (n) => {
              const l = $ ? ae(n, p, R) : oe(n, p);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (n) => {
                    const l = $ ? ae(n, p, R) : oe(n, p);
                    return t.require(l);
                  }
                : t.require,
          };
        }
      const P = {};
      if (v.resolvers)
        for (const [y, C] of Object.entries(v.resolvers)) {
          const t = C;
          P[`${p}${K}${y}`] = {
            ...t,
            resolve: async (n, l) => {
              const g = Oe(l.facts, r, M);
              await t.resolve(n, { facts: g[p], signal: l.signal });
            },
          };
        }
      const H = {};
      if (v.effects)
        for (const [y, C] of Object.entries(v.effects)) {
          const t = C;
          H[`${p}${K}${y}`] = {
            ...t,
            run: (n, l) => {
              const g = $ ? ae(n, p, R) : oe(n, p),
                S = l ? ($ ? ae(l, p, R) : oe(l, p)) : void 0;
              return t.run(g, S);
            },
            deps: t.deps?.map((n) => `${p}${K}${n}`),
          };
        }
      a.add(p), (r[p] = v), (O.names = null);
      const z = [];
      for (const y of Object.keys(v.schema.facts)) z.push(`${p}${K}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          z.push(`${p}${K}${y}`);
      B.set(p, z),
        c.registerModule({
          id: v.id,
          schema: L,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(H).length > 0 ? H : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(P).length > 0 ? P : void 0,
          hooks: v.hooks,
          snapshotEvents:
            o && !o.has(p) ? [] : v.snapshotEvents?.map((y) => `${p}${K}${y}`),
        });
    },
  };
}
function de(e) {
  if (e.includes(".")) {
    const [r, ...a] = e.split(".");
    return `${r}${K}${a.join(K)}`;
  }
  return e;
}
function oe(e, r) {
  let a = Qe.get(e);
  if (a) {
    const i = a.get(r);
    if (i) return i;
  } else (a = new Map()), Qe.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ie.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${r}${K}${s}`];
      },
      set(i, s, u) {
        return typeof s == "symbol" || ie.has(s)
          ? !1
          : ((e[`${r}${K}${s}`] = u), !0);
      },
      has(i, s) {
        return typeof s == "symbol" || ie.has(s) ? !1 : `${r}${K}${s}` in e;
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" || ie.has(s)
          ? !1
          : (delete e[`${r}${K}${s}`], !0);
      },
    },
  );
  return a.set(r, o), o;
}
function Oe(e, r, a) {
  const o = Ze.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ie.has(u) && Object.hasOwn(r, u))
          return oe(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ie.has(u) ? !1 : Object.hasOwn(r, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(r, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ze.set(e, i), i;
}
var rt = new WeakMap();
function ae(e, r, a) {
  let o = `${r}:${JSON.stringify([...a].sort())}`,
    i = rt.get(e);
  if (i) {
    const h = i.get(o);
    if (h) return h;
  } else (i = new Map()), rt.set(e, i);
  const s = new Set(a),
    u = ["self", ...a],
    d = new Proxy(
      {},
      {
        get(h, m) {
          if (typeof m != "symbol" && !ie.has(m)) {
            if (m === "self") return oe(e, r);
            if (s.has(m)) return oe(e, m);
          }
        },
        has(h, m) {
          return typeof m == "symbol" || ie.has(m)
            ? !1
            : m === "self" || s.has(m);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(h, m) {
          if (typeof m != "symbol" && (m === "self" || s.has(m)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(o, d), d;
}
function Be(e, r) {
  let a = tt.get(e);
  if (a) {
    const i = a.get(r);
    if (i) return i;
  } else (a = new Map()), tt.set(e, a);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ie.has(s)) return e[`${r}${K}${s}`];
      },
      has(i, s) {
        return typeof s == "symbol" || ie.has(s) ? !1 : `${r}${K}${s}` in e;
      },
    },
  );
  return a.set(r, o), o;
}
function Ut(e, r, a) {
  const o = et.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ie.has(u) && Object.hasOwn(r, u))
          return Be(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ie.has(u) ? !1 : Object.hasOwn(r, u);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(r, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return et.set(e, i), i;
}
var nt = new WeakMap();
function Vt(e, r, a) {
  let o = nt.get(e);
  return (
    o || ((o = new Map()), nt.set(e, o)),
    new Proxy(
      {},
      {
        get(i, s) {
          if (typeof s == "symbol" || ie.has(s) || !Object.hasOwn(r, s)) return;
          const u = o.get(s);
          if (u) return u;
          const d = new Proxy(
            {},
            {
              get(h, m) {
                if (typeof m != "symbol" && !ie.has(m))
                  return (c) => {
                    e.dispatch({ type: `${s}${K}${m}`, ...c });
                  };
              },
            },
          );
          return o.set(s, d), d;
        },
        has(i, s) {
          return typeof s == "symbol" || ie.has(s) ? !1 : Object.hasOwn(r, s);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(i, s) {
          if (typeof s != "symbol" && Object.hasOwn(r, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Jt(e) {
  const r = e.module;
  if (!r)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof r,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !ve(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let a = e.debug,
    o = e.errorBoundary;
  e.zeroConfig &&
    ((a = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (o = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
    s = null;
  s = ht({
    modules: [
      {
        id: r.id,
        schema: r.schema.facts,
        requirements: r.schema.requirements,
        init: r.init,
        derive: r.derive,
        events: r.events,
        effects: r.effects,
        constraints: r.constraints,
        resolvers: r.resolvers,
        hooks: r.hooks,
        snapshotEvents: r.snapshotEvents,
      },
    ],
    plugins: e.plugins,
    debug: a,
    errorBoundary: o,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [m, c] of Object.entries(e.initialFacts))
          ie.has(m) || (s.facts[m] = c);
      if (i) {
        for (const [m, c] of Object.entries(i)) ie.has(m) || (s.facts[m] = c);
        i = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(m, c) {
          if (typeof c != "symbol" && !ie.has(c))
            return (E) => {
              s.dispatch({ type: c, ...E });
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
    async hydrate(m) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await m();
      c && typeof c == "object" && (i = c);
    },
    initialize() {
      s.initialize();
    },
    start() {
      s.start(),
        h &&
          h > 0 &&
          r.events &&
          "tick" in r.events &&
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
    dispatch(m) {
      s.dispatch(m);
    },
    batch: s.batch.bind(s),
    read(m) {
      return s.read(m);
    },
    subscribe(m, c) {
      return s.subscribe(m, c);
    },
    watch(m, c, E) {
      return s.watch(m, c, E);
    },
    when(m, c) {
      return s.when(m, c);
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
    registerModule(m) {
      s.registerModule({
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
      const r = JSON.stringify(e, (a, o) =>
        typeof o == "bigint"
          ? String(o) + "n"
          : typeof o == "symbol"
            ? String(o)
            : o,
      );
      return r.length > 120 ? r.slice(0, 117) + "..." : r;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function fe(e, r) {
  return e.length <= r ? e : e.slice(0, r - 3) + "...";
}
function Ee(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Yt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Gt(e) {
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
var Qt = 200,
  Re = 340,
  he = 16,
  ge = 80,
  it = 2,
  ot = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Zt() {
  return { entries: new yt(Qt), inflight: new Map() };
}
function er() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var tr = 1e4,
  rr = 100;
function nr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var ir = 50,
  st = 200,
  q = {
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
function or(e, r, a, o) {
  let i = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(r.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(r.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${q.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${q.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const d = document.createElement("button");
  d.setAttribute("aria-label", "Open Directive DevTools"),
    d.setAttribute("aria-expanded", String(a)),
    (d.title = "Ctrl+Shift+D to toggle"),
    Object.assign(d.style, {
      ...s,
      background: q.bg,
      color: q.text,
      border: `1px solid ${q.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: q.font,
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
      background: q.bg,
      color: q.text,
      border: `1px solid ${q.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: q.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: a ? "block" : "none",
    });
  const m = document.createElement("div");
  Object.assign(m.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const c = document.createElement("strong");
  (c.style.color = q.accent),
    (c.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const E = document.createElement("button");
  E.setAttribute("aria-label", "Close DevTools"),
    Object.assign(E.style, {
      background: "none",
      border: "none",
      color: q.closeBtn,
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
    m.appendChild(c),
    m.appendChild(E),
    h.appendChild(m);
  const B = document.createElement("div");
  (B.style.marginBottom = "6px"), B.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = q.green),
    (O.textContent = "Settled"),
    B.appendChild(O),
    h.appendChild(B);
  const M = document.createElement("div");
  Object.assign(M.style, {
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
    border: `1px solid ${q.border}`,
    color: q.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: q.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (D.textContent = "◀ Undo"),
    (D.disabled = !0);
  const k = document.createElement("button");
  Object.assign(k.style, {
    background: "none",
    border: `1px solid ${q.border}`,
    color: q.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: q.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (k.textContent = "Redo ▶"),
    (k.disabled = !0);
  const A = document.createElement("span");
  (A.style.color = q.muted),
    (A.style.fontSize = "10px"),
    M.appendChild(D),
    M.appendChild(k),
    M.appendChild(A),
    h.appendChild(M);
  function N(U, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: q.accent,
      marginBottom: "4px",
    });
    const ue = document.createElement("span");
    (se.textContent = `${U} (`),
      se.appendChild(ue),
      se.appendChild(document.createTextNode(")")),
      (ue.textContent = "0"),
      G.appendChild(se);
    const ce = document.createElement("table");
    Object.assign(ce.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const He = document.createElement("thead"),
      Ke = document.createElement("tr");
    for (const xt of ["Key", "Value"]) {
      const Se = document.createElement("th");
      (Se.scope = "col"),
        Object.assign(Se.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: q.accent,
        }),
        (Se.textContent = xt),
        Ke.appendChild(Se);
    }
    He.appendChild(Ke), ce.appendChild(He);
    const Ue = document.createElement("tbody");
    return (
      ce.appendChild(Ue),
      G.appendChild(ce),
      { details: G, tbody: Ue, countSpan: ue }
    );
  }
  function T(U, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const ue = document.createElement("span");
    (se.textContent = `${U} (`),
      se.appendChild(ue),
      se.appendChild(document.createTextNode(")")),
      (ue.textContent = "0"),
      G.appendChild(se);
    const ce = document.createElement("ul");
    return (
      Object.assign(ce.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(ce),
      { details: G, list: ce, countSpan: ue }
    );
  }
  const p = N("Facts", !0);
  h.appendChild(p.details);
  const x = N("Derivations", !1);
  h.appendChild(x.details);
  const v = T("Inflight", q.yellow);
  h.appendChild(v.details);
  const $ = T("Unmet", q.red);
  h.appendChild($.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const L = document.createElement("summary");
  Object.assign(L.style, {
    cursor: "pointer",
    color: q.accent,
    marginBottom: "4px",
  }),
    (L.textContent = "Performance"),
    R.appendChild(L);
  const f = document.createElement("div");
  (f.style.fontSize = "10px"),
    (f.style.color = q.muted),
    (f.textContent = "No data yet"),
    R.appendChild(f),
    h.appendChild(R);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const w = document.createElement("summary");
  Object.assign(w.style, {
    cursor: "pointer",
    color: q.accent,
    marginBottom: "4px",
  }),
    (w.textContent = "Dependency Graph"),
    b.appendChild(w);
  const I = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  I.setAttribute("width", "100%"),
    I.setAttribute("height", "120"),
    I.setAttribute("role", "img"),
    I.setAttribute("aria-label", "System dependency graph"),
    (I.style.display = "block"),
    I.setAttribute("viewBox", "0 0 460 120"),
    I.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    b.appendChild(I),
    h.appendChild(b);
  const P = document.createElement("details");
  P.style.marginBottom = "4px";
  const H = document.createElement("summary");
  Object.assign(H.style, {
    cursor: "pointer",
    color: q.accent,
    marginBottom: "4px",
  }),
    (H.textContent = "Timeline"),
    P.appendChild(H);
  const z = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  z.setAttribute("width", "100%"),
    z.setAttribute("height", "60"),
    z.setAttribute("role", "img"),
    z.setAttribute("aria-label", "Resolver execution timeline"),
    (z.style.display = "block"),
    z.setAttribute("viewBox", `0 0 ${Re} 60`),
    z.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Re / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", q.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", q.font),
    (y.textContent = "No resolver activity yet"),
    z.appendChild(y),
    P.appendChild(z),
    h.appendChild(P);
  let C, t, n, l;
  if (o) {
    const U = document.createElement("details");
    U.style.marginBottom = "4px";
    const J = document.createElement("summary");
    Object.assign(J.style, {
      cursor: "pointer",
      color: q.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (J.textContent = "Events ("),
      J.appendChild(n),
      J.appendChild(document.createTextNode(")")),
      U.appendChild(J),
      (t = document.createElement("div")),
      Object.assign(t.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      t.setAttribute("role", "log"),
      t.setAttribute("aria-live", "polite"),
      (t.tabIndex = 0);
    const G = document.createElement("div");
    (G.style.color = q.muted),
      (G.style.padding = "4px"),
      (G.textContent = "Waiting for events..."),
      (G.className = "dt-events-empty"),
      t.appendChild(G),
      U.appendChild(t),
      h.appendChild(U),
      (C = U),
      (l = document.createElement("div"));
  } else
    (C = document.createElement("details")),
      (t = document.createElement("div")),
      (n = document.createElement("span")),
      (l = document.createElement("div")),
      (l.style.fontSize = "10px"),
      (l.style.color = q.muted),
      (l.style.marginTop = "4px"),
      (l.style.fontStyle = "italic"),
      (l.textContent = "Enable trace: true for event log"),
      h.appendChild(l);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const S = document.createElement("button");
  Object.assign(S.style, {
    background: "none",
    border: `1px solid ${q.border}`,
    color: q.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: q.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (S.textContent = "⏺ Record");
  const j = document.createElement("button");
  Object.assign(j.style, {
    background: "none",
    border: `1px solid ${q.border}`,
    color: q.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: q.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (j.textContent = "⤓ Export"),
    g.appendChild(S),
    g.appendChild(j),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (U) => {
        const J = h,
          G = J.scrollTop === 0 && U.deltaY < 0,
          se = J.scrollTop + J.clientHeight >= J.scrollHeight && U.deltaY > 0;
        (G || se) && U.preventDefault();
      },
      { passive: !1 },
    );
  let F = a,
    W = new Set();
  function _() {
    (F = !0),
      (h.style.display = "block"),
      (d.style.display = "none"),
      d.setAttribute("aria-expanded", "true"),
      E.focus();
  }
  function V() {
    (F = !1),
      (h.style.display = "none"),
      (d.style.display = "block"),
      d.setAttribute("aria-expanded", "false"),
      d.focus();
  }
  d.addEventListener("click", _), E.addEventListener("click", V);
  function Y(U) {
    U.key === "Escape" && F && V();
  }
  h.addEventListener("keydown", Y);
  function ne(U) {
    U.key === "d" &&
      U.shiftKey &&
      (U.ctrlKey || U.metaKey) &&
      (U.preventDefault(), F ? V() : _());
  }
  document.addEventListener("keydown", ne);
  function ee() {
    i || (document.body.appendChild(d), document.body.appendChild(h));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function X() {
    (i = !0),
      d.removeEventListener("click", _),
      E.removeEventListener("click", V),
      h.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", ne),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const U of W) clearTimeout(U);
    W.clear(), d.remove(), h.remove(), u.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: d,
      titleEl: c,
      statusEl: O,
      factsBody: p.tbody,
      factsCount: p.countSpan,
      derivBody: x.tbody,
      derivCount: x.countSpan,
      derivSection: x.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: $.list,
      unmetSection: $.details,
      unmetCount: $.countSpan,
      perfSection: R,
      perfBody: f,
      timeTravelSection: M,
      timeTravelLabel: A,
      undoBtn: D,
      redoBtn: k,
      flowSection: b,
      flowSvg: I,
      timelineSection: P,
      timelineSvg: z,
      eventsSection: C,
      eventsList: t,
      eventsCount: n,
      traceHint: l,
      recordBtn: S,
      exportBtn: j,
    },
    destroy: X,
    isOpen: () => F,
    flashTimers: W,
  };
}
function $e(e, r, a, o, i, s) {
  let u = vt(o),
    d = e.get(a);
  if (d) {
    const h = d.cells;
    if (h[1] && ((h[1].textContent = u), i && s)) {
      const m = h[1];
      m.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (m.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (d = document.createElement("tr")),
      (d.style.borderBottom = `1px solid ${q.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: q.muted }),
      (h.textContent = a);
    const m = document.createElement("td");
    (m.style.padding = "2px 4px"),
      (m.textContent = u),
      d.appendChild(h),
      d.appendChild(m),
      r.appendChild(d),
      e.set(a, d);
  }
}
function sr(e, r) {
  const a = e.get(r);
  a && (a.remove(), e.delete(r));
}
function Me(e, r, a) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(r.length)),
    r.length > 0)
  )
    for (const o of r) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.resolverId} (${o.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = q.muted),
      (o.textContent = "None"),
      e.inflightList.appendChild(o);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(a.length)),
    a.length > 0)
  )
    for (const o of a) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.requirement.type} from ${o.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = q.muted),
      (o.textContent = "None"),
      e.unmetList.appendChild(o);
  }
}
function je(e, r, a) {
  const o = r === 0 && a === 0;
  (e.statusEl.style.color = o ? q.green : q.yellow),
    (e.statusEl.textContent = o ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = o ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${o ? "" : " (system working)"}`,
    );
}
function lt(e, r, a, o) {
  const i = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    r.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      d = document.createElement("td");
    (d.colSpan = 2),
      (d.style.color = q.muted),
      (d.style.fontSize = "10px"),
      (d.textContent = "No derivations defined"),
      u.appendChild(d),
      e.derivBody.appendChild(u);
    return;
  }
  const s = new Set(i);
  for (const [u, d] of r) s.has(u) || (d.remove(), r.delete(u));
  for (const u of i) {
    let d;
    try {
      d = vt(a.read(u));
    } catch {
      d = "<error>";
    }
    $e(r, e.derivBody, u, d, !0, o);
  }
}
function lr(e, r, a, o) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${q.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    d = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const B = JSON.stringify(a);
    h = fe(B, 60);
  } catch {
    h = "{}";
  }
  const m = document.createElement("span");
  (m.style.color = q.closeBtn), (m.textContent = d);
  const c = document.createElement("span");
  (c.style.color = q.accent), (c.textContent = ` ${r} `);
  const E = document.createElement("span");
  for (
    E.style.color = q.muted,
      E.textContent = h,
      s.appendChild(m),
      s.appendChild(c),
      s.appendChild(E),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > ir;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(o);
}
function ar(e, r) {
  e.perfBody.replaceChildren();
  const a =
      r.reconcileCount > 0
        ? (r.reconcileTotalMs / r.reconcileCount).toFixed(1)
        : "—",
    o = [
      `Reconciles: ${r.reconcileCount}  (avg ${a}ms)`,
      `Effects: ${r.effectRunCount} run, ${r.effectErrorCount} errors`,
    ];
  for (const i of o) {
    const s = document.createElement("div");
    (s.style.marginBottom = "2px"),
      (s.textContent = i),
      e.perfBody.appendChild(s);
  }
  if (r.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = q.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const s = [...r.resolverStats.entries()].sort(
      (u, d) => d[1].totalMs - u[1].totalMs,
    );
    for (const [u, d] of s) {
      const h = d.count > 0 ? (d.totalMs / d.count).toFixed(1) : "0",
        m = document.createElement("div");
      (m.style.paddingLeft = "8px"),
        (m.textContent = `${u}: ${d.count}x, avg ${h}ms${d.errors > 0 ? `, ${d.errors} err` : ""}`),
        d.errors > 0 && (m.style.color = q.red),
        e.perfBody.appendChild(m);
    }
  }
}
function at(e, r) {
  const a = r.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const o = a.currentIndex,
    i = a.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${o + 1} / ${i}` : "0 snapshots";
  const s = o > 0,
    u = o < i - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function dr(e, r) {
  e.undoBtn.addEventListener("click", () => {
    r.debug && r.debug.currentIndex > 0 && r.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      r.debug &&
        r.debug.currentIndex < r.debug.snapshots.length - 1 &&
        r.debug.goForward(1);
    });
}
var Ie = new WeakMap();
function cr(e, r, a, o, i, s) {
  return [
    e.join(","),
    r.join(","),
    a.map((u) => `${u.id}:${u.active}`).join(","),
    [...o.entries()].map(([u, d]) => `${u}:${d.status}:${d.type}`).join(","),
    i.join(","),
    s.join(","),
  ].join("|");
}
function ur(e, r, a, o, i) {
  for (const s of a) {
    const u = e.nodes.get(`0:${s}`);
    if (!u) continue;
    const d = r.recentlyChangedFacts.has(s);
    u.rect.setAttribute("fill", d ? q.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of o) {
    const u = e.nodes.get(`1:${s}`);
    if (!u) continue;
    const d = r.recentlyComputedDerivations.has(s);
    u.rect.setAttribute("fill", d ? q.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of i) {
    const u = e.nodes.get(`2:${s}`);
    if (!u) continue;
    const d = r.recentlyActiveConstraints.has(s),
      h = u.rect.getAttribute("stroke") ?? q.muted;
    u.rect.setAttribute("fill", d ? h + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
}
function dt(e, r, a) {
  const o = Ee(r);
  if (!o) return;
  let i;
  try {
    i = Object.keys(r.facts.$store.toObject());
  } catch {
    i = [];
  }
  const s = Object.keys(r.derive),
    u = o.constraints,
    d = o.unmet,
    h = o.inflight,
    m = Object.keys(o.resolvers),
    c = new Map();
  for (const y of d)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && s.length === 0 && u.length === 0 && m.length === 0) {
    Ie.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
    y.setAttribute("x", "230"),
      y.setAttribute("y", "24"),
      y.setAttribute("text-anchor", "middle"),
      y.setAttribute("fill", q.muted),
      y.setAttribute("font-size", "10"),
      y.setAttribute("font-family", q.font),
      (y.textContent = "No system topology"),
      e.flowSvg.appendChild(y);
    return;
  }
  const E = h.map((y) => y.resolverId).sort(),
    B = cr(i, s, u, c, m, E),
    O = Ie.get(e.flowSvg);
  if (O && O.fingerprint === B) {
    ur(
      O,
      a,
      i,
      s,
      u.map((y) => y.id),
    );
    return;
  }
  const M = Q.nodeW + Q.colGap,
    D = [5, 5 + M, 5 + M * 2, 5 + M * 3, 5 + M * 4],
    k = D[4] + Q.nodeW + 5;
  function A(y) {
    let C = Q.startY + 12;
    return y.map((t) => {
      const n = { ...t, y: C };
      return (C += Q.nodeH + Q.nodeGap), n;
    });
  }
  const N = A(i.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    T = A(s.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    p = A(
      u.map((y) => ({
        id: y.id,
        label: fe(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    x = A(
      [...c.entries()].map(([y, C]) => ({
        id: y,
        type: C.type,
        fromConstraint: C.fromConstraint,
        status: C.status,
      })),
    ),
    v = A(m.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    $ = Math.max(N.length, T.length, p.length, x.length, v.length, 1),
    R = Q.startY + 12 + $ * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${s.length} derivations, ${u.length} constraints, ${c.size} requirements, ${m.length} resolvers`,
    );
  const L = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, C] of L.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(D[y] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", q.accent),
      t.setAttribute("font-size", String(Q.fontSize)),
      t.setAttribute("font-family", q.font),
      (t.textContent = C),
      e.flowSvg.appendChild(t);
  }
  const f = { fingerprint: B, nodes: new Map() };
  function b(y, C, t, n, l, g, S, j) {
    const F = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(C)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", j ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", j ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      F.appendChild(W);
    const _ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      _.setAttribute("x", String(C + 4)),
      _.setAttribute("y", String(t + 4)),
      _.setAttribute("fill", g),
      _.setAttribute("font-size", String(Q.fontSize)),
      _.setAttribute("font-family", q.font),
      _.setAttribute("opacity", S ? "0.35" : "1"),
      (_.textContent = l),
      F.appendChild(_),
      e.flowSvg.appendChild(F),
      f.nodes.set(`${y}:${n}`, { g: F, rect: W, text: _ }),
      { midX: C + Q.nodeW / 2, midY: t }
    );
  }
  function w(y, C, t, n, l, g) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(C)),
      S.setAttribute("x2", String(t)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", l),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const I = new Map(),
    P = new Map(),
    H = new Map(),
    z = new Map();
  for (const y of N) {
    const C = a.recentlyChangedFacts.has(y.id),
      t = b(0, D[0], y.y, y.id, y.label, q.text, !1, C);
    I.set(y.id, t);
  }
  for (const y of T) {
    const C = a.recentlyComputedDerivations.has(y.id),
      t = b(1, D[1], y.y, y.id, y.label, q.accent, !1, C);
    P.set(y.id, t);
  }
  for (const y of p) {
    const C = a.recentlyActiveConstraints.has(y.id),
      t = b(
        2,
        D[2],
        y.y,
        y.id,
        y.label,
        y.active ? q.yellow : q.muted,
        !y.active,
        C,
      );
    H.set(y.id, t);
  }
  for (const y of x) {
    const C = y.status === "unmet" ? q.red : q.yellow,
      t = b(3, D[3], y.y, y.id, fe(y.type, Q.labelMaxChars), C, !1, !1);
    z.set(y.id, t);
  }
  for (const y of v) {
    const C = h.some((t) => t.resolverId === y.id);
    b(4, D[4], y.y, y.id, y.label, C ? q.green : q.muted, !C, !1);
  }
  for (const y of T) {
    const C = a.derivationDeps.get(y.id),
      t = P.get(y.id);
    if (C && t)
      for (const n of C) {
        const l = I.get(n);
        l &&
          w(
            l.midX + Q.nodeW / 2,
            l.midY,
            t.midX - Q.nodeW / 2,
            t.midY,
            q.accent,
          );
      }
  }
  for (const y of x) {
    const C = H.get(y.fromConstraint),
      t = z.get(y.id);
    C &&
      t &&
      w(C.midX + Q.nodeW / 2, C.midY, t.midX - Q.nodeW / 2, t.midY, q.muted);
  }
  for (const y of h) {
    const C = z.get(y.id);
    if (C) {
      const t = v.find((n) => n.id === y.resolverId);
      t && w(C.midX + Q.nodeW / 2, C.midY, D[4], t.y, q.green);
    }
  }
  Ie.set(e.flowSvg, f);
}
function fr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function mr(e, r) {
  const a = r.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let o = 1 / 0,
    i = -1 / 0;
  for (const O of a)
    O.startMs < o && (o = O.startMs), O.endMs > i && (i = O.endMs);
  const s = performance.now();
  for (const O of r.inflight.values()) O < o && (o = O), s > i && (i = s);
  const u = i - o || 1,
    d = Re - ge - 10,
    h = [],
    m = new Set();
  for (const O of a)
    m.has(O.resolver) || (m.add(O.resolver), h.push(O.resolver));
  for (const O of r.inflight.keys()) m.has(O) || (m.add(O), h.push(O));
  const c = h.slice(-12),
    E = he * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Re} ${E}`),
    e.timelineSvg.setAttribute("height", String(Math.min(E, 200)));
  const B = 5;
  for (let O = 0; O <= B; O++) {
    const M = ge + (d * O) / B,
      D = (u * O) / B,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(M)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", q.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", q.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        D < 1e3 ? `${D.toFixed(0)}ms` : `${(D / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const A = document.createElementNS("http://www.w3.org/2000/svg", "line");
    A.setAttribute("x1", String(M)),
      A.setAttribute("y1", "10"),
      A.setAttribute("x2", String(M)),
      A.setAttribute("y2", String(E)),
      A.setAttribute("stroke", q.border),
      A.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(A);
  }
  for (let O = 0; O < c.length; O++) {
    const M = c[O],
      D = 12 + O * he,
      k = O % ot.length,
      A = ot[k],
      N = document.createElementNS("http://www.w3.org/2000/svg", "text");
    N.setAttribute("x", String(ge - 4)),
      N.setAttribute("y", String(D + he / 2 + 3)),
      N.setAttribute("fill", q.muted),
      N.setAttribute("font-size", "7"),
      N.setAttribute("font-family", q.font),
      N.setAttribute("text-anchor", "end"),
      (N.textContent = fe(M, 12)),
      e.timelineSvg.appendChild(N);
    const T = a.filter((x) => x.resolver === M);
    for (const x of T) {
      const v = ge + ((x.startMs - o) / u) * d,
        $ = Math.max(((x.endMs - x.startMs) / u) * d, it),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(D + 2)),
        R.setAttribute("width", String($)),
        R.setAttribute("height", String(he - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", x.error ? q.red : A),
        R.setAttribute("opacity", "0.8");
      const L = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = x.endMs - x.startMs;
      (L.textContent = `${M}: ${f.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        R.appendChild(L),
        e.timelineSvg.appendChild(R);
    }
    const p = r.inflight.get(M);
    if (p !== void 0) {
      const x = ge + ((p - o) / u) * d,
        v = Math.max(((s - p) / u) * d, it),
        $ = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      $.setAttribute("x", String(x)),
        $.setAttribute("y", String(D + 2)),
        $.setAttribute("width", String(v)),
        $.setAttribute("height", String(he - 4)),
        $.setAttribute("rx", "2"),
        $.setAttribute("fill", A),
        $.setAttribute("opacity", "0.4"),
        $.setAttribute("stroke", A),
        $.setAttribute("stroke-width", "1"),
        $.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${M}: inflight ${(s - p).toFixed(0)}ms`),
        $.appendChild(R),
        e.timelineSvg.appendChild($);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${c.length} resolvers`,
  );
}
function pr() {
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
      r = {
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
        explain(a, o) {
          return this.getSystem(o)?.explain(a) ?? null;
        },
        subscribe(a, o) {
          const i = o ? e.get(o) : e.values().next().value;
          if (!i) {
            let s = !1,
              u = setInterval(() => {
                const h = o ? e.get(o) : e.values().next().value;
                h && !s && ((s = !0), h.subscribers.add(a));
              }, 100),
              d = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(d);
              for (const h of e.values()) h.subscribers.delete(a);
            };
          }
          return (
            i.subscribers.add(a),
            () => {
              i.subscribers.delete(a);
            }
          );
        },
        exportSession(a) {
          const o = a ? e.get(a) : e.values().next().value;
          return o
            ? JSON.stringify({
                version: 1,
                name: a ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: o.events.toArray(),
              })
            : null;
        },
        importSession(a, o) {
          try {
            if (a.length > 10 * 1024 * 1024) return !1;
            const i = JSON.parse(a);
            if (
              !i ||
              typeof i != "object" ||
              Array.isArray(i) ||
              !Array.isArray(i.events)
            )
              return !1;
            const s = o ? e.get(o) : e.values().next().value;
            if (!s) return !1;
            const u = s.maxEvents,
              d = i.events,
              h = d.length > u ? d.length - u : 0;
            s.events.clear();
            for (let m = h; m < d.length; m++) {
              const c = d[m];
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
          const o = a ? e.get(a) : e.values().next().value;
          o && o.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: r,
        writable: !1,
        configurable: Ne(),
        enumerable: !0,
      }),
      r
    );
  }
  return window.__DIRECTIVE__;
}
function bt(e = {}) {
  const {
      name: r = "default",
      trace: a = !1,
      maxEvents: o,
      panel: i = !1,
      position: s = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    d = Gt(o),
    h = pr(),
    m = {
      system: null,
      events: new yt(d),
      maxEvents: d,
      subscribers: new Set(),
    };
  h.systems.set(r, m);
  let c = (n, l) => {
      const g = { timestamp: Date.now(), type: n, data: l };
      a && m.events.push(g);
      for (const S of m.subscribers)
        try {
          S(g);
        } catch {}
    },
    E = null,
    B = new Map(),
    O = new Map(),
    M = Xt(),
    D = er(),
    k = nr(),
    A = Zt(),
    N = i && typeof window < "u" && typeof document < "u" && Ne(),
    T = null,
    p = 0,
    x = 1,
    v = 2,
    $ = 4,
    R = 8,
    L = 16,
    f = 32,
    b = 64,
    w = 128,
    I = new Map(),
    P = new Set(),
    H = null;
  function z(n) {
    (p |= n),
      T === null &&
        typeof requestAnimationFrame < "u" &&
        (T = requestAnimationFrame(y));
  }
  function y() {
    if (((T = null), !E || !m.system)) {
      p = 0;
      return;
    }
    const n = E.refs,
      l = m.system,
      g = p;
    if (((p = 0), g & x)) {
      for (const S of P) sr(B, S);
      P.clear();
      for (const [S, { value: j, flash: F }] of I)
        $e(B, n.factsBody, S, j, F, E.flashTimers);
      I.clear(), (n.factsCount.textContent = String(B.size));
    }
    if ((g & v && lt(n, O, l, E.flashTimers), g & R))
      if (H) je(n, H.inflight.length, H.unmet.length);
      else {
        const S = Ee(l);
        S && je(n, S.inflight.length, S.unmet.length);
      }
    if (g & $)
      if (H) Me(n, H.inflight, H.unmet);
      else {
        const S = Ee(l);
        S && Me(n, S.inflight, S.unmet);
      }
    g & L && ar(n, M),
      g & f && dt(n, l, D),
      g & b && at(n, l),
      g & w && mr(n, A);
  }
  function C(n, l) {
    E && a && lr(E.refs, n, l, m.events.size);
  }
  function t(n, l) {
    k.isRecording &&
      k.recordedEvents.length < tr &&
      k.recordedEvents.push({ timestamp: Date.now(), type: n, data: Yt(l) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((m.system = n),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${r}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        N)
      ) {
        const l = m.system;
        E = or(r, s, u, a);
        const g = E.refs;
        try {
          const j = l.facts.$store.toObject();
          for (const [F, W] of Object.entries(j)) $e(B, g.factsBody, F, W, !1);
          g.factsCount.textContent = String(Object.keys(j).length);
        } catch {}
        lt(g, O, l);
        const S = Ee(l);
        S &&
          (je(g, S.inflight.length, S.unmet.length),
          Me(g, S.inflight, S.unmet)),
          at(g, l),
          dr(g, l),
          dt(g, l, D),
          g.recordBtn.addEventListener("click", () => {
            if (
              ((k.isRecording = !k.isRecording),
              (g.recordBtn.textContent = k.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = k.isRecording ? q.red : q.text),
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
            const j =
                k.recordedEvents.length > 0
                  ? k.recordedEvents
                  : m.events.toArray(),
              F = JSON.stringify(
                {
                  version: 1,
                  name: r,
                  exportedAt: Date.now(),
                  events: j,
                  snapshots: k.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([F], { type: "application/json" }),
              _ = URL.createObjectURL(W),
              V = document.createElement("a");
            (V.href = _),
              (V.download = `directive-session-${r}-${Date.now()}.json`),
              V.click(),
              URL.revokeObjectURL(_);
          });
      }
    },
    onStart: (n) => {
      c("start", {}), C("start", {}), t("start", {});
    },
    onStop: (n) => {
      c("stop", {}), C("stop", {}), t("stop", {});
    },
    onDestroy: (n) => {
      c("destroy", {}),
        h.systems.delete(r),
        T !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(T), (T = null)),
        D.animationTimer && clearTimeout(D.animationTimer),
        E && (E.destroy(), (E = null), B.clear(), O.clear());
    },
    onFactSet: (n, l, g) => {
      c("fact.set", { key: n, value: l, prev: g }),
        t("fact.set", { key: n, value: l, prev: g }),
        D.recentlyChangedFacts.add(n),
        E &&
          m.system &&
          (I.set(n, { value: l, flash: !0 }),
          P.delete(n),
          z(x),
          C("fact.set", { key: n, value: l }));
    },
    onFactDelete: (n, l) => {
      c("fact.delete", { key: n, prev: l }),
        t("fact.delete", { key: n, prev: l }),
        E && (P.add(n), I.delete(n), z(x), C("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        t("facts.batch", { count: n.length }),
        E && m.system)
      ) {
        for (const l of n)
          l.type === "delete"
            ? (P.add(l.key), I.delete(l.key))
            : (D.recentlyChangedFacts.add(l.key),
              I.set(l.key, { value: l.value, flash: !0 }),
              P.delete(l.key));
        z(x), C("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, l, g) => {
      c("derivation.compute", { id: n, value: l, deps: g }),
        t("derivation.compute", { id: n, deps: g }),
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
        (M.lastReconcileStartMs = performance.now()),
        C("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (c("reconcile.end", n),
        t("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
          completed: n.completed.length,
        }),
        M.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - M.lastReconcileStartMs;
        M.reconcileCount++,
          (M.reconcileTotalMs += l),
          (M.lastReconcileStartMs = 0);
      }
      if (k.isRecording && m.system && k.snapshots.length < rr)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: m.system.facts.$store.toObject(),
          });
        } catch {}
      E &&
        m.system &&
        ((H = n),
        fr(D),
        z(v | R | $ | L | f | b),
        C("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, l) => {
      c("constraint.evaluate", { id: n, active: l }),
        t("constraint.evaluate", { id: n, active: l }),
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
        t("requirement.created", { id: n.id, type: n.requirement.type }),
        C("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, l) => {
      c("requirement.met", { id: n.id, byResolver: l }),
        t("requirement.met", { id: n.id, byResolver: l }),
        C("requirement.met", { id: n.id, byResolver: l });
    },
    onRequirementCanceled: (n) => {
      c("requirement.canceled", { id: n.id }),
        t("requirement.canceled", { id: n.id }),
        C("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, l) => {
      c("resolver.start", { resolver: n, requirementId: l.id }),
        t("resolver.start", { resolver: n, requirementId: l.id }),
        A.inflight.set(n, performance.now()),
        E &&
          m.system &&
          (z($ | R | w),
          C("resolver.start", { resolver: n, requirementId: l.id }));
    },
    onResolverComplete: (n, l, g) => {
      c("resolver.complete", { resolver: n, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: n,
          requirementId: l.id,
          duration: g,
        });
      const S = M.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += g),
        M.resolverStats.set(n, S),
        M.resolverStats.size > st)
      ) {
        const F = M.resolverStats.keys().next().value;
        F !== void 0 && M.resolverStats.delete(F);
      }
      const j = A.inflight.get(n);
      A.inflight.delete(n),
        j !== void 0 &&
          A.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !1,
          }),
        E &&
          m.system &&
          (z($ | R | L | w),
          C("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, l, g) => {
      c("resolver.error", {
        resolver: n,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: n,
          requirementId: l.id,
          error: String(g),
        });
      const S = M.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, M.resolverStats.set(n, S), M.resolverStats.size > st)) {
        const F = M.resolverStats.keys().next().value;
        F !== void 0 && M.resolverStats.delete(F);
      }
      const j = A.inflight.get(n);
      A.inflight.delete(n),
        j !== void 0 &&
          A.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !0,
          }),
        E &&
          m.system &&
          (z($ | R | L | w),
          C("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, l, g) => {
      c("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: n, requirementId: l.id, attempt: g }),
        C("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, l) => {
      c("resolver.cancel", { resolver: n, requirementId: l.id }),
        t("resolver.cancel", { resolver: n, requirementId: l.id }),
        A.inflight.delete(n),
        C("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        t("effect.run", { id: n }),
        M.effectRunCount++,
        C("effect.run", { id: n });
    },
    onEffectError: (n, l) => {
      c("effect.error", { id: n, error: String(l) }),
        M.effectErrorCount++,
        C("effect.error", { id: n, error: String(l) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        E && m.system && z(b),
        C("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, l) => {
      if (
        (c("timetravel.jump", { from: n, to: l }),
        t("timetravel.jump", { from: n, to: l }),
        E && m.system)
      ) {
        const g = m.system;
        try {
          const S = g.facts.$store.toObject();
          B.clear(), E.refs.factsBody.replaceChildren();
          for (const [j, F] of Object.entries(S))
            $e(B, E.refs.factsBody, j, F, !1);
          E.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        O.clear(),
          D.derivationDeps.clear(),
          E.refs.derivBody.replaceChildren(),
          (H = null),
          z(v | R | $ | f | b),
          C("timetravel.jump", { from: n, to: l });
      }
    },
    onError: (n) => {
      c("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        t("error", { source: n.source, message: n.message }),
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
const ct = [
  "Sunny",
  "Cloudy",
  "Rainy",
  "Windy",
  "Foggy",
  "Stormy",
  "Clear",
  "Snowy",
];
async function hr(e, r) {
  await new Promise((o) => setTimeout(o, r));
  const a = [...e.toLowerCase()].reduce((o, i) => o + i.charCodeAt(0), 0);
  return {
    temperature: 32 + (a % 68),
    condition: ct[a % ct.length],
    humidity: 20 + (a % 60),
  };
}
function gr(e, r, a) {
  const o = [...e.eventLog];
  o.push({ timestamp: Date.now(), event: r, detail: a }),
    o.length > 50 && o.splice(0, o.length - 50),
    (e.eventLog = o);
}
const yr = {
    facts: { loadedModules: te.object(), eventLog: te.object() },
    derivations: { loadedCount: te.number() },
    events: { moduleLoaded: { name: te.string() } },
    requirements: {},
  },
  wt = De("dashboard", {
    schema: yr,
    init: (e) => {
      (e.loadedModules = []), (e.eventLog = []);
    },
    derive: { loadedCount: (e) => e.loadedModules.length },
    events: {
      moduleLoaded: (e, { name: r }) => {
        (e.loadedModules = [...e.loadedModules, r]),
          gr(e, "loaded", `Loaded "${r}" module`);
      },
    },
  }),
  vr = {
    facts: { count: te.number(), step: te.number() },
    derivations: { isNearMax: te.boolean() },
    events: { increment: {}, decrement: {}, setStep: { value: te.number() } },
    requirements: { COUNTER_RESET: {} },
  },
  br = De("counter", {
    schema: vr,
    init: (e) => {
      (e.count = 0), (e.step = 1);
    },
    derive: { isNearMax: (e) => e.count >= 90 },
    events: {
      increment: (e) => {
        e.count = e.count + e.step;
      },
      decrement: (e) => {
        e.count = Math.max(0, e.count - e.step);
      },
      setStep: (e, { value: r }) => {
        e.step = r;
      },
    },
    constraints: {
      overflow: {
        priority: 100,
        when: (e) => e.count >= 100,
        require: () => ({ type: "COUNTER_RESET" }),
      },
    },
    resolvers: {
      counterReset: {
        requirement: "COUNTER_RESET",
        resolve: async (e, r) => {
          r.facts.count = 0;
        },
      },
    },
  }),
  wr = {
    facts: {
      city: te.string(),
      temperature: te.number(),
      condition: te.string(),
      humidity: te.number(),
      isLoading: te.boolean(),
      lastFetchedCity: te.string(),
    },
    derivations: { summary: te.string(), hasFetched: te.boolean() },
    events: { setCity: { value: te.string() }, refresh: {} },
    requirements: { FETCH_WEATHER: { city: te.string() } },
  },
  Sr = De("weather", {
    schema: wr,
    init: (e) => {
      (e.city = ""),
        (e.temperature = 0),
        (e.condition = ""),
        (e.humidity = 0),
        (e.isLoading = !1),
        (e.lastFetchedCity = "");
    },
    derive: {
      summary: (e) =>
        e.city === "" ? "" : `${e.temperature}°F, ${e.condition}`,
      hasFetched: (e) => e.lastFetchedCity !== "",
    },
    events: {
      setCity: (e, { value: r }) => {
        e.city = r;
      },
      refresh: (e) => {
        e.lastFetchedCity = "";
      },
    },
    constraints: {
      needsFetch: {
        priority: 100,
        when: (e) =>
          e.city.length >= 2 && e.city !== e.lastFetchedCity && !e.isLoading,
        require: (e) => ({ type: "FETCH_WEATHER", city: e.city }),
      },
    },
    resolvers: {
      fetchWeather: {
        requirement: "FETCH_WEATHER",
        key: (e) => `weather-${e.city}`,
        timeout: 1e4,
        resolve: async (e, r) => {
          r.facts.isLoading = !0;
          const a = await hr(e.city, 800);
          r.facts.city === e.city &&
            ((r.facts.temperature = a.temperature),
            (r.facts.condition = a.condition),
            (r.facts.humidity = a.humidity),
            (r.facts.lastFetchedCity = e.city)),
            (r.facts.isLoading = !1);
        },
      },
    },
  }),
  xr = {
    facts: { die1: te.number(), die2: te.number(), rollCount: te.number() },
    derivations: { total: te.number(), isDoubles: te.boolean() },
    events: { roll: {} },
    requirements: {},
  },
  Er = De("dice", {
    schema: xr,
    init: (e) => {
      (e.die1 = 1), (e.die2 = 1), (e.rollCount = 0);
    },
    derive: {
      total: (e) => e.die1 + e.die2,
      isDoubles: (e) => e.die1 === e.die2,
    },
    events: {
      roll: (e) => {
        (e.die1 = Math.floor(Math.random() * 6) + 1),
          (e.die2 = Math.floor(Math.random() * 6) + 1),
          (e.rollCount = e.rollCount + 1);
      },
    },
  }),
  $r = {
    counter: { module: br, label: "Counter" },
    weather: { module: Sr, label: "Weather" },
    dice: { module: Er, label: "Dice" },
  };
let Z = gt({
  modules: { dashboard: wt },
  plugins: [bt({ name: "dynamic-modules" })],
});
Z.start();
const pe = [];
function Pe() {
  for (const r of pe) r();
  (pe.length = 0), pe.push(Z.subscribeModule("dashboard", we));
  const e = Z.facts.dashboard.loadedModules;
  for (const r of e) pe.push(Z.subscribeModule(r, we));
}
const ut = document.getElementById("dm-status-badge"),
  Cr = document.getElementById("dm-status-text"),
  be = document.getElementById("dm-widgets-area"),
  qe = document.getElementById("dm-timeline"),
  Le = document.getElementById("dm-load-counter"),
  ze = document.getElementById("dm-load-weather"),
  Fe = document.getElementById("dm-load-dice"),
  kr = document.getElementById("dm-reset-btn"),
  ft = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
function we() {
  const e = Z.facts.dashboard,
    r = e.loadedModules,
    a = Z.derive.dashboard.loadedCount,
    o = e.eventLog;
  if (
    ((Cr.textContent = `${a} / 3 loaded`),
    a > 0
      ? (ut.className = "dm-status-badge active")
      : (ut.className = "dm-status-badge"),
    r.length === 0)
  )
    be.innerHTML =
      '<div class="dm-widgets-empty">Load a module to get started</div>';
  else {
    be.innerHTML = "";
    for (const i of r)
      i === "counter" ? Rr() : i === "weather" ? Ar() : i === "dice" && Dr();
  }
  Or(o);
}
function Rr() {
  const e = Z.facts.counter,
    r = Z.derive.counter,
    a = e.count,
    o = e.step,
    i = r.isNearMax,
    s = document.createElement("div");
  (s.className = "dm-widget-card counter"),
    s.setAttribute("data-testid", "dm-widget-counter"),
    (s.innerHTML = `
    <div class="dm-widget-header">Counter</div>
    <div class="dm-widget-body">
      <div class="dm-counter-display" data-testid="dm-counter-value">${a}</div>
      ${i ? '<div class="dm-counter-near-max">Near max (100)</div>' : ""}
      <div class="dm-counter-controls">
        <button class="dm-btn dm-btn-sm" data-testid="dm-counter-decrement">&minus;</button>
        <button class="dm-btn dm-btn-sm" data-testid="dm-counter-increment">+</button>
      </div>
      <div class="dm-step-row">
        <span>Step</span>
        <input type="range" min="1" max="10" value="${o}" data-testid="dm-counter-step" />
        <span class="dm-step-val">${o}</span>
      </div>
    </div>
  `),
    be.appendChild(s),
    s
      .querySelector('[data-testid="dm-counter-increment"]')
      .addEventListener("click", () => {
        Z.events.counter.increment();
      }),
    s
      .querySelector('[data-testid="dm-counter-decrement"]')
      .addEventListener("click", () => {
        Z.events.counter.decrement();
      }),
    s
      .querySelector('[data-testid="dm-counter-step"]')
      .addEventListener("input", (u) => {
        const d = Number(u.target.value);
        Z.events.counter.setStep({ value: d });
      });
}
function Ar() {
  const e = Z.facts.weather,
    r = Z.derive.weather,
    a = e.city,
    o = e.isLoading,
    i = r.hasFetched,
    s = r.summary,
    u = e.humidity,
    d = document.createElement("div");
  (d.className = "dm-widget-card weather"),
    d.setAttribute("data-testid", "dm-widget-weather");
  let h;
  o
    ? (h = '<div class="dm-weather-loading">Fetching weather...</div>')
    : i
      ? (h = `
      <div class="dm-weather-data">
        <div class="dm-weather-temp" data-testid="dm-weather-summary">${Ae(s)}</div>
        <div class="dm-weather-humidity">Humidity: ${u}%</div>
      </div>
    `)
      : (h = '<div class="dm-weather-empty">Enter a city</div>');
  const m = document.querySelector('[data-testid="dm-weather-city"]'),
    c = m ? m.value : a;
  (d.innerHTML = `
    <div class="dm-widget-header">Weather</div>
    <div class="dm-widget-body">
      <div class="dm-weather-input-row">
        <input
          class="dm-input"
          type="text"
          placeholder="Enter city..."
          value="${Ae(c)}"
          autocomplete="off"
          data-testid="dm-weather-city"
        />
        <button class="dm-btn dm-btn-sm dm-btn-secondary" data-testid="dm-weather-refresh" ${i ? "" : "disabled"}>Refresh</button>
      </div>
      ${h}
    </div>
  `),
    be.appendChild(d);
  const E = d.querySelector('[data-testid="dm-weather-city"]');
  E.addEventListener("input", () => {
    Z.events.weather.setCity({ value: E.value });
  }),
    d
      .querySelector('[data-testid="dm-weather-refresh"]')
      .addEventListener("click", () => {
        Z.events.weather.refresh();
      }),
    m &&
      document.activeElement === m &&
      (E.focus(),
      (E.selectionStart = E.value.length),
      (E.selectionEnd = E.value.length));
}
function Dr() {
  const e = Z.facts.dice,
    r = Z.derive.dice,
    a = e.die1,
    o = e.die2,
    i = r.total,
    s = r.isDoubles,
    u = e.rollCount,
    d = document.createElement("div");
  (d.className = "dm-widget-card dice"),
    d.setAttribute("data-testid", "dm-widget-dice"),
    (d.innerHTML = `
    <div class="dm-widget-header">Dice</div>
    <div class="dm-widget-body">
      <div class="dm-dice-faces">
        <span data-testid="dm-dice-die1">${ft[a - 1]}</span>
        <span data-testid="dm-dice-die2">${ft[o - 1]}</span>
      </div>
      <div class="dm-dice-info">
        <span data-testid="dm-dice-total">Total: ${i}</span>
        ${s ? '<span class="dm-doubles-badge" data-testid="dm-dice-doubles">Doubles!</span>' : ""}
      </div>
      <div class="dm-dice-roll-count">Rolls: ${u}</div>
      <button class="dm-btn dm-btn-sm" data-testid="dm-dice-roll">Roll</button>
    </div>
  `),
    be.appendChild(d),
    d
      .querySelector('[data-testid="dm-dice-roll"]')
      .addEventListener("click", () => {
        Z.events.dice.roll();
      });
}
function Or(e) {
  if (e.length === 0) {
    qe.innerHTML =
      '<div class="dm-timeline-empty">Events will appear here</div>';
    return;
  }
  qe.innerHTML = "";
  for (let r = e.length - 1; r >= 0; r--) {
    const a = e[r],
      o = document.createElement("div");
    let i = "loaded";
    a.event === "loaded"
      ? (i = "loaded")
      : a.detail.includes("counter") || a.event.includes("counter")
        ? (i = "counter")
        : a.detail.includes("weather") || a.event.includes("weather")
          ? (i = "weather")
          : (a.detail.includes("dice") || a.event.includes("dice")) &&
            (i = "dice"),
      (o.className = `dm-timeline-entry ${i}`);
    const u = new Date(a.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    (o.innerHTML = `
      <span class="dm-timeline-time">${u}</span>
      <span class="dm-timeline-event">${Ae(a.event)}</span>
      <span class="dm-timeline-detail">${Ae(a.detail)}</span>
    `),
      qe.appendChild(o);
  }
}
function We(e) {
  const r = $r[e];
  !r ||
    Z.facts.dashboard.loadedModules.includes(e) ||
    (Z.registerModule(e, r.module),
    Z.events.dashboard.moduleLoaded({ name: e }),
    Pe(),
    St(),
    we());
}
function St() {
  const e = Z.facts.dashboard.loadedModules;
  (Le.disabled = e.includes("counter")),
    (Le.textContent = e.includes("counter") ? "Loaded" : "Load"),
    (ze.disabled = e.includes("weather")),
    (ze.textContent = e.includes("weather") ? "Loaded" : "Load"),
    (Fe.disabled = e.includes("dice")),
    (Fe.textContent = e.includes("dice") ? "Loaded" : "Load");
}
function Mr() {
  for (const e of pe) e();
  (pe.length = 0),
    (Z = gt({
      modules: { dashboard: wt },
      plugins: [bt({ name: "dynamic-modules" })],
    })),
    Z.start(),
    Pe(),
    St(),
    we();
}
Le.addEventListener("click", () => We("counter"));
ze.addEventListener("click", () => We("weather"));
Fe.addEventListener("click", () => We("dice"));
kr.addEventListener("click", () => Mr());
Pe();
function Ae(e) {
  const r = document.createElement("div");
  return (r.textContent = e), r.innerHTML;
}
we();
document.body.setAttribute("data-dynamic-modules-ready", "true");
