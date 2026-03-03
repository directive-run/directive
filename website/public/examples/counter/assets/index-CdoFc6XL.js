(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const n of document.querySelectorAll('link[rel="modulepreload"]')) r(n);
  new MutationObserver((n) => {
    for (const i of n)
      if (i.type === "childList")
        for (const u of i.addedNodes)
          u.tagName === "LINK" && u.rel === "modulepreload" && r(u);
  }).observe(document, { childList: !0, subtree: !0 });
  function s(n) {
    const i = {};
    return (
      n.integrity && (i.integrity = n.integrity),
      n.referrerPolicy && (i.referrerPolicy = n.referrerPolicy),
      n.crossOrigin === "use-credentials"
        ? (i.credentials = "include")
        : n.crossOrigin === "anonymous"
          ? (i.credentials = "omit")
          : (i.credentials = "same-origin"),
      i
    );
  }
  function r(n) {
    if (n.ep) return;
    n.ep = !0;
    const i = s(n);
    fetch(n.href, i);
  }
})();
var Je = class extends Error {
    constructor(e, t, s, r, n = !0) {
      super(e),
        (this.source = t),
        (this.sourceId = s),
        (this.context = r),
        (this.recoverable = n),
        (this.name = "DirectiveError");
    }
  },
  ke = [];
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
function Et() {
  return ke[ke.length - 1] ?? St;
}
function qe(e) {
  const t = wt();
  ke.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    ke.pop();
  }
}
function Ye(e) {
  const t = ke.splice(0, ke.length);
  try {
    return e();
  } finally {
    ke.push(...t);
  }
}
function We(e) {
  Et().track(e);
}
function Ct(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function _e(e = [], t, s, r, n, i) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: s,
    _transform: r,
    _description: n,
    _refinements: i,
    validate(u) {
      return _e([...e, u], t, s, r, n, i);
    },
  };
}
function de(e, t, s, r, n, i) {
  return {
    ..._e(e, t, s, r, n, i),
    default(u) {
      return de(e, t, u, r, n, i);
    },
    transform(u) {
      return de(
        [],
        t,
        void 0,
        (f) => {
          const v = r ? r(f) : f;
          return u(v);
        },
        n,
      );
    },
    brand() {
      return de(e, `Branded<${t}>`, s, r, n, i);
    },
    describe(u) {
      return de(e, t, s, r, u, i);
    },
    refine(u, f) {
      const v = [...(i ?? []), { predicate: u, message: f }];
      return de([...e, u], t, s, r, n, v);
    },
    nullable() {
      return de(
        [(u) => u === null || e.every((f) => f(u))],
        `${t} | null`,
        s,
        r,
        n,
      );
    },
    optional() {
      return de(
        [(u) => u === void 0 || e.every((f) => f(u))],
        `${t} | undefined`,
        s,
        r,
        n,
      );
    },
  };
}
var ve = {
  string() {
    return de([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, s, r, n, i) => ({
      ...de(t, "number", s, r, n, i),
      min(u) {
        return e([...t, (f) => f >= u], s, r, n, i);
      },
      max(u) {
        return e([...t, (f) => f <= u], s, r, n, i);
      },
      default(u) {
        return e(t, u, r, n, i);
      },
      describe(u) {
        return e(t, s, r, u, i);
      },
      refine(u, f) {
        const v = [...(i ?? []), { predicate: u, message: f }];
        return e([...t, u], s, r, n, v);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return de([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, s, r, n, i) => {
      const u = de(t, "array", r, void 0, n),
        f = i ?? { value: -1 };
      return {
        ...u,
        get _lastFailedIndex() {
          return f.value;
        },
        set _lastFailedIndex(v) {
          f.value = v;
        },
        of(v) {
          const p = { value: -1 };
          return e(
            [
              ...t,
              (d) => {
                for (let $ = 0; $ < d.length; $++) {
                  const B = d[$];
                  if (!v._validators.every((T) => T(B)))
                    return (p.value = $), !1;
                }
                return !0;
              },
            ],
            v,
            r,
            n,
            p,
          );
        },
        nonEmpty() {
          return e([...t, (v) => v.length > 0], s, r, n, f);
        },
        maxLength(v) {
          return e([...t, (p) => p.length <= v], s, r, n, f);
        },
        minLength(v) {
          return e([...t, (p) => p.length >= v], s, r, n, f);
        },
        default(v) {
          return e(t, s, v, n, f);
        },
        describe(v) {
          return e(t, s, r, v, f);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, s, r) => ({
      ...de(t, "object", s, void 0, r),
      shape(n) {
        return e(
          [
            ...t,
            (i) => {
              for (const [u, f] of Object.entries(n)) {
                const v = i[u],
                  p = f;
                if (p && !p._validators.every((d) => d(v))) return !1;
              }
              return !0;
            },
          ],
          s,
          r,
        );
      },
      nonNull() {
        return e([...t, (n) => n != null], s, r);
      },
      hasKeys(...n) {
        return e([...t, (i) => n.every((u) => u in i)], s, r);
      },
      default(n) {
        return e(t, n, r);
      },
      describe(n) {
        return e(t, s, n);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return de(
      [(s) => typeof s == "string" && t.has(s)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return de([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return _e(
      [(s) => (s === null ? !0 : e._validators.every((r) => r(s)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return _e(
      [(s) => (s === void 0 ? !0 : e._validators.every((r) => r(s)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((s) => s._typeName ?? "unknown");
    return de(
      [(s) => e.some((r) => r._validators.every((n) => n(s)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return de(
      [
        (s) =>
          typeof s != "object" || s === null || Array.isArray(s)
            ? !1
            : Object.values(s).every((r) => e._validators.every((n) => n(r))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((s) => s._typeName ?? "unknown");
    return de(
      [
        (s) =>
          !Array.isArray(s) || s.length !== e.length
            ? !1
            : e.every((r, n) => r._validators.every((i) => i(s[n]))),
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
function xt(e) {
  const { schema: t, onChange: s, onBatch: r } = e;
  Object.keys(t).length;
  let n = e.validate ?? !1,
    i = e.strictKeys ?? !1,
    u = e.redactErrors ?? !1,
    f = new Map(),
    v = new Set(),
    p = new Map(),
    d = new Set(),
    $ = 0,
    B = [],
    T = new Set(),
    I = !1,
    q = [],
    k = 100;
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
  function V(h) {
    const w = h;
    if (w._typeName) return w._typeName;
    if (M(h)) {
      const O = h._def;
      if (O?.typeName) return O.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function L(h) {
    return u ? "[redacted]" : Ct(h);
  }
  function c(h, w) {
    if (!n) return;
    const O = t[h];
    if (!O) {
      if (i)
        throw new Error(
          `[Directive] Unknown fact key: "${h}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${h}"`);
      return;
    }
    if (M(O)) {
      const N = O.safeParse(w);
      if (!N.success) {
        const b = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          R = L(w),
          a =
            N.error?.message ??
            N.error?.issues?.[0]?.message ??
            "Validation failed",
          o = V(O);
        throw new Error(
          `[Directive] Validation failed for "${h}": expected ${o}, got ${b} ${R}. ${a}`,
        );
      }
      return;
    }
    const D = O,
      P = D._validators;
    if (!P || !Array.isArray(P) || P.length === 0) return;
    const H = D._typeName ?? "unknown";
    for (let N = 0; N < P.length; N++) {
      const b = P[N];
      if (typeof b == "function" && !b(w)) {
        let R = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          a = L(w),
          o = "";
        typeof D._lastFailedIndex == "number" &&
          D._lastFailedIndex >= 0 &&
          ((o = ` (element at index ${D._lastFailedIndex} failed)`),
          (D._lastFailedIndex = -1));
        const m = N === 0 ? "" : ` (validator ${N + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${h}": expected ${H}, got ${R} ${a}${m}${o}`,
        );
      }
    }
  }
  function E(h) {
    p.get(h)?.forEach((w) => w());
  }
  function y() {
    d.forEach((h) => h());
  }
  function C(h, w, O) {
    if (I) {
      q.push({ key: h, value: w, prev: O });
      return;
    }
    I = !0;
    try {
      s?.(h, w, O), E(h), y();
      let D = 0;
      while (q.length > 0) {
        if (++D > k)
          throw (
            ((q.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const P = [...q];
        q.length = 0;
        for (const H of P) s?.(H.key, H.value, H.prev), E(H.key);
        y();
      }
    } finally {
      I = !1;
    }
  }
  function A() {
    if (!($ > 0)) {
      if ((r && B.length > 0 && r([...B]), T.size > 0)) {
        I = !0;
        try {
          for (const w of T) E(w);
          y();
          let h = 0;
          while (q.length > 0) {
            if (++h > k)
              throw (
                ((q.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${k} iterations.`,
                ))
              );
            const w = [...q];
            q.length = 0;
            for (const O of w) s?.(O.key, O.value, O.prev), E(O.key);
            y();
          }
        } finally {
          I = !1;
        }
      }
      (B.length = 0), T.clear();
    }
  }
  const z = {
    get(h) {
      return We(h), f.get(h);
    },
    has(h) {
      return We(h), f.has(h);
    },
    set(h, w) {
      c(h, w);
      const O = f.get(h);
      Object.is(O, w) ||
        (f.set(h, w),
        v.add(h),
        $ > 0
          ? (B.push({ key: h, value: w, prev: O, type: "set" }), T.add(h))
          : C(h, w, O));
    },
    delete(h) {
      const w = f.get(h);
      f.delete(h),
        v.delete(h),
        $ > 0
          ? (B.push({ key: h, value: void 0, prev: w, type: "delete" }),
            T.add(h))
          : C(h, void 0, w);
    },
    batch(h) {
      $++;
      try {
        h();
      } finally {
        $--, A();
      }
    },
    subscribe(h, w) {
      for (const O of h) {
        const D = O;
        p.has(D) || p.set(D, new Set()), p.get(D).add(w);
      }
      return () => {
        for (const O of h) {
          const D = p.get(O);
          D && (D.delete(w), D.size === 0 && p.delete(O));
        }
      };
    },
    subscribeAll(h) {
      return d.add(h), () => d.delete(h);
    },
    toObject() {
      const h = {};
      for (const w of v) f.has(w) && (h[w] = f.get(w));
      return h;
    },
  };
  return (
    (z.registerKeys = (h) => {
      for (const w of Object.keys(h)) De.has(w) || ((t[w] = h[w]), v.add(w));
    }),
    z
  );
}
var De = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function $t(e, t) {
  const s = () => ({
    get: (r) => Ye(() => e.get(r)),
    has: (r) => Ye(() => e.has(r)),
  });
  return new Proxy(
    {},
    {
      get(r, n) {
        if (n === "$store") return e;
        if (n === "$snapshot") return s;
        if (typeof n != "symbol" && !De.has(n)) return e.get(n);
      },
      set(r, n, i) {
        return typeof n == "symbol" ||
          n === "$store" ||
          n === "$snapshot" ||
          De.has(n)
          ? !1
          : (e.set(n, i), !0);
      },
      deleteProperty(r, n) {
        return typeof n == "symbol" ||
          n === "$store" ||
          n === "$snapshot" ||
          De.has(n)
          ? !1
          : (e.delete(n), !0);
      },
      has(r, n) {
        return n === "$store" || n === "$snapshot"
          ? !0
          : typeof n == "symbol" || De.has(n)
            ? !1
            : e.has(n);
      },
      ownKeys() {
        return Object.keys(t);
      },
      getOwnPropertyDescriptor(r, n) {
        return n === "$store" || n === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function Rt(e) {
  const t = xt(e),
    s = $t(t, e.schema);
  return { store: t, facts: s };
}
function kt(e, t) {
  const s = "crossModuleDeps" in t ? t.crossModuleDeps : void 0;
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
    crossModuleDeps: s,
  };
}
async function Me(e, t, s) {
  let r,
    n = new Promise((i, u) => {
      r = setTimeout(() => u(new Error(s)), t);
    });
  try {
    return await Promise.race([e, n]);
  } finally {
    clearTimeout(r);
  }
}
function pt(e, t = 50) {
  const s = new WeakSet();
  function r(n, i) {
    if (i > t) return '"[max depth exceeded]"';
    if (n === null) return "null";
    if (n === void 0) return "undefined";
    const u = typeof n;
    if (u === "string") return JSON.stringify(n);
    if (u === "number" || u === "boolean") return String(n);
    if (u === "function") return '"[function]"';
    if (u === "symbol") return '"[symbol]"';
    if (Array.isArray(n)) {
      if (s.has(n)) return '"[circular]"';
      s.add(n);
      const f = `[${n.map((v) => r(v, i + 1)).join(",")}]`;
      return s.delete(n), f;
    }
    if (u === "object") {
      const f = n;
      if (s.has(f)) return '"[circular]"';
      s.add(f);
      const v = `{${Object.keys(f)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${r(f[p], i + 1)}`)
        .join(",")}}`;
      return s.delete(f), v;
    }
    return '"[unknown]"';
  }
  return r(e, 0);
}
function je(e, t = 50) {
  const s = new Set(["__proto__", "constructor", "prototype"]),
    r = new WeakSet();
  function n(i, u) {
    if (u > t) return !1;
    if (i == null || typeof i != "object") return !0;
    const f = i;
    if (r.has(f)) return !0;
    if ((r.add(f), Array.isArray(f))) {
      for (const v of f) if (!n(v, u + 1)) return r.delete(f), !1;
      return r.delete(f), !0;
    }
    for (const v of Object.keys(f))
      if (s.has(v) || !n(f[v], u + 1)) return r.delete(f), !1;
    return r.delete(f), !0;
  }
  return n(e, 0);
}
function At(e) {
  let t = pt(e),
    s = 5381;
  for (let r = 0; r < t.length; r++) s = ((s << 5) + s) ^ t.charCodeAt(r);
  return (s >>> 0).toString(16);
}
function Ot(e, t) {
  if (t) return t(e);
  const { type: s, ...r } = e,
    n = pt(r);
  return `${s}:${n}`;
}
function Dt(e, t, s) {
  return { requirement: e, id: Ot(e, s), fromConstraint: t };
}
var Ke = class ht {
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
      for (const s of this.map.values()) t.add(s);
      return t;
    }
    diff(t) {
      const s = [],
        r = [],
        n = [];
      for (const i of this.map.values()) t.has(i.id) ? n.push(i) : s.push(i);
      for (const i of t.map.values()) this.map.has(i.id) || r.push(i);
      return { added: s, removed: r, unchanged: n };
    }
  },
  jt = 5e3;
function Mt(e) {
  let {
      definitions: t,
      facts: s,
      requirementKeys: r = {},
      defaultTimeout: n = jt,
      onEvaluate: i,
      onError: u,
    } = e,
    f = new Map(),
    v = new Set(),
    p = new Set(),
    d = new Map(),
    $ = new Map(),
    B = new Set(),
    T = new Map(),
    I = new Map(),
    q = !1,
    k = new Set(),
    M = new Set(),
    V = new Map(),
    L = [],
    c = new Map();
  function E() {
    for (const [a, o] of Object.entries(t))
      if (o.after)
        for (const m of o.after)
          t[m] && (V.has(m) || V.set(m, new Set()), V.get(m).add(a));
  }
  function y() {
    const a = new Set(),
      o = new Set(),
      m = [];
    function S(x, U) {
      if (a.has(x)) return;
      if (o.has(x)) {
        const ee = U.indexOf(x),
          W = [...U.slice(ee), x].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${W}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      o.add(x), U.push(x);
      const Q = t[x];
      if (Q?.after) for (const ee of Q.after) t[ee] && S(ee, U);
      U.pop(), o.delete(x), a.add(x), m.push(x);
    }
    for (const x of Object.keys(t)) S(x, []);
    (L = m), (c = new Map(L.map((x, U) => [x, U])));
  }
  y(), E();
  function C(a, o) {
    return o.async !== void 0 ? o.async : !!p.has(a);
  }
  function A(a) {
    const o = t[a];
    if (!o) throw new Error(`[Directive] Unknown constraint: ${a}`);
    const m = C(a, o);
    m && p.add(a);
    const S = {
      id: a,
      priority: o.priority ?? 0,
      isAsync: m,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: o.after ?? [],
      hitCount: 0,
      lastActiveAt: null,
    };
    return f.set(a, S), S;
  }
  function z(a) {
    return f.get(a) ?? A(a);
  }
  function h(a, o) {
    const m = d.get(a) ?? new Set();
    for (const S of m) {
      const x = $.get(S);
      x?.delete(a), x && x.size === 0 && $.delete(S);
    }
    for (const S of o) $.has(S) || $.set(S, new Set()), $.get(S).add(a);
    d.set(a, o);
  }
  function w(a) {
    const o = t[a];
    if (!o) return !1;
    const m = z(a);
    (m.isEvaluating = !0), (m.error = null);
    try {
      let S;
      if (o.deps) (S = o.when(s)), T.set(a, new Set(o.deps));
      else {
        const x = qe(() => o.when(s));
        (S = x.value), T.set(a, x.deps);
      }
      return S instanceof Promise
        ? (p.add(a),
          (m.isAsync = !0),
          S.then(
            (x) => (
              (m.lastResult = x),
              x && (m.hitCount++, (m.lastActiveAt = Date.now())),
              (m.isEvaluating = !1),
              i?.(a, x),
              x
            ),
          ).catch(
            (x) => (
              (m.error = x instanceof Error ? x : new Error(String(x))),
              (m.lastResult = !1),
              (m.isEvaluating = !1),
              u?.(a, x),
              !1
            ),
          ))
        : ((m.lastResult = S),
          S && (m.hitCount++, (m.lastActiveAt = Date.now())),
          (m.isEvaluating = !1),
          i?.(a, S),
          S);
    } catch (S) {
      return (
        (m.error = S instanceof Error ? S : new Error(String(S))),
        (m.lastResult = !1),
        (m.isEvaluating = !1),
        u?.(a, S),
        !1
      );
    }
  }
  async function O(a) {
    const o = t[a];
    if (!o) return !1;
    const m = z(a),
      S = o.timeout ?? n;
    if (((m.isEvaluating = !0), (m.error = null), o.deps?.length)) {
      const x = new Set(o.deps);
      h(a, x), T.set(a, x);
    }
    try {
      const x = o.when(s),
        U = await Me(x, S, `Constraint "${a}" timed out after ${S}ms`);
      return (
        (m.lastResult = U),
        U && (m.hitCount++, (m.lastActiveAt = Date.now())),
        (m.isEvaluating = !1),
        i?.(a, U),
        U
      );
    } catch (x) {
      return (
        (m.error = x instanceof Error ? x : new Error(String(x))),
        (m.lastResult = !1),
        (m.isEvaluating = !1),
        u?.(a, x),
        !1
      );
    }
  }
  function D(a, o) {
    return a == null ? [] : Array.isArray(a) ? a.filter((S) => S != null) : [a];
  }
  function P(a) {
    const o = t[a];
    if (!o) return { requirements: [], deps: new Set() };
    const m = o.require;
    if (typeof m == "function") {
      const { value: S, deps: x } = qe(() => m(s));
      return { requirements: D(S), deps: x };
    }
    return { requirements: D(m), deps: new Set() };
  }
  function H(a, o) {
    if (o.size === 0) return;
    const m = d.get(a) ?? new Set();
    for (const S of o)
      m.add(S), $.has(S) || $.set(S, new Set()), $.get(S).add(a);
    d.set(a, m);
  }
  let N = null;
  function b() {
    return (
      N ||
        (N = Object.keys(t).sort((a, o) => {
          const m = z(a),
            S = z(o).priority - m.priority;
          if (S !== 0) return S;
          const x = c.get(a) ?? 0,
            U = c.get(o) ?? 0;
          return x - U;
        })),
      N
    );
  }
  for (const a of Object.keys(t)) A(a);
  function R(a) {
    const o = f.get(a);
    if (!o || o.after.length === 0) return !0;
    for (const m of o.after)
      if (t[m] && !v.has(m) && !M.has(m) && !k.has(m)) return !1;
    return !0;
  }
  return {
    async evaluate(a) {
      const o = new Ke();
      M.clear();
      let m = b().filter((W) => !v.has(W)),
        S;
      if (!q || !a || a.size === 0) (S = m), (q = !0);
      else {
        const W = new Set();
        for (const re of a) {
          const se = $.get(re);
          if (se) for (const me of se) v.has(me) || W.add(me);
        }
        for (const re of B) v.has(re) || W.add(re);
        B.clear(), (S = [...W]);
        for (const re of m)
          if (!W.has(re)) {
            const se = I.get(re);
            if (se) for (const me of se) o.add(me);
          }
      }
      function x(W, re) {
        if (v.has(W)) return;
        const se = T.get(W);
        if (!re) {
          se !== void 0 && h(W, se), M.add(W), I.set(W, []);
          return;
        }
        M.delete(W);
        let me, F;
        try {
          const ce = P(W);
          (me = ce.requirements), (F = ce.deps);
        } catch (ce) {
          u?.(W, ce), se !== void 0 && h(W, se), I.set(W, []);
          return;
        }
        if (se !== void 0) {
          const ce = new Set(se);
          for (const J of F) ce.add(J);
          h(W, ce);
        } else H(W, F);
        if (me.length > 0) {
          const ce = r[W],
            J = me.map((te) => Dt(te, W, ce));
          for (const te of J) o.add(te);
          I.set(W, J);
        } else I.set(W, []);
      }
      async function U(W) {
        const re = [],
          se = [];
        for (const J of W)
          if (R(J)) se.push(J);
          else {
            re.push(J);
            const te = I.get(J);
            if (te) for (const ne of te) o.add(ne);
          }
        if (se.length === 0) return re;
        const me = [],
          F = [];
        for (const J of se) z(J).isAsync ? F.push(J) : me.push(J);
        const ce = [];
        for (const J of me) {
          const te = w(J);
          if (te instanceof Promise) {
            ce.push({ id: J, promise: te });
            continue;
          }
          x(J, te);
        }
        if (ce.length > 0) {
          const J = await Promise.all(
            ce.map(async ({ id: te, promise: ne }) => ({
              id: te,
              active: await ne,
            })),
          );
          for (const { id: te, active: ne } of J) x(te, ne);
        }
        if (F.length > 0) {
          const J = await Promise.all(
            F.map(async (te) => ({ id: te, active: await O(te) })),
          );
          for (const { id: te, active: ne } of J) x(te, ne);
        }
        return re;
      }
      let Q = S,
        ee = S.length + 1;
      while (Q.length > 0 && ee > 0) {
        const W = Q.length;
        if (((Q = await U(Q)), Q.length === W)) break;
        ee--;
      }
      return o.all();
    },
    getState(a) {
      return f.get(a);
    },
    getDependencies(a) {
      return d.get(a);
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
      v.add(a), (N = null), I.delete(a);
      const o = d.get(a);
      if (o) {
        for (const m of o) {
          const S = $.get(m);
          S && (S.delete(a), S.size === 0 && $.delete(m));
        }
        d.delete(a);
      }
      T.delete(a);
    },
    enable(a) {
      if (!f.has(a)) {
        console.warn(
          `[Directive] constraints.enable("${a}") — no such constraint`,
        );
        return;
      }
      v.delete(a), (N = null), B.add(a);
    },
    isDisabled(a) {
      return v.has(a);
    },
    invalidate(a) {
      const o = $.get(a);
      if (o) for (const m of o) B.add(m);
    },
    markResolved(a) {
      k.add(a);
      const o = f.get(a);
      o && (o.lastResolvedAt = Date.now());
      const m = V.get(a);
      if (m) for (const S of m) B.add(S);
    },
    isResolved(a) {
      return k.has(a);
    },
    registerDefinitions(a) {
      for (const [o, m] of Object.entries(a)) (t[o] = m), A(o), B.add(o);
      (N = null), y(), E();
    },
  };
}
function Tt(e) {
  let {
      definitions: t,
      facts: s,
      onCompute: r,
      onInvalidate: n,
      onError: i,
    } = e,
    u = new Map(),
    f = new Map(),
    v = new Map(),
    p = new Map(),
    d = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    B = new Set(),
    T = !1,
    I = 100,
    q;
  function k(y) {
    if (!t[y]) throw new Error(`[Directive] Unknown derivation: ${y}`);
    const C = {
      id: y,
      compute: () => V(y),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return u.set(y, C), C;
  }
  function M(y) {
    return u.get(y) ?? k(y);
  }
  function V(y) {
    const C = M(y),
      A = t[y];
    if (!A) throw new Error(`[Directive] Unknown derivation: ${y}`);
    if (C.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${y}`,
      );
    C.isComputing = !0;
    try {
      const z = C.cachedValue,
        { value: h, deps: w } = qe(() => A(s, q));
      return (
        (C.cachedValue = h), (C.isStale = !1), L(y, w), r?.(y, h, z, [...w]), h
      );
    } catch (z) {
      throw (i?.(y, z), z);
    } finally {
      C.isComputing = !1;
    }
  }
  function L(y, C) {
    const A = M(y),
      z = A.dependencies;
    for (const h of z)
      if (u.has(h)) {
        const w = p.get(h);
        w?.delete(y), w && w.size === 0 && p.delete(h);
      } else {
        const w = v.get(h);
        w?.delete(y), w && w.size === 0 && v.delete(h);
      }
    for (const h of C)
      t[h]
        ? (p.has(h) || p.set(h, new Set()), p.get(h).add(y))
        : (v.has(h) || v.set(h, new Set()), v.get(h).add(y));
    A.dependencies = C;
  }
  function c() {
    if (!($ > 0 || T)) {
      T = !0;
      try {
        let y = 0;
        while (B.size > 0) {
          if (++y > I) {
            const A = [...B];
            throw (
              (B.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${I} iterations. Remaining: ${A.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const C = [...B];
          B.clear();
          for (const A of C) f.get(A)?.forEach((z) => z());
        }
      } finally {
        T = !1;
      }
    }
  }
  function E(y, C = new Set()) {
    if (C.has(y)) return;
    C.add(y);
    const A = u.get(y);
    if (!A || A.isStale) return;
    (A.isStale = !0), n?.(y), B.add(y);
    const z = p.get(y);
    if (z) for (const h of z) E(h, C);
  }
  return (
    (q = new Proxy(
      {},
      {
        get(y, C) {
          if (typeof C == "symbol" || d.has(C)) return;
          We(C);
          const A = M(C);
          return A.isStale && V(C), A.cachedValue;
        },
      },
    )),
    {
      get(y) {
        const C = M(y);
        return C.isStale && V(y), C.cachedValue;
      },
      isStale(y) {
        return u.get(y)?.isStale ?? !0;
      },
      invalidate(y) {
        const C = v.get(y);
        if (C) {
          $++;
          try {
            for (const A of C) E(A);
          } finally {
            $--, c();
          }
        }
      },
      invalidateMany(y) {
        $++;
        try {
          for (const C of y) {
            const A = v.get(C);
            if (A) for (const z of A) E(z);
          }
        } finally {
          $--, c();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const y of u.values())
            y.isStale || ((y.isStale = !0), B.add(y.id));
        } finally {
          $--, c();
        }
      },
      subscribe(y, C) {
        for (const A of y) {
          const z = A;
          f.has(z) || f.set(z, new Set()), f.get(z).add(C);
        }
        return () => {
          for (const A of y) {
            const z = A,
              h = f.get(z);
            h?.delete(C), h && h.size === 0 && f.delete(z);
          }
        };
      },
      getProxy() {
        return q;
      },
      getDependencies(y) {
        return M(y).dependencies;
      },
      registerDefinitions(y) {
        for (const [C, A] of Object.entries(y)) (t[C] = A), k(C);
      },
    }
  );
}
function It(e) {
  let { definitions: t, facts: s, store: r, onRun: n, onError: i } = e,
    u = new Map(),
    f = null,
    v = !1;
  function p(k) {
    const M = t[k];
    if (!M) throw new Error(`[Directive] Unknown effect: ${k}`);
    const V = {
      id: k,
      enabled: !0,
      hasExplicitDeps: !!M.deps,
      dependencies: M.deps ? new Set(M.deps) : null,
      cleanup: null,
    };
    return u.set(k, V), V;
  }
  function d(k) {
    return u.get(k) ?? p(k);
  }
  function $() {
    return r.toObject();
  }
  function B(k, M) {
    const V = d(k);
    if (!V.enabled) return !1;
    if (V.dependencies) {
      for (const L of V.dependencies) if (M.has(L)) return !0;
      return !1;
    }
    return !0;
  }
  function T(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (M) {
        i?.(k.id, M),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            M,
          );
      }
      k.cleanup = null;
    }
  }
  function I(k, M) {
    if (typeof M == "function")
      if (v)
        try {
          M();
        } catch (V) {
          i?.(k.id, V),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              V,
            );
        }
      else k.cleanup = M;
  }
  async function q(k) {
    const M = d(k),
      V = t[k];
    if (!(!M.enabled || !V)) {
      T(M), n?.(k, M.dependencies ? [...M.dependencies] : []);
      try {
        if (M.hasExplicitDeps) {
          let L;
          if (
            (r.batch(() => {
              L = V.run(s, f);
            }),
            L instanceof Promise)
          ) {
            const c = await L;
            I(M, c);
          } else I(M, L);
        } else {
          let L = null,
            c,
            E = qe(
              () => (
                r.batch(() => {
                  c = V.run(s, f);
                }),
                c
              ),
            );
          L = E.deps;
          let y = E.value;
          y instanceof Promise && (y = await y),
            I(M, y),
            (M.dependencies = L.size > 0 ? L : null);
        }
      } catch (L) {
        i?.(k, L),
          console.error(`[Directive] Effect "${k}" threw an error:`, L);
      }
    }
  }
  for (const k of Object.keys(t)) p(k);
  return {
    async runEffects(k) {
      const M = [];
      for (const V of Object.keys(t)) B(V, k) && M.push(V);
      await Promise.all(M.map(q)), (f = $());
    },
    async runAll() {
      const k = Object.keys(t);
      await Promise.all(
        k.map((M) => (d(M).enabled ? q(M) : Promise.resolve())),
      ),
        (f = $());
    },
    disable(k) {
      const M = d(k);
      M.enabled = !1;
    },
    enable(k) {
      const M = d(k);
      M.enabled = !0;
    },
    isEnabled(k) {
      return d(k).enabled;
    },
    cleanupAll() {
      v = !0;
      for (const k of u.values()) T(k);
    },
    registerDefinitions(k) {
      for (const [M, V] of Object.entries(k)) (t[M] = V), p(M);
    },
  };
}
function qt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: s = 3,
      backoffMultiplier: r = 2,
      maxDelayMs: n = 3e4,
    } = e,
    i = new Map();
  function u(f) {
    const v = t * Math.pow(r, f - 1);
    return Math.min(v, n);
  }
  return {
    scheduleRetry(f, v, p, d, $) {
      if (d > s) return null;
      const B = u(d),
        T = {
          source: f,
          sourceId: v,
          context: p,
          attempt: d,
          nextRetryTime: Date.now() + B,
          callback: $,
        };
      return i.set(v, T), T;
    },
    getPendingRetries() {
      return Array.from(i.values());
    },
    processDueRetries() {
      const f = Date.now(),
        v = [];
      for (const [p, d] of i) d.nextRetryTime <= f && (v.push(d), i.delete(p));
      return v;
    },
    cancelRetry(f) {
      i.delete(f);
    },
    clearAll() {
      i.clear();
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
function Bt(e = {}) {
  const { config: t = {}, onError: s, onRecovery: r } = e,
    n = [],
    i = 100,
    u = qt(t.retryLater),
    f = new Map();
  function v(d, $, B, T) {
    if (B instanceof Je) return B;
    const I = B instanceof Error ? B.message : String(B),
      q = d !== "system";
    return new Je(I, d, $, T, q);
  }
  function p(d, $, B) {
    const T = (() => {
      switch (d) {
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
    if (typeof T == "function") {
      try {
        T(B, $);
      } catch (I) {
        console.error("[Directive] Error in error handler callback:", I);
      }
      return "skip";
    }
    return typeof T == "string" ? T : _t[d];
  }
  return {
    handleError(d, $, B, T) {
      const I = v(d, $, B, T);
      n.push(I), n.length > i && n.shift();
      try {
        s?.(I);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        t.onError?.(I);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let q = p(d, $, B instanceof Error ? B : new Error(String(B)));
      if (q === "retry-later") {
        const k = (f.get($) ?? 0) + 1;
        f.set($, k),
          u.scheduleRetry(d, $, T, k) ||
            ((q = "skip"), f.delete($), typeof process < "u");
      }
      try {
        r?.(I, q);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (q === "throw") throw I;
      return q;
    },
    getLastError() {
      return n[n.length - 1] ?? null;
    },
    getAllErrors() {
      return [...n];
    },
    clearErrors() {
      n.length = 0;
    },
    getRetryLaterManager() {
      return u;
    },
    processDueRetries() {
      return u.processDueRetries();
    },
    clearRetryAttempts(d) {
      f.delete(d), u.cancelRetry(d);
    },
  };
}
function Lt() {
  const e = [];
  function t(r) {
    if (r)
      try {
        return r();
      } catch (n) {
        console.error("[Directive] Plugin error:", n);
        return;
      }
  }
  async function s(r) {
    if (r)
      try {
        return await r();
      } catch (n) {
        console.error("[Directive] Plugin error:", n);
        return;
      }
  }
  return {
    register(r) {
      e.some((n) => n.name === r.name) &&
        (console.warn(
          `[Directive] Plugin "${r.name}" is already registered, replacing...`,
        ),
        this.unregister(r.name)),
        e.push(r);
    },
    unregister(r) {
      const n = e.findIndex((i) => i.name === r);
      n !== -1 && e.splice(n, 1);
    },
    getPlugins() {
      return [...e];
    },
    async emitInit(r) {
      for (const n of e) await s(() => n.onInit?.(r));
    },
    emitStart(r) {
      for (const n of e) t(() => n.onStart?.(r));
    },
    emitStop(r) {
      for (const n of e) t(() => n.onStop?.(r));
    },
    emitDestroy(r) {
      for (const n of e) t(() => n.onDestroy?.(r));
    },
    emitFactSet(r, n, i) {
      for (const u of e) t(() => u.onFactSet?.(r, n, i));
    },
    emitFactDelete(r, n) {
      for (const i of e) t(() => i.onFactDelete?.(r, n));
    },
    emitFactsBatch(r) {
      for (const n of e) t(() => n.onFactsBatch?.(r));
    },
    emitDerivationCompute(r, n, i) {
      for (const u of e) t(() => u.onDerivationCompute?.(r, n, i));
    },
    emitDerivationInvalidate(r) {
      for (const n of e) t(() => n.onDerivationInvalidate?.(r));
    },
    emitReconcileStart(r) {
      for (const n of e) t(() => n.onReconcileStart?.(r));
    },
    emitReconcileEnd(r) {
      for (const n of e) t(() => n.onReconcileEnd?.(r));
    },
    emitConstraintEvaluate(r, n) {
      for (const i of e) t(() => i.onConstraintEvaluate?.(r, n));
    },
    emitConstraintError(r, n) {
      for (const i of e) t(() => i.onConstraintError?.(r, n));
    },
    emitRequirementCreated(r) {
      for (const n of e) t(() => n.onRequirementCreated?.(r));
    },
    emitRequirementMet(r, n) {
      for (const i of e) t(() => i.onRequirementMet?.(r, n));
    },
    emitRequirementCanceled(r) {
      for (const n of e) t(() => n.onRequirementCanceled?.(r));
    },
    emitResolverStart(r, n) {
      for (const i of e) t(() => i.onResolverStart?.(r, n));
    },
    emitResolverComplete(r, n, i) {
      for (const u of e) t(() => u.onResolverComplete?.(r, n, i));
    },
    emitResolverError(r, n, i) {
      for (const u of e) t(() => u.onResolverError?.(r, n, i));
    },
    emitResolverRetry(r, n, i) {
      for (const u of e) t(() => u.onResolverRetry?.(r, n, i));
    },
    emitResolverCancel(r, n) {
      for (const i of e) t(() => i.onResolverCancel?.(r, n));
    },
    emitEffectRun(r) {
      for (const n of e) t(() => n.onEffectRun?.(r));
    },
    emitEffectError(r, n) {
      for (const i of e) t(() => i.onEffectError?.(r, n));
    },
    emitSnapshot(r) {
      for (const n of e) t(() => n.onSnapshot?.(r));
    },
    emitTimeTravel(r, n) {
      for (const i of e) t(() => i.onTimeTravel?.(r, n));
    },
    emitError(r) {
      for (const n of e) t(() => n.onError?.(r));
    },
    emitErrorRecovery(r, n) {
      for (const i of e) t(() => i.onErrorRecovery?.(r, n));
    },
    emitRunComplete(r) {
      for (const n of e) t(() => n.onRunComplete?.(r));
    },
  };
}
var Xe = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  Qe = { enabled: !1, windowMs: 50 };
function Ze(e, t) {
  let { backoff: s, initialDelay: r = 100, maxDelay: n = 3e4 } = e,
    i;
  switch (s) {
    case "none":
      i = r;
      break;
    case "linear":
      i = r * t;
      break;
    case "exponential":
      i = r * Math.pow(2, t - 1);
      break;
    default:
      i = r;
  }
  return Math.max(1, Math.min(i, n));
}
function zt(e) {
  const {
      definitions: t,
      facts: s,
      store: r,
      onStart: n,
      onComplete: i,
      onError: u,
      onRetry: f,
      onCancel: v,
      onResolutionComplete: p,
    } = e,
    d = new Map(),
    $ = new Map(),
    B = 1e3,
    T = new Map(),
    I = new Map(),
    q = 1e3;
  function k() {
    if ($.size > B) {
      const h = $.size - B,
        w = $.keys();
      for (let O = 0; O < h; O++) {
        const D = w.next().value;
        D && $.delete(D);
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
  function V(h) {
    return (
      typeof h == "object" &&
      h !== null &&
      "requirement" in h &&
      typeof h.requirement == "function"
    );
  }
  function L(h, w) {
    return M(h) ? w.type === h.requirement : V(h) ? h.requirement(w) : !1;
  }
  function c(h) {
    const w = h.type,
      O = I.get(w);
    if (O)
      for (const D of O) {
        const P = t[D];
        if (P && L(P, h)) return D;
      }
    for (const [D, P] of Object.entries(t))
      if (L(P, h)) {
        if (!I.has(w)) {
          if (I.size >= q) {
            const N = I.keys().next().value;
            N !== void 0 && I.delete(N);
          }
          I.set(w, []);
        }
        const H = I.get(w);
        return H.includes(D) || H.push(D), D;
      }
    return null;
  }
  function E(h) {
    return { facts: s, signal: h, snapshot: () => s.$snapshot() };
  }
  async function y(h, w, O) {
    const D = t[h];
    if (!D) return;
    let P = { ...Xe, ...D.retry },
      H = null;
    for (let N = 1; N <= P.attempts; N++) {
      if (O.signal.aborted) return;
      const b = d.get(w.id);
      b &&
        ((b.attempt = N),
        (b.status = {
          state: "running",
          requirementId: w.id,
          startedAt: b.startedAt,
          attempt: N,
        }));
      try {
        const R = E(O.signal);
        if (D.resolve) {
          let o;
          r.batch(() => {
            o = D.resolve(w.requirement, R);
          });
          const m = D.timeout;
          m && m > 0
            ? await Me(o, m, `Resolver "${h}" timed out after ${m}ms`)
            : await o;
        }
        const a = Date.now() - (b?.startedAt ?? Date.now());
        $.set(w.id, {
          state: "success",
          requirementId: w.id,
          completedAt: Date.now(),
          duration: a,
        }),
          k(),
          i?.(h, w, a);
        return;
      } catch (R) {
        if (
          ((H = R instanceof Error ? R : new Error(String(R))),
          O.signal.aborted)
        )
          return;
        if (P.shouldRetry && !P.shouldRetry(H, N)) break;
        if (N < P.attempts) {
          if (O.signal.aborted) return;
          const a = Ze(P, N);
          if (
            (f?.(h, w, N + 1),
            await new Promise((o) => {
              const m = setTimeout(o, a),
                S = () => {
                  clearTimeout(m), o();
                };
              O.signal.addEventListener("abort", S, { once: !0 });
            }),
            O.signal.aborted)
          )
            return;
        }
      }
    }
    $.set(w.id, {
      state: "error",
      requirementId: w.id,
      error: H,
      failedAt: Date.now(),
      attempts: P.attempts,
    }),
      k(),
      u?.(h, w, H);
  }
  async function C(h, w) {
    const O = t[h];
    if (!O) return;
    if (!O.resolveBatch && !O.resolveBatchWithResults) {
      await Promise.all(
        w.map((a) => {
          const o = new AbortController();
          return y(h, a, o);
        }),
      );
      return;
    }
    let D = { ...Xe, ...O.retry },
      P = { ...Qe, ...O.batch },
      H = new AbortController(),
      N = Date.now(),
      b = null,
      R = P.timeoutMs ?? O.timeout;
    for (let a = 1; a <= D.attempts; a++) {
      if (H.signal.aborted) return;
      try {
        const o = E(H.signal),
          m = w.map((S) => S.requirement);
        if (O.resolveBatchWithResults) {
          let S, x;
          if (
            (r.batch(() => {
              x = O.resolveBatchWithResults(m, o);
            }),
            R && R > 0
              ? (S = await Me(
                  x,
                  R,
                  `Batch resolver "${h}" timed out after ${R}ms`,
                ))
              : (S = await x),
            S.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${h}" returned ${S.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let U = Date.now() - N,
            Q = !1;
          for (let ee = 0; ee < w.length; ee++) {
            const W = w[ee],
              re = S[ee];
            if (re.success)
              $.set(W.id, {
                state: "success",
                requirementId: W.id,
                completedAt: Date.now(),
                duration: U,
              }),
                i?.(h, W, U);
            else {
              Q = !0;
              const se = re.error ?? new Error("Batch item failed");
              $.set(W.id, {
                state: "error",
                requirementId: W.id,
                error: se,
                failedAt: Date.now(),
                attempts: a,
              }),
                u?.(h, W, se);
            }
          }
          if (!Q || w.some((ee, W) => S[W]?.success)) return;
        } else {
          let S;
          r.batch(() => {
            S = O.resolveBatch(m, o);
          }),
            R && R > 0
              ? await Me(S, R, `Batch resolver "${h}" timed out after ${R}ms`)
              : await S;
          const x = Date.now() - N;
          for (const U of w)
            $.set(U.id, {
              state: "success",
              requirementId: U.id,
              completedAt: Date.now(),
              duration: x,
            }),
              i?.(h, U, x);
          return;
        }
      } catch (o) {
        if (
          ((b = o instanceof Error ? o : new Error(String(o))),
          H.signal.aborted)
        )
          return;
        if (D.shouldRetry && !D.shouldRetry(b, a)) break;
        if (a < D.attempts) {
          const m = Ze(D, a);
          for (const S of w) f?.(h, S, a + 1);
          if (
            (await new Promise((S) => {
              const x = setTimeout(S, m),
                U = () => {
                  clearTimeout(x), S();
                };
              H.signal.addEventListener("abort", U, { once: !0 });
            }),
            H.signal.aborted)
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
        attempts: D.attempts,
      }),
        u?.(h, a, b);
    k();
  }
  function A(h, w) {
    const O = t[h];
    if (!O) return;
    const D = { ...Qe, ...O.batch };
    T.has(h) || T.set(h, { resolverId: h, requirements: [], timer: null });
    const P = T.get(h);
    P.requirements.push(w),
      P.timer && clearTimeout(P.timer),
      (P.timer = setTimeout(() => {
        z(h);
      }, D.windowMs));
  }
  function z(h) {
    const w = T.get(h);
    if (!w || w.requirements.length === 0) return;
    const O = [...w.requirements];
    (w.requirements = []),
      (w.timer = null),
      C(h, O).then(() => {
        p?.();
      });
  }
  return {
    resolve(h) {
      if (d.has(h.id)) return;
      const w = c(h.requirement);
      if (!w) {
        console.warn(`[Directive] No resolver found for requirement: ${h.id}`);
        return;
      }
      const O = t[w];
      if (!O) return;
      if (O.batch?.enabled) {
        A(w, h);
        return;
      }
      const D = new AbortController(),
        P = Date.now(),
        H = {
          requirementId: h.id,
          resolverId: w,
          controller: D,
          startedAt: P,
          attempt: 1,
          status: { state: "pending", requirementId: h.id, startedAt: P },
          originalRequirement: h,
        };
      d.set(h.id, H),
        n?.(w, h),
        y(w, h, D).finally(() => {
          d.delete(h.id) && p?.();
        });
    },
    cancel(h) {
      const w = d.get(h);
      w &&
        (w.controller.abort(),
        d.delete(h),
        $.set(h, {
          state: "canceled",
          requirementId: h,
          canceledAt: Date.now(),
        }),
        k(),
        v?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [h] of d) this.cancel(h);
      for (const h of T.values()) h.timer && clearTimeout(h.timer);
      T.clear();
    },
    getStatus(h) {
      const w = d.get(h);
      return w ? w.status : $.get(h) || { state: "idle" };
    },
    getInflight() {
      return [...d.keys()];
    },
    getInflightInfo() {
      return [...d.values()].map((h) => ({
        id: h.requirementId,
        resolverId: h.resolverId,
        startedAt: h.startedAt,
      }));
    },
    isResolving(h) {
      return d.has(h);
    },
    processBatches() {
      for (const h of T.keys()) z(h);
    },
    registerDefinitions(h) {
      for (const [w, O] of Object.entries(h)) t[w] = O;
      I.clear();
    },
  };
}
function Nt(e) {
  let { config: t, facts: s, store: r, onSnapshot: n, onTimeTravel: i } = e,
    u = t.timeTravel ?? !1,
    f = t.maxSnapshots ?? 100,
    v = [],
    p = -1,
    d = 1,
    $ = !1,
    B = !1,
    T = [],
    I = null,
    q = -1;
  function k() {
    return r.toObject();
  }
  function M() {
    const L = k();
    return structuredClone(L);
  }
  function V(L) {
    if (!je(L)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    r.batch(() => {
      for (const [c, E] of Object.entries(L)) {
        if (c === "__proto__" || c === "constructor" || c === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${c}" during fact restoration`,
          );
          continue;
        }
        s[c] = E;
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
      return [...v];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(L) {
      if (!u || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: L };
      const c = { id: d++, timestamp: Date.now(), facts: M(), trigger: L };
      for (
        p < v.length - 1 && v.splice(p + 1), v.push(c), p = v.length - 1;
        v.length > f;
      )
        v.shift(), p--;
      return n?.(c), c;
    },
    restore(L) {
      if (u) {
        ($ = !0), (B = !0);
        try {
          V(L.facts);
        } finally {
          ($ = !1), (B = !1);
        }
      }
    },
    goBack(L = 1) {
      if (!u || v.length === 0) return;
      let c = p,
        E = p,
        y = T.find((A) => p > A.startIndex && p <= A.endIndex);
      if (y) E = y.startIndex;
      else if (T.find((A) => p === A.startIndex)) {
        const A = T.find((z) => z.endIndex < p && p - z.endIndex <= L);
        E = A ? A.startIndex : Math.max(0, p - L);
      } else E = Math.max(0, p - L);
      if (c === E) return;
      p = E;
      const C = v[p];
      C && (this.restore(C), i?.(c, E));
    },
    goForward(L = 1) {
      if (!u || v.length === 0) return;
      let c = p,
        E = p,
        y = T.find((A) => p >= A.startIndex && p < A.endIndex);
      if ((y ? (E = y.endIndex) : (E = Math.min(v.length - 1, p + L)), c === E))
        return;
      p = E;
      const C = v[p];
      C && (this.restore(C), i?.(c, E));
    },
    goTo(L) {
      if (!u) return;
      const c = v.findIndex((C) => C.id === L);
      if (c === -1) {
        console.warn(`[Directive] Snapshot ${L} not found`);
        return;
      }
      const E = p;
      p = c;
      const y = v[p];
      y && (this.restore(y), i?.(E, c));
    },
    replay() {
      if (!u || v.length === 0) return;
      p = 0;
      const L = v[0];
      L && this.restore(L);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: v, currentIndex: p });
    },
    import(L) {
      if (u)
        try {
          const c = JSON.parse(L);
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
          for (const y of c.snapshots) {
            if (typeof y != "object" || y === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof y.id != "number" ||
              typeof y.timestamp != "number" ||
              typeof y.trigger != "string" ||
              typeof y.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!je(y.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (v.length = 0), v.push(...c.snapshots), (p = c.currentIndex);
          const E = v[p];
          E && this.restore(E);
        } catch (c) {
          console.error("[Directive] Failed to import time-travel data:", c);
        }
    },
    beginChangeset(L) {
      u && ((I = L), (q = p));
    },
    endChangeset() {
      !u ||
        I === null ||
        (p > q && T.push({ label: I, startIndex: q, endIndex: p }),
        (I = null),
        (q = -1));
    },
    pause() {
      $ = !0;
    },
    resume() {
      $ = !1;
    },
  };
}
function Ft() {
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
var Se = new Set(["__proto__", "constructor", "prototype"]);
function gt(e) {
  const t = Object.create(null),
    s = Object.create(null),
    r = Object.create(null),
    n = Object.create(null),
    i = Object.create(null),
    u = Object.create(null);
  for (const l of e.modules) {
    const g = (j, K) => {
      if (j) {
        for (const X of Object.keys(j))
          if (Se.has(X))
            throw new Error(
              `[Directive] Security: Module "${l.id}" has dangerous key "${X}" in ${K}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    g(l.schema, "schema"),
      g(l.events, "events"),
      g(l.derive, "derive"),
      g(l.effects, "effects"),
      g(l.constraints, "constraints"),
      g(l.resolvers, "resolvers"),
      Object.assign(t, l.schema),
      l.events && Object.assign(s, l.events),
      l.derive && Object.assign(r, l.derive),
      l.effects && Object.assign(n, l.effects),
      l.constraints && Object.assign(i, l.constraints),
      l.resolvers && Object.assign(u, l.resolvers);
  }
  let f = null;
  if (e.modules.some((l) => l.snapshotEvents)) {
    f = new Set();
    for (const l of e.modules) {
      const g = l;
      if (g.snapshotEvents) for (const j of g.snapshotEvents) f.add(j);
      else if (g.events) for (const j of Object.keys(g.events)) f.add(j);
    }
  }
  let v = 0,
    p = !1,
    d = Lt();
  for (const l of e.plugins ?? []) d.register(l);
  let $ = Bt({
      config: e.errorBoundary,
      onError: (l) => d.emitError(l),
      onRecovery: (l, g) => d.emitErrorRecovery(l, g),
    }),
    B = () => {},
    T = () => {},
    I = null,
    q = e.debug?.runHistory ?? !1,
    k = e.debug?.maxRuns ?? 100,
    M = [],
    V = new Map(),
    L = 0,
    c = null,
    E = [],
    y = new Map(),
    C = new Map(),
    A = new Map(),
    z = null,
    h = 0,
    w = 0,
    O = {
      count: 0,
      totalDuration: 0,
      avgDuration: 0,
      maxDuration: 0,
      avgResolverCount: 0,
      totalResolverCount: 0,
      avgFactChangeCount: 0,
      totalFactChangeCount: 0,
    },
    { store: D, facts: P } = Rt({
      schema: t,
      onChange: (l, g, j) => {
        d.emitFactSet(l, g, j),
          B(l),
          q && E.push({ key: String(l), oldValue: j, newValue: g }),
          !I?.isRestoring && (v === 0 && (p = !0), F.changedKeys.add(l), ce());
      },
      onBatch: (l) => {
        d.emitFactsBatch(l);
        const g = [];
        for (const j of l) g.push(j.key);
        if (q)
          for (const j of l)
            j.type === "delete"
              ? E.push({ key: j.key, oldValue: j.prev, newValue: void 0 })
              : E.push({ key: j.key, oldValue: j.prev, newValue: j.value });
        if ((T(g), !I?.isRestoring)) {
          v === 0 && (p = !0);
          for (const j of l) F.changedKeys.add(j.key);
          ce();
        }
      },
    }),
    H = Tt({
      definitions: r,
      facts: P,
      onCompute: (l, g, j, K) => {
        d.emitDerivationCompute(l, g, K),
          c &&
            c.derivationsRecomputed.push({
              id: l,
              deps: K ? [...K] : [],
              oldValue: j,
              newValue: g,
            });
      },
      onInvalidate: (l) => d.emitDerivationInvalidate(l),
      onError: (l, g) => {
        $.handleError("derivation", l, g);
      },
    });
  (B = (l) => H.invalidate(l)), (T = (l) => H.invalidateMany(l));
  const N = It({
      definitions: n,
      facts: P,
      store: D,
      onRun: (l, g) => {
        d.emitEffectRun(l), c && c.effectsRun.push({ id: l, triggeredBy: g });
      },
      onError: (l, g) => {
        $.handleError("effect", l, g),
          d.emitEffectError(l, g),
          c && c.effectErrors.push({ id: l, error: String(g) });
      },
    }),
    b = Mt({
      definitions: i,
      facts: P,
      onEvaluate: (l, g) => d.emitConstraintEvaluate(l, g),
      onError: (l, g) => {
        $.handleError("constraint", l, g), d.emitConstraintError(l, g);
      },
    });
  function R(l) {
    const g = V.get(l);
    if (g && g.status === "pending") {
      g.status = "settled";
      const j = A.get(l);
      (g.duration =
        j !== void 0 ? performance.now() - j : Date.now() - g.timestamp),
        A.delete(l),
        C.delete(l),
        (g.causalChain = m(g)),
        S(g),
        w++,
        d.emitRunComplete(g);
    }
  }
  function a(l) {
    const g = y.get(l);
    if ((y.delete(l), g !== void 0)) {
      const j = (C.get(g) ?? 1) - 1;
      j <= 0 ? R(g) : C.set(g, j);
    }
  }
  function o() {
    const l = M.shift();
    if (l && (V.delete(l.id), A.delete(l.id), l.status === "pending")) {
      C.delete(l.id);
      for (const [g, j] of y) j === l.id && y.delete(g);
    }
  }
  function m(l) {
    const g = [];
    for (const j of l.factChanges) g.push(`${j.key} changed`);
    for (const j of l.derivationsRecomputed) g.push(`${j.id} recomputed`);
    for (const j of l.constraintsHit) g.push(`${j.id} constraint hit`);
    for (const j of l.requirementsAdded) g.push(`${j.type} requirement added`);
    for (const j of l.resolversCompleted)
      g.push(`${j.resolver} resolved (${j.duration.toFixed(0)}ms)`);
    for (const j of l.resolversErrored) g.push(`${j.resolver} errored`);
    for (const j of l.effectsRun) g.push(`${j.id} effect ran`);
    return g.join(" → ");
  }
  function S(l) {
    O.count++,
      (O.totalDuration += l.duration),
      (O.avgDuration = O.totalDuration / O.count),
      l.duration > O.maxDuration && (O.maxDuration = l.duration);
    const g = l.resolversStarted.length;
    (O.totalResolverCount += g),
      (O.avgResolverCount = O.totalResolverCount / O.count);
    const j = l.factChanges.length;
    (O.totalFactChangeCount += j),
      (O.avgFactChangeCount = O.totalFactChangeCount / O.count);
    const K = [];
    O.count > 3 &&
      l.duration > O.avgDuration * 5 &&
      K.push(
        `Duration ${l.duration.toFixed(0)}ms is 5x+ above average (${O.avgDuration.toFixed(0)}ms)`,
      ),
      l.resolversErrored.length > 0 &&
        K.push(`${l.resolversErrored.length} resolver(s) errored`),
      K.length > 0 && (l.anomalies = K);
  }
  const x = zt({
      definitions: u,
      facts: P,
      store: D,
      onStart: (l, g) => d.emitResolverStart(l, g),
      onComplete: (l, g, j) => {
        if (
          (d.emitResolverComplete(l, g, j),
          d.emitRequirementMet(g, l),
          b.markResolved(g.fromConstraint),
          q)
        ) {
          const K = y.get(g.id);
          if (K !== void 0) {
            const X = V.get(K);
            X &&
              X.resolversCompleted.push({
                resolver: l,
                requirementId: g.id,
                duration: j,
              });
          }
          a(g.id);
        }
      },
      onError: (l, g, j) => {
        if (
          ($.handleError("resolver", l, j, g), d.emitResolverError(l, g, j), q)
        ) {
          const K = y.get(g.id);
          if (K !== void 0) {
            const X = V.get(K);
            X &&
              X.resolversErrored.push({
                resolver: l,
                requirementId: g.id,
                error: String(j),
              });
          }
          a(g.id);
        }
      },
      onRetry: (l, g, j) => d.emitResolverRetry(l, g, j),
      onCancel: (l, g) => {
        d.emitResolverCancel(l, g), d.emitRequirementCanceled(g), q && a(g.id);
      },
      onResolutionComplete: () => {
        re(), ce();
      },
    }),
    U = new Set();
  function Q() {
    for (const l of U) l();
  }
  const ee = e.debug?.timeTravel
    ? Nt({
        config: e.debug,
        facts: P,
        store: D,
        onSnapshot: (l) => {
          d.emitSnapshot(l), Q();
        },
        onTimeTravel: (l, g) => {
          d.emitTimeTravel(l, g), Q();
        },
      })
    : Ft();
  I = ee;
  const W = new Set();
  function re() {
    for (const l of W) l();
  }
  let se = 50,
    me = 0,
    F = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new Ke(),
      readyPromise: null,
      readyResolve: null,
    };
  function ce() {
    !F.isRunning ||
      F.reconcileScheduled ||
      F.isInitializing ||
      ((F.reconcileScheduled = !0),
      re(),
      queueMicrotask(() => {
        (F.reconcileScheduled = !1),
          F.isRunning && !F.isInitializing && J().catch((l) => {});
      }));
  }
  async function J() {
    if (F.isReconciling) return;
    if ((me++, me > se)) {
      q && (E.length = 0), (me = 0);
      return;
    }
    (F.isReconciling = !0), re();
    const l = q ? performance.now() : 0;
    if (q) {
      const g = ++L;
      A.set(g, l),
        (c = {
          id: g,
          timestamp: Date.now(),
          duration: 0,
          status: "pending",
          factChanges: E.splice(0),
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
      F.changedKeys.size > 0 &&
        ((f === null || p) &&
          ee.takeSnapshot(`facts-changed:${[...F.changedKeys].join(",")}`),
        (p = !1));
      const g = P.$snapshot();
      d.emitReconcileStart(g), await N.runEffects(F.changedKeys);
      const j = new Set(F.changedKeys);
      F.changedKeys.clear();
      const K = await b.evaluate(j),
        X = new Ke();
      for (const Z of K) X.add(Z), d.emitRequirementCreated(Z);
      if (c) {
        const Z = new Set(K.map((ue) => ue.fromConstraint));
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
      const { added: Y, removed: ie } = X.diff(F.previousRequirements);
      if (c) {
        for (const Z of Y)
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
      for (const Z of ie) x.cancel(Z.id);
      for (const Z of Y) x.resolve(Z);
      if (c) {
        const Z = x.getInflightInfo();
        for (const ue of Y) {
          const we = Z.find((ge) => ge.id === ue.id);
          c.resolversStarted.push({
            resolver: we?.resolverId ?? "unknown",
            requirementId: ue.id,
          }),
            y.set(ue.id, c.id);
        }
      }
      F.previousRequirements = X;
      const ae = x.getInflightInfo(),
        be = {
          unmet: K.filter((Z) => !x.isResolving(Z.id)),
          inflight: ae,
          completed: [],
          canceled: ie.map((Z) => ({
            id: Z.id,
            resolverId:
              ae.find((ue) => ue.id === Z.id)?.resolverId ?? "unknown",
          })),
        };
      d.emitReconcileEnd(be),
        F.isReady ||
          ((F.isReady = !0),
          F.readyResolve && (F.readyResolve(), (F.readyResolve = null)));
    } finally {
      if (c) {
        if (
          ((c.duration = performance.now() - l),
          c.factChanges.length > 0 ||
            c.constraintsHit.length > 0 ||
            c.requirementsAdded.length > 0 ||
            c.effectsRun.length > 0)
        ) {
          const g = c.resolversStarted.length;
          g === 0
            ? ((c.status = "settled"),
              (c.causalChain = m(c)),
              S(c),
              M.push(c),
              V.set(c.id, c),
              M.length > k && o(),
              w++,
              d.emitRunComplete(c))
            : ((c.status = "pending"),
              M.push(c),
              V.set(c.id, c),
              M.length > k && o(),
              w++,
              C.set(c.id, g));
        } else A.delete(c.id);
        c = null;
      }
      (F.isReconciling = !1),
        F.changedKeys.size > 0 ? ce() : F.reconcileScheduled || (me = 0),
        re();
    }
  }
  const te = new Proxy(
      {},
      {
        get(l, g) {
          if (typeof g != "symbol" && !Se.has(g)) return H.get(g);
        },
        has(l, g) {
          return typeof g == "symbol" || Se.has(g) ? !1 : g in r;
        },
        ownKeys() {
          return Object.keys(r);
        },
        getOwnPropertyDescriptor(l, g) {
          if (typeof g != "symbol" && !Se.has(g) && g in r)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    ne = new Proxy(
      {},
      {
        get(l, g) {
          if (typeof g != "symbol" && !Se.has(g))
            return (j) => {
              const K = s[g];
              if (K) {
                v++, (f === null || f.has(g)) && (p = !0);
                try {
                  D.batch(() => {
                    K(P, { type: g, ...j });
                  });
                } finally {
                  v--;
                }
              }
            };
        },
        has(l, g) {
          return typeof g == "symbol" || Se.has(g) ? !1 : g in s;
        },
        ownKeys() {
          return Object.keys(s);
        },
        getOwnPropertyDescriptor(l, g) {
          if (typeof g != "symbol" && !Se.has(g) && g in s)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    oe = {
      facts: P,
      debug: ee.isEnabled ? ee : null,
      derive: te,
      events: ne,
      constraints: {
        disable: (l) => b.disable(l),
        enable: (l) => b.enable(l),
        isDisabled: (l) => b.isDisabled(l),
      },
      effects: {
        disable: (l) => N.disable(l),
        enable: (l) => N.enable(l),
        isEnabled: (l) => N.isEnabled(l),
      },
      get runHistory() {
        return q ? ((!z || h !== w) && ((z = [...M]), (h = w)), z) : null;
      },
      initialize() {
        if (!F.isInitialized) {
          F.isInitializing = !0;
          for (const l of e.modules)
            l.init &&
              D.batch(() => {
                l.init(P);
              });
          e.onAfterModuleInit &&
            D.batch(() => {
              e.onAfterModuleInit();
            }),
            (F.isInitializing = !1),
            (F.isInitialized = !0);
          for (const l of Object.keys(r)) H.get(l);
        }
      },
      start() {
        if (!F.isRunning) {
          F.isInitialized || this.initialize(), (F.isRunning = !0);
          for (const l of e.modules) l.hooks?.onStart?.(oe);
          d.emitStart(oe), ce();
        }
      },
      stop() {
        if (F.isRunning) {
          (F.isRunning = !1), x.cancelAll(), N.cleanupAll();
          for (const l of e.modules) l.hooks?.onStop?.(oe);
          d.emitStop(oe);
        }
      },
      destroy() {
        this.stop(),
          (F.isDestroyed = !0),
          W.clear(),
          U.clear(),
          (M.length = 0),
          V.clear(),
          y.clear(),
          C.clear(),
          A.clear(),
          (E.length = 0),
          (c = null),
          (z = null),
          d.emitDestroy(oe);
      },
      dispatch(l) {
        if (Se.has(l.type)) return;
        const g = s[l.type];
        if (g) {
          v++, (f === null || f.has(l.type)) && (p = !0);
          try {
            D.batch(() => {
              g(P, l);
            });
          } finally {
            v--;
          }
        }
      },
      read(l) {
        return H.get(l);
      },
      subscribe(l, g) {
        const j = [],
          K = [];
        for (const Y of l) Y in r ? j.push(Y) : Y in t && K.push(Y);
        const X = [];
        return (
          j.length > 0 && X.push(H.subscribe(j, g)),
          K.length > 0 && X.push(D.subscribe(K, g)),
          () => {
            for (const Y of X) Y();
          }
        );
      },
      watch(l, g, j) {
        const K = j?.equalityFn
          ? (Y, ie) => j.equalityFn(Y, ie)
          : (Y, ie) => Object.is(Y, ie);
        if (l in r) {
          let Y = H.get(l);
          return H.subscribe([l], () => {
            const ie = H.get(l);
            if (!K(ie, Y)) {
              const ae = Y;
              (Y = ie), g(ie, ae);
            }
          });
        }
        let X = D.get(l);
        return D.subscribe([l], () => {
          const Y = D.get(l);
          if (!K(Y, X)) {
            const ie = X;
            (X = Y), g(Y, ie);
          }
        });
      },
      when(l, g) {
        return new Promise((j, K) => {
          const X = D.toObject();
          if (l(X)) {
            j();
            return;
          }
          let Y,
            ie,
            ae = () => {
              Y?.(), ie !== void 0 && clearTimeout(ie);
            };
          (Y = D.subscribeAll(() => {
            const be = D.toObject();
            l(be) && (ae(), j());
          })),
            g?.timeout !== void 0 &&
              g.timeout > 0 &&
              (ie = setTimeout(() => {
                ae(),
                  K(
                    new Error(
                      `[Directive] when: timed out after ${g.timeout}ms`,
                    ),
                  );
              }, g.timeout));
        });
      },
      inspect() {
        return {
          unmet: F.previousRequirements.all(),
          inflight: x.getInflightInfo(),
          constraints: b.getAllStates().map((l) => ({
            id: l.id,
            active: l.lastResult ?? !1,
            disabled: b.isDisabled(l.id),
            priority: l.priority,
            hitCount: l.hitCount,
            lastActiveAt: l.lastActiveAt,
          })),
          resolvers: Object.fromEntries(
            x.getInflight().map((l) => [l, x.getStatus(l)]),
          ),
          resolverDefs: Object.entries(u).map(([l, g]) => ({
            id: l,
            requirement:
              typeof g.requirement == "string" ? g.requirement : "(predicate)",
          })),
          runHistoryEnabled: q,
          ...(q
            ? {
                runHistory: M.map((l) => ({
                  ...l,
                  factChanges: l.factChanges.map((g) => ({ ...g })),
                  derivationsRecomputed: l.derivationsRecomputed.map((g) => ({
                    ...g,
                    deps: [...g.deps],
                  })),
                  constraintsHit: l.constraintsHit.map((g) => ({
                    ...g,
                    deps: [...g.deps],
                  })),
                  requirementsAdded: l.requirementsAdded.map((g) => ({ ...g })),
                  requirementsRemoved: l.requirementsRemoved.map((g) => ({
                    ...g,
                  })),
                  resolversStarted: l.resolversStarted.map((g) => ({ ...g })),
                  resolversCompleted: l.resolversCompleted.map((g) => ({
                    ...g,
                  })),
                  resolversErrored: l.resolversErrored.map((g) => ({ ...g })),
                  effectsRun: l.effectsRun.map((g) => ({
                    ...g,
                    triggeredBy: [...g.triggeredBy],
                  })),
                  effectErrors: l.effectErrors.map((g) => ({ ...g })),
                })),
              }
            : {}),
        };
      },
      explain(l) {
        const g = F.previousRequirements.all().find((Z) => Z.id === l);
        if (!g) return null;
        const j = b.getState(g.fromConstraint),
          K = x.getStatus(l),
          X = {},
          Y = D.toObject();
        for (const [Z, ue] of Object.entries(Y)) X[Z] = ue;
        const ie = [
            `Requirement "${g.requirement.type}" (id: ${g.id})`,
            `├─ Produced by constraint: ${g.fromConstraint}`,
            `├─ Constraint priority: ${j?.priority ?? 0}`,
            `├─ Constraint active: ${j?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${K.state}`,
          ],
          ae = Object.entries(g.requirement)
            .filter(([Z]) => Z !== "type")
            .map(([Z, ue]) => `${Z}=${JSON.stringify(ue)}`)
            .join(", ");
        ae && ie.push(`├─ Requirement payload: { ${ae} }`);
        const be = Object.entries(X).slice(0, 10);
        return (
          be.length > 0 &&
            (ie.push("└─ Relevant facts:"),
            be.forEach(([Z, ue], we) => {
              const ge = we === be.length - 1 ? "   └─" : "   ├─",
                xe = typeof ue == "object" ? JSON.stringify(ue) : String(ue);
              ie.push(
                `${ge} ${Z} = ${xe.slice(0, 50)}${xe.length > 50 ? "..." : ""}`,
              );
            })),
          ie.join(`
`)
        );
      },
      async settle(l = 5e3) {
        const g = Date.now();
        for (;;) {
          await new Promise((K) => setTimeout(K, 0));
          const j = this.inspect();
          if (
            j.inflight.length === 0 &&
            !F.isReconciling &&
            !F.reconcileScheduled
          )
            return;
          if (Date.now() - g > l) {
            const K = [];
            j.inflight.length > 0 &&
              K.push(
                `${j.inflight.length} resolvers inflight: ${j.inflight.map((Y) => Y.resolverId).join(", ")}`,
              ),
              F.isReconciling && K.push("reconciliation in progress"),
              F.reconcileScheduled && K.push("reconcile scheduled");
            const X = F.previousRequirements.all();
            throw (
              (X.length > 0 &&
                K.push(
                  `${X.length} unmet requirements: ${X.map((Y) => Y.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${l}ms. ${K.join("; ")}`,
              ))
            );
          }
          await new Promise((K) => setTimeout(K, 10));
        }
      },
      getSnapshot() {
        return { facts: D.toObject(), version: 1 };
      },
      getDistributableSnapshot(l = {}) {
        let {
            includeDerivations: g,
            excludeDerivations: j,
            includeFacts: K,
            ttlSeconds: X,
            metadata: Y,
            includeVersion: ie,
          } = l,
          ae = {},
          be = Object.keys(r),
          Z;
        if ((g ? (Z = g.filter((ge) => be.includes(ge))) : (Z = be), j)) {
          const ge = new Set(j);
          Z = Z.filter((xe) => !ge.has(xe));
        }
        for (const ge of Z)
          try {
            ae[ge] = H.get(ge);
          } catch {}
        if (K && K.length > 0) {
          const ge = D.toObject();
          for (const xe of K) xe in ge && (ae[xe] = ge[xe]);
        }
        const ue = Date.now(),
          we = { data: ae, createdAt: ue };
        return (
          X !== void 0 && X > 0 && (we.expiresAt = ue + X * 1e3),
          ie && (we.version = At(ae)),
          Y && (we.metadata = Y),
          we
        );
      },
      watchDistributableSnapshot(l, g) {
        let { includeDerivations: j, excludeDerivations: K } = l,
          X = Object.keys(r),
          Y;
        if ((j ? (Y = j.filter((ae) => X.includes(ae))) : (Y = X), K)) {
          const ae = new Set(K);
          Y = Y.filter((be) => !ae.has(be));
        }
        if (Y.length === 0) return () => {};
        let ie = this.getDistributableSnapshot({
          ...l,
          includeVersion: !0,
        }).version;
        return H.subscribe(Y, () => {
          const ae = this.getDistributableSnapshot({
            ...l,
            includeVersion: !0,
          });
          ae.version !== ie && ((ie = ae.version), g(ae));
        });
      },
      restore(l) {
        if (!l || typeof l != "object")
          throw new Error(
            "[Directive] restore() requires a valid snapshot object",
          );
        if (!l.facts || typeof l.facts != "object")
          throw new Error(
            "[Directive] restore() snapshot must have a facts object",
          );
        if (!je(l))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        D.batch(() => {
          for (const [g, j] of Object.entries(l.facts))
            Se.has(g) || D.set(g, j);
        });
      },
      onSettledChange(l) {
        return (
          W.add(l),
          () => {
            W.delete(l);
          }
        );
      },
      onTimeTravelChange(l) {
        return (
          U.add(l),
          () => {
            U.delete(l);
          }
        );
      },
      batch(l) {
        D.batch(l);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !F.isReconciling &&
          !F.reconcileScheduled
        );
      },
      get isRunning() {
        return F.isRunning;
      },
      get isInitialized() {
        return F.isInitialized;
      },
      get isReady() {
        return F.isReady;
      },
      whenReady() {
        return F.isReady
          ? Promise.resolve()
          : F.isRunning
            ? (F.readyPromise ||
                (F.readyPromise = new Promise((l) => {
                  F.readyResolve = l;
                })),
              F.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function Ce(l) {
    if (F.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${l.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (F.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${l.id}" on a destroyed system.`,
      );
    const g = (j, K) => {
      if (j) {
        for (const X of Object.keys(j))
          if (Se.has(X))
            throw new Error(
              `[Directive] Security: Module "${l.id}" has dangerous key "${X}" in ${K}.`,
            );
      }
    };
    g(l.schema, "schema"),
      g(l.events, "events"),
      g(l.derive, "derive"),
      g(l.effects, "effects"),
      g(l.constraints, "constraints"),
      g(l.resolvers, "resolvers");
    for (const j of Object.keys(l.schema))
      if (j in t)
        throw new Error(
          `[Directive] Schema collision: Fact "${j}" already exists. Cannot register module "${l.id}".`,
        );
    if (l.snapshotEvents) {
      f === null && (f = new Set(Object.keys(s)));
      for (const j of l.snapshotEvents) f.add(j);
    } else if (f !== null && l.events)
      for (const j of Object.keys(l.events)) f.add(j);
    Object.assign(t, l.schema),
      l.events && Object.assign(s, l.events),
      l.derive && (Object.assign(r, l.derive), H.registerDefinitions(l.derive)),
      l.effects &&
        (Object.assign(n, l.effects), N.registerDefinitions(l.effects)),
      l.constraints &&
        (Object.assign(i, l.constraints), b.registerDefinitions(l.constraints)),
      l.resolvers &&
        (Object.assign(u, l.resolvers), x.registerDefinitions(l.resolvers)),
      D.registerKeys(l.schema),
      e.modules.push(l),
      l.init &&
        D.batch(() => {
          l.init(P);
        }),
      l.hooks?.onInit?.(oe),
      F.isRunning && (l.hooks?.onStart?.(oe), ce());
  }
  (oe.registerModule = Ce), d.emitInit(oe);
  for (const l of e.modules) l.hooks?.onInit?.(oe);
  return oe;
}
var fe = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  G = "::";
function Pt(e) {
  const t = Object.keys(e),
    s = new Set(),
    r = new Set(),
    n = [],
    i = [];
  function u(f) {
    if (s.has(f)) return;
    if (r.has(f)) {
      const p = i.indexOf(f),
        d = [...i.slice(p), f].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${d}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    r.add(f), i.push(f);
    const v = e[f];
    if (v?.crossModuleDeps)
      for (const p of Object.keys(v.crossModuleDeps)) t.includes(p) && u(p);
    i.pop(), r.delete(f), s.add(f), n.push(f);
  }
  for (const f of t) u(f);
  return n;
}
var et = new WeakMap(),
  tt = new WeakMap(),
  rt = new WeakMap(),
  nt = new WeakMap();
function Vt(e) {
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
  return Ht(t);
}
function Ht(e) {
  const t = e.modules,
    s = new Set(Object.keys(t)),
    r = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let n,
    i = e.initOrder ?? "auto";
  if (Array.isArray(i)) {
    const c = i,
      E = Object.keys(t).filter((y) => !c.includes(y));
    if (E.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${E.join(", ")}. All modules must be included in the explicit order.`,
      );
    n = c;
  } else i === "declaration" ? (n = Object.keys(t)) : (n = Pt(t));
  let u = e.debug,
    f = e.errorBoundary;
  e.zeroConfig &&
    ((u = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (f = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const c of Object.keys(t)) {
    if (c.includes(G))
      throw new Error(
        `[Directive] Module name "${c}" contains the reserved separator "${G}". Module names cannot contain "${G}".`,
      );
    const E = t[c];
    if (E) {
      for (const y of Object.keys(E.schema.facts))
        if (y.includes(G))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${c}" contains the reserved separator "${G}". Schema keys cannot contain "${G}".`,
          );
    }
  }
  const v = [];
  for (const c of n) {
    const E = t[c];
    if (!E) continue;
    const y = E.crossModuleDeps && Object.keys(E.crossModuleDeps).length > 0,
      C = y ? Object.keys(E.crossModuleDeps) : [],
      A = {};
    for (const [b, R] of Object.entries(E.schema.facts)) A[`${c}${G}${b}`] = R;
    const z = {};
    if (E.schema.derivations)
      for (const [b, R] of Object.entries(E.schema.derivations))
        z[`${c}${G}${b}`] = R;
    const h = {};
    if (E.schema.events)
      for (const [b, R] of Object.entries(E.schema.events))
        h[`${c}${G}${b}`] = R;
    const w = E.init
        ? (b) => {
            const R = he(b, c);
            E.init(R);
          }
        : void 0,
      O = {};
    if (E.derive)
      for (const [b, R] of Object.entries(E.derive))
        O[`${c}${G}${b}`] = (a, o) => {
          const m = y ? Ee(a, c, C) : he(a, c),
            S = Ue(o, c);
          return R(m, S);
        };
    const D = {};
    if (E.events)
      for (const [b, R] of Object.entries(E.events))
        D[`${c}${G}${b}`] = (a, o) => {
          const m = he(a, c);
          R(m, o);
        };
    const P = {};
    if (E.constraints)
      for (const [b, R] of Object.entries(E.constraints)) {
        const a = R;
        P[`${c}${G}${b}`] = {
          ...a,
          deps: a.deps?.map((o) => `${c}${G}${o}`),
          when: (o) => {
            const m = y ? Ee(o, c, C) : he(o, c);
            return a.when(m);
          },
          require:
            typeof a.require == "function"
              ? (o) => {
                  const m = y ? Ee(o, c, C) : he(o, c);
                  return a.require(m);
                }
              : a.require,
        };
      }
    const H = {};
    if (E.resolvers)
      for (const [b, R] of Object.entries(E.resolvers)) {
        const a = R;
        H[`${c}${G}${b}`] = {
          ...a,
          resolve: async (o, m) => {
            const S = ze(m.facts, t, () => Object.keys(t));
            await a.resolve(o, { facts: S[c], signal: m.signal });
          },
        };
      }
    const N = {};
    if (E.effects)
      for (const [b, R] of Object.entries(E.effects)) {
        const a = R;
        N[`${c}${G}${b}`] = {
          ...a,
          run: (o, m) => {
            const S = y ? Ee(o, c, C) : he(o, c),
              x = m ? (y ? Ee(m, c, C) : he(m, c)) : void 0;
            return a.run(S, x);
          },
          deps: a.deps?.map((o) => `${c}${G}${o}`),
        };
      }
    v.push({
      id: E.id,
      schema: {
        facts: A,
        derivations: z,
        events: h,
        requirements: E.schema.requirements ?? {},
      },
      init: w,
      derive: O,
      events: D,
      effects: N,
      constraints: P,
      resolvers: H,
      hooks: E.hooks,
      snapshotEvents:
        r && !r.has(c) ? [] : E.snapshotEvents?.map((b) => `${c}${G}${b}`),
    });
  }
  let p = null,
    d = null;
  function $(c) {
    for (const [E, y] of Object.entries(c))
      if (!fe.has(E) && s.has(E)) {
        if (y && typeof y == "object" && !je(y))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${E}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [C, A] of Object.entries(y))
          fe.has(C) || (d.facts[`${E}${G}${C}`] = A);
      }
  }
  d = gt({
    modules: v.map((c) => ({
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
    debug: u,
    errorBoundary: f,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), p && ($(p), (p = null));
    },
  });
  const B = new Map();
  for (const c of Object.keys(t)) {
    const E = t[c];
    if (!E) continue;
    const y = [];
    for (const C of Object.keys(E.schema.facts)) y.push(`${c}${G}${C}`);
    if (E.schema.derivations)
      for (const C of Object.keys(E.schema.derivations)) y.push(`${c}${G}${C}`);
    B.set(c, y);
  }
  const T = { names: null };
  function I() {
    return T.names === null && (T.names = Object.keys(t)), T.names;
  }
  let q = ze(d.facts, t, I),
    k = Wt(d.derive, t, I),
    M = Kt(d, t, I),
    V = null,
    L = e.tickMs;
  return {
    _mode: "namespaced",
    facts: q,
    debug: d.debug,
    derive: k,
    events: M,
    constraints: d.constraints,
    effects: d.effects,
    get runHistory() {
      return d.runHistory;
    },
    get isRunning() {
      return d.isRunning;
    },
    get isSettled() {
      return d.isSettled;
    },
    get isInitialized() {
      return d.isInitialized;
    },
    get isReady() {
      return d.isReady;
    },
    whenReady: d.whenReady.bind(d),
    async hydrate(c) {
      if (d.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const E = await c();
      E && typeof E == "object" && (p = E);
    },
    initialize() {
      d.initialize();
    },
    start() {
      if ((d.start(), L && L > 0)) {
        const c = Object.keys(v[0]?.events ?? {}).find((E) =>
          E.endsWith(`${G}tick`),
        );
        c &&
          (V = setInterval(() => {
            d.dispatch({ type: c });
          }, L));
      }
    },
    stop() {
      V && (clearInterval(V), (V = null)), d.stop();
    },
    destroy() {
      this.stop(), d.destroy();
    },
    dispatch(c) {
      d.dispatch(c);
    },
    batch: d.batch.bind(d),
    read(c) {
      return d.read($e(c));
    },
    subscribe(c, E) {
      const y = [];
      for (const C of c)
        if (C.endsWith(".*")) {
          const A = C.slice(0, -2),
            z = B.get(A);
          z && y.push(...z);
        } else y.push($e(C));
      return d.subscribe(y, E);
    },
    subscribeModule(c, E) {
      const y = B.get(c);
      return !y || y.length === 0 ? () => {} : d.subscribe(y, E);
    },
    watch(c, E, y) {
      return d.watch($e(c), E, y);
    },
    when(c, E) {
      return d.when(() => c(q), E);
    },
    onSettledChange: d.onSettledChange.bind(d),
    onTimeTravelChange: d.onTimeTravelChange.bind(d),
    inspect: d.inspect.bind(d),
    settle: d.settle.bind(d),
    explain: d.explain.bind(d),
    getSnapshot: d.getSnapshot.bind(d),
    restore: d.restore.bind(d),
    getDistributableSnapshot(c) {
      const E = {
          ...c,
          includeDerivations: c?.includeDerivations?.map($e),
          excludeDerivations: c?.excludeDerivations?.map($e),
          includeFacts: c?.includeFacts?.map($e),
        },
        y = d.getDistributableSnapshot(E),
        C = {};
      for (const [A, z] of Object.entries(y.data)) {
        const h = A.indexOf(G);
        if (h > 0) {
          const w = A.slice(0, h),
            O = A.slice(h + G.length);
          C[w] || (C[w] = {}), (C[w][O] = z);
        } else C._root || (C._root = {}), (C._root[A] = z);
      }
      return { ...y, data: C };
    },
    watchDistributableSnapshot(c, E) {
      const y = {
        ...c,
        includeDerivations: c?.includeDerivations?.map($e),
        excludeDerivations: c?.excludeDerivations?.map($e),
        includeFacts: c?.includeFacts?.map($e),
      };
      return d.watchDistributableSnapshot(y, (C) => {
        const A = {};
        for (const [z, h] of Object.entries(C.data)) {
          const w = z.indexOf(G);
          if (w > 0) {
            const O = z.slice(0, w),
              D = z.slice(w + G.length);
            A[O] || (A[O] = {}), (A[O][D] = h);
          } else A._root || (A._root = {}), (A._root[z] = h);
        }
        E({ ...C, data: A });
      });
    },
    registerModule(c, E) {
      if (s.has(c))
        throw new Error(
          `[Directive] Module namespace "${c}" already exists. Cannot register a duplicate namespace.`,
        );
      if (c.includes(G))
        throw new Error(
          `[Directive] Module name "${c}" contains the reserved separator "${G}".`,
        );
      if (fe.has(c))
        throw new Error(
          `[Directive] Module name "${c}" is a blocked property.`,
        );
      for (const b of Object.keys(E.schema.facts))
        if (b.includes(G))
          throw new Error(
            `[Directive] Schema key "${b}" in module "${c}" contains the reserved separator "${G}".`,
          );
      const y = E,
        C = y.crossModuleDeps && Object.keys(y.crossModuleDeps).length > 0,
        A = C ? Object.keys(y.crossModuleDeps) : [],
        z = {};
      for (const [b, R] of Object.entries(y.schema.facts))
        z[`${c}${G}${b}`] = R;
      const h = y.init
          ? (b) => {
              const R = he(b, c);
              y.init(R);
            }
          : void 0,
        w = {};
      if (y.derive)
        for (const [b, R] of Object.entries(y.derive))
          w[`${c}${G}${b}`] = (a, o) => {
            const m = C ? Ee(a, c, A) : he(a, c),
              S = Ue(o, c);
            return R(m, S);
          };
      const O = {};
      if (y.events)
        for (const [b, R] of Object.entries(y.events))
          O[`${c}${G}${b}`] = (a, o) => {
            const m = he(a, c);
            R(m, o);
          };
      const D = {};
      if (y.constraints)
        for (const [b, R] of Object.entries(y.constraints)) {
          const a = R;
          D[`${c}${G}${b}`] = {
            ...a,
            deps: a.deps?.map((o) => `${c}${G}${o}`),
            when: (o) => {
              const m = C ? Ee(o, c, A) : he(o, c);
              return a.when(m);
            },
            require:
              typeof a.require == "function"
                ? (o) => {
                    const m = C ? Ee(o, c, A) : he(o, c);
                    return a.require(m);
                  }
                : a.require,
          };
        }
      const P = {};
      if (y.resolvers)
        for (const [b, R] of Object.entries(y.resolvers)) {
          const a = R;
          P[`${c}${G}${b}`] = {
            ...a,
            resolve: async (o, m) => {
              const S = ze(m.facts, t, I);
              await a.resolve(o, { facts: S[c], signal: m.signal });
            },
          };
        }
      const H = {};
      if (y.effects)
        for (const [b, R] of Object.entries(y.effects)) {
          const a = R;
          H[`${c}${G}${b}`] = {
            ...a,
            run: (o, m) => {
              const S = C ? Ee(o, c, A) : he(o, c),
                x = m ? (C ? Ee(m, c, A) : he(m, c)) : void 0;
              return a.run(S, x);
            },
            deps: a.deps?.map((o) => `${c}${G}${o}`),
          };
        }
      s.add(c), (t[c] = y), (T.names = null);
      const N = [];
      for (const b of Object.keys(y.schema.facts)) N.push(`${c}${G}${b}`);
      if (y.schema.derivations)
        for (const b of Object.keys(y.schema.derivations))
          N.push(`${c}${G}${b}`);
      B.set(c, N),
        d.registerModule({
          id: y.id,
          schema: z,
          requirements: y.schema.requirements ?? {},
          init: h,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(O).length > 0 ? O : void 0,
          effects: Object.keys(H).length > 0 ? H : void 0,
          constraints: Object.keys(D).length > 0 ? D : void 0,
          resolvers: Object.keys(P).length > 0 ? P : void 0,
          hooks: y.hooks,
          snapshotEvents:
            r && !r.has(c) ? [] : y.snapshotEvents?.map((b) => `${c}${G}${b}`),
        });
    },
  };
}
function $e(e) {
  if (e.includes(".")) {
    const [t, ...s] = e.split(".");
    return `${t}${G}${s.join(G)}`;
  }
  return e;
}
function he(e, t) {
  let s = et.get(e);
  if (s) {
    const n = s.get(t);
    if (n) return n;
  } else (s = new Map()), et.set(e, s);
  const r = new Proxy(
    {},
    {
      get(n, i) {
        if (typeof i != "symbol" && !fe.has(i))
          return i === "$store" || i === "$snapshot" ? e[i] : e[`${t}${G}${i}`];
      },
      set(n, i, u) {
        return typeof i == "symbol" || fe.has(i)
          ? !1
          : ((e[`${t}${G}${i}`] = u), !0);
      },
      has(n, i) {
        return typeof i == "symbol" || fe.has(i) ? !1 : `${t}${G}${i}` in e;
      },
      deleteProperty(n, i) {
        return typeof i == "symbol" || fe.has(i)
          ? !1
          : (delete e[`${t}${G}${i}`], !0);
      },
    },
  );
  return s.set(t, r), r;
}
function ze(e, t, s) {
  const r = tt.get(e);
  if (r) return r;
  const n = new Proxy(
    {},
    {
      get(i, u) {
        if (typeof u != "symbol" && !fe.has(u) && Object.hasOwn(t, u))
          return he(e, u);
      },
      has(i, u) {
        return typeof u == "symbol" || fe.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return s();
      },
      getOwnPropertyDescriptor(i, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return tt.set(e, n), n;
}
var it = new WeakMap();
function Ee(e, t, s) {
  let r = `${t}:${JSON.stringify([...s].sort())}`,
    n = it.get(e);
  if (n) {
    const v = n.get(r);
    if (v) return v;
  } else (n = new Map()), it.set(e, n);
  const i = new Set(s),
    u = ["self", ...s],
    f = new Proxy(
      {},
      {
        get(v, p) {
          if (typeof p != "symbol" && !fe.has(p)) {
            if (p === "self") return he(e, t);
            if (i.has(p)) return he(e, p);
          }
        },
        has(v, p) {
          return typeof p == "symbol" || fe.has(p)
            ? !1
            : p === "self" || i.has(p);
        },
        ownKeys() {
          return u;
        },
        getOwnPropertyDescriptor(v, p) {
          if (typeof p != "symbol" && (p === "self" || i.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return n.set(r, f), f;
}
function Ue(e, t) {
  let s = nt.get(e);
  if (s) {
    const n = s.get(t);
    if (n) return n;
  } else (s = new Map()), nt.set(e, s);
  const r = new Proxy(
    {},
    {
      get(n, i) {
        if (typeof i != "symbol" && !fe.has(i)) return e[`${t}${G}${i}`];
      },
      has(n, i) {
        return typeof i == "symbol" || fe.has(i) ? !1 : `${t}${G}${i}` in e;
      },
    },
  );
  return s.set(t, r), r;
}
function Wt(e, t, s) {
  const r = rt.get(e);
  if (r) return r;
  const n = new Proxy(
    {},
    {
      get(i, u) {
        if (typeof u != "symbol" && !fe.has(u) && Object.hasOwn(t, u))
          return Ue(e, u);
      },
      has(i, u) {
        return typeof u == "symbol" || fe.has(u) ? !1 : Object.hasOwn(t, u);
      },
      ownKeys() {
        return s();
      },
      getOwnPropertyDescriptor(i, u) {
        if (typeof u != "symbol" && Object.hasOwn(t, u))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return rt.set(e, n), n;
}
var ot = new WeakMap();
function Kt(e, t, s) {
  let r = ot.get(e);
  return (
    r || ((r = new Map()), ot.set(e, r)),
    new Proxy(
      {},
      {
        get(n, i) {
          if (typeof i == "symbol" || fe.has(i) || !Object.hasOwn(t, i)) return;
          const u = r.get(i);
          if (u) return u;
          const f = new Proxy(
            {},
            {
              get(v, p) {
                if (typeof p != "symbol" && !fe.has(p))
                  return (d) => {
                    e.dispatch({ type: `${i}${G}${p}`, ...d });
                  };
              },
            },
          );
          return r.set(i, f), f;
        },
        has(n, i) {
          return typeof i == "symbol" || fe.has(i) ? !1 : Object.hasOwn(t, i);
        },
        ownKeys() {
          return s();
        },
        getOwnPropertyDescriptor(n, i) {
          if (typeof i != "symbol" && Object.hasOwn(t, i))
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
  if (e.initialFacts && !je(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let s = e.debug,
    r = e.errorBoundary;
  e.zeroConfig &&
    ((s = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (r = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let n = null,
    i = null;
  i = gt({
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
    debug: s,
    errorBoundary: r,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, d] of Object.entries(e.initialFacts))
          fe.has(p) || (i.facts[p] = d);
      if (n) {
        for (const [p, d] of Object.entries(n)) fe.has(p) || (i.facts[p] = d);
        n = null;
      }
    },
  });
  let u = new Proxy(
      {},
      {
        get(p, d) {
          if (typeof d != "symbol" && !fe.has(d))
            return ($) => {
              i.dispatch({ type: d, ...$ });
            };
        },
      },
    ),
    f = null,
    v = e.tickMs;
  return {
    _mode: "single",
    facts: i.facts,
    debug: i.debug,
    derive: i.derive,
    events: u,
    constraints: i.constraints,
    effects: i.effects,
    get runHistory() {
      return i.runHistory;
    },
    get isRunning() {
      return i.isRunning;
    },
    get isSettled() {
      return i.isSettled;
    },
    get isInitialized() {
      return i.isInitialized;
    },
    get isReady() {
      return i.isReady;
    },
    whenReady: i.whenReady.bind(i),
    async hydrate(p) {
      if (i.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const d = await p();
      d && typeof d == "object" && (n = d);
    },
    initialize() {
      i.initialize();
    },
    start() {
      i.start(),
        v &&
          v > 0 &&
          t.events &&
          "tick" in t.events &&
          (f = setInterval(() => {
            i.dispatch({ type: "tick" });
          }, v));
    },
    stop() {
      f && (clearInterval(f), (f = null)), i.stop();
    },
    destroy() {
      this.stop(), i.destroy();
    },
    dispatch(p) {
      i.dispatch(p);
    },
    batch: i.batch.bind(i),
    read(p) {
      return i.read(p);
    },
    subscribe(p, d) {
      return i.subscribe(p, d);
    },
    watch(p, d, $) {
      return i.watch(p, d, $);
    },
    when(p, d) {
      return i.when(p, d);
    },
    onSettledChange: i.onSettledChange.bind(i),
    onTimeTravelChange: i.onTimeTravelChange.bind(i),
    inspect: i.inspect.bind(i),
    settle: i.settle.bind(i),
    explain: i.explain.bind(i),
    getSnapshot: i.getSnapshot.bind(i),
    restore: i.restore.bind(i),
    getDistributableSnapshot: i.getDistributableSnapshot.bind(i),
    watchDistributableSnapshot: i.watchDistributableSnapshot.bind(i),
    registerModule(p) {
      i.registerModule({
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
var vt = class {
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
function Ge() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function yt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (s, r) =>
        typeof r == "bigint"
          ? String(r) + "n"
          : typeof r == "symbol"
            ? String(r)
            : r,
      );
      return t.length > 120 ? t.slice(0, 117) + "..." : t;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function Re(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function Te(e) {
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
function Jt(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Ge() &&
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
var Xt = 200,
  Be = 340,
  Ae = 16,
  Oe = 80,
  st = 2,
  lt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Qt() {
  return { entries: new vt(Xt), inflight: new Map() };
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
var er = 1e4,
  tr = 100;
function rr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var nr = 50,
  at = 200,
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
  le = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function ir(e, t, s, r) {
  let n = !1,
    i = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    u = document.createElement("style");
  (u.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${_.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${_.accent};outline-offset:2px}`),
    document.head.appendChild(u);
  const f = document.createElement("button");
  f.setAttribute("aria-label", "Open Directive DevTools"),
    f.setAttribute("aria-expanded", String(s)),
    (f.title = "Ctrl+Shift+D to toggle"),
    Object.assign(f.style, {
      ...i,
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
      display: s ? "none" : "block",
    }),
    (f.textContent = "Directive");
  const v = document.createElement("div");
  v.setAttribute("role", "region"),
    v.setAttribute("aria-label", "Directive DevTools"),
    v.setAttribute("data-directive-devtools", ""),
    (v.tabIndex = -1),
    Object.assign(v.style, {
      ...i,
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
      display: s ? "block" : "none",
    });
  const p = document.createElement("div");
  Object.assign(p.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const d = document.createElement("strong");
  (d.style.color = _.accent),
    (d.textContent =
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
    p.appendChild(d),
    p.appendChild($),
    v.appendChild(p);
  const B = document.createElement("div");
  (B.style.marginBottom = "6px"), B.setAttribute("aria-live", "polite");
  const T = document.createElement("span");
  (T.style.color = _.green),
    (T.textContent = "Settled"),
    B.appendChild(T),
    v.appendChild(B);
  const I = document.createElement("div");
  Object.assign(I.style, {
    display: "none",
    marginBottom: "8px",
    padding: "4px 8px",
    background: "#252545",
    borderRadius: "4px",
    alignItems: "center",
    gap: "6px",
  });
  const q = document.createElement("button");
  Object.assign(q.style, {
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
    (q.textContent = "◀ Undo"),
    (q.disabled = !0);
  const k = document.createElement("button");
  Object.assign(k.style, {
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
    (k.textContent = "Redo ▶"),
    (k.disabled = !0);
  const M = document.createElement("span");
  (M.style.color = _.muted),
    (M.style.fontSize = "10px"),
    I.appendChild(q),
    I.appendChild(k),
    I.appendChild(M),
    v.appendChild(I);
  function V(J, te) {
    const ne = document.createElement("details");
    te && (ne.open = !0), (ne.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: _.accent,
      marginBottom: "4px",
    });
    const Ce = document.createElement("span");
    (oe.textContent = `${J} (`),
      oe.appendChild(Ce),
      oe.appendChild(document.createTextNode(")")),
      (Ce.textContent = "0"),
      ne.appendChild(oe);
    const l = document.createElement("table");
    Object.assign(l.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const g = document.createElement("thead"),
      j = document.createElement("tr");
    for (const X of ["Key", "Value"]) {
      const Y = document.createElement("th");
      (Y.scope = "col"),
        Object.assign(Y.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: _.accent,
        }),
        (Y.textContent = X),
        j.appendChild(Y);
    }
    g.appendChild(j), l.appendChild(g);
    const K = document.createElement("tbody");
    return (
      l.appendChild(K),
      ne.appendChild(l),
      { details: ne, tbody: K, countSpan: Ce }
    );
  }
  function L(J, te) {
    const ne = document.createElement("details");
    ne.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: te,
      marginBottom: "4px",
    });
    const Ce = document.createElement("span");
    (oe.textContent = `${J} (`),
      oe.appendChild(Ce),
      oe.appendChild(document.createTextNode(")")),
      (Ce.textContent = "0"),
      ne.appendChild(oe);
    const l = document.createElement("ul");
    return (
      Object.assign(l.style, { margin: "0", paddingLeft: "16px" }),
      ne.appendChild(l),
      { details: ne, list: l, countSpan: Ce }
    );
  }
  const c = V("Facts", !0);
  v.appendChild(c.details);
  const E = V("Derivations", !1);
  v.appendChild(E.details);
  const y = L("Inflight", _.yellow);
  v.appendChild(y.details);
  const C = L("Unmet", _.red);
  v.appendChild(C.details);
  const A = document.createElement("details");
  A.style.marginBottom = "4px";
  const z = document.createElement("summary");
  Object.assign(z.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (z.textContent = "Performance"),
    A.appendChild(z);
  const h = document.createElement("div");
  (h.style.fontSize = "10px"),
    (h.style.color = _.muted),
    (h.textContent = "No data yet"),
    A.appendChild(h),
    v.appendChild(A);
  const w = document.createElement("details");
  w.style.marginBottom = "4px";
  const O = document.createElement("summary");
  Object.assign(O.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (O.textContent = "Dependency Graph"),
    w.appendChild(O);
  const D = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  D.setAttribute("width", "100%"),
    D.setAttribute("height", "120"),
    D.setAttribute("role", "img"),
    D.setAttribute("aria-label", "System dependency graph"),
    (D.style.display = "block"),
    D.setAttribute("viewBox", "0 0 460 120"),
    D.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(D),
    v.appendChild(w);
  const P = document.createElement("details");
  P.style.marginBottom = "4px";
  const H = document.createElement("summary");
  Object.assign(H.style, {
    cursor: "pointer",
    color: _.accent,
    marginBottom: "4px",
  }),
    (H.textContent = "Timeline"),
    P.appendChild(H);
  const N = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  N.setAttribute("width", "100%"),
    N.setAttribute("height", "60"),
    N.setAttribute("role", "img"),
    N.setAttribute("aria-label", "Resolver execution timeline"),
    (N.style.display = "block"),
    N.setAttribute("viewBox", `0 0 ${Be} 60`),
    N.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const b = document.createElementNS("http://www.w3.org/2000/svg", "text");
  b.setAttribute("x", String(Be / 2)),
    b.setAttribute("y", "30"),
    b.setAttribute("text-anchor", "middle"),
    b.setAttribute("fill", _.muted),
    b.setAttribute("font-size", "10"),
    b.setAttribute("font-family", _.font),
    (b.textContent = "No resolver activity yet"),
    N.appendChild(b),
    P.appendChild(N),
    v.appendChild(P);
  let R, a, o, m;
  if (r) {
    const J = document.createElement("details");
    J.style.marginBottom = "4px";
    const te = document.createElement("summary");
    Object.assign(te.style, {
      cursor: "pointer",
      color: _.accent,
      marginBottom: "4px",
    }),
      (o = document.createElement("span")),
      (o.textContent = "0"),
      (te.textContent = "Events ("),
      te.appendChild(o),
      te.appendChild(document.createTextNode(")")),
      J.appendChild(te),
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
    (ne.style.color = _.muted),
      (ne.style.padding = "4px"),
      (ne.textContent = "Waiting for events..."),
      (ne.className = "dt-events-empty"),
      a.appendChild(ne),
      J.appendChild(a),
      v.appendChild(J),
      (R = J),
      (m = document.createElement("div"));
  } else
    (R = document.createElement("details")),
      (a = document.createElement("div")),
      (o = document.createElement("span")),
      (m = document.createElement("div")),
      (m.style.fontSize = "10px"),
      (m.style.color = _.muted),
      (m.style.marginTop = "4px"),
      (m.style.fontStyle = "italic"),
      (m.textContent = "Enable trace: true for event log"),
      v.appendChild(m);
  const S = document.createElement("div");
  Object.assign(S.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const x = document.createElement("button");
  Object.assign(x.style, {
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
    (x.textContent = "⏺ Record");
  const U = document.createElement("button");
  Object.assign(U.style, {
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
    (U.textContent = "⤓ Export"),
    S.appendChild(x),
    S.appendChild(U),
    v.appendChild(S),
    v.addEventListener(
      "wheel",
      (J) => {
        const te = v,
          ne = te.scrollTop === 0 && J.deltaY < 0,
          oe =
            te.scrollTop + te.clientHeight >= te.scrollHeight && J.deltaY > 0;
        (ne || oe) && J.preventDefault();
      },
      { passive: !1 },
    );
  let Q = s,
    ee = new Set();
  function W() {
    (Q = !0),
      (v.style.display = "block"),
      (f.style.display = "none"),
      f.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function re() {
    (Q = !1),
      (v.style.display = "none"),
      (f.style.display = "block"),
      f.setAttribute("aria-expanded", "false"),
      f.focus();
  }
  f.addEventListener("click", W), $.addEventListener("click", re);
  function se(J) {
    J.key === "Escape" && Q && re();
  }
  v.addEventListener("keydown", se);
  function me(J) {
    J.key === "d" &&
      J.shiftKey &&
      (J.ctrlKey || J.metaKey) &&
      (J.preventDefault(), Q ? re() : W());
  }
  document.addEventListener("keydown", me);
  function F() {
    n || (document.body.appendChild(f), document.body.appendChild(v));
  }
  document.body
    ? F()
    : document.addEventListener("DOMContentLoaded", F, { once: !0 });
  function ce() {
    (n = !0),
      f.removeEventListener("click", W),
      $.removeEventListener("click", re),
      v.removeEventListener("keydown", se),
      document.removeEventListener("keydown", me),
      document.removeEventListener("DOMContentLoaded", F);
    for (const J of ee) clearTimeout(J);
    ee.clear(), f.remove(), v.remove(), u.remove();
  }
  return {
    refs: {
      container: v,
      toggleBtn: f,
      titleEl: d,
      statusEl: T,
      factsBody: c.tbody,
      factsCount: c.countSpan,
      derivBody: E.tbody,
      derivCount: E.countSpan,
      derivSection: E.details,
      inflightList: y.list,
      inflightSection: y.details,
      inflightCount: y.countSpan,
      unmetList: C.list,
      unmetSection: C.details,
      unmetCount: C.countSpan,
      perfSection: A,
      perfBody: h,
      timeTravelSection: I,
      timeTravelLabel: M,
      undoBtn: q,
      redoBtn: k,
      flowSection: w,
      flowSvg: D,
      timelineSection: P,
      timelineSvg: N,
      eventsSection: R,
      eventsList: a,
      eventsCount: o,
      traceHint: m,
      recordBtn: x,
      exportBtn: U,
    },
    destroy: ce,
    isOpen: () => Q,
    flashTimers: ee,
  };
}
function Ie(e, t, s, r, n, i) {
  let u = yt(r),
    f = e.get(s);
  if (f) {
    const v = f.cells;
    if (v[1] && ((v[1].textContent = u), n && i)) {
      const p = v[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const d = setTimeout(() => {
        (p.style.background = ""), i.delete(d);
      }, 300);
      i.add(d);
    }
  } else {
    (f = document.createElement("tr")),
      (f.style.borderBottom = `1px solid ${_.rowBorder}`);
    const v = document.createElement("td");
    Object.assign(v.style, { padding: "2px 4px", color: _.muted }),
      (v.textContent = s);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = u),
      f.appendChild(v),
      f.appendChild(p),
      t.appendChild(f),
      e.set(s, f);
  }
}
function or(e, t) {
  const s = e.get(t);
  s && (s.remove(), e.delete(t));
}
function Ne(e, t, s) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(t.length)),
    t.length > 0)
  )
    for (const r of t) {
      const n = document.createElement("li");
      (n.style.fontSize = "11px"),
        (n.textContent = `${r.resolverId} (${r.id})`),
        e.inflightList.appendChild(n);
    }
  else {
    const r = document.createElement("li");
    (r.style.fontSize = "10px"),
      (r.style.color = _.muted),
      (r.textContent = "None"),
      e.inflightList.appendChild(r);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(s.length)),
    s.length > 0)
  )
    for (const r of s) {
      const n = document.createElement("li");
      (n.style.fontSize = "11px"),
        (n.textContent = `${r.requirement.type} from ${r.fromConstraint}`),
        e.unmetList.appendChild(n);
    }
  else {
    const r = document.createElement("li");
    (r.style.fontSize = "10px"),
      (r.style.color = _.muted),
      (r.textContent = "None"),
      e.unmetList.appendChild(r);
  }
}
function Fe(e, t, s) {
  const r = t === 0 && s === 0;
  (e.statusEl.style.color = r ? _.green : _.yellow),
    (e.statusEl.textContent = r ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = r ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${r ? "" : " (system working)"}`,
    );
}
function ct(e, t, s, r) {
  const n = Object.keys(s.derive);
  if (((e.derivCount.textContent = String(n.length)), n.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const u = document.createElement("tr"),
      f = document.createElement("td");
    (f.colSpan = 2),
      (f.style.color = _.muted),
      (f.style.fontSize = "10px"),
      (f.textContent = "No derivations defined"),
      u.appendChild(f),
      e.derivBody.appendChild(u);
    return;
  }
  const i = new Set(n);
  for (const [u, f] of t) i.has(u) || (f.remove(), t.delete(u));
  for (const u of n) {
    let f;
    try {
      f = yt(s.read(u));
    } catch {
      f = "<error>";
    }
    Ie(t, e.derivBody, u, f, !0, r);
  }
}
function sr(e, t, s, r) {
  const n = e.eventsList.querySelector(".dt-events-empty");
  n && n.remove();
  const i = document.createElement("div");
  Object.assign(i.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${_.rowBorder}`,
    fontFamily: "inherit",
  });
  let u = new Date(),
    f = `${String(u.getHours()).padStart(2, "0")}:${String(u.getMinutes()).padStart(2, "0")}:${String(u.getSeconds()).padStart(2, "0")}.${String(u.getMilliseconds()).padStart(3, "0")}`,
    v;
  try {
    const B = JSON.stringify(s);
    v = Re(B, 60);
  } catch {
    v = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = _.closeBtn), (p.textContent = f);
  const d = document.createElement("span");
  (d.style.color = _.accent), (d.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = _.muted,
      $.textContent = v,
      i.appendChild(p),
      i.appendChild(d),
      i.appendChild($),
      e.eventsList.prepend(i);
    e.eventsList.childElementCount > nr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(r);
}
function lr(e, t) {
  e.perfBody.replaceChildren();
  const s =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    r = [
      `Reconciles: ${t.reconcileCount}  (avg ${s}ms)`,
      `Effects: ${t.effectRunCount} run, ${t.effectErrorCount} errors`,
    ];
  for (const n of r) {
    const i = document.createElement("div");
    (i.style.marginBottom = "2px"),
      (i.textContent = n),
      e.perfBody.appendChild(i);
  }
  if (t.resolverStats.size > 0) {
    const n = document.createElement("div");
    (n.style.marginTop = "4px"),
      (n.style.marginBottom = "2px"),
      (n.style.color = _.accent),
      (n.textContent = "Resolvers:"),
      e.perfBody.appendChild(n);
    const i = [...t.resolverStats.entries()].sort(
      (u, f) => f[1].totalMs - u[1].totalMs,
    );
    for (const [u, f] of i) {
      const v = f.count > 0 ? (f.totalMs / f.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${u}: ${f.count}x, avg ${v}ms${f.errors > 0 ? `, ${f.errors} err` : ""}`),
        f.errors > 0 && (p.style.color = _.red),
        e.perfBody.appendChild(p);
    }
  }
}
function ut(e, t) {
  const s = t.debug;
  if (!s) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const r = s.currentIndex,
    n = s.snapshots.length;
  e.timeTravelLabel.textContent = n > 0 ? `${r + 1} / ${n}` : "0 snapshots";
  const i = r > 0,
    u = r < n - 1;
  (e.undoBtn.disabled = !i),
    (e.undoBtn.style.opacity = i ? "1" : "0.4"),
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
var Pe = new WeakMap();
function cr(e, t, s, r, n, i) {
  return [
    e.join(","),
    t.join(","),
    s.map((u) => `${u.id}:${u.active}`).join(","),
    [...r.entries()].map(([u, f]) => `${u}:${f.status}:${f.type}`).join(","),
    n.join(","),
    i.join(","),
  ].join("|");
}
function ur(e, t, s, r, n) {
  for (const i of s) {
    const u = e.nodes.get(`0:${i}`);
    if (!u) continue;
    const f = t.recentlyChangedFacts.has(i);
    u.rect.setAttribute("fill", f ? _.text + "33" : "none"),
      u.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
  for (const i of r) {
    const u = e.nodes.get(`1:${i}`);
    if (!u) continue;
    const f = t.recentlyComputedDerivations.has(i);
    u.rect.setAttribute("fill", f ? _.accent + "33" : "none"),
      u.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
  for (const i of n) {
    const u = e.nodes.get(`2:${i}`);
    if (!u) continue;
    const f = t.recentlyActiveConstraints.has(i),
      v = u.rect.getAttribute("stroke") ?? _.muted;
    u.rect.setAttribute("fill", f ? v + "33" : "none"),
      u.rect.setAttribute("stroke-width", f ? "2" : "1");
  }
}
function dt(e, t, s) {
  const r = Te(t);
  if (!r) return;
  let n;
  try {
    n = Object.keys(t.facts.$store.toObject());
  } catch {
    n = [];
  }
  const i = Object.keys(t.derive),
    u = r.constraints,
    f = r.unmet,
    v = r.inflight,
    p = Object.keys(r.resolvers),
    d = new Map();
  for (const b of f)
    d.set(b.id, {
      type: b.requirement.type,
      fromConstraint: b.fromConstraint,
      status: "unmet",
    });
  for (const b of v)
    d.set(b.id, { type: b.resolverId, fromConstraint: "", status: "inflight" });
  if (n.length === 0 && i.length === 0 && u.length === 0 && p.length === 0) {
    Pe.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const b = document.createElementNS("http://www.w3.org/2000/svg", "text");
    b.setAttribute("x", "230"),
      b.setAttribute("y", "24"),
      b.setAttribute("text-anchor", "middle"),
      b.setAttribute("fill", _.muted),
      b.setAttribute("font-size", "10"),
      b.setAttribute("font-family", _.font),
      (b.textContent = "No system topology"),
      e.flowSvg.appendChild(b);
    return;
  }
  const $ = v.map((b) => b.resolverId).sort(),
    B = cr(n, i, u, d, p, $),
    T = Pe.get(e.flowSvg);
  if (T && T.fingerprint === B) {
    ur(
      T,
      s,
      n,
      i,
      u.map((b) => b.id),
    );
    return;
  }
  const I = le.nodeW + le.colGap,
    q = [5, 5 + I, 5 + I * 2, 5 + I * 3, 5 + I * 4],
    k = q[4] + le.nodeW + 5;
  function M(b) {
    let R = le.startY + 12;
    return b.map((a) => {
      const o = { ...a, y: R };
      return (R += le.nodeH + le.nodeGap), o;
    });
  }
  const V = M(n.map((b) => ({ id: b, label: Re(b, le.labelMaxChars) }))),
    L = M(i.map((b) => ({ id: b, label: Re(b, le.labelMaxChars) }))),
    c = M(
      u.map((b) => ({
        id: b.id,
        label: Re(b.id, le.labelMaxChars),
        active: b.active,
        priority: b.priority,
      })),
    ),
    E = M(
      [...d.entries()].map(([b, R]) => ({
        id: b,
        type: R.type,
        fromConstraint: R.fromConstraint,
        status: R.status,
      })),
    ),
    y = M(p.map((b) => ({ id: b, label: Re(b, le.labelMaxChars) }))),
    C = Math.max(V.length, L.length, c.length, E.length, y.length, 1),
    A = le.startY + 12 + C * (le.nodeH + le.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${A}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${n.length} facts, ${i.length} derivations, ${u.length} constraints, ${d.size} requirements, ${p.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [b, R] of z.entries()) {
    const a = document.createElementNS("http://www.w3.org/2000/svg", "text");
    a.setAttribute("x", String(q[b] ?? 0)),
      a.setAttribute("y", "10"),
      a.setAttribute("fill", _.accent),
      a.setAttribute("font-size", String(le.fontSize)),
      a.setAttribute("font-family", _.font),
      (a.textContent = R),
      e.flowSvg.appendChild(a);
  }
  const h = { fingerprint: B, nodes: new Map() };
  function w(b, R, a, o, m, S, x, U) {
    const Q = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      ee = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ee.setAttribute("x", String(R)),
      ee.setAttribute("y", String(a - 6)),
      ee.setAttribute("width", String(le.nodeW)),
      ee.setAttribute("height", String(le.nodeH)),
      ee.setAttribute("rx", "3"),
      ee.setAttribute("fill", U ? S + "33" : "none"),
      ee.setAttribute("stroke", S),
      ee.setAttribute("stroke-width", U ? "2" : "1"),
      ee.setAttribute("opacity", x ? "0.35" : "1"),
      Q.appendChild(ee);
    const W = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      W.setAttribute("x", String(R + 4)),
      W.setAttribute("y", String(a + 4)),
      W.setAttribute("fill", S),
      W.setAttribute("font-size", String(le.fontSize)),
      W.setAttribute("font-family", _.font),
      W.setAttribute("opacity", x ? "0.35" : "1"),
      (W.textContent = m),
      Q.appendChild(W),
      e.flowSvg.appendChild(Q),
      h.nodes.set(`${b}:${o}`, { g: Q, rect: ee, text: W }),
      { midX: R + le.nodeW / 2, midY: a }
    );
  }
  function O(b, R, a, o, m, S) {
    const x = document.createElementNS("http://www.w3.org/2000/svg", "line");
    x.setAttribute("x1", String(b)),
      x.setAttribute("y1", String(R)),
      x.setAttribute("x2", String(a)),
      x.setAttribute("y2", String(o)),
      x.setAttribute("stroke", m),
      x.setAttribute("stroke-width", "1"),
      x.setAttribute("stroke-dasharray", "3,2"),
      x.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(x);
  }
  const D = new Map(),
    P = new Map(),
    H = new Map(),
    N = new Map();
  for (const b of V) {
    const R = s.recentlyChangedFacts.has(b.id),
      a = w(0, q[0], b.y, b.id, b.label, _.text, !1, R);
    D.set(b.id, a);
  }
  for (const b of L) {
    const R = s.recentlyComputedDerivations.has(b.id),
      a = w(1, q[1], b.y, b.id, b.label, _.accent, !1, R);
    P.set(b.id, a);
  }
  for (const b of c) {
    const R = s.recentlyActiveConstraints.has(b.id),
      a = w(
        2,
        q[2],
        b.y,
        b.id,
        b.label,
        b.active ? _.yellow : _.muted,
        !b.active,
        R,
      );
    H.set(b.id, a);
  }
  for (const b of E) {
    const R = b.status === "unmet" ? _.red : _.yellow,
      a = w(3, q[3], b.y, b.id, Re(b.type, le.labelMaxChars), R, !1, !1);
    N.set(b.id, a);
  }
  for (const b of y) {
    const R = v.some((a) => a.resolverId === b.id);
    w(4, q[4], b.y, b.id, b.label, R ? _.green : _.muted, !R, !1);
  }
  for (const b of L) {
    const R = s.derivationDeps.get(b.id),
      a = P.get(b.id);
    if (R && a)
      for (const o of R) {
        const m = D.get(o);
        m &&
          O(
            m.midX + le.nodeW / 2,
            m.midY,
            a.midX - le.nodeW / 2,
            a.midY,
            _.accent,
          );
      }
  }
  for (const b of E) {
    const R = H.get(b.fromConstraint),
      a = N.get(b.id);
    R &&
      a &&
      O(R.midX + le.nodeW / 2, R.midY, a.midX - le.nodeW / 2, a.midY, _.muted);
  }
  for (const b of v) {
    const R = N.get(b.id);
    if (R) {
      const a = y.find((o) => o.id === b.resolverId);
      a && O(R.midX + le.nodeW / 2, R.midY, q[4], a.y, _.green);
    }
  }
  Pe.set(e.flowSvg, h);
}
function dr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function fr(e, t) {
  const s = t.entries.toArray();
  if (s.length === 0) return;
  e.timelineSvg.replaceChildren();
  let r = 1 / 0,
    n = -1 / 0;
  for (const T of s)
    T.startMs < r && (r = T.startMs), T.endMs > n && (n = T.endMs);
  const i = performance.now();
  for (const T of t.inflight.values()) T < r && (r = T), i > n && (n = i);
  const u = n - r || 1,
    f = Be - Oe - 10,
    v = [],
    p = new Set();
  for (const T of s)
    p.has(T.resolver) || (p.add(T.resolver), v.push(T.resolver));
  for (const T of t.inflight.keys()) p.has(T) || (p.add(T), v.push(T));
  const d = v.slice(-12),
    $ = Ae * d.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Be} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const B = 5;
  for (let T = 0; T <= B; T++) {
    const I = Oe + (f * T) / B,
      q = (u * T) / B,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(I)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", _.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", _.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        q < 1e3 ? `${q.toFixed(0)}ms` : `${(q / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const M = document.createElementNS("http://www.w3.org/2000/svg", "line");
    M.setAttribute("x1", String(I)),
      M.setAttribute("y1", "10"),
      M.setAttribute("x2", String(I)),
      M.setAttribute("y2", String($)),
      M.setAttribute("stroke", _.border),
      M.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(M);
  }
  for (let T = 0; T < d.length; T++) {
    const I = d[T],
      q = 12 + T * Ae,
      k = T % lt.length,
      M = lt[k],
      V = document.createElementNS("http://www.w3.org/2000/svg", "text");
    V.setAttribute("x", String(Oe - 4)),
      V.setAttribute("y", String(q + Ae / 2 + 3)),
      V.setAttribute("fill", _.muted),
      V.setAttribute("font-size", "7"),
      V.setAttribute("font-family", _.font),
      V.setAttribute("text-anchor", "end"),
      (V.textContent = Re(I, 12)),
      e.timelineSvg.appendChild(V);
    const L = s.filter((E) => E.resolver === I);
    for (const E of L) {
      const y = Oe + ((E.startMs - r) / u) * f,
        C = Math.max(((E.endMs - E.startMs) / u) * f, st),
        A = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      A.setAttribute("x", String(y)),
        A.setAttribute("y", String(q + 2)),
        A.setAttribute("width", String(C)),
        A.setAttribute("height", String(Ae - 4)),
        A.setAttribute("rx", "2"),
        A.setAttribute("fill", E.error ? _.red : M),
        A.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        h = E.endMs - E.startMs;
      (z.textContent = `${I}: ${h.toFixed(1)}ms${E.error ? " (error)" : ""}`),
        A.appendChild(z),
        e.timelineSvg.appendChild(A);
    }
    const c = t.inflight.get(I);
    if (c !== void 0) {
      const E = Oe + ((c - r) / u) * f,
        y = Math.max(((i - c) / u) * f, st),
        C = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      C.setAttribute("x", String(E)),
        C.setAttribute("y", String(q + 2)),
        C.setAttribute("width", String(y)),
        C.setAttribute("height", String(Ae - 4)),
        C.setAttribute("rx", "2"),
        C.setAttribute("fill", M),
        C.setAttribute("opacity", "0.4"),
        C.setAttribute("stroke", M),
        C.setAttribute("stroke-width", "1"),
        C.setAttribute("stroke-dasharray", "3,2");
      const A = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (A.textContent = `${I}: inflight ${(i - c).toFixed(0)}ms`),
        C.appendChild(A),
        e.timelineSvg.appendChild(C);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${s.length} resolver executions across ${d.length} resolvers`,
  );
}
function mr() {
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
        getSystem(s) {
          return s
            ? (e.get(s)?.system ?? null)
            : (e.values().next().value?.system ?? null);
        },
        getSystems() {
          return [...e.keys()];
        },
        inspect(s) {
          const r = this.getSystem(s),
            n = s ? e.get(s) : e.values().next().value,
            i = r?.inspect() ?? null;
          return (
            i &&
              n &&
              (i.resolverStats = n.resolverStats
                ? Object.fromEntries(n.resolverStats)
                : {}),
            i
          );
        },
        getEvents(s) {
          return s
            ? (e.get(s)?.events.toArray() ?? [])
            : (e.values().next().value?.events.toArray() ?? []);
        },
        explain(s, r) {
          return this.getSystem(r)?.explain(s) ?? null;
        },
        subscribe(s, r) {
          const n = r ? e.get(r) : e.values().next().value;
          if (!n) {
            let i = !1,
              u = setInterval(() => {
                const v = r ? e.get(r) : e.values().next().value;
                v && !i && ((i = !0), v.subscribers.add(s));
              }, 100),
              f = setTimeout(() => clearInterval(u), 1e4);
            return () => {
              clearInterval(u), clearTimeout(f);
              for (const v of e.values()) v.subscribers.delete(s);
            };
          }
          return (
            n.subscribers.add(s),
            () => {
              n.subscribers.delete(s);
            }
          );
        },
        exportSession(s) {
          const r = s ? e.get(s) : e.values().next().value;
          return r
            ? JSON.stringify({
                version: 1,
                name: s ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: r.events.toArray(),
              })
            : null;
        },
        importSession(s, r) {
          try {
            if (s.length > 10 * 1024 * 1024) return !1;
            const n = JSON.parse(s);
            if (
              !n ||
              typeof n != "object" ||
              Array.isArray(n) ||
              !Array.isArray(n.events)
            )
              return !1;
            const i = r ? e.get(r) : e.values().next().value;
            if (!i) return !1;
            const u = i.maxEvents,
              f = n.events,
              v = f.length > u ? f.length - u : 0;
            i.events.clear();
            for (let p = v; p < f.length; p++) {
              const d = f[p];
              d &&
                typeof d == "object" &&
                !Array.isArray(d) &&
                typeof d.timestamp == "number" &&
                typeof d.type == "string" &&
                d.type !== "__proto__" &&
                d.type !== "constructor" &&
                d.type !== "prototype" &&
                i.events.push({
                  timestamp: d.timestamp,
                  type: d.type,
                  data: d.data ?? null,
                });
            }
            return !0;
          } catch {
            return !1;
          }
        },
        clearEvents(s) {
          const r = s ? e.get(s) : e.values().next().value;
          r && r.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Ge(),
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
      trace: s = !1,
      maxEvents: r,
      panel: n = !1,
      position: i = "bottom-right",
      defaultOpen: u = !1,
    } = e,
    f = Jt(r),
    v = mr(),
    p = {
      system: null,
      events: new vt(f),
      maxEvents: f,
      subscribers: new Set(),
      resolverStats: new Map(),
    };
  v.systems.set(t, p);
  let d = (o, m) => {
      const S = { timestamp: Date.now(), type: o, data: m };
      s && p.events.push(S);
      for (const x of p.subscribers)
        try {
          x(S);
        } catch {}
    },
    $ = null,
    B = new Map(),
    T = new Map(),
    I = Yt(),
    q = Zt(),
    k = rr(),
    M = Qt(),
    V = n && typeof window < "u" && typeof document < "u" && Ge(),
    L = null,
    c = 0,
    E = 1,
    y = 2,
    C = 4,
    A = 8,
    z = 16,
    h = 32,
    w = 64,
    O = 128,
    D = new Map(),
    P = new Set(),
    H = null;
  function N(o) {
    (c |= o),
      L === null &&
        typeof requestAnimationFrame < "u" &&
        (L = requestAnimationFrame(b));
  }
  function b() {
    if (((L = null), !$ || !p.system)) {
      c = 0;
      return;
    }
    const o = $.refs,
      m = p.system,
      S = c;
    if (((c = 0), S & E)) {
      for (const x of P) or(B, x);
      P.clear();
      for (const [x, { value: U, flash: Q }] of D)
        Ie(B, o.factsBody, x, U, Q, $.flashTimers);
      D.clear(), (o.factsCount.textContent = String(B.size));
    }
    if ((S & y && ct(o, T, m, $.flashTimers), S & A))
      if (H) Fe(o, H.inflight.length, H.unmet.length);
      else {
        const x = Te(m);
        x && Fe(o, x.inflight.length, x.unmet.length);
      }
    if (S & C)
      if (H) Ne(o, H.inflight, H.unmet);
      else {
        const x = Te(m);
        x && Ne(o, x.inflight, x.unmet);
      }
    S & z && lr(o, I),
      S & h && dt(o, m, q),
      S & w && ut(o, m),
      S & O && fr(o, M);
  }
  function R(o, m) {
    $ && s && sr($.refs, o, m, p.events.size);
  }
  function a(o, m) {
    k.isRecording &&
      k.recordedEvents.length < er &&
      k.recordedEvents.push({ timestamp: Date.now(), type: o, data: Gt(m) });
  }
  return {
    name: "devtools",
    onInit: (o) => {
      if (
        ((p.system = o),
        d("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        V)
      ) {
        const m = p.system;
        $ = ir(t, i, u, s);
        const S = $.refs;
        try {
          const U = m.facts.$store.toObject();
          for (const [Q, ee] of Object.entries(U))
            Ie(B, S.factsBody, Q, ee, !1);
          S.factsCount.textContent = String(Object.keys(U).length);
        } catch {}
        ct(S, T, m);
        const x = Te(m);
        x &&
          (Fe(S, x.inflight.length, x.unmet.length),
          Ne(S, x.inflight, x.unmet)),
          ut(S, m),
          ar(S, m),
          dt(S, m, q),
          S.recordBtn.addEventListener("click", () => {
            if (
              ((k.isRecording = !k.isRecording),
              (S.recordBtn.textContent = k.isRecording ? "⏹ Stop" : "⏺ Record"),
              (S.recordBtn.style.color = k.isRecording ? _.red : _.text),
              k.isRecording)
            ) {
              (k.recordedEvents = []), (k.snapshots = []);
              try {
                k.snapshots.push({
                  timestamp: Date.now(),
                  facts: m.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          S.exportBtn.addEventListener("click", () => {
            const U =
                k.recordedEvents.length > 0
                  ? k.recordedEvents
                  : p.events.toArray(),
              Q = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: U,
                  snapshots: k.snapshots,
                },
                null,
                2,
              ),
              ee = new Blob([Q], { type: "application/json" }),
              W = URL.createObjectURL(ee),
              re = document.createElement("a");
            (re.href = W),
              (re.download = `directive-session-${t}-${Date.now()}.json`),
              re.click(),
              URL.revokeObjectURL(W);
          });
      }
    },
    onStart: (o) => {
      d("start", {}), R("start", {}), a("start", {});
    },
    onStop: (o) => {
      d("stop", {}), R("stop", {}), a("stop", {});
    },
    onDestroy: (o) => {
      d("destroy", {}),
        v.systems.delete(t),
        L !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(L), (L = null)),
        q.animationTimer && clearTimeout(q.animationTimer),
        $ && ($.destroy(), ($ = null), B.clear(), T.clear());
    },
    onFactSet: (o, m, S) => {
      d("fact.set", { key: o, value: m, prev: S }),
        a("fact.set", { key: o, value: m, prev: S }),
        q.recentlyChangedFacts.add(o),
        $ &&
          p.system &&
          (D.set(o, { value: m, flash: !0 }),
          P.delete(o),
          N(E),
          R("fact.set", { key: o, value: m }));
    },
    onFactDelete: (o, m) => {
      d("fact.delete", { key: o, prev: m }),
        a("fact.delete", { key: o, prev: m }),
        $ && (P.add(o), D.delete(o), N(E), R("fact.delete", { key: o }));
    },
    onFactsBatch: (o) => {
      if (
        (d("facts.batch", { changes: o }),
        a("facts.batch", { count: o.length }),
        $ && p.system)
      ) {
        for (const m of o)
          m.type === "delete"
            ? (P.add(m.key), D.delete(m.key))
            : (q.recentlyChangedFacts.add(m.key),
              D.set(m.key, { value: m.value, flash: !0 }),
              P.delete(m.key));
        N(E), R("facts.batch", { count: o.length });
      }
    },
    onDerivationCompute: (o, m, S) => {
      d("derivation.compute", { id: o, value: m, deps: S }),
        a("derivation.compute", { id: o, deps: S }),
        q.derivationDeps.set(o, S),
        q.recentlyComputedDerivations.add(o),
        R("derivation.compute", { id: o, deps: S });
    },
    onDerivationInvalidate: (o) => {
      d("derivation.invalidate", { id: o }),
        R("derivation.invalidate", { id: o });
    },
    onReconcileStart: (o) => {
      d("reconcile.start", {}),
        (I.lastReconcileStartMs = performance.now()),
        R("reconcile.start", {}),
        a("reconcile.start", {});
    },
    onReconcileEnd: (o) => {
      if (
        (d("reconcile.end", o),
        a("reconcile.end", {
          unmet: o.unmet.length,
          inflight: o.inflight.length,
          completed: o.completed.length,
        }),
        I.lastReconcileStartMs > 0)
      ) {
        const m = performance.now() - I.lastReconcileStartMs;
        I.reconcileCount++,
          (I.reconcileTotalMs += m),
          (I.lastReconcileStartMs = 0);
      }
      if (k.isRecording && p.system && k.snapshots.length < tr)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        p.system &&
        ((H = o),
        dr(q),
        N(y | A | C | z | h | w),
        R("reconcile.end", {
          unmet: o.unmet.length,
          inflight: o.inflight.length,
        }));
    },
    onConstraintEvaluate: (o, m) => {
      d("constraint.evaluate", { id: o, active: m }),
        a("constraint.evaluate", { id: o, active: m }),
        m
          ? (q.activeConstraints.add(o), q.recentlyActiveConstraints.add(o))
          : q.activeConstraints.delete(o),
        R("constraint.evaluate", { id: o, active: m });
    },
    onConstraintError: (o, m) => {
      d("constraint.error", { id: o, error: String(m) }),
        R("constraint.error", { id: o, error: String(m) });
    },
    onRequirementCreated: (o) => {
      d("requirement.created", { id: o.id, type: o.requirement.type }),
        a("requirement.created", { id: o.id, type: o.requirement.type }),
        R("requirement.created", { id: o.id, type: o.requirement.type });
    },
    onRequirementMet: (o, m) => {
      d("requirement.met", { id: o.id, byResolver: m }),
        a("requirement.met", { id: o.id, byResolver: m }),
        R("requirement.met", { id: o.id, byResolver: m });
    },
    onRequirementCanceled: (o) => {
      d("requirement.canceled", { id: o.id }),
        a("requirement.canceled", { id: o.id }),
        R("requirement.canceled", { id: o.id });
    },
    onResolverStart: (o, m) => {
      d("resolver.start", { resolver: o, requirementId: m.id }),
        a("resolver.start", { resolver: o, requirementId: m.id }),
        M.inflight.set(o, performance.now()),
        $ &&
          p.system &&
          (N(C | A | O),
          R("resolver.start", { resolver: o, requirementId: m.id }));
    },
    onResolverComplete: (o, m, S) => {
      d("resolver.complete", { resolver: o, requirementId: m.id, duration: S }),
        a("resolver.complete", {
          resolver: o,
          requirementId: m.id,
          duration: S,
        });
      const x = p.resolverStats.get(o) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (x.count++,
        (x.totalMs += S),
        p.resolverStats.set(o, x),
        p.resolverStats.size > at)
      ) {
        const Q = p.resolverStats.keys().next().value;
        Q !== void 0 && p.resolverStats.delete(Q);
      }
      I.resolverStats.set(o, { ...x });
      const U = M.inflight.get(o);
      M.inflight.delete(o),
        U !== void 0 &&
          M.entries.push({
            resolver: o,
            startMs: U,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          p.system &&
          (N(C | A | z | O),
          R("resolver.complete", { resolver: o, duration: S }));
    },
    onResolverError: (o, m, S) => {
      d("resolver.error", {
        resolver: o,
        requirementId: m.id,
        error: String(S),
      }),
        a("resolver.error", {
          resolver: o,
          requirementId: m.id,
          error: String(S),
        });
      const x = p.resolverStats.get(o) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((x.errors++, p.resolverStats.set(o, x), p.resolverStats.size > at)) {
        const Q = p.resolverStats.keys().next().value;
        Q !== void 0 && p.resolverStats.delete(Q);
      }
      I.resolverStats.set(o, { ...x });
      const U = M.inflight.get(o);
      M.inflight.delete(o),
        U !== void 0 &&
          M.entries.push({
            resolver: o,
            startMs: U,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          p.system &&
          (N(C | A | z | O),
          R("resolver.error", { resolver: o, error: String(S) }));
    },
    onResolverRetry: (o, m, S) => {
      d("resolver.retry", { resolver: o, requirementId: m.id, attempt: S }),
        a("resolver.retry", { resolver: o, requirementId: m.id, attempt: S }),
        R("resolver.retry", { resolver: o, attempt: S });
    },
    onResolverCancel: (o, m) => {
      d("resolver.cancel", { resolver: o, requirementId: m.id }),
        a("resolver.cancel", { resolver: o, requirementId: m.id }),
        M.inflight.delete(o),
        R("resolver.cancel", { resolver: o });
    },
    onEffectRun: (o) => {
      d("effect.run", { id: o }),
        a("effect.run", { id: o }),
        I.effectRunCount++,
        R("effect.run", { id: o });
    },
    onEffectError: (o, m) => {
      d("effect.error", { id: o, error: String(m) }),
        I.effectErrorCount++,
        R("effect.error", { id: o, error: String(m) });
    },
    onSnapshot: (o) => {
      d("timetravel.snapshot", { id: o.id, trigger: o.trigger }),
        $ && p.system && N(w),
        R("timetravel.snapshot", { id: o.id, trigger: o.trigger });
    },
    onTimeTravel: (o, m) => {
      if (
        (d("timetravel.jump", { from: o, to: m }),
        a("timetravel.jump", { from: o, to: m }),
        $ && p.system)
      ) {
        const S = p.system;
        try {
          const x = S.facts.$store.toObject();
          B.clear(), $.refs.factsBody.replaceChildren();
          for (const [U, Q] of Object.entries(x))
            Ie(B, $.refs.factsBody, U, Q, !1);
          $.refs.factsCount.textContent = String(Object.keys(x).length);
        } catch {}
        T.clear(),
          q.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (H = null),
          N(y | A | C | h | w),
          R("timetravel.jump", { from: o, to: m });
      }
    },
    onError: (o) => {
      d("error", {
        source: o.source,
        sourceId: o.sourceId,
        message: o.message,
      }),
        a("error", { source: o.source, message: o.message }),
        R("error", { source: o.source, message: o.message });
    },
    onErrorRecovery: (o, m) => {
      d("error.recovery", {
        source: o.source,
        sourceId: o.sourceId,
        strategy: m,
      }),
        R("error.recovery", { source: o.source, strategy: m });
    },
    onRunComplete: (o) => {
      d("run.complete", {
        id: o.id,
        status: o.status,
        facts: o.factChanges.length,
        constraints: o.constraintsHit.length,
        requirements: o.requirementsAdded.length,
        resolvers: o.resolversStarted.length,
        effects: o.effectsRun.length,
      }),
        R("run.complete", { id: o.id });
    },
  };
}
function ft() {
  const e = [];
  let t = 0;
  for (let s = 0; s < 4; s++)
    for (let r = 1; r <= 9; r++) e.push({ id: `t${t++}`, value: r });
  for (let s = e.length - 1; s > 0; s--) {
    const r = Math.floor(Math.random() * (s + 1));
    [e[s], e[r]] = [e[r], e[s]];
  }
  return e;
}
const Le = [];
function pe(e) {
  console.log(`[NumberMatch] ${e}`);
  let t = "",
    s = "",
    r = "info";
  if (e.startsWith("EVENT selectTile")) {
    t = "tile selected";
    const n = e.match(/selectTile: (t\d+)/);
    (s = n ? n[1] : ""), (r = "selection");
  } else if (e.includes("pairAddsTen: TRUE")) {
    t = "match found";
    const n = e.match(/\((.+)\)/);
    (s = n ? n[1] : ""), (r = "match");
  } else if (e === "RESOLVER removeTiles: DONE")
    (t = "tiles removed"), (s = ""), (r = "match");
  else if (e.includes("refillTable: DONE")) {
    t = "refill";
    const n = e.match(/table now: (\d+)/);
    (s = n ? `table: ${n[1]} tiles` : ""), (r = "refill");
  } else if (e.startsWith("RESOLVER endGame:"))
    (t = "game over"),
      (s = e.replace("RESOLVER endGame: ", "")),
      (r = "gameover");
  else if (e.includes("New game") || e.includes("Game started"))
    (t = "new game"), (s = e), (r = "newgame");
  else return;
  Le.unshift({ time: Date.now(), event: t, detail: s, type: r });
}
const hr = {
    facts: {
      pool: ve.object(),
      table: ve.object(),
      removed: ve.object(),
      selected: ve.object(),
      message: ve.string(),
      moveCount: ve.number(),
      gameOver: ve.boolean(),
    },
    derivations: {
      poolCount: ve.number(),
      removedCount: ve.number(),
      selectedTiles: ve.object(),
      hasValidMoves: ve.boolean(),
    },
    events: {
      newGame: {},
      selectTile: { tileId: ve.string() },
      deselectTile: { tileId: ve.string() },
      clearSelection: {},
    },
    requirements: {
      REMOVE_TILES: { tileIds: ve.object() },
      REFILL_TABLE: { count: ve.number() },
      END_GAME: { reason: ve.string() },
    },
  },
  gr = kt("number-match", {
    schema: hr,
    init: (e) => {
      const t = ft();
      (e.pool = t.slice(9)),
        (e.table = t.slice(0, 9)),
        (e.removed = []),
        (e.selected = []),
        (e.message = "Select two numbers that add to 10"),
        (e.moveCount = 0),
        (e.gameOver = !1);
    },
    derive: {
      poolCount: (e) => e.pool.length,
      removedCount: (e) => e.removed.length,
      selectedTiles: (e) => e.table.filter((t) => e.selected.includes(t.id)),
      hasValidMoves: (e) => {
        const t = e.table.map((s) => s.value);
        for (let s = 0; s < t.length; s++)
          for (let r = s + 1; r < t.length; r++)
            if (t[s] + t[r] === 10) return !0;
        return !1;
      },
    },
    events: {
      newGame: (e) => {
        const t = ft();
        (e.pool = t.slice(9)),
          (e.table = t.slice(0, 9)),
          (e.removed = []),
          (e.selected = []),
          (e.message = "New game! Select two numbers that add to 10"),
          (e.moveCount = 0),
          (e.gameOver = !1);
      },
      selectTile: (e, { tileId: t }) => {
        !e.selected.includes(t) &&
          !e.gameOver &&
          ((e.selected = [...e.selected, t]),
          pe(`EVENT selectTile: ${t}, selected now: [${e.selected}]`));
      },
      deselectTile: (e, { tileId: t }) => {
        e.selected = e.selected.filter((s) => s !== t);
      },
      clearSelection: (e) => {
        e.selected = [];
      },
    },
    constraints: {
      pairAddsTen: {
        priority: 100,
        when: (e) => {
          if (e.gameOver) return !1;
          const t = e.table.filter((r) => e.selected.includes(r.id));
          if (t.length !== 2) return !1;
          const s = t[0].value + t[1].value === 10;
          return (
            s &&
              pe(
                `CONSTRAINT pairAddsTen: TRUE (${t[0].value} + ${t[1].value})`,
              ),
            s
          );
        },
        require: (e) => (
          pe("CONSTRAINT pairAddsTen: producing REMOVE_TILES"),
          { type: "REMOVE_TILES", tileIds: [...e.selected] }
        ),
      },
      refillTable: {
        priority: 50,
        when: (e) => {
          const t = !e.gameOver && e.table.length < 9 && e.pool.length > 0;
          return (
            t &&
              pe(
                `CONSTRAINT refillTable: TRUE (table: ${e.table.length}, pool: ${e.pool.length})`,
              ),
            t
          );
        },
        require: (e) => {
          const t = Math.min(9 - e.table.length, e.pool.length);
          return (
            pe(`CONSTRAINT refillTable: producing REFILL_TABLE count=${t}`),
            { type: "REFILL_TABLE", count: t }
          );
        },
      },
      noMovesLeft: {
        priority: 190,
        when: (e) => {
          if (e.gameOver || e.table.length === 0 || e.pool.length > 0)
            return !1;
          const t = e.table.map((s) => s.value);
          for (let s = 0; s < t.length; s++)
            for (let r = s + 1; r < t.length; r++)
              if (t[s] + t[r] === 10) return !1;
          return pe("CONSTRAINT noMovesLeft: TRUE"), !0;
        },
        require: (e) => ({
          type: "END_GAME",
          reason: `Game over! Removed ${e.removed.length} of 36 tiles.`,
        }),
      },
      allCleared: {
        priority: 200,
        when: (e) => {
          const t = !e.gameOver && e.table.length === 0 && e.pool.length === 0;
          return t && pe("CONSTRAINT allCleared: TRUE"), t;
        },
        require: (e) => ({
          type: "END_GAME",
          reason: `You win! Cleared all tiles in ${e.moveCount} moves!`,
        }),
      },
    },
    resolvers: {
      removeTiles: {
        requirement: "REMOVE_TILES",
        resolve: async (e, t) => {
          pe("RESOLVER removeTiles: START");
          const s = t.facts.table.filter((r) => e.tileIds.includes(r.id));
          pe("RESOLVER removeTiles: setting table"),
            (t.facts.table = t.facts.table.filter(
              (r) => !e.tileIds.includes(r.id),
            )),
            pe("RESOLVER removeTiles: setting removed"),
            (t.facts.removed = [...t.facts.removed, ...s]),
            pe("RESOLVER removeTiles: clearing selected"),
            (t.facts.selected = []),
            pe("RESOLVER removeTiles: incrementing moveCount"),
            t.facts.moveCount++,
            pe("RESOLVER removeTiles: setting message"),
            (t.facts.message = `Removed ${s[0].value} + ${s[1].value} = 10!`),
            pe("RESOLVER removeTiles: DONE");
        },
      },
      refillTable: {
        requirement: "REFILL_TABLE",
        resolve: async (e, t) => {
          pe(`RESOLVER refillTable: START (count: ${e.count})`);
          const s = t.facts.pool.slice(0, e.count);
          (t.facts.pool = t.facts.pool.slice(e.count)),
            (t.facts.table = [...t.facts.table, ...s]),
            pe(
              `RESOLVER refillTable: DONE (table now: ${t.facts.table.length})`,
            );
        },
      },
      endGame: {
        requirement: "END_GAME",
        resolve: async (e, t) => {
          pe(`RESOLVER endGame: ${e.reason}`),
            (t.facts.gameOver = !0),
            (t.facts.message = e.reason);
        },
      },
    },
  }),
  ye = Vt({
    module: gr,
    plugins: [pr({ name: "number-match" })],
    debug: { timeTravel: !0, runHistory: !0 },
  });
ye.start();
const vr = document.getElementById("pool"),
  yr = document.getElementById("removed"),
  br = document.getElementById("moves"),
  wr = document.getElementById("message"),
  Ve = document.getElementById("grid"),
  He = document.getElementById("nm-timeline");
function mt(e) {
  const t = document.createElement("div");
  return (t.textContent = e), t.innerHTML;
}
function bt() {
  const e = ye.facts.table,
    t = ye.facts.selected,
    s = ye.read("poolCount"),
    r = ye.read("removedCount");
  ye.read("selectedTiles"), ye.read("hasValidMoves");
  const n = ye.facts.message;
  (vr.textContent = String(s)),
    (yr.textContent = String(r)),
    (br.textContent = String(ye.facts.moveCount)),
    (wr.textContent = n),
    (Ve.innerHTML = "");
  for (const i of e) {
    const u = document.createElement("div");
    (u.className = `tile${t.includes(i.id) ? " selected" : ""}`),
      (u.textContent = String(i.value)),
      u.addEventListener("click", () => {
        t.includes(i.id)
          ? ye.events.deselectTile({ tileId: i.id })
          : ye.events.selectTile({ tileId: i.id });
      }),
      Ve.appendChild(u);
  }
  for (let i = e.length; i < 9; i++) {
    const u = document.createElement("div");
    (u.className = "tile empty"), Ve.appendChild(u);
  }
  if (Le.length === 0)
    He.innerHTML =
      '<div class="nm-timeline-empty">Events appear after interactions</div>';
  else {
    He.innerHTML = "";
    for (const i of Le) {
      const u = document.createElement("div");
      u.className = `nm-timeline-entry ${i.type}`;
      const v = new Date(i.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (u.innerHTML = `
        <span class="nm-timeline-time">${v}</span>
        <span class="nm-timeline-event">${mt(i.event)}</span>
        <span class="nm-timeline-detail">${mt(i.detail)}</span>
      `),
        He.appendChild(u);
    }
  }
}
ye.subscribe(
  [
    "table",
    "selected",
    "pool",
    "removed",
    "moveCount",
    "message",
    "gameOver",
    "poolCount",
    "removedCount",
    "selectedTiles",
    "hasValidMoves",
  ],
  bt,
);
document.getElementById("clear").addEventListener("click", () => {
  ye.events.clearSelection();
});
document.getElementById("newgame").addEventListener("click", () => {
  (Le.length = 0), ye.events.newGame();
});
bt();
pe("Game started. Select two numbers that add to 10.");
document.body.setAttribute("data-counter-ready", "true");
