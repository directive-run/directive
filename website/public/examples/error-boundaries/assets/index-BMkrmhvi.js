(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const s of document.querySelectorAll('link[rel="modulepreload"]')) i(s);
  new MutationObserver((s) => {
    for (const o of s)
      if (o.type === "childList")
        for (const d of o.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && i(d);
  }).observe(document, { childList: !0, subtree: !0 });
  function l(s) {
    const o = {};
    return (
      s.integrity && (o.integrity = s.integrity),
      s.referrerPolicy && (o.referrerPolicy = s.referrerPolicy),
      s.crossOrigin === "use-credentials"
        ? (o.credentials = "include")
        : s.crossOrigin === "anonymous"
          ? (o.credentials = "omit")
          : (o.credentials = "same-origin"),
      o
    );
  }
  function i(s) {
    if (s.ep) return;
    s.ep = !0;
    const o = l(s);
    fetch(s.href, o);
  }
})();
var We = class extends Error {
    constructor(t, l, i, s, o = !0) {
      super(t),
        (this.source = l),
        (this.sourceId = i),
        (this.context = s),
        (this.recoverable = o),
        (this.name = "DirectiveError");
    }
  },
  he = [];
function St() {
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
var Et = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function $t() {
  return he[he.length - 1] ?? Et;
}
function xe(e) {
  const t = St();
  he.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    he.pop();
  }
}
function Ke(e) {
  const t = he.splice(0, he.length);
  try {
    return e();
  } finally {
    he.push(...t);
  }
}
function Be(e) {
  $t().track(e);
}
function Ct(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Re(e = [], t, l, i, s, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: i,
    _description: s,
    _refinements: o,
    validate(d) {
      return Re([...e, d], t, l, i, s, o);
    },
  };
}
function ee(e, t, l, i, s, o) {
  return {
    ...Re(e, t, l, i, s, o),
    default(d) {
      return ee(e, t, d, i, s, o);
    },
    transform(d) {
      return ee(
        [],
        t,
        void 0,
        (u) => {
          const h = i ? i(u) : u;
          return d(h);
        },
        s,
      );
    },
    brand() {
      return ee(e, `Branded<${t}>`, l, i, s, o);
    },
    describe(d) {
      return ee(e, t, l, i, d, o);
    },
    refine(d, u) {
      const h = [...(o ?? []), { predicate: d, message: u }];
      return ee([...e, d], t, l, i, s, h);
    },
    nullable() {
      return ee(
        [(d) => d === null || e.every((u) => u(d))],
        `${t} | null`,
        l,
        i,
        s,
      );
    },
    optional() {
      return ee(
        [(d) => d === void 0 || e.every((u) => u(d))],
        `${t} | undefined`,
        l,
        i,
        s,
      );
    },
  };
}
var re = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, l, i, s, o) => ({
      ...ee(t, "number", l, i, s, o),
      min(d) {
        return e([...t, (u) => u >= d], l, i, s, o);
      },
      max(d) {
        return e([...t, (u) => u <= d], l, i, s, o);
      },
      default(d) {
        return e(t, d, i, s, o);
      },
      describe(d) {
        return e(t, l, i, d, o);
      },
      refine(d, u) {
        const h = [...(o ?? []), { predicate: d, message: u }];
        return e([...t, d], l, i, s, h);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, i, s, o) => {
      const d = ee(t, "array", i, void 0, s),
        u = o ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(h) {
          u.value = h;
        },
        of(h) {
          const m = { value: -1 };
          return e(
            [
              ...t,
              (c) => {
                for (let $ = 0; $ < c.length; $++) {
                  const T = c[$];
                  if (!h._validators.every((O) => O(T)))
                    return (m.value = $), !1;
                }
                return !0;
              },
            ],
            h,
            i,
            s,
            m,
          );
        },
        nonEmpty() {
          return e([...t, (h) => h.length > 0], l, i, s, u);
        },
        maxLength(h) {
          return e([...t, (m) => m.length <= h], l, i, s, u);
        },
        minLength(h) {
          return e([...t, (m) => m.length >= h], l, i, s, u);
        },
        default(h) {
          return e(t, l, h, s, u);
        },
        describe(h) {
          return e(t, l, i, h, u);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, i) => ({
      ...ee(t, "object", l, void 0, i),
      shape(s) {
        return e(
          [
            ...t,
            (o) => {
              for (const [d, u] of Object.entries(s)) {
                const h = o[d],
                  m = u;
                if (m && !m._validators.every((c) => c(h))) return !1;
              }
              return !0;
            },
          ],
          l,
          i,
        );
      },
      nonNull() {
        return e([...t, (s) => s != null], l, i);
      },
      hasKeys(...s) {
        return e([...t, (o) => s.every((d) => d in o)], l, i);
      },
      default(s) {
        return e(t, s, i);
      },
      describe(s) {
        return e(t, l, s);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return ee(
      [(l) => typeof l == "string" && t.has(l)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return Re(
      [(l) => (l === null ? !0 : e._validators.every((i) => i(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Re(
      [(l) => (l === void 0 ? !0 : e._validators.every((i) => i(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return ee(
      [(l) => e.some((i) => i._validators.every((s) => s(l)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return ee(
      [
        (l) =>
          typeof l != "object" || l === null || Array.isArray(l)
            ? !1
            : Object.values(l).every((i) => e._validators.every((s) => s(i))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return ee(
      [
        (l) =>
          !Array.isArray(l) || l.length !== e.length
            ? !1
            : e.every((i, s) => i._validators.every((o) => o(l[s]))),
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
function xt(e) {
  const { schema: t, onChange: l, onBatch: i } = e;
  Object.keys(t).length;
  let s = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    u = new Map(),
    h = new Set(),
    m = new Map(),
    c = new Set(),
    $ = 0,
    T = [],
    O = new Set(),
    M = !1,
    C = [],
    w = 100;
  function D(f) {
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
  function I(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (D(f)) {
      const S = f._def;
      if (S?.typeName) return S.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function j(f) {
    return d ? "[redacted]" : Ct(f);
  }
  function p(f, b) {
    if (!s) return;
    const S = t[f];
    if (!S) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (D(S)) {
      const P = S.safeParse(b);
      if (!P.success) {
        const v = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          k = j(b),
          r =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          n = I(S);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${n}, got ${v} ${k}. ${r}`,
        );
      }
      return;
    }
    const B = S,
      N = B._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const W = B._typeName ?? "unknown";
    for (let P = 0; P < N.length; P++) {
      const v = N[P];
      if (typeof v == "function" && !v(b)) {
        let k = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          r = j(b),
          n = "";
        typeof B._lastFailedIndex == "number" &&
          B._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${B._lastFailedIndex} failed)`),
          (B._lastFailedIndex = -1));
        const a = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${W}, got ${k} ${r}${a}${n}`,
        );
      }
    }
  }
  function x(f) {
    m.get(f)?.forEach((b) => b());
  }
  function y() {
    c.forEach((f) => f());
  }
  function R(f, b, S) {
    if (M) {
      C.push({ key: f, value: b, prev: S });
      return;
    }
    M = !0;
    try {
      l?.(f, b, S), x(f), y();
      let B = 0;
      while (C.length > 0) {
        if (++B > w)
          throw (
            ((C.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${w} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...C];
        C.length = 0;
        for (const W of N) l?.(W.key, W.value, W.prev), x(W.key);
        y();
      }
    } finally {
      M = !1;
    }
  }
  function A() {
    if (!($ > 0)) {
      if ((i && T.length > 0 && i([...T]), O.size > 0)) {
        M = !0;
        try {
          for (const b of O) x(b);
          y();
          let f = 0;
          while (C.length > 0) {
            if (++f > w)
              throw (
                ((C.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${w} iterations.`,
                ))
              );
            const b = [...C];
            C.length = 0;
            for (const S of b) l?.(S.key, S.value, S.prev), x(S.key);
            y();
          }
        } finally {
          M = !1;
        }
      }
      (T.length = 0), O.clear();
    }
  }
  const L = {
    get(f) {
      return Be(f), u.get(f);
    },
    has(f) {
      return Be(f), u.has(f);
    },
    set(f, b) {
      p(f, b);
      const S = u.get(f);
      Object.is(S, b) ||
        (u.set(f, b),
        h.add(f),
        $ > 0
          ? (T.push({ key: f, value: b, prev: S, type: "set" }), O.add(f))
          : R(f, b, S));
    },
    delete(f) {
      const b = u.get(f);
      u.delete(f),
        h.delete(f),
        $ > 0
          ? (T.push({ key: f, value: void 0, prev: b, type: "delete" }),
            O.add(f))
          : R(f, void 0, b);
    },
    batch(f) {
      $++;
      try {
        f();
      } finally {
        $--, A();
      }
    },
    subscribe(f, b) {
      for (const S of f) {
        const B = S;
        m.has(B) || m.set(B, new Set()), m.get(B).add(b);
      }
      return () => {
        for (const S of f) {
          const B = m.get(S);
          B && (B.delete(b), B.size === 0 && m.delete(S));
        }
      };
    },
    subscribeAll(f) {
      return c.add(f), () => c.delete(f);
    },
    toObject() {
      const f = {};
      for (const b of h) u.has(b) && (f[b] = u.get(b));
      return f;
    },
  };
  return (
    (L.registerKeys = (f) => {
      for (const b of Object.keys(f)) be.has(b) || ((t[b] = f[b]), h.add(b));
    }),
    L
  );
}
var be = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Rt(e, t) {
  const l = () => ({
    get: (i) => Ke(() => e.get(i)),
    has: (i) => Ke(() => e.has(i)),
  });
  return new Proxy(
    {},
    {
      get(i, s) {
        if (s === "$store") return e;
        if (s === "$snapshot") return l;
        if (typeof s != "symbol" && !be.has(s)) return e.get(s);
      },
      set(i, s, o) {
        return typeof s == "symbol" ||
          s === "$store" ||
          s === "$snapshot" ||
          be.has(s)
          ? !1
          : (e.set(s, o), !0);
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" ||
          s === "$store" ||
          s === "$snapshot" ||
          be.has(s)
          ? !1
          : (e.delete(s), !0);
      },
      has(i, s) {
        return s === "$store" || s === "$snapshot"
          ? !0
          : typeof s == "symbol" || be.has(s)
            ? !1
            : e.has(s);
      },
      ownKeys() {
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(i, s) {
        return s === "$store" || s === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function kt(e) {
  const t = xt(e),
    l = Rt(t, e.schema);
  return { store: t, facts: l };
}
function Dt(e, t) {
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
    s = new Promise((o, d) => {
      i = setTimeout(() => d(new Error(l)), t);
    });
  try {
    return await Promise.race([e, s]);
  } finally {
    clearTimeout(i);
  }
}
function pt(e, t = 50) {
  const l = new WeakSet();
  function i(s, o) {
    if (o > t) return '"[max depth exceeded]"';
    if (s === null) return "null";
    if (s === void 0) return "undefined";
    const d = typeof s;
    if (d === "string") return JSON.stringify(s);
    if (d === "number" || d === "boolean") return String(s);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(s)) {
      if (l.has(s)) return '"[circular]"';
      l.add(s);
      const u = `[${s.map((h) => i(h, o + 1)).join(",")}]`;
      return l.delete(s), u;
    }
    if (d === "object") {
      const u = s;
      if (l.has(u)) return '"[circular]"';
      l.add(u);
      const h = `{${Object.keys(u)
        .sort()
        .map((m) => `${JSON.stringify(m)}:${i(u[m], o + 1)}`)
        .join(",")}}`;
      return l.delete(u), h;
    }
    return '"[unknown]"';
  }
  return i(e, 0);
}
function we(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    i = new WeakSet();
  function s(o, d) {
    if (d > t) return !1;
    if (o == null || typeof o != "object") return !0;
    const u = o;
    if (i.has(u)) return !0;
    if ((i.add(u), Array.isArray(u))) {
      for (const h of u) if (!s(h, d + 1)) return i.delete(u), !1;
      return i.delete(u), !0;
    }
    for (const h of Object.keys(u))
      if (l.has(h) || !s(u[h], d + 1)) return i.delete(u), !1;
    return i.delete(u), !0;
  }
  return s(e, 0);
}
function At(e) {
  let t = pt(e),
    l = 5381;
  for (let i = 0; i < t.length; i++) l = ((l << 5) + l) ^ t.charCodeAt(i);
  return (l >>> 0).toString(16);
}
function Ot(e, t) {
  if (t) return t(e);
  const { type: l, ...i } = e,
    s = pt(i);
  return `${l}:${s}`;
}
function Mt(e, t, l) {
  return { requirement: e, id: Ot(e, l), fromConstraint: t };
}
var Te = class ht {
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
        s = [];
      for (const o of this.map.values()) t.has(o.id) ? s.push(o) : l.push(o);
      for (const o of t.map.values()) this.map.has(o.id) || i.push(o);
      return { added: l, removed: i, unchanged: s };
    }
  },
  jt = 5e3;
function It(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: i = {},
      defaultTimeout: s = jt,
      onEvaluate: o,
      onError: d,
    } = e,
    u = new Map(),
    h = new Set(),
    m = new Set(),
    c = new Map(),
    $ = new Map(),
    T = new Set(),
    O = new Map(),
    M = new Map(),
    C = !1,
    w = new Set(),
    D = new Set(),
    I = new Map(),
    j = [],
    p = new Map();
  function x() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const a of n.after)
          t[a] && (I.has(a) || I.set(a, new Set()), I.get(a).add(r));
  }
  function y() {
    const r = new Set(),
      n = new Set(),
      a = [];
    function g(E, q) {
      if (r.has(E)) return;
      if (n.has(E)) {
        const H = q.indexOf(E),
          F = [...q.slice(H), E].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${F}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(E), q.push(E);
      const z = t[E];
      if (z?.after) for (const H of z.after) t[H] && g(H, q);
      q.pop(), n.delete(E), r.add(E), a.push(E);
    }
    for (const E of Object.keys(t)) g(E, []);
    (j = a), (p = new Map(j.map((E, q) => [E, q])));
  }
  y(), x();
  function R(r, n) {
    return n.async !== void 0 ? n.async : !!m.has(r);
  }
  function A(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const a = R(r, n);
    a && m.add(r);
    const g = {
      id: r,
      priority: n.priority ?? 0,
      isAsync: a,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return u.set(r, g), g;
  }
  function L(r) {
    return u.get(r) ?? A(r);
  }
  function f(r, n) {
    const a = c.get(r) ?? new Set();
    for (const g of a) {
      const E = $.get(g);
      E?.delete(r), E && E.size === 0 && $.delete(g);
    }
    for (const g of n) $.has(g) || $.set(g, new Set()), $.get(g).add(r);
    c.set(r, n);
  }
  function b(r) {
    const n = t[r];
    if (!n) return !1;
    const a = L(r);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let g;
      if (n.deps) (g = n.when(l)), O.set(r, new Set(n.deps));
      else {
        const E = xe(() => n.when(l));
        (g = E.value), O.set(r, E.deps);
      }
      return g instanceof Promise
        ? (m.add(r),
          (a.isAsync = !0),
          g
            .then(
              (E) => ((a.lastResult = E), (a.isEvaluating = !1), o?.(r, E), E),
            )
            .catch(
              (E) => (
                (a.error = E instanceof Error ? E : new Error(String(E))),
                (a.lastResult = !1),
                (a.isEvaluating = !1),
                d?.(r, E),
                !1
              ),
            ))
        : ((a.lastResult = g), (a.isEvaluating = !1), o?.(r, g), g);
    } catch (g) {
      return (
        (a.error = g instanceof Error ? g : new Error(String(g))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(r, g),
        !1
      );
    }
  }
  async function S(r) {
    const n = t[r];
    if (!n) return !1;
    const a = L(r),
      g = n.timeout ?? s;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const E = new Set(n.deps);
      f(r, E), O.set(r, E);
    }
    try {
      const E = n.when(l),
        q = await Ee(E, g, `Constraint "${r}" timed out after ${g}ms`);
      return (a.lastResult = q), (a.isEvaluating = !1), o?.(r, q), q;
    } catch (E) {
      return (
        (a.error = E instanceof Error ? E : new Error(String(E))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        d?.(r, E),
        !1
      );
    }
  }
  function B(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((g) => g != null) : [r];
  }
  function N(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: g, deps: E } = xe(() => a(l));
      return { requirements: B(g), deps: E };
    }
    return { requirements: B(a), deps: new Set() };
  }
  function W(r, n) {
    if (n.size === 0) return;
    const a = c.get(r) ?? new Set();
    for (const g of n)
      a.add(g), $.has(g) || $.set(g, new Set()), $.get(g).add(r);
    c.set(r, a);
  }
  let P = null;
  function v() {
    return (
      P ||
        (P = Object.keys(t).sort((r, n) => {
          const a = L(r),
            g = L(n).priority - a.priority;
          if (g !== 0) return g;
          const E = p.get(r) ?? 0,
            q = p.get(n) ?? 0;
          return E - q;
        })),
      P
    );
  }
  for (const r of Object.keys(t)) A(r);
  function k(r) {
    const n = u.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (t[a] && !h.has(a) && !D.has(a) && !w.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new Te();
      D.clear();
      let a = v().filter((F) => !h.has(F)),
        g;
      if (!C || !r || r.size === 0) (g = a), (C = !0);
      else {
        const F = new Set();
        for (const U of r) {
          const Y = $.get(U);
          if (Y) for (const te of Y) h.has(te) || F.add(te);
        }
        for (const U of T) h.has(U) || F.add(U);
        T.clear(), (g = [...F]);
        for (const U of a)
          if (!F.has(U)) {
            const Y = M.get(U);
            if (Y) for (const te of Y) n.add(te);
          }
      }
      function E(F, U) {
        if (h.has(F)) return;
        const Y = O.get(F);
        if (!U) {
          Y !== void 0 && f(F, Y), D.add(F), M.set(F, []);
          return;
        }
        D.delete(F);
        let te, Z;
        try {
          const X = N(F);
          (te = X.requirements), (Z = X.deps);
        } catch (X) {
          d?.(F, X), Y !== void 0 && f(F, Y), M.set(F, []);
          return;
        }
        if (Y !== void 0) {
          const X = new Set(Y);
          for (const V of Z) X.add(V);
          f(F, X);
        } else W(F, Z);
        if (te.length > 0) {
          const X = i[F],
            V = te.map((J) => Mt(J, F, X));
          for (const J of V) n.add(J);
          M.set(F, V);
        } else M.set(F, []);
      }
      async function q(F) {
        const U = [],
          Y = [];
        for (const V of F)
          if (k(V)) Y.push(V);
          else {
            U.push(V);
            const J = M.get(V);
            if (J) for (const G of J) n.add(G);
          }
        if (Y.length === 0) return U;
        const te = [],
          Z = [];
        for (const V of Y) L(V).isAsync ? Z.push(V) : te.push(V);
        const X = [];
        for (const V of te) {
          const J = b(V);
          if (J instanceof Promise) {
            X.push({ id: V, promise: J });
            continue;
          }
          E(V, J);
        }
        if (X.length > 0) {
          const V = await Promise.all(
            X.map(async ({ id: J, promise: G }) => ({
              id: J,
              active: await G,
            })),
          );
          for (const { id: J, active: G } of V) E(J, G);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async (J) => ({ id: J, active: await S(J) })),
          );
          for (const { id: J, active: G } of V) E(J, G);
        }
        return U;
      }
      let z = g,
        H = g.length + 1;
      while (z.length > 0 && H > 0) {
        const F = z.length;
        if (((z = await q(z)), z.length === F)) break;
        H--;
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
      h.add(r), (P = null), M.delete(r);
      const n = c.get(r);
      if (n) {
        for (const a of n) {
          const g = $.get(a);
          g && (g.delete(r), g.size === 0 && $.delete(a));
        }
        c.delete(r);
      }
      O.delete(r);
    },
    enable(r) {
      h.delete(r), (P = null), T.add(r);
    },
    invalidate(r) {
      const n = $.get(r);
      if (n) for (const a of n) T.add(a);
    },
    markResolved(r) {
      w.add(r);
      const n = u.get(r);
      n && (n.lastResolvedAt = Date.now());
      const a = I.get(r);
      if (a) for (const g of a) T.add(g);
    },
    isResolved(r) {
      return w.has(r);
    },
    registerDefinitions(r) {
      for (const [n, a] of Object.entries(r)) (t[n] = a), A(n), T.add(n);
      (P = null), y(), x();
    },
  };
}
function qt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: i,
      onInvalidate: s,
      onError: o,
    } = e,
    d = new Map(),
    u = new Map(),
    h = new Map(),
    m = new Map(),
    c = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    T = new Set(),
    O = !1,
    M = 100,
    C;
  function w(y) {
    if (!t[y]) throw new Error(`[Directive] Unknown derivation: ${y}`);
    const R = {
      id: y,
      compute: () => I(y),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(y, R), R;
  }
  function D(y) {
    return d.get(y) ?? w(y);
  }
  function I(y) {
    const R = D(y),
      A = t[y];
    if (!A) throw new Error(`[Directive] Unknown derivation: ${y}`);
    if (R.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${y}`,
      );
    R.isComputing = !0;
    try {
      const { value: L, deps: f } = xe(() => A(l, C));
      return (
        (R.cachedValue = L), (R.isStale = !1), j(y, f), i?.(y, L, [...f]), L
      );
    } catch (L) {
      throw (o?.(y, L), L);
    } finally {
      R.isComputing = !1;
    }
  }
  function j(y, R) {
    const A = D(y),
      L = A.dependencies;
    for (const f of L)
      if (d.has(f)) {
        const b = m.get(f);
        b?.delete(y), b && b.size === 0 && m.delete(f);
      } else {
        const b = h.get(f);
        b?.delete(y), b && b.size === 0 && h.delete(f);
      }
    for (const f of R)
      t[f]
        ? (m.has(f) || m.set(f, new Set()), m.get(f).add(y))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(y));
    A.dependencies = R;
  }
  function p() {
    if (!($ > 0 || O)) {
      O = !0;
      try {
        let y = 0;
        while (T.size > 0) {
          if (++y > M) {
            const A = [...T];
            throw (
              (T.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${M} iterations. Remaining: ${A.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const R = [...T];
          T.clear();
          for (const A of R) u.get(A)?.forEach((L) => L());
        }
      } finally {
        O = !1;
      }
    }
  }
  function x(y, R = new Set()) {
    if (R.has(y)) return;
    R.add(y);
    const A = d.get(y);
    if (!A || A.isStale) return;
    (A.isStale = !0), s?.(y), T.add(y);
    const L = m.get(y);
    if (L) for (const f of L) x(f, R);
  }
  return (
    (C = new Proxy(
      {},
      {
        get(y, R) {
          if (typeof R == "symbol" || c.has(R)) return;
          Be(R);
          const A = D(R);
          return A.isStale && I(R), A.cachedValue;
        },
      },
    )),
    {
      get(y) {
        const R = D(y);
        return R.isStale && I(y), R.cachedValue;
      },
      isStale(y) {
        return d.get(y)?.isStale ?? !0;
      },
      invalidate(y) {
        const R = h.get(y);
        if (R) {
          $++;
          try {
            for (const A of R) x(A);
          } finally {
            $--, p();
          }
        }
      },
      invalidateMany(y) {
        $++;
        try {
          for (const R of y) {
            const A = h.get(R);
            if (A) for (const L of A) x(L);
          }
        } finally {
          $--, p();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const y of d.values())
            y.isStale || ((y.isStale = !0), T.add(y.id));
        } finally {
          $--, p();
        }
      },
      subscribe(y, R) {
        for (const A of y) {
          const L = A;
          u.has(L) || u.set(L, new Set()), u.get(L).add(R);
        }
        return () => {
          for (const A of y) {
            const L = A,
              f = u.get(L);
            f?.delete(R), f && f.size === 0 && u.delete(L);
          }
        };
      },
      getProxy() {
        return C;
      },
      getDependencies(y) {
        return D(y).dependencies;
      },
      registerDefinitions(y) {
        for (const [R, A] of Object.entries(y)) (t[R] = A), w(R);
      },
    }
  );
}
function Bt(e) {
  let { definitions: t, facts: l, store: i, onRun: s, onError: o } = e,
    d = new Map(),
    u = null,
    h = !1;
  function m(w) {
    const D = t[w];
    if (!D) throw new Error(`[Directive] Unknown effect: ${w}`);
    const I = {
      id: w,
      enabled: !0,
      hasExplicitDeps: !!D.deps,
      dependencies: D.deps ? new Set(D.deps) : null,
      cleanup: null,
    };
    return d.set(w, I), I;
  }
  function c(w) {
    return d.get(w) ?? m(w);
  }
  function $() {
    return i.toObject();
  }
  function T(w, D) {
    const I = c(w);
    if (!I.enabled) return !1;
    if (I.dependencies) {
      for (const j of I.dependencies) if (D.has(j)) return !0;
      return !1;
    }
    return !0;
  }
  function O(w) {
    if (w.cleanup) {
      try {
        w.cleanup();
      } catch (D) {
        o?.(w.id, D),
          console.error(
            `[Directive] Effect "${w.id}" cleanup threw an error:`,
            D,
          );
      }
      w.cleanup = null;
    }
  }
  function M(w, D) {
    if (typeof D == "function")
      if (h)
        try {
          D();
        } catch (I) {
          o?.(w.id, I),
            console.error(
              `[Directive] Effect "${w.id}" cleanup threw an error:`,
              I,
            );
        }
      else w.cleanup = D;
  }
  async function C(w) {
    const D = c(w),
      I = t[w];
    if (!(!D.enabled || !I)) {
      O(D), s?.(w);
      try {
        if (D.hasExplicitDeps) {
          let j;
          if (
            (i.batch(() => {
              j = I.run(l, u);
            }),
            j instanceof Promise)
          ) {
            const p = await j;
            M(D, p);
          } else M(D, j);
        } else {
          let j = null,
            p,
            x = xe(
              () => (
                i.batch(() => {
                  p = I.run(l, u);
                }),
                p
              ),
            );
          j = x.deps;
          let y = x.value;
          y instanceof Promise && (y = await y),
            M(D, y),
            (D.dependencies = j.size > 0 ? j : null);
        }
      } catch (j) {
        o?.(w, j),
          console.error(`[Directive] Effect "${w}" threw an error:`, j);
      }
    }
  }
  for (const w of Object.keys(t)) m(w);
  return {
    async runEffects(w) {
      const D = [];
      for (const I of Object.keys(t)) T(I, w) && D.push(I);
      await Promise.all(D.map(C)), (u = $());
    },
    async runAll() {
      const w = Object.keys(t);
      await Promise.all(
        w.map((D) => (c(D).enabled ? C(D) : Promise.resolve())),
      ),
        (u = $());
    },
    disable(w) {
      const D = c(w);
      D.enabled = !1;
    },
    enable(w) {
      const D = c(w);
      D.enabled = !0;
    },
    isEnabled(w) {
      return c(w).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const w of d.values()) O(w);
    },
    registerDefinitions(w) {
      for (const [D, I] of Object.entries(w)) (t[D] = I), m(D);
    },
  };
}
function Tt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: i = 2,
      maxDelayMs: s = 3e4,
    } = e,
    o = new Map();
  function d(u) {
    const h = t * Math.pow(i, u - 1);
    return Math.min(h, s);
  }
  return {
    scheduleRetry(u, h, m, c, $) {
      if (c > l) return null;
      const T = d(c),
        O = {
          source: u,
          sourceId: h,
          context: m,
          attempt: c,
          nextRetryTime: Date.now() + T,
          callback: $,
        };
      return o.set(h, O), O;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const u = Date.now(),
        h = [];
      for (const [m, c] of o) c.nextRetryTime <= u && (h.push(c), o.delete(m));
      return h;
    },
    cancelRetry(u) {
      o.delete(u);
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
function Ft(e = {}) {
  const { config: t = {}, onError: l, onRecovery: i } = e,
    s = [],
    o = 100,
    d = Tt(t.retryLater),
    u = new Map();
  function h(c, $, T, O) {
    if (T instanceof We) return T;
    const M = T instanceof Error ? T.message : String(T),
      C = c !== "system";
    return new We(M, c, $, O, C);
  }
  function m(c, $, T) {
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
      } catch (M) {
        console.error("[Directive] Error in error handler callback:", M);
      }
      return "skip";
    }
    return typeof O == "string" ? O : _t[c];
  }
  return {
    handleError(c, $, T, O) {
      const M = h(c, $, T, O);
      s.push(M), s.length > o && s.shift();
      try {
        l?.(M);
      } catch (w) {
        console.error("[Directive] Error in onError callback:", w);
      }
      try {
        t.onError?.(M);
      } catch (w) {
        console.error("[Directive] Error in config.onError callback:", w);
      }
      let C = m(c, $, T instanceof Error ? T : new Error(String(T)));
      if (C === "retry-later") {
        const w = (u.get($) ?? 0) + 1;
        u.set($, w),
          d.scheduleRetry(c, $, O, w) ||
            ((C = "skip"), u.delete($), typeof process < "u");
      }
      try {
        i?.(M, C);
      } catch (w) {
        console.error("[Directive] Error in onRecovery callback:", w);
      }
      if (C === "throw") throw M;
      return C;
    },
    getLastError() {
      return s[s.length - 1] ?? null;
    },
    getAllErrors() {
      return [...s];
    },
    clearErrors() {
      s.length = 0;
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
      } catch (s) {
        console.error("[Directive] Plugin error:", s);
        return;
      }
  }
  async function l(i) {
    if (i)
      try {
        return await i();
      } catch (s) {
        console.error("[Directive] Plugin error:", s);
        return;
      }
  }
  return {
    register(i) {
      e.some((s) => s.name === i.name) &&
        (console.warn(
          `[Directive] Plugin "${i.name}" is already registered, replacing...`,
        ),
        this.unregister(i.name)),
        e.push(i);
    },
    unregister(i) {
      const s = e.findIndex((o) => o.name === i);
      s !== -1 && e.splice(s, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(i) {
      for (const s of e) await l(() => s.onInit?.(i));
    },
    emitStart(i) {
      for (const s of e) t(() => s.onStart?.(i));
    },
    emitStop(i) {
      for (const s of e) t(() => s.onStop?.(i));
    },
    emitDestroy(i) {
      for (const s of e) t(() => s.onDestroy?.(i));
    },
    emitFactSet(i, s, o) {
      for (const d of e) t(() => d.onFactSet?.(i, s, o));
    },
    emitFactDelete(i, s) {
      for (const o of e) t(() => o.onFactDelete?.(i, s));
    },
    emitFactsBatch(i) {
      for (const s of e) t(() => s.onFactsBatch?.(i));
    },
    emitDerivationCompute(i, s, o) {
      for (const d of e) t(() => d.onDerivationCompute?.(i, s, o));
    },
    emitDerivationInvalidate(i) {
      for (const s of e) t(() => s.onDerivationInvalidate?.(i));
    },
    emitReconcileStart(i) {
      for (const s of e) t(() => s.onReconcileStart?.(i));
    },
    emitReconcileEnd(i) {
      for (const s of e) t(() => s.onReconcileEnd?.(i));
    },
    emitConstraintEvaluate(i, s) {
      for (const o of e) t(() => o.onConstraintEvaluate?.(i, s));
    },
    emitConstraintError(i, s) {
      for (const o of e) t(() => o.onConstraintError?.(i, s));
    },
    emitRequirementCreated(i) {
      for (const s of e) t(() => s.onRequirementCreated?.(i));
    },
    emitRequirementMet(i, s) {
      for (const o of e) t(() => o.onRequirementMet?.(i, s));
    },
    emitRequirementCanceled(i) {
      for (const s of e) t(() => s.onRequirementCanceled?.(i));
    },
    emitResolverStart(i, s) {
      for (const o of e) t(() => o.onResolverStart?.(i, s));
    },
    emitResolverComplete(i, s, o) {
      for (const d of e) t(() => d.onResolverComplete?.(i, s, o));
    },
    emitResolverError(i, s, o) {
      for (const d of e) t(() => d.onResolverError?.(i, s, o));
    },
    emitResolverRetry(i, s, o) {
      for (const d of e) t(() => d.onResolverRetry?.(i, s, o));
    },
    emitResolverCancel(i, s) {
      for (const o of e) t(() => o.onResolverCancel?.(i, s));
    },
    emitEffectRun(i) {
      for (const s of e) t(() => s.onEffectRun?.(i));
    },
    emitEffectError(i, s) {
      for (const o of e) t(() => o.onEffectError?.(i, s));
    },
    emitSnapshot(i) {
      for (const s of e) t(() => s.onSnapshot?.(i));
    },
    emitTimeTravel(i, s) {
      for (const o of e) t(() => o.onTimeTravel?.(i, s));
    },
    emitError(i) {
      for (const s of e) t(() => s.onError?.(i));
    },
    emitErrorRecovery(i, s) {
      for (const o of e) t(() => o.onErrorRecovery?.(i, s));
    },
  };
}
var Ve = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Ue = { enabled: !1, windowMs: 50 };
function Je(e, t) {
  let { backoff: l, initialDelay: i = 100, maxDelay: s = 3e4 } = e,
    o;
  switch (l) {
    case "none":
      o = i;
      break;
    case "linear":
      o = i * t;
      break;
    case "exponential":
      o = i * Math.pow(2, t - 1);
      break;
    default:
      o = i;
  }
  return Math.max(1, Math.min(o, s));
}
function Pt(e) {
  const {
      definitions: t,
      facts: l,
      store: i,
      onStart: s,
      onComplete: o,
      onError: d,
      onRetry: u,
      onCancel: h,
      onResolutionComplete: m,
    } = e,
    c = new Map(),
    $ = new Map(),
    T = 1e3,
    O = new Map(),
    M = new Map(),
    C = 1e3;
  function w() {
    if ($.size > T) {
      const f = $.size - T,
        b = $.keys();
      for (let S = 0; S < f; S++) {
        const B = b.next().value;
        B && $.delete(B);
      }
    }
  }
  function D(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "string"
    );
  }
  function I(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function j(f, b) {
    return D(f) ? b.type === f.requirement : I(f) ? f.requirement(b) : !1;
  }
  function p(f) {
    const b = f.type,
      S = M.get(b);
    if (S)
      for (const B of S) {
        const N = t[B];
        if (N && j(N, f)) return B;
      }
    for (const [B, N] of Object.entries(t))
      if (j(N, f)) {
        if (!M.has(b)) {
          if (M.size >= C) {
            const P = M.keys().next().value;
            P !== void 0 && M.delete(P);
          }
          M.set(b, []);
        }
        const W = M.get(b);
        return W.includes(B) || W.push(B), B;
      }
    return null;
  }
  function x(f) {
    return { facts: l, signal: f, snapshot: () => l.$snapshot() };
  }
  async function y(f, b, S) {
    const B = t[f];
    if (!B) return;
    let N = { ...Ve, ...B.retry },
      W = null;
    for (let P = 1; P <= N.attempts; P++) {
      if (S.signal.aborted) return;
      const v = c.get(b.id);
      v &&
        ((v.attempt = P),
        (v.status = {
          state: "running",
          requirementId: b.id,
          startedAt: v.startedAt,
          attempt: P,
        }));
      try {
        const k = x(S.signal);
        if (B.resolve) {
          let n;
          i.batch(() => {
            n = B.resolve(b.requirement, k);
          });
          const a = B.timeout;
          a && a > 0
            ? await Ee(n, a, `Resolver "${f}" timed out after ${a}ms`)
            : await n;
        }
        const r = Date.now() - (v?.startedAt ?? Date.now());
        $.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: r,
        }),
          w(),
          o?.(f, b, r);
        return;
      } catch (k) {
        if (
          ((W = k instanceof Error ? k : new Error(String(k))),
          S.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(W, P)) break;
        if (P < N.attempts) {
          if (S.signal.aborted) return;
          const r = Je(N, P);
          if (
            (u?.(f, b, P + 1),
            await new Promise((n) => {
              const a = setTimeout(n, r),
                g = () => {
                  clearTimeout(a), n();
                };
              S.signal.addEventListener("abort", g, { once: !0 });
            }),
            S.signal.aborted)
          )
            return;
        }
      }
    }
    $.set(b.id, {
      state: "error",
      requirementId: b.id,
      error: W,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      w(),
      d?.(f, b, W);
  }
  async function R(f, b) {
    const S = t[f];
    if (!S) return;
    if (!S.resolveBatch && !S.resolveBatchWithResults) {
      await Promise.all(
        b.map((r) => {
          const n = new AbortController();
          return y(f, r, n);
        }),
      );
      return;
    }
    let B = { ...Ve, ...S.retry },
      N = { ...Ue, ...S.batch },
      W = new AbortController(),
      P = Date.now(),
      v = null,
      k = N.timeoutMs ?? S.timeout;
    for (let r = 1; r <= B.attempts; r++) {
      if (W.signal.aborted) return;
      try {
        const n = x(W.signal),
          a = b.map((g) => g.requirement);
        if (S.resolveBatchWithResults) {
          let g, E;
          if (
            (i.batch(() => {
              E = S.resolveBatchWithResults(a, n);
            }),
            k && k > 0
              ? (g = await Ee(
                  E,
                  k,
                  `Batch resolver "${f}" timed out after ${k}ms`,
                ))
              : (g = await E),
            g.length !== b.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${f}" returned ${g.length} results but expected ${b.length}. Results array must match input order.`,
            );
          let q = Date.now() - P,
            z = !1;
          for (let H = 0; H < b.length; H++) {
            const F = b[H],
              U = g[H];
            if (U.success)
              $.set(F.id, {
                state: "success",
                requirementId: F.id,
                completedAt: Date.now(),
                duration: q,
              }),
                o?.(f, F, q);
            else {
              z = !0;
              const Y = U.error ?? new Error("Batch item failed");
              $.set(F.id, {
                state: "error",
                requirementId: F.id,
                error: Y,
                failedAt: Date.now(),
                attempts: r,
              }),
                d?.(f, F, Y);
            }
          }
          if (!z || b.some((H, F) => g[F]?.success)) return;
        } else {
          let g;
          i.batch(() => {
            g = S.resolveBatch(a, n);
          }),
            k && k > 0
              ? await Ee(g, k, `Batch resolver "${f}" timed out after ${k}ms`)
              : await g;
          const E = Date.now() - P;
          for (const q of b)
            $.set(q.id, {
              state: "success",
              requirementId: q.id,
              completedAt: Date.now(),
              duration: E,
            }),
              o?.(f, q, E);
          return;
        }
      } catch (n) {
        if (
          ((v = n instanceof Error ? n : new Error(String(n))),
          W.signal.aborted)
        )
          return;
        if (B.shouldRetry && !B.shouldRetry(v, r)) break;
        if (r < B.attempts) {
          const a = Je(B, r);
          for (const g of b) u?.(f, g, r + 1);
          if (
            (await new Promise((g) => {
              const E = setTimeout(g, a),
                q = () => {
                  clearTimeout(E), g();
                };
              W.signal.addEventListener("abort", q, { once: !0 });
            }),
            W.signal.aborted)
          )
            return;
        }
      }
    }
    for (const r of b)
      $.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: v,
        failedAt: Date.now(),
        attempts: B.attempts,
      }),
        d?.(f, r, v);
    w();
  }
  function A(f, b) {
    const S = t[f];
    if (!S) return;
    const B = { ...Ue, ...S.batch };
    O.has(f) || O.set(f, { resolverId: f, requirements: [], timer: null });
    const N = O.get(f);
    N.requirements.push(b),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        L(f);
      }, B.windowMs));
  }
  function L(f) {
    const b = O.get(f);
    if (!b || b.requirements.length === 0) return;
    const S = [...b.requirements];
    (b.requirements = []),
      (b.timer = null),
      R(f, S).then(() => {
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
      const S = t[b];
      if (!S) return;
      if (S.batch?.enabled) {
        A(b, f);
        return;
      }
      const B = new AbortController(),
        N = Date.now(),
        W = {
          requirementId: f.id,
          resolverId: b,
          controller: B,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: N },
          originalRequirement: f,
        };
      c.set(f.id, W),
        s?.(b, f),
        y(b, f, B).finally(() => {
          c.delete(f.id) && m?.();
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
        w(),
        h?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of c) this.cancel(f);
      for (const f of O.values()) f.timer && clearTimeout(f.timer);
      O.clear();
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
      for (const f of O.keys()) L(f);
    },
    registerDefinitions(f) {
      for (const [b, S] of Object.entries(f)) t[b] = S;
      M.clear();
    },
  };
}
function zt(e) {
  let { config: t, facts: l, store: i, onSnapshot: s, onTimeTravel: o } = e,
    d = t.timeTravel ?? !1,
    u = t.maxSnapshots ?? 100,
    h = [],
    m = -1,
    c = 1,
    $ = !1,
    T = !1,
    O = [],
    M = null,
    C = -1;
  function w() {
    return i.toObject();
  }
  function D() {
    const j = w();
    return structuredClone(j);
  }
  function I(j) {
    if (!we(j)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    i.batch(() => {
      for (const [p, x] of Object.entries(j)) {
        if (p === "__proto__" || p === "constructor" || p === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${p}" during fact restoration`,
          );
          continue;
        }
        l[p] = x;
      }
    });
  }
  return {
    get isEnabled() {
      return d;
    },
    get isRestoring() {
      return T;
    },
    get isPaused() {
      return $;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return m;
    },
    takeSnapshot(j) {
      if (!d || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: j };
      const p = { id: c++, timestamp: Date.now(), facts: D(), trigger: j };
      for (
        m < h.length - 1 && h.splice(m + 1), h.push(p), m = h.length - 1;
        h.length > u;
      )
        h.shift(), m--;
      return s?.(p), p;
    },
    restore(j) {
      if (d) {
        ($ = !0), (T = !0);
        try {
          I(j.facts);
        } finally {
          ($ = !1), (T = !1);
        }
      }
    },
    goBack(j = 1) {
      if (!d || h.length === 0) return;
      let p = m,
        x = m,
        y = O.find((A) => m > A.startIndex && m <= A.endIndex);
      if (y) x = y.startIndex;
      else if (O.find((A) => m === A.startIndex)) {
        const A = O.find((L) => L.endIndex < m && m - L.endIndex <= j);
        x = A ? A.startIndex : Math.max(0, m - j);
      } else x = Math.max(0, m - j);
      if (p === x) return;
      m = x;
      const R = h[m];
      R && (this.restore(R), o?.(p, x));
    },
    goForward(j = 1) {
      if (!d || h.length === 0) return;
      let p = m,
        x = m,
        y = O.find((A) => m >= A.startIndex && m < A.endIndex);
      if ((y ? (x = y.endIndex) : (x = Math.min(h.length - 1, m + j)), p === x))
        return;
      m = x;
      const R = h[m];
      R && (this.restore(R), o?.(p, x));
    },
    goTo(j) {
      if (!d) return;
      const p = h.findIndex((R) => R.id === j);
      if (p === -1) {
        console.warn(`[Directive] Snapshot ${j} not found`);
        return;
      }
      const x = m;
      m = p;
      const y = h[m];
      y && (this.restore(y), o?.(x, p));
    },
    replay() {
      if (!d || h.length === 0) return;
      m = 0;
      const j = h[0];
      j && this.restore(j);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: m });
    },
    import(j) {
      if (d)
        try {
          const p = JSON.parse(j);
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
          for (const y of p.snapshots) {
            if (typeof y != "object" || y === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof y.id != "number" ||
              typeof y.timestamp != "number" ||
              typeof y.trigger != "string" ||
              typeof y.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!we(y.facts))
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
    beginChangeset(j) {
      d && ((M = j), (C = m));
    },
    endChangeset() {
      !d ||
        M === null ||
        (m > C && O.push({ label: M, startIndex: C, endIndex: m }),
        (M = null),
        (C = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function Nt() {
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
    s = Object.create(null),
    o = Object.create(null),
    d = Object.create(null);
  for (const r of e.modules) {
    const n = (a, g) => {
      if (a) {
        for (const E of Object.keys(a))
          if (ae.has(E))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${E}" in ${g}. This could indicate a prototype pollution attempt.`,
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
      r.effects && Object.assign(s, r.effects),
      r.constraints && Object.assign(o, r.constraints),
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
  let h = 0,
    m = !1,
    c = Lt();
  for (const r of e.plugins ?? []) c.register(r);
  let $ = Ft({
      config: e.errorBoundary,
      onError: (r) => c.emitError(r),
      onRecovery: (r, n) => c.emitErrorRecovery(r, n),
    }),
    T = () => {},
    O = () => {},
    M = null,
    { store: C, facts: w } = kt({
      schema: t,
      onChange: (r, n, a) => {
        c.emitFactSet(r, n, a),
          T(r),
          !M?.isRestoring && (h === 0 && (m = !0), S.changedKeys.add(r), B());
      },
      onBatch: (r) => {
        c.emitFactsBatch(r);
        const n = [];
        for (const a of r) n.push(a.key);
        if ((O(n), !M?.isRestoring)) {
          h === 0 && (m = !0);
          for (const a of r) S.changedKeys.add(a.key);
          B();
        }
      },
    }),
    D = qt({
      definitions: i,
      facts: w,
      onCompute: (r, n, a) => c.emitDerivationCompute(r, n, a),
      onInvalidate: (r) => c.emitDerivationInvalidate(r),
      onError: (r, n) => {
        $.handleError("derivation", r, n);
      },
    });
  (T = (r) => D.invalidate(r)), (O = (r) => D.invalidateMany(r));
  const I = Bt({
      definitions: s,
      facts: w,
      store: C,
      onRun: (r) => c.emitEffectRun(r),
      onError: (r, n) => {
        $.handleError("effect", r, n), c.emitEffectError(r, n);
      },
    }),
    j = It({
      definitions: o,
      facts: w,
      onEvaluate: (r, n) => c.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        $.handleError("constraint", r, n), c.emitConstraintError(r, n);
      },
    }),
    p = Pt({
      definitions: d,
      facts: w,
      store: C,
      onStart: (r, n) => c.emitResolverStart(r, n),
      onComplete: (r, n, a) => {
        c.emitResolverComplete(r, n, a),
          c.emitRequirementMet(n, r),
          j.markResolved(n.fromConstraint);
      },
      onError: (r, n, a) => {
        $.handleError("resolver", r, a, n), c.emitResolverError(r, n, a);
      },
      onRetry: (r, n, a) => c.emitResolverRetry(r, n, a),
      onCancel: (r, n) => {
        c.emitResolverCancel(r, n), c.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        L(), B();
      },
    }),
    x = new Set();
  function y() {
    for (const r of x) r();
  }
  const R = e.debug?.timeTravel
    ? zt({
        config: e.debug,
        facts: w,
        store: C,
        onSnapshot: (r) => {
          c.emitSnapshot(r), y();
        },
        onTimeTravel: (r, n) => {
          c.emitTimeTravel(r, n), y();
        },
      })
    : Nt();
  M = R;
  const A = new Set();
  function L() {
    for (const r of A) r();
  }
  let f = 50,
    b = 0,
    S = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Te(),
      readyPromise: null,
      readyResolve: null,
    };
  function B() {
    !S.isRunning ||
      S.reconcileScheduled ||
      S.isInitializing ||
      ((S.reconcileScheduled = !0),
      L(),
      queueMicrotask(() => {
        (S.reconcileScheduled = !1),
          S.isRunning && !S.isInitializing && N().catch((r) => {});
      }));
  }
  async function N() {
    if (!S.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (S.isReconciling = !0), L();
      try {
        S.changedKeys.size > 0 &&
          ((u === null || m) &&
            R.takeSnapshot(`facts-changed:${[...S.changedKeys].join(",")}`),
          (m = !1));
        const r = w.$snapshot();
        c.emitReconcileStart(r), await I.runEffects(S.changedKeys);
        const n = new Set(S.changedKeys);
        S.changedKeys.clear();
        const a = await j.evaluate(n),
          g = new Te();
        for (const F of a) g.add(F), c.emitRequirementCreated(F);
        const { added: E, removed: q } = g.diff(S.previousRequirements);
        for (const F of q) p.cancel(F.id);
        for (const F of E) p.resolve(F);
        S.previousRequirements = g;
        const z = p.getInflightInfo(),
          H = {
            unmet: a.filter((F) => !p.isResolving(F.id)),
            inflight: z,
            completed: [],
            canceled: q.map((F) => ({
              id: F.id,
              resolverId: z.find((U) => U.id === F.id)?.resolverId ?? "unknown",
            })),
          };
        c.emitReconcileEnd(H),
          S.isReady ||
            ((S.isReady = !0),
            S.readyResolve && (S.readyResolve(), (S.readyResolve = null)));
      } finally {
        (S.isReconciling = !1),
          S.changedKeys.size > 0 ? B() : S.reconcileScheduled || (b = 0),
          L();
      }
    }
  }
  const W = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ae.has(n)) return D.get(n);
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
              const g = l[n];
              if (g) {
                h++, (u === null || u.has(n)) && (m = !0);
                try {
                  C.batch(() => {
                    g(w, { type: n, ...a });
                  });
                } finally {
                  h--;
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
    v = {
      facts: w,
      debug: R.isEnabled ? R : null,
      derive: W,
      events: P,
      constraints: { disable: (r) => j.disable(r), enable: (r) => j.enable(r) },
      effects: {
        disable: (r) => I.disable(r),
        enable: (r) => I.enable(r),
        isEnabled: (r) => I.isEnabled(r),
      },
      initialize() {
        if (!S.isInitialized) {
          S.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              C.batch(() => {
                r.init(w);
              });
          e.onAfterModuleInit &&
            C.batch(() => {
              e.onAfterModuleInit();
            }),
            (S.isInitializing = !1),
            (S.isInitialized = !0);
          for (const r of Object.keys(i)) D.get(r);
        }
      },
      start() {
        if (!S.isRunning) {
          S.isInitialized || this.initialize(), (S.isRunning = !0);
          for (const r of e.modules) r.hooks?.onStart?.(v);
          c.emitStart(v), B();
        }
      },
      stop() {
        if (S.isRunning) {
          (S.isRunning = !1), p.cancelAll(), I.cleanupAll();
          for (const r of e.modules) r.hooks?.onStop?.(v);
          c.emitStop(v);
        }
      },
      destroy() {
        this.stop(),
          (S.isDestroyed = !0),
          A.clear(),
          x.clear(),
          c.emitDestroy(v);
      },
      dispatch(r) {
        if (ae.has(r.type)) return;
        const n = l[r.type];
        if (n) {
          h++, (u === null || u.has(r.type)) && (m = !0);
          try {
            C.batch(() => {
              n(w, r);
            });
          } finally {
            h--;
          }
        }
      },
      read(r) {
        return D.get(r);
      },
      subscribe(r, n) {
        const a = [],
          g = [];
        for (const q of r) q in i ? a.push(q) : q in t && g.push(q);
        const E = [];
        return (
          a.length > 0 && E.push(D.subscribe(a, n)),
          g.length > 0 && E.push(C.subscribe(g, n)),
          () => {
            for (const q of E) q();
          }
        );
      },
      watch(r, n, a) {
        const g = a?.equalityFn
          ? (q, z) => a.equalityFn(q, z)
          : (q, z) => Object.is(q, z);
        if (r in i) {
          let q = D.get(r);
          return D.subscribe([r], () => {
            const z = D.get(r);
            if (!g(z, q)) {
              const H = q;
              (q = z), n(z, H);
            }
          });
        }
        let E = C.get(r);
        return C.subscribe([r], () => {
          const q = C.get(r);
          if (!g(q, E)) {
            const z = E;
            (E = q), n(q, z);
          }
        });
      },
      when(r, n) {
        return new Promise((a, g) => {
          const E = C.toObject();
          if (r(E)) {
            a();
            return;
          }
          let q,
            z,
            H = () => {
              q?.(), z !== void 0 && clearTimeout(z);
            };
          (q = C.subscribeAll(() => {
            const F = C.toObject();
            r(F) && (H(), a());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (z = setTimeout(() => {
                H(),
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
          unmet: S.previousRequirements.all(),
          inflight: p.getInflightInfo(),
          constraints: j.getAllStates().map((r) => ({
            id: r.id,
            active: r.lastResult ?? !1,
            priority: r.priority,
          })),
          resolvers: Object.fromEntries(
            p.getInflight().map((r) => [r, p.getStatus(r)]),
          ),
        };
      },
      explain(r) {
        const n = S.previousRequirements.all().find((U) => U.id === r);
        if (!n) return null;
        const a = j.getState(n.fromConstraint),
          g = p.getStatus(r),
          E = {},
          q = C.toObject();
        for (const [U, Y] of Object.entries(q)) E[U] = Y;
        const z = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          H = Object.entries(n.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, Y]) => `${U}=${JSON.stringify(Y)}`)
            .join(", ");
        H && z.push(`├─ Requirement payload: { ${H} }`);
        const F = Object.entries(E).slice(0, 10);
        return (
          F.length > 0 &&
            (z.push("└─ Relevant facts:"),
            F.forEach(([U, Y], te) => {
              const Z = te === F.length - 1 ? "   └─" : "   ├─",
                X = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              z.push(
                `${Z} ${U} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          z.join(`
`)
        );
      },
      async settle(r = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const a = this.inspect();
          if (
            a.inflight.length === 0 &&
            !S.isReconciling &&
            !S.reconcileScheduled
          )
            return;
          if (Date.now() - n > r) {
            const g = [];
            a.inflight.length > 0 &&
              g.push(
                `${a.inflight.length} resolvers inflight: ${a.inflight.map((q) => q.resolverId).join(", ")}`,
              ),
              S.isReconciling && g.push("reconciliation in progress"),
              S.reconcileScheduled && g.push("reconcile scheduled");
            const E = S.previousRequirements.all();
            throw (
              (E.length > 0 &&
                g.push(
                  `${E.length} unmet requirements: ${E.map((q) => q.requirement.type).join(", ")}`,
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
        return { facts: C.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: a,
            includeFacts: g,
            ttlSeconds: E,
            metadata: q,
            includeVersion: z,
          } = r,
          H = {},
          F = Object.keys(i),
          U;
        if ((n ? (U = n.filter((Z) => F.includes(Z))) : (U = F), a)) {
          const Z = new Set(a);
          U = U.filter((X) => !Z.has(X));
        }
        for (const Z of U)
          try {
            H[Z] = D.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = C.toObject();
          for (const X of g) X in Z && (H[X] = Z[X]);
        }
        const Y = Date.now(),
          te = { data: H, createdAt: Y };
        return (
          E !== void 0 && E > 0 && (te.expiresAt = Y + E * 1e3),
          z && (te.version = At(H)),
          q && (te.metadata = q),
          te
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: a, excludeDerivations: g } = r,
          E = Object.keys(i),
          q;
        if ((a ? (q = a.filter((H) => E.includes(H))) : (q = E), g)) {
          const H = new Set(g);
          q = q.filter((F) => !H.has(F));
        }
        if (q.length === 0) return () => {};
        let z = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return D.subscribe(q, () => {
          const H = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          H.version !== z && ((z = H.version), n(H));
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
        C.batch(() => {
          for (const [n, a] of Object.entries(r.facts))
            ae.has(n) || C.set(n, a);
        });
      },
      onSettledChange(r) {
        return (
          A.add(r),
          () => {
            A.delete(r);
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
        C.batch(r);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !S.isReconciling &&
          !S.reconcileScheduled
        );
      },
      get isRunning() {
        return S.isRunning;
      },
      get isInitialized() {
        return S.isInitialized;
      },
      get isReady() {
        return S.isReady;
      },
      whenReady() {
        return S.isReady
          ? Promise.resolve()
          : S.isRunning
            ? (S.readyPromise ||
                (S.readyPromise = new Promise((r) => {
                  S.readyResolve = r;
                })),
              S.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function k(r) {
    if (S.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (S.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" on a destroyed system.`,
      );
    const n = (a, g) => {
      if (a) {
        for (const E of Object.keys(a))
          if (ae.has(E))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${E}" in ${g}.`,
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
      r.derive && (Object.assign(i, r.derive), D.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(s, r.effects), I.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(o, r.constraints), j.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(d, r.resolvers), p.registerDefinitions(r.resolvers)),
      C.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        C.batch(() => {
          r.init(w);
        }),
      r.hooks?.onInit?.(v),
      S.isRunning && (r.hooks?.onStart?.(v), B());
  }
  (v.registerModule = k), c.emitInit(v);
  for (const r of e.modules) r.hooks?.onInit?.(v);
  return v;
}
var ne = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  K = "::";
function Ht(e) {
  const t = Object.keys(e),
    l = new Set(),
    i = new Set(),
    s = [],
    o = [];
  function d(u) {
    if (l.has(u)) return;
    if (i.has(u)) {
      const m = o.indexOf(u),
        c = [...o.slice(m), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${c}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    i.add(u), o.push(u);
    const h = e[u];
    if (h?.crossModuleDeps)
      for (const m of Object.keys(h.crossModuleDeps)) t.includes(m) && d(m);
    o.pop(), i.delete(u), l.add(u), s.push(u);
  }
  for (const u of t) d(u);
  return s;
}
var Ye = new WeakMap(),
  Ge = new WeakMap(),
  Xe = new WeakMap(),
  Qe = new WeakMap();
function Wt(e) {
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
  let s,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const p = o,
      x = Object.keys(t).filter((y) => !p.includes(y));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    s = p;
  } else o === "declaration" ? (s = Object.keys(t)) : (s = Ht(t));
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
  for (const p of Object.keys(t)) {
    if (p.includes(K))
      throw new Error(
        `[Directive] Module name "${p}" contains the reserved separator "${K}". Module names cannot contain "${K}".`,
      );
    const x = t[p];
    if (x) {
      for (const y of Object.keys(x.schema.facts))
        if (y.includes(K))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${p}" contains the reserved separator "${K}". Schema keys cannot contain "${K}".`,
          );
    }
  }
  const h = [];
  for (const p of s) {
    const x = t[p];
    if (!x) continue;
    const y = x.crossModuleDeps && Object.keys(x.crossModuleDeps).length > 0,
      R = y ? Object.keys(x.crossModuleDeps) : [],
      A = {};
    for (const [v, k] of Object.entries(x.schema.facts)) A[`${p}${K}${v}`] = k;
    const L = {};
    if (x.schema.derivations)
      for (const [v, k] of Object.entries(x.schema.derivations))
        L[`${p}${K}${v}`] = k;
    const f = {};
    if (x.schema.events)
      for (const [v, k] of Object.entries(x.schema.events))
        f[`${p}${K}${v}`] = k;
    const b = x.init
        ? (v) => {
            const k = ie(v, p);
            x.init(k);
          }
        : void 0,
      S = {};
    if (x.derive)
      for (const [v, k] of Object.entries(x.derive))
        S[`${p}${K}${v}`] = (r, n) => {
          const a = y ? ce(r, p, R) : ie(r, p),
            g = _e(n, p);
          return k(a, g);
        };
    const B = {};
    if (x.events)
      for (const [v, k] of Object.entries(x.events))
        B[`${p}${K}${v}`] = (r, n) => {
          const a = ie(r, p);
          k(a, n);
        };
    const N = {};
    if (x.constraints)
      for (const [v, k] of Object.entries(x.constraints)) {
        const r = k;
        N[`${p}${K}${v}`] = {
          ...r,
          deps: r.deps?.map((n) => `${p}${K}${n}`),
          when: (n) => {
            const a = y ? ce(n, p, R) : ie(n, p);
            return r.when(a);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const a = y ? ce(n, p, R) : ie(n, p);
                  return r.require(a);
                }
              : r.require,
        };
      }
    const W = {};
    if (x.resolvers)
      for (const [v, k] of Object.entries(x.resolvers)) {
        const r = k;
        W[`${p}${K}${v}`] = {
          ...r,
          resolve: async (n, a) => {
            const g = De(a.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: g[p], signal: a.signal });
          },
        };
      }
    const P = {};
    if (x.effects)
      for (const [v, k] of Object.entries(x.effects)) {
        const r = k;
        P[`${p}${K}${v}`] = {
          ...r,
          run: (n, a) => {
            const g = y ? ce(n, p, R) : ie(n, p),
              E = a ? (y ? ce(a, p, R) : ie(a, p)) : void 0;
            return r.run(g, E);
          },
          deps: r.deps?.map((n) => `${p}${K}${n}`),
        };
      }
    h.push({
      id: x.id,
      schema: {
        facts: A,
        derivations: L,
        events: f,
        requirements: x.schema.requirements ?? {},
      },
      init: b,
      derive: S,
      events: B,
      effects: P,
      constraints: N,
      resolvers: W,
      hooks: x.hooks,
      snapshotEvents:
        i && !i.has(p) ? [] : x.snapshotEvents?.map((v) => `${p}${K}${v}`),
    });
  }
  let m = null,
    c = null;
  function $(p) {
    for (const [x, y] of Object.entries(p))
      if (!ne.has(x) && l.has(x)) {
        if (y && typeof y == "object" && !we(y))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [R, A] of Object.entries(y))
          ne.has(R) || (c.facts[`${x}${K}${R}`] = A);
      }
  }
  c = gt({
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
    debug: d,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), m && ($(m), (m = null));
    },
  });
  const T = new Map();
  for (const p of Object.keys(t)) {
    const x = t[p];
    if (!x) continue;
    const y = [];
    for (const R of Object.keys(x.schema.facts)) y.push(`${p}${K}${R}`);
    if (x.schema.derivations)
      for (const R of Object.keys(x.schema.derivations)) y.push(`${p}${K}${R}`);
    T.set(p, y);
  }
  const O = { names: null };
  function M() {
    return O.names === null && (O.names = Object.keys(t)), O.names;
  }
  let C = De(c.facts, t, M),
    w = Vt(c.derive, t, M),
    D = Ut(c, t, M),
    I = null,
    j = e.tickMs;
  return {
    _mode: "namespaced",
    facts: C,
    debug: c.debug,
    derive: w,
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
      if ((c.start(), j && j > 0)) {
        const p = Object.keys(h[0]?.events ?? {}).find((x) =>
          x.endsWith(`${K}tick`),
        );
        p &&
          (I = setInterval(() => {
            c.dispatch({ type: p });
          }, j));
      }
    },
    stop() {
      I && (clearInterval(I), (I = null)), c.stop();
    },
    destroy() {
      this.stop(), c.destroy();
    },
    dispatch(p) {
      c.dispatch(p);
    },
    batch: c.batch.bind(c),
    read(p) {
      return c.read(ue(p));
    },
    subscribe(p, x) {
      const y = [];
      for (const R of p)
        if (R.endsWith(".*")) {
          const A = R.slice(0, -2),
            L = T.get(A);
          L && y.push(...L);
        } else y.push(ue(R));
      return c.subscribe(y, x);
    },
    subscribeModule(p, x) {
      const y = T.get(p);
      return !y || y.length === 0 ? () => {} : c.subscribe(y, x);
    },
    watch(p, x, y) {
      return c.watch(ue(p), x, y);
    },
    when(p, x) {
      return c.when(() => p(C), x);
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
          includeDerivations: p?.includeDerivations?.map(ue),
          excludeDerivations: p?.excludeDerivations?.map(ue),
          includeFacts: p?.includeFacts?.map(ue),
        },
        y = c.getDistributableSnapshot(x),
        R = {};
      for (const [A, L] of Object.entries(y.data)) {
        const f = A.indexOf(K);
        if (f > 0) {
          const b = A.slice(0, f),
            S = A.slice(f + K.length);
          R[b] || (R[b] = {}), (R[b][S] = L);
        } else R._root || (R._root = {}), (R._root[A] = L);
      }
      return { ...y, data: R };
    },
    watchDistributableSnapshot(p, x) {
      const y = {
        ...p,
        includeDerivations: p?.includeDerivations?.map(ue),
        excludeDerivations: p?.excludeDerivations?.map(ue),
        includeFacts: p?.includeFacts?.map(ue),
      };
      return c.watchDistributableSnapshot(y, (R) => {
        const A = {};
        for (const [L, f] of Object.entries(R.data)) {
          const b = L.indexOf(K);
          if (b > 0) {
            const S = L.slice(0, b),
              B = L.slice(b + K.length);
            A[S] || (A[S] = {}), (A[S][B] = f);
          } else A._root || (A._root = {}), (A._root[L] = f);
        }
        x({ ...R, data: A });
      });
    },
    registerModule(p, x) {
      if (l.has(p))
        throw new Error(
          `[Directive] Module namespace "${p}" already exists. Cannot register a duplicate namespace.`,
        );
      if (p.includes(K))
        throw new Error(
          `[Directive] Module name "${p}" contains the reserved separator "${K}".`,
        );
      if (ne.has(p))
        throw new Error(
          `[Directive] Module name "${p}" is a blocked property.`,
        );
      for (const v of Object.keys(x.schema.facts))
        if (v.includes(K))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${p}" contains the reserved separator "${K}".`,
          );
      const y = x,
        R = y.crossModuleDeps && Object.keys(y.crossModuleDeps).length > 0,
        A = R ? Object.keys(y.crossModuleDeps) : [],
        L = {};
      for (const [v, k] of Object.entries(y.schema.facts))
        L[`${p}${K}${v}`] = k;
      const f = y.init
          ? (v) => {
              const k = ie(v, p);
              y.init(k);
            }
          : void 0,
        b = {};
      if (y.derive)
        for (const [v, k] of Object.entries(y.derive))
          b[`${p}${K}${v}`] = (r, n) => {
            const a = R ? ce(r, p, A) : ie(r, p),
              g = _e(n, p);
            return k(a, g);
          };
      const S = {};
      if (y.events)
        for (const [v, k] of Object.entries(y.events))
          S[`${p}${K}${v}`] = (r, n) => {
            const a = ie(r, p);
            k(a, n);
          };
      const B = {};
      if (y.constraints)
        for (const [v, k] of Object.entries(y.constraints)) {
          const r = k;
          B[`${p}${K}${v}`] = {
            ...r,
            deps: r.deps?.map((n) => `${p}${K}${n}`),
            when: (n) => {
              const a = R ? ce(n, p, A) : ie(n, p);
              return r.when(a);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const a = R ? ce(n, p, A) : ie(n, p);
                    return r.require(a);
                  }
                : r.require,
          };
        }
      const N = {};
      if (y.resolvers)
        for (const [v, k] of Object.entries(y.resolvers)) {
          const r = k;
          N[`${p}${K}${v}`] = {
            ...r,
            resolve: async (n, a) => {
              const g = De(a.facts, t, M);
              await r.resolve(n, { facts: g[p], signal: a.signal });
            },
          };
        }
      const W = {};
      if (y.effects)
        for (const [v, k] of Object.entries(y.effects)) {
          const r = k;
          W[`${p}${K}${v}`] = {
            ...r,
            run: (n, a) => {
              const g = R ? ce(n, p, A) : ie(n, p),
                E = a ? (R ? ce(a, p, A) : ie(a, p)) : void 0;
              return r.run(g, E);
            },
            deps: r.deps?.map((n) => `${p}${K}${n}`),
          };
        }
      l.add(p), (t[p] = y), (O.names = null);
      const P = [];
      for (const v of Object.keys(y.schema.facts)) P.push(`${p}${K}${v}`);
      if (y.schema.derivations)
        for (const v of Object.keys(y.schema.derivations))
          P.push(`${p}${K}${v}`);
      T.set(p, P),
        c.registerModule({
          id: y.id,
          schema: L,
          requirements: y.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(S).length > 0 ? S : void 0,
          effects: Object.keys(W).length > 0 ? W : void 0,
          constraints: Object.keys(B).length > 0 ? B : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: y.hooks,
          snapshotEvents:
            i && !i.has(p) ? [] : y.snapshotEvents?.map((v) => `${p}${K}${v}`),
        });
    },
  };
}
function ue(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${K}${l.join(K)}`;
  }
  return e;
}
function ie(e, t) {
  let l = Ye.get(e);
  if (l) {
    const s = l.get(t);
    if (s) return s;
  } else (l = new Map()), Ye.set(e, l);
  const i = new Proxy(
    {},
    {
      get(s, o) {
        if (typeof o != "symbol" && !ne.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${t}${K}${o}`];
      },
      set(s, o, d) {
        return typeof o == "symbol" || ne.has(o)
          ? !1
          : ((e[`${t}${K}${o}`] = d), !0);
      },
      has(s, o) {
        return typeof o == "symbol" || ne.has(o) ? !1 : `${t}${K}${o}` in e;
      },
      deleteProperty(s, o) {
        return typeof o == "symbol" || ne.has(o)
          ? !1
          : (delete e[`${t}${K}${o}`], !0);
      },
    },
  );
  return l.set(t, i), i;
}
function De(e, t, l) {
  const i = Ge.get(e);
  if (i) return i;
  const s = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(t, d))
          return ie(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(t, d);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(t, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ge.set(e, s), s;
}
var Ze = new WeakMap();
function ce(e, t, l) {
  let i = `${t}:${JSON.stringify([...l].sort())}`,
    s = Ze.get(e);
  if (s) {
    const h = s.get(i);
    if (h) return h;
  } else (s = new Map()), Ze.set(e, s);
  const o = new Set(l),
    d = ["self", ...l],
    u = new Proxy(
      {},
      {
        get(h, m) {
          if (typeof m != "symbol" && !ne.has(m)) {
            if (m === "self") return ie(e, t);
            if (o.has(m)) return ie(e, m);
          }
        },
        has(h, m) {
          return typeof m == "symbol" || ne.has(m)
            ? !1
            : m === "self" || o.has(m);
        },
        ownKeys() {
          return d;
        },
        getOwnPropertyDescriptor(h, m) {
          if (typeof m != "symbol" && (m === "self" || o.has(m)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return s.set(i, u), u;
}
function _e(e, t) {
  let l = Qe.get(e);
  if (l) {
    const s = l.get(t);
    if (s) return s;
  } else (l = new Map()), Qe.set(e, l);
  const i = new Proxy(
    {},
    {
      get(s, o) {
        if (typeof o != "symbol" && !ne.has(o)) return e[`${t}${K}${o}`];
      },
      has(s, o) {
        return typeof o == "symbol" || ne.has(o) ? !1 : `${t}${K}${o}` in e;
      },
    },
  );
  return l.set(t, i), i;
}
function Vt(e, t, l) {
  const i = Xe.get(e);
  if (i) return i;
  const s = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !ne.has(d) && Object.hasOwn(t, d))
          return _e(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || ne.has(d) ? !1 : Object.hasOwn(t, d);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(t, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Xe.set(e, s), s;
}
var et = new WeakMap();
function Ut(e, t, l) {
  let i = et.get(e);
  return (
    i || ((i = new Map()), et.set(e, i)),
    new Proxy(
      {},
      {
        get(s, o) {
          if (typeof o == "symbol" || ne.has(o) || !Object.hasOwn(t, o)) return;
          const d = i.get(o);
          if (d) return d;
          const u = new Proxy(
            {},
            {
              get(h, m) {
                if (typeof m != "symbol" && !ne.has(m))
                  return (c) => {
                    e.dispatch({ type: `${o}${K}${m}`, ...c });
                  };
              },
            },
          );
          return i.set(o, u), u;
        },
        has(s, o) {
          return typeof o == "symbol" || ne.has(o) ? !1 : Object.hasOwn(t, o);
        },
        ownKeys() {
          return l();
        },
        getOwnPropertyDescriptor(s, o) {
          if (typeof o != "symbol" && Object.hasOwn(t, o))
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
  if (e.initialFacts && !we(e.initialFacts))
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
  let s = null,
    o = null;
  o = gt({
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
        for (const [m, c] of Object.entries(e.initialFacts))
          ne.has(m) || (o.facts[m] = c);
      if (s) {
        for (const [m, c] of Object.entries(s)) ne.has(m) || (o.facts[m] = c);
        s = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(m, c) {
          if (typeof c != "symbol" && !ne.has(c))
            return ($) => {
              o.dispatch({ type: c, ...$ });
            };
        },
      },
    ),
    u = null,
    h = e.tickMs;
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
    async hydrate(m) {
      if (o.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const c = await m();
      c && typeof c == "object" && (s = c);
    },
    initialize() {
      o.initialize();
    },
    start() {
      o.start(),
        h &&
          h > 0 &&
          t.events &&
          "tick" in t.events &&
          (u = setInterval(() => {
            o.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      u && (clearInterval(u), (u = null)), o.stop();
    },
    destroy() {
      this.stop(), o.destroy();
    },
    dispatch(m) {
      o.dispatch(m);
    },
    batch: o.batch.bind(o),
    read(m) {
      return o.read(m);
    },
    subscribe(m, c) {
      return o.subscribe(m, c);
    },
    watch(m, c, $) {
      return o.watch(m, c, $);
    },
    when(m, c) {
      return o.when(m, c);
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
    registerModule(m) {
      o.registerModule({
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
function Le() {
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
function pe(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function $e(e) {
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
      ? (Le() &&
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
  ke = 340,
  ye = 16,
  ve = 80,
  tt = 2,
  rt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
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
  nt = 200,
  _ = {
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
function sr(e, t, l, i) {
  let s = !1,
    o = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${_.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${_.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const u = document.createElement("button");
  u.setAttribute("aria-label", "Open Directive DevTools"),
    u.setAttribute("aria-expanded", String(l)),
    (u.title = "Ctrl+Shift+D to toggle"),
    Object.assign(u.style, {
      ...o,
      background: _.bg,
      color: _.text,
      border: `1px solid ${_.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: _.font,
      fontSize: "12px",
      display: l ? "none" : "block",
    }),
    (u.textContent = "Directive");
  const h = document.createElement("div");
  h.setAttribute("role", "region"),
    h.setAttribute("aria-label", "Directive DevTools"),
    h.setAttribute("data-directive-devtools", ""),
    (h.tabIndex = -1),
    Object.assign(h.style, {
      ...o,
      background: _.bg,
      color: _.text,
      border: `1px solid ${_.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: _.font,
      fontSize: "11px",
      maxWidth: "min(380px, calc(100vw - 24px))",
      maxHeight: "min(500px, calc(100vh - 24px))",
      overflow: "auto",
      boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
      display: l ? "block" : "none",
    });
  const m = document.createElement("div");
  Object.assign(m.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const c = document.createElement("strong");
  (c.style.color = _.accent),
    (c.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
      background: "none",
      border: "none",
      color: _.closeBtn,
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
    m.appendChild(c),
    m.appendChild($),
    h.appendChild(m);
  const T = document.createElement("div");
  (T.style.marginBottom = "6px"), T.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = _.green),
    (O.textContent = "Settled"),
    T.appendChild(O),
    h.appendChild(T);
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
  const C = document.createElement("button");
  Object.assign(C.style, {
    background: "none",
    border: `1px solid ${_.border}`,
    color: _.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: _.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (C.textContent = "◀ Undo"),
    (C.disabled = !0);
  const w = document.createElement("button");
  Object.assign(w.style, {
    background: "none",
    border: `1px solid ${_.border}`,
    color: _.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: _.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (w.textContent = "Redo ▶"),
    (w.disabled = !0);
  const D = document.createElement("span");
  (D.style.color = _.muted),
    (D.style.fontSize = "10px"),
    M.appendChild(C),
    M.appendChild(w),
    M.appendChild(D),
    h.appendChild(M);
  function I(V, J) {
    const G = document.createElement("details");
    J && (G.open = !0), (G.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: _.accent,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(fe),
      oe.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const ze = document.createElement("thead"),
      Ne = document.createElement("tr");
    for (const wt of ["Key", "Value"]) {
      const Se = document.createElement("th");
      (Se.scope = "col"),
        Object.assign(Se.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: _.accent,
        }),
        (Se.textContent = wt),
        Ne.appendChild(Se);
    }
    ze.appendChild(Ne), de.appendChild(ze);
    const He = document.createElement("tbody");
    return (
      de.appendChild(He),
      G.appendChild(de),
      { details: G, tbody: He, countSpan: fe }
    );
  }
  function j(V, J) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const fe = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(fe),
      oe.appendChild(document.createTextNode(")")),
      (fe.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(de),
      { details: G, list: de, countSpan: fe }
    );
  }
  const p = I("Facts", !0);
  h.appendChild(p.details);
  const x = I("Derivations", !1);
  h.appendChild(x.details);
  const y = j("Inflight", _.yellow);
  h.appendChild(y.details);
  const R = j("Unmet", _.red);
  h.appendChild(R.details);
  const A = document.createElement("details");
  A.style.marginBottom = "4px";
  const L = document.createElement("summary");
  Object.assign(L.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (L.textContent = "Performance"),
    A.appendChild(L);
  const f = document.createElement("div");
  (f.style.fontSize = "10px"),
    (f.style.color = _.muted),
    (f.textContent = "No data yet"),
    A.appendChild(f),
    h.appendChild(A);
  const b = document.createElement("details");
  b.style.marginBottom = "4px";
  const S = document.createElement("summary");
  Object.assign(S.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (S.textContent = "Dependency Graph"),
    b.appendChild(S);
  const B = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  B.setAttribute("width", "100%"),
    B.setAttribute("height", "120"),
    B.setAttribute("role", "img"),
    B.setAttribute("aria-label", "System dependency graph"),
    (B.style.display = "block"),
    B.setAttribute("viewBox", "0 0 460 120"),
    B.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    b.appendChild(B),
    h.appendChild(b);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const W = document.createElement("summary");
  Object.assign(W.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (W.textContent = "Timeline"),
    N.appendChild(W);
  const P = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  P.setAttribute("width", "100%"),
    P.setAttribute("height", "60"),
    P.setAttribute("role", "img"),
    P.setAttribute("aria-label", "Resolver execution timeline"),
    (P.style.display = "block"),
    P.setAttribute("viewBox", `0 0 ${ke} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
  v.setAttribute("x", String(ke / 2)),
    v.setAttribute("y", "30"),
    v.setAttribute("text-anchor", "middle"),
    v.setAttribute("fill", _.muted),
    v.setAttribute("font-size", "10"),
    v.setAttribute("font-family", _.font),
    (v.textContent = "No resolver activity yet"),
    P.appendChild(v),
    N.appendChild(P),
    h.appendChild(N);
  let k, r, n, a;
  if (i) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
    const J = document.createElement("summary");
    Object.assign(J.style, {
      cursor: "pointer",
      color: _.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (J.textContent = "Events ("),
      J.appendChild(n),
      J.appendChild(document.createTextNode(")")),
      V.appendChild(J),
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
    (G.style.color = _.muted),
      (G.style.padding = "4px"),
      (G.textContent = "Waiting for events..."),
      (G.className = "dt-events-empty"),
      r.appendChild(G),
      V.appendChild(r),
      h.appendChild(V),
      (k = V),
      (a = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (a = document.createElement("div")),
      (a.style.fontSize = "10px"),
      (a.style.color = _.muted),
      (a.style.marginTop = "4px"),
      (a.style.fontStyle = "italic"),
      (a.textContent = "Enable trace: true for event log"),
      h.appendChild(a);
  const g = document.createElement("div");
  Object.assign(g.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const E = document.createElement("button");
  Object.assign(E.style, {
    background: "none",
    border: `1px solid ${_.border}`,
    color: _.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: _.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (E.textContent = "⏺ Record");
  const q = document.createElement("button");
  Object.assign(q.style, {
    background: "none",
    border: `1px solid ${_.border}`,
    color: _.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: _.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (q.textContent = "⤓ Export"),
    g.appendChild(E),
    g.appendChild(q),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (V) => {
        const J = h,
          G = J.scrollTop === 0 && V.deltaY < 0,
          oe = J.scrollTop + J.clientHeight >= J.scrollHeight && V.deltaY > 0;
        (G || oe) && V.preventDefault();
      },
      { passive: !1 },
    );
  let z = l,
    H = new Set();
  function F() {
    (z = !0),
      (h.style.display = "block"),
      (u.style.display = "none"),
      u.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function U() {
    (z = !1),
      (h.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", F), $.addEventListener("click", U);
  function Y(V) {
    V.key === "Escape" && z && U();
  }
  h.addEventListener("keydown", Y);
  function te(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), z ? U() : F());
  }
  document.addEventListener("keydown", te);
  function Z() {
    s || (document.body.appendChild(u), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function X() {
    (s = !0),
      u.removeEventListener("click", F),
      $.removeEventListener("click", U),
      h.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", te),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const V of H) clearTimeout(V);
    H.clear(), u.remove(), h.remove(), d.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: u,
      titleEl: c,
      statusEl: O,
      factsBody: p.tbody,
      factsCount: p.countSpan,
      derivBody: x.tbody,
      derivCount: x.countSpan,
      derivSection: x.details,
      inflightList: y.list,
      inflightSection: y.details,
      inflightCount: y.countSpan,
      unmetList: R.list,
      unmetSection: R.details,
      unmetCount: R.countSpan,
      perfSection: A,
      perfBody: f,
      timeTravelSection: M,
      timeTravelLabel: D,
      undoBtn: C,
      redoBtn: w,
      flowSection: b,
      flowSvg: B,
      timelineSection: N,
      timelineSvg: P,
      eventsSection: k,
      eventsList: r,
      eventsCount: n,
      traceHint: a,
      recordBtn: E,
      exportBtn: q,
    },
    destroy: X,
    isOpen: () => z,
    flashTimers: H,
  };
}
function Ce(e, t, l, i, s, o) {
  let d = vt(i),
    u = e.get(l);
  if (u) {
    const h = u.cells;
    if (h[1] && ((h[1].textContent = d), s && o)) {
      const m = h[1];
      m.style.background = "rgba(139, 154, 255, 0.25)";
      const c = setTimeout(() => {
        (m.style.background = ""), o.delete(c);
      }, 300);
      o.add(c);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${_.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: _.muted }),
      (h.textContent = l);
    const m = document.createElement("td");
    (m.style.padding = "2px 4px"),
      (m.textContent = d),
      u.appendChild(h),
      u.appendChild(m),
      t.appendChild(u),
      e.set(l, u);
  }
}
function or(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function Ae(e, t, l) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const i of t) {
      const s = document.createElement("li");
      (s.style.fontSize = "11px"),
        (s.textContent = `${i.resolverId} (${i.id})`),
        e.inflightList.appendChild(s);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = _.muted),
      (i.textContent = "None"),
      e.inflightList.appendChild(i);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(l.length)),
    l.length > 0)
  )
    for (const i of l) {
      const s = document.createElement("li");
      (s.style.fontSize = "11px"),
        (s.textContent = `${i.requirement.type} from ${i.fromConstraint}`),
        e.unmetList.appendChild(s);
    }
  else {
    const i = document.createElement("li");
    (i.style.fontSize = "10px"),
      (i.style.color = _.muted),
      (i.textContent = "None"),
      e.unmetList.appendChild(i);
  }
}
function Oe(e, t, l) {
  const i = t === 0 && l === 0;
  (e.statusEl.style.color = i ? _.green : _.yellow),
    (e.statusEl.textContent = i ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = i ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${i ? "" : " (system working)"}`,
    );
}
function it(e, t, l, i) {
  const s = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(s.length)), s.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = _.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      d.appendChild(u),
      e.derivBody.appendChild(d);
    return;
  }
  const o = new Set(s);
  for (const [d, u] of t) o.has(d) || (u.remove(), t.delete(d));
  for (const d of s) {
    let u;
    try {
      u = vt(l.read(d));
    } catch {
      u = "<error>";
    }
    Ce(t, e.derivBody, d, u, !0, i);
  }
}
function lr(e, t, l, i) {
  const s = e.eventsList.querySelector(".dt-events-empty");
  s && s.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${_.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    u = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const T = JSON.stringify(l);
    h = pe(T, 60);
  } catch {
    h = "{}";
  }
  const m = document.createElement("span");
  (m.style.color = _.closeBtn), (m.textContent = u);
  const c = document.createElement("span");
  (c.style.color = _.accent), (c.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = _.muted,
      $.textContent = h,
      o.appendChild(m),
      o.appendChild(c),
      o.appendChild($),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > ir;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(i);
}
function ar(e, t) {
  e.perfBody.replaceChildren();
  const l =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    i = [
      `Reconciles: ${t.reconcileCount}  (avg ${l}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const s of i) {
    const o = document.createElement("div");
    (o.style.marginBottom = "2px"),
      (o.textContent = s),
      e.perfBody.appendChild(o);
  }
  if (t.resolverStats.size > 0) {
    const s = document.createElement("div");
    (s.style.marginTop = "4px"),
      (s.style.marginBottom = "2px"),
      (s.style.color = _.accent),
      (s.textContent = "Resolvers:"),
      e.perfBody.appendChild(s);
    const o = [...t.resolverStats.entries()].sort(
      (d, u) => u[1].totalMs - d[1].totalMs,
    );
    for (const [d, u] of o) {
      const h = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        m = document.createElement("div");
      (m.style.paddingLeft = "8px"),
        (m.textContent = `${d}: ${u.count}x, avg ${h}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (m.style.color = _.red),
        e.perfBody.appendChild(m);
    }
  }
}
function st(e, t) {
  const l = t.debug;
  if (!l) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const i = l.currentIndex,
    s = l.snapshots.length;
  e.timeTravelLabel.textContent = s > 0 ? `${i + 1} / ${s}` : "0 snapshots";
  const o = i > 0,
    d = i < s - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function cr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Me = new WeakMap();
function ur(e, t, l, i, s, o) {
  return [
    e.join(","),
    t.join(","),
    l.map((d) => `${d.id}:${d.active}`).join(","),
    [...i.entries()].map(([d, u]) => `${d}:${u.status}:${u.type}`).join(","),
    s.join(","),
    o.join(","),
  ].join("|");
}
function dr(e, t, l, i, s) {
  for (const o of l) {
    const d = e.nodes.get(`0:${o}`);
    if (!d) continue;
    const u = t.recentlyChangedFacts.has(o);
    d.rect.setAttribute("fill", u ? _.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const o of i) {
    const d = e.nodes.get(`1:${o}`);
    if (!d) continue;
    const u = t.recentlyComputedDerivations.has(o);
    d.rect.setAttribute("fill", u ? _.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const o of s) {
    const d = e.nodes.get(`2:${o}`);
    if (!d) continue;
    const u = t.recentlyActiveConstraints.has(o),
      h = d.rect.getAttribute("stroke") ?? _.muted;
    d.rect.setAttribute("fill", u ? h + "33" : "none"),
      d.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function ot(e, t, l) {
  const i = $e(t);
  if (!i) return;
  let s;
  try {
    s = Object.keys(t.facts.$store.toObject());
  } catch {
    s = [];
  }
  const o = Object.keys(t.derive),
    d = i.constraints,
    u = i.unmet,
    h = i.inflight,
    m = Object.keys(i.resolvers),
    c = new Map();
  for (const v of u)
    c.set(v.id, {
      type: v.requirement.type,
      fromConstraint: v.fromConstraint,
      status: "unmet",
    });
  for (const v of h)
    c.set(v.id, { type: v.resolverId, fromConstraint: "", status: "inflight" });
  if (s.length === 0 && o.length === 0 && d.length === 0 && m.length === 0) {
    Me.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
    v.setAttribute("x", "230"),
      v.setAttribute("y", "24"),
      v.setAttribute("text-anchor", "middle"),
      v.setAttribute("fill", _.muted),
      v.setAttribute("font-size", "10"),
      v.setAttribute("font-family", _.font),
      (v.textContent = "No system topology"),
      e.flowSvg.appendChild(v);
    return;
  }
  const $ = h.map((v) => v.resolverId).sort(),
    T = ur(s, o, d, c, m, $),
    O = Me.get(e.flowSvg);
  if (O && O.fingerprint === T) {
    dr(
      O,
      l,
      s,
      o,
      d.map((v) => v.id),
    );
    return;
  }
  const M = Q.nodeW + Q.colGap,
    C = [5, 5 + M, 5 + M * 2, 5 + M * 3, 5 + M * 4],
    w = C[4] + Q.nodeW + 5;
  function D(v) {
    let k = Q.startY + 12;
    return v.map((r) => {
      const n = { ...r, y: k };
      return (k += Q.nodeH + Q.nodeGap), n;
    });
  }
  const I = D(s.map((v) => ({ id: v, label: pe(v, Q.labelMaxChars) }))),
    j = D(o.map((v) => ({ id: v, label: pe(v, Q.labelMaxChars) }))),
    p = D(
      d.map((v) => ({
        id: v.id,
        label: pe(v.id, Q.labelMaxChars),
        active: v.active,
        priority: v.priority,
      })),
    ),
    x = D(
      [...c.entries()].map(([v, k]) => ({
        id: v,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    y = D(m.map((v) => ({ id: v, label: pe(v, Q.labelMaxChars) }))),
    R = Math.max(I.length, j.length, p.length, x.length, y.length, 1),
    A = Q.startY + 12 + R * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${w} ${A}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${s.length} facts, ${o.length} derivations, ${d.length} constraints, ${c.size} requirements, ${m.length} resolvers`,
    );
  const L = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [v, k] of L.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(C[v] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", _.accent),
      r.setAttribute("font-size", String(Q.fontSize)),
      r.setAttribute("font-family", _.font),
      (r.textContent = k),
      e.flowSvg.appendChild(r);
  }
  const f = { fingerprint: T, nodes: new Map() };
  function b(v, k, r, n, a, g, E, q) {
    const z = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      H = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    H.setAttribute("x", String(k)),
      H.setAttribute("y", String(r - 6)),
      H.setAttribute("width", String(Q.nodeW)),
      H.setAttribute("height", String(Q.nodeH)),
      H.setAttribute("rx", "3"),
      H.setAttribute("fill", q ? g + "33" : "none"),
      H.setAttribute("stroke", g),
      H.setAttribute("stroke-width", q ? "2" : "1"),
      H.setAttribute("opacity", E ? "0.35" : "1"),
      z.appendChild(H);
    const F = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      F.setAttribute("x", String(k + 4)),
      F.setAttribute("y", String(r + 4)),
      F.setAttribute("fill", g),
      F.setAttribute("font-size", String(Q.fontSize)),
      F.setAttribute("font-family", _.font),
      F.setAttribute("opacity", E ? "0.35" : "1"),
      (F.textContent = a),
      z.appendChild(F),
      e.flowSvg.appendChild(z),
      f.nodes.set(`${v}:${n}`, { g: z, rect: H, text: F }),
      { midX: k + Q.nodeW / 2, midY: r }
    );
  }
  function S(v, k, r, n, a, g) {
    const E = document.createElementNS("http://www.w3.org/2000/svg", "line");
    E.setAttribute("x1", String(v)),
      E.setAttribute("y1", String(k)),
      E.setAttribute("x2", String(r)),
      E.setAttribute("y2", String(n)),
      E.setAttribute("stroke", a),
      E.setAttribute("stroke-width", "1"),
      E.setAttribute("stroke-dasharray", "3,2"),
      E.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(E);
  }
  const B = new Map(),
    N = new Map(),
    W = new Map(),
    P = new Map();
  for (const v of I) {
    const k = l.recentlyChangedFacts.has(v.id),
      r = b(0, C[0], v.y, v.id, v.label, _.text, !1, k);
    B.set(v.id, r);
  }
  for (const v of j) {
    const k = l.recentlyComputedDerivations.has(v.id),
      r = b(1, C[1], v.y, v.id, v.label, _.accent, !1, k);
    N.set(v.id, r);
  }
  for (const v of p) {
    const k = l.recentlyActiveConstraints.has(v.id),
      r = b(
        2,
        C[2],
        v.y,
        v.id,
        v.label,
        v.active ? _.yellow : _.muted,
        !v.active,
        k,
      );
    W.set(v.id, r);
  }
  for (const v of x) {
    const k = v.status === "unmet" ? _.red : _.yellow,
      r = b(3, C[3], v.y, v.id, pe(v.type, Q.labelMaxChars), k, !1, !1);
    P.set(v.id, r);
  }
  for (const v of y) {
    const k = h.some((r) => r.resolverId === v.id);
    b(4, C[4], v.y, v.id, v.label, k ? _.green : _.muted, !k, !1);
  }
  for (const v of j) {
    const k = l.derivationDeps.get(v.id),
      r = N.get(v.id);
    if (k && r)
      for (const n of k) {
        const a = B.get(n);
        a &&
          S(
            a.midX + Q.nodeW / 2,
            a.midY,
            r.midX - Q.nodeW / 2,
            r.midY,
            _.accent,
          );
      }
  }
  for (const v of x) {
    const k = W.get(v.fromConstraint),
      r = P.get(v.id);
    k &&
      r &&
      S(k.midX + Q.nodeW / 2, k.midY, r.midX - Q.nodeW / 2, r.midY, _.muted);
  }
  for (const v of h) {
    const k = P.get(v.id);
    if (k) {
      const r = y.find((n) => n.id === v.resolverId);
      r && S(k.midX + Q.nodeW / 2, k.midY, C[4], r.y, _.green);
    }
  }
  Me.set(e.flowSvg, f);
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
function mr(e, t) {
  const l = t.entries.toArray();
  if (l.length === 0) return;
  e.timelineSvg.replaceChildren();
  let i = 1 / 0,
    s = -1 / 0;
  for (const O of l)
    O.startMs < i && (i = O.startMs), O.endMs > s && (s = O.endMs);
  const o = performance.now();
  for (const O of t.inflight.values()) O < i && (i = O), o > s && (s = o);
  const d = s - i || 1,
    u = ke - ve - 10,
    h = [],
    m = new Set();
  for (const O of l)
    m.has(O.resolver) || (m.add(O.resolver), h.push(O.resolver));
  for (const O of t.inflight.keys()) m.has(O) || (m.add(O), h.push(O));
  const c = h.slice(-12),
    $ = ye * c.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${ke} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const T = 5;
  for (let O = 0; O <= T; O++) {
    const M = ve + (u * O) / T,
      C = (d * O) / T,
      w = document.createElementNS("http://www.w3.org/2000/svg", "text");
    w.setAttribute("x", String(M)),
      w.setAttribute("y", "8"),
      w.setAttribute("fill", _.muted),
      w.setAttribute("font-size", "6"),
      w.setAttribute("font-family", _.font),
      w.setAttribute("text-anchor", "middle"),
      (w.textContent =
        C < 1e3 ? `${C.toFixed(0)}ms` : `${(C / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(w);
    const D = document.createElementNS("http://www.w3.org/2000/svg", "line");
    D.setAttribute("x1", String(M)),
      D.setAttribute("y1", "10"),
      D.setAttribute("x2", String(M)),
      D.setAttribute("y2", String($)),
      D.setAttribute("stroke", _.border),
      D.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(D);
  }
  for (let O = 0; O < c.length; O++) {
    const M = c[O],
      C = 12 + O * ye,
      w = O % rt.length,
      D = rt[w],
      I = document.createElementNS("http://www.w3.org/2000/svg", "text");
    I.setAttribute("x", String(ve - 4)),
      I.setAttribute("y", String(C + ye / 2 + 3)),
      I.setAttribute("fill", _.muted),
      I.setAttribute("font-size", "7"),
      I.setAttribute("font-family", _.font),
      I.setAttribute("text-anchor", "end"),
      (I.textContent = pe(M, 12)),
      e.timelineSvg.appendChild(I);
    const j = l.filter((x) => x.resolver === M);
    for (const x of j) {
      const y = ve + ((x.startMs - i) / d) * u,
        R = Math.max(((x.endMs - x.startMs) / d) * u, tt),
        A = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      A.setAttribute("x", String(y)),
        A.setAttribute("y", String(C + 2)),
        A.setAttribute("width", String(R)),
        A.setAttribute("height", String(ye - 4)),
        A.setAttribute("rx", "2"),
        A.setAttribute("fill", x.error ? _.red : D),
        A.setAttribute("opacity", "0.8");
      const L = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = x.endMs - x.startMs;
      (L.textContent = `${M}: ${f.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        A.appendChild(L),
        e.timelineSvg.appendChild(A);
    }
    const p = t.inflight.get(M);
    if (p !== void 0) {
      const x = ve + ((p - i) / d) * u,
        y = Math.max(((o - p) / d) * u, tt),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(x)),
        R.setAttribute("y", String(C + 2)),
        R.setAttribute("width", String(y)),
        R.setAttribute("height", String(ye - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", D),
        R.setAttribute("opacity", "0.4"),
        R.setAttribute("stroke", D),
        R.setAttribute("stroke-width", "1"),
        R.setAttribute("stroke-dasharray", "3,2");
      const A = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (A.textContent = `${M}: inflight ${(o - p).toFixed(0)}ms`),
        R.appendChild(A),
        e.timelineSvg.appendChild(R);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${l.length} resolver executions across ${c.length} resolvers`,
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
          const s = i ? e.get(i) : e.values().next().value;
          if (!s) {
            let o = !1,
              d = setInterval(() => {
                const h = i ? e.get(i) : e.values().next().value;
                h && !o && ((o = !0), h.subscribers.add(l));
              }, 100),
              u = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(u);
              for (const h of e.values()) h.subscribers.delete(l);
            };
          }
          return (
            s.subscribers.add(l),
            () => {
              s.subscribers.delete(l);
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
            const s = JSON.parse(l);
            if (
              !s ||
              typeof s != "object" ||
              Array.isArray(s) ||
              !Array.isArray(s.events)
            )
              return !1;
            const o = i ? e.get(i) : e.values().next().value;
            if (!o) return !1;
            const d = o.maxEvents,
              u = s.events,
              h = u.length > d ? u.length - d : 0;
            o.events.clear();
            for (let m = h; m < u.length; m++) {
              const c = u[m];
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
          const i = l ? e.get(l) : e.values().next().value;
          i && i.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Le(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function hr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: i,
      panel: s = !1,
      position: o = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    u = Gt(i),
    h = pr(),
    m = {
      system: null,
      events: new yt(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  h.systems.set(t, m);
  let c = (n, a) => {
      const g = { timestamp: Date.now(), type: n, data: a };
      l && m.events.push(g);
      for (const E of m.subscribers)
        try {
          E(g);
        } catch {}
    },
    $ = null,
    T = new Map(),
    O = new Map(),
    M = Xt(),
    C = er(),
    w = nr(),
    D = Zt(),
    I = s && typeof window < "u" && typeof document < "u" && Le(),
    j = null,
    p = 0,
    x = 1,
    y = 2,
    R = 4,
    A = 8,
    L = 16,
    f = 32,
    b = 64,
    S = 128,
    B = new Map(),
    N = new Set(),
    W = null;
  function P(n) {
    (p |= n),
      j === null &&
        typeof requestAnimationFrame < "u" &&
        (j = requestAnimationFrame(v));
  }
  function v() {
    if (((j = null), !$ || !m.system)) {
      p = 0;
      return;
    }
    const n = $.refs,
      a = m.system,
      g = p;
    if (((p = 0), g & x)) {
      for (const E of N) or(T, E);
      N.clear();
      for (const [E, { value: q, flash: z }] of B)
        Ce(T, n.factsBody, E, q, z, $.flashTimers);
      B.clear(), (n.factsCount.textContent = String(T.size));
    }
    if ((g & y && it(n, O, a, $.flashTimers), g & A))
      if (W) Oe(n, W.inflight.length, W.unmet.length);
      else {
        const E = $e(a);
        E && Oe(n, E.inflight.length, E.unmet.length);
      }
    if (g & R)
      if (W) Ae(n, W.inflight, W.unmet);
      else {
        const E = $e(a);
        E && Ae(n, E.inflight, E.unmet);
      }
    g & L && ar(n, M),
      g & f && ot(n, a, C),
      g & b && st(n, a),
      g & S && mr(n, D);
  }
  function k(n, a) {
    $ && l && lr($.refs, n, a, m.events.size);
  }
  function r(n, a) {
    w.isRecording &&
      w.recordedEvents.length < tr &&
      w.recordedEvents.push({ timestamp: Date.now(), type: n, data: Yt(a) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((m.system = n),
        c("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        I)
      ) {
        const a = m.system;
        $ = sr(t, o, d, l);
        const g = $.refs;
        try {
          const q = a.facts.$store.toObject();
          for (const [z, H] of Object.entries(q)) Ce(T, g.factsBody, z, H, !1);
          g.factsCount.textContent = String(Object.keys(q).length);
        } catch {}
        it(g, O, a);
        const E = $e(a);
        E &&
          (Oe(g, E.inflight.length, E.unmet.length),
          Ae(g, E.inflight, E.unmet)),
          st(g, a),
          cr(g, a),
          ot(g, a, C),
          g.recordBtn.addEventListener("click", () => {
            if (
              ((w.isRecording = !w.isRecording),
              (g.recordBtn.textContent = w.isRecording ? "⏹ Stop" : "⏺ Record"),
              (g.recordBtn.style.color = w.isRecording ? _.red : _.text),
              w.isRecording)
            ) {
              (w.recordedEvents = []), (w.snapshots = []);
              try {
                w.snapshots.push({
                  timestamp: Date.now(),
                  facts: a.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          g.exportBtn.addEventListener("click", () => {
            const q =
                w.recordedEvents.length > 0
                  ? w.recordedEvents
                  : m.events.toArray(),
              z = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: q,
                  snapshots: w.snapshots,
                },
                null,
                2,
              ),
              H = new Blob([z], { type: "application/json" }),
              F = URL.createObjectURL(H),
              U = document.createElement("a");
            (U.href = F),
              (U.download = `directive-session-${t}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(F);
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
        h.systems.delete(t),
        j !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(j), (j = null)),
        C.animationTimer && clearTimeout(C.animationTimer),
        $ && ($.destroy(), ($ = null), T.clear(), O.clear());
    },
    onFactSet: (n, a, g) => {
      c("fact.set", { key: n, value: a, prev: g }),
        r("fact.set", { key: n, value: a, prev: g }),
        C.recentlyChangedFacts.add(n),
        $ &&
          m.system &&
          (B.set(n, { value: a, flash: !0 }),
          N.delete(n),
          P(x),
          k("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      c("fact.delete", { key: n, prev: a }),
        r("fact.delete", { key: n, prev: a }),
        $ && (N.add(n), B.delete(n), P(x), k("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (c("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        $ && m.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (N.add(a.key), B.delete(a.key))
            : (C.recentlyChangedFacts.add(a.key),
              B.set(a.key, { value: a.value, flash: !0 }),
              N.delete(a.key));
        P(x), k("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, a, g) => {
      c("derivation.compute", { id: n, value: a, deps: g }),
        r("derivation.compute", { id: n, deps: g }),
        C.derivationDeps.set(n, g),
        C.recentlyComputedDerivations.add(n),
        k("derivation.compute", { id: n, deps: g });
    },
    onDerivationInvalidate: (n) => {
      c("derivation.invalidate", { id: n }),
        k("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      c("reconcile.start", {}),
        (M.lastReconcileStartMs = performance.now()),
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
        M.lastReconcileStartMs > 0)
      ) {
        const a = performance.now() - M.lastReconcileStartMs;
        M.reconcileCount++,
          (M.reconcileTotalMs += a),
          (M.lastReconcileStartMs = 0);
      }
      if (w.isRecording && m.system && w.snapshots.length < rr)
        try {
          w.snapshots.push({
            timestamp: Date.now(),
            facts: m.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        m.system &&
        ((W = n),
        fr(C),
        P(y | A | R | L | f | b),
        k("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, a) => {
      c("constraint.evaluate", { id: n, active: a }),
        r("constraint.evaluate", { id: n, active: a }),
        a
          ? (C.activeConstraints.add(n), C.recentlyActiveConstraints.add(n))
          : C.activeConstraints.delete(n),
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
        D.inflight.set(n, performance.now()),
        $ &&
          m.system &&
          (P(R | A | S),
          k("resolver.start", { resolver: n, requirementId: a.id }));
    },
    onResolverComplete: (n, a, g) => {
      c("resolver.complete", { resolver: n, requirementId: a.id, duration: g }),
        r("resolver.complete", {
          resolver: n,
          requirementId: a.id,
          duration: g,
        });
      const E = M.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (E.count++,
        (E.totalMs += g),
        M.resolverStats.set(n, E),
        M.resolverStats.size > nt)
      ) {
        const z = M.resolverStats.keys().next().value;
        z !== void 0 && M.resolverStats.delete(z);
      }
      const q = D.inflight.get(n);
      D.inflight.delete(n),
        q !== void 0 &&
          D.entries.push({
            resolver: n,
            startMs: q,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          m.system &&
          (P(R | A | L | S),
          k("resolver.complete", { resolver: n, duration: g }));
    },
    onResolverError: (n, a, g) => {
      c("resolver.error", {
        resolver: n,
        requirementId: a.id,
        error: String(g),
      }),
        r("resolver.error", {
          resolver: n,
          requirementId: a.id,
          error: String(g),
        });
      const E = M.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((E.errors++, M.resolverStats.set(n, E), M.resolverStats.size > nt)) {
        const z = M.resolverStats.keys().next().value;
        z !== void 0 && M.resolverStats.delete(z);
      }
      const q = D.inflight.get(n);
      D.inflight.delete(n),
        q !== void 0 &&
          D.entries.push({
            resolver: n,
            startMs: q,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          m.system &&
          (P(R | A | L | S),
          k("resolver.error", { resolver: n, error: String(g) }));
    },
    onResolverRetry: (n, a, g) => {
      c("resolver.retry", { resolver: n, requirementId: a.id, attempt: g }),
        r("resolver.retry", { resolver: n, requirementId: a.id, attempt: g }),
        k("resolver.retry", { resolver: n, attempt: g });
    },
    onResolverCancel: (n, a) => {
      c("resolver.cancel", { resolver: n, requirementId: a.id }),
        r("resolver.cancel", { resolver: n, requirementId: a.id }),
        D.inflight.delete(n),
        k("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      c("effect.run", { id: n }),
        r("effect.run", { id: n }),
        M.effectRunCount++,
        k("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      c("effect.error", { id: n, error: String(a) }),
        M.effectErrorCount++,
        k("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      c("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        $ && m.system && P(b),
        k("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (c("timetravel.jump", { from: n, to: a }),
        r("timetravel.jump", { from: n, to: a }),
        $ && m.system)
      ) {
        const g = m.system;
        try {
          const E = g.facts.$store.toObject();
          T.clear(), $.refs.factsBody.replaceChildren();
          for (const [q, z] of Object.entries(E))
            Ce(T, $.refs.factsBody, q, z, !1);
          $.refs.factsCount.textContent = String(Object.keys(E).length);
        } catch {}
        O.clear(),
          C.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (W = null),
          P(y | A | R | f | b),
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
function gr(e = {}) {
  let {
      onSlowConstraint: t,
      onSlowResolver: l,
      slowConstraintThresholdMs: i = 16,
      slowResolverThresholdMs: s = 1e3,
    } = e,
    o = new Map(),
    d = new Map(),
    u = new Map(),
    h = { runs: 0, totalDurationMs: 0, avgDurationMs: 0, maxDurationMs: 0 },
    m = 0,
    c = 0,
    $ = 0;
  function T(C) {
    let w = o.get(C);
    return (
      w ||
        ((w = {
          evaluations: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
          maxDurationMs: 0,
          lastEvaluatedAt: 0,
        }),
        o.set(C, w)),
      w
    );
  }
  function O(C) {
    let w = d.get(C);
    return (
      w ||
        ((w = {
          starts: 0,
          completions: 0,
          errors: 0,
          retries: 0,
          cancellations: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
          maxDurationMs: 0,
          lastCompletedAt: 0,
        }),
        d.set(C, w)),
      w
    );
  }
  function M(C) {
    let w = u.get(C);
    return w || ((w = { runs: 0, errors: 0, lastRunAt: 0 }), u.set(C, w)), w;
  }
  return {
    name: "performance",
    onStart() {
      m = Date.now();
    },
    onConstraintEvaluate(C, w) {
      const D = performance.now(),
        I = T(C);
      if ((I.evaluations++, (I.lastEvaluatedAt = Date.now()), $ > 0)) {
        const j = D - $;
        I.totalDurationMs += j;
        const p = I.evaluations;
        (I.avgDurationMs = I.totalDurationMs / p),
          j > I.maxDurationMs && (I.maxDurationMs = j),
          j > i && t?.(C, j);
      }
      $ = D;
    },
    onResolverStart(C, w) {
      const D = O(C);
      D.starts++;
    },
    onResolverComplete(C, w, D) {
      const I = O(C);
      I.completions++,
        (I.totalDurationMs += D),
        (I.avgDurationMs = I.totalDurationMs / I.completions),
        D > I.maxDurationMs && (I.maxDurationMs = D),
        (I.lastCompletedAt = Date.now()),
        D > s && l?.(C, D);
    },
    onResolverError(C, w, D) {
      O(C).errors++;
    },
    onResolverRetry(C, w, D) {
      O(C).retries++;
    },
    onResolverCancel(C, w) {
      O(C).cancellations++;
    },
    onEffectRun(C) {
      const w = M(C);
      w.runs++, (w.lastRunAt = Date.now());
    },
    onEffectError(C, w) {
      M(C).errors++;
    },
    onReconcileStart() {
      (c = performance.now()), ($ = 0);
    },
    onReconcileEnd() {
      const C = performance.now() - c;
      h.runs++,
        (h.totalDurationMs += C),
        (h.avgDurationMs = h.totalDurationMs / h.runs),
        C > h.maxDurationMs && (h.maxDurationMs = C);
    },
    getSnapshot() {
      const C = {};
      for (const [I, j] of o) C[I] = { ...j };
      const w = {};
      for (const [I, j] of d) w[I] = { ...j };
      const D = {};
      for (const [I, j] of u) D[I] = { ...j };
      return {
        constraints: C,
        resolvers: w,
        effects: D,
        reconcile: { ...h },
        uptime: m ? Date.now() - m : 0,
      };
    },
    reset() {
      o.clear(),
        d.clear(),
        u.clear(),
        (h.runs = 0),
        (h.totalDurationMs = 0),
        (h.avgDurationMs = 0),
        (h.maxDurationMs = 0),
        ($ = 0);
    },
  };
}
var lt = class extends Error {
  code = "CIRCUIT_OPEN";
  retryAfterMs;
  state;
  constructor(e, t, l = "OPEN", i) {
    const s = i
      ? `[Directive CircuitBreaker] Circuit "${e}" is ${l}. ${i}`
      : `[Directive CircuitBreaker] Circuit "${e}" is ${l}. Request rejected. Try again in ${Math.ceil(t / 1e3)}s.`;
    super(s),
      (this.name = "CircuitBreakerOpenError"),
      (this.retryAfterMs = t),
      (this.state = l);
  }
};
function je(e = {}) {
  const {
    failureThreshold: t = 5,
    recoveryTimeMs: l = 3e4,
    halfOpenMaxRequests: i = 3,
    failureWindowMs: s = 6e4,
    observability: o,
    metricPrefix: d = "circuit_breaker",
    name: u = "default",
    isFailure: h = () => !0,
    onStateChange: m,
  } = e;
  if (t < 1 || !Number.isFinite(t))
    throw new Error(
      `[Directive CircuitBreaker] failureThreshold must be >= 1, got ${t}`,
    );
  if (l <= 0 || !Number.isFinite(l))
    throw new Error(
      `[Directive CircuitBreaker] recoveryTimeMs must be > 0, got ${l}`,
    );
  if (i < 1 || !Number.isFinite(i))
    throw new Error(
      `[Directive CircuitBreaker] halfOpenMaxRequests must be >= 1, got ${i}`,
    );
  if (s <= 0 || !Number.isFinite(s))
    throw new Error(
      `[Directive CircuitBreaker] failureWindowMs must be > 0, got ${s}`,
    );
  let c = "CLOSED",
    $ = [],
    T = 0,
    O = 0,
    M = Date.now(),
    C = 0,
    w = 0,
    D = 0,
    I = 0,
    j = 0,
    p = null,
    x = null;
  function y(f) {
    if (c === f) return;
    const b = c;
    (c = f),
      (M = Date.now()),
      f === "OPEN" && (C = Date.now()),
      f === "HALF_OPEN" && ((T = 0), (O = 0)),
      m?.(b, f),
      o && o.incrementCounter(`${d}.state_change`, { name: u, from: b, to: f });
  }
  function R() {
    const f = Date.now() - s;
    return ($ = $.filter((b) => b > f)), $.length;
  }
  function A() {
    I++,
      (x = Date.now()),
      o && o.incrementCounter(`${d}.success`, { name: u }),
      c === "HALF_OPEN" && (O++, O >= i && (y("CLOSED"), ($ = [])));
  }
  function L(f) {
    if (!h(f)) {
      A();
      return;
    }
    D++, (p = Date.now()), $.push(Date.now());
    const b = t * 2;
    if (
      ($.length > b && ($ = $.slice(-b)),
      o && o.incrementCounter(`${d}.failure`, { name: u }),
      c === "HALF_OPEN")
    ) {
      y("OPEN");
      return;
    }
    c === "CLOSED" && R() >= t && y("OPEN");
  }
  return {
    async execute(f) {
      if (
        (w++,
        o && o.incrementCounter(`${d}.requests`, { name: u }),
        c === "OPEN")
      )
        if (Date.now() - C >= l) y("HALF_OPEN");
        else
          throw (
            (j++,
            o && o.incrementCounter(`${d}.rejected`, { name: u }),
            new lt(u, l - (Date.now() - C)))
          );
      if (c === "HALF_OPEN") {
        if (T >= i)
          throw (
            (j++,
            new lt(u, l, "HALF_OPEN", `Max trial requests (${i}) reached.`))
          );
        T++;
      }
      const b = Date.now();
      try {
        const S = await f();
        return (
          A(),
          o && o.observeHistogram(`${d}.latency`, Date.now() - b, { name: u }),
          S
        );
      } catch (S) {
        const B = S instanceof Error ? S : new Error(String(S));
        throw (
          (L(B),
          o && o.observeHistogram(`${d}.latency`, Date.now() - b, { name: u }),
          S)
        );
      }
    },
    getState() {
      return c === "OPEN" && Date.now() - C >= l && y("HALF_OPEN"), c;
    },
    getStats() {
      return {
        state: this.getState(),
        totalRequests: w,
        totalFailures: D,
        totalSuccesses: I,
        totalRejected: j,
        recentFailures: R(),
        lastFailureTime: p,
        lastSuccessTime: x,
        lastStateChange: M,
      };
    },
    forceState(f) {
      y(f);
    },
    reset() {
      const f = c;
      (c = "CLOSED"),
        ($ = []),
        (T = 0),
        (O = 0),
        (M = Date.now()),
        (C = 0),
        (w = 0),
        (D = 0),
        (I = 0),
        (j = 0),
        (p = null),
        (x = null),
        f !== "CLOSED" && m?.(f, "CLOSED");
    },
    isAllowed() {
      return c === "CLOSED" ? !0 : c === "OPEN" ? Date.now() - C >= l : T < i;
    },
  };
}
const ge = [];
function le(e, t, l) {
  ge.unshift({ time: Date.now(), event: e, detail: t, type: l }),
    ge.length > 50 && (ge.length = 50);
}
const me = {
    users: je({
      name: "users-api",
      failureThreshold: 3,
      recoveryTimeMs: 5e3,
      halfOpenMaxRequests: 2,
      onStateChange: (e, t) => {
        le("circuit", `users: ${e} → ${t}`, "circuit");
      },
    }),
    orders: je({
      name: "orders-api",
      failureThreshold: 3,
      recoveryTimeMs: 5e3,
      halfOpenMaxRequests: 2,
      onStateChange: (e, t) => {
        le("circuit", `orders: ${e} → ${t}`, "circuit");
      },
    }),
    analytics: je({
      name: "analytics-api",
      failureThreshold: 3,
      recoveryTimeMs: 5e3,
      halfOpenMaxRequests: 2,
      onStateChange: (e, t) => {
        le("circuit", `analytics: ${e} → ${t}`, "circuit");
      },
    }),
  },
  Fe = {
    facts: {
      usersService: re.object(),
      ordersService: re.object(),
      analyticsService: re.object(),
      strategy: re.string(),
      usersFailRate: re.number(),
      ordersFailRate: re.number(),
      analyticsFailRate: re.number(),
      retryQueueCount: re.number(),
      totalErrors: re.number(),
      totalRecoveries: re.number(),
    },
    derivations: {
      usersCircuitState: re.string(),
      ordersCircuitState: re.string(),
      analyticsCircuitState: re.string(),
      errorRate: re.number(),
      allServicesHealthy: re.boolean(),
    },
    events: {
      fetchUsers: {},
      fetchOrders: {},
      fetchAnalytics: {},
      fetchAll: {},
      setStrategy: { value: re.string() },
      setUsersFailRate: { value: re.number() },
      setOrdersFailRate: { value: re.number() },
      setAnalyticsFailRate: { value: re.number() },
      resetAll: {},
    },
    requirements: {
      FETCH_SERVICE: { service: re.string(), failRate: re.number() },
    },
  },
  yr = Dt("dashboard", {
    schema: Fe,
    init: (e) => {
      const t = {
        name: "",
        status: "idle",
        lastResult: "",
        errorCount: 0,
        successCount: 0,
        lastError: "",
      };
      (e.usersService = { ...t, name: "Users API" }),
        (e.ordersService = { ...t, name: "Orders API" }),
        (e.analyticsService = { ...t, name: "Analytics API" }),
        (e.strategy = "retry-later"),
        (e.usersFailRate = 0),
        (e.ordersFailRate = 0),
        (e.analyticsFailRate = 0),
        (e.retryQueueCount = 0),
        (e.totalErrors = 0),
        (e.totalRecoveries = 0);
    },
    derive: {
      usersCircuitState: () => me.users.getState(),
      ordersCircuitState: () => me.orders.getState(),
      analyticsCircuitState: () => me.analytics.getState(),
      errorRate: (e) => {
        const t =
          e.usersService.errorCount +
          e.usersService.successCount +
          e.ordersService.errorCount +
          e.ordersService.successCount +
          e.analyticsService.errorCount +
          e.analyticsService.successCount;
        if (t === 0) return 0;
        const l =
          e.usersService.errorCount +
          e.ordersService.errorCount +
          e.analyticsService.errorCount;
        return Math.round((l / t) * 100);
      },
      allServicesHealthy: (e) =>
        e.usersService.status !== "error" &&
        e.ordersService.status !== "error" &&
        e.analyticsService.status !== "error",
    },
    events: {
      fetchUsers: (e) => {
        e.usersService = { ...e.usersService, status: "loading" };
      },
      fetchOrders: (e) => {
        e.ordersService = { ...e.ordersService, status: "loading" };
      },
      fetchAnalytics: (e) => {
        e.analyticsService = { ...e.analyticsService, status: "loading" };
      },
      fetchAll: (e) => {
        (e.usersService = { ...e.usersService, status: "loading" }),
          (e.ordersService = { ...e.ordersService, status: "loading" }),
          (e.analyticsService = { ...e.analyticsService, status: "loading" });
      },
      setStrategy: (e, { value: t }) => {
        e.strategy = t;
      },
      setUsersFailRate: (e, { value: t }) => {
        e.usersFailRate = t;
      },
      setOrdersFailRate: (e, { value: t }) => {
        e.ordersFailRate = t;
      },
      setAnalyticsFailRate: (e, { value: t }) => {
        e.analyticsFailRate = t;
      },
      resetAll: (e) => {
        const t = {
          name: "",
          status: "idle",
          lastResult: "",
          errorCount: 0,
          successCount: 0,
          lastError: "",
        };
        (e.usersService = { ...t, name: "Users API" }),
          (e.ordersService = { ...t, name: "Orders API" }),
          (e.analyticsService = { ...t, name: "Analytics API" }),
          (e.retryQueueCount = 0),
          (e.totalErrors = 0),
          (e.totalRecoveries = 0),
          me.users.reset(),
          me.orders.reset(),
          me.analytics.reset(),
          (ge.length = 0);
      },
    },
    constraints: {
      usersNeedsLoad: {
        priority: 50,
        when: (e) => e.usersService.status === "loading",
        require: (e) => ({
          type: "FETCH_SERVICE",
          service: "users",
          failRate: e.usersFailRate,
        }),
      },
      ordersNeedsLoad: {
        priority: 50,
        when: (e) => e.ordersService.status === "loading",
        require: (e) => ({
          type: "FETCH_SERVICE",
          service: "orders",
          failRate: e.ordersFailRate,
        }),
      },
      analyticsNeedsLoad: {
        priority: 50,
        when: (e) => e.analyticsService.status === "loading",
        require: (e) => ({
          type: "FETCH_SERVICE",
          service: "analytics",
          failRate: e.analyticsFailRate,
        }),
      },
    },
    resolvers: {
      fetchService: {
        requirement: "FETCH_SERVICE",
        retry: { attempts: 2, backoff: "exponential", initialDelay: 200 },
        resolve: async (e, t) => {
          const { service: l, failRate: i } = e,
            s = me[l],
            o = `${l}Service`,
            d = t.facts.strategy;
          try {
            await s.execute(async () => {
              if (
                (await new Promise((h) =>
                  setTimeout(h, 200 + Math.random() * 300),
                ),
                Math.random() * 100 < i)
              )
                throw new Error(`${l} API: simulated failure`);
            });
            const u = t.facts[o];
            (t.facts[o] = {
              ...u,
              status: "success",
              lastResult: `Loaded at ${new Date().toLocaleTimeString()}`,
              successCount: u.successCount + 1,
            }),
              le("success", `${l} fetched`, "success");
          } catch (u) {
            const h = t.facts[o],
              m = u instanceof Error ? u.message : String(u);
            if (
              ((t.facts[o] = {
                ...h,
                status: "error",
                lastError: m,
                errorCount: h.errorCount + 1,
              }),
              (t.facts.totalErrors = t.facts.totalErrors + 1),
              le("error", `${l}: ${m.slice(0, 60)}`, "error"),
              d === "skip")
            ) {
              le("recovery", `${l}: skipped (strategy=skip)`, "recovery"),
                (t.facts.totalRecoveries = t.facts.totalRecoveries + 1);
              return;
            }
            if (d === "retry-later") {
              le(
                "recovery",
                `${l}: queued for retry (strategy=retry-later)`,
                "recovery",
              ),
                (t.facts.retryQueueCount = t.facts.retryQueueCount + 1),
                (t.facts.totalRecoveries = t.facts.totalRecoveries + 1);
              return;
            }
            throw d === "retry"
              ? (le(
                  "recovery",
                  `${l}: retrying immediately (strategy=retry)`,
                  "recovery",
                ),
                u)
              : (le("recovery", `${l}: throwing (strategy=throw)`, "recovery"),
                u);
          }
        },
      },
    },
  }),
  bt = gr({
    onSlowResolver: (e, t) => {
      le("perf", `slow resolver: ${e} (${Math.round(t)}ms)`, "info");
    },
  });
let at = "retry-later";
const se = Wt({
  module: yr,
  plugins: [bt, hr({ name: "error-boundaries" })],
  errorBoundary: {
    onResolverError: "retry-later",
    onConstraintError: "skip",
    onEffectError: "skip",
    retryLater: { delayMs: 1e3, maxRetries: 3, backoffMultiplier: 2 },
    onError: (e) => {
      le("error", `boundary: ${e.message.slice(0, 60)}`, "error");
    },
  },
});
se.start();
se.subscribe(["strategy"], () => {
  const e = se.facts.strategy;
  e !== at && ((at = e), le("recovery", `strategy → ${e}`, "recovery"));
});
const vr = document.getElementById("eb-users-status"),
  br = document.getElementById("eb-users-result"),
  wr = document.getElementById("eb-users-error"),
  Sr = document.getElementById("eb-orders-status"),
  Er = document.getElementById("eb-orders-result"),
  $r = document.getElementById("eb-orders-error"),
  Cr = document.getElementById("eb-analytics-status"),
  xr = document.getElementById("eb-analytics-result"),
  Rr = document.getElementById("eb-analytics-error"),
  ct = document.getElementById("eb-users-failrate"),
  kr = document.getElementById("eb-users-fail-val"),
  ut = document.getElementById("eb-orders-failrate"),
  Dr = document.getElementById("eb-orders-fail-val"),
  dt = document.getElementById("eb-analytics-failrate"),
  Ar = document.getElementById("eb-analytics-fail-val"),
  ft = document.getElementById("eb-strategy"),
  Ie = document.getElementById("eb-timeline");
function mt(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function qe(e, t, l, i) {
  (e.textContent = i.status),
    (e.className = `eb-service-status ${i.status}`),
    (t.textContent = i.lastResult || "—"),
    i.lastError
      ? ((l.textContent = i.lastError.slice(0, 50)),
        (l.style.display = "block"))
      : (l.style.display = "none");
}
function Pe() {
  const e = se.facts;
  if (
    (qe(vr, br, wr, e.usersService),
    qe(Sr, Er, $r, e.ordersService),
    qe(Cr, xr, Rr, e.analyticsService),
    (kr.textContent = `${e.usersFailRate}%`),
    (Dr.textContent = `${e.ordersFailRate}%`),
    (Ar.textContent = `${e.analyticsFailRate}%`),
    ge.length === 0)
  )
    Ie.innerHTML =
      '<div class="eb-timeline-empty">Events appear after interactions</div>';
  else {
    Ie.innerHTML = "";
    for (const t of ge) {
      const l = document.createElement("div");
      l.className = `eb-timeline-entry ${t.type}`;
      const s = new Date(t.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (l.innerHTML = `
        <span class="eb-timeline-time">${s}</span>
        <span class="eb-timeline-event">${mt(t.event)}</span>
        <span class="eb-timeline-detail">${mt(t.detail)}</span>
      `),
        Ie.appendChild(l);
    }
  }
}
const Or = [...Object.keys(Fe.facts), ...Object.keys(Fe.derivations)];
se.subscribe(Or, Pe);
setInterval(() => {
  Pe();
}, 1e3);
document.getElementById("eb-fetch-users").addEventListener("click", () => {
  se.events.fetchUsers();
});
document.getElementById("eb-fetch-orders").addEventListener("click", () => {
  se.events.fetchOrders();
});
document.getElementById("eb-fetch-analytics").addEventListener("click", () => {
  se.events.fetchAnalytics();
});
document.getElementById("eb-fetch-all").addEventListener("click", () => {
  se.events.fetchAll();
});
document.getElementById("eb-reset").addEventListener("click", () => {
  bt.reset(), se.events.resetAll();
});
ft.addEventListener("change", () => {
  se.events.setStrategy({ value: ft.value });
});
ct.addEventListener("input", () => {
  se.events.setUsersFailRate({ value: Number(ct.value) });
});
ut.addEventListener("input", () => {
  se.events.setOrdersFailRate({ value: Number(ut.value) });
});
dt.addEventListener("input", () => {
  se.events.setAnalyticsFailRate({ value: Number(dt.value) });
});
Pe();
document.body.setAttribute("data-error-boundaries-ready", "true");
