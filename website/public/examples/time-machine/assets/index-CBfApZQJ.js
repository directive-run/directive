(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const r of document.querySelectorAll('link[rel="modulepreload"]')) n(r);
  new MutationObserver((r) => {
    for (const o of r)
      if (o.type === "childList")
        for (const d of o.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && n(d);
  }).observe(document, { childList: !0, subtree: !0 });
  function l(r) {
    const o = {};
    return (
      r.integrity && (o.integrity = r.integrity),
      r.referrerPolicy && (o.referrerPolicy = r.referrerPolicy),
      r.crossOrigin === "use-credentials"
        ? (o.credentials = "include")
        : r.crossOrigin === "anonymous"
          ? (o.credentials = "omit")
          : (o.credentials = "same-origin"),
      o
    );
  }
  function n(r) {
    if (r.ep) return;
    r.ep = !0;
    const o = l(r);
    fetch(r.href, o);
  }
})();
var et = class extends Error {
    constructor(e, t, l, n, r = !0) {
      super(e),
        (this.source = t),
        (this.sourceId = l),
        (this.context = n),
        (this.recoverable = r),
        (this.name = "DirectiveError");
    }
  },
  je = [];
function It() {
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
var qt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function Bt() {
  return je[je.length - 1] ?? qt;
}
function Fe(e) {
  const t = It();
  je.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    je.pop();
  }
}
function tt(e) {
  const t = je.splice(0, je.length);
  try {
    return e();
  } finally {
    je.push(...t);
  }
}
function Xe(e) {
  Bt().track(e);
}
function zt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Pe(e = [], t, l, n, r, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: n,
    _description: r,
    _refinements: o,
    validate(d) {
      return Pe([...e, d], t, l, n, r, o);
    },
  };
}
function de(e, t, l, n, r, o) {
  return {
    ...Pe(e, t, l, n, r, o),
    default(d) {
      return de(e, t, d, n, r, o);
    },
    transform(d) {
      return de(
        [],
        t,
        void 0,
        (f) => {
          const y = n ? n(f) : f;
          return d(y);
        },
        r,
      );
    },
    brand() {
      return de(e, `Branded<${t}>`, l, n, r, o);
    },
    describe(d) {
      return de(e, t, l, n, d, o);
    },
    refine(d, f) {
      const y = [...(o ?? []), { predicate: d, message: f }];
      return de([...e, d], t, l, n, r, y);
    },
    nullable() {
      return de(
        [(d) => d === null || e.every((f) => f(d))],
        `${t} | null`,
        l,
        n,
        r,
      );
    },
    optional() {
      return de(
        [(d) => d === void 0 || e.every((f) => f(d))],
        `${t} | undefined`,
        l,
        n,
        r,
      );
    },
  };
}
var ve = {
  string() {
    return de([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, l, n, r, o) => ({
      ...de(t, "number", l, n, r, o),
      min(d) {
        return e([...t, (f) => f >= d], l, n, r, o);
      },
      max(d) {
        return e([...t, (f) => f <= d], l, n, r, o);
      },
      default(d) {
        return e(t, d, n, r, o);
      },
      describe(d) {
        return e(t, l, n, d, o);
      },
      refine(d, f) {
        const y = [...(o ?? []), { predicate: d, message: f }];
        return e([...t, d], l, n, r, y);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return de([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, n, r, o) => {
      const d = de(t, "array", n, void 0, r),
        f = o ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return f.value;
        },
        set _lastFailedIndex(y) {
          f.value = y;
        },
        of(y) {
          const m = { value: -1 };
          return e(
            [
              ...t,
              (u) => {
                for (let $ = 0; $ < u.length; $++) {
                  const _ = u[$];
                  if (!y._validators.every((I) => I(_)))
                    return (m.value = $), !1;
                }
                return !0;
              },
            ],
            y,
            n,
            r,
            m,
          );
        },
        nonEmpty() {
          return e([...t, (y) => y.length > 0], l, n, r, f);
        },
        maxLength(y) {
          return e([...t, (m) => m.length <= y], l, n, r, f);
        },
        minLength(y) {
          return e([...t, (m) => m.length >= y], l, n, r, f);
        },
        default(y) {
          return e(t, l, y, r, f);
        },
        describe(y) {
          return e(t, l, n, y, f);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, n) => ({
      ...de(t, "object", l, void 0, n),
      shape(r) {
        return e(
          [
            ...t,
            (o) => {
              for (const [d, f] of Object.entries(r)) {
                const y = o[d],
                  m = f;
                if (m && !m._validators.every((u) => u(y))) return !1;
              }
              return !0;
            },
          ],
          l,
          n,
        );
      },
      nonNull() {
        return e([...t, (r) => r != null], l, n);
      },
      hasKeys(...r) {
        return e([...t, (o) => r.every((d) => d in o)], l, n);
      },
      default(r) {
        return e(t, r, n);
      },
      describe(r) {
        return e(t, l, r);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return de(
      [(l) => typeof l == "string" && t.has(l)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return de([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return Pe(
      [(l) => (l === null ? !0 : e._validators.every((n) => n(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Pe(
      [(l) => (l === void 0 ? !0 : e._validators.every((n) => n(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return de(
      [(l) => e.some((n) => n._validators.every((r) => r(l)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return de(
      [
        (l) =>
          typeof l != "object" || l === null || Array.isArray(l)
            ? !1
            : Object.values(l).every((n) => e._validators.every((r) => r(n))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return de(
      [
        (l) =>
          !Array.isArray(l) || l.length !== e.length
            ? !1
            : e.every((n, r) => n._validators.every((o) => o(l[r]))),
      ],
      `[${t.join(", ")}]`,
    );
  },
  date() {
    return de([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return de([(t) => typeof t == "string" && e.test(t)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return de([(t) => typeof t == "string" && e.test(t)], "email");
  },
  url() {
    return de(
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
    return de([(e) => typeof e == "bigint"], "bigint");
  },
};
function _t(e) {
  const { schema: t, onChange: l, onBatch: n } = e;
  Object.keys(t).length;
  let r = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    f = new Map(),
    y = new Set(),
    m = new Map(),
    u = new Set(),
    $ = 0,
    _ = [],
    I = new Set(),
    q = !1,
    B = [],
    R = 100;
  function M(h) {
    return (
      h !== null &&
      typeof h == "object" &&
      "safeParse" in h &&
      typeof h.safeParse == "function" &&
      "_def" in h &&
      "parse" in h &&
      typeof h.parse == "function"
    );
  }
  function H(h) {
    const w = h;
    if (w._typeName) return w._typeName;
    if (M(h)) {
      const A = h._def;
      if (A?.typeName) return A.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function T(h) {
    return d ? "[redacted]" : zt(h);
  }
  function c(h, w) {
    if (!r) return;
    const A = t[h];
    if (!A) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${h}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${h}"`);
      return;
    }
    if (M(A)) {
      const F = A.safeParse(w);
      if (!F.success) {
        const b = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          k = T(w),
          a =
            F.error?.message ??
            F.error?.issues?.[0]?.message ??
            "Validation failed",
          i = H(A);
        throw new Error(
          `[Directive] Validation failed for "${h}": expected ${i}, got ${b} ${k}. ${a}`,
        );
      }
      return;
    }
    const j = A,
      N = j._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const W = j._typeName ?? "unknown";
    for (let F = 0; F < N.length; F++) {
      const b = N[F];
      if (typeof b == "function" && !b(w)) {
        let k = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          a = T(w),
          i = "";
        typeof j._lastFailedIndex == "number" &&
          j._lastFailedIndex >= 0 &&
          ((i = ` (element at index ${j._lastFailedIndex} failed)`),
          (j._lastFailedIndex = -1));
        const p = F === 0 ? "" : ` (validator ${F + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${h}": expected ${W}, got ${k} ${a}${p}${i}`,
        );
      }
    }
  }
  function x(h) {
    m.get(h)?.forEach((w) => w());
  }
  function v() {
    u.forEach((h) => h());
  }
  function C(h, w, A) {
    if (q) {
      B.push({ key: h, value: w, prev: A });
      return;
    }
    q = !0;
    try {
      l?.(h, w, A), x(h), v();
      let j = 0;
      while (B.length > 0) {
        if (++j > R)
          throw (
            ((B.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${R} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...B];
        B.length = 0;
        for (const W of N) l?.(W.key, W.value, W.prev), x(W.key);
        v();
      }
    } finally {
      q = !1;
    }
  }
  function D() {
    if (!($ > 0)) {
      if ((n && _.length > 0 && n([..._]), I.size > 0)) {
        q = !0;
        try {
          for (const w of I) x(w);
          v();
          let h = 0;
          while (B.length > 0) {
            if (++h > R)
              throw (
                ((B.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${R} iterations.`,
                ))
              );
            const w = [...B];
            B.length = 0;
            for (const A of w) l?.(A.key, A.value, A.prev), x(A.key);
            v();
          }
        } finally {
          q = !1;
        }
      }
      (_.length = 0), I.clear();
    }
  }
  const L = {
    get(h) {
      return Xe(h), f.get(h);
    },
    has(h) {
      return Xe(h), f.has(h);
    },
    set(h, w) {
      c(h, w);
      const A = f.get(h);
      Object.is(A, w) ||
        (f.set(h, w),
        y.add(h),
        $ > 0
          ? (_.push({ key: h, value: w, prev: A, type: "set" }), I.add(h))
          : C(h, w, A));
    },
    delete(h) {
      const w = f.get(h);
      f.delete(h),
        y.delete(h),
        $ > 0
          ? (_.push({ key: h, value: void 0, prev: w, type: "delete" }),
            I.add(h))
          : C(h, void 0, w);
    },
    batch(h) {
      $++;
      try {
        h();
      } finally {
        $--, D();
      }
    },
    subscribe(h, w) {
      for (const A of h) {
        const j = A;
        m.has(j) || m.set(j, new Set()), m.get(j).add(w);
      }
      return () => {
        for (const A of h) {
          const j = m.get(A);
          j && (j.delete(w), j.size === 0 && m.delete(A));
        }
      };
    },
    subscribeAll(h) {
      return u.add(h), () => u.delete(h);
    },
    toObject() {
      const h = {};
      for (const w of y) f.has(w) && (h[w] = f.get(w));
      return h;
    },
  };
  return (
    (L.registerKeys = (h) => {
      for (const w of Object.keys(h)) qe.has(w) || ((t[w] = h[w]), y.add(w));
    }),
    L
  );
}
var qe = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Tt(e, t) {
  const l = () => ({
    get: (n) => tt(() => e.get(n)),
    has: (n) => tt(() => e.has(n)),
  });
  return new Proxy(
    {},
    {
      get(n, r) {
        if (r === "$store") return e;
        if (r === "$snapshot") return l;
        if (typeof r != "symbol" && !qe.has(r)) return e.get(r);
      },
      set(n, r, o) {
        return typeof r == "symbol" ||
          r === "$store" ||
          r === "$snapshot" ||
          qe.has(r)
          ? !1
          : (e.set(r, o), !0);
      },
      deleteProperty(n, r) {
        return typeof r == "symbol" ||
          r === "$store" ||
          r === "$snapshot" ||
          qe.has(r)
          ? !1
          : (e.delete(r), !0);
      },
      has(n, r) {
        return r === "$store" || r === "$snapshot"
          ? !0
          : typeof r == "symbol" || qe.has(r)
            ? !1
            : e.has(r);
      },
      ownKeys() {
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(n, r) {
        return r === "$store" || r === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Lt(e) {
  const t = _t(e),
    l = Tt(t, e.schema);
  return { store: t, facts: l };
}
function Ft(e, t) {
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
async function _e(e, t, l) {
  let n,
    r = new Promise((o, d) => {
      n = setTimeout(() => d(new Error(l)), t);
    });
  try {
    return await Promise.race([e, r]);
  } finally {
    clearTimeout(n);
  }
}
function St(e, t = 50) {
  const l = new WeakSet();
  function n(r, o) {
    if (o > t) return '"[max depth exceeded]"';
    if (r === null) return "null";
    if (r === void 0) return "undefined";
    const d = typeof r;
    if (d === "string") return JSON.stringify(r);
    if (d === "number" || d === "boolean") return String(r);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(r)) {
      if (l.has(r)) return '"[circular]"';
      l.add(r);
      const f = `[${r.map((y) => n(y, o + 1)).join(",")}]`;
      return l.delete(r), f;
    }
    if (d === "object") {
      const f = r;
      if (l.has(f)) return '"[circular]"';
      l.add(f);
      const y = `{${Object.keys(f)
        .sort()
        .map((m) => `${JSON.stringify(m)}:${n(f[m], o + 1)}`)
        .join(",")}}`;
      return l.delete(f), y;
    }
    return '"[unknown]"';
  }
  return n(e, 0);
}
function ze(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    n = new WeakSet();
  function r(o, d) {
    if (d > t) return !1;
    if (o == null || typeof o != "object") return !0;
    const f = o;
    if (n.has(f)) return !0;
    if ((n.add(f), Array.isArray(f))) {
      for (const y of f) if (!r(y, d + 1)) return n.delete(f), !1;
      return n.delete(f), !0;
    }
    for (const y of Object.keys(f))
      if (l.has(y) || !r(f[y], d + 1)) return n.delete(f), !1;
    return n.delete(f), !0;
  }
  return r(e, 0);
}
function Pt(e) {
  let t = St(e),
    l = 5381;
  for (let n = 0; n < t.length; n++) l = ((l << 5) + l) ^ t.charCodeAt(n);
  return (l >>> 0).toString(16);
}
function Nt(e, t) {
  if (t) return t(e);
  const { type: l, ...n } = e,
    r = St(n);
  return `${l}:${r}`;
}
function Ht(e, t, l) {
  return { requirement: e, id: Nt(e, l), fromConstraint: t };
}
var Ge = class xt {
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
      const t = new xt();
      for (const l of this.map.values()) t.add(l);
      return t;
    }
    diff(t) {
      const l = [],
        n = [],
        r = [];
      for (const o of this.map.values()) t.has(o.id) ? r.push(o) : l.push(o);
      for (const o of t.map.values()) this.map.has(o.id) || n.push(o);
      return { added: l, removed: n, unchanged: r };
    }
  },
  Wt = 5e3;
function Kt(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: n = {},
      defaultTimeout: r = Wt,
      onEvaluate: o,
      onError: d,
    } = e,
    f = new Map(),
    y = new Set(),
    m = new Set(),
    u = new Map(),
    $ = new Map(),
    _ = new Set(),
    I = new Map(),
    q = new Map(),
    B = !1,
    R = new Set(),
    M = new Set(),
    H = new Map(),
    T = [],
    c = new Map();
  function x() {
    for (const [a, i] of Object.entries(t))
      if (i.after)
        for (const p of i.after)
          t[p] && (H.has(p) || H.set(p, new Set()), H.get(p).add(a));
  }
  function v() {
    const a = new Set(),
      i = new Set(),
      p = [];
    function S(E, U) {
      if (a.has(E)) return;
      if (i.has(E)) {
        const ee = U.indexOf(E),
          K = [...U.slice(ee), E].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${K}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      i.add(E), U.push(E);
      const Q = t[E];
      if (Q?.after) for (const ee of Q.after) t[ee] && S(ee, U);
      U.pop(), i.delete(E), a.add(E), p.push(E);
    }
    for (const E of Object.keys(t)) S(E, []);
    (T = p), (c = new Map(T.map((E, U) => [E, U])));
  }
  v(), x();
  function C(a, i) {
    return i.async !== void 0 ? i.async : !!m.has(a);
  }
  function D(a) {
    const i = t[a];
    if (!i) throw new Error(`[Directive] Unknown constraint: ${a}`);
    const p = C(a, i);
    p && m.add(a);
    const S = {
      id: a,
      priority: i.priority ?? 0,
      isAsync: p,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: i.after ?? [],
      hitCount: 0,
      lastActiveAt: null,
    };
    return f.set(a, S), S;
  }
  function L(a) {
    return f.get(a) ?? D(a);
  }
  function h(a, i) {
    const p = u.get(a) ?? new Set();
    for (const S of p) {
      const E = $.get(S);
      E?.delete(a), E && E.size === 0 && $.delete(S);
    }
    for (const S of i) $.has(S) || $.set(S, new Set()), $.get(S).add(a);
    u.set(a, i);
  }
  function w(a) {
    const i = t[a];
    if (!i) return !1;
    const p = L(a);
    (p.isEvaluating = !0), (p.error = null);
    try {
      let S;
      if (i.deps) (S = i.when(l)), I.set(a, new Set(i.deps));
      else {
        const E = Fe(() => i.when(l));
        (S = E.value), I.set(a, E.deps);
      }
      return S instanceof Promise
        ? (m.add(a),
          (p.isAsync = !0),
          S.then(
            (E) => (
              (p.lastResult = E),
              E && (p.hitCount++, (p.lastActiveAt = Date.now())),
              (p.isEvaluating = !1),
              o?.(a, E),
              E
            ),
          ).catch(
            (E) => (
              (p.error = E instanceof Error ? E : new Error(String(E))),
              (p.lastResult = !1),
              (p.isEvaluating = !1),
              d?.(a, E),
              !1
            ),
          ))
        : ((p.lastResult = S),
          S && (p.hitCount++, (p.lastActiveAt = Date.now())),
          (p.isEvaluating = !1),
          o?.(a, S),
          S);
    } catch (S) {
      return (
        (p.error = S instanceof Error ? S : new Error(String(S))),
        (p.lastResult = !1),
        (p.isEvaluating = !1),
        d?.(a, S),
        !1
      );
    }
  }
  async function A(a) {
    const i = t[a];
    if (!i) return !1;
    const p = L(a),
      S = i.timeout ?? r;
    if (((p.isEvaluating = !0), (p.error = null), i.deps?.length)) {
      const E = new Set(i.deps);
      h(a, E), I.set(a, E);
    }
    try {
      const E = i.when(l),
        U = await _e(E, S, `Constraint "${a}" timed out after ${S}ms`);
      return (
        (p.lastResult = U),
        U && (p.hitCount++, (p.lastActiveAt = Date.now())),
        (p.isEvaluating = !1),
        o?.(a, U),
        U
      );
    } catch (E) {
      return (
        (p.error = E instanceof Error ? E : new Error(String(E))),
        (p.lastResult = !1),
        (p.isEvaluating = !1),
        d?.(a, E),
        !1
      );
    }
  }
  function j(a, i) {
    return a == null ? [] : Array.isArray(a) ? a.filter((S) => S != null) : [a];
  }
  function N(a) {
    const i = t[a];
    if (!i) return { requirements: [], deps: new Set() };
    const p = i.require;
    if (typeof p == "function") {
      const { value: S, deps: E } = Fe(() => p(l));
      return { requirements: j(S), deps: E };
    }
    return { requirements: j(p), deps: new Set() };
  }
  function W(a, i) {
    if (i.size === 0) return;
    const p = u.get(a) ?? new Set();
    for (const S of i)
      p.add(S), $.has(S) || $.set(S, new Set()), $.get(S).add(a);
    u.set(a, p);
  }
  let F = null;
  function b() {
    return (
      F ||
        (F = Object.keys(t).sort((a, i) => {
          const p = L(a),
            S = L(i).priority - p.priority;
          if (S !== 0) return S;
          const E = c.get(a) ?? 0,
            U = c.get(i) ?? 0;
          return E - U;
        })),
      F
    );
  }
  for (const a of Object.keys(t)) D(a);
  function k(a) {
    const i = f.get(a);
    if (!i || i.after.length === 0) return !0;
    for (const p of i.after)
      if (t[p] && !y.has(p) && !M.has(p) && !R.has(p)) return !1;
    return !0;
  }
  return {
    async evaluate(a) {
      const i = new Ge();
      M.clear();
      let p = b().filter((K) => !y.has(K)),
        S;
      if (!B || !a || a.size === 0) (S = p), (B = !0);
      else {
        const K = new Set();
        for (const re of a) {
          const se = $.get(re);
          if (se) for (const me of se) y.has(me) || K.add(me);
        }
        for (const re of _) y.has(re) || K.add(re);
        _.clear(), (S = [...K]);
        for (const re of p)
          if (!K.has(re)) {
            const se = q.get(re);
            if (se) for (const me of se) i.add(me);
          }
      }
      function E(K, re) {
        if (y.has(K)) return;
        const se = I.get(K);
        if (!re) {
          se !== void 0 && h(K, se), M.add(K), q.set(K, []);
          return;
        }
        M.delete(K);
        let me, P;
        try {
          const ce = N(K);
          (me = ce.requirements), (P = ce.deps);
        } catch (ce) {
          d?.(K, ce), se !== void 0 && h(K, se), q.set(K, []);
          return;
        }
        if (se !== void 0) {
          const ce = new Set(se);
          for (const Y of P) ce.add(Y);
          h(K, ce);
        } else W(K, P);
        if (me.length > 0) {
          const ce = n[K],
            Y = me.map((te) => Ht(te, K, ce));
          for (const te of Y) i.add(te);
          q.set(K, Y);
        } else q.set(K, []);
      }
      async function U(K) {
        const re = [],
          se = [];
        for (const Y of K)
          if (k(Y)) se.push(Y);
          else {
            re.push(Y);
            const te = q.get(Y);
            if (te) for (const ne of te) i.add(ne);
          }
        if (se.length === 0) return re;
        const me = [],
          P = [];
        for (const Y of se) L(Y).isAsync ? P.push(Y) : me.push(Y);
        const ce = [];
        for (const Y of me) {
          const te = w(Y);
          if (te instanceof Promise) {
            ce.push({ id: Y, promise: te });
            continue;
          }
          E(Y, te);
        }
        if (ce.length > 0) {
          const Y = await Promise.all(
            ce.map(async ({ id: te, promise: ne }) => ({
              id: te,
              active: await ne,
            })),
          );
          for (const { id: te, active: ne } of Y) E(te, ne);
        }
        if (P.length > 0) {
          const Y = await Promise.all(
            P.map(async (te) => ({ id: te, active: await A(te) })),
          );
          for (const { id: te, active: ne } of Y) E(te, ne);
        }
        return re;
      }
      let Q = S,
        ee = S.length + 1;
      while (Q.length > 0 && ee > 0) {
        const K = Q.length;
        if (((Q = await U(Q)), Q.length === K)) break;
        ee--;
      }
      return i.all();
    },
    getState(a) {
      return f.get(a);
    },
    getDependencies(a) {
      return u.get(a);
    },
    getAllStates() {
      return [...f.values()];
    },
    disable(a) {
      if (!f.has(a)) {
        console.warn(
          `[Directive] constraints.disable("${a}") — no such constraint`,
        );
        return;
      }
      y.add(a), (F = null), q.delete(a);
      const i = u.get(a);
      if (i) {
        for (const p of i) {
          const S = $.get(p);
          S && (S.delete(a), S.size === 0 && $.delete(p));
        }
        u.delete(a);
      }
      I.delete(a);
    },
    enable(a) {
      if (!f.has(a)) {
        console.warn(
          `[Directive] constraints.enable("${a}") — no such constraint`,
        );
        return;
      }
      y.delete(a), (F = null), _.add(a);
    },
    isDisabled(a) {
      return y.has(a);
    },
    invalidate(a) {
      const i = $.get(a);
      if (i) for (const p of i) _.add(p);
    },
    markResolved(a) {
      R.add(a);
      const i = f.get(a);
      i && (i.lastResolvedAt = Date.now());
      const p = H.get(a);
      if (p) for (const S of p) _.add(S);
    },
    isResolved(a) {
      return R.has(a);
    },
    registerDefinitions(a) {
      for (const [i, p] of Object.entries(a)) (t[i] = p), D(i), _.add(i);
      (F = null), v(), x();
    },
  };
}
function Vt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: n,
      onInvalidate: r,
      onError: o,
    } = e,
    d = new Map(),
    f = new Map(),
    y = new Map(),
    m = new Map(),
    u = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    _ = new Set(),
    I = !1,
    q = 100,
    B;
  function R(v) {
    if (!t[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const C = {
      id: v,
      compute: () => H(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(v, C), C;
  }
  function M(v) {
    return d.get(v) ?? R(v);
  }
  function H(v) {
    const C = M(v),
      D = t[v];
    if (!D) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    C.isComputing = !0;
    try {
      const L = C.cachedValue,
        { value: h, deps: w } = Fe(() => D(l, B));
      return (
        (C.cachedValue = h), (C.isStale = !1), T(v, w), n?.(v, h, L, [...w]), h
      );
    } catch (L) {
      throw (o?.(v, L), L);
    } finally {
      C.isComputing = !1;
    }
  }
  function T(v, C) {
    const D = M(v),
      L = D.dependencies;
    for (const h of L)
      if (d.has(h)) {
        const w = m.get(h);
        w?.delete(v), w && w.size === 0 && m.delete(h);
      } else {
        const w = y.get(h);
        w?.delete(v), w && w.size === 0 && y.delete(h);
      }
    for (const h of C)
      t[h]
        ? (m.has(h) || m.set(h, new Set()), m.get(h).add(v))
        : (y.has(h) || y.set(h, new Set()), y.get(h).add(v));
    D.dependencies = C;
  }
  function c() {
    if (!($ > 0 || I)) {
      I = !0;
      try {
        let v = 0;
        while (_.size > 0) {
          if (++v > q) {
            const D = [..._];
            throw (
              (_.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${q} iterations. Remaining: ${D.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [..._];
          _.clear();
          for (const D of C) f.get(D)?.forEach((L) => L());
        }
      } finally {
        I = !1;
      }
    }
  }
  function x(v, C = new Set()) {
    if (C.has(v)) return;
    C.add(v);
    const D = d.get(v);
    if (!D || D.isStale) return;
    (D.isStale = !0), r?.(v), _.add(v);
    const L = m.get(v);
    if (L) for (const h of L) x(h, C);
  }
  return (
    (B = new Proxy(
      {},
      {
        get(v, C) {
          if (typeof C == "symbol" || u.has(C)) return;
          Xe(C);
          const D = M(C);
          return D.isStale && H(C), D.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const C = M(v);
        return C.isStale && H(v), C.cachedValue;
      },
      isStale(v) {
        return d.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const C = y.get(v);
        if (C) {
          $++;
          try {
            for (const D of C) x(D);
          } finally {
            $--, c();
          }
        }
      },
      invalidateMany(v) {
        $++;
        try {
          for (const C of v) {
            const D = y.get(C);
            if (D) for (const L of D) x(L);
          }
        } finally {
          $--, c();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const v of d.values())
            v.isStale || ((v.isStale = !0), _.add(v.id));
        } finally {
          $--, c();
        }
      },
      subscribe(v, C) {
        for (const D of v) {
          const L = D;
          f.has(L) || f.set(L, new Set()), f.get(L).add(C);
        }
        return () => {
          for (const D of v) {
            const L = D,
              h = f.get(L);
            h?.delete(C), h && h.size === 0 && f.delete(L);
          }
        };
      },
      getProxy() {
        return B;
      },
      getDependencies(v) {
        return M(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [C, D] of Object.entries(v)) (t[C] = D), R(C);
      },
    }
  );
}
function Ut(e) {
  let { definitions: t, facts: l, store: n, onRun: r, onError: o } = e,
    d = new Map(),
    f = null,
    y = !1;
  function m(R) {
    const M = t[R];
    if (!M) throw new Error(`[Directive] Unknown effect: ${R}`);
    const H = {
      id: R,
      enabled: !0,
      hasExplicitDeps: !!M.deps,
      dependencies: M.deps ? new Set(M.deps) : null,
      cleanup: null,
    };
    return d.set(R, H), H;
  }
  function u(R) {
    return d.get(R) ?? m(R);
  }
  function $() {
    return n.toObject();
  }
  function _(R, M) {
    const H = u(R);
    if (!H.enabled) return !1;
    if (H.dependencies) {
      for (const T of H.dependencies) if (M.has(T)) return !0;
      return !1;
    }
    return !0;
  }
  function I(R) {
    if (R.cleanup) {
      try {
        R.cleanup();
      } catch (M) {
        o?.(R.id, M),
          console.error(
            `[Directive] Effect "${R.id}" cleanup threw an error:`,
            M,
          );
      }
      R.cleanup = null;
    }
  }
  function q(R, M) {
    if (typeof M == "function")
      if (y)
        try {
          M();
        } catch (H) {
          o?.(R.id, H),
            console.error(
              `[Directive] Effect "${R.id}" cleanup threw an error:`,
              H,
            );
        }
      else R.cleanup = M;
  }
  async function B(R) {
    const M = u(R),
      H = t[R];
    if (!(!M.enabled || !H)) {
      I(M), r?.(R, M.dependencies ? [...M.dependencies] : []);
      try {
        if (M.hasExplicitDeps) {
          let T;
          if (
            (n.batch(() => {
              T = H.run(l, f);
            }),
            T instanceof Promise)
          ) {
            const c = await T;
            q(M, c);
          } else q(M, T);
        } else {
          let T = null,
            c,
            x = Fe(
              () => (
                n.batch(() => {
                  c = H.run(l, f);
                }),
                c
              ),
            );
          T = x.deps;
          let v = x.value;
          v instanceof Promise && (v = await v),
            q(M, v),
            (M.dependencies = T.size > 0 ? T : null);
        }
      } catch (T) {
        o?.(R, T),
          console.error(`[Directive] Effect "${R}" threw an error:`, T);
      }
    }
  }
  for (const R of Object.keys(t)) m(R);
  return {
    async runEffects(R) {
      const M = [];
      for (const H of Object.keys(t)) _(H, R) && M.push(H);
      await Promise.all(M.map(B)), (f = $());
    },
    async runAll() {
      const R = Object.keys(t);
      await Promise.all(
        R.map((M) => (u(M).enabled ? B(M) : Promise.resolve())),
      ),
        (f = $());
    },
    disable(R) {
      const M = u(R);
      M.enabled = !1;
    },
    enable(R) {
      const M = u(R);
      M.enabled = !0;
    },
    isEnabled(R) {
      return u(R).enabled;
    },
    cleanupAll() {
      y = !0;
      for (const R of d.values()) I(R);
    },
    registerDefinitions(R) {
      for (const [M, H] of Object.entries(R)) (t[M] = H), m(M);
    },
  };
}
function Jt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: n = 2,
      maxDelayMs: r = 3e4,
    } = e,
    o = new Map();
  function d(f) {
    const y = t * Math.pow(n, f - 1);
    return Math.min(y, r);
  }
  return {
    scheduleRetry(f, y, m, u, $) {
      if (u > l) return null;
      const _ = d(u),
        I = {
          source: f,
          sourceId: y,
          context: m,
          attempt: u,
          nextRetryTime: Date.now() + _,
          callback: $,
        };
      return o.set(y, I), I;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const f = Date.now(),
        y = [];
      for (const [m, u] of o) u.nextRetryTime <= f && (y.push(u), o.delete(m));
      return y;
    },
    cancelRetry(f) {
      o.delete(f);
    },
    clearAll() {
      o.clear();
    },
  };
}
var Yt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function Xt(e = {}) {
  const { config: t = {}, onError: l, onRecovery: n } = e,
    r = [],
    o = 100,
    d = Jt(t.retryLater),
    f = new Map();
  function y(u, $, _, I) {
    if (_ instanceof et) return _;
    const q = _ instanceof Error ? _.message : String(_),
      B = u !== "system";
    return new et(q, u, $, I, B);
  }
  function m(u, $, _) {
    const I = (() => {
      switch (u) {
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
    if (typeof I == "function") {
      try {
        I(_, $);
      } catch (q) {
        console.error("[Directive] Error in error handler callback:", q);
      }
      return "skip";
    }
    return typeof I == "string" ? I : Yt[u];
  }
  return {
    handleError(u, $, _, I) {
      const q = y(u, $, _, I);
      r.push(q), r.length > o && r.shift();
      try {
        l?.(q);
      } catch (R) {
        console.error("[Directive] Error in onError callback:", R);
      }
      try {
        t.onError?.(q);
      } catch (R) {
        console.error("[Directive] Error in config.onError callback:", R);
      }
      let B = m(u, $, _ instanceof Error ? _ : new Error(String(_)));
      if (B === "retry-later") {
        const R = (f.get($) ?? 0) + 1;
        f.set($, R),
          d.scheduleRetry(u, $, I, R) ||
            ((B = "skip"), f.delete($), typeof process < "u");
      }
      try {
        n?.(q, B);
      } catch (R) {
        console.error("[Directive] Error in onRecovery callback:", R);
      }
      if (B === "throw") throw q;
      return B;
    },
    getLastError() {
      return r[r.length - 1] ?? null;
    },
    getAllErrors() {
      return [...r];
    },
    clearErrors() {
      r.length = 0;
    },
    getRetryLaterManager() {
      return d;
    },
    processDueRetries() {
      return d.processDueRetries();
    },
    clearRetryAttempts(u) {
      f.delete(u), d.cancelRetry(u);
    },
  };
}
function Gt() {
  const e = [];
  function t(n) {
    if (n)
      try {
        return n();
      } catch (r) {
        console.error("[Directive] Plugin error:", r);
        return;
      }
  }
  async function l(n) {
    if (n)
      try {
        return await n();
      } catch (r) {
        console.error("[Directive] Plugin error:", r);
        return;
      }
  }
  return {
    register(n) {
      e.some((r) => r.name === n.name) &&
        (console.warn(
          `[Directive] Plugin "${n.name}" is already registered, replacing...`,
        ),
        this.unregister(n.name)),
        e.push(n);
    },
    unregister(n) {
      const r = e.findIndex((o) => o.name === n);
      r !== -1 && e.splice(r, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(n) {
      for (const r of e) await l(() => r.onInit?.(n));
    },
    emitStart(n) {
      for (const r of e) t(() => r.onStart?.(n));
    },
    emitStop(n) {
      for (const r of e) t(() => r.onStop?.(n));
    },
    emitDestroy(n) {
      for (const r of e) t(() => r.onDestroy?.(n));
    },
    emitFactSet(n, r, o) {
      for (const d of e) t(() => d.onFactSet?.(n, r, o));
    },
    emitFactDelete(n, r) {
      for (const o of e) t(() => o.onFactDelete?.(n, r));
    },
    emitFactsBatch(n) {
      for (const r of e) t(() => r.onFactsBatch?.(n));
    },
    emitDerivationCompute(n, r, o) {
      for (const d of e) t(() => d.onDerivationCompute?.(n, r, o));
    },
    emitDerivationInvalidate(n) {
      for (const r of e) t(() => r.onDerivationInvalidate?.(n));
    },
    emitReconcileStart(n) {
      for (const r of e) t(() => r.onReconcileStart?.(n));
    },
    emitReconcileEnd(n) {
      for (const r of e) t(() => r.onReconcileEnd?.(n));
    },
    emitConstraintEvaluate(n, r) {
      for (const o of e) t(() => o.onConstraintEvaluate?.(n, r));
    },
    emitConstraintError(n, r) {
      for (const o of e) t(() => o.onConstraintError?.(n, r));
    },
    emitRequirementCreated(n) {
      for (const r of e) t(() => r.onRequirementCreated?.(n));
    },
    emitRequirementMet(n, r) {
      for (const o of e) t(() => o.onRequirementMet?.(n, r));
    },
    emitRequirementCanceled(n) {
      for (const r of e) t(() => r.onRequirementCanceled?.(n));
    },
    emitResolverStart(n, r) {
      for (const o of e) t(() => o.onResolverStart?.(n, r));
    },
    emitResolverComplete(n, r, o) {
      for (const d of e) t(() => d.onResolverComplete?.(n, r, o));
    },
    emitResolverError(n, r, o) {
      for (const d of e) t(() => d.onResolverError?.(n, r, o));
    },
    emitResolverRetry(n, r, o) {
      for (const d of e) t(() => d.onResolverRetry?.(n, r, o));
    },
    emitResolverCancel(n, r) {
      for (const o of e) t(() => o.onResolverCancel?.(n, r));
    },
    emitEffectRun(n) {
      for (const r of e) t(() => r.onEffectRun?.(n));
    },
    emitEffectError(n, r) {
      for (const o of e) t(() => o.onEffectError?.(n, r));
    },
    emitSnapshot(n) {
      for (const r of e) t(() => r.onSnapshot?.(n));
    },
    emitTimeTravel(n, r) {
      for (const o of e) t(() => o.onTimeTravel?.(n, r));
    },
    emitError(n) {
      for (const r of e) t(() => r.onError?.(n));
    },
    emitErrorRecovery(n, r) {
      for (const o of e) t(() => o.onErrorRecovery?.(n, r));
    },
    emitRunComplete(n) {
      for (const r of e) t(() => r.onRunComplete?.(n));
    },
  };
}
var rt = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  nt = { enabled: !1, windowMs: 50 };
function it(e, t) {
  let { backoff: l, initialDelay: n = 100, maxDelay: r = 3e4 } = e,
    o;
  switch (l) {
    case "none":
      o = n;
      break;
    case "linear":
      o = n * t;
      break;
    case "exponential":
      o = n * Math.pow(2, t - 1);
      break;
    default:
      o = n;
  }
  return Math.max(1, Math.min(o, r));
}
function Qt(e) {
  const {
      definitions: t,
      facts: l,
      store: n,
      onStart: r,
      onComplete: o,
      onError: d,
      onRetry: f,
      onCancel: y,
      onResolutionComplete: m,
    } = e,
    u = new Map(),
    $ = new Map(),
    _ = 1e3,
    I = new Map(),
    q = new Map(),
    B = 1e3;
  function R() {
    if ($.size > _) {
      const h = $.size - _,
        w = $.keys();
      for (let A = 0; A < h; A++) {
        const j = w.next().value;
        j && $.delete(j);
      }
    }
  }
  function M(h) {
    return (
      typeof h == "object" &&
      h !== null &&
      "requirement" in h &&
      typeof h.requirement == "string"
    );
  }
  function H(h) {
    return (
      typeof h == "object" &&
      h !== null &&
      "requirement" in h &&
      typeof h.requirement == "function"
    );
  }
  function T(h, w) {
    return M(h) ? w.type === h.requirement : H(h) ? h.requirement(w) : !1;
  }
  function c(h) {
    const w = h.type,
      A = q.get(w);
    if (A)
      for (const j of A) {
        const N = t[j];
        if (N && T(N, h)) return j;
      }
    for (const [j, N] of Object.entries(t))
      if (T(N, h)) {
        if (!q.has(w)) {
          if (q.size >= B) {
            const F = q.keys().next().value;
            F !== void 0 && q.delete(F);
          }
          q.set(w, []);
        }
        const W = q.get(w);
        return W.includes(j) || W.push(j), j;
      }
    return null;
  }
  function x(h) {
    return { facts: l, signal: h, snapshot: () => l.$snapshot() };
  }
  async function v(h, w, A) {
    const j = t[h];
    if (!j) return;
    let N = { ...rt, ...j.retry },
      W = null;
    for (let F = 1; F <= N.attempts; F++) {
      if (A.signal.aborted) return;
      const b = u.get(w.id);
      b &&
        ((b.attempt = F),
        (b.status = {
          state: "running",
          requirementId: w.id,
          startedAt: b.startedAt,
          attempt: F,
        }));
      try {
        const k = x(A.signal);
        if (j.resolve) {
          let i;
          n.batch(() => {
            i = j.resolve(w.requirement, k);
          });
          const p = j.timeout;
          p && p > 0
            ? await _e(i, p, `Resolver "${h}" timed out after ${p}ms`)
            : await i;
        }
        const a = Date.now() - (b?.startedAt ?? Date.now());
        $.set(w.id, {
          state: "success",
          requirementId: w.id,
          completedAt: Date.now(),
          duration: a,
        }),
          R(),
          o?.(h, w, a);
        return;
      } catch (k) {
        if (
          ((W = k instanceof Error ? k : new Error(String(k))),
          A.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(W, F)) break;
        if (F < N.attempts) {
          if (A.signal.aborted) return;
          const a = it(N, F);
          if (
            (f?.(h, w, F + 1),
            await new Promise((i) => {
              const p = setTimeout(i, a),
                S = () => {
                  clearTimeout(p), i();
                };
              A.signal.addEventListener("abort", S, { once: !0 });
            }),
            A.signal.aborted)
          )
            return;
        }
      }
    }
    $.set(w.id, {
      state: "error",
      requirementId: w.id,
      error: W,
      failedAt: Date.now(),
      attempts: N.attempts,
    }),
      R(),
      d?.(h, w, W);
  }
  async function C(h, w) {
    const A = t[h];
    if (!A) return;
    if (!A.resolveBatch && !A.resolveBatchWithResults) {
      await Promise.all(
        w.map((a) => {
          const i = new AbortController();
          return v(h, a, i);
        }),
      );
      return;
    }
    let j = { ...rt, ...A.retry },
      N = { ...nt, ...A.batch },
      W = new AbortController(),
      F = Date.now(),
      b = null,
      k = N.timeoutMs ?? A.timeout;
    for (let a = 1; a <= j.attempts; a++) {
      if (W.signal.aborted) return;
      try {
        const i = x(W.signal),
          p = w.map((S) => S.requirement);
        if (A.resolveBatchWithResults) {
          let S, E;
          if (
            (n.batch(() => {
              E = A.resolveBatchWithResults(p, i);
            }),
            k && k > 0
              ? (S = await _e(
                  E,
                  k,
                  `Batch resolver "${h}" timed out after ${k}ms`,
                ))
              : (S = await E),
            S.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${h}" returned ${S.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let U = Date.now() - F,
            Q = !1;
          for (let ee = 0; ee < w.length; ee++) {
            const K = w[ee],
              re = S[ee];
            if (re.success)
              $.set(K.id, {
                state: "success",
                requirementId: K.id,
                completedAt: Date.now(),
                duration: U,
              }),
                o?.(h, K, U);
            else {
              Q = !0;
              const se = re.error ?? new Error("Batch item failed");
              $.set(K.id, {
                state: "error",
                requirementId: K.id,
                error: se,
                failedAt: Date.now(),
                attempts: a,
              }),
                d?.(h, K, se);
            }
          }
          if (!Q || w.some((ee, K) => S[K]?.success)) return;
        } else {
          let S;
          n.batch(() => {
            S = A.resolveBatch(p, i);
          }),
            k && k > 0
              ? await _e(S, k, `Batch resolver "${h}" timed out after ${k}ms`)
              : await S;
          const E = Date.now() - F;
          for (const U of w)
            $.set(U.id, {
              state: "success",
              requirementId: U.id,
              completedAt: Date.now(),
              duration: E,
            }),
              o?.(h, U, E);
          return;
        }
      } catch (i) {
        if (
          ((b = i instanceof Error ? i : new Error(String(i))),
          W.signal.aborted)
        )
          return;
        if (j.shouldRetry && !j.shouldRetry(b, a)) break;
        if (a < j.attempts) {
          const p = it(j, a);
          for (const S of w) f?.(h, S, a + 1);
          if (
            (await new Promise((S) => {
              const E = setTimeout(S, p),
                U = () => {
                  clearTimeout(E), S();
                };
              W.signal.addEventListener("abort", U, { once: !0 });
            }),
            W.signal.aborted)
          )
            return;
        }
      }
    }
    for (const a of w)
      $.set(a.id, {
        state: "error",
        requirementId: a.id,
        error: b,
        failedAt: Date.now(),
        attempts: j.attempts,
      }),
        d?.(h, a, b);
    R();
  }
  function D(h, w) {
    const A = t[h];
    if (!A) return;
    const j = { ...nt, ...A.batch };
    I.has(h) || I.set(h, { resolverId: h, requirements: [], timer: null });
    const N = I.get(h);
    N.requirements.push(w),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        L(h);
      }, j.windowMs));
  }
  function L(h) {
    const w = I.get(h);
    if (!w || w.requirements.length === 0) return;
    const A = [...w.requirements];
    (w.requirements = []),
      (w.timer = null),
      C(h, A).then(() => {
        m?.();
      });
  }
  return {
    resolve(h) {
      if (u.has(h.id)) return;
      const w = c(h.requirement);
      if (!w) {
        console.warn(`[Directive] No resolver found for requirement: ${h.id}`);
        return;
      }
      const A = t[w];
      if (!A) return;
      if (A.batch?.enabled) {
        D(w, h);
        return;
      }
      const j = new AbortController(),
        N = Date.now(),
        W = {
          requirementId: h.id,
          resolverId: w,
          controller: j,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: h.id, startedAt: N },
          originalRequirement: h,
        };
      u.set(h.id, W),
        r?.(w, h),
        v(w, h, j).finally(() => {
          u.delete(h.id) && m?.();
        });
    },
    cancel(h) {
      const w = u.get(h);
      w &&
        (w.controller.abort(),
        u.delete(h),
        $.set(h, {
          state: "canceled",
          requirementId: h,
          canceledAt: Date.now(),
        }),
        R(),
        y?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [h] of u) this.cancel(h);
      for (const h of I.values()) h.timer && clearTimeout(h.timer);
      I.clear();
    },
    getStatus(h) {
      const w = u.get(h);
      return w ? w.status : $.get(h) || { state: "idle" };
    },
    getInflight() {
      return [...u.keys()];
    },
    getInflightInfo() {
      return [...u.values()].map((h) => ({
        id: h.requirementId,
        resolverId: h.resolverId,
        startedAt: h.startedAt,
      }));
    },
    isResolving(h) {
      return u.has(h);
    },
    processBatches() {
      for (const h of I.keys()) L(h);
    },
    registerDefinitions(h) {
      for (const [w, A] of Object.entries(h)) t[w] = A;
      q.clear();
    },
  };
}
function Zt(e) {
  let { config: t, facts: l, store: n, onSnapshot: r, onTimeTravel: o } = e,
    d = t.timeTravel ?? !1,
    f = t.maxSnapshots ?? 100,
    y = [],
    m = -1,
    u = 1,
    $ = !1,
    _ = !1,
    I = [],
    q = null,
    B = -1;
  function R() {
    return n.toObject();
  }
  function M() {
    const T = R();
    return structuredClone(T);
  }
  function H(T) {
    if (!ze(T)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    n.batch(() => {
      for (const [c, x] of Object.entries(T)) {
        if (c === "__proto__" || c === "constructor" || c === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${c}" during fact restoration`,
          );
          continue;
        }
        l[c] = x;
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
      return $;
    },
    get snapshots() {
      return [...y];
    },
    get currentIndex() {
      return m;
    },
    takeSnapshot(T) {
      if (!d || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: T };
      const c = { id: u++, timestamp: Date.now(), facts: M(), trigger: T };
      for (
        m < y.length - 1 && y.splice(m + 1), y.push(c), m = y.length - 1;
        y.length > f;
      )
        y.shift(), m--;
      return r?.(c), c;
    },
    restore(T) {
      if (d) {
        ($ = !0), (_ = !0);
        try {
          H(T.facts);
        } finally {
          ($ = !1), (_ = !1);
        }
      }
    },
    goBack(T = 1) {
      if (!d || y.length === 0) return;
      let c = m,
        x = m,
        v = I.find((D) => m > D.startIndex && m <= D.endIndex);
      if (v) x = v.startIndex;
      else if (I.find((D) => m === D.startIndex)) {
        const D = I.find((L) => L.endIndex < m && m - L.endIndex <= T);
        x = D ? D.startIndex : Math.max(0, m - T);
      } else x = Math.max(0, m - T);
      if (c === x) return;
      m = x;
      const C = y[m];
      C && (this.restore(C), o?.(c, x));
    },
    goForward(T = 1) {
      if (!d || y.length === 0) return;
      let c = m,
        x = m,
        v = I.find((D) => m >= D.startIndex && m < D.endIndex);
      if ((v ? (x = v.endIndex) : (x = Math.min(y.length - 1, m + T)), c === x))
        return;
      m = x;
      const C = y[m];
      C && (this.restore(C), o?.(c, x));
    },
    goTo(T) {
      if (!d) return;
      const c = y.findIndex((C) => C.id === T);
      if (c === -1) {
        console.warn(`[Directive] Snapshot ${T} not found`);
        return;
      }
      const x = m;
      m = c;
      const v = y[m];
      v && (this.restore(v), o?.(x, c));
    },
    replay() {
      if (!d || y.length === 0) return;
      m = 0;
      const T = y[0];
      T && this.restore(T);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: y, currentIndex: m });
    },
    import(T) {
      if (d)
        try {
          const c = JSON.parse(T);
          if (typeof c != "object" || c === null)
            throw new Error("Invalid time-travel data: expected object");
          if (c.version !== 1)
            throw new Error(
              `Unsupported time-travel export version: ${c.version}`,
            );
          if (!Array.isArray(c.snapshots))
            throw new Error(
              "Invalid time-travel data: snapshots must be an array",
            );
          if (typeof c.currentIndex != "number")
            throw new Error(
              "Invalid time-travel data: currentIndex must be a number",
            );
          for (const v of c.snapshots) {
            if (typeof v != "object" || v === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof v.id != "number" ||
              typeof v.timestamp != "number" ||
              typeof v.trigger != "string" ||
              typeof v.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!ze(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (y.length = 0), y.push(...c.snapshots), (m = c.currentIndex);
          const x = y[m];
          x && this.restore(x);
        } catch (c) {
          console.error("[Directive] Failed to import time-travel data:", c);
        }
    },
    beginChangeset(T) {
      d && ((q = T), (B = m));
    },
    endChangeset() {
      !d ||
        q === null ||
        (m > B && I.push({ label: q, startIndex: B, endIndex: m }),
        (q = null),
        (B = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function er() {
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
var Ee = new Set(["__proto__", "constructor", "prototype"]);
function Ct(e) {
  const t = Object.create(null),
    l = Object.create(null),
    n = Object.create(null),
    r = Object.create(null),
    o = Object.create(null),
    d = Object.create(null);
  for (const s of e.modules) {
    const g = (O, V) => {
      if (O) {
        for (const G of Object.keys(O))
          if (Ee.has(G))
            throw new Error(
              `[Directive] Security: Module "${s.id}" has dangerous key "${G}" in ${V}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    g(s.schema, "schema"),
      g(s.events, "events"),
      g(s.derive, "derive"),
      g(s.effects, "effects"),
      g(s.constraints, "constraints"),
      g(s.resolvers, "resolvers"),
      Object.assign(t, s.schema),
      s.events && Object.assign(l, s.events),
      s.derive && Object.assign(n, s.derive),
      s.effects && Object.assign(r, s.effects),
      s.constraints && Object.assign(o, s.constraints),
      s.resolvers && Object.assign(d, s.resolvers);
  }
  let f = null;
  if (e.modules.some((s) => s.snapshotEvents)) {
    f = new Set();
    for (const s of e.modules) {
      const g = s;
      if (g.snapshotEvents) for (const O of g.snapshotEvents) f.add(O);
      else if (g.events) for (const O of Object.keys(g.events)) f.add(O);
    }
  }
  let y = 0,
    m = !1,
    u = Gt();
  for (const s of e.plugins ?? []) u.register(s);
  let $ = Xt({
      config: e.errorBoundary,
      onError: (s) => u.emitError(s),
      onRecovery: (s, g) => u.emitErrorRecovery(s, g),
    }),
    _ = () => {},
    I = () => {},
    q = null,
    B = e.debug?.runHistory ?? !1,
    R = e.debug?.maxRuns ?? 100,
    M = [],
    H = new Map(),
    T = 0,
    c = null,
    x = [],
    v = new Map(),
    C = new Map(),
    D = new Map(),
    L = null,
    h = 0,
    w = 0,
    A = {
      count: 0,
      totalDuration: 0,
      avgDuration: 0,
      maxDuration: 0,
      avgResolverCount: 0,
      totalResolverCount: 0,
      avgFactChangeCount: 0,
      totalFactChangeCount: 0,
    },
    { store: j, facts: N } = Lt({
      schema: t,
      onChange: (s, g, O) => {
        u.emitFactSet(s, g, O),
          _(s),
          B && x.push({ key: String(s), oldValue: O, newValue: g }),
          !q?.isRestoring && (y === 0 && (m = !0), P.changedKeys.add(s), ce());
      },
      onBatch: (s) => {
        u.emitFactsBatch(s);
        const g = [];
        for (const O of s) g.push(O.key);
        if (B)
          for (const O of s)
            O.type === "delete"
              ? x.push({ key: O.key, oldValue: O.prev, newValue: void 0 })
              : x.push({ key: O.key, oldValue: O.prev, newValue: O.value });
        if ((I(g), !q?.isRestoring)) {
          y === 0 && (m = !0);
          for (const O of s) P.changedKeys.add(O.key);
          ce();
        }
      },
    }),
    W = Vt({
      definitions: n,
      facts: N,
      onCompute: (s, g, O, V) => {
        u.emitDerivationCompute(s, g, V),
          c &&
            c.derivationsRecomputed.push({
              id: s,
              deps: V ? [...V] : [],
              oldValue: O,
              newValue: g,
            });
      },
      onInvalidate: (s) => u.emitDerivationInvalidate(s),
      onError: (s, g) => {
        $.handleError("derivation", s, g);
      },
    });
  (_ = (s) => W.invalidate(s)), (I = (s) => W.invalidateMany(s));
  const F = Ut({
      definitions: r,
      facts: N,
      store: j,
      onRun: (s, g) => {
        u.emitEffectRun(s), c && c.effectsRun.push({ id: s, triggeredBy: g });
      },
      onError: (s, g) => {
        $.handleError("effect", s, g),
          u.emitEffectError(s, g),
          c && c.effectErrors.push({ id: s, error: String(g) });
      },
    }),
    b = Kt({
      definitions: o,
      facts: N,
      onEvaluate: (s, g) => u.emitConstraintEvaluate(s, g),
      onError: (s, g) => {
        $.handleError("constraint", s, g), u.emitConstraintError(s, g);
      },
    });
  function k(s) {
    const g = H.get(s);
    if (g && g.status === "pending") {
      g.status = "settled";
      const O = D.get(s);
      (g.duration =
        O !== void 0 ? performance.now() - O : Date.now() - g.timestamp),
        D.delete(s),
        C.delete(s),
        (g.causalChain = p(g)),
        S(g),
        w++,
        u.emitRunComplete(g);
    }
  }
  function a(s) {
    const g = v.get(s);
    if ((v.delete(s), g !== void 0)) {
      const O = (C.get(g) ?? 1) - 1;
      O <= 0 ? k(g) : C.set(g, O);
    }
  }
  function i() {
    const s = M.shift();
    if (s && (H.delete(s.id), D.delete(s.id), s.status === "pending")) {
      C.delete(s.id);
      for (const [g, O] of v) O === s.id && v.delete(g);
    }
  }
  function p(s) {
    const g = [];
    for (const O of s.factChanges) g.push(`${O.key} changed`);
    for (const O of s.derivationsRecomputed) g.push(`${O.id} recomputed`);
    for (const O of s.constraintsHit) g.push(`${O.id} constraint hit`);
    for (const O of s.requirementsAdded) g.push(`${O.type} requirement added`);
    for (const O of s.resolversCompleted)
      g.push(`${O.resolver} resolved (${O.duration.toFixed(0)}ms)`);
    for (const O of s.resolversErrored) g.push(`${O.resolver} errored`);
    for (const O of s.effectsRun) g.push(`${O.id} effect ran`);
    return g.join(" → ");
  }
  function S(s) {
    A.count++,
      (A.totalDuration += s.duration),
      (A.avgDuration = A.totalDuration / A.count),
      s.duration > A.maxDuration && (A.maxDuration = s.duration);
    const g = s.resolversStarted.length;
    (A.totalResolverCount += g),
      (A.avgResolverCount = A.totalResolverCount / A.count);
    const O = s.factChanges.length;
    (A.totalFactChangeCount += O),
      (A.avgFactChangeCount = A.totalFactChangeCount / A.count);
    const V = [];
    A.count > 3 &&
      s.duration > A.avgDuration * 5 &&
      V.push(
        `Duration ${s.duration.toFixed(0)}ms is 5x+ above average (${A.avgDuration.toFixed(0)}ms)`,
      ),
      s.resolversErrored.length > 0 &&
        V.push(`${s.resolversErrored.length} resolver(s) errored`),
      V.length > 0 && (s.anomalies = V);
  }
  const E = Qt({
      definitions: d,
      facts: N,
      store: j,
      onStart: (s, g) => u.emitResolverStart(s, g),
      onComplete: (s, g, O) => {
        if (
          (u.emitResolverComplete(s, g, O),
          u.emitRequirementMet(g, s),
          b.markResolved(g.fromConstraint),
          B)
        ) {
          const V = v.get(g.id);
          if (V !== void 0) {
            const G = H.get(V);
            G &&
              G.resolversCompleted.push({
                resolver: s,
                requirementId: g.id,
                duration: O,
              });
          }
          a(g.id);
        }
      },
      onError: (s, g, O) => {
        if (
          ($.handleError("resolver", s, O, g), u.emitResolverError(s, g, O), B)
        ) {
          const V = v.get(g.id);
          if (V !== void 0) {
            const G = H.get(V);
            G &&
              G.resolversErrored.push({
                resolver: s,
                requirementId: g.id,
                error: String(O),
              });
          }
          a(g.id);
        }
      },
      onRetry: (s, g, O) => u.emitResolverRetry(s, g, O),
      onCancel: (s, g) => {
        u.emitResolverCancel(s, g), u.emitRequirementCanceled(g), B && a(g.id);
      },
      onResolutionComplete: () => {
        re(), ce();
      },
    }),
    U = new Set();
  function Q() {
    for (const s of U) s();
  }
  const ee = e.debug?.timeTravel
    ? Zt({
        config: e.debug,
        facts: N,
        store: j,
        onSnapshot: (s) => {
          u.emitSnapshot(s), Q();
        },
        onTimeTravel: (s, g) => {
          u.emitTimeTravel(s, g), Q();
        },
      })
    : er();
  q = ee;
  const K = new Set();
  function re() {
    for (const s of K) s();
  }
  let se = 50,
    me = 0,
    P = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Ge(),
      readyPromise: null,
      readyResolve: null,
    };
  function ce() {
    !P.isRunning ||
      P.reconcileScheduled ||
      P.isInitializing ||
      ((P.reconcileScheduled = !0),
      re(),
      queueMicrotask(() => {
        (P.reconcileScheduled = !1),
          P.isRunning && !P.isInitializing && Y().catch((s) => {});
      }));
  }
  async function Y() {
    if (P.isReconciling) return;
    if ((me++, me > se)) {
      B && (x.length = 0), (me = 0);
      return;
    }
    (P.isReconciling = !0), re();
    const s = B ? performance.now() : 0;
    if (B) {
      const g = ++T;
      D.set(g, s),
        (c = {
          id: g,
          timestamp: Date.now(),
          duration: 0,
          status: "pending",
          factChanges: x.splice(0),
          derivationsRecomputed: [],
          constraintsHit: [],
          requirementsAdded: [],
          requirementsRemoved: [],
          resolversStarted: [],
          resolversCompleted: [],
          resolversErrored: [],
          effectsRun: [],
          effectErrors: [],
        });
    }
    try {
      P.changedKeys.size > 0 &&
        ((f === null || m) &&
          ee.takeSnapshot(`facts-changed:${[...P.changedKeys].join(",")}`),
        (m = !1));
      const g = N.$snapshot();
      u.emitReconcileStart(g), await F.runEffects(P.changedKeys);
      const O = new Set(P.changedKeys);
      P.changedKeys.clear();
      const V = await b.evaluate(O),
        G = new Ge();
      for (const Z of V) G.add(Z), u.emitRequirementCreated(Z);
      if (c) {
        const Z = new Set(V.map((ue) => ue.fromConstraint));
        for (const ue of Z) {
          const we = b.getState(ue);
          if (we) {
            const ge = b.getDependencies(ue);
            c.constraintsHit.push({
              id: ue,
              priority: we.priority,
              deps: ge ? [...ge] : [],
            });
          }
        }
      }
      const { added: X, removed: ie } = G.diff(P.previousRequirements);
      if (c) {
        for (const Z of X)
          c.requirementsAdded.push({
            id: Z.id,
            type: Z.requirement.type,
            fromConstraint: Z.fromConstraint,
          });
        for (const Z of ie)
          c.requirementsRemoved.push({
            id: Z.id,
            type: Z.requirement.type,
            fromConstraint: Z.fromConstraint,
          });
      }
      for (const Z of ie) E.cancel(Z.id);
      for (const Z of X) E.resolve(Z);
      if (c) {
        const Z = E.getInflightInfo();
        for (const ue of X) {
          const we = Z.find((ge) => ge.id === ue.id);
          c.resolversStarted.push({
            resolver: we?.resolverId ?? "unknown",
            requirementId: ue.id,
          }),
            v.set(ue.id, c.id);
        }
      }
      P.previousRequirements = G;
      const ae = E.getInflightInfo(),
        be = {
          unmet: V.filter((Z) => !E.isResolving(Z.id)),
          inflight: ae,
          completed: [],
          canceled: ie.map((Z) => ({
            id: Z.id,
            resolverId:
              ae.find((ue) => ue.id === Z.id)?.resolverId ?? "unknown",
          })),
        };
      u.emitReconcileEnd(be),
        P.isReady ||
          ((P.isReady = !0),
          P.readyResolve && (P.readyResolve(), (P.readyResolve = null)));
    } finally {
      if (c) {
        if (
          ((c.duration = performance.now() - s),
          c.factChanges.length > 0 ||
            c.constraintsHit.length > 0 ||
            c.requirementsAdded.length > 0 ||
            c.effectsRun.length > 0)
        ) {
          const g = c.resolversStarted.length;
          g === 0
            ? ((c.status = "settled"),
              (c.causalChain = p(c)),
              S(c),
              M.push(c),
              H.set(c.id, c),
              M.length > R && i(),
              w++,
              u.emitRunComplete(c))
            : ((c.status = "pending"),
              M.push(c),
              H.set(c.id, c),
              M.length > R && i(),
              w++,
              C.set(c.id, g));
        } else D.delete(c.id);
        c = null;
      }
      (P.isReconciling = !1),
        P.changedKeys.size > 0 ? ce() : P.reconcileScheduled || (me = 0),
        re();
    }
  }
  const te = new Proxy(
      {},
      {
        get(s, g) {
          if (typeof g != "symbol" && !Ee.has(g)) return W.get(g);
        },
        has(s, g) {
          return typeof g == "symbol" || Ee.has(g) ? !1 : g in n;
        },
        ownKeys() {
          return Object.keys(n);
        },
        getOwnPropertyDescriptor(s, g) {
          if (typeof g != "symbol" && !Ee.has(g) && g in n)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    ne = new Proxy(
      {},
      {
        get(s, g) {
          if (typeof g != "symbol" && !Ee.has(g))
            return (O) => {
              const V = l[g];
              if (V) {
                y++, (f === null || f.has(g)) && (m = !0);
                try {
                  j.batch(() => {
                    V(N, { type: g, ...O });
                  });
                } finally {
                  y--;
                }
              }
            };
        },
        has(s, g) {
          return typeof g == "symbol" || Ee.has(g) ? !1 : g in l;
        },
        ownKeys() {
          return Object.keys(l);
        },
        getOwnPropertyDescriptor(s, g) {
          if (typeof g != "symbol" && !Ee.has(g) && g in l)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    oe = {
      facts: N,
      debug: ee.isEnabled ? ee : null,
      derive: te,
      events: ne,
      constraints: {
        disable: (s) => b.disable(s),
        enable: (s) => b.enable(s),
        isDisabled: (s) => b.isDisabled(s),
      },
      effects: {
        disable: (s) => F.disable(s),
        enable: (s) => F.enable(s),
        isEnabled: (s) => F.isEnabled(s),
      },
      get runHistory() {
        return B ? ((!L || h !== w) && ((L = [...M]), (h = w)), L) : null;
      },
      initialize() {
        if (!P.isInitialized) {
          P.isInitializing = !0;
          for (const s of e.modules)
            s.init &&
              j.batch(() => {
                s.init(N);
              });
          e.onAfterModuleInit &&
            j.batch(() => {
              e.onAfterModuleInit();
            }),
            (P.isInitializing = !1),
            (P.isInitialized = !0);
          for (const s of Object.keys(n)) W.get(s);
        }
      },
      start() {
        if (!P.isRunning) {
          P.isInitialized || this.initialize(), (P.isRunning = !0);
          for (const s of e.modules) s.hooks?.onStart?.(oe);
          u.emitStart(oe), ce();
        }
      },
      stop() {
        if (P.isRunning) {
          (P.isRunning = !1), E.cancelAll(), F.cleanupAll();
          for (const s of e.modules) s.hooks?.onStop?.(oe);
          u.emitStop(oe);
        }
      },
      destroy() {
        this.stop(),
          (P.isDestroyed = !0),
          K.clear(),
          U.clear(),
          (M.length = 0),
          H.clear(),
          v.clear(),
          C.clear(),
          D.clear(),
          (x.length = 0),
          (c = null),
          (L = null),
          u.emitDestroy(oe);
      },
      dispatch(s) {
        if (Ee.has(s.type)) return;
        const g = l[s.type];
        if (g) {
          y++, (f === null || f.has(s.type)) && (m = !0);
          try {
            j.batch(() => {
              g(N, s);
            });
          } finally {
            y--;
          }
        }
      },
      read(s) {
        return W.get(s);
      },
      subscribe(s, g) {
        const O = [],
          V = [];
        for (const X of s) X in n ? O.push(X) : X in t && V.push(X);
        const G = [];
        return (
          O.length > 0 && G.push(W.subscribe(O, g)),
          V.length > 0 && G.push(j.subscribe(V, g)),
          () => {
            for (const X of G) X();
          }
        );
      },
      watch(s, g, O) {
        const V = O?.equalityFn
          ? (X, ie) => O.equalityFn(X, ie)
          : (X, ie) => Object.is(X, ie);
        if (s in n) {
          let X = W.get(s);
          return W.subscribe([s], () => {
            const ie = W.get(s);
            if (!V(ie, X)) {
              const ae = X;
              (X = ie), g(ie, ae);
            }
          });
        }
        let G = j.get(s);
        return j.subscribe([s], () => {
          const X = j.get(s);
          if (!V(X, G)) {
            const ie = G;
            (G = X), g(X, ie);
          }
        });
      },
      when(s, g) {
        return new Promise((O, V) => {
          const G = j.toObject();
          if (s(G)) {
            O();
            return;
          }
          let X,
            ie,
            ae = () => {
              X?.(), ie !== void 0 && clearTimeout(ie);
            };
          (X = j.subscribeAll(() => {
            const be = j.toObject();
            s(be) && (ae(), O());
          })),
            g?.timeout !== void 0 &&
              g.timeout > 0 &&
              (ie = setTimeout(() => {
                ae(),
                  V(
                    new Error(
                      `[Directive] when: timed out after ${g.timeout}ms`,
                    ),
                  );
              }, g.timeout));
        });
      },
      inspect() {
        return {
          unmet: P.previousRequirements.all(),
          inflight: E.getInflightInfo(),
          constraints: b
            .getAllStates()
            .map((s) => ({
              id: s.id,
              active: s.lastResult ?? !1,
              disabled: b.isDisabled(s.id),
              priority: s.priority,
              hitCount: s.hitCount,
              lastActiveAt: s.lastActiveAt,
            })),
          resolvers: Object.fromEntries(
            E.getInflight().map((s) => [s, E.getStatus(s)]),
          ),
          resolverDefs: Object.entries(d).map(([s, g]) => ({
            id: s,
            requirement:
              typeof g.requirement == "string" ? g.requirement : "(predicate)",
          })),
          runHistoryEnabled: B,
          ...(B
            ? {
                runHistory: M.map((s) => ({
                  ...s,
                  factChanges: s.factChanges.map((g) => ({ ...g })),
                  derivationsRecomputed: s.derivationsRecomputed.map((g) => ({
                    ...g,
                    deps: [...g.deps],
                  })),
                  constraintsHit: s.constraintsHit.map((g) => ({
                    ...g,
                    deps: [...g.deps],
                  })),
                  requirementsAdded: s.requirementsAdded.map((g) => ({ ...g })),
                  requirementsRemoved: s.requirementsRemoved.map((g) => ({
                    ...g,
                  })),
                  resolversStarted: s.resolversStarted.map((g) => ({ ...g })),
                  resolversCompleted: s.resolversCompleted.map((g) => ({
                    ...g,
                  })),
                  resolversErrored: s.resolversErrored.map((g) => ({ ...g })),
                  effectsRun: s.effectsRun.map((g) => ({
                    ...g,
                    triggeredBy: [...g.triggeredBy],
                  })),
                  effectErrors: s.effectErrors.map((g) => ({ ...g })),
                })),
              }
            : {}),
        };
      },
      explain(s) {
        const g = P.previousRequirements.all().find((Z) => Z.id === s);
        if (!g) return null;
        const O = b.getState(g.fromConstraint),
          V = E.getStatus(s),
          G = {},
          X = j.toObject();
        for (const [Z, ue] of Object.entries(X)) G[Z] = ue;
        const ie = [
            `Requirement "${g.requirement.type}" (id: ${g.id})`,
            `├─ Produced by constraint: ${g.fromConstraint}`,
            `├─ Constraint priority: ${O?.priority ?? 0}`,
            `├─ Constraint active: ${O?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${V.state}`,
          ],
          ae = Object.entries(g.requirement)
            .filter(([Z]) => Z !== "type")
            .map(([Z, ue]) => `${Z}=${JSON.stringify(ue)}`)
            .join(", ");
        ae && ie.push(`├─ Requirement payload: { ${ae} }`);
        const be = Object.entries(G).slice(0, 10);
        return (
          be.length > 0 &&
            (ie.push("└─ Relevant facts:"),
            be.forEach(([Z, ue], we) => {
              const ge = we === be.length - 1 ? "   └─" : "   ├─",
                Re = typeof ue == "object" ? JSON.stringify(ue) : String(ue);
              ie.push(
                `${ge} ${Z} = ${Re.slice(0, 50)}${Re.length > 50 ? "..." : ""}`,
              );
            })),
          ie.join(`
`)
        );
      },
      async settle(s = 5e3) {
        const g = Date.now();
        for (;;) {
          await new Promise((V) => setTimeout(V, 0));
          const O = this.inspect();
          if (
            O.inflight.length === 0 &&
            !P.isReconciling &&
            !P.reconcileScheduled
          )
            return;
          if (Date.now() - g > s) {
            const V = [];
            O.inflight.length > 0 &&
              V.push(
                `${O.inflight.length} resolvers inflight: ${O.inflight.map((X) => X.resolverId).join(", ")}`,
              ),
              P.isReconciling && V.push("reconciliation in progress"),
              P.reconcileScheduled && V.push("reconcile scheduled");
            const G = P.previousRequirements.all();
            throw (
              (G.length > 0 &&
                V.push(
                  `${G.length} unmet requirements: ${G.map((X) => X.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${s}ms. ${V.join("; ")}`,
              ))
            );
          }
          await new Promise((V) => setTimeout(V, 10));
        }
      },
      getSnapshot() {
        return { facts: j.toObject(), version: 1 };
      },
      getDistributableSnapshot(s = {}) {
        let {
            includeDerivations: g,
            excludeDerivations: O,
            includeFacts: V,
            ttlSeconds: G,
            metadata: X,
            includeVersion: ie,
          } = s,
          ae = {},
          be = Object.keys(n),
          Z;
        if ((g ? (Z = g.filter((ge) => be.includes(ge))) : (Z = be), O)) {
          const ge = new Set(O);
          Z = Z.filter((Re) => !ge.has(Re));
        }
        for (const ge of Z)
          try {
            ae[ge] = W.get(ge);
          } catch {}
        if (V && V.length > 0) {
          const ge = j.toObject();
          for (const Re of V) Re in ge && (ae[Re] = ge[Re]);
        }
        const ue = Date.now(),
          we = { data: ae, createdAt: ue };
        return (
          G !== void 0 && G > 0 && (we.expiresAt = ue + G * 1e3),
          ie && (we.version = Pt(ae)),
          X && (we.metadata = X),
          we
        );
      },
      watchDistributableSnapshot(s, g) {
        let { includeDerivations: O, excludeDerivations: V } = s,
          G = Object.keys(n),
          X;
        if ((O ? (X = O.filter((ae) => G.includes(ae))) : (X = G), V)) {
          const ae = new Set(V);
          X = X.filter((be) => !ae.has(be));
        }
        if (X.length === 0) return () => {};
        let ie = this.getDistributableSnapshot({
          ...s,
          includeVersion: !0,
        }).version;
        return W.subscribe(X, () => {
          const ae = this.getDistributableSnapshot({
            ...s,
            includeVersion: !0,
          });
          ae.version !== ie && ((ie = ae.version), g(ae));
        });
      },
      restore(s) {
        if (!s || typeof s != "object")
          throw new Error(
            "[Directive] restore() requires a valid snapshot object",
          );
        if (!s.facts || typeof s.facts != "object")
          throw new Error(
            "[Directive] restore() snapshot must have a facts object",
          );
        if (!ze(s))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        j.batch(() => {
          for (const [g, O] of Object.entries(s.facts))
            Ee.has(g) || j.set(g, O);
        });
      },
      onSettledChange(s) {
        return (
          K.add(s),
          () => {
            K.delete(s);
          }
        );
      },
      onTimeTravelChange(s) {
        return (
          U.add(s),
          () => {
            U.delete(s);
          }
        );
      },
      batch(s) {
        j.batch(s);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !P.isReconciling &&
          !P.reconcileScheduled
        );
      },
      get isRunning() {
        return P.isRunning;
      },
      get isInitialized() {
        return P.isInitialized;
      },
      get isReady() {
        return P.isReady;
      },
      whenReady() {
        return P.isReady
          ? Promise.resolve()
          : P.isRunning
            ? (P.readyPromise ||
                (P.readyPromise = new Promise((s) => {
                  P.readyResolve = s;
                })),
              P.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function ke(s) {
    if (P.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${s.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (P.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${s.id}" on a destroyed system.`,
      );
    const g = (O, V) => {
      if (O) {
        for (const G of Object.keys(O))
          if (Ee.has(G))
            throw new Error(
              `[Directive] Security: Module "${s.id}" has dangerous key "${G}" in ${V}.`,
            );
      }
    };
    g(s.schema, "schema"),
      g(s.events, "events"),
      g(s.derive, "derive"),
      g(s.effects, "effects"),
      g(s.constraints, "constraints"),
      g(s.resolvers, "resolvers");
    for (const O of Object.keys(s.schema))
      if (O in t)
        throw new Error(
          `[Directive] Schema collision: Fact "${O}" already exists. Cannot register module "${s.id}".`,
        );
    if (s.snapshotEvents) {
      f === null && (f = new Set(Object.keys(l)));
      for (const O of s.snapshotEvents) f.add(O);
    } else if (f !== null && s.events)
      for (const O of Object.keys(s.events)) f.add(O);
    Object.assign(t, s.schema),
      s.events && Object.assign(l, s.events),
      s.derive && (Object.assign(n, s.derive), W.registerDefinitions(s.derive)),
      s.effects &&
        (Object.assign(r, s.effects), F.registerDefinitions(s.effects)),
      s.constraints &&
        (Object.assign(o, s.constraints), b.registerDefinitions(s.constraints)),
      s.resolvers &&
        (Object.assign(d, s.resolvers), E.registerDefinitions(s.resolvers)),
      j.registerKeys(s.schema),
      e.modules.push(s),
      s.init &&
        j.batch(() => {
          s.init(N);
        }),
      s.hooks?.onInit?.(oe),
      P.isRunning && (s.hooks?.onStart?.(oe), ce());
  }
  (oe.registerModule = ke), u.emitInit(oe);
  for (const s of e.modules) s.hooks?.onInit?.(oe);
  return oe;
}
var pe = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  J = "::";
function tr(e) {
  const t = Object.keys(e),
    l = new Set(),
    n = new Set(),
    r = [],
    o = [];
  function d(f) {
    if (l.has(f)) return;
    if (n.has(f)) {
      const m = o.indexOf(f),
        u = [...o.slice(m), f].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${u}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    n.add(f), o.push(f);
    const y = e[f];
    if (y?.crossModuleDeps)
      for (const m of Object.keys(y.crossModuleDeps)) t.includes(m) && d(m);
    o.pop(), n.delete(f), l.add(f), r.push(f);
  }
  for (const f of t) d(f);
  return r;
}
var ot = new WeakMap(),
  st = new WeakMap(),
  lt = new WeakMap(),
  at = new WeakMap();
function rr(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return sr(e);
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
  return nr(t);
}
function nr(e) {
  const t = e.modules,
    l = new Set(Object.keys(t)),
    n = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let r,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const c = o,
      x = Object.keys(t).filter((v) => !c.includes(v));
    if (x.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${x.join(", ")}. All modules must be included in the explicit order.`,
      );
    r = c;
  } else o === "declaration" ? (r = Object.keys(t)) : (r = tr(t));
  let d = e.debug,
    f = e.errorBoundary;
  e.zeroConfig &&
    ((d = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (f = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const c of Object.keys(t)) {
    if (c.includes(J))
      throw new Error(
        `[Directive] Module name "${c}" contains the reserved separator "${J}". Module names cannot contain "${J}".`,
      );
    const x = t[c];
    if (x) {
      for (const v of Object.keys(x.schema.facts))
        if (v.includes(J))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${c}" contains the reserved separator "${J}". Schema keys cannot contain "${J}".`,
          );
    }
  }
  const y = [];
  for (const c of r) {
    const x = t[c];
    if (!x) continue;
    const v = x.crossModuleDeps && Object.keys(x.crossModuleDeps).length > 0,
      C = v ? Object.keys(x.crossModuleDeps) : [],
      D = {};
    for (const [b, k] of Object.entries(x.schema.facts)) D[`${c}${J}${b}`] = k;
    const L = {};
    if (x.schema.derivations)
      for (const [b, k] of Object.entries(x.schema.derivations))
        L[`${c}${J}${b}`] = k;
    const h = {};
    if (x.schema.events)
      for (const [b, k] of Object.entries(x.schema.events))
        h[`${c}${J}${b}`] = k;
    const w = x.init
        ? (b) => {
            const k = he(b, c);
            x.init(k);
          }
        : void 0,
      A = {};
    if (x.derive)
      for (const [b, k] of Object.entries(x.derive))
        A[`${c}${J}${b}`] = (a, i) => {
          const p = v ? $e(a, c, C) : he(a, c),
            S = Qe(i, c);
          return k(p, S);
        };
    const j = {};
    if (x.events)
      for (const [b, k] of Object.entries(x.events))
        j[`${c}${J}${b}`] = (a, i) => {
          const p = he(a, c);
          k(p, i);
        };
    const N = {};
    if (x.constraints)
      for (const [b, k] of Object.entries(x.constraints)) {
        const a = k;
        N[`${c}${J}${b}`] = {
          ...a,
          deps: a.deps?.map((i) => `${c}${J}${i}`),
          when: (i) => {
            const p = v ? $e(i, c, C) : he(i, c);
            return a.when(p);
          },
          require:
            typeof a.require == "function"
              ? (i) => {
                  const p = v ? $e(i, c, C) : he(i, c);
                  return a.require(p);
                }
              : a.require,
        };
      }
    const W = {};
    if (x.resolvers)
      for (const [b, k] of Object.entries(x.resolvers)) {
        const a = k;
        W[`${c}${J}${b}`] = {
          ...a,
          resolve: async (i, p) => {
            const S = Ke(p.facts, t, () => Object.keys(t));
            await a.resolve(i, { facts: S[c], signal: p.signal });
          },
        };
      }
    const F = {};
    if (x.effects)
      for (const [b, k] of Object.entries(x.effects)) {
        const a = k;
        F[`${c}${J}${b}`] = {
          ...a,
          run: (i, p) => {
            const S = v ? $e(i, c, C) : he(i, c),
              E = p ? (v ? $e(p, c, C) : he(p, c)) : void 0;
            return a.run(S, E);
          },
          deps: a.deps?.map((i) => `${c}${J}${i}`),
        };
      }
    y.push({
      id: x.id,
      schema: {
        facts: D,
        derivations: L,
        events: h,
        requirements: x.schema.requirements ?? {},
      },
      init: w,
      derive: A,
      events: j,
      effects: F,
      constraints: N,
      resolvers: W,
      hooks: x.hooks,
      snapshotEvents:
        n && !n.has(c) ? [] : x.snapshotEvents?.map((b) => `${c}${J}${b}`),
    });
  }
  let m = null,
    u = null;
  function $(c) {
    for (const [x, v] of Object.entries(c))
      if (!pe.has(x) && l.has(x)) {
        if (v && typeof v == "object" && !ze(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${x}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, D] of Object.entries(v))
          pe.has(C) || (u.facts[`${x}${J}${C}`] = D);
      }
  }
  u = Ct({
    modules: y.map((c) => ({
      id: c.id,
      schema: c.schema.facts,
      requirements: c.schema.requirements,
      init: c.init,
      derive: c.derive,
      events: c.events,
      effects: c.effects,
      constraints: c.constraints,
      resolvers: c.resolvers,
      hooks: c.hooks,
      snapshotEvents: c.snapshotEvents,
    })),
    plugins: e.plugins,
    debug: d,
    errorBoundary: f,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), m && ($(m), (m = null));
    },
  });
  const _ = new Map();
  for (const c of Object.keys(t)) {
    const x = t[c];
    if (!x) continue;
    const v = [];
    for (const C of Object.keys(x.schema.facts)) v.push(`${c}${J}${C}`);
    if (x.schema.derivations)
      for (const C of Object.keys(x.schema.derivations)) v.push(`${c}${J}${C}`);
    _.set(c, v);
  }
  const I = { names: null };
  function q() {
    return I.names === null && (I.names = Object.keys(t)), I.names;
  }
  let B = Ke(u.facts, t, q),
    R = ir(u.derive, t, q),
    M = or(u, t, q),
    H = null,
    T = e.tickMs;
  return {
    _mode: "namespaced",
    facts: B,
    debug: u.debug,
    derive: R,
    events: M,
    constraints: u.constraints,
    effects: u.effects,
    get runHistory() {
      return u.runHistory;
    },
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
    async hydrate(c) {
      if (u.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const x = await c();
      x && typeof x == "object" && (m = x);
    },
    initialize() {
      u.initialize();
    },
    start() {
      if ((u.start(), T && T > 0)) {
        const c = Object.keys(y[0]?.events ?? {}).find((x) =>
          x.endsWith(`${J}tick`),
        );
        c &&
          (H = setInterval(() => {
            u.dispatch({ type: c });
          }, T));
      }
    },
    stop() {
      H && (clearInterval(H), (H = null)), u.stop();
    },
    destroy() {
      this.stop(), u.destroy();
    },
    dispatch(c) {
      u.dispatch(c);
    },
    batch: u.batch.bind(u),
    read(c) {
      return u.read(De(c));
    },
    subscribe(c, x) {
      const v = [];
      for (const C of c)
        if (C.endsWith(".*")) {
          const D = C.slice(0, -2),
            L = _.get(D);
          L && v.push(...L);
        } else v.push(De(C));
      return u.subscribe(v, x);
    },
    subscribeModule(c, x) {
      const v = _.get(c);
      return !v || v.length === 0 ? () => {} : u.subscribe(v, x);
    },
    watch(c, x, v) {
      return u.watch(De(c), x, v);
    },
    when(c, x) {
      return u.when(() => c(B), x);
    },
    onSettledChange: u.onSettledChange.bind(u),
    onTimeTravelChange: u.onTimeTravelChange.bind(u),
    inspect: u.inspect.bind(u),
    settle: u.settle.bind(u),
    explain: u.explain.bind(u),
    getSnapshot: u.getSnapshot.bind(u),
    restore: u.restore.bind(u),
    getDistributableSnapshot(c) {
      const x = {
          ...c,
          includeDerivations: c?.includeDerivations?.map(De),
          excludeDerivations: c?.excludeDerivations?.map(De),
          includeFacts: c?.includeFacts?.map(De),
        },
        v = u.getDistributableSnapshot(x),
        C = {};
      for (const [D, L] of Object.entries(v.data)) {
        const h = D.indexOf(J);
        if (h > 0) {
          const w = D.slice(0, h),
            A = D.slice(h + J.length);
          C[w] || (C[w] = {}), (C[w][A] = L);
        } else C._root || (C._root = {}), (C._root[D] = L);
      }
      return { ...v, data: C };
    },
    watchDistributableSnapshot(c, x) {
      const v = {
        ...c,
        includeDerivations: c?.includeDerivations?.map(De),
        excludeDerivations: c?.excludeDerivations?.map(De),
        includeFacts: c?.includeFacts?.map(De),
      };
      return u.watchDistributableSnapshot(v, (C) => {
        const D = {};
        for (const [L, h] of Object.entries(C.data)) {
          const w = L.indexOf(J);
          if (w > 0) {
            const A = L.slice(0, w),
              j = L.slice(w + J.length);
            D[A] || (D[A] = {}), (D[A][j] = h);
          } else D._root || (D._root = {}), (D._root[L] = h);
        }
        x({ ...C, data: D });
      });
    },
    registerModule(c, x) {
      if (l.has(c))
        throw new Error(
          `[Directive] Module namespace "${c}" already exists. Cannot register a duplicate namespace.`,
        );
      if (c.includes(J))
        throw new Error(
          `[Directive] Module name "${c}" contains the reserved separator "${J}".`,
        );
      if (pe.has(c))
        throw new Error(
          `[Directive] Module name "${c}" is a blocked property.`,
        );
      for (const b of Object.keys(x.schema.facts))
        if (b.includes(J))
          throw new Error(
            `[Directive] Schema key "${b}" in module "${c}" contains the reserved separator "${J}".`,
          );
      const v = x,
        C = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        D = C ? Object.keys(v.crossModuleDeps) : [],
        L = {};
      for (const [b, k] of Object.entries(v.schema.facts))
        L[`${c}${J}${b}`] = k;
      const h = v.init
          ? (b) => {
              const k = he(b, c);
              v.init(k);
            }
          : void 0,
        w = {};
      if (v.derive)
        for (const [b, k] of Object.entries(v.derive))
          w[`${c}${J}${b}`] = (a, i) => {
            const p = C ? $e(a, c, D) : he(a, c),
              S = Qe(i, c);
            return k(p, S);
          };
      const A = {};
      if (v.events)
        for (const [b, k] of Object.entries(v.events))
          A[`${c}${J}${b}`] = (a, i) => {
            const p = he(a, c);
            k(p, i);
          };
      const j = {};
      if (v.constraints)
        for (const [b, k] of Object.entries(v.constraints)) {
          const a = k;
          j[`${c}${J}${b}`] = {
            ...a,
            deps: a.deps?.map((i) => `${c}${J}${i}`),
            when: (i) => {
              const p = C ? $e(i, c, D) : he(i, c);
              return a.when(p);
            },
            require:
              typeof a.require == "function"
                ? (i) => {
                    const p = C ? $e(i, c, D) : he(i, c);
                    return a.require(p);
                  }
                : a.require,
          };
        }
      const N = {};
      if (v.resolvers)
        for (const [b, k] of Object.entries(v.resolvers)) {
          const a = k;
          N[`${c}${J}${b}`] = {
            ...a,
            resolve: async (i, p) => {
              const S = Ke(p.facts, t, q);
              await a.resolve(i, { facts: S[c], signal: p.signal });
            },
          };
        }
      const W = {};
      if (v.effects)
        for (const [b, k] of Object.entries(v.effects)) {
          const a = k;
          W[`${c}${J}${b}`] = {
            ...a,
            run: (i, p) => {
              const S = C ? $e(i, c, D) : he(i, c),
                E = p ? (C ? $e(p, c, D) : he(p, c)) : void 0;
              return a.run(S, E);
            },
            deps: a.deps?.map((i) => `${c}${J}${i}`),
          };
        }
      l.add(c), (t[c] = v), (I.names = null);
      const F = [];
      for (const b of Object.keys(v.schema.facts)) F.push(`${c}${J}${b}`);
      if (v.schema.derivations)
        for (const b of Object.keys(v.schema.derivations))
          F.push(`${c}${J}${b}`);
      _.set(c, F),
        u.registerModule({
          id: v.id,
          schema: L,
          requirements: v.schema.requirements ?? {},
          init: h,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(A).length > 0 ? A : void 0,
          effects: Object.keys(W).length > 0 ? W : void 0,
          constraints: Object.keys(j).length > 0 ? j : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            n && !n.has(c) ? [] : v.snapshotEvents?.map((b) => `${c}${J}${b}`),
        });
    },
  };
}
function De(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${J}${l.join(J)}`;
  }
  return e;
}
function he(e, t) {
  let l = ot.get(e);
  if (l) {
    const r = l.get(t);
    if (r) return r;
  } else (l = new Map()), ot.set(e, l);
  const n = new Proxy(
    {},
    {
      get(r, o) {
        if (typeof o != "symbol" && !pe.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${t}${J}${o}`];
      },
      set(r, o, d) {
        return typeof o == "symbol" || pe.has(o)
          ? !1
          : ((e[`${t}${J}${o}`] = d), !0);
      },
      has(r, o) {
        return typeof o == "symbol" || pe.has(o) ? !1 : `${t}${J}${o}` in e;
      },
      deleteProperty(r, o) {
        return typeof o == "symbol" || pe.has(o)
          ? !1
          : (delete e[`${t}${J}${o}`], !0);
      },
    },
  );
  return l.set(t, n), n;
}
function Ke(e, t, l) {
  const n = st.get(e);
  if (n) return n;
  const r = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !pe.has(d) && Object.hasOwn(t, d))
          return he(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || pe.has(d) ? !1 : Object.hasOwn(t, d);
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
  return st.set(e, r), r;
}
var ct = new WeakMap();
function $e(e, t, l) {
  let n = `${t}:${JSON.stringify([...l].sort())}`,
    r = ct.get(e);
  if (r) {
    const y = r.get(n);
    if (y) return y;
  } else (r = new Map()), ct.set(e, r);
  const o = new Set(l),
    d = ["self", ...l],
    f = new Proxy(
      {},
      {
        get(y, m) {
          if (typeof m != "symbol" && !pe.has(m)) {
            if (m === "self") return he(e, t);
            if (o.has(m)) return he(e, m);
          }
        },
        has(y, m) {
          return typeof m == "symbol" || pe.has(m)
            ? !1
            : m === "self" || o.has(m);
        },
        ownKeys() {
          return d;
        },
        getOwnPropertyDescriptor(y, m) {
          if (typeof m != "symbol" && (m === "self" || o.has(m)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return r.set(n, f), f;
}
function Qe(e, t) {
  let l = at.get(e);
  if (l) {
    const r = l.get(t);
    if (r) return r;
  } else (l = new Map()), at.set(e, l);
  const n = new Proxy(
    {},
    {
      get(r, o) {
        if (typeof o != "symbol" && !pe.has(o)) return e[`${t}${J}${o}`];
      },
      has(r, o) {
        return typeof o == "symbol" || pe.has(o) ? !1 : `${t}${J}${o}` in e;
      },
    },
  );
  return l.set(t, n), n;
}
function ir(e, t, l) {
  const n = lt.get(e);
  if (n) return n;
  const r = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !pe.has(d) && Object.hasOwn(t, d))
          return Qe(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || pe.has(d) ? !1 : Object.hasOwn(t, d);
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
  return lt.set(e, r), r;
}
var ut = new WeakMap();
function or(e, t, l) {
  let n = ut.get(e);
  return (
    n || ((n = new Map()), ut.set(e, n)),
    new Proxy(
      {},
      {
        get(r, o) {
          if (typeof o == "symbol" || pe.has(o) || !Object.hasOwn(t, o)) return;
          const d = n.get(o);
          if (d) return d;
          const f = new Proxy(
            {},
            {
              get(y, m) {
                if (typeof m != "symbol" && !pe.has(m))
                  return (u) => {
                    e.dispatch({ type: `${o}${J}${m}`, ...u });
                  };
              },
            },
          );
          return n.set(o, f), f;
        },
        has(r, o) {
          return typeof o == "symbol" || pe.has(o) ? !1 : Object.hasOwn(t, o);
        },
        ownKeys() {
          return l();
        },
        getOwnPropertyDescriptor(r, o) {
          if (typeof o != "symbol" && Object.hasOwn(t, o))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function sr(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !ze(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let l = e.debug,
    n = e.errorBoundary;
  e.zeroConfig &&
    ((l = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (n = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let r = null,
    o = null;
  o = Ct({
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
    errorBoundary: n,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [m, u] of Object.entries(e.initialFacts))
          pe.has(m) || (o.facts[m] = u);
      if (r) {
        for (const [m, u] of Object.entries(r)) pe.has(m) || (o.facts[m] = u);
        r = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(m, u) {
          if (typeof u != "symbol" && !pe.has(u))
            return ($) => {
              o.dispatch({ type: u, ...$ });
            };
        },
      },
    ),
    f = null,
    y = e.tickMs;
  return {
    _mode: "single",
    facts: o.facts,
    debug: o.debug,
    derive: o.derive,
    events: d,
    constraints: o.constraints,
    effects: o.effects,
    get runHistory() {
      return o.runHistory;
    },
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
      const u = await m();
      u && typeof u == "object" && (r = u);
    },
    initialize() {
      o.initialize();
    },
    start() {
      o.start(),
        y &&
          y > 0 &&
          t.events &&
          "tick" in t.events &&
          (f = setInterval(() => {
            o.dispatch({ type: "tick" });
          }, y));
    },
    stop() {
      f && (clearInterval(f), (f = null)), o.stop();
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
    subscribe(m, u) {
      return o.subscribe(m, u);
    },
    watch(m, u, $) {
      return o.watch(m, u, $);
    },
    when(m, u) {
      return o.when(m, u);
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
var Et = class {
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
function Ze() {
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
      const t = JSON.stringify(e, (l, n) =>
        typeof n == "bigint"
          ? String(n) + "n"
          : typeof n == "symbol"
            ? String(n)
            : n,
      );
      return t.length > 120 ? t.slice(0, 117) + "..." : t;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function Ae(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function Te(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function lr(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function ar(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Ze() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function cr() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var ur = 200,
  Ne = 340,
  Me = 16,
  Ie = 80,
  dt = 2,
  ft = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function dr() {
  return { entries: new Et(ur), inflight: new Map() };
}
function fr() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var pr = 1e4,
  mr = 100;
function hr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var gr = 50,
  pt = 200,
  z = {
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
  le = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function yr(e, t, l, n) {
  let r = !1,
    o = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${z.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${z.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const f = document.createElement("button");
  f.setAttribute("aria-label", "Open Directive DevTools"),
    f.setAttribute("aria-expanded", String(l)),
    (f.title = "Ctrl+Shift+D to toggle"),
    Object.assign(f.style, {
      ...o,
      background: z.bg,
      color: z.text,
      border: `1px solid ${z.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: z.font,
      fontSize: "12px",
      display: l ? "none" : "block",
    }),
    (f.textContent = "Directive");
  const y = document.createElement("div");
  y.setAttribute("role", "region"),
    y.setAttribute("aria-label", "Directive DevTools"),
    y.setAttribute("data-directive-devtools", ""),
    (y.tabIndex = -1),
    Object.assign(y.style, {
      ...o,
      background: z.bg,
      color: z.text,
      border: `1px solid ${z.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: z.font,
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
  const u = document.createElement("strong");
  (u.style.color = z.accent),
    (u.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
      background: "none",
      border: "none",
      color: z.closeBtn,
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
    m.appendChild(u),
    m.appendChild($),
    y.appendChild(m);
  const _ = document.createElement("div");
  (_.style.marginBottom = "6px"), _.setAttribute("aria-live", "polite");
  const I = document.createElement("span");
  (I.style.color = z.green),
    (I.textContent = "Settled"),
    _.appendChild(I),
    y.appendChild(_);
  const q = document.createElement("div");
  Object.assign(q.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const B = document.createElement("button");
  Object.assign(B.style, {
    background: "none",
    border: `1px solid ${z.border}`,
    color: z.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: z.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (B.textContent = "◀ Undo"),
    (B.disabled = !0);
  const R = document.createElement("button");
  Object.assign(R.style, {
    background: "none",
    border: `1px solid ${z.border}`,
    color: z.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: z.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (R.textContent = "Redo ▶"),
    (R.disabled = !0);
  const M = document.createElement("span");
  (M.style.color = z.muted),
    (M.style.fontSize = "10px"),
    q.appendChild(B),
    q.appendChild(R),
    q.appendChild(M),
    y.appendChild(q);
  function H(Y, te) {
    const ne = document.createElement("details");
    te && (ne.open = !0), (ne.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: z.accent,
      marginBottom: "4px",
    });
    const ke = document.createElement("span");
    (oe.textContent = `${Y} (`),
      oe.appendChild(ke),
      oe.appendChild(document.createTextNode(")")),
      (ke.textContent = "0"),
      ne.appendChild(oe);
    const s = document.createElement("table");
    Object.assign(s.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const g = document.createElement("thead"),
      O = document.createElement("tr");
    for (const G of ["Key", "Value"]) {
      const X = document.createElement("th");
      (X.scope = "col"),
        Object.assign(X.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: z.accent,
        }),
        (X.textContent = G),
        O.appendChild(X);
    }
    g.appendChild(O), s.appendChild(g);
    const V = document.createElement("tbody");
    return (
      s.appendChild(V),
      ne.appendChild(s),
      { details: ne, tbody: V, countSpan: ke }
    );
  }
  function T(Y, te) {
    const ne = document.createElement("details");
    ne.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: te,
      marginBottom: "4px",
    });
    const ke = document.createElement("span");
    (oe.textContent = `${Y} (`),
      oe.appendChild(ke),
      oe.appendChild(document.createTextNode(")")),
      (ke.textContent = "0"),
      ne.appendChild(oe);
    const s = document.createElement("ul");
    return (
      Object.assign(s.style, { margin: "0", paddingLeft: "16px" }),
      ne.appendChild(s),
      { details: ne, list: s, countSpan: ke }
    );
  }
  const c = H("Facts", !0);
  y.appendChild(c.details);
  const x = H("Derivations", !1);
  y.appendChild(x.details);
  const v = T("Inflight", z.yellow);
  y.appendChild(v.details);
  const C = T("Unmet", z.red);
  y.appendChild(C.details);
  const D = document.createElement("details");
  D.style.marginBottom = "4px";
  const L = document.createElement("summary");
  Object.assign(L.style, {
    cursor: "pointer",
    color: z.accent,
    marginBottom: "4px",
  }),
    (L.textContent = "Performance"),
    D.appendChild(L);
  const h = document.createElement("div");
  (h.style.fontSize = "10px"),
    (h.style.color = z.muted),
    (h.textContent = "No data yet"),
    D.appendChild(h),
    y.appendChild(D);
  const w = document.createElement("details");
  w.style.marginBottom = "4px";
  const A = document.createElement("summary");
  Object.assign(A.style, {
    cursor: "pointer",
    color: z.accent,
    marginBottom: "4px",
  }),
    (A.textContent = "Dependency Graph"),
    w.appendChild(A);
  const j = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  j.setAttribute("width", "100%"),
    j.setAttribute("height", "120"),
    j.setAttribute("role", "img"),
    j.setAttribute("aria-label", "System dependency graph"),
    (j.style.display = "block"),
    j.setAttribute("viewBox", "0 0 460 120"),
    j.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(j),
    y.appendChild(w);
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const W = document.createElement("summary");
  Object.assign(W.style, {
    cursor: "pointer",
    color: z.accent,
    marginBottom: "4px",
  }),
    (W.textContent = "Timeline"),
    N.appendChild(W);
  const F = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  F.setAttribute("width", "100%"),
    F.setAttribute("height", "60"),
    F.setAttribute("role", "img"),
    F.setAttribute("aria-label", "Resolver execution timeline"),
    (F.style.display = "block"),
    F.setAttribute("viewBox", `0 0 ${Ne} 60`),
    F.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const b = document.createElementNS("http://www.w3.org/2000/svg", "text");
  b.setAttribute("x", String(Ne / 2)),
    b.setAttribute("y", "30"),
    b.setAttribute("text-anchor", "middle"),
    b.setAttribute("fill", z.muted),
    b.setAttribute("font-size", "10"),
    b.setAttribute("font-family", z.font),
    (b.textContent = "No resolver activity yet"),
    F.appendChild(b),
    N.appendChild(F),
    y.appendChild(N);
  let k, a, i, p;
  if (n) {
    const Y = document.createElement("details");
    Y.style.marginBottom = "4px";
    const te = document.createElement("summary");
    Object.assign(te.style, {
      cursor: "pointer",
      color: z.accent,
      marginBottom: "4px",
    }),
      (i = document.createElement("span")),
      (i.textContent = "0"),
      (te.textContent = "Events ("),
      te.appendChild(i),
      te.appendChild(document.createTextNode(")")),
      Y.appendChild(te),
      (a = document.createElement("div")),
      Object.assign(a.style, {
        maxHeight: "150px",
        overflow: "auto",
        fontSize: "10px",
      }),
      a.setAttribute("role", "log"),
      a.setAttribute("aria-live", "polite"),
      (a.tabIndex = 0);
    const ne = document.createElement("div");
    (ne.style.color = z.muted),
      (ne.style.padding = "4px"),
      (ne.textContent = "Waiting for events..."),
      (ne.className = "dt-events-empty"),
      a.appendChild(ne),
      Y.appendChild(a),
      y.appendChild(Y),
      (k = Y),
      (p = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (a = document.createElement("div")),
      (i = document.createElement("span")),
      (p = document.createElement("div")),
      (p.style.fontSize = "10px"),
      (p.style.color = z.muted),
      (p.style.marginTop = "4px"),
      (p.style.fontStyle = "italic"),
      (p.textContent = "Enable trace: true for event log"),
      y.appendChild(p);
  const S = document.createElement("div");
  Object.assign(S.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const E = document.createElement("button");
  Object.assign(E.style, {
    background: "none",
    border: `1px solid ${z.border}`,
    color: z.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: z.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (E.textContent = "⏺ Record");
  const U = document.createElement("button");
  Object.assign(U.style, {
    background: "none",
    border: `1px solid ${z.border}`,
    color: z.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: z.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (U.textContent = "⤓ Export"),
    S.appendChild(E),
    S.appendChild(U),
    y.appendChild(S),
    y.addEventListener(
      "wheel",
      (Y) => {
        const te = y,
          ne = te.scrollTop === 0 && Y.deltaY < 0,
          oe =
            te.scrollTop + te.clientHeight >= te.scrollHeight && Y.deltaY > 0;
        (ne || oe) && Y.preventDefault();
      },
      { passive: !1 },
    );
  let Q = l,
    ee = new Set();
  function K() {
    (Q = !0),
      (y.style.display = "block"),
      (f.style.display = "none"),
      f.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function re() {
    (Q = !1),
      (y.style.display = "none"),
      (f.style.display = "block"),
      f.setAttribute("aria-expanded", "false"),
      f.focus();
  }
  f.addEventListener("click", K), $.addEventListener("click", re);
  function se(Y) {
    Y.key === "Escape" && Q && re();
  }
  y.addEventListener("keydown", se);
  function me(Y) {
    Y.key === "d" &&
      Y.shiftKey &&
      (Y.ctrlKey || Y.metaKey) &&
      (Y.preventDefault(), Q ? re() : K());
  }
  document.addEventListener("keydown", me);
  function P() {
    r || (document.body.appendChild(f), document.body.appendChild(y));
  }
  document.body
    ? P()
    : document.addEventListener("DOMContentLoaded", P, { once: !0 });
  function ce() {
    (r = !0),
      f.removeEventListener("click", K),
      $.removeEventListener("click", re),
      y.removeEventListener("keydown", se),
      document.removeEventListener("keydown", me),
      document.removeEventListener("DOMContentLoaded", P);
    for (const Y of ee) clearTimeout(Y);
    ee.clear(), f.remove(), y.remove(), d.remove();
  }
  return {
    refs: {
      container: y,
      toggleBtn: f,
      titleEl: u,
      statusEl: I,
      factsBody: c.tbody,
      factsCount: c.countSpan,
      derivBody: x.tbody,
      derivCount: x.countSpan,
      derivSection: x.details,
      inflightList: v.list,
      inflightSection: v.details,
      inflightCount: v.countSpan,
      unmetList: C.list,
      unmetSection: C.details,
      unmetCount: C.countSpan,
      perfSection: D,
      perfBody: h,
      timeTravelSection: q,
      timeTravelLabel: M,
      undoBtn: B,
      redoBtn: R,
      flowSection: w,
      flowSvg: j,
      timelineSection: N,
      timelineSvg: F,
      eventsSection: k,
      eventsList: a,
      eventsCount: i,
      traceHint: p,
      recordBtn: E,
      exportBtn: U,
    },
    destroy: ce,
    isOpen: () => Q,
    flashTimers: ee,
  };
}
function Le(e, t, l, n, r, o) {
  let d = $t(n),
    f = e.get(l);
  if (f) {
    const y = f.cells;
    if (y[1] && ((y[1].textContent = d), r && o)) {
      const m = y[1];
      m.style.background = "rgba(139, 154, 255, 0.25)";
      const u = setTimeout(() => {
        (m.style.background = ""), o.delete(u);
      }, 300);
      o.add(u);
    }
  } else {
    (f = document.createElement("tr")),
      (f.style.borderBottom = `1px solid ${z.rowBorder}`);
    const y = document.createElement("td");
    Object.assign(y.style, { padding: "2px 4px", color: z.muted }),
      (y.textContent = l);
    const m = document.createElement("td");
    (m.style.padding = "2px 4px"),
      (m.textContent = d),
      f.appendChild(y),
      f.appendChild(m),
      t.appendChild(f),
      e.set(l, f);
  }
}
function vr(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function Ve(e, t, l) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const n of t) {
      const r = document.createElement("li");
      (r.style.fontSize = "11px"),
        (r.textContent = `${n.resolverId} (${n.id})`),
        e.inflightList.appendChild(r);
    }
  else {
    const n = document.createElement("li");
    (n.style.fontSize = "10px"),
      (n.style.color = z.muted),
      (n.textContent = "None"),
      e.inflightList.appendChild(n);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(l.length)),
    l.length > 0)
  )
    for (const n of l) {
      const r = document.createElement("li");
      (r.style.fontSize = "11px"),
        (r.textContent = `${n.requirement.type} from ${n.fromConstraint}`),
        e.unmetList.appendChild(r);
    }
  else {
    const n = document.createElement("li");
    (n.style.fontSize = "10px"),
      (n.style.color = z.muted),
      (n.textContent = "None"),
      e.unmetList.appendChild(n);
  }
}
function Ue(e, t, l) {
  const n = t === 0 && l === 0;
  (e.statusEl.style.color = n ? z.green : z.yellow),
    (e.statusEl.textContent = n ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = n ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${n ? "" : " (system working)"}`,
    );
}
function mt(e, t, l, n) {
  const r = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(r.length)), r.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      f = document.createElement("td");
    (f.colSpan = 2),
      (f.style.color = z.muted),
      (f.style.fontSize = "10px"),
      (f.textContent = "No derivations defined"),
      d.appendChild(f),
      e.derivBody.appendChild(d);
    return;
  }
  const o = new Set(r);
  for (const [d, f] of t) o.has(d) || (f.remove(), t.delete(d));
  for (const d of r) {
    let f;
    try {
      f = $t(l.read(d));
    } catch {
      f = "<error>";
    }
    Le(t, e.derivBody, d, f, !0, n);
  }
}
function br(e, t, l, n) {
  const r = e.eventsList.querySelector(".dt-events-empty");
  r && r.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${z.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    f = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    y;
  try {
    const _ = JSON.stringify(l);
    y = Ae(_, 60);
  } catch {
    y = "{}";
  }
  const m = document.createElement("span");
  (m.style.color = z.closeBtn), (m.textContent = f);
  const u = document.createElement("span");
  (u.style.color = z.accent), (u.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = z.muted,
      $.textContent = y,
      o.appendChild(m),
      o.appendChild(u),
      o.appendChild($),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > gr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(n);
}
function wr(e, t) {
  e.perfBody.replaceChildren();
  const l =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    n = [
      `Reconciles: ${t.reconcileCount}  (avg ${l}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const r of n) {
    const o = document.createElement("div");
    (o.style.marginBottom = "2px"),
      (o.textContent = r),
      e.perfBody.appendChild(o);
  }
  if (t.resolverStats.size > 0) {
    const r = document.createElement("div");
    (r.style.marginTop = "4px"),
      (r.style.marginBottom = "2px"),
      (r.style.color = z.accent),
      (r.textContent = "Resolvers:"),
      e.perfBody.appendChild(r);
    const o = [...t.resolverStats.entries()].sort(
      (d, f) => f[1].totalMs - d[1].totalMs,
    );
    for (const [d, f] of o) {
      const y = f.count > 0 ? (f.totalMs / f.count).toFixed(1) : "0",
        m = document.createElement("div");
      (m.style.paddingLeft = "8px"),
        (m.textContent = `${d}: ${f.count}x, avg ${y}ms${f.errors > 0 ? `, ${f.errors} err` : ""}`),
        f.errors > 0 && (m.style.color = z.red),
        e.perfBody.appendChild(m);
    }
  }
}
function ht(e, t) {
  const l = t.debug;
  if (!l) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const n = l.currentIndex,
    r = l.snapshots.length;
  e.timeTravelLabel.textContent = r > 0 ? `${n + 1} / ${r}` : "0 snapshots";
  const o = n > 0,
    d = n < r - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function Sr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Je = new WeakMap();
function xr(e, t, l, n, r, o) {
  return [
    e.join(","),
    t.join(","),
    l.map((d) => `${d.id}:${d.active}`).join(","),
    [...n.entries()].map(([d, f]) => `${d}:${f.status}:${f.type}`).join(","),
    r.join(","),
    o.join(","),
  ].join("|");
}
function Cr(e, t, l, n, r) {
  for (const o of l) {
    const d = e.nodes.get(`0:${o}`);
    if (!d) continue;
    const f = t.recentlyChangedFacts.has(o);
    d.rect.setAttribute("fill", f ? z.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
  for (const o of n) {
    const d = e.nodes.get(`1:${o}`);
    if (!d) continue;
    const f = t.recentlyComputedDerivations.has(o);
    d.rect.setAttribute("fill", f ? z.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
  for (const o of r) {
    const d = e.nodes.get(`2:${o}`);
    if (!d) continue;
    const f = t.recentlyActiveConstraints.has(o),
      y = d.rect.getAttribute("stroke") ?? z.muted;
    d.rect.setAttribute("fill", f ? y + "33" : "none"),
      d.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
}
function gt(e, t, l) {
  const n = Te(t);
  if (!n) return;
  let r;
  try {
    r = Object.keys(t.facts.$store.toObject());
  } catch {
    r = [];
  }
  const o = Object.keys(t.derive),
    d = n.constraints,
    f = n.unmet,
    y = n.inflight,
    m = Object.keys(n.resolvers),
    u = new Map();
  for (const b of f)
    u.set(b.id, {
      type: b.requirement.type,
      fromConstraint: b.fromConstraint,
      status: "unmet",
    });
  for (const b of y)
    u.set(b.id, { type: b.resolverId, fromConstraint: "", status: "inflight" });
  if (r.length === 0 && o.length === 0 && d.length === 0 && m.length === 0) {
    Je.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const b = document.createElementNS("http://www.w3.org/2000/svg", "text");
    b.setAttribute("x", "230"),
      b.setAttribute("y", "24"),
      b.setAttribute("text-anchor", "middle"),
      b.setAttribute("fill", z.muted),
      b.setAttribute("font-size", "10"),
      b.setAttribute("font-family", z.font),
      (b.textContent = "No system topology"),
      e.flowSvg.appendChild(b);
    return;
  }
  const $ = y.map((b) => b.resolverId).sort(),
    _ = xr(r, o, d, u, m, $),
    I = Je.get(e.flowSvg);
  if (I && I.fingerprint === _) {
    Cr(
      I,
      l,
      r,
      o,
      d.map((b) => b.id),
    );
    return;
  }
  const q = le.nodeW + le.colGap,
    B = [5, 5 + q, 5 + q * 2, 5 + q * 3, 5 + q * 4],
    R = B[4] + le.nodeW + 5;
  function M(b) {
    let k = le.startY + 12;
    return b.map((a) => {
      const i = { ...a, y: k };
      return (k += le.nodeH + le.nodeGap), i;
    });
  }
  const H = M(r.map((b) => ({ id: b, label: Ae(b, le.labelMaxChars) }))),
    T = M(o.map((b) => ({ id: b, label: Ae(b, le.labelMaxChars) }))),
    c = M(
      d.map((b) => ({
        id: b.id,
        label: Ae(b.id, le.labelMaxChars),
        active: b.active,
        priority: b.priority,
      })),
    ),
    x = M(
      [...u.entries()].map(([b, k]) => ({
        id: b,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    v = M(m.map((b) => ({ id: b, label: Ae(b, le.labelMaxChars) }))),
    C = Math.max(H.length, T.length, c.length, x.length, v.length, 1),
    D = le.startY + 12 + C * (le.nodeH + le.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${R} ${D}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${r.length} facts, ${o.length} derivations, ${d.length} constraints, ${u.size} requirements, ${m.length} resolvers`,
    );
  const L = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [b, k] of L.entries()) {
    const a = document.createElementNS("http://www.w3.org/2000/svg", "text");
    a.setAttribute("x", String(B[b] ?? 0)),
      a.setAttribute("y", "10"),
      a.setAttribute("fill", z.accent),
      a.setAttribute("font-size", String(le.fontSize)),
      a.setAttribute("font-family", z.font),
      (a.textContent = k),
      e.flowSvg.appendChild(a);
  }
  const h = { fingerprint: _, nodes: new Map() };
  function w(b, k, a, i, p, S, E, U) {
    const Q = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      ee = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ee.setAttribute("x", String(k)),
      ee.setAttribute("y", String(a - 6)),
      ee.setAttribute("width", String(le.nodeW)),
      ee.setAttribute("height", String(le.nodeH)),
      ee.setAttribute("rx", "3"),
      ee.setAttribute("fill", U ? S + "33" : "none"),
      ee.setAttribute("stroke", S),
      ee.setAttribute("stroke-width", U ? "2" : "1"),
      ee.setAttribute("opacity", E ? "0.35" : "1"),
      Q.appendChild(ee);
    const K = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      K.setAttribute("x", String(k + 4)),
      K.setAttribute("y", String(a + 4)),
      K.setAttribute("fill", S),
      K.setAttribute("font-size", String(le.fontSize)),
      K.setAttribute("font-family", z.font),
      K.setAttribute("opacity", E ? "0.35" : "1"),
      (K.textContent = p),
      Q.appendChild(K),
      e.flowSvg.appendChild(Q),
      h.nodes.set(`${b}:${i}`, { g: Q, rect: ee, text: K }),
      { midX: k + le.nodeW / 2, midY: a }
    );
  }
  function A(b, k, a, i, p, S) {
    const E = document.createElementNS("http://www.w3.org/2000/svg", "line");
    E.setAttribute("x1", String(b)),
      E.setAttribute("y1", String(k)),
      E.setAttribute("x2", String(a)),
      E.setAttribute("y2", String(i)),
      E.setAttribute("stroke", p),
      E.setAttribute("stroke-width", "1"),
      E.setAttribute("stroke-dasharray", "3,2"),
      E.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(E);
  }
  const j = new Map(),
    N = new Map(),
    W = new Map(),
    F = new Map();
  for (const b of H) {
    const k = l.recentlyChangedFacts.has(b.id),
      a = w(0, B[0], b.y, b.id, b.label, z.text, !1, k);
    j.set(b.id, a);
  }
  for (const b of T) {
    const k = l.recentlyComputedDerivations.has(b.id),
      a = w(1, B[1], b.y, b.id, b.label, z.accent, !1, k);
    N.set(b.id, a);
  }
  for (const b of c) {
    const k = l.recentlyActiveConstraints.has(b.id),
      a = w(
        2,
        B[2],
        b.y,
        b.id,
        b.label,
        b.active ? z.yellow : z.muted,
        !b.active,
        k,
      );
    W.set(b.id, a);
  }
  for (const b of x) {
    const k = b.status === "unmet" ? z.red : z.yellow,
      a = w(3, B[3], b.y, b.id, Ae(b.type, le.labelMaxChars), k, !1, !1);
    F.set(b.id, a);
  }
  for (const b of v) {
    const k = y.some((a) => a.resolverId === b.id);
    w(4, B[4], b.y, b.id, b.label, k ? z.green : z.muted, !k, !1);
  }
  for (const b of T) {
    const k = l.derivationDeps.get(b.id),
      a = N.get(b.id);
    if (k && a)
      for (const i of k) {
        const p = j.get(i);
        p &&
          A(
            p.midX + le.nodeW / 2,
            p.midY,
            a.midX - le.nodeW / 2,
            a.midY,
            z.accent,
          );
      }
  }
  for (const b of x) {
    const k = W.get(b.fromConstraint),
      a = F.get(b.id);
    k &&
      a &&
      A(k.midX + le.nodeW / 2, k.midY, a.midX - le.nodeW / 2, a.midY, z.muted);
  }
  for (const b of y) {
    const k = F.get(b.id);
    if (k) {
      const a = v.find((i) => i.id === b.resolverId);
      a && A(k.midX + le.nodeW / 2, k.midY, B[4], a.y, z.green);
    }
  }
  Je.set(e.flowSvg, h);
}
function Er(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function $r(e, t) {
  const l = t.entries.toArray();
  if (l.length === 0) return;
  e.timelineSvg.replaceChildren();
  let n = 1 / 0,
    r = -1 / 0;
  for (const I of l)
    I.startMs < n && (n = I.startMs), I.endMs > r && (r = I.endMs);
  const o = performance.now();
  for (const I of t.inflight.values()) I < n && (n = I), o > r && (r = o);
  const d = r - n || 1,
    f = Ne - Ie - 10,
    y = [],
    m = new Set();
  for (const I of l)
    m.has(I.resolver) || (m.add(I.resolver), y.push(I.resolver));
  for (const I of t.inflight.keys()) m.has(I) || (m.add(I), y.push(I));
  const u = y.slice(-12),
    $ = Me * u.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Ne} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const _ = 5;
  for (let I = 0; I <= _; I++) {
    const q = Ie + (f * I) / _,
      B = (d * I) / _,
      R = document.createElementNS("http://www.w3.org/2000/svg", "text");
    R.setAttribute("x", String(q)),
      R.setAttribute("y", "8"),
      R.setAttribute("fill", z.muted),
      R.setAttribute("font-size", "6"),
      R.setAttribute("font-family", z.font),
      R.setAttribute("text-anchor", "middle"),
      (R.textContent =
        B < 1e3 ? `${B.toFixed(0)}ms` : `${(B / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(R);
    const M = document.createElementNS("http://www.w3.org/2000/svg", "line");
    M.setAttribute("x1", String(q)),
      M.setAttribute("y1", "10"),
      M.setAttribute("x2", String(q)),
      M.setAttribute("y2", String($)),
      M.setAttribute("stroke", z.border),
      M.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(M);
  }
  for (let I = 0; I < u.length; I++) {
    const q = u[I],
      B = 12 + I * Me,
      R = I % ft.length,
      M = ft[R],
      H = document.createElementNS("http://www.w3.org/2000/svg", "text");
    H.setAttribute("x", String(Ie - 4)),
      H.setAttribute("y", String(B + Me / 2 + 3)),
      H.setAttribute("fill", z.muted),
      H.setAttribute("font-size", "7"),
      H.setAttribute("font-family", z.font),
      H.setAttribute("text-anchor", "end"),
      (H.textContent = Ae(q, 12)),
      e.timelineSvg.appendChild(H);
    const T = l.filter((x) => x.resolver === q);
    for (const x of T) {
      const v = Ie + ((x.startMs - n) / d) * f,
        C = Math.max(((x.endMs - x.startMs) / d) * f, dt),
        D = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      D.setAttribute("x", String(v)),
        D.setAttribute("y", String(B + 2)),
        D.setAttribute("width", String(C)),
        D.setAttribute("height", String(Me - 4)),
        D.setAttribute("rx", "2"),
        D.setAttribute("fill", x.error ? z.red : M),
        D.setAttribute("opacity", "0.8");
      const L = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        h = x.endMs - x.startMs;
      (L.textContent = `${q}: ${h.toFixed(1)}ms${x.error ? " (error)" : ""}`),
        D.appendChild(L),
        e.timelineSvg.appendChild(D);
    }
    const c = t.inflight.get(q);
    if (c !== void 0) {
      const x = Ie + ((c - n) / d) * f,
        v = Math.max(((o - c) / d) * f, dt),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String(x)),
        C.setAttribute("y", String(B + 2)),
        C.setAttribute("width", String(v)),
        C.setAttribute("height", String(Me - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", M),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", M),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const D = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (D.textContent = `${q}: inflight ${(o - c).toFixed(0)}ms`),
        C.appendChild(D),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${l.length} resolver executions across ${u.length} resolvers`,
  );
}
function kr() {
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
          const n = this.getSystem(l),
            r = l ? e.get(l) : e.values().next().value,
            o = n?.inspect() ?? null;
          return (
            o &&
              r &&
              (o.resolverStats = r.resolverStats
                ? Object.fromEntries(r.resolverStats)
                : {}),
            o
          );
        },
        getEvents(l) {
          return l
            ? (e.get(l)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(l, n) {
          return this.getSystem(n)?.explain(l) ?? null;
        },
        subscribe(l, n) {
          const r = n ? e.get(n) : e.values().next().value;
          if (!r) {
            let o = !1,
              d = setInterval(() => {
                const y = n ? e.get(n) : e.values().next().value;
                y && !o && ((o = !0), y.subscribers.add(l));
              }, 100),
              f = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(f);
              for (const y of e.values()) y.subscribers.delete(l);
            };
          }
          return (
            r.subscribers.add(l),
            () => {
              r.subscribers.delete(l);
            }
          );
        },
        exportSession(l) {
          const n = l ? e.get(l) : e.values().next().value;
          return n
            ? JSON.stringify({
                version: 1,
                name: l ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: n.events.toArray(),
              })
            : null;
        },
        importSession(l, n) {
          try {
            if (l.length > 10 * 1024 * 1024) return !1;
            const r = JSON.parse(l);
            if (
              !r ||
              typeof r != "object" ||
              Array.isArray(r) ||
              !Array.isArray(r.events)
            )
              return !1;
            const o = n ? e.get(n) : e.values().next().value;
            if (!o) return !1;
            const d = o.maxEvents,
              f = r.events,
              y = f.length > d ? f.length - d : 0;
            o.events.clear();
            for (let m = y; m < f.length; m++) {
              const u = f[m];
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
        clearEvents(l) {
          const n = l ? e.get(l) : e.values().next().value;
          n && n.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Ze(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function Rr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: n,
      panel: r = !1,
      position: o = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    f = ar(n),
    y = kr(),
    m = {
      system: null,
      events: new Et(f),
      maxEvents: f,
      subscribers: new Set(),
      resolverStats: new Map(),
    };
  y.systems.set(t, m);
  let u = (i, p) => {
      const S = { timestamp: Date.now(), type: i, data: p };
      l && m.events.push(S);
      for (const E of m.subscribers)
        try {
          E(S);
        } catch {}
    },
    $ = null,
    _ = new Map(),
    I = new Map(),
    q = cr(),
    B = fr(),
    R = hr(),
    M = dr(),
    H = r && typeof window < "u" && typeof document < "u" && Ze(),
    T = null,
    c = 0,
    x = 1,
    v = 2,
    C = 4,
    D = 8,
    L = 16,
    h = 32,
    w = 64,
    A = 128,
    j = new Map(),
    N = new Set(),
    W = null;
  function F(i) {
    (c |= i),
      T === null &&
        typeof requestAnimationFrame < "u" &&
        (T = requestAnimationFrame(b));
  }
  function b() {
    if (((T = null), !$ || !m.system)) {
      c = 0;
      return;
    }
    const i = $.refs,
      p = m.system,
      S = c;
    if (((c = 0), S & x)) {
      for (const E of N) vr(_, E);
      N.clear();
      for (const [E, { value: U, flash: Q }] of j)
        Le(_, i.factsBody, E, U, Q, $.flashTimers);
      j.clear(), (i.factsCount.textContent = String(_.size));
    }
    if ((S & v && mt(i, I, p, $.flashTimers), S & D))
      if (W) Ue(i, W.inflight.length, W.unmet.length);
      else {
        const E = Te(p);
        E && Ue(i, E.inflight.length, E.unmet.length);
      }
    if (S & C)
      if (W) Ve(i, W.inflight, W.unmet);
      else {
        const E = Te(p);
        E && Ve(i, E.inflight, E.unmet);
      }
    S & L && wr(i, q),
      S & h && gt(i, p, B),
      S & w && ht(i, p),
      S & A && $r(i, M);
  }
  function k(i, p) {
    $ && l && br($.refs, i, p, m.events.size);
  }
  function a(i, p) {
    R.isRecording &&
      R.recordedEvents.length < pr &&
      R.recordedEvents.push({ timestamp: Date.now(), type: i, data: lr(p) });
  }
  return {
    name: "devtools",
    onInit: (i) => {
      if (
        ((m.system = i),
        u("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        H)
      ) {
        const p = m.system;
        $ = yr(t, o, d, l);
        const S = $.refs;
        try {
          const U = p.facts.$store.toObject();
          for (const [Q, ee] of Object.entries(U))
            Le(_, S.factsBody, Q, ee, !1);
          S.factsCount.textContent = String(Object.keys(U).length);
        } catch {}
        mt(S, I, p);
        const E = Te(p);
        E &&
          (Ue(S, E.inflight.length, E.unmet.length),
          Ve(S, E.inflight, E.unmet)),
          ht(S, p),
          Sr(S, p),
          gt(S, p, B),
          S.recordBtn.addEventListener("click", () => {
            if (
              ((R.isRecording = !R.isRecording),
              (S.recordBtn.textContent = R.isRecording ? "⏹ Stop" : "⏺ Record"),
              (S.recordBtn.style.color = R.isRecording ? z.red : z.text),
              R.isRecording)
            ) {
              (R.recordedEvents = []), (R.snapshots = []);
              try {
                R.snapshots.push({
                  timestamp: Date.now(),
                  facts: p.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          S.exportBtn.addEventListener("click", () => {
            const U =
                R.recordedEvents.length > 0
                  ? R.recordedEvents
                  : m.events.toArray(),
              Q = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: U,
                  snapshots: R.snapshots,
                },
                null,
                2,
              ),
              ee = new Blob([Q], { type: "application/json" }),
              K = URL.createObjectURL(ee),
              re = document.createElement("a");
            (re.href = K),
              (re.download = `directive-session-${t}-${Date.now()}.json`),
              re.click(),
              URL.revokeObjectURL(K);
          });
      }
    },
    onStart: (i) => {
      u("start", {}), k("start", {}), a("start", {});
    },
    onStop: (i) => {
      u("stop", {}), k("stop", {}), a("stop", {});
    },
    onDestroy: (i) => {
      u("destroy", {}),
        y.systems.delete(t),
        T !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(T), (T = null)),
        B.animationTimer && clearTimeout(B.animationTimer),
        $ && ($.destroy(), ($ = null), _.clear(), I.clear());
    },
    onFactSet: (i, p, S) => {
      u("fact.set", { key: i, value: p, prev: S }),
        a("fact.set", { key: i, value: p, prev: S }),
        B.recentlyChangedFacts.add(i),
        $ &&
          m.system &&
          (j.set(i, { value: p, flash: !0 }),
          N.delete(i),
          F(x),
          k("fact.set", { key: i, value: p }));
    },
    onFactDelete: (i, p) => {
      u("fact.delete", { key: i, prev: p }),
        a("fact.delete", { key: i, prev: p }),
        $ && (N.add(i), j.delete(i), F(x), k("fact.delete", { key: i }));
    },
    onFactsBatch: (i) => {
      if (
        (u("facts.batch", { changes: i }),
        a("facts.batch", { count: i.length }),
        $ && m.system)
      ) {
        for (const p of i)
          p.type === "delete"
            ? (N.add(p.key), j.delete(p.key))
            : (B.recentlyChangedFacts.add(p.key),
              j.set(p.key, { value: p.value, flash: !0 }),
              N.delete(p.key));
        F(x), k("facts.batch", { count: i.length });
      }
    },
    onDerivationCompute: (i, p, S) => {
      u("derivation.compute", { id: i, value: p, deps: S }),
        a("derivation.compute", { id: i, deps: S }),
        B.derivationDeps.set(i, S),
        B.recentlyComputedDerivations.add(i),
        k("derivation.compute", { id: i, deps: S });
    },
    onDerivationInvalidate: (i) => {
      u("derivation.invalidate", { id: i }),
        k("derivation.invalidate", { id: i });
    },
    onReconcileStart: (i) => {
      u("reconcile.start", {}),
        (q.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        a("reconcile.start", {});
    },
    onReconcileEnd: (i) => {
      if (
        (u("reconcile.end", i),
        a("reconcile.end", {
          unmet: i.unmet.length,
          inflight: i.inflight.length,
          completed: i.completed.length,
        }),
        q.lastReconcileStartMs > 0)
      ) {
        const p = performance.now() - q.lastReconcileStartMs;
        q.reconcileCount++,
          (q.reconcileTotalMs += p),
          (q.lastReconcileStartMs = 0);
      }
      if (R.isRecording && m.system && R.snapshots.length < mr)
        try {
          R.snapshots.push({
            timestamp: Date.now(),
            facts: m.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        m.system &&
        ((W = i),
        Er(B),
        F(v | D | C | L | h | w),
        k("reconcile.end", {
          unmet: i.unmet.length,
          inflight: i.inflight.length,
        }));
    },
    onConstraintEvaluate: (i, p) => {
      u("constraint.evaluate", { id: i, active: p }),
        a("constraint.evaluate", { id: i, active: p }),
        p
          ? (B.activeConstraints.add(i), B.recentlyActiveConstraints.add(i))
          : B.activeConstraints.delete(i),
        k("constraint.evaluate", { id: i, active: p });
    },
    onConstraintError: (i, p) => {
      u("constraint.error", { id: i, error: String(p) }),
        k("constraint.error", { id: i, error: String(p) });
    },
    onRequirementCreated: (i) => {
      u("requirement.created", { id: i.id, type: i.requirement.type }),
        a("requirement.created", { id: i.id, type: i.requirement.type }),
        k("requirement.created", { id: i.id, type: i.requirement.type });
    },
    onRequirementMet: (i, p) => {
      u("requirement.met", { id: i.id, byResolver: p }),
        a("requirement.met", { id: i.id, byResolver: p }),
        k("requirement.met", { id: i.id, byResolver: p });
    },
    onRequirementCanceled: (i) => {
      u("requirement.canceled", { id: i.id }),
        a("requirement.canceled", { id: i.id }),
        k("requirement.canceled", { id: i.id });
    },
    onResolverStart: (i, p) => {
      u("resolver.start", { resolver: i, requirementId: p.id }),
        a("resolver.start", { resolver: i, requirementId: p.id }),
        M.inflight.set(i, performance.now()),
        $ &&
          m.system &&
          (F(C | D | A),
          k("resolver.start", { resolver: i, requirementId: p.id }));
    },
    onResolverComplete: (i, p, S) => {
      u("resolver.complete", { resolver: i, requirementId: p.id, duration: S }),
        a("resolver.complete", {
          resolver: i,
          requirementId: p.id,
          duration: S,
        });
      const E = m.resolverStats.get(i) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (E.count++,
        (E.totalMs += S),
        m.resolverStats.set(i, E),
        m.resolverStats.size > pt)
      ) {
        const Q = m.resolverStats.keys().next().value;
        Q !== void 0 && m.resolverStats.delete(Q);
      }
      q.resolverStats.set(i, { ...E });
      const U = M.inflight.get(i);
      M.inflight.delete(i),
        U !== void 0 &&
          M.entries.push({
            resolver: i,
            startMs: U,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          m.system &&
          (F(C | D | L | A),
          k("resolver.complete", { resolver: i, duration: S }));
    },
    onResolverError: (i, p, S) => {
      u("resolver.error", {
        resolver: i,
        requirementId: p.id,
        error: String(S),
      }),
        a("resolver.error", {
          resolver: i,
          requirementId: p.id,
          error: String(S),
        });
      const E = m.resolverStats.get(i) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((E.errors++, m.resolverStats.set(i, E), m.resolverStats.size > pt)) {
        const Q = m.resolverStats.keys().next().value;
        Q !== void 0 && m.resolverStats.delete(Q);
      }
      q.resolverStats.set(i, { ...E });
      const U = M.inflight.get(i);
      M.inflight.delete(i),
        U !== void 0 &&
          M.entries.push({
            resolver: i,
            startMs: U,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          m.system &&
          (F(C | D | L | A),
          k("resolver.error", { resolver: i, error: String(S) }));
    },
    onResolverRetry: (i, p, S) => {
      u("resolver.retry", { resolver: i, requirementId: p.id, attempt: S }),
        a("resolver.retry", { resolver: i, requirementId: p.id, attempt: S }),
        k("resolver.retry", { resolver: i, attempt: S });
    },
    onResolverCancel: (i, p) => {
      u("resolver.cancel", { resolver: i, requirementId: p.id }),
        a("resolver.cancel", { resolver: i, requirementId: p.id }),
        M.inflight.delete(i),
        k("resolver.cancel", { resolver: i });
    },
    onEffectRun: (i) => {
      u("effect.run", { id: i }),
        a("effect.run", { id: i }),
        q.effectRunCount++,
        k("effect.run", { id: i });
    },
    onEffectError: (i, p) => {
      u("effect.error", { id: i, error: String(p) }),
        q.effectErrorCount++,
        k("effect.error", { id: i, error: String(p) });
    },
    onSnapshot: (i) => {
      u("timetravel.snapshot", { id: i.id, trigger: i.trigger }),
        $ && m.system && F(w),
        k("timetravel.snapshot", { id: i.id, trigger: i.trigger });
    },
    onTimeTravel: (i, p) => {
      if (
        (u("timetravel.jump", { from: i, to: p }),
        a("timetravel.jump", { from: i, to: p }),
        $ && m.system)
      ) {
        const S = m.system;
        try {
          const E = S.facts.$store.toObject();
          _.clear(), $.refs.factsBody.replaceChildren();
          for (const [U, Q] of Object.entries(E))
            Le(_, $.refs.factsBody, U, Q, !1);
          $.refs.factsCount.textContent = String(Object.keys(E).length);
        } catch {}
        I.clear(),
          B.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (W = null),
          F(v | D | C | h | w),
          k("timetravel.jump", { from: i, to: p });
      }
    },
    onError: (i) => {
      u("error", {
        source: i.source,
        sourceId: i.sourceId,
        message: i.message,
      }),
        a("error", { source: i.source, message: i.message }),
        k("error", { source: i.source, message: i.message });
    },
    onErrorRecovery: (i, p) => {
      u("error.recovery", {
        source: i.source,
        sourceId: i.sourceId,
        strategy: p,
      }),
        k("error.recovery", { source: i.source, strategy: p });
    },
    onRunComplete: (i) => {
      u("run.complete", {
        id: i.id,
        status: i.status,
        facts: i.factChanges.length,
        constraints: i.constraintsHit.length,
        requirements: i.requirementsAdded.length,
        resolvers: i.resolversStarted.length,
        effects: i.effectsRun.length,
      }),
        k("run.complete", { id: i.id });
    },
  };
}
Math.random().toString(36).slice(2, 8);
const Be = [];
function xe(e, t, l) {
  Be.unshift({ time: Date.now(), event: e, detail: t, type: l }),
    Be.length > 50 && (Be.length = 50);
}
const kt = {
    facts: {
      strokes: ve.object(),
      currentColor: ve.string(),
      brushSize: ve.number(),
      changesetActive: ve.boolean(),
      changesetLabel: ve.string(),
    },
    derivations: {
      strokeCount: ve.number(),
      canUndo: ve.boolean(),
      canRedo: ve.boolean(),
      currentIndex: ve.number(),
      totalSnapshots: ve.number(),
    },
    events: {
      addStroke: { x: ve.number(), y: ve.number() },
      setColor: { value: ve.string() },
      setBrushSize: { value: ve.number() },
      clearCanvas: {},
    },
    requirements: {},
  },
  Dr = Ft("canvas", {
    schema: kt,
    init: (e) => {
      (e.strokes = []),
        (e.currentColor = "#5ba3a3"),
        (e.brushSize = 12),
        (e.changesetActive = !1),
        (e.changesetLabel = "");
    },
    derive: {
      strokeCount: (e) => e.strokes.length,
      canUndo: () => !1,
      canRedo: () => !1,
      currentIndex: () => 0,
      totalSnapshots: () => 0,
    },
    events: {
      addStroke: (e, { x: t, y: l }) => {
        const n = {
          id: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          x: t,
          y: l,
          color: e.currentColor,
          size: e.brushSize,
        };
        e.strokes = [...e.strokes, n];
      },
      setColor: (e, { value: t }) => {
        e.currentColor = t;
      },
      setBrushSize: (e, { value: t }) => {
        e.brushSize = t;
      },
      clearCanvas: (e) => {
        e.strokes = [];
      },
    },
  }),
  ye = rr({
    module: Dr,
    debug: { timeTravel: !0, maxSnapshots: 200 },
    plugins: [Rr({ name: "time-machine" })],
  });
ye.start();
const fe = ye.debug,
  Se = document.getElementById("tm-canvas"),
  Oe = Se.getContext("2d"),
  yt = document.getElementById("tm-color"),
  vt = document.getElementById("tm-brush-size"),
  Ar = document.getElementById("tm-brush-val"),
  Rt = document.getElementById("tm-undo"),
  Dt = document.getElementById("tm-redo"),
  jr = document.getElementById("tm-replay"),
  Or = document.getElementById("tm-clear"),
  He = document.getElementById("tm-snapshot-slider"),
  Mr = document.getElementById("tm-snapshot-info"),
  Ir = document.getElementById("tm-export"),
  qr = document.getElementById("tm-import"),
  At = document.getElementById("tm-export-area"),
  jt = document.getElementById("tm-begin-changeset"),
  Ot = document.getElementById("tm-end-changeset"),
  bt = document.getElementById("tm-changeset-status"),
  Ye = document.getElementById("tm-timeline");
function Br() {
  (Oe.fillStyle = "#0f172a"), Oe.fillRect(0, 0, Se.width, Se.height);
  const e = ye.facts.strokes;
  for (const t of e)
    Oe.beginPath(),
      Oe.arc(t.x, t.y, t.size / 2, 0, Math.PI * 2),
      (Oe.fillStyle = t.color),
      Oe.fill();
}
function wt(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function Ce() {
  Br();
  const e = fe.currentIndex > 0,
    t = fe.currentIndex < fe.snapshots.length - 1;
  (Rt.disabled = !e),
    (Dt.disabled = !t),
    (He.max = String(Math.max(0, fe.snapshots.length - 1))),
    (He.value = String(fe.currentIndex)),
    (Mr.textContent = `${fe.currentIndex} / ${fe.snapshots.length - 1}`);
  const l = ye.facts.changesetActive;
  if (
    ((bt.textContent = l ? "Recording..." : "Inactive"),
    (bt.className = `tm-changeset-status ${l ? "active" : ""}`),
    (jt.disabled = l),
    (Ot.disabled = !l),
    (Ar.textContent = `${ye.facts.brushSize}px`),
    Be.length === 0)
  )
    Ye.innerHTML =
      '<div class="tm-timeline-empty">Events appear after drawing</div>';
  else {
    Ye.innerHTML = "";
    for (const n of Be) {
      const r = document.createElement("div");
      r.className = `tm-timeline-entry ${n.type}`;
      const d = new Date(n.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (r.innerHTML = `
        <span class="tm-timeline-time">${d}</span>
        <span class="tm-timeline-event">${wt(n.event)}</span>
        <span class="tm-timeline-detail">${wt(n.detail)}</span>
      `),
        Ye.appendChild(r);
    }
  }
}
const zr = [...Object.keys(kt.facts)];
ye.subscribe(zr, Ce);
let We = !1;
function Mt(e) {
  const t = Se.getBoundingClientRect(),
    l = Se.width / t.width,
    n = Se.height / t.height;
  return {
    x: Math.round((e.clientX - t.left) * l),
    y: Math.round((e.clientY - t.top) * n),
  };
}
Se.addEventListener("pointerdown", (e) => {
  (We = !0), Se.setPointerCapture(e.pointerId);
  const { x: t, y: l } = Mt(e);
  ye.events.addStroke({ x: t, y: l }),
    xe("stroke", `(${t}, ${l}) ${ye.facts.currentColor}`, "stroke");
});
Se.addEventListener("pointermove", (e) => {
  if (!We) return;
  const { x: t, y: l } = Mt(e);
  ye.events.addStroke({ x: t, y: l });
});
Se.addEventListener("pointerup", () => {
  We = !1;
});
Se.addEventListener("pointerleave", () => {
  We = !1;
});
yt.addEventListener("input", () => {
  ye.events.setColor({ value: yt.value });
});
vt.addEventListener("input", () => {
  ye.events.setBrushSize({ value: Number(vt.value) });
});
Rt.addEventListener("click", () => {
  fe.goBack(), xe("undo", `→ snapshot #${fe.currentIndex}`, "undo"), Ce();
});
Dt.addEventListener("click", () => {
  fe.goForward(), xe("redo", `→ snapshot #${fe.currentIndex}`, "redo"), Ce();
});
jr.addEventListener("click", async () => {
  xe("replay", `replaying ${fe.snapshots.length} snapshots`, "replay"),
    await fe.replay(),
    Ce();
});
Or.addEventListener("click", () => {
  ye.events.clearCanvas(), xe("stroke", "canvas cleared", "stroke");
});
He.addEventListener("input", () => {
  const e = Number(He.value);
  e >= 0 &&
    e < fe.snapshots.length &&
    (fe.goTo(fe.snapshots[e].id), xe("goto", `→ snapshot #${e}`, "goto"), Ce());
});
Ir.addEventListener("click", () => {
  const e = fe.export();
  (At.value = e),
    xe("export", `${fe.snapshots.length} snapshots`, "export"),
    Ce();
});
qr.addEventListener("click", () => {
  const e = At.value.trim();
  if (e)
    try {
      fe.import(e), xe("import", "snapshots restored", "import"), Ce();
    } catch (t) {
      xe(
        "import",
        `error: ${t instanceof Error ? t.message : String(t)}`,
        "import",
      ),
        Ce();
    }
});
jt.addEventListener("click", () => {
  fe.beginChangeset("drawing-group"),
    (ye.facts.changesetActive = !0),
    (ye.facts.changesetLabel = "drawing-group"),
    xe("changeset", "started", "changeset"),
    Ce();
});
Ot.addEventListener("click", () => {
  fe.endChangeset(),
    (ye.facts.changesetActive = !1),
    (ye.facts.changesetLabel = ""),
    xe("changeset", "ended", "changeset"),
    Ce();
});
Ce();
document.body.setAttribute("data-time-machine-ready", "true");
