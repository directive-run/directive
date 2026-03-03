(() => {
  const r = document.createElement("link").relList;
  if (r && r.supports && r.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) s(i);
  new MutationObserver((i) => {
    for (const o of i)
      if (o.type === "childList")
        for (const d of o.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && s(d);
  }).observe(document, { childList: !0, subtree: !0 });
  function c(i) {
    const o = {};
    return (
      i.integrity && (o.integrity = i.integrity),
      i.referrerPolicy && (o.referrerPolicy = i.referrerPolicy),
      i.crossOrigin === "use-credentials"
        ? (o.credentials = "include")
        : i.crossOrigin === "anonymous"
          ? (o.credentials = "omit")
          : (o.credentials = "same-origin"),
      o
    );
  }
  function s(i) {
    if (i.ep) return;
    i.ep = !0;
    const o = c(i);
    fetch(i.href, o);
  }
})();
var Qe = class extends Error {
    constructor(r, c, s, i, o = !0) {
      super(r),
        (this.source = c),
        (this.sourceId = s),
        (this.context = i),
        (this.recoverable = o),
        (this.name = "DirectiveError");
    }
  },
  me = [];
function Dt() {
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
var At = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function Ot() {
  return me[me.length - 1] ?? At;
}
function ke(e) {
  const r = Dt();
  me.push(r);
  try {
    return { value: e(), deps: r.getDependencies() };
  } finally {
    me.pop();
  }
}
function Ze(e) {
  const r = me.splice(0, me.length);
  try {
    return e();
  } finally {
    me.push(...r);
  }
}
function Le(e) {
  Ot().track(e);
}
function jt(e, r = 100) {
  try {
    return JSON.stringify(e)?.slice(0, r) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function De(e = [], r, c, s, i, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: r,
    _default: c,
    _transform: s,
    _description: i,
    _refinements: o,
    validate(d) {
      return De([...e, d], r, c, s, i, o);
    },
  };
}
function ee(e, r, c, s, i, o) {
  return {
    ...De(e, r, c, s, i, o),
    default(d) {
      return ee(e, r, d, s, i, o);
    },
    transform(d) {
      return ee(
        [],
        r,
        void 0,
        (l) => {
          const p = s ? s(l) : l;
          return d(p);
        },
        i,
      );
    },
    brand() {
      return ee(e, `Branded<${r}>`, c, s, i, o);
    },
    describe(d) {
      return ee(e, r, c, s, d, o);
    },
    refine(d, l) {
      const p = [...(o ?? []), { predicate: d, message: l }];
      return ee([...e, d], r, c, s, i, p);
    },
    nullable() {
      return ee(
        [(d) => d === null || e.every((l) => l(d))],
        `${r} | null`,
        c,
        s,
        i,
      );
    },
    optional() {
      return ee(
        [(d) => d === void 0 || e.every((l) => l(d))],
        `${r} | undefined`,
        c,
        s,
        i,
      );
    },
  };
}
var te = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (r, c, s, i, o) => ({
      ...ee(r, "number", c, s, i, o),
      min(d) {
        return e([...r, (l) => l >= d], c, s, i, o);
      },
      max(d) {
        return e([...r, (l) => l <= d], c, s, i, o);
      },
      default(d) {
        return e(r, d, s, i, o);
      },
      describe(d) {
        return e(r, c, s, d, o);
      },
      refine(d, l) {
        const p = [...(o ?? []), { predicate: d, message: l }];
        return e([...r, d], c, s, i, p);
      },
    });
    return e([(r) => typeof r == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (r, c, s, i, o) => {
      const d = ee(r, "array", s, void 0, i),
        l = o ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return l.value;
        },
        set _lastFailedIndex(p) {
          l.value = p;
        },
        of(p) {
          const f = { value: -1 };
          return e(
            [
              ...r,
              (u) => {
                for (let x = 0; x < u.length; x++) {
                  const M = u[x];
                  if (!p._validators.every((D) => D(M)))
                    return (f.value = x), !1;
                }
                return !0;
              },
            ],
            p,
            s,
            i,
            f,
          );
        },
        nonEmpty() {
          return e([...r, (p) => p.length > 0], c, s, i, l);
        },
        maxLength(p) {
          return e([...r, (f) => f.length <= p], c, s, i, l);
        },
        minLength(p) {
          return e([...r, (f) => f.length >= p], c, s, i, l);
        },
        default(p) {
          return e(r, c, p, i, l);
        },
        describe(p) {
          return e(r, c, s, p, l);
        },
      };
    };
    return e([(r) => Array.isArray(r)]);
  },
  object() {
    const e = (r, c, s) => ({
      ...ee(r, "object", c, void 0, s),
      shape(i) {
        return e(
          [
            ...r,
            (o) => {
              for (const [d, l] of Object.entries(i)) {
                const p = o[d],
                  f = l;
                if (f && !f._validators.every((u) => u(p))) return !1;
              }
              return !0;
            },
          ],
          c,
          s,
        );
      },
      nonNull() {
        return e([...r, (i) => i != null], c, s);
      },
      hasKeys(...i) {
        return e([...r, (o) => i.every((d) => d in o)], c, s);
      },
      default(i) {
        return e(r, i, s);
      },
      describe(i) {
        return e(r, c, i);
      },
    });
    return e([(r) => typeof r == "object" && r !== null && !Array.isArray(r)]);
  },
  enum(...e) {
    const r = new Set(e);
    return ee(
      [(c) => typeof c == "string" && r.has(c)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(r) => r === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const r = e._typeName ?? "unknown";
    return De(
      [(c) => (c === null ? !0 : e._validators.every((s) => s(c)))],
      `${r} | null`,
    );
  },
  optional(e) {
    const r = e._typeName ?? "unknown";
    return De(
      [(c) => (c === void 0 ? !0 : e._validators.every((s) => s(c)))],
      `${r} | undefined`,
    );
  },
  union(...e) {
    const r = e.map((c) => c._typeName ?? "unknown");
    return ee(
      [(c) => e.some((s) => s._validators.every((i) => i(c)))],
      r.join(" | "),
    );
  },
  record(e) {
    const r = e._typeName ?? "unknown";
    return ee(
      [
        (c) =>
          typeof c != "object" || c === null || Array.isArray(c)
            ? !1
            : Object.values(c).every((s) => e._validators.every((i) => i(s))),
      ],
      `Record<string, ${r}>`,
    );
  },
  tuple(...e) {
    const r = e.map((c) => c._typeName ?? "unknown");
    return ee(
      [
        (c) =>
          !Array.isArray(c) || c.length !== e.length
            ? !1
            : e.every((s, i) => s._validators.every((o) => o(c[i]))),
      ],
      `[${r.join(", ")}]`,
    );
  },
  date() {
    return ee([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ee([(r) => typeof r == "string" && e.test(r)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return ee([(r) => typeof r == "string" && e.test(r)], "email");
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
function It(e) {
  const { schema: r, onChange: c, onBatch: s } = e;
  Object.keys(r).length;
  let i = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    l = new Map(),
    p = new Set(),
    f = new Map(),
    u = new Set(),
    x = 0,
    M = [],
    D = new Set(),
    A = !1,
    j = [],
    $ = 100;
  function O(m) {
    return (
      m !== null &&
      typeof m == "object" &&
      "safeParse" in m &&
      typeof m.safeParse == "function" &&
      "_def" in m &&
      "parse" in m &&
      typeof m.parse == "function"
    );
  }
  function P(m) {
    const b = m;
    if (b._typeName) return b._typeName;
    if (O(m)) {
      const w = m._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function _(m) {
    return d ? "[redacted]" : jt(m);
  }
  function h(m, b) {
    if (!i) return;
    const w = r[m];
    if (!w) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${m}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${m}"`);
      return;
    }
    if (O(w)) {
      const F = w.safeParse(b);
      if (!F.success) {
        const v = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          R = _(b),
          t =
            F.error?.message ??
            F.error?.issues?.[0]?.message ??
            "Validation failed",
          n = P(w);
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${n}, got ${v} ${R}. ${t}`,
        );
      }
      return;
    }
    const q = w,
      N = q._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const K = q._typeName ?? "unknown";
    for (let F = 0; F < N.length; F++) {
      const v = N[F];
      if (typeof v == "function" && !v(b)) {
        let R = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          t = _(b),
          n = "";
        typeof q._lastFailedIndex == "number" &&
          q._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${q._lastFailedIndex} failed)`),
          (q._lastFailedIndex = -1));
        const a = F === 0 ? "" : ` (validator ${F + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${K}, got ${R} ${t}${a}${n}`,
        );
      }
    }
  }
  function E(m) {
    f.get(m)?.forEach((b) => b());
  }
  function y() {
    u.forEach((m) => m());
  }
  function C(m, b, w) {
    if (A) {
      j.push({ key: m, value: b, prev: w });
      return;
    }
    A = !0;
    try {
      c?.(m, b, w), E(m), y();
      let q = 0;
      while (j.length > 0) {
        if (++q > $)
          throw (
            ((j.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${$} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...j];
        j.length = 0;
        for (const K of N) c?.(K.key, K.value, K.prev), E(K.key);
        y();
      }
    } finally {
      A = !1;
    }
  }
  function k() {
    if (!(x > 0)) {
      if ((s && M.length > 0 && s([...M]), D.size > 0)) {
        A = !0;
        try {
          for (const b of D) E(b);
          y();
          let m = 0;
          while (j.length > 0) {
            if (++m > $)
              throw (
                ((j.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${$} iterations.`,
                ))
              );
            const b = [...j];
            j.length = 0;
            for (const w of b) c?.(w.key, w.value, w.prev), E(w.key);
            y();
          }
        } finally {
          A = !1;
        }
      }
      (M.length = 0), D.clear();
    }
  }
  const z = {
    get(m) {
      return Le(m), l.get(m);
    },
    has(m) {
      return Le(m), l.has(m);
    },
    set(m, b) {
      h(m, b);
      const w = l.get(m);
      Object.is(w, b) ||
        (l.set(m, b),
        p.add(m),
        x > 0
          ? (M.push({ key: m, value: b, prev: w, type: "set" }), D.add(m))
          : C(m, b, w));
    },
    delete(m) {
      const b = l.get(m);
      l.delete(m),
        p.delete(m),
        x > 0
          ? (M.push({ key: m, value: void 0, prev: b, type: "delete" }),
            D.add(m))
          : C(m, void 0, b);
    },
    batch(m) {
      x++;
      try {
        m();
      } finally {
        x--, k();
      }
    },
    subscribe(m, b) {
      for (const w of m) {
        const q = w;
        f.has(q) || f.set(q, new Set()), f.get(q).add(b);
      }
      return () => {
        for (const w of m) {
          const q = f.get(w);
          q && (q.delete(b), q.size === 0 && f.delete(w));
        }
      };
    },
    subscribeAll(m) {
      return u.add(m), () => u.delete(m);
    },
    toObject() {
      const m = {};
      for (const b of p) l.has(b) && (m[b] = l.get(b));
      return m;
    },
  };
  return (
    (z.registerKeys = (m) => {
      for (const b of Object.keys(m)) ye.has(b) || ((r[b] = m[b]), p.add(b));
    }),
    z
  );
}
var ye = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Mt(e, r) {
  const c = () => ({
    get: (s) => Ze(() => e.get(s)),
    has: (s) => Ze(() => e.has(s)),
  });
  return new Proxy(
    {},
    {
      get(s, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return c;
        if (typeof i != "symbol" && !ye.has(i)) return e.get(i);
      },
      set(s, i, o) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.set(i, o), !0);
      },
      deleteProperty(s, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          ye.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(s, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || ye.has(i)
            ? !1
            : e.has(i);
      },
      ownKeys() {
        return Object.keys(r);
      },
      getOwnPropertyDescriptor(s, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function qt(e) {
  const r = It(e),
    c = Mt(r, e.schema);
  return { store: r, facts: c };
}
function Ke(e, r) {
  const c = "crossModuleDeps" in r ? r.crossModuleDeps : void 0;
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
    crossModuleDeps: c,
  };
}
async function Se(e, r, c) {
  let s,
    i = new Promise((o, d) => {
      s = setTimeout(() => d(new Error(c)), r);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(s);
  }
}
function wt(e, r = 50) {
  const c = new WeakSet();
  function s(i, o) {
    if (o > r) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const d = typeof i;
    if (d === "string") return JSON.stringify(i);
    if (d === "number" || d === "boolean") return String(i);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (c.has(i)) return '"[circular]"';
      c.add(i);
      const l = `[${i.map((p) => s(p, o + 1)).join(",")}]`;
      return c.delete(i), l;
    }
    if (d === "object") {
      const l = i;
      if (c.has(l)) return '"[circular]"';
      c.add(l);
      const p = `{${Object.keys(l)
        .sort()
        .map((f) => `${JSON.stringify(f)}:${s(l[f], o + 1)}`)
        .join(",")}}`;
      return c.delete(l), p;
    }
    return '"[unknown]"';
  }
  return s(e, 0);
}
function be(e, r = 50) {
  const c = new Set(["__proto__", "constructor", "prototype"]),
    s = new WeakSet();
  function i(o, d) {
    if (d > r) return !1;
    if (o == null || typeof o != "object") return !0;
    const l = o;
    if (s.has(l)) return !0;
    if ((s.add(l), Array.isArray(l))) {
      for (const p of l) if (!i(p, d + 1)) return s.delete(l), !1;
      return s.delete(l), !0;
    }
    for (const p of Object.keys(l))
      if (c.has(p) || !i(l[p], d + 1)) return s.delete(l), !1;
    return s.delete(l), !0;
  }
  return i(e, 0);
}
function Bt(e) {
  let r = wt(e),
    c = 5381;
  for (let s = 0; s < r.length; s++) c = ((c << 5) + c) ^ r.charCodeAt(s);
  return (c >>> 0).toString(16);
}
function _t(e, r) {
  if (r) return r(e);
  const { type: c, ...s } = e,
    i = wt(s);
  return `${c}:${i}`;
}
function Tt(e, r, c) {
  return { requirement: e, id: _t(e, c), fromConstraint: r };
}
var Pe = class St {
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
      const r = new St();
      for (const c of this.map.values()) r.add(c);
      return r;
    }
    diff(r) {
      const c = [],
        s = [],
        i = [];
      for (const o of this.map.values()) r.has(o.id) ? i.push(o) : c.push(o);
      for (const o of r.map.values()) this.map.has(o.id) || s.push(o);
      return { added: c, removed: s, unchanged: i };
    }
  },
  zt = 5e3;
function Ft(e) {
  let {
      definitions: r,
      facts: c,
      requirementKeys: s = {},
      defaultTimeout: i = zt,
      onEvaluate: o,
      onError: d,
    } = e,
    l = new Map(),
    p = new Set(),
    f = new Set(),
    u = new Map(),
    x = new Map(),
    M = new Set(),
    D = new Map(),
    A = new Map(),
    j = !1,
    $ = new Set(),
    O = new Set(),
    P = new Map(),
    _ = [],
    h = new Map();
  function E() {
    for (const [t, n] of Object.entries(r))
      if (n.after)
        for (const a of n.after)
          r[a] && (P.has(a) || P.set(a, new Set()), P.get(a).add(t));
  }
  function y() {
    const t = new Set(),
      n = new Set(),
      a = [];
    function g(S, I) {
      if (t.has(S)) return;
      if (n.has(S)) {
        const W = I.indexOf(S),
          T = [...I.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${T}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), I.push(S);
      const L = r[S];
      if (L?.after) for (const W of L.after) r[W] && g(W, I);
      I.pop(), n.delete(S), t.add(S), a.push(S);
    }
    for (const S of Object.keys(r)) g(S, []);
    (_ = a), (h = new Map(_.map((S, I) => [S, I])));
  }
  y(), E();
  function C(t, n) {
    return n.async !== void 0 ? n.async : !!f.has(t);
  }
  function k(t) {
    const n = r[t];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const a = C(t, n);
    a && f.add(t);
    const g = {
      id: t,
      priority: n.priority ?? 0,
      isAsync: a,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return l.set(t, g), g;
  }
  function z(t) {
    return l.get(t) ?? k(t);
  }
  function m(t, n) {
    const a = u.get(t) ?? new Set();
    for (const g of a) {
      const S = x.get(g);
      S?.delete(t), S && S.size === 0 && x.delete(g);
    }
    for (const g of n) x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    u.set(t, n);
  }
  function b(t) {
    const n = r[t];
    if (!n) return !1;
    const a = z(t);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(c)), D.set(t, new Set(n.deps));
      else {
        const S = ke(() => n.when(c));
        (g = S.value), D.set(t, S.deps);
      }
      return g instanceof Promise
        ? (f.add(t),
          (a.isAsync = !0),
          g
            .then(
              (S) => ((a.lastResult = S), (a.isEvaluating = !1), o?.(t, S), S),
            )
            .catch(
              (S) => (
                (a.error = S instanceof Error ? S : new Error(String(S))),
                (a.lastResult = !1),
                (a.isEvaluating = !1),
                d?.(t, S),
                !1
              ),
            ))
        : ((a.lastResult = g), (a.isEvaluating = !1), o?.(t, g), g);
    } catch (g) {
      return (
        (a.error = g instanceof Error ? g : new Error(String(g))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(t, g),
        !1
      );
    }
  }
  async function w(t) {
    const n = r[t];
    if (!n) return !1;
    const a = z(t),
      g = n.timeout ?? i;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      m(t, S), D.set(t, S);
    }
    try {
      const S = n.when(c),
        I = await Se(S, g, `Constraint "${t}" timed out after ${g}ms`);
      return (a.lastResult = I), (a.isEvaluating = !1), o?.(t, I), I;
    } catch (S) {
      return (
        (a.error = S instanceof Error ? S : new Error(String(S))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(t, S),
        !1
      );
    }
  }
  function q(t, n) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const n = r[t];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: g, deps: S } = ke(() => a(c));
      return { requirements: q(g), deps: S };
    }
    return { requirements: q(a), deps: new Set() };
  }
  function K(t, n) {
    if (n.size === 0) return;
    const a = u.get(t) ?? new Set();
    for (const g of n)
      a.add(g), x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    u.set(t, a);
  }
  let F = null;
  function v() {
    return (
      F ||
        (F = Object.keys(r).sort((t, n) => {
          const a = z(t),
            g = z(n).priority - a.priority;
          if (g !== 0) return g;
          const S = h.get(t) ?? 0,
            I = h.get(n) ?? 0;
          return S - I;
        })),
      F
    );
  }
  for (const t of Object.keys(r)) k(t);
  function R(t) {
    const n = l.get(t);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (r[a] && !p.has(a) && !O.has(a) && !$.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const n = new Pe();
      O.clear();
      let a = v().filter((T) => !p.has(T)),
        g;
      if (!j || !t || t.size === 0) (g = a), (j = !0);
      else {
        const T = new Set();
        for (const U of t) {
          const Y = x.get(U);
          if (Y) for (const re of Y) p.has(re) || T.add(re);
        }
        for (const U of M) p.has(U) || T.add(U);
        M.clear(), (g = [...T]);
        for (const U of a)
          if (!T.has(U)) {
            const Y = A.get(U);
            if (Y) for (const re of Y) n.add(re);
          }
      }
      function S(T, U) {
        if (p.has(T)) return;
        const Y = D.get(T);
        if (!U) {
          Y !== void 0 && m(T, Y), O.add(T), A.set(T, []);
          return;
        }
        O.delete(T);
        let re, Z;
        try {
          const X = N(T);
          (re = X.requirements), (Z = X.deps);
        } catch (X) {
          d?.(T, X), Y !== void 0 && m(T, Y), A.set(T, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const H of Z) X.add(H);
          m(T, X);
        } else K(T, Z);
        if (re.length > 0) {
          const X = s[T],
            H = re.map((J) => Tt(J, T, X));
          for (const J of H) n.add(J);
          A.set(T, H);
        } else A.set(T, []);
      }
      async function I(T) {
        const U = [],
          Y = [];
        for (const H of T)
          if (R(H)) Y.push(H);
          else {
            U.push(H);
            const J = A.get(H);
            if (J) for (const G of J) n.add(G);
          }
        if (Y.length === 0) return U;
        const re = [],
          Z = [];
        for (const H of Y) z(H).isAsync ? Z.push(H) : re.push(H);
        const X = [];
        for (const H of re) {
          const J = b(H);
          if (J instanceof Promise) {
            X.push({ id: H, promise: J });
            continue;
          }
          S(H, J);
        }
        if (X.length > 0) {
          const H = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of H) S(J, G);
        }
        if (Z.length > 0) {
          const H = await Promise.all(
            Z.map(async (J) => ({ id: J, active: await w(J) })),
          );
          for (const { id: J, active: G } of H) S(J, G);
        }
        return U;
      }
      let L = g,
        W = g.length + 1;
      while (L.length > 0 && W > 0) {
        const T = L.length;
        if (((L = await I(L)), L.length === T)) break;
        W--;
      }
      return n.all();
    },
    getState(t) {
      return l.get(t);
    },
    getAllStates() {
      return [...l.values()];
    },
    disable(t) {
      p.add(t), (F = null), A.delete(t);
      const n = u.get(t);
      if (n) {
        for (const a of n) {
          const g = x.get(a);
          g && (g.delete(t), g.size === 0 && x.delete(a));
        }
        u.delete(t);
      }
      D.delete(t);
    },
    enable(t) {
      p.delete(t), (F = null), M.add(t);
    },
    invalidate(t) {
      const n = x.get(t);
      if (n) for (const a of n) M.add(a);
    },
    markResolved(t) {
      $.add(t);
      const n = l.get(t);
      n && (n.lastResolvedAt = Date.now());
      const a = P.get(t);
      if (a) for (const g of a) M.add(g);
    },
    isResolved(t) {
      return $.has(t);
    },
    registerDefinitions(t) {
      for (const [n, a] of Object.entries(t)) (r[n] = a), k(n), M.add(n);
      (F = null), y(), E();
    },
  };
}
function Lt(e) {
  let {
      definitions: r,
      facts: c,
      onCompute: s,
      onInvalidate: i,
      onError: o,
    } = e,
    d = new Map(),
    l = new Map(),
    p = new Map(),
    f = new Map(),
    u = new Set(["__proto__", "constructor", "prototype"]),
    x = 0,
    M = new Set(),
    D = !1,
    A = 100,
    j;
  function $(y) {
    if (!r[y]) throw new Error(`[Directive] Unknown derivation: ${y}`);
    const C = {
      id: y,
      compute: () => P(y),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(y, C), C;
  }
  function O(y) {
    return d.get(y) ?? $(y);
  }
  function P(y) {
    const C = O(y),
      k = r[y];
    if (!k) throw new Error(`[Directive] Unknown derivation: ${y}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${y}`,
      );
    C.isComputing = !0;
    try {
      const { value: z, deps: m } = ke(() => k(c, j));
      return (
        (C.cachedValue = z), (C.isStale = !1), _(y, m), s?.(y, z, [...m]), z
      );
    } catch (z) {
      throw (o?.(y, z), z);
    } finally {
      C.isComputing = !1;
    }
  }
  function _(y, C) {
    const k = O(y),
      z = k.dependencies;
    for (const m of z)
      if (d.has(m)) {
        const b = f.get(m);
        b?.delete(y), b && b.size === 0 && f.delete(m);
      } else {
        const b = p.get(m);
        b?.delete(y), b && b.size === 0 && p.delete(m);
      }
    for (const m of C)
      r[m]
        ? (f.has(m) || f.set(m, new Set()), f.get(m).add(y))
        : (p.has(m) || p.set(m, new Set()), p.get(m).add(y));
    k.dependencies = C;
  }
  function h() {
    if (!(x > 0 || D)) {
      D = !0;
      try {
        let y = 0;
        while (M.size > 0) {
          if (++y > A) {
            const k = [...M];
            throw (
              (M.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${A} iterations. Remaining: ${k.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [...M];
          M.clear();
          for (const k of C) l.get(k)?.forEach((z) => z());
        }
      } finally {
        D = !1;
      }
    }
  }
  function E(y, C = new Set()) {
    if (C.has(y)) return;
    C.add(y);
    const k = d.get(y);
    if (!k || k.isStale) return;
    (k.isStale = !0), i?.(y), M.add(y);
    const z = f.get(y);
    if (z) for (const m of z) E(m, C);
  }
  return (
    (j = new Proxy(
      {},
      {
        get(y, C) {
          if (typeof C == "symbol" || u.has(C)) return;
          Le(C);
          const k = O(C);
          return k.isStale && P(C), k.cachedValue;
        },
      },
    )),
    {
      get(y) {
        const C = O(y);
        return C.isStale && P(y), C.cachedValue;
      },
      isStale(y) {
        return d.get(y)?.isStale ?? !0;
      },
      invalidate(y) {
        const C = p.get(y);
        if (C) {
          x++;
          try {
            for (const k of C) E(k);
          } finally {
            x--, h();
          }
        }
      },
      invalidateMany(y) {
        x++;
        try {
          for (const C of y) {
            const k = p.get(C);
            if (k) for (const z of k) E(z);
          }
        } finally {
          x--, h();
        }
      },
      invalidateAll() {
        x++;
        try {
          for (const y of d.values())
            y.isStale || ((y.isStale = !0), M.add(y.id));
        } finally {
          x--, h();
        }
      },
      subscribe(y, C) {
        for (const k of y) {
          const z = k;
          l.has(z) || l.set(z, new Set()), l.get(z).add(C);
        }
        return () => {
          for (const k of y) {
            const z = k,
              m = l.get(z);
            m?.delete(C), m && m.size === 0 && l.delete(z);
          }
        };
      },
      getProxy() {
        return j;
      },
      getDependencies(y) {
        return O(y).dependencies;
      },
      registerDefinitions(y) {
        for (const [C, k] of Object.entries(y)) (r[C] = k), $(C);
      },
    }
  );
}
function Pt(e) {
  let { definitions: r, facts: c, store: s, onRun: i, onError: o } = e,
    d = new Map(),
    l = null,
    p = !1;
  function f($) {
    const O = r[$];
    if (!O) throw new Error(`[Directive] Unknown effect: ${$}`);
    const P = {
      id: $,
      enabled: !0,
      hasExplicitDeps: !!O.deps,
      dependencies: O.deps ? new Set(O.deps) : null,
      cleanup: null,
    };
    return d.set($, P), P;
  }
  function u($) {
    return d.get($) ?? f($);
  }
  function x() {
    return s.toObject();
  }
  function M($, O) {
    const P = u($);
    if (!P.enabled) return !1;
    if (P.dependencies) {
      for (const _ of P.dependencies) if (O.has(_)) return !0;
      return !1;
    }
    return !0;
  }
  function D($) {
    if ($.cleanup) {
      try {
        $.cleanup();
      } catch (O) {
        o?.($.id, O),
          console.error(
            `[Directive] Effect "${$.id}" cleanup threw an error:`,
            O,
          );
      }
      $.cleanup = null;
    }
  }
  function A($, O) {
    if (typeof O == "function")
      if (p)
        try {
          O();
        } catch (P) {
          o?.($.id, P),
            console.error(
              `[Directive] Effect "${$.id}" cleanup threw an error:`,
              P,
            );
        }
      else $.cleanup = O;
  }
  async function j($) {
    const O = u($),
      P = r[$];
    if (!(!O.enabled || !P)) {
      D(O), i?.($);
      try {
        if (O.hasExplicitDeps) {
          let _;
          if (
            (s.batch(() => {
              _ = P.run(c, l);
            }),
            _ instanceof Promise)
          ) {
            const h = await _;
            A(O, h);
          } else A(O, _);
        } else {
          let _ = null,
            h,
            E = ke(
              () => (
                s.batch(() => {
                  h = P.run(c, l);
                }),
                h
              ),
            );
          _ = E.deps;
          let y = E.value;
          y instanceof Promise && (y = await y),
            A(O, y),
            (O.dependencies = _.size > 0 ? _ : null);
        }
      } catch (_) {
        o?.($, _),
          console.error(`[Directive] Effect "${$}" threw an error:`, _);
      }
    }
  }
  for (const $ of Object.keys(r)) f($);
  return {
    async runEffects($) {
      const O = [];
      for (const P of Object.keys(r)) M(P, $) && O.push(P);
      await Promise.all(O.map(j)), (l = x());
    },
    async runAll() {
      const $ = Object.keys(r);
      await Promise.all(
        $.map((O) => (u(O).enabled ? j(O) : Promise.resolve())),
      ),
        (l = x());
    },
    disable($) {
      const O = u($);
      O.enabled = !1;
    },
    enable($) {
      const O = u($);
      O.enabled = !0;
    },
    isEnabled($) {
      return u($).enabled;
    },
    cleanupAll() {
      p = !0;
      for (const $ of d.values()) D($);
    },
    registerDefinitions($) {
      for (const [O, P] of Object.entries($)) (r[O] = P), f(O);
    },
  };
}
function Nt(e = {}) {
  const {
      delayMs: r = 1e3,
      maxRetries: c = 3,
      backoffMultiplier: s = 2,
      maxDelayMs: i = 3e4,
    } = e,
    o = new Map();
  function d(l) {
    const p = r * Math.pow(s, l - 1);
    return Math.min(p, i);
  }
  return {
    scheduleRetry(l, p, f, u, x) {
      if (u > c) return null;
      const M = d(u),
        D = {
          source: l,
          sourceId: p,
          context: f,
          attempt: u,
          nextRetryTime: Date.now() + M,
          callback: x,
        };
      return o.set(p, D), D;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const l = Date.now(),
        p = [];
      for (const [f, u] of o) u.nextRetryTime <= l && (p.push(u), o.delete(f));
      return p;
    },
    cancelRetry(l) {
      o.delete(l);
    },
    clearAll() {
      o.clear();
    },
  };
}
var Wt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Kt(e = {}) {
  const { config: r = {}, onError: c, onRecovery: s } = e,
    i = [],
    o = 100,
    d = Nt(r.retryLater),
    l = new Map();
  function p(u, x, M, D) {
    if (M instanceof Qe) return M;
    const A = M instanceof Error ? M.message : String(M),
      j = u !== "system";
    return new Qe(A, u, x, D, j);
  }
  function f(u, x, M) {
    const D = (() => {
      switch (u) {
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
    if (typeof D == "function") {
      try {
        D(M, x);
      } catch (A) {
        console.error("[Directive] Error in error handler callback:", A);
      }
      return "skip";
    }
    return typeof D == "string" ? D : Wt[u];
  }
  return {
    handleError(u, x, M, D) {
      const A = p(u, x, M, D);
      i.push(A), i.length > o && i.shift();
      try {
        c?.(A);
      } catch ($) {
        console.error("[Directive] Error in onError callback:", $);
      }
      try {
        r.onError?.(A);
      } catch ($) {
        console.error("[Directive] Error in config.onError callback:", $);
      }
      let j = f(u, x, M instanceof Error ? M : new Error(String(M)));
      if (j === "retry-later") {
        const $ = (l.get(x) ?? 0) + 1;
        l.set(x, $),
          d.scheduleRetry(u, x, D, $) ||
            ((j = "skip"), l.delete(x), typeof process < "u");
      }
      try {
        s?.(A, j);
      } catch ($) {
        console.error("[Directive] Error in onRecovery callback:", $);
      }
      if (j === "throw") throw A;
      return j;
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
      return d;
    },
    processDueRetries() {
      return d.processDueRetries();
    },
    clearRetryAttempts(u) {
      l.delete(u), d.cancelRetry(u);
    },
  };
}
function Vt() {
  const e = [];
  function r(s) {
    if (s)
      try {
        return s();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  async function c(s) {
    if (s)
      try {
        return await s();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  return {
    register(s) {
      e.some((i) => i.name === s.name) &&
        (console.warn(
          `[Directive] Plugin "${s.name}" is already registered, replacing...`,
        ),
        this.unregister(s.name)),
        e.push(s);
    },
    unregister(s) {
      const i = e.findIndex((o) => o.name === s);
      i !== -1 && e.splice(i, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(s) {
      for (const i of e) await c(() => i.onInit?.(s));
    },
    emitStart(s) {
      for (const i of e) r(() => i.onStart?.(s));
    },
    emitStop(s) {
      for (const i of e) r(() => i.onStop?.(s));
    },
    emitDestroy(s) {
      for (const i of e) r(() => i.onDestroy?.(s));
    },
    emitFactSet(s, i, o) {
      for (const d of e) r(() => d.onFactSet?.(s, i, o));
    },
    emitFactDelete(s, i) {
      for (const o of e) r(() => o.onFactDelete?.(s, i));
    },
    emitFactsBatch(s) {
      for (const i of e) r(() => i.onFactsBatch?.(s));
    },
    emitDerivationCompute(s, i, o) {
      for (const d of e) r(() => d.onDerivationCompute?.(s, i, o));
    },
    emitDerivationInvalidate(s) {
      for (const i of e) r(() => i.onDerivationInvalidate?.(s));
    },
    emitReconcileStart(s) {
      for (const i of e) r(() => i.onReconcileStart?.(s));
    },
    emitReconcileEnd(s) {
      for (const i of e) r(() => i.onReconcileEnd?.(s));
    },
    emitConstraintEvaluate(s, i) {
      for (const o of e) r(() => o.onConstraintEvaluate?.(s, i));
    },
    emitConstraintError(s, i) {
      for (const o of e) r(() => o.onConstraintError?.(s, i));
    },
    emitRequirementCreated(s) {
      for (const i of e) r(() => i.onRequirementCreated?.(s));
    },
    emitRequirementMet(s, i) {
      for (const o of e) r(() => o.onRequirementMet?.(s, i));
    },
    emitRequirementCanceled(s) {
      for (const i of e) r(() => i.onRequirementCanceled?.(s));
    },
    emitResolverStart(s, i) {
      for (const o of e) r(() => o.onResolverStart?.(s, i));
    },
    emitResolverComplete(s, i, o) {
      for (const d of e) r(() => d.onResolverComplete?.(s, i, o));
    },
    emitResolverError(s, i, o) {
      for (const d of e) r(() => d.onResolverError?.(s, i, o));
    },
    emitResolverRetry(s, i, o) {
      for (const d of e) r(() => d.onResolverRetry?.(s, i, o));
    },
    emitResolverCancel(s, i) {
      for (const o of e) r(() => o.onResolverCancel?.(s, i));
    },
    emitEffectRun(s) {
      for (const i of e) r(() => i.onEffectRun?.(s));
    },
    emitEffectError(s, i) {
      for (const o of e) r(() => o.onEffectError?.(s, i));
    },
    emitSnapshot(s) {
      for (const i of e) r(() => i.onSnapshot?.(s));
    },
    emitTimeTravel(s, i) {
      for (const o of e) r(() => o.onTimeTravel?.(s, i));
    },
    emitError(s) {
      for (const i of e) r(() => i.onError?.(s));
    },
    emitErrorRecovery(s, i) {
      for (const o of e) r(() => o.onErrorRecovery?.(s, i));
    },
  };
}
var et = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  tt = { enabled: !1, windowMs: 50 };
function rt(e, r) {
  let { backoff: c, initialDelay: s = 100, maxDelay: i = 3e4 } = e,
    o;
  switch (c) {
    case "none":
      o = s;
      break;
    case "linear":
      o = s * r;
      break;
    case "exponential":
      o = s * Math.pow(2, r - 1);
      break;
    default:
      o = s;
  }
  return Math.max(1, Math.min(o, i));
}
function Ht(e) {
  const {
      definitions: r,
      facts: c,
      store: s,
      onStart: i,
      onComplete: o,
      onError: d,
      onRetry: l,
      onCancel: p,
      onResolutionComplete: f,
    } = e,
    u = new Map(),
    x = new Map(),
    M = 1e3,
    D = new Map(),
    A = new Map(),
    j = 1e3;
  function $() {
    if (x.size > M) {
      const m = x.size - M,
        b = x.keys();
      for (let w = 0; w < m; w++) {
        const q = b.next().value;
        q && x.delete(q);
      }
    }
  }
  function O(m) {
    return (
      typeof m == "object" &&
      m !== null &&
      "requirement" in m &&
      typeof m.requirement == "string"
    );
  }
  function P(m) {
    return (
      typeof m == "object" &&
      m !== null &&
      "requirement" in m &&
      typeof m.requirement == "function"
    );
  }
  function _(m, b) {
    return O(m) ? b.type === m.requirement : P(m) ? m.requirement(b) : !1;
  }
  function h(m) {
    const b = m.type,
      w = A.get(b);
    if (w)
      for (const q of w) {
        const N = r[q];
        if (N && _(N, m)) return q;
      }
    for (const [q, N] of Object.entries(r))
      if (_(N, m)) {
        if (!A.has(b)) {
          if (A.size >= j) {
            const F = A.keys().next().value;
            F !== void 0 && A.delete(F);
          }
          A.set(b, []);
        }
        const K = A.get(b);
        return K.includes(q) || K.push(q), q;
      }
    return null;
  }
  function E(m) {
    return { facts: c, signal: m, snapshot: () => c.$snapshot() };
  }
  async function y(m, b, w) {
    const q = r[m];
    if (!q) return;
    let N = { ...et, ...q.retry },
      K = null;
    for (let F = 1; F <= N.attempts; F++) {
      if (w.signal.aborted) return;
      const v = u.get(b.id);
      v &&
        ((v.attempt = F),
        (v.status = {
          state: "running",
          requirementId: b.id,
          startedAt: v.startedAt,
          attempt: F,
        }));
      try {
        const R = E(w.signal);
        if (q.resolve) {
          let n;
          s.batch(() => {
            n = q.resolve(b.requirement, R);
          });
          const a = q.timeout;
          a && a > 0
            ? await Se(n, a, `Resolver "${m}" timed out after ${a}ms`)
            : await n;
        }
        const t = Date.now() - (v?.startedAt ?? Date.now());
        x.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: t,
        }),
          $(),
          o?.(m, b, t);
        return;
      } catch (R) {
        if (
          ((K = R instanceof Error ? R : new Error(String(R))),
          w.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(K, F)) break;
        if (F < N.attempts) {
          if (w.signal.aborted) return;
          const t = rt(N, F);
          if (
            (l?.(m, b, F + 1),
            await new Promise((n) => {
              const a = setTimeout(n, t),
                g = () => {
                  clearTimeout(a), n();
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
      attempts: N.attempts,
    }),
      $(),
      d?.(m, b, K);
  }
  async function C(m, b) {
    const w = r[m];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((t) => {
          const n = new AbortController();
          return y(m, t, n);
        }),
      );
      return;
    }
    let q = { ...et, ...w.retry },
      N = { ...tt, ...w.batch },
      K = new AbortController(),
      F = Date.now(),
      v = null,
      R = N.timeoutMs ?? w.timeout;
    for (let t = 1; t <= q.attempts; t++) {
      if (K.signal.aborted) return;
      try {
        const n = E(K.signal),
          a = b.map((g) => g.requirement);
        if (w.resolveBatchWithResults) {
          let g, S;
          if (
            (s.batch(() => {
              S = w.resolveBatchWithResults(a, n);
            }),
            R && R > 0
              ? (g = await Se(
                  S,
                  R,
                  `Batch resolver "${m}" timed out after ${R}ms`,
                ))
              : (g = await S),
            g.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${m}" returned ${g.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let I = Date.now() - F,
            L = !1;
          for (let W = 0; W < b.length; W++) {
            const T = b[W],
              U = g[W];
            if (U.success)
              x.set(T.id, {
                state: "success",
                requirementId: T.id,
                completedAt: Date.now(),
                duration: I,
              }),
                o?.(m, T, I);
            else {
              L = !0;
              const Y = U.error ?? new Error("Batch item failed");
              x.set(T.id, {
                state: "error",
                requirementId: T.id,
                error: Y,
                failedAt: Date.now(),
                attempts: t,
              }),
                d?.(m, T, Y);
            }
          }
          if (!L || b.some((W, T) => g[T]?.success)) return;
        } else {
          let g;
          s.batch(() => {
            g = w.resolveBatch(a, n);
          }),
            R && R > 0
              ? await Se(g, R, `Batch resolver "${m}" timed out after ${R}ms`)
              : await g;
          const S = Date.now() - F;
          for (const I of b)
            x.set(I.id, {
              state: "success",
              requirementId: I.id,
              completedAt: Date.now(),
              duration: S,
            }),
              o?.(m, I, S);
          return;
        }
      } catch (n) {
        if (
          ((v = n instanceof Error ? n : new Error(String(n))),
          K.signal.aborted)
        )
          return;
        if (q.shouldRetry && !q.shouldRetry(v, t)) break;
        if (t < q.attempts) {
          const a = rt(q, t);
          for (const g of b) l?.(m, g, t + 1);
          if (
            (await new Promise((g) => {
              const S = setTimeout(g, a),
                I = () => {
                  clearTimeout(S), g();
                };
              K.signal.addEventListener("abort", I, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const t of b)
      x.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: v,
        failedAt: Date.now(),
        attempts: q.attempts,
      }),
        d?.(m, t, v);
    $();
  }
  function k(m, b) {
    const w = r[m];
    if (!w) return;
    const q = { ...tt, ...w.batch };
    D.has(m) || D.set(m, { resolverId: m, requirements: [], timer: null });
    const N = D.get(m);
    N.requirements.push(b),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        z(m);
      }, q.windowMs));
  }
  function z(m) {
    const b = D.get(m);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      C(m, w).then(() => {
        f?.();
      });
  }
  return {
    resolve(m) {
      if (u.has(m.id)) return;
      const b = h(m.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${m.id}`);
        return;
      }
      const w = r[b];
      if (!w) return;
      if (w.batch?.enabled) {
        k(b, m);
        return;
      }
      const q = new AbortController(),
        N = Date.now(),
        K = {
          requirementId: m.id,
          resolverId: b,
          controller: q,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: m.id, startedAt: N },
          originalRequirement: m,
        };
      u.set(m.id, K),
        i?.(b, m),
        y(b, m, q).finally(() => {
          u.delete(m.id) && f?.();
        });
    },
    cancel(m) {
      const b = u.get(m);
      b &&
        (b.controller.abort(),
        u.delete(m),
        x.set(m, {
          state: "canceled",
          requirementId: m,
          canceledAt: Date.now(),
        }),
        $(),
        p?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [m] of u) this.cancel(m);
      for (const m of D.values()) m.timer && clearTimeout(m.timer);
      D.clear();
    },
    getStatus(m) {
      const b = u.get(m);
      return b ? b.status : x.get(m) || { state: "idle" };
    },
    getInflight() {
      return [...u.keys()];
    },
    getInflightInfo() {
      return [...u.values()].map((m) => ({
        id: m.requirementId,
        resolverId: m.resolverId,
        startedAt: m.startedAt,
      }));
    },
    isResolving(m) {
      return u.has(m);
    },
    processBatches() {
      for (const m of D.keys()) z(m);
    },
    registerDefinitions(m) {
      for (const [b, w] of Object.entries(m)) r[b] = w;
      A.clear();
    },
  };
}
function Ut(e) {
  let { config: r, facts: c, store: s, onSnapshot: i, onTimeTravel: o } = e,
    d = r.timeTravel ?? !1,
    l = r.maxSnapshots ?? 100,
    p = [],
    f = -1,
    u = 1,
    x = !1,
    M = !1,
    D = [],
    A = null,
    j = -1;
  function $() {
    return s.toObject();
  }
  function O() {
    const _ = $();
    return structuredClone(_);
  }
  function P(_) {
    if (!be(_)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    s.batch(() => {
      for (const [h, E] of Object.entries(_)) {
        if (h === "__proto__" || h === "constructor" || h === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${h}" during fact restoration`,
          );
          continue;
        }
        c[h] = E;
      }
    });
  }
  return {
    get isEnabled() {
      return d;
    },
    get isRestoring() {
      return M;
    },
    get isPaused() {
      return x;
    },
    get snapshots() {
      return [...p];
    },
    get currentIndex() {
      return f;
    },
    takeSnapshot(_) {
      if (!d || x)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: _ };
      const h = { id: u++, timestamp: Date.now(), facts: O(), trigger: _ };
      for (
        f < p.length - 1 && p.splice(f + 1), p.push(h), f = p.length - 1;
        p.length > l;
      )
        p.shift(), f--;
      return i?.(h), h;
    },
    restore(_) {
      if (d) {
        (x = !0), (M = !0);
        try {
          P(_.facts);
        } finally {
          (x = !1), (M = !1);
        }
      }
    },
    goBack(_ = 1) {
      if (!d || p.length === 0) return;
      let h = f,
        E = f,
        y = D.find((k) => f > k.startIndex && f <= k.endIndex);
      if (y) E = y.startIndex;
      else if (D.find((k) => f === k.startIndex)) {
        const k = D.find((z) => z.endIndex < f && f - z.endIndex <= _);
        E = k ? k.startIndex : Math.max(0, f - _);
      } else E = Math.max(0, f - _);
      if (h === E) return;
      f = E;
      const C = p[f];
      C && (this.restore(C), o?.(h, E));
    },
    goForward(_ = 1) {
      if (!d || p.length === 0) return;
      let h = f,
        E = f,
        y = D.find((k) => f >= k.startIndex && f < k.endIndex);
      if ((y ? (E = y.endIndex) : (E = Math.min(p.length - 1, f + _)), h === E))
        return;
      f = E;
      const C = p[f];
      C && (this.restore(C), o?.(h, E));
    },
    goTo(_) {
      if (!d) return;
      const h = p.findIndex((C) => C.id === _);
      if (h === -1) {
        console.warn(`[Directive] Snapshot ${_} not found`);
        return;
      }
      const E = f;
      f = h;
      const y = p[f];
      y && (this.restore(y), o?.(E, h));
    },
    replay() {
      if (!d || p.length === 0) return;
      f = 0;
      const _ = p[0];
      _ && this.restore(_);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: p, currentIndex: f });
    },
    import(_) {
      if (d)
        try {
          const h = JSON.parse(_);
          if (typeof h != "object" || h === null)
            throw new Error("Invalid time-travel data: expected object");
          if (h.version !== 1)
            throw new Error(
              `Unsupported time-travel export version: ${h.version}`,
            );
          if (!Array.isArray(h.snapshots))
            throw new Error(
              "Invalid time-travel data: snapshots must be an array",
            );
          if (typeof h.currentIndex != "number")
            throw new Error(
              "Invalid time-travel data: currentIndex must be a number",
            );
          for (const y of h.snapshots) {
            if (typeof y != "object" || y === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof y.id != "number" ||
              typeof y.timestamp != "number" ||
              typeof y.trigger != "string" ||
              typeof y.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!be(y.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (p.length = 0), p.push(...h.snapshots), (f = h.currentIndex);
          const E = p[f];
          E && this.restore(E);
        } catch (h) {
          console.error("[Directive] Failed to import time-travel data:", h);
        }
    },
    beginChangeset(_) {
      d && ((A = _), (j = f));
    },
    endChangeset() {
      !d ||
        A === null ||
        (f > j && D.push({ label: A, startIndex: j, endIndex: f }),
        (A = null),
        (j = -1));
    },
    pause() {
      x = !0;
    },
    resume() {
      x = !1;
    },
  };
}
function Jt() {
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
function Et(e) {
  const r = Object.create(null),
    c = Object.create(null),
    s = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    d = Object.create(null);
  for (const t of e.modules) {
    const n = (a, g) => {
      if (a) {
        for (const S of Object.keys(a))
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
      t.events && Object.assign(c, t.events),
      t.derive && Object.assign(s, t.derive),
      t.effects && Object.assign(i, t.effects),
      t.constraints && Object.assign(o, t.constraints),
      t.resolvers && Object.assign(d, t.resolvers);
  }
  let l = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    l = new Set();
    for (const t of e.modules) {
      const n = t;
      if (n.snapshotEvents) for (const a of n.snapshotEvents) l.add(a);
      else if (n.events) for (const a of Object.keys(n.events)) l.add(a);
    }
  }
  let p = 0,
    f = !1,
    u = Vt();
  for (const t of e.plugins ?? []) u.register(t);
  let x = Kt({
      config: e.errorBoundary,
      onError: (t) => u.emitError(t),
      onRecovery: (t, n) => u.emitErrorRecovery(t, n),
    }),
    M = () => {},
    D = () => {},
    A = null,
    { store: j, facts: $ } = qt({
      schema: r,
      onChange: (t, n, a) => {
        u.emitFactSet(t, n, a),
          M(t),
          !A?.isRestoring && (p === 0 && (f = !0), w.changedKeys.add(t), q());
      },
      onBatch: (t) => {
        u.emitFactsBatch(t);
        const n = [];
        for (const a of t) n.push(a.key);
        if ((D(n), !A?.isRestoring)) {
          p === 0 && (f = !0);
          for (const a of t) w.changedKeys.add(a.key);
          q();
        }
      },
    }),
    O = Lt({
      definitions: s,
      facts: $,
      onCompute: (t, n, a) => u.emitDerivationCompute(t, n, a),
      onInvalidate: (t) => u.emitDerivationInvalidate(t),
      onError: (t, n) => {
        x.handleError("derivation", t, n);
      },
    });
  (M = (t) => O.invalidate(t)), (D = (t) => O.invalidateMany(t));
  const P = Pt({
      definitions: i,
      facts: $,
      store: j,
      onRun: (t) => u.emitEffectRun(t),
      onError: (t, n) => {
        x.handleError("effect", t, n), u.emitEffectError(t, n);
      },
    }),
    _ = Ft({
      definitions: o,
      facts: $,
      onEvaluate: (t, n) => u.emitConstraintEvaluate(t, n),
      onError: (t, n) => {
        x.handleError("constraint", t, n), u.emitConstraintError(t, n);
      },
    }),
    h = Ht({
      definitions: d,
      facts: $,
      store: j,
      onStart: (t, n) => u.emitResolverStart(t, n),
      onComplete: (t, n, a) => {
        u.emitResolverComplete(t, n, a),
          u.emitRequirementMet(n, t),
          _.markResolved(n.fromConstraint);
      },
      onError: (t, n, a) => {
        x.handleError("resolver", t, a, n), u.emitResolverError(t, n, a);
      },
      onRetry: (t, n, a) => u.emitResolverRetry(t, n, a),
      onCancel: (t, n) => {
        u.emitResolverCancel(t, n), u.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        z(), q();
      },
    }),
    E = new Set();
  function y() {
    for (const t of E) t();
  }
  const C = e.debug?.timeTravel
    ? Ut({
        config: e.debug,
        facts: $,
        store: j,
        onSnapshot: (t) => {
          u.emitSnapshot(t), y();
        },
        onTimeTravel: (t, n) => {
          u.emitTimeTravel(t, n), y();
        },
      })
    : Jt();
  A = C;
  const k = new Set();
  function z() {
    for (const t of k) t();
  }
  let m = 50,
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
      previousRequirements: new Pe(),
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
          w.isRunning && !w.isInitializing && N().catch((t) => {});
      }));
  }
  async function N() {
    if (!w.isReconciling) {
      if ((b++, b > m)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), z();
      try {
        w.changedKeys.size > 0 &&
          ((l === null || f) &&
            C.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (f = !1));
        const t = $.$snapshot();
        u.emitReconcileStart(t), await P.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const a = await _.evaluate(n),
          g = new Pe();
        for (const T of a) g.add(T), u.emitRequirementCreated(T);
        const { added: S, removed: I } = g.diff(w.previousRequirements);
        for (const T of I) h.cancel(T.id);
        for (const T of S) h.resolve(T);
        w.previousRequirements = g;
        const L = h.getInflightInfo(),
          W = {
            unmet: a.filter((T) => !h.isResolving(T.id)),
            inflight: L,
            completed: [],
            canceled: I.map((T) => ({
              id: T.id,
              resolverId: L.find((U) => U.id === T.id)?.resolverId ?? "unknown",
            })),
          };
        u.emitReconcileEnd(W),
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
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n)) return O.get(n);
        },
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in s;
        },
        ownKeys() {
          return Object.keys(s);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in s)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    F = new Proxy(
      {},
      {
        get(t, n) {
          if (typeof n != "symbol" && !le.has(n))
            return (a) => {
              const g = c[n];
              if (g) {
                p++, (l === null || l.has(n)) && (f = !0);
                try {
                  j.batch(() => {
                    g($, { type: n, ...a });
                  });
                } finally {
                  p--;
                }
              }
            };
        },
        has(t, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in c;
        },
        ownKeys() {
          return Object.keys(c);
        },
        getOwnPropertyDescriptor(t, n) {
          if (typeof n != "symbol" && !le.has(n) && n in c)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    v = {
      facts: $,
      debug: C.isEnabled ? C : null,
      derive: K,
      events: F,
      constraints: { disable: (t) => _.disable(t), enable: (t) => _.enable(t) },
      effects: {
        disable: (t) => P.disable(t),
        enable: (t) => P.enable(t),
        isEnabled: (t) => P.isEnabled(t),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              j.batch(() => {
                t.init($);
              });
          e.onAfterModuleInit &&
            j.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const t of Object.keys(s)) O.get(t);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(v);
          u.emitStart(v), q();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), h.cancelAll(), P.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(v);
          u.emitStop(v);
        }
      },
      destroy() {
        this.stop(),
          (w.isDestroyed = !0),
          k.clear(),
          E.clear(),
          u.emitDestroy(v);
      },
      dispatch(t) {
        if (le.has(t.type)) return;
        const n = c[t.type];
        if (n) {
          p++, (l === null || l.has(t.type)) && (f = !0);
          try {
            j.batch(() => {
              n($, t);
            });
          } finally {
            p--;
          }
        }
      },
      read(t) {
        return O.get(t);
      },
      subscribe(t, n) {
        const a = [],
          g = [];
        for (const I of t) I in s ? a.push(I) : I in r && g.push(I);
        const S = [];
        return (
          a.length > 0 && S.push(O.subscribe(a, n)),
          g.length > 0 && S.push(j.subscribe(g, n)),
          () => {
            for (const I of S) I();
          }
        );
      },
      watch(t, n, a) {
        const g = a?.equalityFn
          ? (I, L) => a.equalityFn(I, L)
          : (I, L) => Object.is(I, L);
        if (t in s) {
          let I = O.get(t);
          return O.subscribe([t], () => {
            const L = O.get(t);
            if (!g(L, I)) {
              const W = I;
              (I = L), n(L, W);
            }
          });
        }
        let S = j.get(t);
        return j.subscribe([t], () => {
          const I = j.get(t);
          if (!g(I, S)) {
            const L = S;
            (S = I), n(I, L);
          }
        });
      },
      when(t, n) {
        return new Promise((a, g) => {
          const S = j.toObject();
          if (t(S)) {
            a();
            return;
          }
          let I,
            L,
            W = () => {
              I?.(), L !== void 0 && clearTimeout(L);
            };
          (I = j.subscribeAll(() => {
            const T = j.toObject();
            t(T) && (W(), a());
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
          inflight: h.getInflightInfo(),
          constraints: _.getAllStates().map((t) => ({
            id: t.id,
            active: t.lastResult ?? !1,
            priority: t.priority,
          })),
          resolvers: Object.fromEntries(
            h.getInflight().map((t) => [t, h.getStatus(t)]),
          ),
        };
      },
      explain(t) {
        const n = w.previousRequirements.all().find((U) => U.id === t);
        if (!n) return null;
        const a = _.getState(n.fromConstraint),
          g = h.getStatus(t),
          S = {},
          I = j.toObject();
        for (const [U, Y] of Object.entries(I)) S[U] = Y;
        const L = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, Y]) => `${U}=${JSON.stringify(Y)}`)
            .join(", ");
        W && L.push(`├─ Requirement payload: { ${W} }`);
        const T = Object.entries(S).slice(0, 10);
        return (
          T.length > 0 &&
            (L.push("└─ Relevant facts:"),
            T.forEach(([U, Y], re) => {
              const Z = re === T.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              L.push(
                `${Z} ${U} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          L.join(`
`)
        );
      },
      async settle(t = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const a = this.inspect();
          if (
            a.inflight.length === 0 &&
            !w.isReconciling &&
            !w.reconcileScheduled
          )
            return;
          if (Date.now() - n > t) {
            const g = [];
            a.inflight.length > 0 &&
              g.push(
                `${a.inflight.length} resolvers inflight: ${a.inflight.map((I) => I.resolverId).join(", ")}`,
              ),
              w.isReconciling && g.push("reconciliation in progress"),
              w.reconcileScheduled && g.push("reconcile scheduled");
            const S = w.previousRequirements.all();
            throw (
              (S.length > 0 &&
                g.push(
                  `${S.length} unmet requirements: ${S.map((I) => I.requirement.type).join(", ")}`,
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
        return { facts: j.toObject(), version: 1 };
      },
      getDistributableSnapshot(t = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: a,
            includeFacts: g,
            ttlSeconds: S,
            metadata: I,
            includeVersion: L,
          } = t,
          W = {},
          T = Object.keys(s),
          U;
        if ((n ? (U = n.filter((Z) => T.includes(Z))) : (U = T), a)) {
          const Z = new Set(a);
          U = U.filter((X) => !Z.has(X));
        }
        for (const Z of U)
          try {
            W[Z] = O.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = j.toObject();
          for (const X of g) X in Z && (W[X] = Z[X]);
        }
        const Y = Date.now(),
          re = { data: W, createdAt: Y };
        return (
          S !== void 0 && S > 0 && (re.expiresAt = Y + S * 1e3),
          L && (re.version = Bt(W)),
          I && (re.metadata = I),
          re
        );
      },
      watchDistributableSnapshot(t, n) {
        let { includeDerivations: a, excludeDerivations: g } = t,
          S = Object.keys(s),
          I;
        if ((a ? (I = a.filter((W) => S.includes(W))) : (I = S), g)) {
          const W = new Set(g);
          I = I.filter((T) => !W.has(T));
        }
        if (I.length === 0) return () => {};
        let L = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return O.subscribe(I, () => {
          const W = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          W.version !== L && ((L = W.version), n(W));
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
        if (!be(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        j.batch(() => {
          for (const [n, a] of Object.entries(t.facts))
            le.has(n) || j.set(n, a);
        });
      },
      onSettledChange(t) {
        return (
          k.add(t),
          () => {
            k.delete(t);
          }
        );
      },
      onTimeTravelChange(t) {
        return (
          E.add(t),
          () => {
            E.delete(t);
          }
        );
      },
      batch(t) {
        j.batch(t);
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
  function R(t) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" on a destroyed system.`,
      );
    const n = (a, g) => {
      if (a) {
        for (const S of Object.keys(a))
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
    for (const a of Object.keys(t.schema))
      if (a in r)
        throw new Error(
          `[Directive] Schema collision: Fact "${a}" already exists. Cannot register module "${t.id}".`,
        );
    if (t.snapshotEvents) {
      l === null && (l = new Set(Object.keys(c)));
      for (const a of t.snapshotEvents) l.add(a);
    } else if (l !== null && t.events)
      for (const a of Object.keys(t.events)) l.add(a);
    Object.assign(r, t.schema),
      t.events && Object.assign(c, t.events),
      t.derive && (Object.assign(s, t.derive), O.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(i, t.effects), P.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(o, t.constraints), _.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(d, t.resolvers), h.registerDefinitions(t.resolvers)),
      j.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        j.batch(() => {
          t.init($);
        }),
      t.hooks?.onInit?.(v),
      w.isRunning && (t.hooks?.onStart?.(v), q());
  }
  (v.registerModule = R), u.emitInit(v);
  for (const t of e.modules) t.hooks?.onInit?.(v);
  return v;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  V = "::";
function Yt(e) {
  const r = Object.keys(e),
    c = new Set(),
    s = new Set(),
    i = [],
    o = [];
  function d(l) {
    if (c.has(l)) return;
    if (s.has(l)) {
      const f = o.indexOf(l),
        u = [...o.slice(f), l].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${u}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    s.add(l), o.push(l);
    const p = e[l];
    if (p?.crossModuleDeps)
      for (const f of Object.keys(p.crossModuleDeps)) r.includes(f) && d(f);
    o.pop(), s.delete(l), c.add(l), i.push(l);
  }
  for (const l of r) d(l);
  return i;
}
var nt = new WeakMap(),
  it = new WeakMap(),
  st = new WeakMap(),
  ot = new WeakMap();
function Gt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return er(e);
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
  return Xt(r);
}
function Xt(e) {
  const r = e.modules,
    c = new Set(Object.keys(r)),
    s = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const h = o,
      E = Object.keys(r).filter((y) => !h.includes(y));
    if (E.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${E.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = h;
  } else o === "declaration" ? (i = Object.keys(r)) : (i = Yt(r));
  let d = e.debug,
    l = e.errorBoundary;
  e.zeroConfig &&
    ((d = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (l = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const h of Object.keys(r)) {
    if (h.includes(V))
      throw new Error(
        `[Directive] Module name "${h}" contains the reserved separator "${V}". Module names cannot contain "${V}".`,
      );
    const E = r[h];
    if (E) {
      for (const y of Object.keys(E.schema.facts))
        if (y.includes(V))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${h}" contains the reserved separator "${V}". Schema keys cannot contain "${V}".`,
          );
    }
  }
  const p = [];
  for (const h of i) {
    const E = r[h];
    if (!E) continue;
    const y = E.crossModuleDeps && Object.keys(E.crossModuleDeps).length > 0,
      C = y ? Object.keys(E.crossModuleDeps) : [],
      k = {};
    for (const [v, R] of Object.entries(E.schema.facts)) k[`${h}${V}${v}`] = R;
    const z = {};
    if (E.schema.derivations)
      for (const [v, R] of Object.entries(E.schema.derivations))
        z[`${h}${V}${v}`] = R;
    const m = {};
    if (E.schema.events)
      for (const [v, R] of Object.entries(E.schema.events))
        m[`${h}${V}${v}`] = R;
    const b = E.init
        ? (v) => {
            const R = se(v, h);
            E.init(R);
          }
        : void 0,
      w = {};
    if (E.derive)
      for (const [v, R] of Object.entries(E.derive))
        w[`${h}${V}${v}`] = (t, n) => {
          const a = y ? ae(t, h, C) : se(t, h),
            g = Ne(n, h);
          return R(a, g);
        };
    const q = {};
    if (E.events)
      for (const [v, R] of Object.entries(E.events))
        q[`${h}${V}${v}`] = (t, n) => {
          const a = se(t, h);
          R(a, n);
        };
    const N = {};
    if (E.constraints)
      for (const [v, R] of Object.entries(E.constraints)) {
        const t = R;
        N[`${h}${V}${v}`] = {
          ...t,
          deps: t.deps?.map((n) => `${h}${V}${n}`),
          when: (n) => {
            const a = y ? ae(n, h, C) : se(n, h);
            return t.when(a);
          },
          require:
            typeof t.require == "function"
              ? (n) => {
                  const a = y ? ae(n, h, C) : se(n, h);
                  return t.require(a);
                }
              : t.require,
        };
      }
    const K = {};
    if (E.resolvers)
      for (const [v, R] of Object.entries(E.resolvers)) {
        const t = R;
        K[`${h}${V}${v}`] = {
          ...t,
          resolve: async (n, a) => {
            const g = Ie(a.facts, r, () => Object.keys(r));
            await t.resolve(n, { facts: g[h], signal: a.signal });
          },
        };
      }
    const F = {};
    if (E.effects)
      for (const [v, R] of Object.entries(E.effects)) {
        const t = R;
        F[`${h}${V}${v}`] = {
          ...t,
          run: (n, a) => {
            const g = y ? ae(n, h, C) : se(n, h),
              S = a ? (y ? ae(a, h, C) : se(a, h)) : void 0;
            return t.run(g, S);
          },
          deps: t.deps?.map((n) => `${h}${V}${n}`),
        };
      }
    p.push({
      id: E.id,
      schema: {
        facts: k,
        derivations: z,
        events: m,
        requirements: E.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: q,
      effects: F,
      constraints: N,
      resolvers: K,
      hooks: E.hooks,
      snapshotEvents:
        s && !s.has(h) ? [] : E.snapshotEvents?.map((v) => `${h}${V}${v}`),
    });
  }
  let f = null,
    u = null;
  function x(h) {
    for (const [E, y] of Object.entries(h))
      if (!ne.has(E) && c.has(E)) {
        if (y && typeof y == "object" && !be(y))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${E}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, k] of Object.entries(y))
          ne.has(C) || (u.facts[`${E}${V}${C}`] = k);
      }
  }
  u = Et({
    modules: p.map((h) => ({
      id: h.id,
      schema: h.schema.facts,
      requirements: h.schema.requirements,
      init: h.init,
      derive: h.derive,
      events: h.events,
      effects: h.effects,
      constraints: h.constraints,
      resolvers: h.resolvers,
      hooks: h.hooks,
      snapshotEvents: h.snapshotEvents,
    })),
    plugins: e.plugins,
    debug: d,
    errorBoundary: l,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && x(e.initialFacts), f && (x(f), (f = null));
    },
  });
  const M = new Map();
  for (const h of Object.keys(r)) {
    const E = r[h];
    if (!E) continue;
    const y = [];
    for (const C of Object.keys(E.schema.facts)) y.push(`${h}${V}${C}`);
    if (E.schema.derivations)
      for (const C of Object.keys(E.schema.derivations)) y.push(`${h}${V}${C}`);
    M.set(h, y);
  }
  const D = { names: null };
  function A() {
    return D.names === null && (D.names = Object.keys(r)), D.names;
  }
  let j = Ie(u.facts, r, A),
    $ = Qt(u.derive, r, A),
    O = Zt(u, r, A),
    P = null,
    _ = e.tickMs;
  return {
    _mode: "namespaced",
    facts: j,
    debug: u.debug,
    derive: $,
    events: O,
    constraints: u.constraints,
    effects: u.effects,
    get isRunning() {
      return u.isRunning;
    },
    get isSettled() {
      return u.isSettled;
    },
    get isInitialized() {
      return u.isInitialized;
    },
    get isReady() {
      return u.isReady;
    },
    whenReady: u.whenReady.bind(u),
    async hydrate(h) {
      if (u.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const E = await h();
      E && typeof E == "object" && (f = E);
    },
    initialize() {
      u.initialize();
    },
    start() {
      if ((u.start(), _ && _ > 0)) {
        const h = Object.keys(p[0]?.events ?? {}).find((E) =>
          E.endsWith(`${V}tick`),
        );
        h &&
          (P = setInterval(() => {
            u.dispatch({ type: h });
          }, _));
      }
    },
    stop() {
      P && (clearInterval(P), (P = null)), u.stop();
    },
    destroy() {
      this.stop(), u.destroy();
    },
    dispatch(h) {
      u.dispatch(h);
    },
    batch: u.batch.bind(u),
    read(h) {
      return u.read(ce(h));
    },
    subscribe(h, E) {
      const y = [];
      for (const C of h)
        if (C.endsWith(".*")) {
          const k = C.slice(0, -2),
            z = M.get(k);
          z && y.push(...z);
        } else y.push(ce(C));
      return u.subscribe(y, E);
    },
    subscribeModule(h, E) {
      const y = M.get(h);
      return !y || y.length === 0 ? () => {} : u.subscribe(y, E);
    },
    watch(h, E, y) {
      return u.watch(ce(h), E, y);
    },
    when(h, E) {
      return u.when(() => h(j), E);
    },
    onSettledChange: u.onSettledChange.bind(u),
    onTimeTravelChange: u.onTimeTravelChange.bind(u),
    inspect: u.inspect.bind(u),
    settle: u.settle.bind(u),
    explain: u.explain.bind(u),
    getSnapshot: u.getSnapshot.bind(u),
    restore: u.restore.bind(u),
    getDistributableSnapshot(h) {
      const E = {
          ...h,
          includeDerivations: h?.includeDerivations?.map(ce),
          excludeDerivations: h?.excludeDerivations?.map(ce),
          includeFacts: h?.includeFacts?.map(ce),
        },
        y = u.getDistributableSnapshot(E),
        C = {};
      for (const [k, z] of Object.entries(y.data)) {
        const m = k.indexOf(V);
        if (m > 0) {
          const b = k.slice(0, m),
            w = k.slice(m + V.length);
          C[b] || (C[b] = {}), (C[b][w] = z);
        } else C._root || (C._root = {}), (C._root[k] = z);
      }
      return { ...y, data: C };
    },
    watchDistributableSnapshot(h, E) {
      const y = {
        ...h,
        includeDerivations: h?.includeDerivations?.map(ce),
        excludeDerivations: h?.excludeDerivations?.map(ce),
        includeFacts: h?.includeFacts?.map(ce),
      };
      return u.watchDistributableSnapshot(y, (C) => {
        const k = {};
        for (const [z, m] of Object.entries(C.data)) {
          const b = z.indexOf(V);
          if (b > 0) {
            const w = z.slice(0, b),
              q = z.slice(b + V.length);
            k[w] || (k[w] = {}), (k[w][q] = m);
          } else k._root || (k._root = {}), (k._root[z] = m);
        }
        E({ ...C, data: k });
      });
    },
    registerModule(h, E) {
      if (c.has(h))
        throw new Error(
          `[Directive] Module namespace "${h}" already exists. Cannot register a duplicate namespace.`,
        );
      if (h.includes(V))
        throw new Error(
          `[Directive] Module name "${h}" contains the reserved separator "${V}".`,
        );
      if (ne.has(h))
        throw new Error(
          `[Directive] Module name "${h}" is a blocked property.`,
        );
      for (const v of Object.keys(E.schema.facts))
        if (v.includes(V))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${h}" contains the reserved separator "${V}".`,
          );
      const y = E,
        C = y.crossModuleDeps && Object.keys(y.crossModuleDeps).length > 0,
        k = C ? Object.keys(y.crossModuleDeps) : [],
        z = {};
      for (const [v, R] of Object.entries(y.schema.facts))
        z[`${h}${V}${v}`] = R;
      const m = y.init
          ? (v) => {
              const R = se(v, h);
              y.init(R);
            }
          : void 0,
        b = {};
      if (y.derive)
        for (const [v, R] of Object.entries(y.derive))
          b[`${h}${V}${v}`] = (t, n) => {
            const a = C ? ae(t, h, k) : se(t, h),
              g = Ne(n, h);
            return R(a, g);
          };
      const w = {};
      if (y.events)
        for (const [v, R] of Object.entries(y.events))
          w[`${h}${V}${v}`] = (t, n) => {
            const a = se(t, h);
            R(a, n);
          };
      const q = {};
      if (y.constraints)
        for (const [v, R] of Object.entries(y.constraints)) {
          const t = R;
          q[`${h}${V}${v}`] = {
            ...t,
            deps: t.deps?.map((n) => `${h}${V}${n}`),
            when: (n) => {
              const a = C ? ae(n, h, k) : se(n, h);
              return t.when(a);
            },
            require:
              typeof t.require == "function"
                ? (n) => {
                    const a = C ? ae(n, h, k) : se(n, h);
                    return t.require(a);
                  }
                : t.require,
          };
        }
      const N = {};
      if (y.resolvers)
        for (const [v, R] of Object.entries(y.resolvers)) {
          const t = R;
          N[`${h}${V}${v}`] = {
            ...t,
            resolve: async (n, a) => {
              const g = Ie(a.facts, r, A);
              await t.resolve(n, { facts: g[h], signal: a.signal });
            },
          };
        }
      const K = {};
      if (y.effects)
        for (const [v, R] of Object.entries(y.effects)) {
          const t = R;
          K[`${h}${V}${v}`] = {
            ...t,
            run: (n, a) => {
              const g = C ? ae(n, h, k) : se(n, h),
                S = a ? (C ? ae(a, h, k) : se(a, h)) : void 0;
              return t.run(g, S);
            },
            deps: t.deps?.map((n) => `${h}${V}${n}`),
          };
        }
      c.add(h), (r[h] = y), (D.names = null);
      const F = [];
      for (const v of Object.keys(y.schema.facts)) F.push(`${h}${V}${v}`);
      if (y.schema.derivations)
        for (const v of Object.keys(y.schema.derivations))
          F.push(`${h}${V}${v}`);
      M.set(h, F),
        u.registerModule({
          id: y.id,
          schema: z,
          requirements: y.schema.requirements ?? {},
          init: m,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(q).length > 0 ? q : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: y.hooks,
          snapshotEvents:
            s && !s.has(h) ? [] : y.snapshotEvents?.map((v) => `${h}${V}${v}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [r, ...c] = e.split(".");
    return `${r}${V}${c.join(V)}`;
  }
  return e;
}
function se(e, r) {
  let c = nt.get(e);
  if (c) {
    const i = c.get(r);
    if (i) return i;
  } else (c = new Map()), nt.set(e, c);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !ne.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${r}${V}${o}`];
      },
      set(i, o, d) {
        return typeof o == "symbol" || ne.has(o)
          ? !1
          : ((e[`${r}${V}${o}`] = d), !0);
      },
      has(i, o) {
        return typeof o == "symbol" || ne.has(o) ? !1 : `${r}${V}${o}` in e;
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" || ne.has(o)
          ? !1
          : (delete e[`${r}${V}${o}`], !0);
      },
    },
  );
  return c.set(r, s), s;
}
function Ie(e, r, c) {
  const s = it.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(r, d))
          return se(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(r, d);
      },
      ownKeys() {
        return c();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(r, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return it.set(e, i), i;
}
var lt = new WeakMap();
function ae(e, r, c) {
  let s = `${r}:${JSON.stringify([...c].sort())}`,
    i = lt.get(e);
  if (i) {
    const p = i.get(s);
    if (p) return p;
  } else (i = new Map()), lt.set(e, i);
  const o = new Set(c),
    d = ["self", ...c],
    l = new Proxy(
      {},
      {
        get(p, f) {
          if (typeof f != "symbol" && !ne.has(f)) {
            if (f === "self") return se(e, r);
            if (o.has(f)) return se(e, f);
          }
        },
        has(p, f) {
          return typeof f == "symbol" || ne.has(f)
            ? !1
            : f === "self" || o.has(f);
        },
        ownKeys() {
          return d;
        },
        getOwnPropertyDescriptor(p, f) {
          if (typeof f != "symbol" && (f === "self" || o.has(f)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(s, l), l;
}
function Ne(e, r) {
  let c = ot.get(e);
  if (c) {
    const i = c.get(r);
    if (i) return i;
  } else (c = new Map()), ot.set(e, c);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !ne.has(o)) return e[`${r}${V}${o}`];
      },
      has(i, o) {
        return typeof o == "symbol" || ne.has(o) ? !1 : `${r}${V}${o}` in e;
      },
    },
  );
  return c.set(r, s), s;
}
function Qt(e, r, c) {
  const s = st.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(r, d))
          return Ne(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(r, d);
      },
      ownKeys() {
        return c();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(r, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return st.set(e, i), i;
}
var at = new WeakMap();
function Zt(e, r, c) {
  let s = at.get(e);
  return (
    s || ((s = new Map()), at.set(e, s)),
    new Proxy(
      {},
      {
        get(i, o) {
          if (typeof o == "symbol" || ne.has(o) || !Object.hasOwn(r, o)) return;
          const d = s.get(o);
          if (d) return d;
          const l = new Proxy(
            {},
            {
              get(p, f) {
                if (typeof f != "symbol" && !ne.has(f))
                  return (u) => {
                    e.dispatch({ type: `${o}${V}${f}`, ...u });
                  };
              },
            },
          );
          return s.set(o, l), l;
        },
        has(i, o) {
          return typeof o == "symbol" || ne.has(o) ? !1 : Object.hasOwn(r, o);
        },
        ownKeys() {
          return c();
        },
        getOwnPropertyDescriptor(i, o) {
          if (typeof o != "symbol" && Object.hasOwn(r, o))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function er(e) {
  const r = e.module;
  if (!r)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof r,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !be(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let c = e.debug,
    s = e.errorBoundary;
  e.zeroConfig &&
    ((c = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (s = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
    o = null;
  o = Et({
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
    debug: c,
    errorBoundary: s,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [f, u] of Object.entries(e.initialFacts))
          ne.has(f) || (o.facts[f] = u);
      if (i) {
        for (const [f, u] of Object.entries(i)) ne.has(f) || (o.facts[f] = u);
        i = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(f, u) {
          if (typeof u != "symbol" && !ne.has(u))
            return (x) => {
              o.dispatch({ type: u, ...x });
            };
        },
      },
    ),
    l = null,
    p = e.tickMs;
  return {
    _mode: "single",
    facts: o.facts,
    debug: o.debug,
    derive: o.derive,
    events: d,
    constraints: o.constraints,
    effects: o.effects,
    get isRunning() {
      return o.isRunning;
    },
    get isSettled() {
      return o.isSettled;
    },
    get isInitialized() {
      return o.isInitialized;
    },
    get isReady() {
      return o.isReady;
    },
    whenReady: o.whenReady.bind(o),
    async hydrate(f) {
      if (o.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const u = await f();
      u && typeof u == "object" && (i = u);
    },
    initialize() {
      o.initialize();
    },
    start() {
      o.start(),
        p &&
          p > 0 &&
          r.events &&
          "tick" in r.events &&
          (l = setInterval(() => {
            o.dispatch({ type: "tick" });
          }, p));
    },
    stop() {
      l && (clearInterval(l), (l = null)), o.stop();
    },
    destroy() {
      this.stop(), o.destroy();
    },
    dispatch(f) {
      o.dispatch(f);
    },
    batch: o.batch.bind(o),
    read(f) {
      return o.read(f);
    },
    subscribe(f, u) {
      return o.subscribe(f, u);
    },
    watch(f, u, x) {
      return o.watch(f, u, x);
    },
    when(f, u) {
      return o.when(f, u);
    },
    onSettledChange: o.onSettledChange.bind(o),
    onTimeTravelChange: o.onTimeTravelChange.bind(o),
    inspect: o.inspect.bind(o),
    settle: o.settle.bind(o),
    explain: o.explain.bind(o),
    getSnapshot: o.getSnapshot.bind(o),
    restore: o.restore.bind(o),
    getDistributableSnapshot: o.getDistributableSnapshot.bind(o),
    watchDistributableSnapshot: o.watchDistributableSnapshot.bind(o),
    registerModule(f) {
      o.registerModule({
        id: f.id,
        schema: f.schema.facts,
        requirements: f.schema.requirements,
        init: f.init,
        derive: f.derive,
        events: f.events,
        effects: f.effects,
        constraints: f.constraints,
        resolvers: f.resolvers,
        hooks: f.hooks,
        snapshotEvents: f.snapshotEvents,
      });
    },
  };
}
var ct = { debug: 0, info: 1, warn: 2, error: 3 };
function tr(e = {}) {
  const {
      level: r = "info",
      filter: c = () => !0,
      logger: s = console,
      prefix: i = "[Directive]",
    } = e,
    o = ct[r],
    d = (l, p, ...f) => {
      ct[l] < o || (c(p) && s[l](`${i} ${p}`, ...f));
    };
  return {
    name: "logging",
    onInit: () => d("debug", "init"),
    onStart: () => d("info", "start"),
    onStop: () => d("info", "stop"),
    onDestroy: () => d("debug", "destroy"),
    onFactSet: (l, p, f) => {
      d("debug", "fact.set", { key: l, value: p, prev: f });
    },
    onFactDelete: (l, p) => {
      d("debug", "fact.delete", { key: l, prev: p });
    },
    onFactsBatch: (l) => {
      d("debug", "facts.batch", { count: l.length, changes: l });
    },
    onDerivationCompute: (l, p, f) => {
      d("debug", "derivation.compute", { id: l, value: p, deps: f });
    },
    onDerivationInvalidate: (l) => {
      d("debug", "derivation.invalidate", { id: l });
    },
    onReconcileStart: () => {
      d("debug", "reconcile.start");
    },
    onReconcileEnd: (l) => {
      d("debug", "reconcile.end", {
        unmet: l.unmet.length,
        inflight: l.inflight.length,
        completed: l.completed.length,
        canceled: l.canceled.length,
      });
    },
    onConstraintEvaluate: (l, p) => {
      d("debug", "constraint.evaluate", { id: l, active: p });
    },
    onConstraintError: (l, p) => {
      d("error", "constraint.error", { id: l, error: p });
    },
    onRequirementCreated: (l) => {
      d("debug", "requirement.created", { id: l.id, type: l.requirement.type });
    },
    onRequirementMet: (l, p) => {
      d("info", "requirement.met", { id: l.id, byResolver: p });
    },
    onRequirementCanceled: (l) => {
      d("debug", "requirement.canceled", { id: l.id });
    },
    onResolverStart: (l, p) => {
      d("debug", "resolver.start", { resolver: l, requirementId: p.id });
    },
    onResolverComplete: (l, p, f) => {
      d("info", "resolver.complete", {
        resolver: l,
        requirementId: p.id,
        duration: f,
      });
    },
    onResolverError: (l, p, f) => {
      d("error", "resolver.error", {
        resolver: l,
        requirementId: p.id,
        error: f,
      });
    },
    onResolverRetry: (l, p, f) => {
      d("warn", "resolver.retry", {
        resolver: l,
        requirementId: p.id,
        attempt: f,
      });
    },
    onResolverCancel: (l, p) => {
      d("debug", "resolver.cancel", { resolver: l, requirementId: p.id });
    },
    onEffectRun: (l) => {
      d("debug", "effect.run", { id: l });
    },
    onEffectError: (l, p) => {
      d("error", "effect.error", { id: l, error: p });
    },
    onSnapshot: (l) => {
      d("debug", "timetravel.snapshot", { id: l.id, trigger: l.trigger });
    },
    onTimeTravel: (l, p) => {
      d("info", "timetravel.jump", { from: l, to: p });
    },
    onError: (l) => {
      d("error", "error", {
        source: l.source,
        sourceId: l.sourceId,
        message: l.message,
      });
    },
    onErrorRecovery: (l, p) => {
      d("warn", "error.recovery", {
        source: l.source,
        sourceId: l.sourceId,
        strategy: p,
      });
    },
  };
}
var xt = class {
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
function Ve() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function $t(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const r = JSON.stringify(e, (c, s) =>
        typeof s == "bigint"
          ? String(s) + "n"
          : typeof s == "symbol"
            ? String(s)
            : s,
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
function rr(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function nr(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Ve() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function ir() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var sr = 200,
  Ae = 340,
  ge = 16,
  ve = 80,
  dt = 2,
  ut = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function or() {
  return { entries: new xt(sr), inflight: new Map() };
}
function lr() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var ar = 1e4,
  cr = 100;
function dr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var ur = 50,
  ft = 200,
  B = {
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
function fr(e, r, c, s) {
  let i = !1,
    o = {
      position: "fixed",
      zIndex: "99999",
      ...(r.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(r.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const l = document.createElement("button");
  l.setAttribute("aria-label", "Open Directive DevTools"),
    l.setAttribute("aria-expanded", String(c)),
    (l.title = "Ctrl+Shift+D to toggle"),
    Object.assign(l.style, {
      ...o,
      background: B.bg,
      color: B.text,
      border: `1px solid ${B.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: B.font,
      fontSize: "12px",
      display: c ? "none" : "block",
    }),
    (l.textContent = "Directive");
  const p = document.createElement("div");
  p.setAttribute("role", "region"),
    p.setAttribute("aria-label", "Directive DevTools"),
    p.setAttribute("data-directive-devtools", ""),
    (p.tabIndex = -1),
    Object.assign(p.style, {
      ...o,
      background: B.bg,
      color: B.text,
      border: `1px solid ${B.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: B.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: c ? "block" : "none",
    });
  const f = document.createElement("div");
  Object.assign(f.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const u = document.createElement("strong");
  (u.style.color = B.accent),
    (u.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const x = document.createElement("button");
  x.setAttribute("aria-label", "Close DevTools"),
    Object.assign(x.style, {
      background: "none",
      border: "none",
      color: B.closeBtn,
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
    f.appendChild(u),
    f.appendChild(x),
    p.appendChild(f);
  const M = document.createElement("div");
  (M.style.marginBottom = "6px"), M.setAttribute("aria-live", "polite");
  const D = document.createElement("span");
  (D.style.color = B.green),
    (D.textContent = "Settled"),
    M.appendChild(D),
    p.appendChild(M);
  const A = document.createElement("div");
  Object.assign(A.style, {
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
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (j.textContent = "◀ Undo"),
    (j.disabled = !0);
  const $ = document.createElement("button");
  Object.assign($.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    ($.textContent = "Redo ▶"),
    ($.disabled = !0);
  const O = document.createElement("span");
  (O.style.color = B.muted),
    (O.style.fontSize = "10px"),
    A.appendChild(j),
    A.appendChild($),
    A.appendChild(O),
    p.appendChild(A);
  function P(H, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const ue = document.createElement("span");
    (oe.textContent = `${H} (`),
      oe.appendChild(ue),
      oe.appendChild(document.createTextNode(")")),
      (ue.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Ye = document.createElement("thead"),
      Ge = document.createElement("tr");
    for (const kt of ["Key", "Value"]) {
      const we = document.createElement("th");
      (we.scope = "col"),
        Object.assign(we.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (we.textContent = kt),
        Ge.appendChild(we);
    }
    Ye.appendChild(Ge), de.appendChild(Ye);
    const Xe = document.createElement("tbody");
    return (
      de.appendChild(Xe),
      G.appendChild(de),
      { details: G, tbody: Xe, countSpan: ue }
    );
  }
  function _(H, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const ue = document.createElement("span");
    (oe.textContent = `${H} (`),
      oe.appendChild(ue),
      oe.appendChild(document.createTextNode(")")),
      (ue.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(de),
      { details: G, list: de, countSpan: ue }
    );
  }
  const h = P("Facts", !0);
  p.appendChild(h.details);
  const E = P("Derivations", !1);
  p.appendChild(E.details);
  const y = _("Inflight", B.yellow);
  p.appendChild(y.details);
  const C = _("Unmet", B.red);
  p.appendChild(C.details);
  const k = document.createElement("details");
  k.style.marginBottom = "4px";
  const z = document.createElement("summary");
  Object.assign(z.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (z.textContent = "Performance"),
    k.appendChild(z);
  const m = document.createElement("div");
  (m.style.fontSize = "10px"),
    (m.style.color = B.muted),
    (m.textContent = "No data yet"),
    k.appendChild(m),
    p.appendChild(k);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const w = document.createElement("summary");
  Object.assign(w.style, {
    cursor: "pointer",
    color: B.accent,
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
    p.appendChild(b);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const K = document.createElement("summary");
  Object.assign(K.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (K.textContent = "Timeline"),
    N.appendChild(K);
  const F = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  F.setAttribute("width", "100%"),
    F.setAttribute("height", "60"),
    F.setAttribute("role", "img"),
    F.setAttribute("aria-label", "Resolver execution timeline"),
    (F.style.display = "block"),
    F.setAttribute("viewBox", `0 0 ${Ae} 60`),
    F.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
  v.setAttribute("x", String(Ae / 2)),
    v.setAttribute("y", "30"),
    v.setAttribute("text-anchor", "middle"),
    v.setAttribute("fill", B.muted),
    v.setAttribute("font-size", "10"),
    v.setAttribute("font-family", B.font),
    (v.textContent = "No resolver activity yet"),
    F.appendChild(v),
    N.appendChild(F),
    p.appendChild(N);
  let R, t, n, a;
  if (s) {
    const H = document.createElement("details");
    H.style.marginBottom = "4px";
    const J = document.createElement("summary");
    Object.assign(J.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (J.textContent = "Events ("),
      J.appendChild(n),
      J.appendChild(document.createTextNode(")")),
      H.appendChild(J),
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
    (G.style.color = B.muted),
      (G.style.padding = "4px"),
      (G.textContent = "Waiting for events..."),
      (G.className = "dt-events-empty"),
      t.appendChild(G),
      H.appendChild(t),
      p.appendChild(H),
      (R = H),
      (a = document.createElement("div"));
  } else
    (R = document.createElement("details")),
      (t = document.createElement("div")),
      (n = document.createElement("span")),
      (a = document.createElement("div")),
      (a.style.fontSize = "10px"),
      (a.style.color = B.muted),
      (a.style.marginTop = "4px"),
      (a.style.fontStyle = "italic"),
      (a.textContent = "Enable trace: true for event log"),
      p.appendChild(a);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const S = document.createElement("button");
  Object.assign(S.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (S.textContent = "⏺ Record");
  const I = document.createElement("button");
  Object.assign(I.style, {
    background: "none",
    border: `1px solid ${B.border}`,
    color: B.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: B.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (I.textContent = "⤓ Export"),
    g.appendChild(S),
    g.appendChild(I),
    p.appendChild(g),
    p.addEventListener(
      "wheel",
      (H) => {
        const J = p,
          G = J.scrollTop === 0 && H.deltaY < 0,
          oe = J.scrollTop + J.clientHeight >= J.scrollHeight && H.deltaY > 0;
        (G || oe) && H.preventDefault();
      },
      { passive: !1 },
    );
  let L = c,
    W = new Set();
  function T() {
    (L = !0),
      (p.style.display = "block"),
      (l.style.display = "none"),
      l.setAttribute("aria-expanded", "true"),
      x.focus();
  }
  function U() {
    (L = !1),
      (p.style.display = "none"),
      (l.style.display = "block"),
      l.setAttribute("aria-expanded", "false"),
      l.focus();
  }
  l.addEventListener("click", T), x.addEventListener("click", U);
  function Y(H) {
    H.key === "Escape" && L && U();
  }
  p.addEventListener("keydown", Y);
  function re(H) {
    H.key === "d" &&
      H.shiftKey &&
      (H.ctrlKey || H.metaKey) &&
      (H.preventDefault(), L ? U() : T());
  }
  document.addEventListener("keydown", re);
  function Z() {
    i || (document.body.appendChild(l), document.body.appendChild(p));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function X() {
    (i = !0),
      l.removeEventListener("click", T),
      x.removeEventListener("click", U),
      p.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", re),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const H of W) clearTimeout(H);
    W.clear(), l.remove(), p.remove(), d.remove();
  }
  return {
    refs: {
      container: p,
      toggleBtn: l,
      titleEl: u,
      statusEl: D,
      factsBody: h.tbody,
      factsCount: h.countSpan,
      derivBody: E.tbody,
      derivCount: E.countSpan,
      derivSection: E.details,
      inflightList: y.list,
      inflightSection: y.details,
      inflightCount: y.countSpan,
      unmetList: C.list,
      unmetSection: C.details,
      unmetCount: C.countSpan,
      perfSection: k,
      perfBody: m,
      timeTravelSection: A,
      timeTravelLabel: O,
      undoBtn: j,
      redoBtn: $,
      flowSection: b,
      flowSvg: q,
      timelineSection: N,
      timelineSvg: F,
      eventsSection: R,
      eventsList: t,
      eventsCount: n,
      traceHint: a,
      recordBtn: S,
      exportBtn: I,
    },
    destroy: X,
    isOpen: () => L,
    flashTimers: W,
  };
}
function xe(e, r, c, s, i, o) {
  let d = $t(s),
    l = e.get(c);
  if (l) {
    const p = l.cells;
    if (p[1] && ((p[1].textContent = d), i && o)) {
      const f = p[1];
      f.style.background = "rgba(139, 154, 255, 0.25)";
      const u = setTimeout(() => {
        (f.style.background = ""), o.delete(u);
      }, 300);
      o.add(u);
    }
  } else {
    (l = document.createElement("tr")),
      (l.style.borderBottom = `1px solid ${B.rowBorder}`);
    const p = document.createElement("td");
    Object.assign(p.style, { padding: "2px 4px", color: B.muted }),
      (p.textContent = c);
    const f = document.createElement("td");
    (f.style.padding = "2px 4px"),
      (f.textContent = d),
      l.appendChild(p),
      l.appendChild(f),
      r.appendChild(l),
      e.set(c, l);
  }
}
function pr(e, r) {
  const c = e.get(r);
  c && (c.remove(), e.delete(r));
}
function Me(e, r, c) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(r.length)),
    r.length > 0)
  )
    for (const s of r) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.resolverId} (${s.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = B.muted),
      (s.textContent = "None"),
      e.inflightList.appendChild(s);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(c.length)),
    c.length > 0)
  )
    for (const s of c) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.requirement.type} from ${s.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = B.muted),
      (s.textContent = "None"),
      e.unmetList.appendChild(s);
  }
}
function qe(e, r, c) {
  const s = r === 0 && c === 0;
  (e.statusEl.style.color = s ? B.green : B.yellow),
    (e.statusEl.textContent = s ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = s ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${s ? "" : " (system working)"}`,
    );
}
function pt(e, r, c, s) {
  const i = Object.keys(c.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    r.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      l = document.createElement("td");
    (l.colSpan = 2),
      (l.style.color = B.muted),
      (l.style.fontSize = "10px"),
      (l.textContent = "No derivations defined"),
      d.appendChild(l),
      e.derivBody.appendChild(d);
    return;
  }
  const o = new Set(i);
  for (const [d, l] of r) o.has(d) || (l.remove(), r.delete(d));
  for (const d of i) {
    let l;
    try {
      l = $t(c.read(d));
    } catch {
      l = "<error>";
    }
    xe(r, e.derivBody, d, l, !0, s);
  }
}
function mr(e, r, c, s) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    l = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    p;
  try {
    const M = JSON.stringify(c);
    p = fe(M, 60);
  } catch {
    p = "{}";
  }
  const f = document.createElement("span");
  (f.style.color = B.closeBtn), (f.textContent = l);
  const u = document.createElement("span");
  (u.style.color = B.accent), (u.textContent = ` ${r} `);
  const x = document.createElement("span");
  for (
    x.style.color = B.muted,
      x.textContent = p,
      o.appendChild(f),
      o.appendChild(u),
      o.appendChild(x),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > ur;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(s);
}
function hr(e, r) {
  e.perfBody.replaceChildren();
  const c =
      r.reconcileCount > 0
        ? (r.reconcileTotalMs / r.reconcileCount).toFixed(1)
        : "—",
    s = [
      `Reconciles: ${r.reconcileCount}  (avg ${c}ms)`,
      `Effects: ${r.effectRunCount} run, ${r.effectErrorCount} errors`,
    ];
  for (const i of s) {
    const o = document.createElement("div");
    (o.style.marginBottom = "2px"),
      (o.textContent = i),
      e.perfBody.appendChild(o);
  }
  if (r.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = B.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const o = [...r.resolverStats.entries()].sort(
      (d, l) => l[1].totalMs - d[1].totalMs,
    );
    for (const [d, l] of o) {
      const p = l.count > 0 ? (l.totalMs / l.count).toFixed(1) : "0",
        f = document.createElement("div");
      (f.style.paddingLeft = "8px"),
        (f.textContent = `${d}: ${l.count}x, avg ${p}ms${l.errors > 0 ? `, ${l.errors} err` : ""}`),
        l.errors > 0 && (f.style.color = B.red),
        e.perfBody.appendChild(f);
    }
  }
}
function mt(e, r) {
  const c = r.debug;
  if (!c) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const s = c.currentIndex,
    i = c.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${s + 1} / ${i}` : "0 snapshots";
  const o = s > 0,
    d = s < i - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function gr(e, r) {
  e.undoBtn.addEventListener("click", () => {
    r.debug && r.debug.currentIndex > 0 && r.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      r.debug &&
        r.debug.currentIndex < r.debug.snapshots.length - 1 &&
        r.debug.goForward(1);
    });
}
var Be = new WeakMap();
function vr(e, r, c, s, i, o) {
  return [
    e.join(","),
    r.join(","),
    c.map((d) => `${d.id}:${d.active}`).join(","),
    [...s.entries()].map(([d, l]) => `${d}:${l.status}:${l.type}`).join(","),
    i.join(","),
    o.join(","),
  ].join("|");
}
function yr(e, r, c, s, i) {
  for (const o of c) {
    const d = e.nodes.get(`0:${o}`);
    if (!d) continue;
    const l = r.recentlyChangedFacts.has(o);
    d.rect.setAttribute("fill", l ? B.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", l ? "2" : "1");
  }
  for (const o of s) {
    const d = e.nodes.get(`1:${o}`);
    if (!d) continue;
    const l = r.recentlyComputedDerivations.has(o);
    d.rect.setAttribute("fill", l ? B.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", l ? "2" : "1");
  }
  for (const o of i) {
    const d = e.nodes.get(`2:${o}`);
    if (!d) continue;
    const l = r.recentlyActiveConstraints.has(o),
      p = d.rect.getAttribute("stroke") ?? B.muted;
    d.rect.setAttribute("fill", l ? p + "33" : "none"),
      d.rect.setAttribute("stroke-width", l ? "2" : "1");
  }
}
function ht(e, r, c) {
  const s = Ee(r);
  if (!s) return;
  let i;
  try {
    i = Object.keys(r.facts.$store.toObject());
  } catch {
    i = [];
  }
  const o = Object.keys(r.derive),
    d = s.constraints,
    l = s.unmet,
    p = s.inflight,
    f = Object.keys(s.resolvers),
    u = new Map();
  for (const v of l)
    u.set(v.id, {
      type: v.requirement.type,
      fromConstraint: v.fromConstraint,
      status: "unmet",
    });
  for (const v of p)
    u.set(v.id, { type: v.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && o.length === 0 && d.length === 0 && f.length === 0) {
    Be.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
    v.setAttribute("x", "230"),
      v.setAttribute("y", "24"),
      v.setAttribute("text-anchor", "middle"),
      v.setAttribute("fill", B.muted),
      v.setAttribute("font-size", "10"),
      v.setAttribute("font-family", B.font),
      (v.textContent = "No system topology"),
      e.flowSvg.appendChild(v);
    return;
  }
  const x = p.map((v) => v.resolverId).sort(),
    M = vr(i, o, d, u, f, x),
    D = Be.get(e.flowSvg);
  if (D && D.fingerprint === M) {
    yr(
      D,
      c,
      i,
      o,
      d.map((v) => v.id),
    );
    return;
  }
  const A = Q.nodeW + Q.colGap,
    j = [5, 5 + A, 5 + A * 2, 5 + A * 3, 5 + A * 4],
    $ = j[4] + Q.nodeW + 5;
  function O(v) {
    let R = Q.startY + 12;
    return v.map((t) => {
      const n = { ...t, y: R };
      return (R += Q.nodeH + Q.nodeGap), n;
    });
  }
  const P = O(i.map((v) => ({ id: v, label: fe(v, Q.labelMaxChars) }))),
    _ = O(o.map((v) => ({ id: v, label: fe(v, Q.labelMaxChars) }))),
    h = O(
      d.map((v) => ({
        id: v.id,
        label: fe(v.id, Q.labelMaxChars),
        active: v.active,
        priority: v.priority,
      })),
    ),
    E = O(
      [...u.entries()].map(([v, R]) => ({
        id: v,
        type: R.type,
        fromConstraint: R.fromConstraint,
        status: R.status,
      })),
    ),
    y = O(f.map((v) => ({ id: v, label: fe(v, Q.labelMaxChars) }))),
    C = Math.max(P.length, _.length, h.length, E.length, y.length, 1),
    k = Q.startY + 12 + C * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${$} ${k}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${o.length} derivations, ${d.length} constraints, ${u.size} requirements, ${f.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [v, R] of z.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(j[v] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", B.accent),
      t.setAttribute("font-size", String(Q.fontSize)),
      t.setAttribute("font-family", B.font),
      (t.textContent = R),
      e.flowSvg.appendChild(t);
  }
  const m = { fingerprint: M, nodes: new Map() };
  function b(v, R, t, n, a, g, S, I) {
    const L = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(R)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", I ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", I ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      L.appendChild(W);
    const T = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      T.setAttribute("x", String(R + 4)),
      T.setAttribute("y", String(t + 4)),
      T.setAttribute("fill", g),
      T.setAttribute("font-size", String(Q.fontSize)),
      T.setAttribute("font-family", B.font),
      T.setAttribute("opacity", S ? "0.35" : "1"),
      (T.textContent = a),
      L.appendChild(T),
      e.flowSvg.appendChild(L),
      m.nodes.set(`${v}:${n}`, { g: L, rect: W, text: T }),
      { midX: R + Q.nodeW / 2, midY: t }
    );
  }
  function w(v, R, t, n, a, g) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(v)),
      S.setAttribute("y1", String(R)),
      S.setAttribute("x2", String(t)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", a),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const q = new Map(),
    N = new Map(),
    K = new Map(),
    F = new Map();
  for (const v of P) {
    const R = c.recentlyChangedFacts.has(v.id),
      t = b(0, j[0], v.y, v.id, v.label, B.text, !1, R);
    q.set(v.id, t);
  }
  for (const v of _) {
    const R = c.recentlyComputedDerivations.has(v.id),
      t = b(1, j[1], v.y, v.id, v.label, B.accent, !1, R);
    N.set(v.id, t);
  }
  for (const v of h) {
    const R = c.recentlyActiveConstraints.has(v.id),
      t = b(
        2,
        j[2],
        v.y,
        v.id,
        v.label,
        v.active ? B.yellow : B.muted,
        !v.active,
        R,
      );
    K.set(v.id, t);
  }
  for (const v of E) {
    const R = v.status === "unmet" ? B.red : B.yellow,
      t = b(3, j[3], v.y, v.id, fe(v.type, Q.labelMaxChars), R, !1, !1);
    F.set(v.id, t);
  }
  for (const v of y) {
    const R = p.some((t) => t.resolverId === v.id);
    b(4, j[4], v.y, v.id, v.label, R ? B.green : B.muted, !R, !1);
  }
  for (const v of _) {
    const R = c.derivationDeps.get(v.id),
      t = N.get(v.id);
    if (R && t)
      for (const n of R) {
        const a = q.get(n);
        a &&
          w(
            a.midX + Q.nodeW / 2,
            a.midY,
            t.midX - Q.nodeW / 2,
            t.midY,
            B.accent,
          );
      }
  }
  for (const v of E) {
    const R = K.get(v.fromConstraint),
      t = F.get(v.id);
    R &&
      t &&
      w(R.midX + Q.nodeW / 2, R.midY, t.midX - Q.nodeW / 2, t.midY, B.muted);
  }
  for (const v of p) {
    const R = F.get(v.id);
    if (R) {
      const t = y.find((n) => n.id === v.resolverId);
      t && w(R.midX + Q.nodeW / 2, R.midY, j[4], t.y, B.green);
    }
  }
  Be.set(e.flowSvg, m);
}
function br(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function wr(e, r) {
  const c = r.entries.toArray();
  if (c.length === 0) return;
  e.timelineSvg.replaceChildren();
  let s = 1 / 0,
    i = -1 / 0;
  for (const D of c)
    D.startMs < s && (s = D.startMs), D.endMs > i && (i = D.endMs);
  const o = performance.now();
  for (const D of r.inflight.values()) D < s && (s = D), o > i && (i = o);
  const d = i - s || 1,
    l = Ae - ve - 10,
    p = [],
    f = new Set();
  for (const D of c)
    f.has(D.resolver) || (f.add(D.resolver), p.push(D.resolver));
  for (const D of r.inflight.keys()) f.has(D) || (f.add(D), p.push(D));
  const u = p.slice(-12),
    x = ge * u.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Ae} ${x}`),
    e.timelineSvg.setAttribute("height", String(Math.min(x, 200)));
  const M = 5;
  for (let D = 0; D <= M; D++) {
    const A = ve + (l * D) / M,
      j = (d * D) / M,
      $ = document.createElementNS("http://www.w3.org/2000/svg", "text");
    $.setAttribute("x", String(A)),
      $.setAttribute("y", "8"),
      $.setAttribute("fill", B.muted),
      $.setAttribute("font-size", "6"),
      $.setAttribute("font-family", B.font),
      $.setAttribute("text-anchor", "middle"),
      ($.textContent =
        j < 1e3 ? `${j.toFixed(0)}ms` : `${(j / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild($);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "line");
    O.setAttribute("x1", String(A)),
      O.setAttribute("y1", "10"),
      O.setAttribute("x2", String(A)),
      O.setAttribute("y2", String(x)),
      O.setAttribute("stroke", B.border),
      O.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(O);
  }
  for (let D = 0; D < u.length; D++) {
    const A = u[D],
      j = 12 + D * ge,
      $ = D % ut.length,
      O = ut[$],
      P = document.createElementNS("http://www.w3.org/2000/svg", "text");
    P.setAttribute("x", String(ve - 4)),
      P.setAttribute("y", String(j + ge / 2 + 3)),
      P.setAttribute("fill", B.muted),
      P.setAttribute("font-size", "7"),
      P.setAttribute("font-family", B.font),
      P.setAttribute("text-anchor", "end"),
      (P.textContent = fe(A, 12)),
      e.timelineSvg.appendChild(P);
    const _ = c.filter((E) => E.resolver === A);
    for (const E of _) {
      const y = ve + ((E.startMs - s) / d) * l,
        C = Math.max(((E.endMs - E.startMs) / d) * l, dt),
        k = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      k.setAttribute("x", String(y)),
        k.setAttribute("y", String(j + 2)),
        k.setAttribute("width", String(C)),
        k.setAttribute("height", String(ge - 4)),
        k.setAttribute("rx", "2"),
        k.setAttribute("fill", E.error ? B.red : O),
        k.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        m = E.endMs - E.startMs;
      (z.textContent = `${A}: ${m.toFixed(1)}ms${E.error ? " (error)" : ""}`),
        k.appendChild(z),
        e.timelineSvg.appendChild(k);
    }
    const h = r.inflight.get(A);
    if (h !== void 0) {
      const E = ve + ((h - s) / d) * l,
        y = Math.max(((o - h) / d) * l, dt),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String(E)),
        C.setAttribute("y", String(j + 2)),
        C.setAttribute("width", String(y)),
        C.setAttribute("height", String(ge - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", O),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", O),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const k = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (k.textContent = `${A}: inflight ${(o - h).toFixed(0)}ms`),
        C.appendChild(k),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${c.length} resolver executions across ${u.length} resolvers`,
  );
}
function Sr() {
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
        getSystem(c) {
          return c
            ? (e.get(c)?.system ?? null)
            : (e.values().next().value?.system ?? null);
        },
        getSystems() {
          return [...e.keys()];
        },
        inspect(c) {
          return this.getSystem(c)?.inspect() ?? null;
        },
        getEvents(c) {
          return c
            ? (e.get(c)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(c, s) {
          return this.getSystem(s)?.explain(c) ?? null;
        },
        subscribe(c, s) {
          const i = s ? e.get(s) : e.values().next().value;
          if (!i) {
            let o = !1,
              d = setInterval(() => {
                const p = s ? e.get(s) : e.values().next().value;
                p && !o && ((o = !0), p.subscribers.add(c));
              }, 100),
              l = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(l);
              for (const p of e.values()) p.subscribers.delete(c);
            };
          }
          return (
            i.subscribers.add(c),
            () => {
              i.subscribers.delete(c);
            }
          );
        },
        exportSession(c) {
          const s = c ? e.get(c) : e.values().next().value;
          return s
            ? JSON.stringify({
                version: 1,
                name: c ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: s.events.toArray(),
              })
            : null;
        },
        importSession(c, s) {
          try {
            if (c.length > 10 * 1024 * 1024) return !1;
            const i = JSON.parse(c);
            if (
              !i ||
              typeof i != "object" ||
              Array.isArray(i) ||
              !Array.isArray(i.events)
            )
              return !1;
            const o = s ? e.get(s) : e.values().next().value;
            if (!o) return !1;
            const d = o.maxEvents,
              l = i.events,
              p = l.length > d ? l.length - d : 0;
            o.events.clear();
            for (let f = p; f < l.length; f++) {
              const u = l[f];
              u &&
                typeof u == "object" &&
                !Array.isArray(u) &&
                typeof u.timestamp == "number" &&
                typeof u.type == "string" &&
                u.type !== "__proto__" &&
                u.type !== "constructor" &&
                u.type !== "prototype" &&
                o.events.push({
                  timestamp: u.timestamp,
                  type: u.type,
                  data: u.data ?? null,
                });
            }
            return !0;
          } catch {
            return !1;
          }
        },
        clearEvents(c) {
          const s = c ? e.get(c) : e.values().next().value;
          s && s.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: r,
        writable: !1,
        configurable: Ve(),
        enumerable: !0,
      }),
      r
    );
  }
  return window.__DIRECTIVE__;
}
function Er(e = {}) {
  const {
      name: r = "default",
      trace: c = !1,
      maxEvents: s,
      panel: i = !1,
      position: o = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    l = nr(s),
    p = Sr(),
    f = {
      system: null,
      events: new xt(l),
      maxEvents: l,
      subscribers: new Set(),
    };
  p.systems.set(r, f);
  let u = (n, a) => {
      const g = { timestamp: Date.now(), type: n, data: a };
      c && f.events.push(g);
      for (const S of f.subscribers)
        try {
          S(g);
        } catch {}
    },
    x = null,
    M = new Map(),
    D = new Map(),
    A = ir(),
    j = lr(),
    $ = dr(),
    O = or(),
    P = i && typeof window < "u" && typeof document < "u" && Ve(),
    _ = null,
    h = 0,
    E = 1,
    y = 2,
    C = 4,
    k = 8,
    z = 16,
    m = 32,
    b = 64,
    w = 128,
    q = new Map(),
    N = new Set(),
    K = null;
  function F(n) {
    (h |= n),
      _ === null &&
        typeof requestAnimationFrame < "u" &&
        (_ = requestAnimationFrame(v));
  }
  function v() {
    if (((_ = null), !x || !f.system)) {
      h = 0;
      return;
    }
    const n = x.refs,
      a = f.system,
      g = h;
    if (((h = 0), g & E)) {
      for (const S of N) pr(M, S);
      N.clear();
      for (const [S, { value: I, flash: L }] of q)
        xe(M, n.factsBody, S, I, L, x.flashTimers);
      q.clear(), (n.factsCount.textContent = String(M.size));
    }
    if ((g & y && pt(n, D, a, x.flashTimers), g & k))
      if (K) qe(n, K.inflight.length, K.unmet.length);
      else {
        const S = Ee(a);
        S && qe(n, S.inflight.length, S.unmet.length);
      }
    if (g & C)
      if (K) Me(n, K.inflight, K.unmet);
      else {
        const S = Ee(a);
        S && Me(n, S.inflight, S.unmet);
      }
    g & z && hr(n, A),
      g & m && ht(n, a, j),
      g & b && mt(n, a),
      g & w && wr(n, O);
  }
  function R(n, a) {
    x && c && mr(x.refs, n, a, f.events.size);
  }
  function t(n, a) {
    $.isRecording &&
      $.recordedEvents.length < ar &&
      $.recordedEvents.push({ timestamp: Date.now(), type: n, data: rr(a) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((f.system = n),
        u("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${r}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        P)
      ) {
        const a = f.system;
        x = fr(r, o, d, c);
        const g = x.refs;
        try {
          const I = a.facts.$store.toObject();
          for (const [L, W] of Object.entries(I)) xe(M, g.factsBody, L, W, !1);
          g.factsCount.textContent = String(Object.keys(I).length);
        } catch {}
        pt(g, D, a);
        const S = Ee(a);
        S &&
          (qe(g, S.inflight.length, S.unmet.length),
          Me(g, S.inflight, S.unmet)),
          mt(g, a),
          gr(g, a),
          ht(g, a, j),
          g.recordBtn.addEventListener("click", () => {
            if (
              (($.isRecording = !$.isRecording),
              (g.recordBtn.textContent = $.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = $.isRecording ? B.red : B.text),
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
          g.exportBtn.addEventListener("click", () => {
            const I =
                $.recordedEvents.length > 0
                  ? $.recordedEvents
                  : f.events.toArray(),
              L = JSON.stringify(
                {
                  version: 1,
                  name: r,
                  exportedAt: Date.now(),
                  events: I,
                  snapshots: $.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([L], { type: "application/json" }),
              T = URL.createObjectURL(W),
              U = document.createElement("a");
            (U.href = T),
              (U.download = `directive-session-${r}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(T);
          });
      }
    },
    onStart: (n) => {
      u("start", {}), R("start", {}), t("start", {});
    },
    onStop: (n) => {
      u("stop", {}), R("stop", {}), t("stop", {});
    },
    onDestroy: (n) => {
      u("destroy", {}),
        p.systems.delete(r),
        _ !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(_), (_ = null)),
        j.animationTimer && clearTimeout(j.animationTimer),
        x && (x.destroy(), (x = null), M.clear(), D.clear());
    },
    onFactSet: (n, a, g) => {
      u("fact.set", { key: n, value: a, prev: g }),
        t("fact.set", { key: n, value: a, prev: g }),
        j.recentlyChangedFacts.add(n),
        x &&
          f.system &&
          (q.set(n, { value: a, flash: !0 }),
          N.delete(n),
          F(E),
          R("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      u("fact.delete", { key: n, prev: a }),
        t("fact.delete", { key: n, prev: a }),
        x && (N.add(n), q.delete(n), F(E), R("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (u("facts.batch", { changes: n }),
        t("facts.batch", { count: n.length }),
        x && f.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (N.add(a.key), q.delete(a.key))
            : (j.recentlyChangedFacts.add(a.key),
              q.set(a.key, { value: a.value, flash: !0 }),
              N.delete(a.key));
        F(E), R("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, a, g) => {
      u("derivation.compute", { id: n, value: a, deps: g }),
        t("derivation.compute", { id: n, deps: g }),
        j.derivationDeps.set(n, g),
        j.recentlyComputedDerivations.add(n),
        R("derivation.compute", { id: n, deps: g });
    },
    onDerivationInvalidate: (n) => {
      u("derivation.invalidate", { id: n }),
        R("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      u("reconcile.start", {}),
        (A.lastReconcileStartMs = performance.now()),
        R("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (u("reconcile.end", n),
        t("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
          completed: n.completed.length,
        }),
        A.lastReconcileStartMs > 0)
      ) {
        const a = performance.now() - A.lastReconcileStartMs;
        A.reconcileCount++,
          (A.reconcileTotalMs += a),
          (A.lastReconcileStartMs = 0);
      }
      if ($.isRecording && f.system && $.snapshots.length < cr)
        try {
          $.snapshots.push({
            timestamp: Date.now(),
            facts: f.system.facts.$store.toObject(),
          });
        } catch {}
      x &&
        f.system &&
        ((K = n),
        br(j),
        F(y | k | C | z | m | b),
        R("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, a) => {
      u("constraint.evaluate", { id: n, active: a }),
        t("constraint.evaluate", { id: n, active: a }),
        a
          ? (j.activeConstraints.add(n), j.recentlyActiveConstraints.add(n))
          : j.activeConstraints.delete(n),
        R("constraint.evaluate", { id: n, active: a });
    },
    onConstraintError: (n, a) => {
      u("constraint.error", { id: n, error: String(a) }),
        R("constraint.error", { id: n, error: String(a) });
    },
    onRequirementCreated: (n) => {
      u("requirement.created", { id: n.id, type: n.requirement.type }),
        t("requirement.created", { id: n.id, type: n.requirement.type }),
        R("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, a) => {
      u("requirement.met", { id: n.id, byResolver: a }),
        t("requirement.met", { id: n.id, byResolver: a }),
        R("requirement.met", { id: n.id, byResolver: a });
    },
    onRequirementCanceled: (n) => {
      u("requirement.canceled", { id: n.id }),
        t("requirement.canceled", { id: n.id }),
        R("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, a) => {
      u("resolver.start", { resolver: n, requirementId: a.id }),
        t("resolver.start", { resolver: n, requirementId: a.id }),
        O.inflight.set(n, performance.now()),
        x &&
          f.system &&
          (F(C | k | w),
          R("resolver.start", { resolver: n, requirementId: a.id }));
    },
    onResolverComplete: (n, a, g) => {
      u("resolver.complete", { resolver: n, requirementId: a.id, duration: g }),
        t("resolver.complete", {
          resolver: n,
          requirementId: a.id,
          duration: g,
        });
      const S = A.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += g),
        A.resolverStats.set(n, S),
        A.resolverStats.size > ft)
      ) {
        const L = A.resolverStats.keys().next().value;
        L !== void 0 && A.resolverStats.delete(L);
      }
      const I = O.inflight.get(n);
      O.inflight.delete(n),
        I !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: I,
            endMs: performance.now(),
            error: !1,
          }),
        x &&
          f.system &&
          (F(C | k | z | w),
          R("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, a, g) => {
      u("resolver.error", {
        resolver: n,
        requirementId: a.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: n,
          requirementId: a.id,
          error: String(g),
        });
      const S = A.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, A.resolverStats.set(n, S), A.resolverStats.size > ft)) {
        const L = A.resolverStats.keys().next().value;
        L !== void 0 && A.resolverStats.delete(L);
      }
      const I = O.inflight.get(n);
      O.inflight.delete(n),
        I !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: I,
            endMs: performance.now(),
            error: !0,
          }),
        x &&
          f.system &&
          (F(C | k | z | w),
          R("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, a, g) => {
      u("resolver.retry", { resolver: n, requirementId: a.id, attempt: g }),
        t("resolver.retry", { resolver: n, requirementId: a.id, attempt: g }),
        R("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, a) => {
      u("resolver.cancel", { resolver: n, requirementId: a.id }),
        t("resolver.cancel", { resolver: n, requirementId: a.id }),
        O.inflight.delete(n),
        R("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      u("effect.run", { id: n }),
        t("effect.run", { id: n }),
        A.effectRunCount++,
        R("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      u("effect.error", { id: n, error: String(a) }),
        A.effectErrorCount++,
        R("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      u("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        x && f.system && F(b),
        R("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (u("timetravel.jump", { from: n, to: a }),
        t("timetravel.jump", { from: n, to: a }),
        x && f.system)
      ) {
        const g = f.system;
        try {
          const S = g.facts.$store.toObject();
          M.clear(), x.refs.factsBody.replaceChildren();
          for (const [I, L] of Object.entries(S))
            xe(M, x.refs.factsBody, I, L, !1);
          x.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        D.clear(),
          j.derivationDeps.clear(),
          x.refs.derivBody.replaceChildren(),
          (K = null),
          F(y | k | C | m | b),
          R("timetravel.jump", { from: n, to: a });
      }
    },
    onError: (n) => {
      u("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        t("error", { source: n.source, message: n.message }),
        R("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, a) => {
      u("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: a,
      }),
        R("error.recovery", { source: n.source, strategy: a });
    },
  };
}
function He(e) {
  return Math.random() * 100 < e;
}
function Ue(e) {
  return new Promise((r) => setTimeout(r, e));
}
async function xr(e, r) {
  if ((await Ue(600), He(r)))
    throw new Error("Session validation failed (network error)");
  return { valid: e.length > 0, userId: `user-${e.slice(0, 6)}` };
}
async function $r(e) {
  if ((await Ue(400), He(e)))
    throw new Error("Permissions fetch failed (timeout)");
  const r = ["admin", "editor", "viewer"],
    c = r[Math.floor(Math.random() * r.length)];
  return {
    role: c,
    permissions: {
      admin: ["read", "write", "delete", "manage-users", "view-analytics"],
      editor: ["read", "write", "view-analytics"],
      viewer: ["read"],
    }[c] ?? ["read"],
  };
}
async function Cr(e, r) {
  if ((await Ue(500), He(r)))
    throw new Error("Dashboard fetch failed (server error)");
  const c = [
    { id: "w1", type: "stat", title: "Active Users", value: "1,247" },
    { id: "w2", type: "chart", title: "Revenue", value: "$84.2K" },
  ];
  return (
    (e === "admin" || e === "editor") &&
      c.push(
        {
          id: "w3",
          type: "table",
          title: "Recent Orders",
          value: "38 pending",
        },
        { id: "w4", type: "stat", title: "Conversion Rate", value: "3.2%" },
      ),
    e === "admin" &&
      c.push(
        { id: "w5", type: "chart", title: "Server Load", value: "42% avg" },
        { id: "w6", type: "stat", title: "Error Rate", value: "0.03%" },
      ),
    { widgets: c }
  );
}
const Oe = {
    facts: {
      token: te.string(),
      status: te.string(),
      userId: te.string(),
      failRate: te.number(),
    },
    derivations: { isValid: te.boolean() },
    events: {
      setToken: { value: te.string() },
      setFailRate: { value: te.number() },
      reset: {},
    },
    requirements: { VALIDATE_SESSION: { token: te.string() } },
  },
  Rr = Ke("auth", {
    schema: Oe,
    init: (e) => {
      (e.token = ""), (e.status = "idle"), (e.userId = ""), (e.failRate = 0);
    },
    derive: { isValid: (e) => e.status === "valid" },
    events: {
      setToken: (e, { value: r }) => {
        (e.token = r), (e.status = "idle"), (e.userId = "");
      },
      setFailRate: (e, { value: r }) => {
        e.failRate = r;
      },
      reset: (e) => {
        (e.token = ""), (e.status = "idle"), (e.userId = "");
      },
    },
    constraints: {
      validateSession: {
        when: (e) => e.token !== "" && e.status === "idle",
        require: (e) => ({ type: "VALIDATE_SESSION", token: e.token }),
      },
    },
    resolvers: {
      validateSession: {
        requirement: "VALIDATE_SESSION",
        key: (e) => `validate-${e.token}`,
        retry: { attempts: 2, backoff: "exponential", initialDelay: 300 },
        resolve: async (e, r) => {
          r.facts.status = "validating";
          try {
            const c = await xr(e.token, r.facts.failRate);
            c.valid
              ? ((r.facts.status = "valid"), (r.facts.userId = c.userId))
              : (r.facts.status = "expired");
          } catch {
            r.facts.status = "expired";
          }
        },
      },
    },
  }),
  je = {
    facts: {
      role: te.string(),
      permissions: te.array(),
      loaded: te.boolean(),
      failRate: te.number(),
    },
    derivations: {
      canEdit: te.boolean(),
      canPublish: te.boolean(),
      canManageUsers: te.boolean(),
    },
    events: { setFailRate: { value: te.number() }, reset: {} },
    requirements: { LOAD_PERMISSIONS: {} },
  },
  kr = Ke("permissions", {
    schema: je,
    crossModuleDeps: { auth: Oe },
    init: (e) => {
      (e.role = ""), (e.permissions = []), (e.loaded = !1), (e.failRate = 0);
    },
    derive: {
      canEdit: (e) => e.self.permissions.includes("write"),
      canPublish: (e) =>
        e.self.permissions.includes("write") && e.self.role !== "viewer",
      canManageUsers: (e) => e.self.permissions.includes("manage-users"),
    },
    events: {
      setFailRate: (e, { value: r }) => {
        e.failRate = r;
      },
      reset: (e) => {
        (e.role = ""), (e.permissions = []), (e.loaded = !1);
      },
    },
    constraints: {
      loadPermissions: {
        after: ["auth::validateSession"],
        when: (e) => e.auth.status === "valid" && !e.self.loaded,
        require: { type: "LOAD_PERMISSIONS" },
      },
    },
    resolvers: {
      loadPermissions: {
        requirement: "LOAD_PERMISSIONS",
        retry: { attempts: 2, backoff: "exponential", initialDelay: 200 },
        resolve: async (e, r) => {
          try {
            const c = await $r(r.facts.failRate);
            (r.facts.role = c.role),
              (r.facts.permissions = c.permissions),
              (r.facts.loaded = !0);
          } catch {
            r.facts.loaded = !1;
          }
        },
      },
    },
  }),
  We = {
    facts: { widgets: te.array(), loaded: te.boolean(), failRate: te.number() },
    derivations: { widgetCount: te.number() },
    events: { setFailRate: { value: te.number() }, reset: {} },
    requirements: { LOAD_DASHBOARD: { role: te.string() } },
  },
  Dr = Ke("dashboard", {
    schema: We,
    crossModuleDeps: { permissions: je },
    init: (e) => {
      (e.widgets = []), (e.loaded = !1), (e.failRate = 0);
    },
    derive: { widgetCount: (e) => e.self.widgets.length },
    events: {
      setFailRate: (e, { value: r }) => {
        e.failRate = r;
      },
      reset: (e) => {
        (e.widgets = []), (e.loaded = !1);
      },
    },
    constraints: {
      loadDashboard: {
        after: ["permissions::loadPermissions"],
        when: (e) => e.permissions.role !== "" && !e.self.loaded,
        require: (e) => ({ type: "LOAD_DASHBOARD", role: e.permissions.role }),
      },
    },
    resolvers: {
      loadDashboard: {
        requirement: "LOAD_DASHBOARD",
        key: (e) => `dashboard-${e.role}`,
        retry: { attempts: 2, backoff: "exponential", initialDelay: 300 },
        resolve: async (e, r) => {
          try {
            const c = await Cr(e.role, r.facts.failRate);
            (r.facts.widgets = c.widgets), (r.facts.loaded = !0);
          } catch {
            r.facts.loaded = !1;
          }
        },
      },
    },
  }),
  ie = Gt({
    modules: { auth: Rr, permissions: kr, dashboard: Dr },
    plugins: [tr({ level: "info" }), Er({ name: "async-chains", trace: !0 })],
    debug: { timeTravel: !0, maxSnapshots: 50 },
  });
ie.start();
const Ar = [
    ...Object.keys(Oe.facts).map((e) => `auth.${e}`),
    ...Object.keys(Oe.derivations).map((e) => `auth.${e}`),
    ...Object.keys(je.facts).map((e) => `permissions.${e}`),
    ...Object.keys(je.derivations).map((e) => `permissions.${e}`),
    ...Object.keys(We.facts).map((e) => `dashboard.${e}`),
    ...Object.keys(We.derivations).map((e) => `dashboard.${e}`),
  ],
  he = [];
function pe(e, r, c) {
  he.push({ timestamp: Date.now(), module: e, event: r, detail: c }),
    he.length > 50 && he.shift(),
    Kr();
}
const Or = document.getElementById("ac-auth-box"),
  jr = document.getElementById("ac-auth-status"),
  Ir = document.getElementById("ac-auth-detail"),
  Mr = document.getElementById("ac-perms-box"),
  qr = document.getElementById("ac-perms-status"),
  Br = document.getElementById("ac-perms-detail"),
  _r = document.getElementById("ac-dash-box"),
  Tr = document.getElementById("ac-dash-status"),
  zr = document.getElementById("ac-dash-detail"),
  Fr = document.getElementById("ac-arrow-1"),
  Lr = document.getElementById("ac-arrow-2"),
  Ct = document.getElementById("ac-start-btn"),
  Rt = document.getElementById("ac-reset-btn"),
  gt = document.getElementById("ac-auth-fail-rate"),
  Pr = document.getElementById("ac-auth-fail-val"),
  vt = document.getElementById("ac-perms-fail-rate"),
  Nr = document.getElementById("ac-perms-fail-val"),
  yt = document.getElementById("ac-dash-fail-rate"),
  Wr = document.getElementById("ac-dash-fail-val"),
  _e = document.getElementById("ac-timeline");
let $e = "",
  Ce = !1,
  Re = !1;
function Te(e) {
  if (e === "auth") {
    const i = ie.facts.auth.status;
    return i === "idle"
      ? "idle"
      : i === "validating"
        ? "running"
        : i === "valid"
          ? "success"
          : "error";
  }
  if (e === "permissions") {
    const i = ie.facts.permissions.loaded,
      o = ie.facts.permissions.role,
      d = ie.derive.auth.isValid;
    return d
      ? i && o !== ""
        ? "success"
        : !i && d
          ? "running"
          : "idle"
      : "idle";
  }
  const r = ie.facts.dashboard.loaded,
    c = ie.facts.dashboard.widgets,
    s = ie.facts.permissions.role;
  return s === ""
    ? "idle"
    : r && c.length > 0
      ? "success"
      : !r && s !== ""
        ? "running"
        : "idle";
}
function ze(e, r, c, s, i) {
  (e.className = `ac-chain-box ${s}`),
    (r.textContent = s),
    (r.className = `ac-chain-badge ${s}`),
    (c.textContent = i);
}
function bt(e, r, c) {
  (e.className = "ac-arrow"),
    c ? e.classList.add("done") : r && e.classList.add("active");
}
function Je() {
  const e = ie.facts.auth,
    r = ie.facts.permissions,
    c = ie.facts.dashboard,
    s = ie.derive.dashboard,
    i = Te("auth"),
    o = Te("permissions"),
    d = Te("dashboard");
  let l = "";
  i === "idle"
    ? (l = "Waiting for token")
    : i === "running"
      ? (l = "Validating session...")
      : i === "success"
        ? (l = `User: ${e.userId}`)
        : (l = "Session expired"),
    ze(Or, jr, Ir, i, l);
  let p = "";
  o === "idle"
    ? (p = "Waiting for auth")
    : o === "running"
      ? (p = "Loading permissions...")
      : o === "success"
        ? (p = `Role: ${r.role}`)
        : (p = "Failed to load"),
    ze(Mr, qr, Br, o, p);
  let f = "";
  d === "idle"
    ? (f = "Waiting for permissions")
    : d === "running"
      ? (f = "Loading dashboard...")
      : d === "success"
        ? (f = `${s.widgetCount} widgets loaded`)
        : (f = "Failed to load"),
    ze(_r, Tr, zr, d, f);
  const u = i === "success",
    x = o === "success";
  bt(Fr, i === "running" || o === "running", u),
    bt(Lr, o === "running" || d === "running", x);
  const M = e.status;
  M !== $e && ($e !== "" && M !== "idle" && pe("auth", M, l), ($e = M));
  const D = r.loaded;
  D !== Ce &&
    (D
      ? pe("permissions", "loaded", `Role: ${r.role}`)
      : Ce && pe("permissions", "reset", "Permissions cleared"),
    (Ce = D));
  const A = c.loaded;
  if (A !== Re) {
    if (A) {
      const $ = s.widgetCount;
      pe("dashboard", "loaded", `${$} widgets`);
    } else Re && pe("dashboard", "reset", "Dashboard cleared");
    Re = A;
  }
  (Pr.textContent = `${e.failRate}%`),
    (Nr.textContent = `${r.failRate}%`),
    (Wr.textContent = `${c.failRate}%`);
  const j = e.token;
  (Ct.disabled = j !== "" && M !== "idle"),
    (Rt.disabled = M === "idle" && !D && !A);
}
function Kr() {
  if (he.length === 0) {
    _e.innerHTML =
      '<div class="ac-timeline-empty">Events will appear here after starting the chain</div>';
    return;
  }
  _e.innerHTML = "";
  for (let e = he.length - 1; e >= 0; e--) {
    const r = he[e],
      c = document.createElement("div");
    c.className = `ac-timeline-entry ${r.module}`;
    const i = new Date(r.timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    (c.innerHTML = `
      <span class="ac-timeline-time">${i}</span>
      <span class="ac-timeline-module">${Fe(r.module)}</span>
      <span class="ac-timeline-event">${Fe(r.event)}</span>
      <span class="ac-timeline-detail">${Fe(r.detail)}</span>
    `),
      _e.appendChild(c);
  }
}
ie.subscribe(Ar, Je);
function Vr() {
  const e = `tok-${Math.random().toString(36).slice(2, 10)}`;
  pe("auth", "start", `Token: ${e}`), ie.events.auth.setToken({ value: e });
}
Ct.addEventListener("click", Vr);
Rt.addEventListener("click", () => {
  ie.events.auth.reset(),
    ie.events.permissions.reset(),
    ie.events.dashboard.reset(),
    (he.length = 0),
    ($e = ""),
    (Ce = !1),
    (Re = !1),
    pe("system", "reset", "All modules reset"),
    Je();
});
gt.addEventListener("input", () => {
  ie.events.auth.setFailRate({ value: Number(gt.value) });
});
vt.addEventListener("input", () => {
  ie.events.permissions.setFailRate({ value: Number(vt.value) });
});
yt.addEventListener("input", () => {
  ie.events.dashboard.setFailRate({ value: Number(yt.value) });
});
function Fe(e) {
  const r = document.createElement("div");
  return (r.textContent = e), r.innerHTML;
}
Je();
document.body.setAttribute("data-async-chains-ready", "true");
