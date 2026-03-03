(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) o(i);
  new MutationObserver((i) => {
    for (const s of i)
      if (s.type === "childList")
        for (const u of s.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && o(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function l(i) {
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
    const s = l(i);
    fetch(i.href, s);
  }
})();
var We = class extends Error {
    constructor(t, l, o, i, s = !0) {
      super(t),
        (this.source = l),
        (this.sourceId = o),
        (this.context = i),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  pe = [];
function wt() {
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
var St = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function xt() {
  return pe[pe.length - 1] ?? St;
}
function $e(e) {
  const t = wt();
  pe.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    pe.pop();
  }
}
function Ue(e) {
  const t = pe.splice(0, pe.length);
  try {
    return e();
  } finally {
    pe.push(...t);
  }
}
function Pe(e) {
  xt().track(e);
}
function $t(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Ee(e = [], t, l, o, i, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: o,
    _description: i,
    _refinements: s,
    validate(u) {
      return Ee([...e, u], t, l, o, i, s);
    },
  };
}
function te(e, t, l, o, i, s) {
  return {
    ...Ee(e, t, l, o, i, s),
    default(u) {
      return te(e, t, u, o, i, s);
    },
    transform(u) {
      return te(
        [],
        t,
        void 0,
        (d) => {
          const g = o ? o(d) : d;
          return u(g);
        },
        i,
      );
    },
    brand() {
      return te(e, `Branded<${t}>`, l, o, i, s);
    },
    describe(u) {
      return te(e, t, l, o, u, s);
    },
    refine(u, d) {
      const g = [...(s ?? []), { predicate: u, message: d }];
      return te([...e, u], t, l, o, i, g);
    },
    nullable() {
      return te(
        [(u) => u === null || e.every((d) => d(u))],
        `${t} | null`,
        l,
        o,
        i,
      );
    },
    optional() {
      return te(
        [(u) => u === void 0 || e.every((d) => d(u))],
        `${t} | undefined`,
        l,
        o,
        i,
      );
    },
  };
}
var Z = {
  string() {
    return te([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, l, o, i, s) => ({
      ...te(t, "number", l, o, i, s),
      min(u) {
        return e([...t, (d) => d >= u], l, o, i, s);
      },
      max(u) {
        return e([...t, (d) => d <= u], l, o, i, s);
      },
      default(u) {
        return e(t, u, o, i, s);
      },
      describe(u) {
        return e(t, l, o, u, s);
      },
      refine(u, d) {
        const g = [...(s ?? []), { predicate: u, message: d }];
        return e([...t, u], l, o, i, g);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return te([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, o, i, s) => {
      const u = te(t, "array", o, void 0, i),
        d = s ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return d.value;
        },
        set _lastFailedIndex(g) {
          d.value = g;
        },
        of(g) {
          const f = { value: -1 };
          return e(
            [
              ...t,
              (c) => {
                for (let $ = 0; $ < c.length; $++) {
                  const T = c[$];
                  if (!g._validators.every((O) => O(T)))
                    return (f.value = $), !1;
                }
                return !0;
              },
            ],
            g,
            o,
            i,
            f,
          );
        },
        nonEmpty() {
          return e([...t, (g) => g.length > 0], l, o, i, d);
        },
        maxLength(g) {
          return e([...t, (f) => f.length <= g], l, o, i, d);
        },
        minLength(g) {
          return e([...t, (f) => f.length >= g], l, o, i, d);
        },
        default(g) {
          return e(t, l, g, i, d);
        },
        describe(g) {
          return e(t, l, o, g, d);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, o) => ({
      ...te(t, "object", l, void 0, o),
      shape(i) {
        return e(
          [
            ...t,
            (s) => {
              for (const [u, d] of Object.entries(i)) {
                const g = s[u],
                  f = d;
                if (f && !f._validators.every((c) => c(g))) return !1;
              }
              return !0;
            },
          ],
          l,
          o,
        );
      },
      nonNull() {
        return e([...t, (i) => i != null], l, o);
      },
      hasKeys(...i) {
        return e([...t, (s) => i.every((u) => u in s)], l, o);
      },
      default(i) {
        return e(t, i, o);
      },
      describe(i) {
        return e(t, l, i);
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
    return Ee(
      [(l) => (l === null ? !0 : e._validators.every((o) => o(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Ee(
      [(l) => (l === void 0 ? !0 : e._validators.every((o) => o(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return te(
      [(l) => e.some((o) => o._validators.every((i) => i(l)))],
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
            : Object.values(l).every((o) => e._validators.every((i) => i(o))),
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
            : e.every((o, i) => o._validators.every((s) => s(l[i]))),
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
function Et(e) {
  const { schema: t, onChange: l, onBatch: o } = e;
  Object.keys(t).length;
  let i = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    d = new Map(),
    g = new Set(),
    f = new Map(),
    c = new Set(),
    $ = 0,
    T = [],
    O = new Set(),
    j = !1,
    A = [],
    k = 100;
  function D(p) {
    return (
      p !== null &&
      typeof p == "object" &&
      "safeParse" in p &&
      typeof p.safeParse == "function" &&
      "_def" in p &&
      "parse" in p &&
      typeof p.parse == "function"
    );
  }
  function F(p) {
    const b = p;
    if (b._typeName) return b._typeName;
    if (D(p)) {
      const w = p._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function B(p) {
    return u ? "[redacted]" : $t(p);
  }
  function m(p, b) {
    if (!i) return;
    const w = t[p];
    if (!w) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${p}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${p}"`);
      return;
    }
    if (D(w)) {
      const z = w.safeParse(b);
      if (!z.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          C = B(b),
          r =
            z.error?.message ??
            z.error?.issues?.[0]?.message ??
            "Validation failed",
          n = F(w);
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${n}, got ${y} ${C}. ${r}`,
        );
      }
      return;
    }
    const I = w,
      N = I._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const U = I._typeName ?? "unknown";
    for (let z = 0; z < N.length; z++) {
      const y = N[z];
      if (typeof y == "function" && !y(b)) {
        let C = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          r = B(b),
          n = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const a = z === 0 ? "" : ` (validator ${z + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${p}": expected ${U}, got ${C} ${r}${a}${n}`,
        );
      }
    }
  }
  function x(p) {
    f.get(p)?.forEach((b) => b());
  }
  function v() {
    c.forEach((p) => p());
  }
  function E(p, b, w) {
    if (j) {
      A.push({ key: p, value: b, prev: w });
      return;
    }
    j = !0;
    try {
      l?.(p, b, w), x(p), v();
      let I = 0;
      while (A.length > 0) {
        if (++I > k)
          throw (
            ((A.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...A];
        A.length = 0;
        for (const U of N) l?.(U.key, U.value, U.prev), x(U.key);
        v();
      }
    } finally {
      j = !1;
    }
  }
  function R() {
    if (!($ > 0)) {
      if ((o && T.length > 0 && o([...T]), O.size > 0)) {
        j = !0;
        try {
          for (const b of O) x(b);
          v();
          let p = 0;
          while (A.length > 0) {
            if (++p > k)
              throw (
                ((A.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${k} iterations.`,
                ))
              );
            const b = [...A];
            A.length = 0;
            for (const w of b) l?.(w.key, w.value, w.prev), x(w.key);
            v();
          }
        } finally {
          j = !1;
        }
      }
      (T.length = 0), O.clear();
    }
  }
  const _ = {
    get(p) {
      return Pe(p), d.get(p);
    },
    has(p) {
      return Pe(p), d.has(p);
    },
    set(p, b) {
      m(p, b);
      const w = d.get(p);
      Object.is(w, b) ||
        (d.set(p, b),
        g.add(p),
        $ > 0
          ? (T.push({ key: p, value: b, prev: w, type: "set" }), O.add(p))
          : E(p, b, w));
    },
    delete(p) {
      const b = d.get(p);
      d.delete(p),
        g.delete(p),
        $ > 0
          ? (T.push({ key: p, value: void 0, prev: b, type: "delete" }),
            O.add(p))
          : E(p, void 0, b);
    },
    batch(p) {
      $++;
      try {
        p();
      } finally {
        $--, R();
      }
    },
    subscribe(p, b) {
      for (const w of p) {
        const I = w;
        f.has(I) || f.set(I, new Set()), f.get(I).add(b);
      }
      return () => {
        for (const w of p) {
          const I = f.get(w);
          I && (I.delete(b), I.size === 0 && f.delete(w));
        }
      };
    },
    subscribeAll(p) {
      return c.add(p), () => c.delete(p);
    },
    toObject() {
      const p = {};
      for (const b of g) d.has(b) && (p[b] = d.get(b));
      return p;
    },
  };
  return (
    (_.registerKeys = (p) => {
      for (const b of Object.keys(p)) ye.has(b) || ((t[b] = p[b]), g.add(b));
    }),
    _
  );
}
var ye = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Ct(e, t) {
  const l = () => ({
    get: (o) => Ue(() => e.get(o)),
    has: (o) => Ue(() => e.has(o)),
  });
  return new Proxy(
    {},
    {
      get(o, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return l;
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
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(o, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function kt(e) {
  const t = Et(e),
    l = Ct(t, e.schema);
  return { store: t, facts: l };
}
function ct(e, t) {
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
async function we(e, t, l) {
  let o,
    i = new Promise((s, u) => {
      o = setTimeout(() => u(new Error(l)), t);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(o);
  }
}
function ut(e, t = 50) {
  const l = new WeakSet();
  function o(i, s) {
    if (s > t) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const u = typeof i;
    if (u === "string") return JSON.stringify(i);
    if (u === "number" || u === "boolean") return String(i);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (l.has(i)) return '"[circular]"';
      l.add(i);
      const d = `[${i.map((g) => o(g, s + 1)).join(",")}]`;
      return l.delete(i), d;
    }
    if (u === "object") {
      const d = i;
      if (l.has(d)) return '"[circular]"';
      l.add(d);
      const g = `{${Object.keys(d)
        .sort()
        .map((f) => `${JSON.stringify(f)}:${o(d[f], s + 1)}`)
        .join(",")}}`;
      return l.delete(d), g;
    }
    return '"[unknown]"';
  }
  return o(e, 0);
}
function ve(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, u) {
    if (u > t) return !1;
    if (s == null || typeof s != "object") return !0;
    const d = s;
    if (o.has(d)) return !0;
    if ((o.add(d), Array.isArray(d))) {
      for (const g of d) if (!i(g, u + 1)) return o.delete(d), !1;
      return o.delete(d), !0;
    }
    for (const g of Object.keys(d))
      if (l.has(g) || !i(d[g], u + 1)) return o.delete(d), !1;
    return o.delete(d), !0;
  }
  return i(e, 0);
}
function Rt(e) {
  let t = ut(e),
    l = 5381;
  for (let o = 0; o < t.length; o++) l = ((l << 5) + l) ^ t.charCodeAt(o);
  return (l >>> 0).toString(16);
}
function Dt(e, t) {
  if (t) return t(e);
  const { type: l, ...o } = e,
    i = ut(o);
  return `${l}:${i}`;
}
function At(e, t, l) {
  return { requirement: e, id: Dt(e, l), fromConstraint: t };
}
var Be = class dt {
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
      const t = new dt();
      for (const l of this.map.values()) t.add(l);
      return t;
    }
    diff(t) {
      const l = [],
        o = [],
        i = [];
      for (const s of this.map.values()) t.has(s.id) ? i.push(s) : l.push(s);
      for (const s of t.map.values()) this.map.has(s.id) || o.push(s);
      return { added: l, removed: o, unchanged: i };
    }
  },
  Ot = 5e3;
function jt(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: o = {},
      defaultTimeout: i = Ot,
      onEvaluate: s,
      onError: u,
    } = e,
    d = new Map(),
    g = new Set(),
    f = new Set(),
    c = new Map(),
    $ = new Map(),
    T = new Set(),
    O = new Map(),
    j = new Map(),
    A = !1,
    k = new Set(),
    D = new Set(),
    F = new Map(),
    B = [],
    m = new Map();
  function x() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const a of n.after)
          t[a] && (F.has(a) || F.set(a, new Set()), F.get(a).add(r));
  }
  function v() {
    const r = new Set(),
      n = new Set(),
      a = [];
    function h(S, M) {
      if (r.has(S)) return;
      if (n.has(S)) {
        const W = M.indexOf(S),
          q = [...M.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${q}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), M.push(S);
      const L = t[S];
      if (L?.after) for (const W of L.after) t[W] && h(W, M);
      M.pop(), n.delete(S), r.add(S), a.push(S);
    }
    for (const S of Object.keys(t)) h(S, []);
    (B = a), (m = new Map(B.map((S, M) => [S, M])));
  }
  v(), x();
  function E(r, n) {
    return n.async !== void 0 ? n.async : !!f.has(r);
  }
  function R(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const a = E(r, n);
    a && f.add(r);
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
    return d.set(r, h), h;
  }
  function _(r) {
    return d.get(r) ?? R(r);
  }
  function p(r, n) {
    const a = c.get(r) ?? new Set();
    for (const h of a) {
      const S = $.get(h);
      S?.delete(r), S && S.size === 0 && $.delete(h);
    }
    for (const h of n) $.has(h) || $.set(h, new Set()), $.get(h).add(r);
    c.set(r, n);
  }
  function b(r) {
    const n = t[r];
    if (!n) return !1;
    const a = _(r);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let h;
      if (n.deps) (h = n.when(l)), O.set(r, new Set(n.deps));
      else {
        const S = $e(() => n.when(l));
        (h = S.value), O.set(r, S.deps);
      }
      return h instanceof Promise
        ? (f.add(r),
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
                u?.(r, S),
                !1
              ),
            ))
        : ((a.lastResult = h), (a.isEvaluating = !1), s?.(r, h), h);
    } catch (h) {
      return (
        (a.error = h instanceof Error ? h : new Error(String(h))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        u?.(r, h),
        !1
      );
    }
  }
  async function w(r) {
    const n = t[r];
    if (!n) return !1;
    const a = _(r),
      h = n.timeout ?? i;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      p(r, S), O.set(r, S);
    }
    try {
      const S = n.when(l),
        M = await we(S, h, `Constraint "${r}" timed out after ${h}ms`);
      return (a.lastResult = M), (a.isEvaluating = !1), s?.(r, M), M;
    } catch (S) {
      return (
        (a.error = S instanceof Error ? S : new Error(String(S))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        u?.(r, S),
        !1
      );
    }
  }
  function I(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((h) => h != null) : [r];
  }
  function N(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: h, deps: S } = $e(() => a(l));
      return { requirements: I(h), deps: S };
    }
    return { requirements: I(a), deps: new Set() };
  }
  function U(r, n) {
    if (n.size === 0) return;
    const a = c.get(r) ?? new Set();
    for (const h of n)
      a.add(h), $.has(h) || $.set(h, new Set()), $.get(h).add(r);
    c.set(r, a);
  }
  let z = null;
  function y() {
    return (
      z ||
        (z = Object.keys(t).sort((r, n) => {
          const a = _(r),
            h = _(n).priority - a.priority;
          if (h !== 0) return h;
          const S = m.get(r) ?? 0,
            M = m.get(n) ?? 0;
          return S - M;
        })),
      z
    );
  }
  for (const r of Object.keys(t)) R(r);
  function C(r) {
    const n = d.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (t[a] && !g.has(a) && !D.has(a) && !k.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new Be();
      D.clear();
      let a = y().filter((q) => !g.has(q)),
        h;
      if (!A || !r || r.size === 0) (h = a), (A = !0);
      else {
        const q = new Set();
        for (const V of r) {
          const Y = $.get(V);
          if (Y) for (const re of Y) g.has(re) || q.add(re);
        }
        for (const V of T) g.has(V) || q.add(V);
        T.clear(), (h = [...q]);
        for (const V of a)
          if (!q.has(V)) {
            const Y = j.get(V);
            if (Y) for (const re of Y) n.add(re);
          }
      }
      function S(q, V) {
        if (g.has(q)) return;
        const Y = O.get(q);
        if (!V) {
          Y !== void 0 && p(q, Y), D.add(q), j.set(q, []);
          return;
        }
        D.delete(q);
        let re, ee;
        try {
          const X = N(q);
          (re = X.requirements), (ee = X.deps);
        } catch (X) {
          u?.(q, X), Y !== void 0 && p(q, Y), j.set(q, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const K of ee) X.add(K);
          p(q, X);
        } else U(q, ee);
        if (re.length > 0) {
          const X = o[q],
            K = re.map((J) => At(J, q, X));
          for (const J of K) n.add(J);
          j.set(q, K);
        } else j.set(q, []);
      }
      async function M(q) {
        const V = [],
          Y = [];
        for (const K of q)
          if (C(K)) Y.push(K);
          else {
            V.push(K);
            const J = j.get(K);
            if (J) for (const G of J) n.add(G);
          }
        if (Y.length === 0) return V;
        const re = [],
          ee = [];
        for (const K of Y) _(K).isAsync ? ee.push(K) : re.push(K);
        const X = [];
        for (const K of re) {
          const J = b(K);
          if (J instanceof Promise) {
            X.push({ id: K, promise: J });
            continue;
          }
          S(K, J);
        }
        if (X.length > 0) {
          const K = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of K) S(J, G);
        }
        if (ee.length > 0) {
          const K = await Promise.all(
            ee.map(async (J) => ({ id: J, active: await w(J) })),
          );
          for (const { id: J, active: G } of K) S(J, G);
        }
        return V;
      }
      let L = h,
        W = h.length + 1;
      while (L.length > 0 && W > 0) {
        const q = L.length;
        if (((L = await M(L)), L.length === q)) break;
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
      g.add(r), (z = null), j.delete(r);
      const n = c.get(r);
      if (n) {
        for (const a of n) {
          const h = $.get(a);
          h && (h.delete(r), h.size === 0 && $.delete(a));
        }
        c.delete(r);
      }
      O.delete(r);
    },
    enable(r) {
      g.delete(r), (z = null), T.add(r);
    },
    invalidate(r) {
      const n = $.get(r);
      if (n) for (const a of n) T.add(a);
    },
    markResolved(r) {
      k.add(r);
      const n = d.get(r);
      n && (n.lastResolvedAt = Date.now());
      const a = F.get(r);
      if (a) for (const h of a) T.add(h);
    },
    isResolved(r) {
      return k.has(r);
    },
    registerDefinitions(r) {
      for (const [n, a] of Object.entries(r)) (t[n] = a), R(n), T.add(n);
      (z = null), v(), x();
    },
  };
}
function Mt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: o,
      onInvalidate: i,
      onError: s,
    } = e,
    u = new Map(),
    d = new Map(),
    g = new Map(),
    f = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    T = new Set(),
    O = !1,
    j = 100,
    A;
  function k(v) {
    if (!t[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const E = {
      id: v,
      compute: () => F(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(v, E), E;
  }
  function D(v) {
    return u.get(v) ?? k(v);
  }
  function F(v) {
    const E = D(v),
      R = t[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (E.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    E.isComputing = !0;
    try {
      const { value: _, deps: p } = $e(() => R(l, A));
      return (
        (E.cachedValue = _), (E.isStale = !1), B(v, p), o?.(v, _, [...p]), _
      );
    } catch (_) {
      throw (s?.(v, _), _);
    } finally {
      E.isComputing = !1;
    }
  }
  function B(v, E) {
    const R = D(v),
      _ = R.dependencies;
    for (const p of _)
      if (u.has(p)) {
        const b = f.get(p);
        b?.delete(v), b && b.size === 0 && f.delete(p);
      } else {
        const b = g.get(p);
        b?.delete(v), b && b.size === 0 && g.delete(p);
      }
    for (const p of E)
      t[p]
        ? (f.has(p) || f.set(p, new Set()), f.get(p).add(v))
        : (g.has(p) || g.set(p, new Set()), g.get(p).add(v));
    R.dependencies = E;
  }
  function m() {
    if (!($ > 0 || O)) {
      O = !0;
      try {
        let v = 0;
        while (T.size > 0) {
          if (++v > j) {
            const R = [...T];
            throw (
              (T.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${j} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const E = [...T];
          T.clear();
          for (const R of E) d.get(R)?.forEach((_) => _());
        }
      } finally {
        O = !1;
      }
    }
  }
  function x(v, E = new Set()) {
    if (E.has(v)) return;
    E.add(v);
    const R = u.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), i?.(v), T.add(v);
    const _ = f.get(v);
    if (_) for (const p of _) x(p, E);
  }
  return (
    (A = new Proxy(
      {},
      {
        get(v, E) {
          if (typeof E == "symbol" || c.has(E)) return;
          Pe(E);
          const R = D(E);
          return R.isStale && F(E), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const E = D(v);
        return E.isStale && F(v), E.cachedValue;
      },
      isStale(v) {
        return u.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const E = g.get(v);
        if (E) {
          $++;
          try {
            for (const R of E) x(R);
          } finally {
            $--, m();
          }
        }
      },
      invalidateMany(v) {
        $++;
        try {
          for (const E of v) {
            const R = g.get(E);
            if (R) for (const _ of R) x(_);
          }
        } finally {
          $--, m();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), T.add(v.id));
        } finally {
          $--, m();
        }
      },
      subscribe(v, E) {
        for (const R of v) {
          const _ = R;
          d.has(_) || d.set(_, new Set()), d.get(_).add(E);
        }
        return () => {
          for (const R of v) {
            const _ = R,
              p = d.get(_);
            p?.delete(E), p && p.size === 0 && d.delete(_);
          }
        };
      },
      getProxy() {
        return A;
      },
      getDependencies(v) {
        return D(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [E, R] of Object.entries(v)) (t[E] = R), k(E);
      },
    }
  );
}
function It(e) {
  let { definitions: t, facts: l, store: o, onRun: i, onError: s } = e,
    u = new Map(),
    d = null,
    g = !1;
  function f(k) {
    const D = t[k];
    if (!D) throw new Error(`[Directive] Unknown effect: ${k}`);
    const F = {
      id: k,
      enabled: !0,
      hasExplicitDeps: !!D.deps,
      dependencies: D.deps ? new Set(D.deps) : null,
      cleanup: null,
    };
    return u.set(k, F), F;
  }
  function c(k) {
    return u.get(k) ?? f(k);
  }
  function $() {
    return o.toObject();
  }
  function T(k, D) {
    const F = c(k);
    if (!F.enabled) return !1;
    if (F.dependencies) {
      for (const B of F.dependencies) if (D.has(B)) return !0;
      return !1;
    }
    return !0;
  }
  function O(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (D) {
        s?.(k.id, D),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            D,
          );
      }
      k.cleanup = null;
    }
  }
  function j(k, D) {
    if (typeof D == "function")
      if (g)
        try {
          D();
        } catch (F) {
          s?.(k.id, F),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              F,
            );
        }
      else k.cleanup = D;
  }
  async function A(k) {
    const D = c(k),
      F = t[k];
    if (!(!D.enabled || !F)) {
      O(D), i?.(k);
      try {
        if (D.hasExplicitDeps) {
          let B;
          if (
            (o.batch(() => {
              B = F.run(l, d);
            }),
            B instanceof Promise)
          ) {
            const m = await B;
            j(D, m);
          } else j(D, B);
        } else {
          let B = null,
            m,
            x = $e(
              () => (
                o.batch(() => {
                  m = F.run(l, d);
                }),
                m
              ),
            );
          B = x.deps;
          let v = x.value;
          v instanceof Promise && (v = await v),
            j(D, v),
            (D.dependencies = B.size > 0 ? B : null);
        }
      } catch (B) {
        s?.(k, B),
          console.error(`[Directive] Effect "${k}" threw an error:`, B);
      }
    }
  }
  for (const k of Object.keys(t)) f(k);
  return {
    async runEffects(k) {
      const D = [];
      for (const F of Object.keys(t)) T(F, k) && D.push(F);
      await Promise.all(D.map(A)), (d = $());
    },
    async runAll() {
      const k = Object.keys(t);
      await Promise.all(
        k.map((D) => (c(D).enabled ? A(D) : Promise.resolve())),
      ),
        (d = $());
    },
    disable(k) {
      const D = c(k);
      D.enabled = !1;
    },
    enable(k) {
      const D = c(k);
      D.enabled = !0;
    },
    isEnabled(k) {
      return c(k).enabled;
    },
    cleanupAll() {
      g = !0;
      for (const k of u.values()) O(k);
    },
    registerDefinitions(k) {
      for (const [D, F] of Object.entries(k)) (t[D] = F), f(D);
    },
  };
}
function Pt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: o = 2,
      maxDelayMs: i = 3e4,
    } = e,
    s = new Map();
  function u(d) {
    const g = t * Math.pow(o, d - 1);
    return Math.min(g, i);
  }
  return {
    scheduleRetry(d, g, f, c, $) {
      if (c > l) return null;
      const T = u(c),
        O = {
          source: d,
          sourceId: g,
          context: f,
          attempt: c,
          nextRetryTime: Date.now() + T,
          callback: $,
        };
      return s.set(g, O), O;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const d = Date.now(),
        g = [];
      for (const [f, c] of s) c.nextRetryTime <= d && (g.push(c), s.delete(f));
      return g;
    },
    cancelRetry(d) {
      s.delete(d);
    },
    clearAll() {
      s.clear();
    },
  };
}
var Bt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function qt(e = {}) {
  const { config: t = {}, onError: l, onRecovery: o } = e,
    i = [],
    s = 100,
    u = Pt(t.retryLater),
    d = new Map();
  function g(c, $, T, O) {
    if (T instanceof We) return T;
    const j = T instanceof Error ? T.message : String(T),
      A = c !== "system";
    return new We(j, c, $, O, A);
  }
  function f(c, $, T) {
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
        O(T, $);
      } catch (j) {
        console.error("[Directive] Error in error handler callback:", j);
      }
      return "skip";
    }
    return typeof O == "string" ? O : Bt[c];
  }
  return {
    handleError(c, $, T, O) {
      const j = g(c, $, T, O);
      i.push(j), i.length > s && i.shift();
      try {
        l?.(j);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        t.onError?.(j);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let A = f(c, $, T instanceof Error ? T : new Error(String(T)));
      if (A === "retry-later") {
        const k = (d.get($) ?? 0) + 1;
        d.set($, k),
          u.scheduleRetry(c, $, O, k) ||
            ((A = "skip"), d.delete($), typeof process < "u");
      }
      try {
        o?.(j, A);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (A === "throw") throw j;
      return A;
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
function Tt() {
  const e = [];
  function t(o) {
    if (o)
      try {
        return o();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  async function l(o) {
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
      for (const i of e) await l(() => i.onInit?.(o));
    },
    emitStart(o) {
      for (const i of e) t(() => i.onStart?.(o));
    },
    emitStop(o) {
      for (const i of e) t(() => i.onStop?.(o));
    },
    emitDestroy(o) {
      for (const i of e) t(() => i.onDestroy?.(o));
    },
    emitFactSet(o, i, s) {
      for (const u of e) t(() => u.onFactSet?.(o, i, s));
    },
    emitFactDelete(o, i) {
      for (const s of e) t(() => s.onFactDelete?.(o, i));
    },
    emitFactsBatch(o) {
      for (const i of e) t(() => i.onFactsBatch?.(o));
    },
    emitDerivationCompute(o, i, s) {
      for (const u of e) t(() => u.onDerivationCompute?.(o, i, s));
    },
    emitDerivationInvalidate(o) {
      for (const i of e) t(() => i.onDerivationInvalidate?.(o));
    },
    emitReconcileStart(o) {
      for (const i of e) t(() => i.onReconcileStart?.(o));
    },
    emitReconcileEnd(o) {
      for (const i of e) t(() => i.onReconcileEnd?.(o));
    },
    emitConstraintEvaluate(o, i) {
      for (const s of e) t(() => s.onConstraintEvaluate?.(o, i));
    },
    emitConstraintError(o, i) {
      for (const s of e) t(() => s.onConstraintError?.(o, i));
    },
    emitRequirementCreated(o) {
      for (const i of e) t(() => i.onRequirementCreated?.(o));
    },
    emitRequirementMet(o, i) {
      for (const s of e) t(() => s.onRequirementMet?.(o, i));
    },
    emitRequirementCanceled(o) {
      for (const i of e) t(() => i.onRequirementCanceled?.(o));
    },
    emitResolverStart(o, i) {
      for (const s of e) t(() => s.onResolverStart?.(o, i));
    },
    emitResolverComplete(o, i, s) {
      for (const u of e) t(() => u.onResolverComplete?.(o, i, s));
    },
    emitResolverError(o, i, s) {
      for (const u of e) t(() => u.onResolverError?.(o, i, s));
    },
    emitResolverRetry(o, i, s) {
      for (const u of e) t(() => u.onResolverRetry?.(o, i, s));
    },
    emitResolverCancel(o, i) {
      for (const s of e) t(() => s.onResolverCancel?.(o, i));
    },
    emitEffectRun(o) {
      for (const i of e) t(() => i.onEffectRun?.(o));
    },
    emitEffectError(o, i) {
      for (const s of e) t(() => s.onEffectError?.(o, i));
    },
    emitSnapshot(o) {
      for (const i of e) t(() => i.onSnapshot?.(o));
    },
    emitTimeTravel(o, i) {
      for (const s of e) t(() => s.onTimeTravel?.(o, i));
    },
    emitError(o) {
      for (const i of e) t(() => i.onError?.(o));
    },
    emitErrorRecovery(o, i) {
      for (const s of e) t(() => s.onErrorRecovery?.(o, i));
    },
  };
}
var He = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ke = { enabled: !1, windowMs: 50 };
function Ve(e, t) {
  let { backoff: l, initialDelay: o = 100, maxDelay: i = 3e4 } = e,
    s;
  switch (l) {
    case "none":
      s = o;
      break;
    case "linear":
      s = o * t;
      break;
    case "exponential":
      s = o * Math.pow(2, t - 1);
      break;
    default:
      s = o;
  }
  return Math.max(1, Math.min(s, i));
}
function _t(e) {
  const {
      definitions: t,
      facts: l,
      store: o,
      onStart: i,
      onComplete: s,
      onError: u,
      onRetry: d,
      onCancel: g,
      onResolutionComplete: f,
    } = e,
    c = new Map(),
    $ = new Map(),
    T = 1e3,
    O = new Map(),
    j = new Map(),
    A = 1e3;
  function k() {
    if ($.size > T) {
      const p = $.size - T,
        b = $.keys();
      for (let w = 0; w < p; w++) {
        const I = b.next().value;
        I && $.delete(I);
      }
    }
  }
  function D(p) {
    return (
      typeof p == "object" &&
      p !== null &&
      "requirement" in p &&
      typeof p.requirement == "string"
    );
  }
  function F(p) {
    return (
      typeof p == "object" &&
      p !== null &&
      "requirement" in p &&
      typeof p.requirement == "function"
    );
  }
  function B(p, b) {
    return D(p) ? b.type === p.requirement : F(p) ? p.requirement(b) : !1;
  }
  function m(p) {
    const b = p.type,
      w = j.get(b);
    if (w)
      for (const I of w) {
        const N = t[I];
        if (N && B(N, p)) return I;
      }
    for (const [I, N] of Object.entries(t))
      if (B(N, p)) {
        if (!j.has(b)) {
          if (j.size >= A) {
            const z = j.keys().next().value;
            z !== void 0 && j.delete(z);
          }
          j.set(b, []);
        }
        const U = j.get(b);
        return U.includes(I) || U.push(I), I;
      }
    return null;
  }
  function x(p) {
    return { facts: l, signal: p, snapshot: () => l.$snapshot() };
  }
  async function v(p, b, w) {
    const I = t[p];
    if (!I) return;
    let N = { ...He, ...I.retry },
      U = null;
    for (let z = 1; z <= N.attempts; z++) {
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
          const a = I.timeout;
          a && a > 0
            ? await we(n, a, `Resolver "${p}" timed out after ${a}ms`)
            : await n;
        }
        const r = Date.now() - (y?.startedAt ?? Date.now());
        $.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: r,
        }),
          k(),
          s?.(p, b, r);
        return;
      } catch (C) {
        if (
          ((U = C instanceof Error ? C : new Error(String(C))),
          w.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(U, z)) break;
        if (z < N.attempts) {
          if (w.signal.aborted) return;
          const r = Ve(N, z);
          if (
            (d?.(p, b, z + 1),
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
    $.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: U,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      k(),
      u?.(p, b, U);
  }
  async function E(p, b) {
    const w = t[p];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((r) => {
          const n = new AbortController();
          return v(p, r, n);
        }),
      );
      return;
    }
    let I = { ...He, ...w.retry },
      N = { ...Ke, ...w.batch },
      U = new AbortController(),
      z = Date.now(),
      y = null,
      C = N.timeoutMs ?? w.timeout;
    for (let r = 1; r <= I.attempts; r++) {
      if (U.signal.aborted) return;
      try {
        const n = x(U.signal),
          a = b.map((h) => h.requirement);
        if (w.resolveBatchWithResults) {
          let h, S;
          if (
            (o.batch(() => {
              S = w.resolveBatchWithResults(a, n);
            }),
            C && C > 0
              ? (h = await we(
                  S,
                  C,
                  `Batch resolver "${p}" timed out after ${C}ms`,
                ))
              : (h = await S),
            h.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${p}" returned ${h.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let M = Date.now() - z,
            L = !1;
          for (let W = 0; W < b.length; W++) {
            const q = b[W],
              V = h[W];
            if (V.success)
              $.set(q.id, {
                state: "success",
                requirementId: q.id,
                completedAt: Date.now(),
                duration: M,
              }),
                s?.(p, q, M);
            else {
              L = !0;
              const Y = V.error ?? new Error("Batch item failed");
              $.set(q.id, {
                state: "error",
                requirementId: q.id,
                error: Y,
                failedAt: Date.now(),
                attempts: r,
              }),
                u?.(p, q, Y);
            }
          }
          if (!L || b.some((W, q) => h[q]?.success)) return;
        } else {
          let h;
          o.batch(() => {
            h = w.resolveBatch(a, n);
          }),
            C && C > 0
              ? await we(h, C, `Batch resolver "${p}" timed out after ${C}ms`)
              : await h;
          const S = Date.now() - z;
          for (const M of b)
            $.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: S,
            }),
              s?.(p, M, S);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          U.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, r)) break;
        if (r < I.attempts) {
          const a = Ve(I, r);
          for (const h of b) d?.(p, h, r + 1);
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
      $.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: y,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        u?.(p, r, y);
    k();
  }
  function R(p, b) {
    const w = t[p];
    if (!w) return;
    const I = { ...Ke, ...w.batch };
    O.has(p) || O.set(p, { resolverId: p, requirements: [], timer: null });
    const N = O.get(p);
    N.requirements.push(b),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        _(p);
      }, I.windowMs));
  }
  function _(p) {
    const b = O.get(p);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      E(p, w).then(() => {
        f?.();
      });
  }
  return {
    resolve(p) {
      if (c.has(p.id)) return;
      const b = m(p.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${p.id}`);
        return;
      }
      const w = t[b];
      if (!w) return;
      if (w.batch?.enabled) {
        R(b, p);
        return;
      }
      const I = new AbortController(),
        N = Date.now(),
        U = {
          requirementId: p.id,
          resolverId: b,
          controller: I,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: p.id, startedAt: N },
          originalRequirement: p,
        };
      c.set(p.id, U),
        i?.(b, p),
        v(b, p, I).finally(() => {
          c.delete(p.id) && f?.();
        });
    },
    cancel(p) {
      const b = c.get(p);
      b &&
        (b.controller.abort(),
        c.delete(p),
        $.set(p, {
          state: "canceled",
          requirementId: p,
          canceledAt: Date.now(),
        }),
        k(),
        g?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [p] of c) this.cancel(p);
      for (const p of O.values()) p.timer && clearTimeout(p.timer);
      O.clear();
    },
    getStatus(p) {
      const b = c.get(p);
      return b ? b.status : $.get(p) || { state: "idle" };
    },
    getInflight() {
      return [...c.keys()];
    },
    getInflightInfo() {
      return [...c.values()].map((p) => ({
        id: p.requirementId,
        resolverId: p.resolverId,
        startedAt: p.startedAt,
      }));
    },
    isResolving(p) {
      return c.has(p);
    },
    processBatches() {
      for (const p of O.keys()) _(p);
    },
    registerDefinitions(p) {
      for (const [b, w] of Object.entries(p)) t[b] = w;
      j.clear();
    },
  };
}
function zt(e) {
  let { config: t, facts: l, store: o, onSnapshot: i, onTimeTravel: s } = e,
    u = t.timeTravel ?? !1,
    d = t.maxSnapshots ?? 100,
    g = [],
    f = -1,
    c = 1,
    $ = !1,
    T = !1,
    O = [],
    j = null,
    A = -1;
  function k() {
    return o.toObject();
  }
  function D() {
    const B = k();
    return structuredClone(B);
  }
  function F(B) {
    if (!ve(B)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    o.batch(() => {
      for (const [m, x] of Object.entries(B)) {
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
      return u;
    },
    get isRestoring() {
      return T;
    },
    get isPaused() {
      return $;
    },
    get snapshots() {
      return [...g];
    },
    get currentIndex() {
      return f;
    },
    takeSnapshot(B) {
      if (!u || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: B };
      const m = { id: c++, timestamp: Date.now(), facts: D(), trigger: B };
      for (
        f < g.length - 1 && g.splice(f + 1), g.push(m), f = g.length - 1;
        g.length > d;
      )
        g.shift(), f--;
      return i?.(m), m;
    },
    restore(B) {
      if (u) {
        ($ = !0), (T = !0);
        try {
          F(B.facts);
        } finally {
          ($ = !1), (T = !1);
        }
      }
    },
    goBack(B = 1) {
      if (!u || g.length === 0) return;
      let m = f,
        x = f,
        v = O.find((R) => f > R.startIndex && f <= R.endIndex);
      if (v) x = v.startIndex;
      else if (O.find((R) => f === R.startIndex)) {
        const R = O.find((_) => _.endIndex < f && f - _.endIndex <= B);
        x = R ? R.startIndex : Math.max(0, f - B);
      } else x = Math.max(0, f - B);
      if (m === x) return;
      f = x;
      const E = g[f];
      E && (this.restore(E), s?.(m, x));
    },
    goForward(B = 1) {
      if (!u || g.length === 0) return;
      let m = f,
        x = f,
        v = O.find((R) => f >= R.startIndex && f < R.endIndex);
      if ((v ? (x = v.endIndex) : (x = Math.min(g.length - 1, f + B)), m === x))
        return;
      f = x;
      const E = g[f];
      E && (this.restore(E), s?.(m, x));
    },
    goTo(B) {
      if (!u) return;
      const m = g.findIndex((E) => E.id === B);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${B} not found`);
        return;
      }
      const x = f;
      f = m;
      const v = g[f];
      v && (this.restore(v), s?.(x, m));
    },
    replay() {
      if (!u || g.length === 0) return;
      f = 0;
      const B = g[0];
      B && this.restore(B);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: g, currentIndex: f });
    },
    import(B) {
      if (u)
        try {
          const m = JSON.parse(B);
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
            if (!ve(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (g.length = 0), g.push(...m.snapshots), (f = m.currentIndex);
          const x = g[f];
          x && this.restore(x);
        } catch (m) {
          console.error("[Directive] Failed to import time-travel data:", m);
        }
    },
    beginChangeset(B) {
      u && ((j = B), (A = f));
    },
    endChangeset() {
      !u ||
        j === null ||
        (f > A && O.push({ label: j, startIndex: A, endIndex: f }),
        (j = null),
        (A = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function Lt() {
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
function ft(e) {
  const t = Object.create(null),
    l = Object.create(null),
    o = Object.create(null),
    i = Object.create(null),
    s = Object.create(null),
    u = Object.create(null);
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
      r.derive && Object.assign(o, r.derive),
      r.effects && Object.assign(i, r.effects),
      r.constraints && Object.assign(s, r.constraints),
      r.resolvers && Object.assign(u, r.resolvers);
  }
  let d = null;
  if (e.modules.some((r) => r.snapshotEvents)) {
    d = new Set();
    for (const r of e.modules) {
      const n = r;
      if (n.snapshotEvents) for (const a of n.snapshotEvents) d.add(a);
      else if (n.events) for (const a of Object.keys(n.events)) d.add(a);
    }
  }
  let g = 0,
    f = !1,
    c = Tt();
  for (const r of e.plugins ?? []) c.register(r);
  let $ = qt({
      config: e.errorBoundary,
      onError: (r) => c.emitError(r),
      onRecovery: (r, n) => c.emitErrorRecovery(r, n),
    }),
    T = () => {},
    O = () => {},
    j = null,
    { store: A, facts: k } = kt({
      schema: t,
      onChange: (r, n, a) => {
        c.emitFactSet(r, n, a),
          T(r),
          !j?.isRestoring && (g === 0 && (f = !0), w.changedKeys.add(r), I());
      },
      onBatch: (r) => {
        c.emitFactsBatch(r);
        const n = [];
        for (const a of r) n.push(a.key);
        if ((O(n), !j?.isRestoring)) {
          g === 0 && (f = !0);
          for (const a of r) w.changedKeys.add(a.key);
          I();
        }
      },
    }),
    D = Mt({
      definitions: o,
      facts: k,
      onCompute: (r, n, a) => c.emitDerivationCompute(r, n, a),
      onInvalidate: (r) => c.emitDerivationInvalidate(r),
      onError: (r, n) => {
        $.handleError("derivation", r, n);
      },
    });
  (T = (r) => D.invalidate(r)), (O = (r) => D.invalidateMany(r));
  const F = It({
      definitions: i,
      facts: k,
      store: A,
      onRun: (r) => c.emitEffectRun(r),
      onError: (r, n) => {
        $.handleError("effect", r, n), c.emitEffectError(r, n);
      },
    }),
    B = jt({
      definitions: s,
      facts: k,
      onEvaluate: (r, n) => c.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        $.handleError("constraint", r, n), c.emitConstraintError(r, n);
      },
    }),
    m = _t({
      definitions: u,
      facts: k,
      store: A,
      onStart: (r, n) => c.emitResolverStart(r, n),
      onComplete: (r, n, a) => {
        c.emitResolverComplete(r, n, a),
          c.emitRequirementMet(n, r),
          B.markResolved(n.fromConstraint);
      },
      onError: (r, n, a) => {
        $.handleError("resolver", r, a, n), c.emitResolverError(r, n, a);
      },
      onRetry: (r, n, a) => c.emitResolverRetry(r, n, a),
      onCancel: (r, n) => {
        c.emitResolverCancel(r, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        _(), I();
      },
    }),
    x = new Set();
  function v() {
    for (const r of x) r();
  }
  const E = e.debug?.timeTravel
    ? zt({
        config: e.debug,
        facts: k,
        store: A,
        onSnapshot: (r) => {
          c.emitSnapshot(r), v();
        },
        onTimeTravel: (r, n) => {
          c.emitTimeTravel(r, n), v();
        },
      })
    : Lt();
  j = E;
  const R = new Set();
  function _() {
    for (const r of R) r();
  }
  let p = 50,
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
  function I() {
    !w.isRunning ||
      w.reconcileScheduled ||
      w.isInitializing ||
      ((w.reconcileScheduled = !0),
      _(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && N().catch((r) => {});
      }));
  }
  async function N() {
    if (!w.isReconciling) {
      if ((b++, b > p)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), _();
      try {
        w.changedKeys.size > 0 &&
          ((d === null || f) &&
            E.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (f = !1));
        const r = k.$snapshot();
        c.emitReconcileStart(r), await F.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const a = await B.evaluate(n),
          h = new Be();
        for (const q of a) h.add(q), c.emitRequirementCreated(q);
        const { added: S, removed: M } = h.diff(w.previousRequirements);
        for (const q of M) m.cancel(q.id);
        for (const q of S) m.resolve(q);
        w.previousRequirements = h;
        const L = m.getInflightInfo(),
          W = {
            unmet: a.filter((q) => !m.isResolving(q.id)),
            inflight: L,
            completed: [],
            canceled: M.map((q) => ({
              id: q.id,
              resolverId: L.find((V) => V.id === q.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(W),
          w.isReady ||
            ((w.isReady = !0),
            w.readyResolve && (w.readyResolve(), (w.readyResolve = null)));
      } finally {
        (w.isReconciling = !1),
          w.changedKeys.size > 0 ? I() : w.reconcileScheduled || (b = 0),
          _();
      }
    }
  }
  const U = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ae.has(n)) return D.get(n);
        },
        has(r, n) {
          return typeof n == "symbol" || ae.has(n) ? !1 : n in o;
        },
        ownKeys() {
          return Object.keys(o);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ae.has(n) && n in o)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    z = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ae.has(n))
            return (a) => {
              const h = l[n];
              if (h) {
                g++, (d === null || d.has(n)) && (f = !0);
                try {
                  A.batch(() => {
                    h(k, { type: n, ...a });
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
      facts: k,
      debug: E.isEnabled ? E : null,
      derive: U,
      events: z,
      constraints: { disable: (r) => B.disable(r), enable: (r) => B.enable(r) },
      effects: {
        disable: (r) => F.disable(r),
        enable: (r) => F.enable(r),
        isEnabled: (r) => F.isEnabled(r),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              A.batch(() => {
                r.init(k);
              });
          e.onAfterModuleInit &&
            A.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const r of Object.keys(o)) D.get(r);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const r of e.modules) r.hooks?.onStart?.(y);
          c.emitStart(y), I();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), m.cancelAll(), F.cleanupAll();
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
          g++, (d === null || d.has(r.type)) && (f = !0);
          try {
            A.batch(() => {
              n(k, r);
            });
          } finally {
            g--;
          }
        }
      },
      read(r) {
        return D.get(r);
      },
      subscribe(r, n) {
        const a = [],
          h = [];
        for (const M of r) M in o ? a.push(M) : M in t && h.push(M);
        const S = [];
        return (
          a.length > 0 && S.push(D.subscribe(a, n)),
          h.length > 0 && S.push(A.subscribe(h, n)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(r, n, a) {
        const h = a?.equalityFn
          ? (M, L) => a.equalityFn(M, L)
          : (M, L) => Object.is(M, L);
        if (r in o) {
          let M = D.get(r);
          return D.subscribe([r], () => {
            const L = D.get(r);
            if (!h(L, M)) {
              const W = M;
              (M = L), n(L, W);
            }
          });
        }
        let S = A.get(r);
        return A.subscribe([r], () => {
          const M = A.get(r);
          if (!h(M, S)) {
            const L = S;
            (S = M), n(M, L);
          }
        });
      },
      when(r, n) {
        return new Promise((a, h) => {
          const S = A.toObject();
          if (r(S)) {
            a();
            return;
          }
          let M,
            L,
            W = () => {
              M?.(), L !== void 0 && clearTimeout(L);
            };
          (M = A.subscribeAll(() => {
            const q = A.toObject();
            r(q) && (W(), a());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (L = setTimeout(() => {
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
          constraints: B.getAllStates().map((r) => ({
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
        const a = B.getState(n.fromConstraint),
          h = m.getStatus(r),
          S = {},
          M = A.toObject();
        for (const [V, Y] of Object.entries(M)) S[V] = Y;
        const L = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${h.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([V]) => V !== "type")
            .map(([V, Y]) => `${V}=${JSON.stringify(Y)}`)
            .join(", ");
        W && L.push(`├─ Requirement payload: { ${W} }`);
        const q = Object.entries(S).slice(0, 10);
        return (
          q.length > 0 &&
            (L.push("└─ Relevant facts:"),
            q.forEach(([V, Y], re) => {
              const ee = re === q.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              L.push(
                `${ee} ${V} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          L.join(`
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
        return { facts: A.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: a,
            includeFacts: h,
            ttlSeconds: S,
            metadata: M,
            includeVersion: L,
          } = r,
          W = {},
          q = Object.keys(o),
          V;
        if ((n ? (V = n.filter((ee) => q.includes(ee))) : (V = q), a)) {
          const ee = new Set(a);
          V = V.filter((X) => !ee.has(X));
        }
        for (const ee of V)
          try {
            W[ee] = D.get(ee);
          } catch {}
        if (h && h.length > 0) {
          const ee = A.toObject();
          for (const X of h) X in ee && (W[X] = ee[X]);
        }
        const Y = Date.now(),
          re = { data: W, createdAt: Y };
        return (
          S !== void 0 && S > 0 && (re.expiresAt = Y + S * 1e3),
          L && (re.version = Rt(W)),
          M && (re.metadata = M),
          re
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: a, excludeDerivations: h } = r,
          S = Object.keys(o),
          M;
        if ((a ? (M = a.filter((W) => S.includes(W))) : (M = S), h)) {
          const W = new Set(h);
          M = M.filter((q) => !W.has(q));
        }
        if (M.length === 0) return () => {};
        let L = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return D.subscribe(M, () => {
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
        if (!ve(r))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        A.batch(() => {
          for (const [n, a] of Object.entries(r.facts))
            ae.has(n) || A.set(n, a);
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
        A.batch(r);
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
      d === null && (d = new Set(Object.keys(l)));
      for (const a of r.snapshotEvents) d.add(a);
    } else if (d !== null && r.events)
      for (const a of Object.keys(r.events)) d.add(a);
    Object.assign(t, r.schema),
      r.events && Object.assign(l, r.events),
      r.derive && (Object.assign(o, r.derive), D.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(i, r.effects), F.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(s, r.constraints), B.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(u, r.resolvers), m.registerDefinitions(r.resolvers)),
      A.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        A.batch(() => {
          r.init(k);
        }),
      r.hooks?.onInit?.(y),
      w.isRunning && (r.hooks?.onStart?.(y), I());
  }
  (y.registerModule = C), c.emitInit(y);
  for (const r of e.modules) r.hooks?.onInit?.(y);
  return y;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Ft(e) {
  const t = Object.keys(e),
    l = new Set(),
    o = new Set(),
    i = [],
    s = [];
  function u(d) {
    if (l.has(d)) return;
    if (o.has(d)) {
      const f = s.indexOf(d),
        c = [...s.slice(f), d].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    o.add(d), s.push(d);
    const g = e[d];
    if (g?.crossModuleDeps)
      for (const f of Object.keys(g.crossModuleDeps)) t.includes(f) && u(f);
    s.pop(), o.delete(d), l.add(d), i.push(d);
  }
  for (const d of t) u(d);
  return i;
}
var Je = new WeakMap(),
  Ye = new WeakMap(),
  Ge = new WeakMap(),
  Xe = new WeakMap();
function Nt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Kt(e);
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
  return Wt(t);
}
function Wt(e) {
  const t = e.modules,
    l = new Set(Object.keys(t)),
    o = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const m = s,
      x = Object.keys(t).filter((v) => !m.includes(v));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = m;
  } else s === "declaration" ? (i = Object.keys(t)) : (i = Ft(t));
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
  for (const m of i) {
    const x = t[m];
    if (!x) continue;
    const v = x.crossModuleDeps && Object.keys(x.crossModuleDeps).length > 0,
      E = v ? Object.keys(x.crossModuleDeps) : [],
      R = {};
    for (const [y, C] of Object.entries(x.schema.facts)) R[`${m}${H}${y}`] = C;
    const _ = {};
    if (x.schema.derivations)
      for (const [y, C] of Object.entries(x.schema.derivations))
        _[`${m}${H}${y}`] = C;
    const p = {};
    if (x.schema.events)
      for (const [y, C] of Object.entries(x.schema.events))
        p[`${m}${H}${y}`] = C;
    const b = x.init
        ? (y) => {
            const C = ie(y, m);
            x.init(C);
          }
        : void 0,
      w = {};
    if (x.derive)
      for (const [y, C] of Object.entries(x.derive))
        w[`${m}${H}${y}`] = (r, n) => {
          const a = v ? le(r, m, E) : ie(r, m),
            h = qe(n, m);
          return C(a, h);
        };
    const I = {};
    if (x.events)
      for (const [y, C] of Object.entries(x.events))
        I[`${m}${H}${y}`] = (r, n) => {
          const a = ie(r, m);
          C(a, n);
        };
    const N = {};
    if (x.constraints)
      for (const [y, C] of Object.entries(x.constraints)) {
        const r = C;
        N[`${m}${H}${y}`] = {
          ...r,
          deps: r.deps?.map((n) => `${m}${H}${n}`),
          when: (n) => {
            const a = v ? le(n, m, E) : ie(n, m);
            return r.when(a);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const a = v ? le(n, m, E) : ie(n, m);
                  return r.require(a);
                }
              : r.require,
        };
      }
    const U = {};
    if (x.resolvers)
      for (const [y, C] of Object.entries(x.resolvers)) {
        const r = C;
        U[`${m}${H}${y}`] = {
          ...r,
          resolve: async (n, a) => {
            const h = De(a.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: h[m], signal: a.signal });
          },
        };
      }
    const z = {};
    if (x.effects)
      for (const [y, C] of Object.entries(x.effects)) {
        const r = C;
        z[`${m}${H}${y}`] = {
          ...r,
          run: (n, a) => {
            const h = v ? le(n, m, E) : ie(n, m),
              S = a ? (v ? le(a, m, E) : ie(a, m)) : void 0;
            return r.run(h, S);
          },
          deps: r.deps?.map((n) => `${m}${H}${n}`),
        };
      }
    g.push({
      id: x.id,
      schema: {
        facts: R,
        derivations: _,
        events: p,
        requirements: x.schema.requirements ?? {},
      },
      init: b,
      derive: w,
      events: I,
      effects: z,
      constraints: N,
      resolvers: U,
      hooks: x.hooks,
      snapshotEvents:
        o && !o.has(m) ? [] : x.snapshotEvents?.map((y) => `${m}${H}${y}`),
    });
  }
  let f = null,
    c = null;
  function $(m) {
    for (const [x, v] of Object.entries(m))
      if (!ne.has(x) && l.has(x)) {
        if (v && typeof v == "object" && !ve(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [E, R] of Object.entries(v))
          ne.has(E) || (c.facts[`${x}${H}${E}`] = R);
      }
  }
  c = ft({
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
    debug: u,
    errorBoundary: d,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), f && ($(f), (f = null));
    },
  });
  const T = new Map();
  for (const m of Object.keys(t)) {
    const x = t[m];
    if (!x) continue;
    const v = [];
    for (const E of Object.keys(x.schema.facts)) v.push(`${m}${H}${E}`);
    if (x.schema.derivations)
      for (const E of Object.keys(x.schema.derivations)) v.push(`${m}${H}${E}`);
    T.set(m, v);
  }
  const O = { names: null };
  function j() {
    return O.names === null && (O.names = Object.keys(t)), O.names;
  }
  let A = De(c.facts, t, j),
    k = Ut(c.derive, t, j),
    D = Ht(c, t, j),
    F = null,
    B = e.tickMs;
  return {
    _mode: "namespaced",
    facts: A,
    debug: c.debug,
    derive: k,
    events: D,
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
      x && typeof x == "object" && (f = x);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), B && B > 0)) {
        const m = Object.keys(g[0]?.events ?? {}).find((x) =>
          x.endsWith(`${H}tick`),
        );
        m &&
          (F = setInterval(() => {
            c.dispatch({ type: m });
          }, B));
      }
    },
    stop() {
      F && (clearInterval(F), (F = null)), c.stop();
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
    subscribe(m, x) {
      const v = [];
      for (const E of m)
        if (E.endsWith(".*")) {
          const R = E.slice(0, -2),
            _ = T.get(R);
          _ && v.push(..._);
        } else v.push(ce(E));
      return c.subscribe(v, x);
    },
    subscribeModule(m, x) {
      const v = T.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, x);
    },
    watch(m, x, v) {
      return c.watch(ce(m), x, v);
    },
    when(m, x) {
      return c.when(() => m(A), x);
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
          includeDerivations: m?.includeDerivations?.map(ce),
          excludeDerivations: m?.excludeDerivations?.map(ce),
          includeFacts: m?.includeFacts?.map(ce),
        },
        v = c.getDistributableSnapshot(x),
        E = {};
      for (const [R, _] of Object.entries(v.data)) {
        const p = R.indexOf(H);
        if (p > 0) {
          const b = R.slice(0, p),
            w = R.slice(p + H.length);
          E[b] || (E[b] = {}), (E[b][w] = _);
        } else E._root || (E._root = {}), (E._root[R] = _);
      }
      return { ...v, data: E };
    },
    watchDistributableSnapshot(m, x) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(ce),
        excludeDerivations: m?.excludeDerivations?.map(ce),
        includeFacts: m?.includeFacts?.map(ce),
      };
      return c.watchDistributableSnapshot(v, (E) => {
        const R = {};
        for (const [_, p] of Object.entries(E.data)) {
          const b = _.indexOf(H);
          if (b > 0) {
            const w = _.slice(0, b),
              I = _.slice(b + H.length);
            R[w] || (R[w] = {}), (R[w][I] = p);
          } else R._root || (R._root = {}), (R._root[_] = p);
        }
        x({ ...E, data: R });
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
        E = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = E ? Object.keys(v.crossModuleDeps) : [],
        _ = {};
      for (const [y, C] of Object.entries(v.schema.facts))
        _[`${m}${H}${y}`] = C;
      const p = v.init
          ? (y) => {
              const C = ie(y, m);
              v.init(C);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, C] of Object.entries(v.derive))
          b[`${m}${H}${y}`] = (r, n) => {
            const a = E ? le(r, m, R) : ie(r, m),
              h = qe(n, m);
            return C(a, h);
          };
      const w = {};
      if (v.events)
        for (const [y, C] of Object.entries(v.events))
          w[`${m}${H}${y}`] = (r, n) => {
            const a = ie(r, m);
            C(a, n);
          };
      const I = {};
      if (v.constraints)
        for (const [y, C] of Object.entries(v.constraints)) {
          const r = C;
          I[`${m}${H}${y}`] = {
            ...r,
            deps: r.deps?.map((n) => `${m}${H}${n}`),
            when: (n) => {
              const a = E ? le(n, m, R) : ie(n, m);
              return r.when(a);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const a = E ? le(n, m, R) : ie(n, m);
                    return r.require(a);
                  }
                : r.require,
          };
        }
      const N = {};
      if (v.resolvers)
        for (const [y, C] of Object.entries(v.resolvers)) {
          const r = C;
          N[`${m}${H}${y}`] = {
            ...r,
            resolve: async (n, a) => {
              const h = De(a.facts, t, j);
              await r.resolve(n, { facts: h[m], signal: a.signal });
            },
          };
        }
      const U = {};
      if (v.effects)
        for (const [y, C] of Object.entries(v.effects)) {
          const r = C;
          U[`${m}${H}${y}`] = {
            ...r,
            run: (n, a) => {
              const h = E ? le(n, m, R) : ie(n, m),
                S = a ? (E ? le(a, m, R) : ie(a, m)) : void 0;
              return r.run(h, S);
            },
            deps: r.deps?.map((n) => `${m}${H}${n}`),
          };
        }
      l.add(m), (t[m] = v), (O.names = null);
      const z = [];
      for (const y of Object.keys(v.schema.facts)) z.push(`${m}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          z.push(`${m}${H}${y}`);
      T.set(m, z),
        c.registerModule({
          id: v.id,
          schema: _,
          requirements: v.schema.requirements ?? {},
          init: p,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(U).length > 0 ? U : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            o && !o.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${H}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${H}${l.join(H)}`;
  }
  return e;
}
function ie(e, t) {
  let l = Je.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), Je.set(e, l);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ne.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${t}${H}${s}`];
      },
      set(i, s, u) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : ((e[`${t}${H}${s}`] = u), !0);
      },
      has(i, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${t}${H}${s}` in e;
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" || ne.has(s)
          ? !1
          : (delete e[`${t}${H}${s}`], !0);
      },
    },
  );
  return l.set(t, o), o;
}
function De(e, t, l) {
  const o = Ye.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(t, u))
          return ie(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ye.set(e, i), i;
}
var Ze = new WeakMap();
function le(e, t, l) {
  let o = `${t}:${JSON.stringify([...l].sort())}`,
    i = Ze.get(e);
  if (i) {
    const g = i.get(o);
    if (g) return g;
  } else (i = new Map()), Ze.set(e, i);
  const s = new Set(l),
    u = ["self", ...l],
    d = new Proxy(
      {},
      {
        get(g, f) {
          if (typeof f != "symbol" && !ne.has(f)) {
            if (f === "self") return ie(e, t);
            if (s.has(f)) return ie(e, f);
          }
        },
        has(g, f) {
          return typeof f == "symbol" || ne.has(f)
            ? !1
            : f === "self" || s.has(f);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(g, f) {
          if (typeof f != "symbol" && (f === "self" || s.has(f)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(o, d), d;
}
function qe(e, t) {
  let l = Xe.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), Xe.set(e, l);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ne.has(s)) return e[`${t}${H}${s}`];
      },
      has(i, s) {
        return typeof s == "symbol" || ne.has(s) ? !1 : `${t}${H}${s}` in e;
      },
    },
  );
  return l.set(t, o), o;
}
function Ut(e, t, l) {
  const o = Ge.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, u) {
        if (typeof u != "symbol" && !ne.has(u) && Object.hasOwn(t, u))
          return qe(e, u);
      },
      has(s, u) {
        return typeof u == "symbol" || ne.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ge.set(e, i), i;
}
var Qe = new WeakMap();
function Ht(e, t, l) {
  let o = Qe.get(e);
  return (
    o || ((o = new Map()), Qe.set(e, o)),
    new Proxy(
      {},
      {
        get(i, s) {
          if (typeof s == "symbol" || ne.has(s) || !Object.hasOwn(t, s)) return;
          const u = o.get(s);
          if (u) return u;
          const d = new Proxy(
            {},
            {
              get(g, f) {
                if (typeof f != "symbol" && !ne.has(f))
                  return (c) => {
                    e.dispatch({ type: `${s}${H}${f}`, ...c });
                  };
              },
            },
          );
          return o.set(s, d), d;
        },
        has(i, s) {
          return typeof s == "symbol" || ne.has(s) ? !1 : Object.hasOwn(t, s);
        },
        ownKeys() {
          return l();
        },
        getOwnPropertyDescriptor(i, s) {
          if (typeof s != "symbol" && Object.hasOwn(t, s))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Kt(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !ve(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let l = e.debug,
    o = e.errorBoundary;
  e.zeroConfig &&
    ((l = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (o = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
    s = null;
  s = ft({
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
    errorBoundary: o,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [f, c] of Object.entries(e.initialFacts))
          ne.has(f) || (s.facts[f] = c);
      if (i) {
        for (const [f, c] of Object.entries(i)) ne.has(f) || (s.facts[f] = c);
        i = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(f, c) {
          if (typeof c != "symbol" && !ne.has(c))
            return ($) => {
              s.dispatch({ type: c, ...$ });
            };
        },
      },
    ),
    d = null,
    g = e.tickMs;
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
    async hydrate(f) {
      if (s.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await f();
      c && typeof c == "object" && (i = c);
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
          (d = setInterval(() => {
            s.dispatch({ type: "tick" });
          }, g));
    },
    stop() {
      d && (clearInterval(d), (d = null)), s.stop();
    },
    destroy() {
      this.stop(), s.destroy();
    },
    dispatch(f) {
      s.dispatch(f);
    },
    batch: s.batch.bind(s),
    read(f) {
      return s.read(f);
    },
    subscribe(f, c) {
      return s.subscribe(f, c);
    },
    watch(f, c, $) {
      return s.watch(f, c, $);
    },
    when(f, c) {
      return s.when(f, c);
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
    registerModule(f) {
      s.registerModule({
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
var pt = class {
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
function _e() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function mt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (l, o) =>
        typeof o == "bigint"
          ? String(o) + "n"
          : typeof o == "symbol"
            ? String(o)
            : o,
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
function Se(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function Vt(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function Jt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (_e() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function Yt() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var Gt = 200,
  Ce = 340,
  ge = 16,
  he = 80,
  et = 2,
  tt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Xt() {
  return { entries: new pt(Gt), inflight: new Map() };
}
function Zt() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var Qt = 1e4,
  er = 100;
function tr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var rr = 50,
  rt = 200,
  P = {
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
function nr(e, t, l, o) {
  let i = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${P.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${P.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const d = document.createElement("button");
  d.setAttribute("aria-label", "Open Directive DevTools"),
    d.setAttribute("aria-expanded", String(l)),
    (d.title = "Ctrl+Shift+D to toggle"),
    Object.assign(d.style, {
      ...s,
      background: P.bg,
      color: P.text,
      border: `1px solid ${P.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: P.font,
      fontSize: "12px",
      display: l ? "none" : "block",
    }),
    (d.textContent = "Directive");
  const g = document.createElement("div");
  g.setAttribute("role", "region"),
    g.setAttribute("aria-label", "Directive DevTools"),
    g.setAttribute("data-directive-devtools", ""),
    (g.tabIndex = -1),
    Object.assign(g.style, {
      ...s,
      background: P.bg,
      color: P.text,
      border: `1px solid ${P.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: P.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: l ? "block" : "none",
    });
  const f = document.createElement("div");
  Object.assign(f.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const c = document.createElement("strong");
  (c.style.color = P.accent),
    (c.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
      background: "none",
      border: "none",
      color: P.closeBtn,
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
    ($.textContent = "×"),
    f.appendChild(c),
    f.appendChild($),
    g.appendChild(f);
  const T = document.createElement("div");
  (T.style.marginBottom = "6px"), T.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = P.green),
    (O.textContent = "Settled"),
    T.appendChild(O),
    g.appendChild(T);
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
  const A = document.createElement("button");
  Object.assign(A.style, {
    background: "none",
    border: `1px solid ${P.border}`,
    color: P.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: P.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (A.textContent = "◀ Undo"),
    (A.disabled = !0);
  const k = document.createElement("button");
  Object.assign(k.style, {
    background: "none",
    border: `1px solid ${P.border}`,
    color: P.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: P.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (k.textContent = "Redo ▶"),
    (k.disabled = !0);
  const D = document.createElement("span");
  (D.style.color = P.muted),
    (D.style.fontSize = "10px"),
    j.appendChild(A),
    j.appendChild(k),
    j.appendChild(D),
    g.appendChild(j);
  function F(K, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: P.accent,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (se.textContent = `${K} (`),
      se.appendChild(de),
      se.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      G.appendChild(se);
    const ue = document.createElement("table");
    Object.assign(ue.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Le = document.createElement("thead"),
      Fe = document.createElement("tr");
    for (const bt of ["Key", "Value"]) {
      const be = document.createElement("th");
      (be.scope = "col"),
        Object.assign(be.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: P.accent,
        }),
        (be.textContent = bt),
        Fe.appendChild(be);
    }
    Le.appendChild(Fe), ue.appendChild(Le);
    const Ne = document.createElement("tbody");
    return (
      ue.appendChild(Ne),
      G.appendChild(ue),
      { details: G, tbody: Ne, countSpan: de }
    );
  }
  function B(K, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (se.textContent = `${K} (`),
      se.appendChild(de),
      se.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      G.appendChild(se);
    const ue = document.createElement("ul");
    return (
      Object.assign(ue.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(ue),
      { details: G, list: ue, countSpan: de }
    );
  }
  const m = F("Facts", !0);
  g.appendChild(m.details);
  const x = F("Derivations", !1);
  g.appendChild(x.details);
  const v = B("Inflight", P.yellow);
  g.appendChild(v.details);
  const E = B("Unmet", P.red);
  g.appendChild(E.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const _ = document.createElement("summary");
  Object.assign(_.style, {
    cursor: "pointer",
    color: P.accent,
    marginBottom: "4px",
  }),
    (_.textContent = "Performance"),
    R.appendChild(_);
  const p = document.createElement("div");
  (p.style.fontSize = "10px"),
    (p.style.color = P.muted),
    (p.textContent = "No data yet"),
    R.appendChild(p),
    g.appendChild(R);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const w = document.createElement("summary");
  Object.assign(w.style, {
    cursor: "pointer",
    color: P.accent,
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
    g.appendChild(b);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const U = document.createElement("summary");
  Object.assign(U.style, {
    cursor: "pointer",
    color: P.accent,
    marginBottom: "4px",
  }),
    (U.textContent = "Timeline"),
    N.appendChild(U);
  const z = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  z.setAttribute("width", "100%"),
    z.setAttribute("height", "60"),
    z.setAttribute("role", "img"),
    z.setAttribute("aria-label", "Resolver execution timeline"),
    (z.style.display = "block"),
    z.setAttribute("viewBox", `0 0 ${Ce} 60`),
    z.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Ce / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", P.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", P.font),
    (y.textContent = "No resolver activity yet"),
    z.appendChild(y),
    N.appendChild(z),
    g.appendChild(N);
  let C, r, n, a;
  if (o) {
    const K = document.createElement("details");
    K.style.marginBottom = "4px";
    const J = document.createElement("summary");
    Object.assign(J.style, {
      cursor: "pointer",
      color: P.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (J.textContent = "Events ("),
      J.appendChild(n),
      J.appendChild(document.createTextNode(")")),
      K.appendChild(J),
      (r = document.createElement("div")),
      Object.assign(r.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      r.setAttribute("role", "log"),
      r.setAttribute("aria-live", "polite"),
      (r.tabIndex = 0);
    const G = document.createElement("div");
    (G.style.color = P.muted),
      (G.style.padding = "4px"),
      (G.textContent = "Waiting for events..."),
      (G.className = "dt-events-empty"),
      r.appendChild(G),
      K.appendChild(r),
      g.appendChild(K),
      (C = K),
      (a = document.createElement("div"));
  } else
    (C = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (a = document.createElement("div")),
      (a.style.fontSize = "10px"),
      (a.style.color = P.muted),
      (a.style.marginTop = "4px"),
      (a.style.fontStyle = "italic"),
      (a.textContent = "Enable trace: true for event log"),
      g.appendChild(a);
  const h = document.createElement("div");
  Object.assign(h.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const S = document.createElement("button");
  Object.assign(S.style, {
    background: "none",
    border: `1px solid ${P.border}`,
    color: P.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: P.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (S.textContent = "⏺ Record");
  const M = document.createElement("button");
  Object.assign(M.style, {
    background: "none",
    border: `1px solid ${P.border}`,
    color: P.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: P.font,
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
        const J = g,
          G = J.scrollTop === 0 && K.deltaY < 0,
          se = J.scrollTop + J.clientHeight >= J.scrollHeight && K.deltaY > 0;
        (G || se) && K.preventDefault();
      },
      { passive: !1 },
    );
  let L = l,
    W = new Set();
  function q() {
    (L = !0),
      (g.style.display = "block"),
      (d.style.display = "none"),
      d.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function V() {
    (L = !1),
      (g.style.display = "none"),
      (d.style.display = "block"),
      d.setAttribute("aria-expanded", "false"),
      d.focus();
  }
  d.addEventListener("click", q), $.addEventListener("click", V);
  function Y(K) {
    K.key === "Escape" && L && V();
  }
  g.addEventListener("keydown", Y);
  function re(K) {
    K.key === "d" &&
      K.shiftKey &&
      (K.ctrlKey || K.metaKey) &&
      (K.preventDefault(), L ? V() : q());
  }
  document.addEventListener("keydown", re);
  function ee() {
    i || (document.body.appendChild(d), document.body.appendChild(g));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function X() {
    (i = !0),
      d.removeEventListener("click", q),
      $.removeEventListener("click", V),
      g.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", re),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const K of W) clearTimeout(K);
    W.clear(), d.remove(), g.remove(), u.remove();
  }
  return {
    refs: {
      container: g,
      toggleBtn: d,
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
      unmetList: E.list,
      unmetSection: E.details,
      unmetCount: E.countSpan,
      perfSection: R,
      perfBody: p,
      timeTravelSection: j,
      timeTravelLabel: D,
      undoBtn: A,
      redoBtn: k,
      flowSection: b,
      flowSvg: I,
      timelineSection: N,
      timelineSvg: z,
      eventsSection: C,
      eventsList: r,
      eventsCount: n,
      traceHint: a,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: X,
    isOpen: () => L,
    flashTimers: W,
  };
}
function xe(e, t, l, o, i, s) {
  let u = mt(o),
    d = e.get(l);
  if (d) {
    const g = d.cells;
    if (g[1] && ((g[1].textContent = u), i && s)) {
      const f = g[1];
      f.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (f.style.background = ""), s.delete(c);
      }, 300);
      s.add(c);
    }
  } else {
    (d = document.createElement("tr")),
      (d.style.borderBottom = `1px solid ${P.rowBorder}`);
    const g = document.createElement("td");
    Object.assign(g.style, { padding: "2px 4px", color: P.muted }),
      (g.textContent = l);
    const f = document.createElement("td");
    (f.style.padding = "2px 4px"),
      (f.textContent = u),
      d.appendChild(g),
      d.appendChild(f),
      t.appendChild(d),
      e.set(l, d);
  }
}
function ir(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function Ae(e, t, l) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const o of t) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.resolverId} (${o.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = P.muted),
      (o.textContent = "None"),
      e.inflightList.appendChild(o);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(l.length)),
    l.length > 0)
  )
    for (const o of l) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${o.requirement.type} from ${o.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const o = document.createElement("li");
    (o.style.fontSize = "10px"),
      (o.style.color = P.muted),
      (o.textContent = "None"),
      e.unmetList.appendChild(o);
  }
}
function Oe(e, t, l) {
  const o = t === 0 && l === 0;
  (e.statusEl.style.color = o ? P.green : P.yellow),
    (e.statusEl.textContent = o ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = o ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${o ? "" : " (system working)"}`,
    );
}
function nt(e, t, l, o) {
  const i = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      d = document.createElement("td");
    (d.colSpan = 2),
      (d.style.color = P.muted),
      (d.style.fontSize = "10px"),
      (d.textContent = "No derivations defined"),
      u.appendChild(d),
      e.derivBody.appendChild(u);
    return;
  }
  const s = new Set(i);
  for (const [u, d] of t) s.has(u) || (d.remove(), t.delete(u));
  for (const u of i) {
    let d;
    try {
      d = mt(l.read(u));
    } catch {
      d = "<error>";
    }
    xe(t, e.derivBody, u, d, !0, o);
  }
}
function or(e, t, l, o) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${P.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    d = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    g;
  try {
    const T = JSON.stringify(l);
    g = fe(T, 60);
  } catch {
    g = "{}";
  }
  const f = document.createElement("span");
  (f.style.color = P.closeBtn), (f.textContent = d);
  const c = document.createElement("span");
  (c.style.color = P.accent), (c.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = P.muted,
      $.textContent = g,
      s.appendChild(f),
      s.appendChild(c),
      s.appendChild($),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > rr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(o);
}
function sr(e, t) {
  e.perfBody.replaceChildren();
  const l =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    o = [
      `Reconciles: ${t.reconcileCount}  (avg ${l}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const i of o) {
    const s = document.createElement("div");
    (s.style.marginBottom = "2px"),
      (s.textContent = i),
      e.perfBody.appendChild(s);
  }
  if (t.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = P.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const s = [...t.resolverStats.entries()].sort(
      (u, d) => d[1].totalMs - u[1].totalMs,
    );
    for (const [u, d] of s) {
      const g = d.count > 0 ? (d.totalMs / d.count).toFixed(1) : "0",
        f = document.createElement("div");
      (f.style.paddingLeft = "8px"),
        (f.textContent = `${u}: ${d.count}x, avg ${g}ms${d.errors > 0 ? `, ${d.errors} err` : ""}`),
        d.errors > 0 && (f.style.color = P.red),
        e.perfBody.appendChild(f);
    }
  }
}
function it(e, t) {
  const l = t.debug;
  if (!l) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const o = l.currentIndex,
    i = l.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${o + 1} / ${i}` : "0 snapshots";
  const s = o > 0,
    u = o < i - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function ar(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var je = new WeakMap();
function lr(e, t, l, o, i, s) {
  return [
    e.join(","),
    t.join(","),
    l.map((u) => `${u.id}:${u.active}`).join(","),
    [...o.entries()].map(([u, d]) => `${u}:${d.status}:${d.type}`).join(","),
    i.join(","),
    s.join(","),
  ].join("|");
}
function cr(e, t, l, o, i) {
  for (const s of l) {
    const u = e.nodes.get(`0:${s}`);
    if (!u) continue;
    const d = t.recentlyChangedFacts.has(s);
    u.rect.setAttribute("fill", d ? P.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of o) {
    const u = e.nodes.get(`1:${s}`);
    if (!u) continue;
    const d = t.recentlyComputedDerivations.has(s);
    u.rect.setAttribute("fill", d ? P.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const s of i) {
    const u = e.nodes.get(`2:${s}`);
    if (!u) continue;
    const d = t.recentlyActiveConstraints.has(s),
      g = u.rect.getAttribute("stroke") ?? P.muted;
    u.rect.setAttribute("fill", d ? g + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
}
function ot(e, t, l) {
  const o = Se(t);
  if (!o) return;
  let i;
  try {
    i = Object.keys(t.facts.$store.toObject());
  } catch {
    i = [];
  }
  const s = Object.keys(t.derive),
    u = o.constraints,
    d = o.unmet,
    g = o.inflight,
    f = Object.keys(o.resolvers),
    c = new Map();
  for (const y of d)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of g)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && s.length === 0 && u.length === 0 && f.length === 0) {
    je.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
    y.setAttribute("x", "230"),
      y.setAttribute("y", "24"),
      y.setAttribute("text-anchor", "middle"),
      y.setAttribute("fill", P.muted),
      y.setAttribute("font-size", "10"),
      y.setAttribute("font-family", P.font),
      (y.textContent = "No system topology"),
      e.flowSvg.appendChild(y);
    return;
  }
  const $ = g.map((y) => y.resolverId).sort(),
    T = lr(i, s, u, c, f, $),
    O = je.get(e.flowSvg);
  if (O && O.fingerprint === T) {
    cr(
      O,
      l,
      i,
      s,
      u.map((y) => y.id),
    );
    return;
  }
  const j = Q.nodeW + Q.colGap,
    A = [5, 5 + j, 5 + j * 2, 5 + j * 3, 5 + j * 4],
    k = A[4] + Q.nodeW + 5;
  function D(y) {
    let C = Q.startY + 12;
    return y.map((r) => {
      const n = { ...r, y: C };
      return (C += Q.nodeH + Q.nodeGap), n;
    });
  }
  const F = D(i.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    B = D(s.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    m = D(
      u.map((y) => ({
        id: y.id,
        label: fe(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    x = D(
      [...c.entries()].map(([y, C]) => ({
        id: y,
        type: C.type,
        fromConstraint: C.fromConstraint,
        status: C.status,
      })),
    ),
    v = D(f.map((y) => ({ id: y, label: fe(y, Q.labelMaxChars) }))),
    E = Math.max(F.length, B.length, m.length, x.length, v.length, 1),
    R = Q.startY + 12 + E * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${s.length} derivations, ${u.length} constraints, ${c.size} requirements, ${f.length} resolvers`,
    );
  const _ = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, C] of _.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(A[y] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", P.accent),
      r.setAttribute("font-size", String(Q.fontSize)),
      r.setAttribute("font-family", P.font),
      (r.textContent = C),
      e.flowSvg.appendChild(r);
  }
  const p = { fingerprint: T, nodes: new Map() };
  function b(y, C, r, n, a, h, S, M) {
    const L = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(C)),
      W.setAttribute("y", String(r - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? h + "33" : "none"),
      W.setAttribute("stroke", h),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      L.appendChild(W);
    const q = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      q.setAttribute("x", String(C + 4)),
      q.setAttribute("y", String(r + 4)),
      q.setAttribute("fill", h),
      q.setAttribute("font-size", String(Q.fontSize)),
      q.setAttribute("font-family", P.font),
      q.setAttribute("opacity", S ? "0.35" : "1"),
      (q.textContent = a),
      L.appendChild(q),
      e.flowSvg.appendChild(L),
      p.nodes.set(`${y}:${n}`, { g: L, rect: W, text: q }),
      { midX: C + Q.nodeW / 2, midY: r }
    );
  }
  function w(y, C, r, n, a, h) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(C)),
      S.setAttribute("x2", String(r)),
      S.setAttribute("y2", String(n)),
      S.setAttribute("stroke", a),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const I = new Map(),
    N = new Map(),
    U = new Map(),
    z = new Map();
  for (const y of F) {
    const C = l.recentlyChangedFacts.has(y.id),
      r = b(0, A[0], y.y, y.id, y.label, P.text, !1, C);
    I.set(y.id, r);
  }
  for (const y of B) {
    const C = l.recentlyComputedDerivations.has(y.id),
      r = b(1, A[1], y.y, y.id, y.label, P.accent, !1, C);
    N.set(y.id, r);
  }
  for (const y of m) {
    const C = l.recentlyActiveConstraints.has(y.id),
      r = b(
        2,
        A[2],
        y.y,
        y.id,
        y.label,
        y.active ? P.yellow : P.muted,
        !y.active,
        C,
      );
    U.set(y.id, r);
  }
  for (const y of x) {
    const C = y.status === "unmet" ? P.red : P.yellow,
      r = b(3, A[3], y.y, y.id, fe(y.type, Q.labelMaxChars), C, !1, !1);
    z.set(y.id, r);
  }
  for (const y of v) {
    const C = g.some((r) => r.resolverId === y.id);
    b(4, A[4], y.y, y.id, y.label, C ? P.green : P.muted, !C, !1);
  }
  for (const y of B) {
    const C = l.derivationDeps.get(y.id),
      r = N.get(y.id);
    if (C && r)
      for (const n of C) {
        const a = I.get(n);
        a &&
          w(
            a.midX + Q.nodeW / 2,
            a.midY,
            r.midX - Q.nodeW / 2,
            r.midY,
            P.accent,
          );
      }
  }
  for (const y of x) {
    const C = U.get(y.fromConstraint),
      r = z.get(y.id);
    C &&
      r &&
      w(C.midX + Q.nodeW / 2, C.midY, r.midX - Q.nodeW / 2, r.midY, P.muted);
  }
  for (const y of g) {
    const C = z.get(y.id);
    if (C) {
      const r = v.find((n) => n.id === y.resolverId);
      r && w(C.midX + Q.nodeW / 2, C.midY, A[4], r.y, P.green);
    }
  }
  je.set(e.flowSvg, p);
}
function ur(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function dr(e, t) {
  const l = t.entries.toArray();
  if (l.length === 0) return;
  e.timelineSvg.replaceChildren();
  let o = 1 / 0,
    i = -1 / 0;
  for (const O of l)
    O.startMs < o && (o = O.startMs), O.endMs > i && (i = O.endMs);
  const s = performance.now();
  for (const O of t.inflight.values()) O < o && (o = O), s > i && (i = s);
  const u = i - o || 1,
    d = Ce - he - 10,
    g = [],
    f = new Set();
  for (const O of l)
    f.has(O.resolver) || (f.add(O.resolver), g.push(O.resolver));
  for (const O of t.inflight.keys()) f.has(O) || (f.add(O), g.push(O));
  const c = g.slice(-12),
    $ = ge * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Ce} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const T = 5;
  for (let O = 0; O <= T; O++) {
    const j = he + (d * O) / T,
      A = (u * O) / T,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(j)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", P.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", P.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        A < 1e3 ? `${A.toFixed(0)}ms` : `${(A / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const D = document.createElementNS("http://www.w3.org/2000/svg", "line");
    D.setAttribute("x1", String(j)),
      D.setAttribute("y1", "10"),
      D.setAttribute("x2", String(j)),
      D.setAttribute("y2", String($)),
      D.setAttribute("stroke", P.border),
      D.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(D);
  }
  for (let O = 0; O < c.length; O++) {
    const j = c[O],
      A = 12 + O * ge,
      k = O % tt.length,
      D = tt[k],
      F = document.createElementNS("http://www.w3.org/2000/svg", "text");
    F.setAttribute("x", String(he - 4)),
      F.setAttribute("y", String(A + ge / 2 + 3)),
      F.setAttribute("fill", P.muted),
      F.setAttribute("font-size", "7"),
      F.setAttribute("font-family", P.font),
      F.setAttribute("text-anchor", "end"),
      (F.textContent = fe(j, 12)),
      e.timelineSvg.appendChild(F);
    const B = l.filter((x) => x.resolver === j);
    for (const x of B) {
      const v = he + ((x.startMs - o) / u) * d,
        E = Math.max(((x.endMs - x.startMs) / u) * d, et),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(A + 2)),
        R.setAttribute("width", String(E)),
        R.setAttribute("height", String(ge - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", x.error ? P.red : D),
        R.setAttribute("opacity", "0.8");
      const _ = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        p = x.endMs - x.startMs;
      (_.textContent = `${j}: ${p.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        R.appendChild(_),
        e.timelineSvg.appendChild(R);
    }
    const m = t.inflight.get(j);
    if (m !== void 0) {
      const x = he + ((m - o) / u) * d,
        v = Math.max(((s - m) / u) * d, et),
        E = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      E.setAttribute("x", String(x)),
        E.setAttribute("y", String(A + 2)),
        E.setAttribute("width", String(v)),
        E.setAttribute("height", String(ge - 4)),
        E.setAttribute("rx", "2"),
        E.setAttribute("fill", D),
        E.setAttribute("opacity", "0.4"),
        E.setAttribute("stroke", D),
        E.setAttribute("stroke-width", "1"),
        E.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${j}: inflight ${(s - m).toFixed(0)}ms`),
        E.appendChild(R),
        e.timelineSvg.appendChild(E);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${l.length} resolver executions across ${c.length} resolvers`,
  );
}
function fr() {
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
        explain(l, o) {
          return this.getSystem(o)?.explain(l) ?? null;
        },
        subscribe(l, o) {
          const i = o ? e.get(o) : e.values().next().value;
          if (!i) {
            let s = !1,
              u = setInterval(() => {
                const g = o ? e.get(o) : e.values().next().value;
                g && !s && ((s = !0), g.subscribers.add(l));
              }, 100),
              d = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(d);
              for (const g of e.values()) g.subscribers.delete(l);
            };
          }
          return (
            i.subscribers.add(l),
            () => {
              i.subscribers.delete(l);
            }
          );
        },
        exportSession(l) {
          const o = l ? e.get(l) : e.values().next().value;
          return o
            ? JSON.stringify({
                version: 1,
                name: l ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: o.events.toArray(),
              })
            : null;
        },
        importSession(l, o) {
          try {
            if (l.length > 10 * 1024 * 1024) return !1;
            const i = JSON.parse(l);
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
              g = d.length > u ? d.length - u : 0;
            s.events.clear();
            for (let f = g; f < d.length; f++) {
              const c = d[f];
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
          const o = l ? e.get(l) : e.values().next().value;
          o && o.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: _e(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function pr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: o,
      panel: i = !1,
      position: s = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    d = Jt(o),
    g = fr(),
    f = {
      system: null,
      events: new pt(d),
      maxEvents: d,
      subscribers: new Set(),
    };
  g.systems.set(t, f);
  let c = (n, a) => {
      const h = { timestamp: Date.now(), type: n, data: a };
      l && f.events.push(h);
      for (const S of f.subscribers)
        try {
          S(h);
        } catch {}
    },
    $ = null,
    T = new Map(),
    O = new Map(),
    j = Yt(),
    A = Zt(),
    k = tr(),
    D = Xt(),
    F = i && typeof window < "u" && typeof document < "u" && _e(),
    B = null,
    m = 0,
    x = 1,
    v = 2,
    E = 4,
    R = 8,
    _ = 16,
    p = 32,
    b = 64,
    w = 128,
    I = new Map(),
    N = new Set(),
    U = null;
  function z(n) {
    (m |= n),
      B === null &&
        typeof requestAnimationFrame < "u" &&
        (B = requestAnimationFrame(y));
  }
  function y() {
    if (((B = null), !$ || !f.system)) {
      m = 0;
      return;
    }
    const n = $.refs,
      a = f.system,
      h = m;
    if (((m = 0), h & x)) {
      for (const S of N) ir(T, S);
      N.clear();
      for (const [S, { value: M, flash: L }] of I)
        xe(T, n.factsBody, S, M, L, $.flashTimers);
      I.clear(), (n.factsCount.textContent = String(T.size));
    }
    if ((h & v && nt(n, O, a, $.flashTimers), h & R))
      if (U) Oe(n, U.inflight.length, U.unmet.length);
      else {
        const S = Se(a);
        S && Oe(n, S.inflight.length, S.unmet.length);
      }
    if (h & E)
      if (U) Ae(n, U.inflight, U.unmet);
      else {
        const S = Se(a);
        S && Ae(n, S.inflight, S.unmet);
      }
    h & _ && sr(n, j),
      h & p && ot(n, a, A),
      h & b && it(n, a),
      h & w && dr(n, D);
  }
  function C(n, a) {
    $ && l && or($.refs, n, a, f.events.size);
  }
  function r(n, a) {
    k.isRecording &&
      k.recordedEvents.length < Qt &&
      k.recordedEvents.push({ timestamp: Date.now(), type: n, data: Vt(a) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((f.system = n),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        F)
      ) {
        const a = f.system;
        $ = nr(t, s, u, l);
        const h = $.refs;
        try {
          const M = a.facts.$store.toObject();
          for (const [L, W] of Object.entries(M)) xe(T, h.factsBody, L, W, !1);
          h.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        nt(h, O, a);
        const S = Se(a);
        S &&
          (Oe(h, S.inflight.length, S.unmet.length),
          Ae(h, S.inflight, S.unmet)),
          it(h, a),
          ar(h, a),
          ot(h, a, A),
          h.recordBtn.addEventListener("click", () => {
            if (
              ((k.isRecording = !k.isRecording),
              (h.recordBtn.textContent = k.isRecording ? "⏹ Stop" : "⏺ Record"),
              (h.recordBtn.style.color = k.isRecording ? P.red : P.text),
              k.isRecording)
            ) {
              (k.recordedEvents = []), (k.snapshots = []);
              try {
                k.snapshots.push({
                  timestamp: Date.now(),
                  facts: a.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          h.exportBtn.addEventListener("click", () => {
            const M =
                k.recordedEvents.length > 0
                  ? k.recordedEvents
                  : f.events.toArray(),
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
              q = URL.createObjectURL(W),
              V = document.createElement("a");
            (V.href = q),
              (V.download = `directive-session-${t}-${Date.now()}.json`),
              V.click(),
              URL.revokeObjectURL(q);
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
        g.systems.delete(t),
        B !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(B), (B = null)),
        A.animationTimer && clearTimeout(A.animationTimer),
        $ && ($.destroy(), ($ = null), T.clear(), O.clear());
    },
    onFactSet: (n, a, h) => {
      c("fact.set", { key: n, value: a, prev: h }),
        r("fact.set", { key: n, value: a, prev: h }),
        A.recentlyChangedFacts.add(n),
        $ &&
          f.system &&
          (I.set(n, { value: a, flash: !0 }),
          N.delete(n),
          z(x),
          C("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      c("fact.delete", { key: n, prev: a }),
        r("fact.delete", { key: n, prev: a }),
        $ && (N.add(n), I.delete(n), z(x), C("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        $ && f.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (N.add(a.key), I.delete(a.key))
            : (A.recentlyChangedFacts.add(a.key),
              I.set(a.key, { value: a.value, flash: !0 }),
              N.delete(a.key));
        z(x), C("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, a, h) => {
      c("derivation.compute", { id: n, value: a, deps: h }),
        r("derivation.compute", { id: n, deps: h }),
        A.derivationDeps.set(n, h),
        A.recentlyComputedDerivations.add(n),
        C("derivation.compute", { id: n, deps: h });
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
        const a = performance.now() - j.lastReconcileStartMs;
        j.reconcileCount++,
          (j.reconcileTotalMs += a),
          (j.lastReconcileStartMs = 0);
      }
      if (k.isRecording && f.system && k.snapshots.length < er)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: f.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        f.system &&
        ((U = n),
        ur(A),
        z(v | R | E | _ | p | b),
        C("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, a) => {
      c("constraint.evaluate", { id: n, active: a }),
        r("constraint.evaluate", { id: n, active: a }),
        a
          ? (A.activeConstraints.add(n), A.recentlyActiveConstraints.add(n))
          : A.activeConstraints.delete(n),
        C("constraint.evaluate", { id: n, active: a });
    },
    onConstraintError: (n, a) => {
      c("constraint.error", { id: n, error: String(a) }),
        C("constraint.error", { id: n, error: String(a) });
    },
    onRequirementCreated: (n) => {
      c("requirement.created", { id: n.id, type: n.requirement.type }),
        r("requirement.created", { id: n.id, type: n.requirement.type }),
        C("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, a) => {
      c("requirement.met", { id: n.id, byResolver: a }),
        r("requirement.met", { id: n.id, byResolver: a }),
        C("requirement.met", { id: n.id, byResolver: a });
    },
    onRequirementCanceled: (n) => {
      c("requirement.canceled", { id: n.id }),
        r("requirement.canceled", { id: n.id }),
        C("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, a) => {
      c("resolver.start", { resolver: n, requirementId: a.id }),
        r("resolver.start", { resolver: n, requirementId: a.id }),
        D.inflight.set(n, performance.now()),
        $ &&
          f.system &&
          (z(E | R | w),
          C("resolver.start", { resolver: n, requirementId: a.id }));
    },
    onResolverComplete: (n, a, h) => {
      c("resolver.complete", { resolver: n, requirementId: a.id, duration: h }),
        r("resolver.complete", {
          resolver: n,
          requirementId: a.id,
          duration: h,
        });
      const S = j.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += h),
        j.resolverStats.set(n, S),
        j.resolverStats.size > rt)
      ) {
        const L = j.resolverStats.keys().next().value;
        L !== void 0 && j.resolverStats.delete(L);
      }
      const M = D.inflight.get(n);
      D.inflight.delete(n),
        M !== void 0 &&
          D.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          f.system &&
          (z(E | R | _ | w),
          C("resolver.complete", { resolver: n, duration: h }));
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
      const S = j.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, j.resolverStats.set(n, S), j.resolverStats.size > rt)) {
        const L = j.resolverStats.keys().next().value;
        L !== void 0 && j.resolverStats.delete(L);
      }
      const M = D.inflight.get(n);
      D.inflight.delete(n),
        M !== void 0 &&
          D.entries.push({
            resolver: n,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          f.system &&
          (z(E | R | _ | w),
          C("resolver.error", { resolver: n, error: String(h) }));
    },
    onResolverRetry: (n, a, h) => {
      c("resolver.retry", { resolver: n, requirementId: a.id, attempt: h }),
        r("resolver.retry", { resolver: n, requirementId: a.id, attempt: h }),
        C("resolver.retry", { resolver: n, attempt: h });
    },
    onResolverCancel: (n, a) => {
      c("resolver.cancel", { resolver: n, requirementId: a.id }),
        r("resolver.cancel", { resolver: n, requirementId: a.id }),
        D.inflight.delete(n),
        C("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        r("effect.run", { id: n }),
        j.effectRunCount++,
        C("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      c("effect.error", { id: n, error: String(a) }),
        j.effectErrorCount++,
        C("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        $ && f.system && z(b),
        C("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (c("timetravel.jump", { from: n, to: a }),
        r("timetravel.jump", { from: n, to: a }),
        $ && f.system)
      ) {
        const h = f.system;
        try {
          const S = h.facts.$store.toObject();
          T.clear(), $.refs.factsBody.replaceChildren();
          for (const [M, L] of Object.entries(S))
            xe(T, $.refs.factsBody, M, L, !1);
          $.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        O.clear(),
          A.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (U = null),
          z(v | R | E | p | b),
          C("timetravel.jump", { from: n, to: a });
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
    onErrorRecovery: (n, a) => {
      c("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: a,
      }),
        C("error.recovery", { source: n.source, strategy: a });
    },
  };
}
const mr = [
  {
    id: 1,
    name: "Wireless Bluetooth Headphones",
    category: "electronics",
    price: 79.99,
  },
  { id: 2, name: "USB-C Hub Adapter", category: "electronics", price: 34.99 },
  {
    id: 3,
    name: "Mechanical Keyboard",
    category: "electronics",
    price: 129.99,
  },
  { id: 4, name: "Portable SSD 1TB", category: "electronics", price: 89.99 },
  { id: 5, name: "Webcam HD 1080p", category: "electronics", price: 49.99 },
  { id: 6, name: "Wireless Mouse", category: "electronics", price: 29.99 },
  { id: 7, name: "Monitor Stand", category: "electronics", price: 44.99 },
  {
    id: 8,
    name: "Noise Cancelling Earbuds",
    category: "electronics",
    price: 149.99,
  },
  { id: 9, name: "Laptop Cooling Pad", category: "electronics", price: 24.99 },
  { id: 10, name: "Smart Power Strip", category: "electronics", price: 39.99 },
  {
    id: 11,
    name: "Portable Charger 20000mAh",
    category: "electronics",
    price: 35.99,
  },
  { id: 12, name: "HDMI Cable 6ft", category: "electronics", price: 12.99 },
  { id: 13, name: "Desk Lamp LED", category: "electronics", price: 27.99 },
  {
    id: 14,
    name: "Cotton Crew Neck T-Shirt",
    category: "clothing",
    price: 19.99,
  },
  { id: 15, name: "Slim Fit Jeans", category: "clothing", price: 49.99 },
  { id: 16, name: "Zip-Up Hoodie", category: "clothing", price: 44.99 },
  { id: 17, name: "Running Shoes", category: "clothing", price: 89.99 },
  { id: 18, name: "Winter Parka Jacket", category: "clothing", price: 129.99 },
  { id: 19, name: "Wool Beanie", category: "clothing", price: 14.99 },
  { id: 20, name: "Leather Belt", category: "clothing", price: 24.99 },
  { id: 21, name: "Athletic Socks 6-Pack", category: "clothing", price: 16.99 },
  { id: 22, name: "Flannel Button-Down", category: "clothing", price: 34.99 },
  { id: 23, name: "Canvas Sneakers", category: "clothing", price: 54.99 },
  { id: 24, name: "Linen Shorts", category: "clothing", price: 29.99 },
  {
    id: 25,
    name: "Waterproof Rain Jacket",
    category: "clothing",
    price: 69.99,
  },
  {
    id: 26,
    name: "TypeScript Design Patterns",
    category: "books",
    price: 39.99,
  },
  { id: 27, name: "Clean Architecture", category: "books", price: 34.99 },
  { id: 28, name: "The Pragmatic Programmer", category: "books", price: 44.99 },
  { id: 29, name: "Refactoring UI", category: "books", price: 79.99 },
  { id: 30, name: "Domain-Driven Design", category: "books", price: 54.99 },
  { id: 31, name: "System Design Interview", category: "books", price: 29.99 },
  {
    id: 32,
    name: "JavaScript: The Good Parts",
    category: "books",
    price: 19.99,
  },
  {
    id: 33,
    name: "Designing Data-Intensive Apps",
    category: "books",
    price: 42.99,
  },
  { id: 34, name: "You Don't Know JS", category: "books", price: 24.99 },
  { id: 35, name: "Eloquent JavaScript", category: "books", price: 29.99 },
  { id: 36, name: "Learning Go", category: "books", price: 34.99 },
  { id: 37, name: "Rust in Action", category: "books", price: 44.99 },
  { id: 38, name: "Programming Pearls", category: "books", price: 27.99 },
  { id: 39, name: "Ceramic Coffee Mug Set", category: "home", price: 24.99 },
  { id: 40, name: "Bamboo Cutting Board", category: "home", price: 19.99 },
  {
    id: 41,
    name: "Stainless Steel Water Bottle",
    category: "home",
    price: 22.99,
  },
  { id: 42, name: "Scented Soy Candle", category: "home", price: 14.99 },
  { id: 43, name: "Throw Blanket", category: "home", price: 34.99 },
  { id: 44, name: "Cast Iron Skillet", category: "home", price: 29.99 },
  { id: 45, name: "Indoor Plant Pot Set", category: "home", price: 27.99 },
  { id: 46, name: "Kitchen Timer Digital", category: "home", price: 9.99 },
  { id: 47, name: "Drawer Organizer Tray", category: "home", price: 16.99 },
  { id: 48, name: "French Press Coffee Maker", category: "home", price: 32.99 },
  { id: 49, name: "Wall-Mounted Shelf", category: "home", price: 39.99 },
  { id: 50, name: "Cotton Dish Towels 4-Pack", category: "home", price: 12.99 },
];
function gr(e, t) {
  let l = [...e];
  if (t.search.trim() !== "") {
    const u = t.search.toLowerCase();
    l = l.filter((d) => d.name.toLowerCase().includes(u));
  }
  switch (
    (t.category !== "" &&
      t.category !== "all" &&
      (l = l.filter((u) => u.category === t.category)),
    t.sortBy)
  ) {
    case "price-asc":
      l.sort((u, d) => u.price - d.price);
      break;
    case "price-desc":
      l.sort((u, d) => d.price - u.price);
      break;
    case "newest":
    default:
      l.sort((u, d) => d.id - u.id);
      break;
  }
  const o = l.length,
    i = (t.page - 1) * t.itemsPerPage;
  return { items: l.slice(i, i + t.itemsPerPage), totalItems: o };
}
const ze = {
  facts: {
    search: Z.string(),
    category: Z.string(),
    sortBy: Z.string(),
    page: Z.number(),
    syncingFromUrl: Z.boolean(),
  },
  derivations: {},
  events: {
    setSearch: { value: Z.string() },
    setCategory: { value: Z.string() },
    setSortBy: { value: Z.string() },
    setPage: { value: Z.number() },
    syncFromUrl: {
      search: Z.string(),
      category: Z.string(),
      sortBy: Z.string(),
      page: Z.number(),
    },
    syncComplete: {},
  },
  requirements: {},
};
function st() {
  const e = new URLSearchParams(window.location.search);
  return {
    search: e.get("q") ?? "",
    category: e.get("cat") ?? "",
    sortBy: e.get("sort") ?? "newest",
    page: Math.max(1, Number.parseInt(e.get("page") ?? "1", 10) || 1),
  };
}
const hr = ct("url", {
    schema: ze,
    init: (e) => {
      const t = st();
      (e.search = t.search),
        (e.category = t.category),
        (e.sortBy = t.sortBy),
        (e.page = t.page),
        (e.syncingFromUrl = !1);
    },
    events: {
      setSearch: (e, { value: t }) => {
        (e.search = t), (e.page = 1);
      },
      setCategory: (e, { value: t }) => {
        (e.category = t), (e.page = 1);
      },
      setSortBy: (e, { value: t }) => {
        (e.sortBy = t), (e.page = 1);
      },
      setPage: (e, { value: t }) => {
        e.page = t;
      },
      syncFromUrl: (e, { search: t, category: l, sortBy: o, page: i }) => {
        (e.syncingFromUrl = !0),
          (e.search = t),
          (e.category = l),
          (e.sortBy = o),
          (e.page = i);
      },
      syncComplete: (e) => {
        e.syncingFromUrl = !1;
      },
    },
    effects: {
      urlToState: {
        run: () => {
          const e = () => {
            const t = st();
            oe.events.url.syncFromUrl({
              search: t.search,
              category: t.category,
              sortBy: t.sortBy,
              page: t.page,
            }),
              oe.events.url.syncComplete();
          };
          return (
            window.addEventListener("popstate", e),
            () => {
              window.removeEventListener("popstate", e);
            }
          );
        },
      },
      stateToUrl: {
        deps: ["search", "category", "sortBy", "page"],
        run: (e) => {
          if (e.syncingFromUrl) return;
          const t = new URLSearchParams();
          e.search !== "" && t.set("q", e.search),
            e.category !== "" &&
              e.category !== "all" &&
              t.set("cat", e.category),
            e.sortBy !== "newest" && t.set("sort", e.sortBy),
            e.page > 1 && t.set("page", String(e.page));
          const l = t.toString(),
            o = l
              ? `${window.location.pathname}?${l}`
              : window.location.pathname;
          o !== `${window.location.pathname}${window.location.search}` &&
            history.replaceState(null, "", o);
        },
      },
    },
  }),
  Te = {
    facts: {
      items: Z.object(),
      totalItems: Z.number(),
      isLoading: Z.boolean(),
      itemsPerPage: Z.number(),
    },
    derivations: { totalPages: Z.number(), currentPageDisplay: Z.string() },
    events: { setItemsPerPage: { value: Z.number() } },
    requirements: {
      FETCH_PRODUCTS: {
        search: Z.string(),
        category: Z.string(),
        sortBy: Z.string(),
        page: Z.number(),
        itemsPerPage: Z.number(),
      },
    },
  },
  yr = ct("products", {
    schema: Te,
    crossModuleDeps: { url: ze },
    init: (e) => {
      (e.items = []),
        (e.totalItems = 0),
        (e.isLoading = !1),
        (e.itemsPerPage = 10);
    },
    derive: {
      totalPages: (e) =>
        e.self.totalItems === 0
          ? 0
          : Math.ceil(e.self.totalItems / e.self.itemsPerPage),
      currentPageDisplay: (e) => {
        const t = e.self.totalItems;
        if (t === 0) return "No results";
        const l = e.url.page,
          o = e.self.itemsPerPage,
          i = (l - 1) * o + 1,
          s = Math.min(l * o, t);
        return `${i}–${s} of ${t}`;
      },
    },
    events: {
      setItemsPerPage: (e, { value: t }) => {
        e.itemsPerPage = t;
      },
    },
    constraints: {
      fetchProducts: {
        priority: 100,
        when: () => !0,
        require: (e) => ({
          type: "FETCH_PRODUCTS",
          search: e.url.search,
          category: e.url.category,
          sortBy: e.url.sortBy,
          page: e.url.page,
          itemsPerPage: e.self.itemsPerPage,
        }),
      },
    },
    resolvers: {
      fetchProducts: {
        requirement: "FETCH_PRODUCTS",
        key: (e) =>
          `fetch-${e.search}-${e.category}-${e.sortBy}-${e.page}-${e.itemsPerPage}`,
        timeout: 1e4,
        resolve: async (e, t) => {
          (t.facts.isLoading = !0),
            await new Promise((o) => setTimeout(o, 300));
          const l = gr(mr, {
            search: e.search,
            category: e.category,
            sortBy: e.sortBy,
            page: e.page,
            itemsPerPage: e.itemsPerPage,
          });
          (t.facts.items = l.items),
            (t.facts.totalItems = l.totalItems),
            (t.facts.isLoading = !1);
        },
      },
    },
  }),
  oe = Nt({
    modules: { url: hr, products: yr },
    plugins: [pr({ name: "url-sync" })],
  });
oe.start();
const vr = [
    ...Object.keys(ze.facts).map((e) => `url::${e}`),
    ...Object.keys(Te.facts).map((e) => `products::${e}`),
    ...Object.keys(Te.derivations).map((e) => `products::${e}`),
  ],
  ke = document.getElementById("us-search"),
  gt = document.querySelectorAll("[data-category]"),
  Re = document.getElementById("us-sort-select"),
  Me = document.getElementById("us-product-list"),
  ht = document.getElementById("us-page-prev"),
  yt = document.getElementById("us-page-next"),
  me = document.getElementById("us-page-numbers"),
  br = document.getElementById("us-current-url"),
  wr = document.getElementById("us-total-items"),
  Sr = document.getElementById("us-page-display"),
  at = document.getElementById("us-loading");
function lt(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function xr(e) {
  return `$${e.toFixed(2)}`;
}
function $r(e) {
  return e === "" ? "All" : e.charAt(0).toUpperCase() + e.slice(1);
}
function vt() {
  const e = oe.facts.url,
    t = oe.facts.products,
    l = oe.derive.products;
  document.activeElement !== ke && (ke.value = e.search);
  const o = e.category === "" ? "all" : e.category;
  gt.forEach((g) => {
    (g.dataset.category ?? "") === o
      ? g.classList.add("active")
      : g.classList.remove("active");
  }),
    document.activeElement !== Re && (Re.value = e.sortBy),
    t.isLoading ? (at.style.display = "flex") : (at.style.display = "none");
  const i = t.items;
  if (i.length === 0 && !t.isLoading)
    Me.innerHTML =
      '<div class="us-empty">No products found. Try adjusting your filters.</div>';
  else {
    Me.innerHTML = "";
    for (const g of i) {
      const f = document.createElement("div");
      (f.className = "us-product-card"),
        (f.innerHTML = `
        <div class="us-product-category">${lt($r(g.category))}</div>
        <div class="us-product-name">${lt(g.name)}</div>
        <div class="us-product-price">${xr(g.price)}</div>
      `),
        Me.appendChild(f);
    }
  }
  (wr.textContent = `${t.totalItems} items`),
    (Sr.textContent = l.currentPageDisplay);
  const s = l.totalPages,
    u = e.page;
  if (
    ((ht.disabled = u <= 1), (yt.disabled = u >= s), (me.innerHTML = ""), s > 0)
  ) {
    const g = Math.max(1, u - 2),
      f = Math.min(s, u + 2);
    if (g > 1 && (me.appendChild(Ie(1, u)), g > 2)) {
      const c = document.createElement("span");
      (c.className = "us-page-ellipsis"),
        (c.textContent = "…"),
        me.appendChild(c);
    }
    for (let c = g; c <= f; c++) me.appendChild(Ie(c, u));
    if (f < s) {
      if (f < s - 1) {
        const c = document.createElement("span");
        (c.className = "us-page-ellipsis"),
          (c.textContent = "…"),
          me.appendChild(c);
      }
      me.appendChild(Ie(s, u));
    }
  }
  const d = window.location.search || "(no params)";
  br.textContent = `${window.location.pathname}${d}`;
}
function Ie(e, t) {
  const l = document.createElement("button");
  return (
    (l.className = "us-btn us-page-btn"),
    (l.textContent = String(e)),
    e === t && l.classList.add("active"),
    l.addEventListener("click", () => {
      oe.events.url.setPage({ value: e });
    }),
    l
  );
}
oe.subscribe(vr, vt);
ke.addEventListener("input", () => {
  oe.events.url.setSearch({ value: ke.value });
});
gt.forEach((e) => {
  e.addEventListener("click", () => {
    const t = e.dataset.category ?? "",
      l = t === "all" ? "" : t;
    oe.events.url.setCategory({ value: l });
  });
});
Re.addEventListener("change", () => {
  oe.events.url.setSortBy({ value: Re.value });
});
ht.addEventListener("click", () => {
  const e = oe.facts.url.page;
  e > 1 && oe.events.url.setPage({ value: e - 1 });
});
yt.addEventListener("click", () => {
  const e = oe.facts.url.page,
    t = oe.derive.products.totalPages;
  e < t && oe.events.url.setPage({ value: e + 1 });
});
vt();
document.body.setAttribute("data-url-sync-ready", "true");
