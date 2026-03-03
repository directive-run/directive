(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) s(i);
  new MutationObserver((i) => {
    for (const o of i)
      if (o.type === "childList")
        for (const u of o.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && s(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function l(i) {
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
    const o = l(i);
    fetch(i.href, o);
  }
})();
var Ue = class extends Error {
    constructor(t, l, s, i, o = !0) {
      super(t),
        (this.source = l),
        (this.sourceId = s),
        (this.context = i),
        (this.recoverable = o),
        (this.name = "DirectiveError");
    }
  },
  ge = [];
function bt() {
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
var wt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function St() {
  return ge[ge.length - 1] ?? wt;
}
function ke(e) {
  const t = bt();
  ge.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    ge.pop();
  }
}
function Ve(e) {
  const t = ge.splice(0, ge.length);
  try {
    return e();
  } finally {
    ge.push(...t);
  }
}
function Be(e) {
  St().track(e);
}
function xt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Re(e = [], t, l, s, i, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: s,
    _description: i,
    _refinements: o,
    validate(u) {
      return Re([...e, u], t, l, s, i, o);
    },
  };
}
function re(e, t, l, s, i, o) {
  return {
    ...Re(e, t, l, s, i, o),
    default(u) {
      return re(e, t, u, s, i, o);
    },
    transform(u) {
      return re(
        [],
        t,
        void 0,
        (d) => {
          const g = s ? s(d) : d;
          return u(g);
        },
        i,
      );
    },
    brand() {
      return re(e, `Branded<${t}>`, l, s, i, o);
    },
    describe(u) {
      return re(e, t, l, s, u, o);
    },
    refine(u, d) {
      const g = [...(o ?? []), { predicate: u, message: d }];
      return re([...e, u], t, l, s, i, g);
    },
    nullable() {
      return re(
        [(u) => u === null || e.every((d) => d(u))],
        `${t} | null`,
        l,
        s,
        i,
      );
    },
    optional() {
      return re(
        [(u) => u === void 0 || e.every((d) => d(u))],
        `${t} | undefined`,
        l,
        s,
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
    const e = (t, l, s, i, o) => ({
      ...re(t, "number", l, s, i, o),
      min(u) {
        return e([...t, (d) => d >= u], l, s, i, o);
      },
      max(u) {
        return e([...t, (d) => d <= u], l, s, i, o);
      },
      default(u) {
        return e(t, u, s, i, o);
      },
      describe(u) {
        return e(t, l, s, u, o);
      },
      refine(u, d) {
        const g = [...(o ?? []), { predicate: u, message: d }];
        return e([...t, u], l, s, i, g);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return re([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, s, i, o) => {
      const u = re(t, "array", s, void 0, i),
        d = o ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return d.value;
        },
        set _lastFailedIndex(g) {
          d.value = g;
        },
        of(g) {
          const p = { value: -1 };
          return e(
            [
              ...t,
              (c) => {
                for (let $ = 0; $ < c.length; $++) {
                  const B = c[$];
                  if (!g._validators.every((j) => j(B)))
                    return (p.value = $), !1;
                }
                return !0;
              },
            ],
            g,
            s,
            i,
            p,
          );
        },
        nonEmpty() {
          return e([...t, (g) => g.length > 0], l, s, i, d);
        },
        maxLength(g) {
          return e([...t, (p) => p.length <= g], l, s, i, d);
        },
        minLength(g) {
          return e([...t, (p) => p.length >= g], l, s, i, d);
        },
        default(g) {
          return e(t, l, g, i, d);
        },
        describe(g) {
          return e(t, l, s, g, d);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, s) => ({
      ...re(t, "object", l, void 0, s),
      shape(i) {
        return e(
          [
            ...t,
            (o) => {
              for (const [u, d] of Object.entries(i)) {
                const g = o[u],
                  p = d;
                if (p && !p._validators.every((c) => c(g))) return !1;
              }
              return !0;
            },
          ],
          l,
          s,
        );
      },
      nonNull() {
        return e([...t, (i) => i != null], l, s);
      },
      hasKeys(...i) {
        return e([...t, (o) => i.every((u) => u in o)], l, s);
      },
      default(i) {
        return e(t, i, s);
      },
      describe(i) {
        return e(t, l, i);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return re(
      [(l) => typeof l == "string" && t.has(l)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return re([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return Re(
      [(l) => (l === null ? !0 : e._validators.every((s) => s(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Re(
      [(l) => (l === void 0 ? !0 : e._validators.every((s) => s(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return re(
      [(l) => e.some((s) => s._validators.every((i) => i(l)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return re(
      [
        (l) =>
          typeof l != "object" || l === null || Array.isArray(l)
            ? !1
            : Object.values(l).every((s) => e._validators.every((i) => i(s))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return re(
      [
        (l) =>
          !Array.isArray(l) || l.length !== e.length
            ? !1
            : e.every((s, i) => s._validators.every((o) => o(l[i]))),
      ],
      `[${t.join(", ")}]`,
    );
  },
  date() {
    return re([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return re([(t) => typeof t == "string" && e.test(t)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re([(t) => typeof t == "string" && e.test(t)], "email");
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
function $t(e) {
  const { schema: t, onChange: l, onBatch: s } = e;
  Object.keys(t).length;
  let i = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    d = new Map(),
    g = new Set(),
    p = new Map(),
    c = new Set(),
    $ = 0,
    B = [],
    j = new Set(),
    D = !1,
    A = [],
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
    return u ? "[redacted]" : xt(f);
  }
  function m(f, b) {
    if (!i) return;
    const w = t[f];
    if (!w) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (O(w)) {
      const L = w.safeParse(b);
      if (!L.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          C = _(b),
          r =
            L.error?.message ??
            L.error?.issues?.[0]?.message ??
            "Validation failed",
          n = N(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${y} ${C}. ${r}`,
        );
      }
      return;
    }
    const I = w,
      W = I._validators;
    if (!W || !Array.isArray(W) || W.length === 0) return;
    const H = I._typeName ?? "unknown";
    for (let L = 0; L < W.length; L++) {
      const y = W[L];
      if (typeof y == "function" && !y(b)) {
        let C = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          r = _(b),
          n = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const a = L === 0 ? "" : ` (validator ${L + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${H}, got ${C} ${r}${a}${n}`,
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
  function E(f, b, w) {
    if (D) {
      A.push({ key: f, value: b, prev: w });
      return;
    }
    D = !0;
    try {
      l?.(f, b, w), x(f), v();
      let I = 0;
      while (A.length > 0) {
        if (++I > k)
          throw (
            ((A.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const W = [...A];
        A.length = 0;
        for (const H of W) l?.(H.key, H.value, H.prev), x(H.key);
        v();
      }
    } finally {
      D = !1;
    }
  }
  function R() {
    if (!($ > 0)) {
      if ((s && B.length > 0 && s([...B]), j.size > 0)) {
        D = !0;
        try {
          for (const b of j) x(b);
          v();
          let f = 0;
          while (A.length > 0) {
            if (++f > k)
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
          D = !1;
        }
      }
      (B.length = 0), j.clear();
    }
  }
  const z = {
    get(f) {
      return Be(f), d.get(f);
    },
    has(f) {
      return Be(f), d.has(f);
    },
    set(f, b) {
      m(f, b);
      const w = d.get(f);
      Object.is(w, b) ||
        (d.set(f, b),
        g.add(f),
        $ > 0
          ? (B.push({ key: f, value: b, prev: w, type: "set" }), j.add(f))
          : E(f, b, w));
    },
    delete(f) {
      const b = d.get(f);
      d.delete(f),
        g.delete(f),
        $ > 0
          ? (B.push({ key: f, value: void 0, prev: b, type: "delete" }),
            j.add(f))
          : E(f, void 0, b);
    },
    batch(f) {
      $++;
      try {
        f();
      } finally {
        $--, R();
      }
    },
    subscribe(f, b) {
      for (const w of f) {
        const I = w;
        p.has(I) || p.set(I, new Set()), p.get(I).add(b);
      }
      return () => {
        for (const w of f) {
          const I = p.get(w);
          I && (I.delete(b), I.size === 0 && p.delete(w));
        }
      };
    },
    subscribeAll(f) {
      return c.add(f), () => c.delete(f);
    },
    toObject() {
      const f = {};
      for (const b of g) d.has(b) && (f[b] = d.get(b));
      return f;
    },
  };
  return (
    (z.registerKeys = (f) => {
      for (const b of Object.keys(f)) be.has(b) || ((t[b] = f[b]), g.add(b));
    }),
    z
  );
}
var be = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Et(e, t) {
  const l = () => ({
    get: (s) => Ve(() => e.get(s)),
    has: (s) => Ve(() => e.has(s)),
  });
  return new Proxy(
    {},
    {
      get(s, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return l;
        if (typeof i != "symbol" && !be.has(i)) return e.get(i);
      },
      set(s, i, o) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          be.has(i)
          ? !1
          : (e.set(i, o), !0);
      },
      deleteProperty(s, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          be.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(s, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || be.has(i)
            ? !1
            : e.has(i);
      },
      ownKeys() {
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(s, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Ct(e) {
  const t = $t(e),
    l = Et(t, e.schema);
  return { store: t, facts: l };
}
function kt(e, t) {
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
async function $e(e, t, l) {
  let s,
    i = new Promise((o, u) => {
      s = setTimeout(() => u(new Error(l)), t);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(s);
  }
}
function dt(e, t = 50) {
  const l = new WeakSet();
  function s(i, o) {
    if (o > t) return '"[max depth exceeded]"';
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
      const d = `[${i.map((g) => s(g, o + 1)).join(",")}]`;
      return l.delete(i), d;
    }
    if (u === "object") {
      const d = i;
      if (l.has(d)) return '"[circular]"';
      l.add(d);
      const g = `{${Object.keys(d)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${s(d[p], o + 1)}`)
        .join(",")}}`;
      return l.delete(d), g;
    }
    return '"[unknown]"';
  }
  return s(e, 0);
}
function we(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    s = new WeakSet();
  function i(o, u) {
    if (u > t) return !1;
    if (o == null || typeof o != "object") return !0;
    const d = o;
    if (s.has(d)) return !0;
    if ((s.add(d), Array.isArray(d))) {
      for (const g of d) if (!i(g, u + 1)) return s.delete(d), !1;
      return s.delete(d), !0;
    }
    for (const g of Object.keys(d))
      if (l.has(g) || !i(d[g], u + 1)) return s.delete(d), !1;
    return s.delete(d), !0;
  }
  return i(e, 0);
}
function Rt(e) {
  let t = dt(e),
    l = 5381;
  for (let s = 0; s < t.length; s++) l = ((l << 5) + l) ^ t.charCodeAt(s);
  return (l >>> 0).toString(16);
}
function Ot(e, t) {
  if (t) return t(e);
  const { type: l, ...s } = e,
    i = dt(s);
  return `${l}:${i}`;
}
function At(e, t, l) {
  return { requirement: e, id: Ot(e, l), fromConstraint: t };
}
var ze = class ft {
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
      const t = new ft();
      for (const l of this.map.values()) t.add(l);
      return t;
    }
    diff(t) {
      const l = [],
        s = [],
        i = [];
      for (const o of this.map.values()) t.has(o.id) ? i.push(o) : l.push(o);
      for (const o of t.map.values()) this.map.has(o.id) || s.push(o);
      return { added: l, removed: s, unchanged: i };
    }
  },
  jt = 5e3;
function Dt(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: s = {},
      defaultTimeout: i = jt,
      onEvaluate: o,
      onError: u,
    } = e,
    d = new Map(),
    g = new Set(),
    p = new Set(),
    c = new Map(),
    $ = new Map(),
    B = new Set(),
    j = new Map(),
    D = new Map(),
    A = !1,
    k = new Set(),
    O = new Set(),
    N = new Map(),
    _ = [],
    m = new Map();
  function x() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const a of n.after)
          t[a] && (N.has(a) || N.set(a, new Set()), N.get(a).add(r));
  }
  function v() {
    const r = new Set(),
      n = new Set(),
      a = [];
    function h(S, M) {
      if (r.has(S)) return;
      if (n.has(S)) {
        const K = M.indexOf(S),
          q = [...M.slice(K), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${q}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(S), M.push(S);
      const P = t[S];
      if (P?.after) for (const K of P.after) t[K] && h(K, M);
      M.pop(), n.delete(S), r.add(S), a.push(S);
    }
    for (const S of Object.keys(t)) h(S, []);
    (_ = a), (m = new Map(_.map((S, M) => [S, M])));
  }
  v(), x();
  function E(r, n) {
    return n.async !== void 0 ? n.async : !!p.has(r);
  }
  function R(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const a = E(r, n);
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
    return d.set(r, h), h;
  }
  function z(r) {
    return d.get(r) ?? R(r);
  }
  function f(r, n) {
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
    const a = z(r);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let h;
      if (n.deps) (h = n.when(l)), j.set(r, new Set(n.deps));
      else {
        const S = ke(() => n.when(l));
        (h = S.value), j.set(r, S.deps);
      }
      return h instanceof Promise
        ? (p.add(r),
          (a.isAsync = !0),
          h
            .then(
              (S) => ((a.lastResult = S), (a.isEvaluating = !1), o?.(r, S), S),
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
        : ((a.lastResult = h), (a.isEvaluating = !1), o?.(r, h), h);
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
    const a = z(r),
      h = n.timeout ?? i;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const S = new Set(n.deps);
      f(r, S), j.set(r, S);
    }
    try {
      const S = n.when(l),
        M = await $e(S, h, `Constraint "${r}" timed out after ${h}ms`);
      return (a.lastResult = M), (a.isEvaluating = !1), o?.(r, M), M;
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
  function W(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: h, deps: S } = ke(() => a(l));
      return { requirements: I(h), deps: S };
    }
    return { requirements: I(a), deps: new Set() };
  }
  function H(r, n) {
    if (n.size === 0) return;
    const a = c.get(r) ?? new Set();
    for (const h of n)
      a.add(h), $.has(h) || $.set(h, new Set()), $.get(h).add(r);
    c.set(r, a);
  }
  let L = null;
  function y() {
    return (
      L ||
        (L = Object.keys(t).sort((r, n) => {
          const a = z(r),
            h = z(n).priority - a.priority;
          if (h !== 0) return h;
          const S = m.get(r) ?? 0,
            M = m.get(n) ?? 0;
          return S - M;
        })),
      L
    );
  }
  for (const r of Object.keys(t)) R(r);
  function C(r) {
    const n = d.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (t[a] && !g.has(a) && !O.has(a) && !k.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new ze();
      O.clear();
      let a = y().filter((q) => !g.has(q)),
        h;
      if (!A || !r || r.size === 0) (h = a), (A = !0);
      else {
        const q = new Set();
        for (const J of r) {
          const G = $.get(J);
          if (G) for (const ne of G) g.has(ne) || q.add(ne);
        }
        for (const J of B) g.has(J) || q.add(J);
        B.clear(), (h = [...q]);
        for (const J of a)
          if (!q.has(J)) {
            const G = D.get(J);
            if (G) for (const ne of G) n.add(ne);
          }
      }
      function S(q, J) {
        if (g.has(q)) return;
        const G = j.get(q);
        if (!J) {
          G !== void 0 && f(q, G), O.add(q), D.set(q, []);
          return;
        }
        O.delete(q);
        let ne, ee;
        try {
          const Z = W(q);
          (ne = Z.requirements), (ee = Z.deps);
        } catch (Z) {
          u?.(q, Z), G !== void 0 && f(q, G), D.set(q, []);
          return;
        }
        if (G !== void 0) {
          const Z = new Set(G);
          for (const V of ee) Z.add(V);
          f(q, Z);
        } else H(q, ee);
        if (ne.length > 0) {
          const Z = s[q],
            V = ne.map((Y) => At(Y, q, Z));
          for (const Y of V) n.add(Y);
          D.set(q, V);
        } else D.set(q, []);
      }
      async function M(q) {
        const J = [],
          G = [];
        for (const V of q)
          if (C(V)) G.push(V);
          else {
            J.push(V);
            const Y = D.get(V);
            if (Y) for (const X of Y) n.add(X);
          }
        if (G.length === 0) return J;
        const ne = [],
          ee = [];
        for (const V of G) z(V).isAsync ? ee.push(V) : ne.push(V);
        const Z = [];
        for (const V of ne) {
          const Y = b(V);
          if (Y instanceof Promise) {
            Z.push({ id: V, promise: Y });
            continue;
          }
          S(V, Y);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async ({ id: Y, promise: X }) => ({
              id: Y,
              active: await X,
            })),
          );
          for (const { id: Y, active: X } of V) S(Y, X);
        }
        if (ee.length > 0) {
          const V = await Promise.all(
            ee.map(async (Y) => ({ id: Y, active: await w(Y) })),
          );
          for (const { id: Y, active: X } of V) S(Y, X);
        }
        return J;
      }
      let P = h,
        K = h.length + 1;
      while (P.length > 0 && K > 0) {
        const q = P.length;
        if (((P = await M(P)), P.length === q)) break;
        K--;
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
      g.add(r), (L = null), D.delete(r);
      const n = c.get(r);
      if (n) {
        for (const a of n) {
          const h = $.get(a);
          h && (h.delete(r), h.size === 0 && $.delete(a));
        }
        c.delete(r);
      }
      j.delete(r);
    },
    enable(r) {
      g.delete(r), (L = null), B.add(r);
    },
    invalidate(r) {
      const n = $.get(r);
      if (n) for (const a of n) B.add(a);
    },
    markResolved(r) {
      k.add(r);
      const n = d.get(r);
      n && (n.lastResolvedAt = Date.now());
      const a = N.get(r);
      if (a) for (const h of a) B.add(h);
    },
    isResolved(r) {
      return k.has(r);
    },
    registerDefinitions(r) {
      for (const [n, a] of Object.entries(r)) (t[n] = a), R(n), B.add(n);
      (L = null), v(), x();
    },
  };
}
function Mt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: s,
      onInvalidate: i,
      onError: o,
    } = e,
    u = new Map(),
    d = new Map(),
    g = new Map(),
    p = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    B = new Set(),
    j = !1,
    D = 100,
    A;
  function k(v) {
    if (!t[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const E = {
      id: v,
      compute: () => N(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(v, E), E;
  }
  function O(v) {
    return u.get(v) ?? k(v);
  }
  function N(v) {
    const E = O(v),
      R = t[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (E.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    E.isComputing = !0;
    try {
      const { value: z, deps: f } = ke(() => R(l, A));
      return (
        (E.cachedValue = z), (E.isStale = !1), _(v, f), s?.(v, z, [...f]), z
      );
    } catch (z) {
      throw (o?.(v, z), z);
    } finally {
      E.isComputing = !1;
    }
  }
  function _(v, E) {
    const R = O(v),
      z = R.dependencies;
    for (const f of z)
      if (u.has(f)) {
        const b = p.get(f);
        b?.delete(v), b && b.size === 0 && p.delete(f);
      } else {
        const b = g.get(f);
        b?.delete(v), b && b.size === 0 && g.delete(f);
      }
    for (const f of E)
      t[f]
        ? (p.has(f) || p.set(f, new Set()), p.get(f).add(v))
        : (g.has(f) || g.set(f, new Set()), g.get(f).add(v));
    R.dependencies = E;
  }
  function m() {
    if (!($ > 0 || j)) {
      j = !0;
      try {
        let v = 0;
        while (B.size > 0) {
          if (++v > D) {
            const R = [...B];
            throw (
              (B.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${D} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const E = [...B];
          B.clear();
          for (const R of E) d.get(R)?.forEach((z) => z());
        }
      } finally {
        j = !1;
      }
    }
  }
  function x(v, E = new Set()) {
    if (E.has(v)) return;
    E.add(v);
    const R = u.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), i?.(v), B.add(v);
    const z = p.get(v);
    if (z) for (const f of z) x(f, E);
  }
  return (
    (A = new Proxy(
      {},
      {
        get(v, E) {
          if (typeof E == "symbol" || c.has(E)) return;
          Be(E);
          const R = O(E);
          return R.isStale && N(E), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const E = O(v);
        return E.isStale && N(v), E.cachedValue;
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
            if (R) for (const z of R) x(z);
          }
        } finally {
          $--, m();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const v of u.values())
            v.isStale || ((v.isStale = !0), B.add(v.id));
        } finally {
          $--, m();
        }
      },
      subscribe(v, E) {
        for (const R of v) {
          const z = R;
          d.has(z) || d.set(z, new Set()), d.get(z).add(E);
        }
        return () => {
          for (const R of v) {
            const z = R,
              f = d.get(z);
            f?.delete(E), f && f.size === 0 && d.delete(z);
          }
        };
      },
      getProxy() {
        return A;
      },
      getDependencies(v) {
        return O(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [E, R] of Object.entries(v)) (t[E] = R), k(E);
      },
    }
  );
}
function It(e) {
  let { definitions: t, facts: l, store: s, onRun: i, onError: o } = e,
    u = new Map(),
    d = null,
    g = !1;
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
  function $() {
    return s.toObject();
  }
  function B(k, O) {
    const N = c(k);
    if (!N.enabled) return !1;
    if (N.dependencies) {
      for (const _ of N.dependencies) if (O.has(_)) return !0;
      return !1;
    }
    return !0;
  }
  function j(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (O) {
        o?.(k.id, O),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            O,
          );
      }
      k.cleanup = null;
    }
  }
  function D(k, O) {
    if (typeof O == "function")
      if (g)
        try {
          O();
        } catch (N) {
          o?.(k.id, N),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              N,
            );
        }
      else k.cleanup = O;
  }
  async function A(k) {
    const O = c(k),
      N = t[k];
    if (!(!O.enabled || !N)) {
      j(O), i?.(k);
      try {
        if (O.hasExplicitDeps) {
          let _;
          if (
            (s.batch(() => {
              _ = N.run(l, d);
            }),
            _ instanceof Promise)
          ) {
            const m = await _;
            D(O, m);
          } else D(O, _);
        } else {
          let _ = null,
            m,
            x = ke(
              () => (
                s.batch(() => {
                  m = N.run(l, d);
                }),
                m
              ),
            );
          _ = x.deps;
          let v = x.value;
          v instanceof Promise && (v = await v),
            D(O, v),
            (O.dependencies = _.size > 0 ? _ : null);
        }
      } catch (_) {
        o?.(k, _),
          console.error(`[Directive] Effect "${k}" threw an error:`, _);
      }
    }
  }
  for (const k of Object.keys(t)) p(k);
  return {
    async runEffects(k) {
      const O = [];
      for (const N of Object.keys(t)) B(N, k) && O.push(N);
      await Promise.all(O.map(A)), (d = $());
    },
    async runAll() {
      const k = Object.keys(t);
      await Promise.all(
        k.map((O) => (c(O).enabled ? A(O) : Promise.resolve())),
      ),
        (d = $());
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
      g = !0;
      for (const k of u.values()) j(k);
    },
    registerDefinitions(k) {
      for (const [O, N] of Object.entries(k)) (t[O] = N), p(O);
    },
  };
}
function Tt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: s = 2,
      maxDelayMs: i = 3e4,
    } = e,
    o = new Map();
  function u(d) {
    const g = t * Math.pow(s, d - 1);
    return Math.min(g, i);
  }
  return {
    scheduleRetry(d, g, p, c, $) {
      if (c > l) return null;
      const B = u(c),
        j = {
          source: d,
          sourceId: g,
          context: p,
          attempt: c,
          nextRetryTime: Date.now() + B,
          callback: $,
        };
      return o.set(g, j), j;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const d = Date.now(),
        g = [];
      for (const [p, c] of o) c.nextRetryTime <= d && (g.push(c), o.delete(p));
      return g;
    },
    cancelRetry(d) {
      o.delete(d);
    },
    clearAll() {
      o.clear();
    },
  };
}
var _t = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function qt(e = {}) {
  const { config: t = {}, onError: l, onRecovery: s } = e,
    i = [],
    o = 100,
    u = Tt(t.retryLater),
    d = new Map();
  function g(c, $, B, j) {
    if (B instanceof Ue) return B;
    const D = B instanceof Error ? B.message : String(B),
      A = c !== "system";
    return new Ue(D, c, $, j, A);
  }
  function p(c, $, B) {
    const j = (() => {
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
    if (typeof j == "function") {
      try {
        j(B, $);
      } catch (D) {
        console.error("[Directive] Error in error handler callback:", D);
      }
      return "skip";
    }
    return typeof j == "string" ? j : _t[c];
  }
  return {
    handleError(c, $, B, j) {
      const D = g(c, $, B, j);
      i.push(D), i.length > o && i.shift();
      try {
        l?.(D);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        t.onError?.(D);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let A = p(c, $, B instanceof Error ? B : new Error(String(B)));
      if (A === "retry-later") {
        const k = (d.get($) ?? 0) + 1;
        d.set($, k),
          u.scheduleRetry(c, $, j, k) ||
            ((A = "skip"), d.delete($), typeof process < "u");
      }
      try {
        s?.(D, A);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (A === "throw") throw D;
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
function Bt() {
  const e = [];
  function t(s) {
    if (s)
      try {
        return s();
      } catch (i) {
        console.error("[Directive] Plugin error:", i);
        return;
      }
  }
  async function l(s) {
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
      for (const i of e) await l(() => i.onInit?.(s));
    },
    emitStart(s) {
      for (const i of e) t(() => i.onStart?.(s));
    },
    emitStop(s) {
      for (const i of e) t(() => i.onStop?.(s));
    },
    emitDestroy(s) {
      for (const i of e) t(() => i.onDestroy?.(s));
    },
    emitFactSet(s, i, o) {
      for (const u of e) t(() => u.onFactSet?.(s, i, o));
    },
    emitFactDelete(s, i) {
      for (const o of e) t(() => o.onFactDelete?.(s, i));
    },
    emitFactsBatch(s) {
      for (const i of e) t(() => i.onFactsBatch?.(s));
    },
    emitDerivationCompute(s, i, o) {
      for (const u of e) t(() => u.onDerivationCompute?.(s, i, o));
    },
    emitDerivationInvalidate(s) {
      for (const i of e) t(() => i.onDerivationInvalidate?.(s));
    },
    emitReconcileStart(s) {
      for (const i of e) t(() => i.onReconcileStart?.(s));
    },
    emitReconcileEnd(s) {
      for (const i of e) t(() => i.onReconcileEnd?.(s));
    },
    emitConstraintEvaluate(s, i) {
      for (const o of e) t(() => o.onConstraintEvaluate?.(s, i));
    },
    emitConstraintError(s, i) {
      for (const o of e) t(() => o.onConstraintError?.(s, i));
    },
    emitRequirementCreated(s) {
      for (const i of e) t(() => i.onRequirementCreated?.(s));
    },
    emitRequirementMet(s, i) {
      for (const o of e) t(() => o.onRequirementMet?.(s, i));
    },
    emitRequirementCanceled(s) {
      for (const i of e) t(() => i.onRequirementCanceled?.(s));
    },
    emitResolverStart(s, i) {
      for (const o of e) t(() => o.onResolverStart?.(s, i));
    },
    emitResolverComplete(s, i, o) {
      for (const u of e) t(() => u.onResolverComplete?.(s, i, o));
    },
    emitResolverError(s, i, o) {
      for (const u of e) t(() => u.onResolverError?.(s, i, o));
    },
    emitResolverRetry(s, i, o) {
      for (const u of e) t(() => u.onResolverRetry?.(s, i, o));
    },
    emitResolverCancel(s, i) {
      for (const o of e) t(() => o.onResolverCancel?.(s, i));
    },
    emitEffectRun(s) {
      for (const i of e) t(() => i.onEffectRun?.(s));
    },
    emitEffectError(s, i) {
      for (const o of e) t(() => o.onEffectError?.(s, i));
    },
    emitSnapshot(s) {
      for (const i of e) t(() => i.onSnapshot?.(s));
    },
    emitTimeTravel(s, i) {
      for (const o of e) t(() => o.onTimeTravel?.(s, i));
    },
    emitError(s) {
      for (const i of e) t(() => i.onError?.(s));
    },
    emitErrorRecovery(s, i) {
      for (const o of e) t(() => o.onErrorRecovery?.(s, i));
    },
  };
}
var Je = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ye = { enabled: !1, windowMs: 50 };
function Ge(e, t) {
  let { backoff: l, initialDelay: s = 100, maxDelay: i = 3e4 } = e,
    o;
  switch (l) {
    case "none":
      o = s;
      break;
    case "linear":
      o = s * t;
      break;
    case "exponential":
      o = s * Math.pow(2, t - 1);
      break;
    default:
      o = s;
  }
  return Math.max(1, Math.min(o, i));
}
function zt(e) {
  const {
      definitions: t,
      facts: l,
      store: s,
      onStart: i,
      onComplete: o,
      onError: u,
      onRetry: d,
      onCancel: g,
      onResolutionComplete: p,
    } = e,
    c = new Map(),
    $ = new Map(),
    B = 1e3,
    j = new Map(),
    D = new Map(),
    A = 1e3;
  function k() {
    if ($.size > B) {
      const f = $.size - B,
        b = $.keys();
      for (let w = 0; w < f; w++) {
        const I = b.next().value;
        I && $.delete(I);
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
      w = D.get(b);
    if (w)
      for (const I of w) {
        const W = t[I];
        if (W && _(W, f)) return I;
      }
    for (const [I, W] of Object.entries(t))
      if (_(W, f)) {
        if (!D.has(b)) {
          if (D.size >= A) {
            const L = D.keys().next().value;
            L !== void 0 && D.delete(L);
          }
          D.set(b, []);
        }
        const H = D.get(b);
        return H.includes(I) || H.push(I), I;
      }
    return null;
  }
  function x(f) {
    return { facts: l, signal: f, snapshot: () => l.$snapshot() };
  }
  async function v(f, b, w) {
    const I = t[f];
    if (!I) return;
    let W = { ...Je, ...I.retry },
      H = null;
    for (let L = 1; L <= W.attempts; L++) {
      if (w.signal.aborted) return;
      const y = c.get(b.id);
      y &&
        ((y.attempt = L),
        (y.status = {
          state: "running",
          requirementId: b.id,
          startedAt: y.startedAt,
          attempt: L,
        }));
      try {
        const C = x(w.signal);
        if (I.resolve) {
          let n;
          s.batch(() => {
            n = I.resolve(b.requirement, C);
          });
          const a = I.timeout;
          a && a > 0
            ? await $e(n, a, `Resolver "${f}" timed out after ${a}ms`)
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
          o?.(f, b, r);
        return;
      } catch (C) {
        if (
          ((H = C instanceof Error ? C : new Error(String(C))),
          w.signal.aborted)
        )
          return;
        if (W.shouldRetry && !W.shouldRetry(H, L)) break;
        if (L < W.attempts) {
          if (w.signal.aborted) return;
          const r = Ge(W, L);
          if (
            (d?.(f, b, L + 1),
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
      error: H,
      failedAt: Date.now(),
      attempts: W.attempts,
    }),
      k(),
      u?.(f, b, H);
  }
  async function E(f, b) {
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
    let I = { ...Je, ...w.retry },
      W = { ...Ye, ...w.batch },
      H = new AbortController(),
      L = Date.now(),
      y = null,
      C = W.timeoutMs ?? w.timeout;
    for (let r = 1; r <= I.attempts; r++) {
      if (H.signal.aborted) return;
      try {
        const n = x(H.signal),
          a = b.map((h) => h.requirement);
        if (w.resolveBatchWithResults) {
          let h, S;
          if (
            (s.batch(() => {
              S = w.resolveBatchWithResults(a, n);
            }),
            C && C > 0
              ? (h = await $e(
                  S,
                  C,
                  `Batch resolver "${f}" timed out after ${C}ms`,
                ))
              : (h = await S),
            h.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${h.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let M = Date.now() - L,
            P = !1;
          for (let K = 0; K < b.length; K++) {
            const q = b[K],
              J = h[K];
            if (J.success)
              $.set(q.id, {
                state: "success",
                requirementId: q.id,
                completedAt: Date.now(),
                duration: M,
              }),
                o?.(f, q, M);
            else {
              P = !0;
              const G = J.error ?? new Error("Batch item failed");
              $.set(q.id, {
                state: "error",
                requirementId: q.id,
                error: G,
                failedAt: Date.now(),
                attempts: r,
              }),
                u?.(f, q, G);
            }
          }
          if (!P || b.some((K, q) => h[q]?.success)) return;
        } else {
          let h;
          s.batch(() => {
            h = w.resolveBatch(a, n);
          }),
            C && C > 0
              ? await $e(h, C, `Batch resolver "${f}" timed out after ${C}ms`)
              : await h;
          const S = Date.now() - L;
          for (const M of b)
            $.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: S,
            }),
              o?.(f, M, S);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          H.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, r)) break;
        if (r < I.attempts) {
          const a = Ge(I, r);
          for (const h of b) d?.(f, h, r + 1);
          if (
            (await new Promise((h) => {
              const S = setTimeout(h, a),
                M = () => {
                  clearTimeout(S), h();
                };
              H.signal.addEventListener("abort", M, { once: !0 });
            }),
            H.signal.aborted)
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
        u?.(f, r, y);
    k();
  }
  function R(f, b) {
    const w = t[f];
    if (!w) return;
    const I = { ...Ye, ...w.batch };
    j.has(f) || j.set(f, { resolverId: f, requirements: [], timer: null });
    const W = j.get(f);
    W.requirements.push(b),
      W.timer && clearTimeout(W.timer),
      (W.timer = setTimeout(() => {
        z(f);
      }, I.windowMs));
  }
  function z(f) {
    const b = j.get(f);
    if (!b || b.requirements.length === 0) return;
    const w = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      E(f, w).then(() => {
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
      const I = new AbortController(),
        W = Date.now(),
        H = {
          requirementId: f.id,
          resolverId: b,
          controller: I,
          startedAt: W,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: W },
          originalRequirement: f,
        };
      c.set(f.id, H),
        i?.(b, f),
        v(b, f, I).finally(() => {
          c.delete(f.id) && p?.();
        });
    },
    cancel(f) {
      const b = c.get(f);
      b &&
        (b.controller.abort(),
        c.delete(f),
        $.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        k(),
        g?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of c) this.cancel(f);
      for (const f of j.values()) f.timer && clearTimeout(f.timer);
      j.clear();
    },
    getStatus(f) {
      const b = c.get(f);
      return b ? b.status : $.get(f) || { state: "idle" };
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
      for (const f of j.keys()) z(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) t[b] = w;
      D.clear();
    },
  };
}
function Lt(e) {
  let { config: t, facts: l, store: s, onSnapshot: i, onTimeTravel: o } = e,
    u = t.timeTravel ?? !1,
    d = t.maxSnapshots ?? 100,
    g = [],
    p = -1,
    c = 1,
    $ = !1,
    B = !1,
    j = [],
    D = null,
    A = -1;
  function k() {
    return s.toObject();
  }
  function O() {
    const _ = k();
    return structuredClone(_);
  }
  function N(_) {
    if (!we(_)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    s.batch(() => {
      for (const [m, x] of Object.entries(_)) {
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
      return B;
    },
    get isPaused() {
      return $;
    },
    get snapshots() {
      return [...g];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(_) {
      if (!u || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: _ };
      const m = { id: c++, timestamp: Date.now(), facts: O(), trigger: _ };
      for (
        p < g.length - 1 && g.splice(p + 1), g.push(m), p = g.length - 1;
        g.length > d;
      )
        g.shift(), p--;
      return i?.(m), m;
    },
    restore(_) {
      if (u) {
        ($ = !0), (B = !0);
        try {
          N(_.facts);
        } finally {
          ($ = !1), (B = !1);
        }
      }
    },
    goBack(_ = 1) {
      if (!u || g.length === 0) return;
      let m = p,
        x = p,
        v = j.find((R) => p > R.startIndex && p <= R.endIndex);
      if (v) x = v.startIndex;
      else if (j.find((R) => p === R.startIndex)) {
        const R = j.find((z) => z.endIndex < p && p - z.endIndex <= _);
        x = R ? R.startIndex : Math.max(0, p - _);
      } else x = Math.max(0, p - _);
      if (m === x) return;
      p = x;
      const E = g[p];
      E && (this.restore(E), o?.(m, x));
    },
    goForward(_ = 1) {
      if (!u || g.length === 0) return;
      let m = p,
        x = p,
        v = j.find((R) => p >= R.startIndex && p < R.endIndex);
      if ((v ? (x = v.endIndex) : (x = Math.min(g.length - 1, p + _)), m === x))
        return;
      p = x;
      const E = g[p];
      E && (this.restore(E), o?.(m, x));
    },
    goTo(_) {
      if (!u) return;
      const m = g.findIndex((E) => E.id === _);
      if (m === -1) {
        console.warn(`[Directive] Snapshot ${_} not found`);
        return;
      }
      const x = p;
      p = m;
      const v = g[p];
      v && (this.restore(v), o?.(x, m));
    },
    replay() {
      if (!u || g.length === 0) return;
      p = 0;
      const _ = g[0];
      _ && this.restore(_);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: g, currentIndex: p });
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
            if (!we(v.facts))
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
    beginChangeset(_) {
      u && ((D = _), (A = p));
    },
    endChangeset() {
      !u ||
        D === null ||
        (p > A && j.push({ label: D, startIndex: A, endIndex: p }),
        (D = null),
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
function Pt() {
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
var ce = new Set(["__proto__", "constructor", "prototype"]);
function pt(e) {
  const t = Object.create(null),
    l = Object.create(null),
    s = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    u = Object.create(null);
  for (const r of e.modules) {
    const n = (a, h) => {
      if (a) {
        for (const S of Object.keys(a))
          if (ce.has(S))
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
      r.derive && Object.assign(s, r.derive),
      r.effects && Object.assign(i, r.effects),
      r.constraints && Object.assign(o, r.constraints),
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
    p = !1,
    c = Bt();
  for (const r of e.plugins ?? []) c.register(r);
  let $ = qt({
      config: e.errorBoundary,
      onError: (r) => c.emitError(r),
      onRecovery: (r, n) => c.emitErrorRecovery(r, n),
    }),
    B = () => {},
    j = () => {},
    D = null,
    { store: A, facts: k } = Ct({
      schema: t,
      onChange: (r, n, a) => {
        c.emitFactSet(r, n, a),
          B(r),
          !D?.isRestoring && (g === 0 && (p = !0), w.changedKeys.add(r), I());
      },
      onBatch: (r) => {
        c.emitFactsBatch(r);
        const n = [];
        for (const a of r) n.push(a.key);
        if ((j(n), !D?.isRestoring)) {
          g === 0 && (p = !0);
          for (const a of r) w.changedKeys.add(a.key);
          I();
        }
      },
    }),
    O = Mt({
      definitions: s,
      facts: k,
      onCompute: (r, n, a) => c.emitDerivationCompute(r, n, a),
      onInvalidate: (r) => c.emitDerivationInvalidate(r),
      onError: (r, n) => {
        $.handleError("derivation", r, n);
      },
    });
  (B = (r) => O.invalidate(r)), (j = (r) => O.invalidateMany(r));
  const N = It({
      definitions: i,
      facts: k,
      store: A,
      onRun: (r) => c.emitEffectRun(r),
      onError: (r, n) => {
        $.handleError("effect", r, n), c.emitEffectError(r, n);
      },
    }),
    _ = Dt({
      definitions: o,
      facts: k,
      onEvaluate: (r, n) => c.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        $.handleError("constraint", r, n), c.emitConstraintError(r, n);
      },
    }),
    m = zt({
      definitions: u,
      facts: k,
      store: A,
      onStart: (r, n) => c.emitResolverStart(r, n),
      onComplete: (r, n, a) => {
        c.emitResolverComplete(r, n, a),
          c.emitRequirementMet(n, r),
          _.markResolved(n.fromConstraint);
      },
      onError: (r, n, a) => {
        $.handleError("resolver", r, a, n), c.emitResolverError(r, n, a);
      },
      onRetry: (r, n, a) => c.emitResolverRetry(r, n, a),
      onCancel: (r, n) => {
        c.emitResolverCancel(r, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        z(), I();
      },
    }),
    x = new Set();
  function v() {
    for (const r of x) r();
  }
  const E = e.debug?.timeTravel
    ? Lt({
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
    : Pt();
  D = E;
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
      previousRequirements: new ze(),
      readyPromise: null,
      readyResolve: null,
    };
  function I() {
    !w.isRunning ||
      w.reconcileScheduled ||
      w.isInitializing ||
      ((w.reconcileScheduled = !0),
      z(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && W().catch((r) => {});
      }));
  }
  async function W() {
    if (!w.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), z();
      try {
        w.changedKeys.size > 0 &&
          ((d === null || p) &&
            E.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (p = !1));
        const r = k.$snapshot();
        c.emitReconcileStart(r), await N.runEffects(w.changedKeys);
        const n = new Set(w.changedKeys);
        w.changedKeys.clear();
        const a = await _.evaluate(n),
          h = new ze();
        for (const q of a) h.add(q), c.emitRequirementCreated(q);
        const { added: S, removed: M } = h.diff(w.previousRequirements);
        for (const q of M) m.cancel(q.id);
        for (const q of S) m.resolve(q);
        w.previousRequirements = h;
        const P = m.getInflightInfo(),
          K = {
            unmet: a.filter((q) => !m.isResolving(q.id)),
            inflight: P,
            completed: [],
            canceled: M.map((q) => ({
              id: q.id,
              resolverId: P.find((J) => J.id === q.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(K),
          w.isReady ||
            ((w.isReady = !0),
            w.readyResolve && (w.readyResolve(), (w.readyResolve = null)));
      } finally {
        (w.isReconciling = !1),
          w.changedKeys.size > 0 ? I() : w.reconcileScheduled || (b = 0),
          z();
      }
    }
  }
  const H = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ce.has(n)) return O.get(n);
        },
        has(r, n) {
          return typeof n == "symbol" || ce.has(n) ? !1 : n in s;
        },
        ownKeys() {
          return Object.keys(s);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ce.has(n) && n in s)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    L = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ce.has(n))
            return (a) => {
              const h = l[n];
              if (h) {
                g++, (d === null || d.has(n)) && (p = !0);
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
          return typeof n == "symbol" || ce.has(n) ? !1 : n in l;
        },
        ownKeys() {
          return Object.keys(l);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ce.has(n) && n in l)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: k,
      debug: E.isEnabled ? E : null,
      derive: H,
      events: L,
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
              A.batch(() => {
                r.init(k);
              });
          e.onAfterModuleInit &&
            A.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const r of Object.keys(s)) O.get(r);
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
          (w.isRunning = !1), m.cancelAll(), N.cleanupAll();
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
        if (ce.has(r.type)) return;
        const n = l[r.type];
        if (n) {
          g++, (d === null || d.has(r.type)) && (p = !0);
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
        return O.get(r);
      },
      subscribe(r, n) {
        const a = [],
          h = [];
        for (const M of r) M in s ? a.push(M) : M in t && h.push(M);
        const S = [];
        return (
          a.length > 0 && S.push(O.subscribe(a, n)),
          h.length > 0 && S.push(A.subscribe(h, n)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(r, n, a) {
        const h = a?.equalityFn
          ? (M, P) => a.equalityFn(M, P)
          : (M, P) => Object.is(M, P);
        if (r in s) {
          let M = O.get(r);
          return O.subscribe([r], () => {
            const P = O.get(r);
            if (!h(P, M)) {
              const K = M;
              (M = P), n(P, K);
            }
          });
        }
        let S = A.get(r);
        return A.subscribe([r], () => {
          const M = A.get(r);
          if (!h(M, S)) {
            const P = S;
            (S = M), n(M, P);
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
            P,
            K = () => {
              M?.(), P !== void 0 && clearTimeout(P);
            };
          (M = A.subscribeAll(() => {
            const q = A.toObject();
            r(q) && (K(), a());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (P = setTimeout(() => {
                K(),
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
        const n = w.previousRequirements.all().find((J) => J.id === r);
        if (!n) return null;
        const a = _.getState(n.fromConstraint),
          h = m.getStatus(r),
          S = {},
          M = A.toObject();
        for (const [J, G] of Object.entries(M)) S[J] = G;
        const P = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${h.state}`,
          ],
          K = Object.entries(n.requirement)
            .filter(([J]) => J !== "type")
            .map(([J, G]) => `${J}=${JSON.stringify(G)}`)
            .join(", ");
        K && P.push(`├─ Requirement payload: { ${K} }`);
        const q = Object.entries(S).slice(0, 10);
        return (
          q.length > 0 &&
            (P.push("└─ Relevant facts:"),
            q.forEach(([J, G], ne) => {
              const ee = ne === q.length - 1 ? "   └─" : "   ├─",
                Z = typeof G == "object" ? JSON.stringify(G) : String(G);
              P.push(
                `${ee} ${J} = ${Z.slice(0, 50)}${Z.length > 50 ? "..." : ""}`,
              );
            })),
          P.join(`
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
            includeVersion: P,
          } = r,
          K = {},
          q = Object.keys(s),
          J;
        if ((n ? (J = n.filter((ee) => q.includes(ee))) : (J = q), a)) {
          const ee = new Set(a);
          J = J.filter((Z) => !ee.has(Z));
        }
        for (const ee of J)
          try {
            K[ee] = O.get(ee);
          } catch {}
        if (h && h.length > 0) {
          const ee = A.toObject();
          for (const Z of h) Z in ee && (K[Z] = ee[Z]);
        }
        const G = Date.now(),
          ne = { data: K, createdAt: G };
        return (
          S !== void 0 && S > 0 && (ne.expiresAt = G + S * 1e3),
          P && (ne.version = Rt(K)),
          M && (ne.metadata = M),
          ne
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: a, excludeDerivations: h } = r,
          S = Object.keys(s),
          M;
        if ((a ? (M = a.filter((K) => S.includes(K))) : (M = S), h)) {
          const K = new Set(h);
          M = M.filter((q) => !K.has(q));
        }
        if (M.length === 0) return () => {};
        let P = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return O.subscribe(M, () => {
          const K = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          K.version !== P && ((P = K.version), n(K));
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
        if (!we(r))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        A.batch(() => {
          for (const [n, a] of Object.entries(r.facts))
            ce.has(n) || A.set(n, a);
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
          if (ce.has(S))
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
      r.derive && (Object.assign(s, r.derive), O.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(i, r.effects), N.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(o, r.constraints), _.registerDefinitions(r.constraints)),
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
var ie = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  U = "::";
function Ft(e) {
  const t = Object.keys(e),
    l = new Set(),
    s = new Set(),
    i = [],
    o = [];
  function u(d) {
    if (l.has(d)) return;
    if (s.has(d)) {
      const p = o.indexOf(d),
        c = [...o.slice(p), d].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    s.add(d), o.push(d);
    const g = e[d];
    if (g?.crossModuleDeps)
      for (const p of Object.keys(g.crossModuleDeps)) t.includes(p) && u(p);
    o.pop(), s.delete(d), l.add(d), i.push(d);
  }
  for (const d of t) u(d);
  return i;
}
var Xe = new WeakMap(),
  Ze = new WeakMap(),
  Qe = new WeakMap(),
  et = new WeakMap();
function Nt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Ut(e);
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
    s = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const m = o,
      x = Object.keys(t).filter((v) => !m.includes(v));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = m;
  } else o === "declaration" ? (i = Object.keys(t)) : (i = Ft(t));
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
    if (m.includes(U))
      throw new Error(
        `[Directive] Module name "${m}" contains the reserved separator "${U}". Module names cannot contain "${U}".`,
      );
    const x = t[m];
    if (x) {
      for (const v of Object.keys(x.schema.facts))
        if (v.includes(U))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${m}" contains the reserved separator "${U}". Schema keys cannot contain "${U}".`,
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
    for (const [y, C] of Object.entries(x.schema.facts)) R[`${m}${U}${y}`] = C;
    const z = {};
    if (x.schema.derivations)
      for (const [y, C] of Object.entries(x.schema.derivations))
        z[`${m}${U}${y}`] = C;
    const f = {};
    if (x.schema.events)
      for (const [y, C] of Object.entries(x.schema.events))
        f[`${m}${U}${y}`] = C;
    const b = x.init
        ? (y) => {
            const C = se(y, m);
            x.init(C);
          }
        : void 0,
      w = {};
    if (x.derive)
      for (const [y, C] of Object.entries(x.derive))
        w[`${m}${U}${y}`] = (r, n) => {
          const a = v ? ue(r, m, E) : se(r, m),
            h = Le(n, m);
          return C(a, h);
        };
    const I = {};
    if (x.events)
      for (const [y, C] of Object.entries(x.events))
        I[`${m}${U}${y}`] = (r, n) => {
          const a = se(r, m);
          C(a, n);
        };
    const W = {};
    if (x.constraints)
      for (const [y, C] of Object.entries(x.constraints)) {
        const r = C;
        W[`${m}${U}${y}`] = {
          ...r,
          deps: r.deps?.map((n) => `${m}${U}${n}`),
          when: (n) => {
            const a = v ? ue(n, m, E) : se(n, m);
            return r.when(a);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const a = v ? ue(n, m, E) : se(n, m);
                  return r.require(a);
                }
              : r.require,
        };
      }
    const H = {};
    if (x.resolvers)
      for (const [y, C] of Object.entries(x.resolvers)) {
        const r = C;
        H[`${m}${U}${y}`] = {
          ...r,
          resolve: async (n, a) => {
            const h = je(a.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: h[m], signal: a.signal });
          },
        };
      }
    const L = {};
    if (x.effects)
      for (const [y, C] of Object.entries(x.effects)) {
        const r = C;
        L[`${m}${U}${y}`] = {
          ...r,
          run: (n, a) => {
            const h = v ? ue(n, m, E) : se(n, m),
              S = a ? (v ? ue(a, m, E) : se(a, m)) : void 0;
            return r.run(h, S);
          },
          deps: r.deps?.map((n) => `${m}${U}${n}`),
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
      events: I,
      effects: L,
      constraints: W,
      resolvers: H,
      hooks: x.hooks,
      snapshotEvents:
        s && !s.has(m) ? [] : x.snapshotEvents?.map((y) => `${m}${U}${y}`),
    });
  }
  let p = null,
    c = null;
  function $(m) {
    for (const [x, v] of Object.entries(m))
      if (!ie.has(x) && l.has(x)) {
        if (v && typeof v == "object" && !we(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [E, R] of Object.entries(v))
          ie.has(E) || (c.facts[`${x}${U}${E}`] = R);
      }
  }
  c = pt({
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
      e.initialFacts && $(e.initialFacts), p && ($(p), (p = null));
    },
  });
  const B = new Map();
  for (const m of Object.keys(t)) {
    const x = t[m];
    if (!x) continue;
    const v = [];
    for (const E of Object.keys(x.schema.facts)) v.push(`${m}${U}${E}`);
    if (x.schema.derivations)
      for (const E of Object.keys(x.schema.derivations)) v.push(`${m}${U}${E}`);
    B.set(m, v);
  }
  const j = { names: null };
  function D() {
    return j.names === null && (j.names = Object.keys(t)), j.names;
  }
  let A = je(c.facts, t, D),
    k = Kt(c.derive, t, D),
    O = Ht(c, t, D),
    N = null,
    _ = e.tickMs;
  return {
    _mode: "namespaced",
    facts: A,
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
      const x = await m();
      x && typeof x == "object" && (p = x);
    },
    initialize() {
      c.initialize();
    },
    start() {
      if ((c.start(), _ && _ > 0)) {
        const m = Object.keys(g[0]?.events ?? {}).find((x) =>
          x.endsWith(`${U}tick`),
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
      return c.read(de(m));
    },
    subscribe(m, x) {
      const v = [];
      for (const E of m)
        if (E.endsWith(".*")) {
          const R = E.slice(0, -2),
            z = B.get(R);
          z && v.push(...z);
        } else v.push(de(E));
      return c.subscribe(v, x);
    },
    subscribeModule(m, x) {
      const v = B.get(m);
      return !v || v.length === 0 ? () => {} : c.subscribe(v, x);
    },
    watch(m, x, v) {
      return c.watch(de(m), x, v);
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
          includeDerivations: m?.includeDerivations?.map(de),
          excludeDerivations: m?.excludeDerivations?.map(de),
          includeFacts: m?.includeFacts?.map(de),
        },
        v = c.getDistributableSnapshot(x),
        E = {};
      for (const [R, z] of Object.entries(v.data)) {
        const f = R.indexOf(U);
        if (f > 0) {
          const b = R.slice(0, f),
            w = R.slice(f + U.length);
          E[b] || (E[b] = {}), (E[b][w] = z);
        } else E._root || (E._root = {}), (E._root[R] = z);
      }
      return { ...v, data: E };
    },
    watchDistributableSnapshot(m, x) {
      const v = {
        ...m,
        includeDerivations: m?.includeDerivations?.map(de),
        excludeDerivations: m?.excludeDerivations?.map(de),
        includeFacts: m?.includeFacts?.map(de),
      };
      return c.watchDistributableSnapshot(v, (E) => {
        const R = {};
        for (const [z, f] of Object.entries(E.data)) {
          const b = z.indexOf(U);
          if (b > 0) {
            const w = z.slice(0, b),
              I = z.slice(b + U.length);
            R[w] || (R[w] = {}), (R[w][I] = f);
          } else R._root || (R._root = {}), (R._root[z] = f);
        }
        x({ ...E, data: R });
      });
    },
    registerModule(m, x) {
      if (l.has(m))
        throw new Error(
          `[Directive] Module namespace "${m}" already exists. Cannot register a duplicate namespace.`,
        );
      if (m.includes(U))
        throw new Error(
          `[Directive] Module name "${m}" contains the reserved separator "${U}".`,
        );
      if (ie.has(m))
        throw new Error(
          `[Directive] Module name "${m}" is a blocked property.`,
        );
      for (const y of Object.keys(x.schema.facts))
        if (y.includes(U))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${m}" contains the reserved separator "${U}".`,
          );
      const v = x,
        E = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = E ? Object.keys(v.crossModuleDeps) : [],
        z = {};
      for (const [y, C] of Object.entries(v.schema.facts))
        z[`${m}${U}${y}`] = C;
      const f = v.init
          ? (y) => {
              const C = se(y, m);
              v.init(C);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, C] of Object.entries(v.derive))
          b[`${m}${U}${y}`] = (r, n) => {
            const a = E ? ue(r, m, R) : se(r, m),
              h = Le(n, m);
            return C(a, h);
          };
      const w = {};
      if (v.events)
        for (const [y, C] of Object.entries(v.events))
          w[`${m}${U}${y}`] = (r, n) => {
            const a = se(r, m);
            C(a, n);
          };
      const I = {};
      if (v.constraints)
        for (const [y, C] of Object.entries(v.constraints)) {
          const r = C;
          I[`${m}${U}${y}`] = {
            ...r,
            deps: r.deps?.map((n) => `${m}${U}${n}`),
            when: (n) => {
              const a = E ? ue(n, m, R) : se(n, m);
              return r.when(a);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const a = E ? ue(n, m, R) : se(n, m);
                    return r.require(a);
                  }
                : r.require,
          };
        }
      const W = {};
      if (v.resolvers)
        for (const [y, C] of Object.entries(v.resolvers)) {
          const r = C;
          W[`${m}${U}${y}`] = {
            ...r,
            resolve: async (n, a) => {
              const h = je(a.facts, t, D);
              await r.resolve(n, { facts: h[m], signal: a.signal });
            },
          };
        }
      const H = {};
      if (v.effects)
        for (const [y, C] of Object.entries(v.effects)) {
          const r = C;
          H[`${m}${U}${y}`] = {
            ...r,
            run: (n, a) => {
              const h = E ? ue(n, m, R) : se(n, m),
                S = a ? (E ? ue(a, m, R) : se(a, m)) : void 0;
              return r.run(h, S);
            },
            deps: r.deps?.map((n) => `${m}${U}${n}`),
          };
        }
      l.add(m), (t[m] = v), (j.names = null);
      const L = [];
      for (const y of Object.keys(v.schema.facts)) L.push(`${m}${U}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          L.push(`${m}${U}${y}`);
      B.set(m, L),
        c.registerModule({
          id: v.id,
          schema: z,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(H).length > 0 ? H : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(W).length > 0 ? W : void 0,
          hooks: v.hooks,
          snapshotEvents:
            s && !s.has(m) ? [] : v.snapshotEvents?.map((y) => `${m}${U}${y}`),
        });
    },
  };
}
function de(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${U}${l.join(U)}`;
  }
  return e;
}
function se(e, t) {
  let l = Xe.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), Xe.set(e, l);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !ie.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${t}${U}${o}`];
      },
      set(i, o, u) {
        return typeof o == "symbol" || ie.has(o)
          ? !1
          : ((e[`${t}${U}${o}`] = u), !0);
      },
      has(i, o) {
        return typeof o == "symbol" || ie.has(o) ? !1 : `${t}${U}${o}` in e;
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" || ie.has(o)
          ? !1
          : (delete e[`${t}${U}${o}`], !0);
      },
    },
  );
  return l.set(t, s), s;
}
function je(e, t, l) {
  const s = Ze.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, u) {
        if (typeof u != "symbol" && !ie.has(u) && Object.hasOwn(t, u))
          return se(e, u);
      },
      has(o, u) {
        return typeof u == "symbol" || ie.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(o, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ze.set(e, i), i;
}
var tt = new WeakMap();
function ue(e, t, l) {
  let s = `${t}:${JSON.stringify([...l].sort())}`,
    i = tt.get(e);
  if (i) {
    const g = i.get(s);
    if (g) return g;
  } else (i = new Map()), tt.set(e, i);
  const o = new Set(l),
    u = ["self", ...l],
    d = new Proxy(
      {},
      {
        get(g, p) {
          if (typeof p != "symbol" && !ie.has(p)) {
            if (p === "self") return se(e, t);
            if (o.has(p)) return se(e, p);
          }
        },
        has(g, p) {
          return typeof p == "symbol" || ie.has(p)
            ? !1
            : p === "self" || o.has(p);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(g, p) {
          if (typeof p != "symbol" && (p === "self" || o.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(s, d), d;
}
function Le(e, t) {
  let l = et.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), et.set(e, l);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !ie.has(o)) return e[`${t}${U}${o}`];
      },
      has(i, o) {
        return typeof o == "symbol" || ie.has(o) ? !1 : `${t}${U}${o}` in e;
      },
    },
  );
  return l.set(t, s), s;
}
function Kt(e, t, l) {
  const s = Qe.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, u) {
        if (typeof u != "symbol" && !ie.has(u) && Object.hasOwn(t, u))
          return Le(e, u);
      },
      has(o, u) {
        return typeof u == "symbol" || ie.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(o, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Qe.set(e, i), i;
}
var rt = new WeakMap();
function Ht(e, t, l) {
  let s = rt.get(e);
  return (
    s || ((s = new Map()), rt.set(e, s)),
    new Proxy(
      {},
      {
        get(i, o) {
          if (typeof o == "symbol" || ie.has(o) || !Object.hasOwn(t, o)) return;
          const u = s.get(o);
          if (u) return u;
          const d = new Proxy(
            {},
            {
              get(g, p) {
                if (typeof p != "symbol" && !ie.has(p))
                  return (c) => {
                    e.dispatch({ type: `${o}${U}${p}`, ...c });
                  };
              },
            },
          );
          return s.set(o, d), d;
        },
        has(i, o) {
          return typeof o == "symbol" || ie.has(o) ? !1 : Object.hasOwn(t, o);
        },
        ownKeys() {
          return l();
        },
        getOwnPropertyDescriptor(i, o) {
          if (typeof o != "symbol" && Object.hasOwn(t, o))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Ut(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !we(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let l = e.debug,
    s = e.errorBoundary;
  e.zeroConfig &&
    ((l = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (s = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
    o = null;
  o = pt({
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
    errorBoundary: s,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, c] of Object.entries(e.initialFacts))
          ie.has(p) || (o.facts[p] = c);
      if (i) {
        for (const [p, c] of Object.entries(i)) ie.has(p) || (o.facts[p] = c);
        i = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(p, c) {
          if (typeof c != "symbol" && !ie.has(c))
            return ($) => {
              o.dispatch({ type: c, ...$ });
            };
        },
      },
    ),
    d = null,
    g = e.tickMs;
  return {
    _mode: "single",
    facts: o.facts,
    debug: o.debug,
    derive: o.derive,
    events: u,
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
    async hydrate(p) {
      if (o.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await p();
      c && typeof c == "object" && (i = c);
    },
    initialize() {
      o.initialize();
    },
    start() {
      o.start(),
        g &&
          g > 0 &&
          t.events &&
          "tick" in t.events &&
          (d = setInterval(() => {
            o.dispatch({ type: "tick" });
          }, g));
    },
    stop() {
      d && (clearInterval(d), (d = null)), o.stop();
    },
    destroy() {
      this.stop(), o.destroy();
    },
    dispatch(p) {
      o.dispatch(p);
    },
    batch: o.batch.bind(o),
    read(p) {
      return o.read(p);
    },
    subscribe(p, c) {
      return o.subscribe(p, c);
    },
    watch(p, c, $) {
      return o.watch(p, c, $);
    },
    when(p, c) {
      return o.when(p, c);
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
    registerModule(p) {
      o.registerModule({
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
var mt = class {
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
function ht(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (l, s) =>
        typeof s == "bigint"
          ? String(s) + "n"
          : typeof s == "symbol"
            ? String(s)
            : s,
      );
      return t.length > 120 ? t.slice(0, 117) + "..." : t;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function he(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function Ee(e) {
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
      ? (Ne() &&
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
  Oe = 340,
  ye = 16,
  ve = 80,
  nt = 2,
  it = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Xt() {
  return { entries: new mt(Gt), inflight: new Map() };
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
  st = 200,
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
function nr(e, t, l, s) {
  let i = !1,
    o = {
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
    d.setAttribute("aria-expanded", String(l)),
    (d.title = "Ctrl+Shift+D to toggle"),
    Object.assign(d.style, {
      ...o,
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
    (d.textContent = "Directive");
  const g = document.createElement("div");
  g.setAttribute("role", "region"),
    g.setAttribute("aria-label", "Directive DevTools"),
    g.setAttribute("data-directive-devtools", ""),
    (g.tabIndex = -1),
    Object.assign(g.style, {
      ...o,
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
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
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
    ($.textContent = "×"),
    p.appendChild(c),
    p.appendChild($),
    g.appendChild(p);
  const B = document.createElement("div");
  (B.style.marginBottom = "6px"), B.setAttribute("aria-live", "polite");
  const j = document.createElement("span");
  (j.style.color = T.green),
    (j.textContent = "Settled"),
    B.appendChild(j),
    g.appendChild(B);
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
  const A = document.createElement("button");
  Object.assign(A.style, {
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
    (A.textContent = "◀ Undo"),
    (A.disabled = !0);
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
    D.appendChild(A),
    D.appendChild(k),
    D.appendChild(O),
    g.appendChild(D);
  function N(V, Y) {
    const X = document.createElement("details");
    Y && (X.open = !0), (X.style.marginBottom = "4px");
    const ae = document.createElement("summary");
    Object.assign(ae.style, {
      cursor: "pointer",
      color: T.accent,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (ae.textContent = `${V} (`),
      ae.appendChild(me),
      ae.appendChild(document.createTextNode(")")),
      (me.textContent = "0"),
      X.appendChild(ae);
    const pe = document.createElement("table");
    Object.assign(pe.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const We = document.createElement("thead"),
      Ke = document.createElement("tr");
    for (const vt of ["Key", "Value"]) {
      const xe = document.createElement("th");
      (xe.scope = "col"),
        Object.assign(xe.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: T.accent,
        }),
        (xe.textContent = vt),
        Ke.appendChild(xe);
    }
    We.appendChild(Ke), pe.appendChild(We);
    const He = document.createElement("tbody");
    return (
      pe.appendChild(He),
      X.appendChild(pe),
      { details: X, tbody: He, countSpan: me }
    );
  }
  function _(V, Y) {
    const X = document.createElement("details");
    X.style.marginBottom = "4px";
    const ae = document.createElement("summary");
    Object.assign(ae.style, {
      cursor: "pointer",
      color: Y,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (ae.textContent = `${V} (`),
      ae.appendChild(me),
      ae.appendChild(document.createTextNode(")")),
      (me.textContent = "0"),
      X.appendChild(ae);
    const pe = document.createElement("ul");
    return (
      Object.assign(pe.style, { margin: "0", paddingLeft: "16px" }),
      X.appendChild(pe),
      { details: X, list: pe, countSpan: me }
    );
  }
  const m = N("Facts", !0);
  g.appendChild(m.details);
  const x = N("Derivations", !1);
  g.appendChild(x.details);
  const v = _("Inflight", T.yellow);
  g.appendChild(v.details);
  const E = _("Unmet", T.red);
  g.appendChild(E.details);
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
  const W = document.createElement("details");
  W.style.marginBottom = "4px";
  const H = document.createElement("summary");
  Object.assign(H.style, {
    cursor: "pointer",
    color: T.accent,
    marginBottom: "4px",
  }),
    (H.textContent = "Timeline"),
    W.appendChild(H);
  const L = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  L.setAttribute("width", "100%"),
    L.setAttribute("height", "60"),
    L.setAttribute("role", "img"),
    L.setAttribute("aria-label", "Resolver execution timeline"),
    (L.style.display = "block"),
    L.setAttribute("viewBox", `0 0 ${Oe} 60`),
    L.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Oe / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", T.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", T.font),
    (y.textContent = "No resolver activity yet"),
    L.appendChild(y),
    W.appendChild(L),
    g.appendChild(W);
  let C, r, n, a;
  if (s) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
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
      V.appendChild(Y),
      (r = document.createElement("div")),
      Object.assign(r.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      r.setAttribute("role", "log"),
      r.setAttribute("aria-live", "polite"),
      (r.tabIndex = 0);
    const X = document.createElement("div");
    (X.style.color = T.muted),
      (X.style.padding = "4px"),
      (X.textContent = "Waiting for events..."),
      (X.className = "dt-events-empty"),
      r.appendChild(X),
      V.appendChild(r),
      g.appendChild(V),
      (C = V),
      (a = document.createElement("div"));
  } else
    (C = document.createElement("details")),
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
      (V) => {
        const Y = g,
          X = Y.scrollTop === 0 && V.deltaY < 0,
          ae = Y.scrollTop + Y.clientHeight >= Y.scrollHeight && V.deltaY > 0;
        (X || ae) && V.preventDefault();
      },
      { passive: !1 },
    );
  let P = l,
    K = new Set();
  function q() {
    (P = !0),
      (g.style.display = "block"),
      (d.style.display = "none"),
      d.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function J() {
    (P = !1),
      (g.style.display = "none"),
      (d.style.display = "block"),
      d.setAttribute("aria-expanded", "false"),
      d.focus();
  }
  d.addEventListener("click", q), $.addEventListener("click", J);
  function G(V) {
    V.key === "Escape" && P && J();
  }
  g.addEventListener("keydown", G);
  function ne(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), P ? J() : q());
  }
  document.addEventListener("keydown", ne);
  function ee() {
    i || (document.body.appendChild(d), document.body.appendChild(g));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function Z() {
    (i = !0),
      d.removeEventListener("click", q),
      $.removeEventListener("click", J),
      g.removeEventListener("keydown", G),
      document.removeEventListener("keydown", ne),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const V of K) clearTimeout(V);
    K.clear(), d.remove(), g.remove(), u.remove();
  }
  return {
    refs: {
      container: g,
      toggleBtn: d,
      titleEl: c,
      statusEl: j,
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
      perfBody: f,
      timeTravelSection: D,
      timeTravelLabel: O,
      undoBtn: A,
      redoBtn: k,
      flowSection: b,
      flowSvg: I,
      timelineSection: W,
      timelineSvg: L,
      eventsSection: C,
      eventsList: r,
      eventsCount: n,
      traceHint: a,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: Z,
    isOpen: () => P,
    flashTimers: K,
  };
}
function Ce(e, t, l, s, i, o) {
  let u = ht(s),
    d = e.get(l);
  if (d) {
    const g = d.cells;
    if (g[1] && ((g[1].textContent = u), i && o)) {
      const p = g[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (p.style.background = ""), o.delete(c);
      }, 300);
      o.add(c);
    }
  } else {
    (d = document.createElement("tr")),
      (d.style.borderBottom = `1px solid ${T.rowBorder}`);
    const g = document.createElement("td");
    Object.assign(g.style, { padding: "2px 4px", color: T.muted }),
      (g.textContent = l);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = u),
      d.appendChild(g),
      d.appendChild(p),
      t.appendChild(d),
      e.set(l, d);
  }
}
function ir(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function De(e, t, l) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const s of t) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.resolverId} (${s.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = T.muted),
      (s.textContent = "None"),
      e.inflightList.appendChild(s);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(l.length)),
    l.length > 0)
  )
    for (const s of l) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.requirement.type} from ${s.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = T.muted),
      (s.textContent = "None"),
      e.unmetList.appendChild(s);
  }
}
function Me(e, t, l) {
  const s = t === 0 && l === 0;
  (e.statusEl.style.color = s ? T.green : T.yellow),
    (e.statusEl.textContent = s ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = s ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${s ? "" : " (system working)"}`,
    );
}
function ot(e, t, l, s) {
  const i = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
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
  const o = new Set(i);
  for (const [u, d] of t) o.has(u) || (d.remove(), t.delete(u));
  for (const u of i) {
    let d;
    try {
      d = ht(l.read(u));
    } catch {
      d = "<error>";
    }
    Ce(t, e.derivBody, u, d, !0, s);
  }
}
function sr(e, t, l, s) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${T.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    d = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    g;
  try {
    const B = JSON.stringify(l);
    g = he(B, 60);
  } catch {
    g = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = T.closeBtn), (p.textContent = d);
  const c = document.createElement("span");
  (c.style.color = T.accent), (c.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = T.muted,
      $.textContent = g,
      o.appendChild(p),
      o.appendChild(c),
      o.appendChild($),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > rr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(s);
}
function or(e, t) {
  e.perfBody.replaceChildren();
  const l =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    s = [
      `Reconciles: ${t.reconcileCount}  (avg ${l}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const i of s) {
    const o = document.createElement("div");
    (o.style.marginBottom = "2px"),
      (o.textContent = i),
      e.perfBody.appendChild(o);
  }
  if (t.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = T.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const o = [...t.resolverStats.entries()].sort(
      (u, d) => d[1].totalMs - u[1].totalMs,
    );
    for (const [u, d] of o) {
      const g = d.count > 0 ? (d.totalMs / d.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${u}: ${d.count}x, avg ${g}ms${d.errors > 0 ? `, ${d.errors} err` : ""}`),
        d.errors > 0 && (p.style.color = T.red),
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
  const s = l.currentIndex,
    i = l.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${s + 1} / ${i}` : "0 snapshots";
  const o = s > 0,
    u = s < i - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !u),
    (e.redoBtn.style.opacity = u ? "1" : "0.4");
}
function lr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Ie = new WeakMap();
function ar(e, t, l, s, i, o) {
  return [
    e.join(","),
    t.join(","),
    l.map((u) => `${u.id}:${u.active}`).join(","),
    [...s.entries()].map(([u, d]) => `${u}:${d.status}:${d.type}`).join(","),
    i.join(","),
    o.join(","),
  ].join("|");
}
function cr(e, t, l, s, i) {
  for (const o of l) {
    const u = e.nodes.get(`0:${o}`);
    if (!u) continue;
    const d = t.recentlyChangedFacts.has(o);
    u.rect.setAttribute("fill", d ? T.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const o of s) {
    const u = e.nodes.get(`1:${o}`);
    if (!u) continue;
    const d = t.recentlyComputedDerivations.has(o);
    u.rect.setAttribute("fill", d ? T.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
  for (const o of i) {
    const u = e.nodes.get(`2:${o}`);
    if (!u) continue;
    const d = t.recentlyActiveConstraints.has(o),
      g = u.rect.getAttribute("stroke") ?? T.muted;
    u.rect.setAttribute("fill", d ? g + "33" : "none"),
      u.rect.setAttribute("stroke-width", d ? "2" : "1");
  }
}
function at(e, t, l) {
  const s = Ee(t);
  if (!s) return;
  let i;
  try {
    i = Object.keys(t.facts.$store.toObject());
  } catch {
    i = [];
  }
  const o = Object.keys(t.derive),
    u = s.constraints,
    d = s.unmet,
    g = s.inflight,
    p = Object.keys(s.resolvers),
    c = new Map();
  for (const y of d)
    c.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of g)
    c.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && o.length === 0 && u.length === 0 && p.length === 0) {
    Ie.delete(e.flowSvg),
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
  const $ = g.map((y) => y.resolverId).sort(),
    B = ar(i, o, u, c, p, $),
    j = Ie.get(e.flowSvg);
  if (j && j.fingerprint === B) {
    cr(
      j,
      l,
      i,
      o,
      u.map((y) => y.id),
    );
    return;
  }
  const D = Q.nodeW + Q.colGap,
    A = [5, 5 + D, 5 + D * 2, 5 + D * 3, 5 + D * 4],
    k = A[4] + Q.nodeW + 5;
  function O(y) {
    let C = Q.startY + 12;
    return y.map((r) => {
      const n = { ...r, y: C };
      return (C += Q.nodeH + Q.nodeGap), n;
    });
  }
  const N = O(i.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    _ = O(o.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    m = O(
      u.map((y) => ({
        id: y.id,
        label: he(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    x = O(
      [...c.entries()].map(([y, C]) => ({
        id: y,
        type: C.type,
        fromConstraint: C.fromConstraint,
        status: C.status,
      })),
    ),
    v = O(p.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    E = Math.max(N.length, _.length, m.length, x.length, v.length, 1),
    R = Q.startY + 12 + E * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${o.length} derivations, ${u.length} constraints, ${c.size} requirements, ${p.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, C] of z.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(A[y] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", T.accent),
      r.setAttribute("font-size", String(Q.fontSize)),
      r.setAttribute("font-family", T.font),
      (r.textContent = C),
      e.flowSvg.appendChild(r);
  }
  const f = { fingerprint: B, nodes: new Map() };
  function b(y, C, r, n, a, h, S, M) {
    const P = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      K = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    K.setAttribute("x", String(C)),
      K.setAttribute("y", String(r - 6)),
      K.setAttribute("width", String(Q.nodeW)),
      K.setAttribute("height", String(Q.nodeH)),
      K.setAttribute("rx", "3"),
      K.setAttribute("fill", M ? h + "33" : "none"),
      K.setAttribute("stroke", h),
      K.setAttribute("stroke-width", M ? "2" : "1"),
      K.setAttribute("opacity", S ? "0.35" : "1"),
      P.appendChild(K);
    const q = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      q.setAttribute("x", String(C + 4)),
      q.setAttribute("y", String(r + 4)),
      q.setAttribute("fill", h),
      q.setAttribute("font-size", String(Q.fontSize)),
      q.setAttribute("font-family", T.font),
      q.setAttribute("opacity", S ? "0.35" : "1"),
      (q.textContent = a),
      P.appendChild(q),
      e.flowSvg.appendChild(P),
      f.nodes.set(`${y}:${n}`, { g: P, rect: K, text: q }),
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
    W = new Map(),
    H = new Map(),
    L = new Map();
  for (const y of N) {
    const C = l.recentlyChangedFacts.has(y.id),
      r = b(0, A[0], y.y, y.id, y.label, T.text, !1, C);
    I.set(y.id, r);
  }
  for (const y of _) {
    const C = l.recentlyComputedDerivations.has(y.id),
      r = b(1, A[1], y.y, y.id, y.label, T.accent, !1, C);
    W.set(y.id, r);
  }
  for (const y of m) {
    const C = l.recentlyActiveConstraints.has(y.id),
      r = b(
        2,
        A[2],
        y.y,
        y.id,
        y.label,
        y.active ? T.yellow : T.muted,
        !y.active,
        C,
      );
    H.set(y.id, r);
  }
  for (const y of x) {
    const C = y.status === "unmet" ? T.red : T.yellow,
      r = b(3, A[3], y.y, y.id, he(y.type, Q.labelMaxChars), C, !1, !1);
    L.set(y.id, r);
  }
  for (const y of v) {
    const C = g.some((r) => r.resolverId === y.id);
    b(4, A[4], y.y, y.id, y.label, C ? T.green : T.muted, !C, !1);
  }
  for (const y of _) {
    const C = l.derivationDeps.get(y.id),
      r = W.get(y.id);
    if (C && r)
      for (const n of C) {
        const a = I.get(n);
        a &&
          w(
            a.midX + Q.nodeW / 2,
            a.midY,
            r.midX - Q.nodeW / 2,
            r.midY,
            T.accent,
          );
      }
  }
  for (const y of x) {
    const C = H.get(y.fromConstraint),
      r = L.get(y.id);
    C &&
      r &&
      w(C.midX + Q.nodeW / 2, C.midY, r.midX - Q.nodeW / 2, r.midY, T.muted);
  }
  for (const y of g) {
    const C = L.get(y.id);
    if (C) {
      const r = v.find((n) => n.id === y.resolverId);
      r && w(C.midX + Q.nodeW / 2, C.midY, A[4], r.y, T.green);
    }
  }
  Ie.set(e.flowSvg, f);
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
  let s = 1 / 0,
    i = -1 / 0;
  for (const j of l)
    j.startMs < s && (s = j.startMs), j.endMs > i && (i = j.endMs);
  const o = performance.now();
  for (const j of t.inflight.values()) j < s && (s = j), o > i && (i = o);
  const u = i - s || 1,
    d = Oe - ve - 10,
    g = [],
    p = new Set();
  for (const j of l)
    p.has(j.resolver) || (p.add(j.resolver), g.push(j.resolver));
  for (const j of t.inflight.keys()) p.has(j) || (p.add(j), g.push(j));
  const c = g.slice(-12),
    $ = ye * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Oe} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const B = 5;
  for (let j = 0; j <= B; j++) {
    const D = ve + (d * j) / B,
      A = (u * j) / B,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(D)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", T.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", T.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        A < 1e3 ? `${A.toFixed(0)}ms` : `${(A / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "line");
    O.setAttribute("x1", String(D)),
      O.setAttribute("y1", "10"),
      O.setAttribute("x2", String(D)),
      O.setAttribute("y2", String($)),
      O.setAttribute("stroke", T.border),
      O.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(O);
  }
  for (let j = 0; j < c.length; j++) {
    const D = c[j],
      A = 12 + j * ye,
      k = j % it.length,
      O = it[k],
      N = document.createElementNS("http://www.w3.org/2000/svg", "text");
    N.setAttribute("x", String(ve - 4)),
      N.setAttribute("y", String(A + ye / 2 + 3)),
      N.setAttribute("fill", T.muted),
      N.setAttribute("font-size", "7"),
      N.setAttribute("font-family", T.font),
      N.setAttribute("text-anchor", "end"),
      (N.textContent = he(D, 12)),
      e.timelineSvg.appendChild(N);
    const _ = l.filter((x) => x.resolver === D);
    for (const x of _) {
      const v = ve + ((x.startMs - s) / u) * d,
        E = Math.max(((x.endMs - x.startMs) / u) * d, nt),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(A + 2)),
        R.setAttribute("width", String(E)),
        R.setAttribute("height", String(ye - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", x.error ? T.red : O),
        R.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = x.endMs - x.startMs;
      (z.textContent = `${D}: ${f.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        R.appendChild(z),
        e.timelineSvg.appendChild(R);
    }
    const m = t.inflight.get(D);
    if (m !== void 0) {
      const x = ve + ((m - s) / u) * d,
        v = Math.max(((o - m) / u) * d, nt),
        E = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      E.setAttribute("x", String(x)),
        E.setAttribute("y", String(A + 2)),
        E.setAttribute("width", String(v)),
        E.setAttribute("height", String(ye - 4)),
        E.setAttribute("rx", "2"),
        E.setAttribute("fill", O),
        E.setAttribute("opacity", "0.4"),
        E.setAttribute("stroke", O),
        E.setAttribute("stroke-width", "1"),
        E.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${D}: inflight ${(o - m).toFixed(0)}ms`),
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
        explain(l, s) {
          return this.getSystem(s)?.explain(l) ?? null;
        },
        subscribe(l, s) {
          const i = s ? e.get(s) : e.values().next().value;
          if (!i) {
            let o = !1,
              u = setInterval(() => {
                const g = s ? e.get(s) : e.values().next().value;
                g && !o && ((o = !0), g.subscribers.add(l));
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
          const s = l ? e.get(l) : e.values().next().value;
          return s
            ? JSON.stringify({
                version: 1,
                name: l ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: s.events.toArray(),
              })
            : null;
        },
        importSession(l, s) {
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
            const o = s ? e.get(s) : e.values().next().value;
            if (!o) return !1;
            const u = o.maxEvents,
              d = i.events,
              g = d.length > u ? d.length - u : 0;
            o.events.clear();
            for (let p = g; p < d.length; p++) {
              const c = d[p];
              c &&
                typeof c == "object" &&
                !Array.isArray(c) &&
                typeof c.timestamp == "number" &&
                typeof c.type == "string" &&
                c.type !== "__proto__" &&
                c.type !== "constructor" &&
                c.type !== "prototype" &&
                o.events.push({
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
          const s = l ? e.get(l) : e.values().next().value;
          s && s.events.clear();
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
function pr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: s,
      panel: i = !1,
      position: o = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    d = Jt(s),
    g = fr(),
    p = {
      system: null,
      events: new mt(d),
      maxEvents: d,
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
    $ = null,
    B = new Map(),
    j = new Map(),
    D = Yt(),
    A = Zt(),
    k = tr(),
    O = Xt(),
    N = i && typeof window < "u" && typeof document < "u" && Ne(),
    _ = null,
    m = 0,
    x = 1,
    v = 2,
    E = 4,
    R = 8,
    z = 16,
    f = 32,
    b = 64,
    w = 128,
    I = new Map(),
    W = new Set(),
    H = null;
  function L(n) {
    (m |= n),
      _ === null &&
        typeof requestAnimationFrame < "u" &&
        (_ = requestAnimationFrame(y));
  }
  function y() {
    if (((_ = null), !$ || !p.system)) {
      m = 0;
      return;
    }
    const n = $.refs,
      a = p.system,
      h = m;
    if (((m = 0), h & x)) {
      for (const S of W) ir(B, S);
      W.clear();
      for (const [S, { value: M, flash: P }] of I)
        Ce(B, n.factsBody, S, M, P, $.flashTimers);
      I.clear(), (n.factsCount.textContent = String(B.size));
    }
    if ((h & v && ot(n, j, a, $.flashTimers), h & R))
      if (H) Me(n, H.inflight.length, H.unmet.length);
      else {
        const S = Ee(a);
        S && Me(n, S.inflight.length, S.unmet.length);
      }
    if (h & E)
      if (H) De(n, H.inflight, H.unmet);
      else {
        const S = Ee(a);
        S && De(n, S.inflight, S.unmet);
      }
    h & z && or(n, D),
      h & f && at(n, a, A),
      h & b && lt(n, a),
      h & w && dr(n, O);
  }
  function C(n, a) {
    $ && l && sr($.refs, n, a, p.events.size);
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
        const a = p.system;
        $ = nr(t, o, u, l);
        const h = $.refs;
        try {
          const M = a.facts.$store.toObject();
          for (const [P, K] of Object.entries(M)) Ce(B, h.factsBody, P, K, !1);
          h.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        ot(h, j, a);
        const S = Ee(a);
        S &&
          (Me(h, S.inflight.length, S.unmet.length),
          De(h, S.inflight, S.unmet)),
          lt(h, a),
          lr(h, a),
          at(h, a, A),
          h.recordBtn.addEventListener("click", () => {
            if (
              ((k.isRecording = !k.isRecording),
              (h.recordBtn.textContent = k.isRecording ? "⏹ Stop" : "⏺ Record"),
              (h.recordBtn.style.color = k.isRecording ? T.red : T.text),
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
                  : p.events.toArray(),
              P = JSON.stringify(
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
              K = new Blob([P], { type: "application/json" }),
              q = URL.createObjectURL(K),
              J = document.createElement("a");
            (J.href = q),
              (J.download = `directive-session-${t}-${Date.now()}.json`),
              J.click(),
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
        _ !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(_), (_ = null)),
        A.animationTimer && clearTimeout(A.animationTimer),
        $ && ($.destroy(), ($ = null), B.clear(), j.clear());
    },
    onFactSet: (n, a, h) => {
      c("fact.set", { key: n, value: a, prev: h }),
        r("fact.set", { key: n, value: a, prev: h }),
        A.recentlyChangedFacts.add(n),
        $ &&
          p.system &&
          (I.set(n, { value: a, flash: !0 }),
          W.delete(n),
          L(x),
          C("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      c("fact.delete", { key: n, prev: a }),
        r("fact.delete", { key: n, prev: a }),
        $ && (W.add(n), I.delete(n), L(x), C("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        $ && p.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (W.add(a.key), I.delete(a.key))
            : (A.recentlyChangedFacts.add(a.key),
              I.set(a.key, { value: a.value, flash: !0 }),
              W.delete(a.key));
        L(x), C("facts.batch", { count: n.length });
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
        (D.lastReconcileStartMs = performance.now()),
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
        D.lastReconcileStartMs > 0)
      ) {
        const a = performance.now() - D.lastReconcileStartMs;
        D.reconcileCount++,
          (D.reconcileTotalMs += a),
          (D.lastReconcileStartMs = 0);
      }
      if (k.isRecording && p.system && k.snapshots.length < er)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        p.system &&
        ((H = n),
        ur(A),
        L(v | R | E | z | f | b),
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
        O.inflight.set(n, performance.now()),
        $ &&
          p.system &&
          (L(E | R | w),
          C("resolver.start", { resolver: n, requirementId: a.id }));
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
        D.resolverStats.size > st)
      ) {
        const P = D.resolverStats.keys().next().value;
        P !== void 0 && D.resolverStats.delete(P);
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
        $ &&
          p.system &&
          (L(E | R | z | w),
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
      const S = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, D.resolverStats.set(n, S), D.resolverStats.size > st)) {
        const P = D.resolverStats.keys().next().value;
        P !== void 0 && D.resolverStats.delete(P);
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
        $ &&
          p.system &&
          (L(E | R | z | w),
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
        O.inflight.delete(n),
        C("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        r("effect.run", { id: n }),
        D.effectRunCount++,
        C("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      c("effect.error", { id: n, error: String(a) }),
        D.effectErrorCount++,
        C("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        $ && p.system && L(b),
        C("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (c("timetravel.jump", { from: n, to: a }),
        r("timetravel.jump", { from: n, to: a }),
        $ && p.system)
      ) {
        const h = p.system;
        try {
          const S = h.facts.$store.toObject();
          B.clear(), $.refs.factsBody.replaceChildren();
          for (const [M, P] of Object.entries(S))
            Ce(B, $.refs.factsBody, M, P, !1);
          $.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        j.clear(),
          A.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (H = null),
          L(v | R | E | f | b),
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
var mr = "__agent",
  hr = "__approval",
  gr = "__conversation",
  yr = "__toolCalls",
  vr = "__breakpoints";
mr + "",
  te.object(),
  hr + "",
  te.object(),
  gr + "",
  te.array(),
  yr + "",
  te.array(),
  vr + "",
  te.object();
var ct = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);
function br() {
  const e = Date.now().toString(36),
    t = crypto.randomUUID().slice(0, 8);
  return `ckpt_${e}_${t}`;
}
function gt(e) {
  if (!e || typeof e != "object") return !1;
  for (const s of Object.keys(e)) if (ct.has(s)) return !1;
  const t = e;
  if (
    t.version !== 1 ||
    typeof t.id != "string" ||
    t.id.length === 0 ||
    typeof t.createdAt != "string" ||
    typeof t.systemExport != "string" ||
    (t.timelineExport !== null && typeof t.timelineExport != "string") ||
    !t.localState ||
    typeof t.localState != "object"
  )
    return !1;
  for (const s of Object.keys(t.localState)) if (ct.has(s)) return !1;
  const l = t.localState;
  return !(
    (l.type !== "single" && l.type !== "multi") ||
    (t.orchestratorType !== "single" && t.orchestratorType !== "multi")
  );
}
var wr = class {
  store = new Map();
  order = [];
  maxCheckpoints;
  retentionMs;
  preserveLabeled;
  constructor(e) {
    if (
      ((this.maxCheckpoints = e?.maxCheckpoints ?? 100),
      (this.retentionMs = e?.retentionMs ?? 1 / 0),
      (this.preserveLabeled = e?.preserveLabeled ?? !1),
      !Number.isFinite(this.maxCheckpoints) || this.maxCheckpoints < 1)
    )
      throw new Error(
        `[Directive Checkpoint] maxCheckpoints must be >= 1, got ${this.maxCheckpoints}`,
      );
  }
  async save(e) {
    if (!gt(e))
      throw new Error("[Directive Checkpoint] Invalid checkpoint data");
    while (this.order.length >= this.maxCheckpoints && this.evictOldest());
    const t = this.order.indexOf(e.id);
    return (
      t >= 0 && this.order.splice(t, 1),
      this.store.set(e.id, e),
      this.order.push(e.id),
      e.id
    );
  }
  async load(e) {
    return this.store.get(e) ?? null;
  }
  async list() {
    return this.order.map((e) => {
      const t = this.store.get(e);
      return { id: t.id, label: t.label, createdAt: t.createdAt };
    });
  }
  async delete(e) {
    if (!this.store.has(e)) return !1;
    this.store.delete(e);
    const t = this.order.indexOf(e);
    return t >= 0 && this.order.splice(t, 1), !0;
  }
  async clear() {
    this.store.clear(), (this.order.length = 0);
  }
  async prune() {
    if (!Number.isFinite(this.retentionMs)) return 0;
    let e = Date.now() - this.retentionMs,
      t = 0,
      l = [];
    for (const s of this.order) {
      const i = this.store.get(s);
      if (i) {
        if (new Date(i.createdAt).getTime() >= e) break;
        (this.preserveLabeled && i.label) || l.push(s);
      }
    }
    for (const s of l) {
      this.store.delete(s);
      const i = this.order.indexOf(s);
      i >= 0 && this.order.splice(i, 1), t++;
    }
    return t;
  }
  evictOldest() {
    if (this.preserveLabeled)
      for (let t = 0; t < this.order.length; t++) {
        const l = this.order[t],
          s = this.store.get(l);
        if (s && !s.label)
          return this.order.splice(t, 1), this.store.delete(l), !0;
      }
    const e = this.order.shift();
    return e ? (this.store.delete(e), !0) : !1;
  }
};
const le = ["extract", "summarize", "classify", "archive"],
  Sr = {
    extract: {
      tokens: 150,
      baseLatency: 300,
      output: "Extracted 3 sections, 2 tables, 5 figures from document.",
    },
    summarize: {
      tokens: 200,
      baseLatency: 400,
      output:
        "Summary: Key findings include efficiency gains of 23% and cost reduction of $1.2M annually.",
    },
    classify: {
      tokens: 80,
      baseLatency: 200,
      output:
        "Classification: category=research, confidence=0.94, tags=[efficiency, cost, annual-review]",
    },
    archive: {
      tokens: 50,
      baseLatency: 150,
      output: "Archived to /documents/2026/research/efficiency-report.json",
    },
  },
  fe = [];
function oe(e, t, l) {
  fe.unshift({ time: Date.now(), event: e, detail: t, type: l }),
    fe.length > 50 && (fe.length = 50);
}
const Ae = new wr({ maxCheckpoints: 20 }),
  Pe = {
    facts: {
      currentStage: te.string(),
      stageResults: te.object(),
      totalTokens: te.number(),
      retryCount: te.number(),
      maxRetries: te.number(),
      failStage: te.string(),
      isRunning: te.boolean(),
      lastError: te.string(),
      checkpoints: te.object(),
      selectedCheckpoint: te.string(),
    },
    derivations: {
      completionPercentage: te.number(),
      currentStageIndex: te.number(),
      canAdvance: te.boolean(),
      isPipelineDone: te.boolean(),
      stageCount: te.number(),
    },
    events: {
      setFailStage: { value: te.string() },
      setMaxRetries: { value: te.number() },
      selectCheckpoint: { id: te.string() },
      reset: {},
    },
    requirements: {},
  },
  xr = kt("pipeline", {
    schema: Pe,
    init: (e) => {
      (e.currentStage = "idle"),
        (e.stageResults = []),
        (e.totalTokens = 0),
        (e.retryCount = 0),
        (e.maxRetries = 2),
        (e.failStage = ""),
        (e.isRunning = !1),
        (e.lastError = ""),
        (e.checkpoints = []),
        (e.selectedCheckpoint = "");
    },
    derive: {
      completionPercentage: (e) => {
        if (e.currentStage === "idle") return 0;
        if (e.currentStage === "done") return 100;
        if (e.currentStage === "error") {
          const l = e.stageResults.length;
          return Math.round((l / le.length) * 100);
        }
        const t = le.indexOf(e.currentStage);
        return Math.round((t / le.length) * 100);
      },
      currentStageIndex: (e) =>
        e.currentStage === "idle"
          ? -1
          : e.currentStage === "done"
            ? le.length
            : le.indexOf(e.currentStage),
      canAdvance: (e) =>
        !e.isRunning && e.currentStage !== "done" && e.currentStage !== "error",
      isPipelineDone: (e) => e.currentStage === "done",
      stageCount: () => le.length,
    },
    events: {
      setFailStage: (e, { value: t }) => {
        e.failStage = t;
      },
      setMaxRetries: (e, { value: t }) => {
        e.maxRetries = t;
      },
      selectCheckpoint: (e, { id: t }) => {
        e.selectedCheckpoint = t;
      },
      reset: (e) => {
        (e.currentStage = "idle"),
          (e.stageResults = []),
          (e.totalTokens = 0),
          (e.retryCount = 0),
          (e.isRunning = !1),
          (e.lastError = ""),
          (e.selectedCheckpoint = ""),
          (fe.length = 0);
      },
    },
  }),
  F = Nt({ module: xr, plugins: [pr({ name: "ai-checkpoint" })] });
F.start();
async function $r(e) {
  const t = Sr[e];
  if (!t) throw new Error(`Unknown stage: ${e}`);
  const l = t.baseLatency + Math.random() * 100;
  if ((await new Promise((s) => setTimeout(s, l)), F.facts.failStage === e))
    throw new Error(`${e}: simulated failure`);
  return {
    stage: e,
    output: t.output,
    tokens: t.tokens + Math.floor(Math.random() * 30),
    durationMs: Math.round(l),
  };
}
async function yt(e) {
  const t = F.facts.maxRetries;
  let l = null;
  for (let s = 0; s <= t; s++)
    try {
      if (s > 0) {
        const i = Math.min(500 * Math.pow(2, s - 1), 4e3),
          o = Math.random() * i * 0.1;
        (F.facts.retryCount = F.facts.retryCount + 1),
          oe(
            "retry",
            `${e}: attempt ${s + 1}/${t + 1} (delay ${Math.round(i)}ms)`,
            "retry",
          ),
          Se(),
          await new Promise((u) => setTimeout(u, i + o));
      }
      return await $r(e);
    } catch (i) {
      (l = i instanceof Error ? i : new Error(String(i))),
        oe("error", `${e}: ${l.message}`, "error");
    }
  throw l;
}
async function Er() {
  if (F.facts.isRunning) return;
  const e = F.facts.currentStage;
  let t;
  if (e === "idle") t = le[0];
  else {
    if (e === "done" || e === "error") return;
    {
      const l = le.indexOf(e);
      l < 0 || l >= le.length - 1 ? (t = e) : (t = le[l + 1]);
    }
  }
  (F.facts.isRunning = !0),
    (F.facts.currentStage = t),
    oe("stage", `${t}: starting`, "stage"),
    Se();
  try {
    const l = await yt(t),
      s = [...F.facts.stageResults, l];
    (F.facts.stageResults = s),
      (F.facts.totalTokens = F.facts.totalTokens + l.tokens),
      oe("success", `${t}: complete (${l.tokens} tokens)`, "success"),
      le.indexOf(t) >= le.length - 1
        ? ((F.facts.currentStage = "done"),
          oe("info", "pipeline complete", "info"))
        : (F.facts.currentStage = t);
  } catch (l) {
    (F.facts.currentStage = "error"),
      (F.facts.lastError = l instanceof Error ? l.message : String(l)),
      oe("error", `pipeline halted: ${F.facts.lastError}`, "error");
  } finally {
    F.facts.isRunning = !1;
  }
}
async function Cr() {
  if (!F.facts.isRunning) {
    (F.facts.currentStage = "idle"),
      (F.facts.stageResults = []),
      (F.facts.totalTokens = 0),
      (F.facts.retryCount = 0),
      (F.facts.lastError = ""),
      oe("info", "auto-run started", "info");
    for (const e of le) {
      (F.facts.isRunning = !0),
        (F.facts.currentStage = e),
        oe("stage", `${e}: starting`, "stage"),
        Se();
      try {
        const t = await yt(e),
          l = [...F.facts.stageResults, t];
        (F.facts.stageResults = l),
          (F.facts.totalTokens = F.facts.totalTokens + t.tokens),
          oe("success", `${e}: complete (${t.tokens} tokens)`, "success");
      } catch (t) {
        (F.facts.currentStage = "error"),
          (F.facts.lastError = t instanceof Error ? t.message : String(t)),
          (F.facts.isRunning = !1),
          oe("error", `pipeline halted at ${e}: ${F.facts.lastError}`, "error");
        return;
      }
      F.facts.isRunning = !1;
    }
    (F.facts.currentStage = "done"),
      oe("info", "pipeline complete (auto-run)", "info");
  }
}
async function kr() {
  const e = F.facts.currentStage,
    t = br(),
    l = `Stage: ${e} (${new Date().toLocaleTimeString()})`,
    s = {
      version: 1,
      id: t,
      createdAt: new Date().toISOString(),
      label: l,
      systemExport: JSON.stringify({
        currentStage: F.facts.currentStage,
        stageResults: F.facts.stageResults,
        totalTokens: F.facts.totalTokens,
        retryCount: F.facts.retryCount,
        lastError: F.facts.lastError,
      }),
      timelineExport: JSON.stringify(fe.slice(0, 20)),
      localState: { type: "single" },
      memoryExport: null,
      orchestratorType: "single",
    };
  await Ae.save(s);
  const i = { id: t, label: l, createdAt: s.createdAt, stage: e };
  (F.facts.checkpoints = [...F.facts.checkpoints, i]),
    oe("checkpoint", `saved: ${l}`, "checkpoint");
}
async function Rr(e) {
  const t = await Ae.load(e);
  if (!t) {
    oe("error", "checkpoint not found", "error");
    return;
  }
  if (!gt(t)) {
    oe("error", "invalid checkpoint data", "error");
    return;
  }
  const l = JSON.parse(t.systemExport);
  if (
    ((F.facts.currentStage = l.currentStage),
    (F.facts.stageResults = l.stageResults),
    (F.facts.totalTokens = l.totalTokens),
    (F.facts.retryCount = l.retryCount),
    (F.facts.lastError = l.lastError),
    (F.facts.isRunning = !1),
    t.timelineExport)
  ) {
    const s = JSON.parse(t.timelineExport);
    fe.length = 0;
    for (const i of s) fe.push(i);
  }
  oe("checkpoint", `restored: ${t.label}`, "checkpoint");
}
async function Or(e) {
  if (await Ae.delete(e)) {
    const l = F.facts.checkpoints.filter((s) => s.id !== e);
    (F.facts.checkpoints = l),
      oe("checkpoint", "deleted checkpoint", "checkpoint");
  }
}
const Ar = document.getElementById("cp-progress-fill"),
  jr = document.getElementById("cp-progress-label"),
  Dr = document.querySelectorAll(".cp-stage-dot"),
  Fe = document.getElementById("cp-checkpoint-list"),
  Te = document.getElementById("cp-timeline");
function _e(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function Se() {
  const e = F.facts.currentStage,
    t = F.read("completionPercentage"),
    l = F.facts.stageResults;
  (Ar.style.width = `${t}%`),
    (jr.textContent =
      e === "done" ? "Complete" : e === "idle" ? "Ready" : `${e}... ${t}%`),
    Dr.forEach((i) => {
      const o = i.getAttribute("data-stage"),
        u = le.indexOf(o),
        d = le.indexOf(e),
        g = l.map((p) => p.stage);
      i.classList.remove("active", "complete", "error"),
        g.includes(o)
          ? i.classList.add("complete")
          : o === e && F.facts.isRunning
            ? i.classList.add("active")
            : e === "error" && u === d && i.classList.add("error");
    });
  const s = F.facts.checkpoints;
  if (
    (s.length === 0
      ? (Fe.innerHTML =
          '<div style="color:var(--brand-text-faint);font-size:0.65rem;font-style:italic">No checkpoints saved</div>')
      : (Fe.innerHTML = s
          .map((i) => {
            const u = new Date(i.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });
            return `<div class="cp-checkpoint-entry" data-testid="cp-ckpt-${i.id}">
        <div class="cp-checkpoint-info">
          <span class="cp-checkpoint-label">${_e(i.label)}</span>
          <span class="cp-checkpoint-time">${u}</span>
        </div>
        <div class="cp-checkpoint-actions">
          <button class="cp-btn-sm" data-restore="${i.id}">Restore</button>
          <button class="cp-btn-sm danger" data-delete="${i.id}">Del</button>
        </div>
      </div>`;
          })
          .join("")),
    fe.length === 0)
  )
    Te.innerHTML =
      '<div class="cp-timeline-empty">Events appear after running the pipeline</div>';
  else {
    Te.innerHTML = "";
    for (const i of fe) {
      const o = document.createElement("div");
      o.className = `cp-timeline-entry ${i.type}`;
      const d = new Date(i.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (o.innerHTML = `
        <span class="cp-timeline-time">${d}</span>
        <span class="cp-timeline-event">${_e(i.event)}</span>
        <span class="cp-timeline-detail">${_e(i.detail)}</span>
      `),
        Te.appendChild(o);
    }
  }
}
const Mr = [...Object.keys(Pe.facts), ...Object.keys(Pe.derivations)];
F.subscribe(Mr, Se);
document.getElementById("cp-advance").addEventListener("click", () => Er());
document.getElementById("cp-auto-run").addEventListener("click", () => Cr());
document.getElementById("cp-save-ckpt").addEventListener("click", () => kr());
document.getElementById("cp-reset").addEventListener("click", () => {
  F.events.reset(), Ae.clear(), (F.facts.checkpoints = []);
});
const ut = document.getElementById("cp-fail-stage");
ut.addEventListener("change", () => {
  F.events.setFailStage({ value: ut.value });
});
Fe.addEventListener("click", (e) => {
  const t = e.target,
    l = t.getAttribute("data-restore"),
    s = t.getAttribute("data-delete");
  l && Rr(l), s && Or(s);
});
const qe = document.getElementById("cp-max-retries");
qe.addEventListener("input", () => {
  (document.getElementById("cp-retry-val").textContent = qe.value),
    F.events.setMaxRetries({ value: Number(qe.value) });
});
Se();
document.body.setAttribute("data-ai-checkpoint-ready", "true");
