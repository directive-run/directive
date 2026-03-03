(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) o(i);
  new MutationObserver((i) => {
    for (const s of i)
      if (s.type === "childList")
        for (const c of s.addedNodes)
          c.tagName === "LINK" && c.rel === "modulepreload" && o(c);
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
var Qe = class extends Error {
    constructor(t, l, o, i, s = !0) {
      super(t),
        (this.source = l),
        (this.sourceId = o),
        (this.context = i),
        (this.recoverable = s),
        (this.name = "DirectiveError");
    }
  },
  me = [];
function Tt() {
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
var zt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function Lt() {
  return me[me.length - 1] ?? zt;
}
function Ae(e) {
  const t = Tt();
  me.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    me.pop();
  }
}
function Ze(e) {
  const t = me.splice(0, me.length);
  try {
    return e();
  } finally {
    me.push(...t);
  }
}
function Ne(e) {
  Lt().track(e);
}
function Nt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Ie(e = [], t, l, o, i, s) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: l,
    _transform: o,
    _description: i,
    _refinements: s,
    validate(c) {
      return Ie([...e, c], t, l, o, i, s);
    },
  };
}
function re(e, t, l, o, i, s) {
  return {
    ...Ie(e, t, l, o, i, s),
    default(c) {
      return re(e, t, c, o, i, s);
    },
    transform(c) {
      return re(
        [],
        t,
        void 0,
        (u) => {
          const g = o ? o(u) : u;
          return c(g);
        },
        i,
      );
    },
    brand() {
      return re(e, `Branded<${t}>`, l, o, i, s);
    },
    describe(c) {
      return re(e, t, l, o, c, s);
    },
    refine(c, u) {
      const g = [...(s ?? []), { predicate: c, message: u }];
      return re([...e, c], t, l, o, i, g);
    },
    nullable() {
      return re(
        [(c) => c === null || e.every((u) => u(c))],
        `${t} | null`,
        l,
        o,
        i,
      );
    },
    optional() {
      return re(
        [(c) => c === void 0 || e.every((u) => u(c))],
        `${t} | undefined`,
        l,
        o,
        i,
      );
    },
  };
}
var G = {
  string() {
    return re([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, l, o, i, s) => ({
      ...re(t, "number", l, o, i, s),
      min(c) {
        return e([...t, (u) => u >= c], l, o, i, s);
      },
      max(c) {
        return e([...t, (u) => u <= c], l, o, i, s);
      },
      default(c) {
        return e(t, c, o, i, s);
      },
      describe(c) {
        return e(t, l, o, c, s);
      },
      refine(c, u) {
        const g = [...(s ?? []), { predicate: c, message: u }];
        return e([...t, c], l, o, i, g);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return re([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, l, o, i, s) => {
      const c = re(t, "array", o, void 0, i),
        u = s ?? { value: -1 };
      return {
        ...c,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(g) {
          u.value = g;
        },
        of(g) {
          const f = { value: -1 };
          return e(
            [
              ...t,
              (d) => {
                for (let $ = 0; $ < d.length; $++) {
                  const T = d[$];
                  if (!g._validators.every((I) => I(T)))
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
          return e([...t, (g) => g.length > 0], l, o, i, u);
        },
        maxLength(g) {
          return e([...t, (f) => f.length <= g], l, o, i, u);
        },
        minLength(g) {
          return e([...t, (f) => f.length >= g], l, o, i, u);
        },
        default(g) {
          return e(t, l, g, i, u);
        },
        describe(g) {
          return e(t, l, o, g, u);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, l, o) => ({
      ...re(t, "object", l, void 0, o),
      shape(i) {
        return e(
          [
            ...t,
            (s) => {
              for (const [c, u] of Object.entries(i)) {
                const g = s[c],
                  f = u;
                if (f && !f._validators.every((d) => d(g))) return !1;
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
        return e([...t, (s) => i.every((c) => c in s)], l, o);
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
    return Ie(
      [(l) => (l === null ? !0 : e._validators.every((o) => o(l)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Ie(
      [(l) => (l === void 0 ? !0 : e._validators.every((o) => o(l)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((l) => l._typeName ?? "unknown");
    return re(
      [(l) => e.some((o) => o._validators.every((i) => i(l)))],
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
            : Object.values(l).every((o) => e._validators.every((i) => i(o))),
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
            : e.every((o, i) => o._validators.every((s) => s(l[i]))),
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
function Pt(e) {
  const { schema: t, onChange: l, onBatch: o } = e;
  Object.keys(t).length;
  let i = e.validate ?? !1,
    s = e.strictKeys ?? !1,
    c = e.redactErrors ?? !1,
    u = new Map(),
    g = new Set(),
    f = new Map(),
    d = new Set(),
    $ = 0,
    T = [],
    I = new Set(),
    D = !1,
    A = [],
    C = 100;
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
  function N(m) {
    const w = m;
    if (w._typeName) return w._typeName;
    if (O(m)) {
      const S = m._def;
      if (S?.typeName) return S.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function _(m) {
    return c ? "[redacted]" : Nt(m);
  }
  function p(m, w) {
    if (!i) return;
    const S = t[m];
    if (!S) {
      if (s)
        throw new Error(
          `[Directive] Unknown fact key: "${m}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${m}"`);
      return;
    }
    if (O(S)) {
      const L = S.safeParse(w);
      if (!L.success) {
        const y = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          k = _(w),
          r =
            L.error?.message ??
            L.error?.issues?.[0]?.message ??
            "Validation failed",
          n = N(S);
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${n}, got ${y} ${k}. ${r}`,
        );
      }
      return;
    }
    const M = S,
      F = M._validators;
    if (!F || !Array.isArray(F) || F.length === 0) return;
    const H = M._typeName ?? "unknown";
    for (let L = 0; L < F.length; L++) {
      const y = F[L];
      if (typeof y == "function" && !y(w)) {
        let k = w === null ? "null" : Array.isArray(w) ? "array" : typeof w,
          r = _(w),
          n = "";
        typeof M._lastFailedIndex == "number" &&
          M._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${M._lastFailedIndex} failed)`),
          (M._lastFailedIndex = -1));
        const a = L === 0 ? "" : ` (validator ${L + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${H}, got ${k} ${r}${a}${n}`,
        );
      }
    }
  }
  function b(m) {
    f.get(m)?.forEach((w) => w());
  }
  function h() {
    d.forEach((m) => m());
  }
  function E(m, w, S) {
    if (D) {
      A.push({ key: m, value: w, prev: S });
      return;
    }
    D = !0;
    try {
      l?.(m, w, S), b(m), h();
      let M = 0;
      while (A.length > 0) {
        if (++M > C)
          throw (
            ((A.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${C} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const F = [...A];
        A.length = 0;
        for (const H of F) l?.(H.key, H.value, H.prev), b(H.key);
        h();
      }
    } finally {
      D = !1;
    }
  }
  function R() {
    if (!($ > 0)) {
      if ((o && T.length > 0 && o([...T]), I.size > 0)) {
        D = !0;
        try {
          for (const w of I) b(w);
          h();
          let m = 0;
          while (A.length > 0) {
            if (++m > C)
              throw (
                ((A.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${C} iterations.`,
                ))
              );
            const w = [...A];
            A.length = 0;
            for (const S of w) l?.(S.key, S.value, S.prev), b(S.key);
            h();
          }
        } finally {
          D = !1;
        }
      }
      (T.length = 0), I.clear();
    }
  }
  const q = {
    get(m) {
      return Ne(m), u.get(m);
    },
    has(m) {
      return Ne(m), u.has(m);
    },
    set(m, w) {
      p(m, w);
      const S = u.get(m);
      Object.is(S, w) ||
        (u.set(m, w),
        g.add(m),
        $ > 0
          ? (T.push({ key: m, value: w, prev: S, type: "set" }), I.add(m))
          : E(m, w, S));
    },
    delete(m) {
      const w = u.get(m);
      u.delete(m),
        g.delete(m),
        $ > 0
          ? (T.push({ key: m, value: void 0, prev: w, type: "delete" }),
            I.add(m))
          : E(m, void 0, w);
    },
    batch(m) {
      $++;
      try {
        m();
      } finally {
        $--, R();
      }
    },
    subscribe(m, w) {
      for (const S of m) {
        const M = S;
        f.has(M) || f.set(M, new Set()), f.get(M).add(w);
      }
      return () => {
        for (const S of m) {
          const M = f.get(S);
          M && (M.delete(w), M.size === 0 && f.delete(S));
        }
      };
    },
    subscribeAll(m) {
      return d.add(m), () => d.delete(m);
    },
    toObject() {
      const m = {};
      for (const w of g) u.has(w) && (m[w] = u.get(w));
      return m;
    },
  };
  return (
    (q.registerKeys = (m) => {
      for (const w of Object.keys(m)) be.has(w) || ((t[w] = m[w]), g.add(w));
    }),
    q
  );
}
var be = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Ft(e, t) {
  const l = () => ({
    get: (o) => Ze(() => e.get(o)),
    has: (o) => Ze(() => e.has(o)),
  });
  return new Proxy(
    {},
    {
      get(o, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return l;
        if (typeof i != "symbol" && !be.has(i)) return e.get(i);
      },
      set(o, i, s) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          be.has(i)
          ? !1
          : (e.set(i, s), !0);
      },
      deleteProperty(o, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          be.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(o, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || be.has(i)
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
function Wt(e) {
  const t = Pt(e),
    l = Ft(t, e.schema);
  return { store: t, facts: l };
}
function Ht(e, t) {
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
async function Ce(e, t, l) {
  let o,
    i = new Promise((s, c) => {
      o = setTimeout(() => c(new Error(l)), t);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(o);
  }
}
function wt(e, t = 50) {
  const l = new WeakSet();
  function o(i, s) {
    if (s > t) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const c = typeof i;
    if (c === "string") return JSON.stringify(i);
    if (c === "number" || c === "boolean") return String(i);
    if (c === "function") return '"[function]"';
    if (c === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (l.has(i)) return '"[circular]"';
      l.add(i);
      const u = `[${i.map((g) => o(g, s + 1)).join(",")}]`;
      return l.delete(i), u;
    }
    if (c === "object") {
      const u = i;
      if (l.has(u)) return '"[circular]"';
      l.add(u);
      const g = `{${Object.keys(u)
        .sort()
        .map((f) => `${JSON.stringify(f)}:${o(u[f], s + 1)}`)
        .join(",")}}`;
      return l.delete(u), g;
    }
    return '"[unknown]"';
  }
  return o(e, 0);
}
function we(e, t = 50) {
  const l = new Set(["__proto__", "constructor", "prototype"]),
    o = new WeakSet();
  function i(s, c) {
    if (c > t) return !1;
    if (s == null || typeof s != "object") return !0;
    const u = s;
    if (o.has(u)) return !0;
    if ((o.add(u), Array.isArray(u))) {
      for (const g of u) if (!i(g, c + 1)) return o.delete(u), !1;
      return o.delete(u), !0;
    }
    for (const g of Object.keys(u))
      if (l.has(g) || !i(u[g], c + 1)) return o.delete(u), !1;
    return o.delete(u), !0;
  }
  return i(e, 0);
}
function Ut(e) {
  let t = wt(e),
    l = 5381;
  for (let o = 0; o < t.length; o++) l = ((l << 5) + l) ^ t.charCodeAt(o);
  return (l >>> 0).toString(16);
}
function Vt(e, t) {
  if (t) return t(e);
  const { type: l, ...o } = e,
    i = wt(o);
  return `${l}:${i}`;
}
function Kt(e, t, l) {
  return { requirement: e, id: Vt(e, l), fromConstraint: t };
}
var Pe = class St {
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
      const t = new St();
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
  Gt = 5e3;
function Jt(e) {
  let {
      definitions: t,
      facts: l,
      requirementKeys: o = {},
      defaultTimeout: i = Gt,
      onEvaluate: s,
      onError: c,
    } = e,
    u = new Map(),
    g = new Set(),
    f = new Set(),
    d = new Map(),
    $ = new Map(),
    T = new Set(),
    I = new Map(),
    D = new Map(),
    A = !1,
    C = new Set(),
    O = new Set(),
    N = new Map(),
    _ = [],
    p = new Map();
  function b() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const a of n.after)
          t[a] && (N.has(a) || N.set(a, new Set()), N.get(a).add(r));
  }
  function h() {
    const r = new Set(),
      n = new Set(),
      a = [];
    function v(x, j) {
      if (r.has(x)) return;
      if (n.has(x)) {
        const W = j.indexOf(x),
          z = [...j.slice(W), x].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${z}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(x), j.push(x);
      const P = t[x];
      if (P?.after) for (const W of P.after) t[W] && v(W, j);
      j.pop(), n.delete(x), r.add(x), a.push(x);
    }
    for (const x of Object.keys(t)) v(x, []);
    (_ = a), (p = new Map(_.map((x, j) => [x, j])));
  }
  h(), b();
  function E(r, n) {
    return n.async !== void 0 ? n.async : !!f.has(r);
  }
  function R(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const a = E(r, n);
    a && f.add(r);
    const v = {
      id: r,
      priority: n.priority ?? 0,
      isAsync: a,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return u.set(r, v), v;
  }
  function q(r) {
    return u.get(r) ?? R(r);
  }
  function m(r, n) {
    const a = d.get(r) ?? new Set();
    for (const v of a) {
      const x = $.get(v);
      x?.delete(r), x && x.size === 0 && $.delete(v);
    }
    for (const v of n) $.has(v) || $.set(v, new Set()), $.get(v).add(r);
    d.set(r, n);
  }
  function w(r) {
    const n = t[r];
    if (!n) return !1;
    const a = q(r);
    (a.isEvaluating = !0), (a.error = null);
    try {
      let v;
      if (n.deps) (v = n.when(l)), I.set(r, new Set(n.deps));
      else {
        const x = Ae(() => n.when(l));
        (v = x.value), I.set(r, x.deps);
      }
      return v instanceof Promise
        ? (f.add(r),
          (a.isAsync = !0),
          v
            .then(
              (x) => ((a.lastResult = x), (a.isEvaluating = !1), s?.(r, x), x),
            )
            .catch(
              (x) => (
                (a.error = x instanceof Error ? x : new Error(String(x))),
                (a.lastResult = !1),
                (a.isEvaluating = !1),
                c?.(r, x),
                !1
              ),
            ))
        : ((a.lastResult = v), (a.isEvaluating = !1), s?.(r, v), v);
    } catch (v) {
      return (
        (a.error = v instanceof Error ? v : new Error(String(v))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        c?.(r, v),
        !1
      );
    }
  }
  async function S(r) {
    const n = t[r];
    if (!n) return !1;
    const a = q(r),
      v = n.timeout ?? i;
    if (((a.isEvaluating = !0), (a.error = null), n.deps?.length)) {
      const x = new Set(n.deps);
      m(r, x), I.set(r, x);
    }
    try {
      const x = n.when(l),
        j = await Ce(x, v, `Constraint "${r}" timed out after ${v}ms`);
      return (a.lastResult = j), (a.isEvaluating = !1), s?.(r, j), j;
    } catch (x) {
      return (
        (a.error = x instanceof Error ? x : new Error(String(x))),
        (a.lastResult = !1),
        (a.isEvaluating = !1),
        c?.(r, x),
        !1
      );
    }
  }
  function M(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((v) => v != null) : [r];
  }
  function F(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const a = n.require;
    if (typeof a == "function") {
      const { value: v, deps: x } = Ae(() => a(l));
      return { requirements: M(v), deps: x };
    }
    return { requirements: M(a), deps: new Set() };
  }
  function H(r, n) {
    if (n.size === 0) return;
    const a = d.get(r) ?? new Set();
    for (const v of n)
      a.add(v), $.has(v) || $.set(v, new Set()), $.get(v).add(r);
    d.set(r, a);
  }
  let L = null;
  function y() {
    return (
      L ||
        (L = Object.keys(t).sort((r, n) => {
          const a = q(r),
            v = q(n).priority - a.priority;
          if (v !== 0) return v;
          const x = p.get(r) ?? 0,
            j = p.get(n) ?? 0;
          return x - j;
        })),
      L
    );
  }
  for (const r of Object.keys(t)) R(r);
  function k(r) {
    const n = u.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const a of n.after)
      if (t[a] && !g.has(a) && !O.has(a) && !C.has(a)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new Pe();
      O.clear();
      let a = y().filter((z) => !g.has(z)),
        v;
      if (!A || !r || r.size === 0) (v = a), (A = !0);
      else {
        const z = new Set();
        for (const K of r) {
          const Y = $.get(K);
          if (Y) for (const ne of Y) g.has(ne) || z.add(ne);
        }
        for (const K of T) g.has(K) || z.add(K);
        T.clear(), (v = [...z]);
        for (const K of a)
          if (!z.has(K)) {
            const Y = D.get(K);
            if (Y) for (const ne of Y) n.add(ne);
          }
      }
      function x(z, K) {
        if (g.has(z)) return;
        const Y = I.get(z);
        if (!K) {
          Y !== void 0 && m(z, Y), O.add(z), D.set(z, []);
          return;
        }
        O.delete(z);
        let ne, te;
        try {
          const Z = F(z);
          (ne = Z.requirements), (te = Z.deps);
        } catch (Z) {
          c?.(z, Z), Y !== void 0 && m(z, Y), D.set(z, []);
          return;
        }
        if (Y !== void 0) {
          const Z = new Set(Y);
          for (const V of te) Z.add(V);
          m(z, Z);
        } else H(z, te);
        if (ne.length > 0) {
          const Z = o[z],
            V = ne.map((J) => Kt(J, z, Z));
          for (const J of V) n.add(J);
          D.set(z, V);
        } else D.set(z, []);
      }
      async function j(z) {
        const K = [],
          Y = [];
        for (const V of z)
          if (k(V)) Y.push(V);
          else {
            K.push(V);
            const J = D.get(V);
            if (J) for (const Q of J) n.add(Q);
          }
        if (Y.length === 0) return K;
        const ne = [],
          te = [];
        for (const V of Y) q(V).isAsync ? te.push(V) : ne.push(V);
        const Z = [];
        for (const V of ne) {
          const J = w(V);
          if (J instanceof Promise) {
            Z.push({ id: V, promise: J });
            continue;
          }
          x(V, J);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async ({ id: J, promise: Q }) => ({
              id: J,
              active: await Q,
            })),
          );
          for (const { id: J, active: Q } of V) x(J, Q);
        }
        if (te.length > 0) {
          const V = await Promise.all(
            te.map(async (J) => ({ id: J, active: await S(J) })),
          );
          for (const { id: J, active: Q } of V) x(J, Q);
        }
        return K;
      }
      let P = v,
        W = v.length + 1;
      while (P.length > 0 && W > 0) {
        const z = P.length;
        if (((P = await j(P)), P.length === z)) break;
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
      g.add(r), (L = null), D.delete(r);
      const n = d.get(r);
      if (n) {
        for (const a of n) {
          const v = $.get(a);
          v && (v.delete(r), v.size === 0 && $.delete(a));
        }
        d.delete(r);
      }
      I.delete(r);
    },
    enable(r) {
      g.delete(r), (L = null), T.add(r);
    },
    invalidate(r) {
      const n = $.get(r);
      if (n) for (const a of n) T.add(a);
    },
    markResolved(r) {
      C.add(r);
      const n = u.get(r);
      n && (n.lastResolvedAt = Date.now());
      const a = N.get(r);
      if (a) for (const v of a) T.add(v);
    },
    isResolved(r) {
      return C.has(r);
    },
    registerDefinitions(r) {
      for (const [n, a] of Object.entries(r)) (t[n] = a), R(n), T.add(n);
      (L = null), h(), b();
    },
  };
}
function Yt(e) {
  let {
      definitions: t,
      facts: l,
      onCompute: o,
      onInvalidate: i,
      onError: s,
    } = e,
    c = new Map(),
    u = new Map(),
    g = new Map(),
    f = new Map(),
    d = new Set(["__proto__", "constructor", "prototype"]),
    $ = 0,
    T = new Set(),
    I = !1,
    D = 100,
    A;
  function C(h) {
    if (!t[h]) throw new Error(`[Directive] Unknown derivation: ${h}`);
    const E = {
      id: h,
      compute: () => N(h),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return c.set(h, E), E;
  }
  function O(h) {
    return c.get(h) ?? C(h);
  }
  function N(h) {
    const E = O(h),
      R = t[h];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${h}`);
    if (E.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${h}`,
      );
    E.isComputing = !0;
    try {
      const { value: q, deps: m } = Ae(() => R(l, A));
      return (
        (E.cachedValue = q), (E.isStale = !1), _(h, m), o?.(h, q, [...m]), q
      );
    } catch (q) {
      throw (s?.(h, q), q);
    } finally {
      E.isComputing = !1;
    }
  }
  function _(h, E) {
    const R = O(h),
      q = R.dependencies;
    for (const m of q)
      if (c.has(m)) {
        const w = f.get(m);
        w?.delete(h), w && w.size === 0 && f.delete(m);
      } else {
        const w = g.get(m);
        w?.delete(h), w && w.size === 0 && g.delete(m);
      }
    for (const m of E)
      t[m]
        ? (f.has(m) || f.set(m, new Set()), f.get(m).add(h))
        : (g.has(m) || g.set(m, new Set()), g.get(m).add(h));
    R.dependencies = E;
  }
  function p() {
    if (!($ > 0 || I)) {
      I = !0;
      try {
        let h = 0;
        while (T.size > 0) {
          if (++h > D) {
            const R = [...T];
            throw (
              (T.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${D} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const E = [...T];
          T.clear();
          for (const R of E) u.get(R)?.forEach((q) => q());
        }
      } finally {
        I = !1;
      }
    }
  }
  function b(h, E = new Set()) {
    if (E.has(h)) return;
    E.add(h);
    const R = c.get(h);
    if (!R || R.isStale) return;
    (R.isStale = !0), i?.(h), T.add(h);
    const q = f.get(h);
    if (q) for (const m of q) b(m, E);
  }
  return (
    (A = new Proxy(
      {},
      {
        get(h, E) {
          if (typeof E == "symbol" || d.has(E)) return;
          Ne(E);
          const R = O(E);
          return R.isStale && N(E), R.cachedValue;
        },
      },
    )),
    {
      get(h) {
        const E = O(h);
        return E.isStale && N(h), E.cachedValue;
      },
      isStale(h) {
        return c.get(h)?.isStale ?? !0;
      },
      invalidate(h) {
        const E = g.get(h);
        if (E) {
          $++;
          try {
            for (const R of E) b(R);
          } finally {
            $--, p();
          }
        }
      },
      invalidateMany(h) {
        $++;
        try {
          for (const E of h) {
            const R = g.get(E);
            if (R) for (const q of R) b(q);
          }
        } finally {
          $--, p();
        }
      },
      invalidateAll() {
        $++;
        try {
          for (const h of c.values())
            h.isStale || ((h.isStale = !0), T.add(h.id));
        } finally {
          $--, p();
        }
      },
      subscribe(h, E) {
        for (const R of h) {
          const q = R;
          u.has(q) || u.set(q, new Set()), u.get(q).add(E);
        }
        return () => {
          for (const R of h) {
            const q = R,
              m = u.get(q);
            m?.delete(E), m && m.size === 0 && u.delete(q);
          }
        };
      },
      getProxy() {
        return A;
      },
      getDependencies(h) {
        return O(h).dependencies;
      },
      registerDefinitions(h) {
        for (const [E, R] of Object.entries(h)) (t[E] = R), C(E);
      },
    }
  );
}
function Xt(e) {
  let { definitions: t, facts: l, store: o, onRun: i, onError: s } = e,
    c = new Map(),
    u = null,
    g = !1;
  function f(C) {
    const O = t[C];
    if (!O) throw new Error(`[Directive] Unknown effect: ${C}`);
    const N = {
      id: C,
      enabled: !0,
      hasExplicitDeps: !!O.deps,
      dependencies: O.deps ? new Set(O.deps) : null,
      cleanup: null,
    };
    return c.set(C, N), N;
  }
  function d(C) {
    return c.get(C) ?? f(C);
  }
  function $() {
    return o.toObject();
  }
  function T(C, O) {
    const N = d(C);
    if (!N.enabled) return !1;
    if (N.dependencies) {
      for (const _ of N.dependencies) if (O.has(_)) return !0;
      return !1;
    }
    return !0;
  }
  function I(C) {
    if (C.cleanup) {
      try {
        C.cleanup();
      } catch (O) {
        s?.(C.id, O),
          console.error(
            `[Directive] Effect "${C.id}" cleanup threw an error:`,
            O,
          );
      }
      C.cleanup = null;
    }
  }
  function D(C, O) {
    if (typeof O == "function")
      if (g)
        try {
          O();
        } catch (N) {
          s?.(C.id, N),
            console.error(
              `[Directive] Effect "${C.id}" cleanup threw an error:`,
              N,
            );
        }
      else C.cleanup = O;
  }
  async function A(C) {
    const O = d(C),
      N = t[C];
    if (!(!O.enabled || !N)) {
      I(O), i?.(C);
      try {
        if (O.hasExplicitDeps) {
          let _;
          if (
            (o.batch(() => {
              _ = N.run(l, u);
            }),
            _ instanceof Promise)
          ) {
            const p = await _;
            D(O, p);
          } else D(O, _);
        } else {
          let _ = null,
            p,
            b = Ae(
              () => (
                o.batch(() => {
                  p = N.run(l, u);
                }),
                p
              ),
            );
          _ = b.deps;
          let h = b.value;
          h instanceof Promise && (h = await h),
            D(O, h),
            (O.dependencies = _.size > 0 ? _ : null);
        }
      } catch (_) {
        s?.(C, _),
          console.error(`[Directive] Effect "${C}" threw an error:`, _);
      }
    }
  }
  for (const C of Object.keys(t)) f(C);
  return {
    async runEffects(C) {
      const O = [];
      for (const N of Object.keys(t)) T(N, C) && O.push(N);
      await Promise.all(O.map(A)), (u = $());
    },
    async runAll() {
      const C = Object.keys(t);
      await Promise.all(
        C.map((O) => (d(O).enabled ? A(O) : Promise.resolve())),
      ),
        (u = $());
    },
    disable(C) {
      const O = d(C);
      O.enabled = !1;
    },
    enable(C) {
      const O = d(C);
      O.enabled = !0;
    },
    isEnabled(C) {
      return d(C).enabled;
    },
    cleanupAll() {
      g = !0;
      for (const C of c.values()) I(C);
    },
    registerDefinitions(C) {
      for (const [O, N] of Object.entries(C)) (t[O] = N), f(O);
    },
  };
}
function Qt(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: l = 3,
      backoffMultiplier: o = 2,
      maxDelayMs: i = 3e4,
    } = e,
    s = new Map();
  function c(u) {
    const g = t * Math.pow(o, u - 1);
    return Math.min(g, i);
  }
  return {
    scheduleRetry(u, g, f, d, $) {
      if (d > l) return null;
      const T = c(d),
        I = {
          source: u,
          sourceId: g,
          context: f,
          attempt: d,
          nextRetryTime: Date.now() + T,
          callback: $,
        };
      return s.set(g, I), I;
    },
    getPendingRetries() {
      return Array.from(s.values());
    },
    processDueRetries() {
      const u = Date.now(),
        g = [];
      for (const [f, d] of s) d.nextRetryTime <= u && (g.push(d), s.delete(f));
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
var Zt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function er(e = {}) {
  const { config: t = {}, onError: l, onRecovery: o } = e,
    i = [],
    s = 100,
    c = Qt(t.retryLater),
    u = new Map();
  function g(d, $, T, I) {
    if (T instanceof Qe) return T;
    const D = T instanceof Error ? T.message : String(T),
      A = d !== "system";
    return new Qe(D, d, $, I, A);
  }
  function f(d, $, T) {
    const I = (() => {
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
    if (typeof I == "function") {
      try {
        I(T, $);
      } catch (D) {
        console.error("[Directive] Error in error handler callback:", D);
      }
      return "skip";
    }
    return typeof I == "string" ? I : Zt[d];
  }
  return {
    handleError(d, $, T, I) {
      const D = g(d, $, T, I);
      i.push(D), i.length > s && i.shift();
      try {
        l?.(D);
      } catch (C) {
        console.error("[Directive] Error in onError callback:", C);
      }
      try {
        t.onError?.(D);
      } catch (C) {
        console.error("[Directive] Error in config.onError callback:", C);
      }
      let A = f(d, $, T instanceof Error ? T : new Error(String(T)));
      if (A === "retry-later") {
        const C = (u.get($) ?? 0) + 1;
        u.set($, C),
          c.scheduleRetry(d, $, I, C) ||
            ((A = "skip"), u.delete($), typeof process < "u");
      }
      try {
        o?.(D, A);
      } catch (C) {
        console.error("[Directive] Error in onRecovery callback:", C);
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
      return c;
    },
    processDueRetries() {
      return c.processDueRetries();
    },
    clearRetryAttempts(d) {
      u.delete(d), c.cancelRetry(d);
    },
  };
}
function tr() {
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
      for (const c of e) t(() => c.onFactSet?.(o, i, s));
    },
    emitFactDelete(o, i) {
      for (const s of e) t(() => s.onFactDelete?.(o, i));
    },
    emitFactsBatch(o) {
      for (const i of e) t(() => i.onFactsBatch?.(o));
    },
    emitDerivationCompute(o, i, s) {
      for (const c of e) t(() => c.onDerivationCompute?.(o, i, s));
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
      for (const c of e) t(() => c.onResolverComplete?.(o, i, s));
    },
    emitResolverError(o, i, s) {
      for (const c of e) t(() => c.onResolverError?.(o, i, s));
    },
    emitResolverRetry(o, i, s) {
      for (const c of e) t(() => c.onResolverRetry?.(o, i, s));
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
var et = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  tt = { enabled: !1, windowMs: 50 };
function rt(e, t) {
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
function rr(e) {
  const {
      definitions: t,
      facts: l,
      store: o,
      onStart: i,
      onComplete: s,
      onError: c,
      onRetry: u,
      onCancel: g,
      onResolutionComplete: f,
    } = e,
    d = new Map(),
    $ = new Map(),
    T = 1e3,
    I = new Map(),
    D = new Map(),
    A = 1e3;
  function C() {
    if ($.size > T) {
      const m = $.size - T,
        w = $.keys();
      for (let S = 0; S < m; S++) {
        const M = w.next().value;
        M && $.delete(M);
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
  function N(m) {
    return (
      typeof m == "object" &&
      m !== null &&
      "requirement" in m &&
      typeof m.requirement == "function"
    );
  }
  function _(m, w) {
    return O(m) ? w.type === m.requirement : N(m) ? m.requirement(w) : !1;
  }
  function p(m) {
    const w = m.type,
      S = D.get(w);
    if (S)
      for (const M of S) {
        const F = t[M];
        if (F && _(F, m)) return M;
      }
    for (const [M, F] of Object.entries(t))
      if (_(F, m)) {
        if (!D.has(w)) {
          if (D.size >= A) {
            const L = D.keys().next().value;
            L !== void 0 && D.delete(L);
          }
          D.set(w, []);
        }
        const H = D.get(w);
        return H.includes(M) || H.push(M), M;
      }
    return null;
  }
  function b(m) {
    return { facts: l, signal: m, snapshot: () => l.$snapshot() };
  }
  async function h(m, w, S) {
    const M = t[m];
    if (!M) return;
    let F = { ...et, ...M.retry },
      H = null;
    for (let L = 1; L <= F.attempts; L++) {
      if (S.signal.aborted) return;
      const y = d.get(w.id);
      y &&
        ((y.attempt = L),
        (y.status = {
          state: "running",
          requirementId: w.id,
          startedAt: y.startedAt,
          attempt: L,
        }));
      try {
        const k = b(S.signal);
        if (M.resolve) {
          let n;
          o.batch(() => {
            n = M.resolve(w.requirement, k);
          });
          const a = M.timeout;
          a && a > 0
            ? await Ce(n, a, `Resolver "${m}" timed out after ${a}ms`)
            : await n;
        }
        const r = Date.now() - (y?.startedAt ?? Date.now());
        $.set(w.id, {
          state: "success",
          requirementId: w.id,
          completedAt: Date.now(),
          duration: r,
        }),
          C(),
          s?.(m, w, r);
        return;
      } catch (k) {
        if (
          ((H = k instanceof Error ? k : new Error(String(k))),
          S.signal.aborted)
        )
          return;
        if (F.shouldRetry && !F.shouldRetry(H, L)) break;
        if (L < F.attempts) {
          if (S.signal.aborted) return;
          const r = rt(F, L);
          if (
            (u?.(m, w, L + 1),
            await new Promise((n) => {
              const a = setTimeout(n, r),
                v = () => {
                  clearTimeout(a), n();
                };
              S.signal.addEventListener("abort", v, { once: !0 });
            }),
            S.signal.aborted)
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
      attempts: F.attempts,
    }),
      C(),
      c?.(m, w, H);
  }
  async function E(m, w) {
    const S = t[m];
    if (!S) return;
    if (!S.resolveBatch && !S.resolveBatchWithResults) {
      await Promise.all(
        w.map((r) => {
          const n = new AbortController();
          return h(m, r, n);
        }),
      );
      return;
    }
    let M = { ...et, ...S.retry },
      F = { ...tt, ...S.batch },
      H = new AbortController(),
      L = Date.now(),
      y = null,
      k = F.timeoutMs ?? S.timeout;
    for (let r = 1; r <= M.attempts; r++) {
      if (H.signal.aborted) return;
      try {
        const n = b(H.signal),
          a = w.map((v) => v.requirement);
        if (S.resolveBatchWithResults) {
          let v, x;
          if (
            (o.batch(() => {
              x = S.resolveBatchWithResults(a, n);
            }),
            k && k > 0
              ? (v = await Ce(
                  x,
                  k,
                  `Batch resolver "${m}" timed out after ${k}ms`,
                ))
              : (v = await x),
            v.length !== w.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${m}" returned ${v.length} results but expected ${w.length}. Results array must match input order.`,
            );
          let j = Date.now() - L,
            P = !1;
          for (let W = 0; W < w.length; W++) {
            const z = w[W],
              K = v[W];
            if (K.success)
              $.set(z.id, {
                state: "success",
                requirementId: z.id,
                completedAt: Date.now(),
                duration: j,
              }),
                s?.(m, z, j);
            else {
              P = !0;
              const Y = K.error ?? new Error("Batch item failed");
              $.set(z.id, {
                state: "error",
                requirementId: z.id,
                error: Y,
                failedAt: Date.now(),
                attempts: r,
              }),
                c?.(m, z, Y);
            }
          }
          if (!P || w.some((W, z) => v[z]?.success)) return;
        } else {
          let v;
          o.batch(() => {
            v = S.resolveBatch(a, n);
          }),
            k && k > 0
              ? await Ce(v, k, `Batch resolver "${m}" timed out after ${k}ms`)
              : await v;
          const x = Date.now() - L;
          for (const j of w)
            $.set(j.id, {
              state: "success",
              requirementId: j.id,
              completedAt: Date.now(),
              duration: x,
            }),
              s?.(m, j, x);
          return;
        }
      } catch (n) {
        if (
          ((y = n instanceof Error ? n : new Error(String(n))),
          H.signal.aborted)
        )
          return;
        if (M.shouldRetry && !M.shouldRetry(y, r)) break;
        if (r < M.attempts) {
          const a = rt(M, r);
          for (const v of w) u?.(m, v, r + 1);
          if (
            (await new Promise((v) => {
              const x = setTimeout(v, a),
                j = () => {
                  clearTimeout(x), v();
                };
              H.signal.addEventListener("abort", j, { once: !0 });
            }),
            H.signal.aborted)
          )
            return;
        }
      }
    }
    for (const r of w)
      $.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: y,
        failedAt: Date.now(),
        attempts: M.attempts,
      }),
        c?.(m, r, y);
    C();
  }
  function R(m, w) {
    const S = t[m];
    if (!S) return;
    const M = { ...tt, ...S.batch };
    I.has(m) || I.set(m, { resolverId: m, requirements: [], timer: null });
    const F = I.get(m);
    F.requirements.push(w),
      F.timer && clearTimeout(F.timer),
      (F.timer = setTimeout(() => {
        q(m);
      }, M.windowMs));
  }
  function q(m) {
    const w = I.get(m);
    if (!w || w.requirements.length === 0) return;
    const S = [...w.requirements];
    (w.requirements = []),
      (w.timer = null),
      E(m, S).then(() => {
        f?.();
      });
  }
  return {
    resolve(m) {
      if (d.has(m.id)) return;
      const w = p(m.requirement);
      if (!w) {
        console.warn(`[Directive] No resolver found for requirement: ${m.id}`);
        return;
      }
      const S = t[w];
      if (!S) return;
      if (S.batch?.enabled) {
        R(w, m);
        return;
      }
      const M = new AbortController(),
        F = Date.now(),
        H = {
          requirementId: m.id,
          resolverId: w,
          controller: M,
          startedAt: F,
          attempt: 1,
          status: { state: "pending", requirementId: m.id, startedAt: F },
          originalRequirement: m,
        };
      d.set(m.id, H),
        i?.(w, m),
        h(w, m, M).finally(() => {
          d.delete(m.id) && f?.();
        });
    },
    cancel(m) {
      const w = d.get(m);
      w &&
        (w.controller.abort(),
        d.delete(m),
        $.set(m, {
          state: "canceled",
          requirementId: m,
          canceledAt: Date.now(),
        }),
        C(),
        g?.(w.resolverId, w.originalRequirement));
    },
    cancelAll() {
      for (const [m] of d) this.cancel(m);
      for (const m of I.values()) m.timer && clearTimeout(m.timer);
      I.clear();
    },
    getStatus(m) {
      const w = d.get(m);
      return w ? w.status : $.get(m) || { state: "idle" };
    },
    getInflight() {
      return [...d.keys()];
    },
    getInflightInfo() {
      return [...d.values()].map((m) => ({
        id: m.requirementId,
        resolverId: m.resolverId,
        startedAt: m.startedAt,
      }));
    },
    isResolving(m) {
      return d.has(m);
    },
    processBatches() {
      for (const m of I.keys()) q(m);
    },
    registerDefinitions(m) {
      for (const [w, S] of Object.entries(m)) t[w] = S;
      D.clear();
    },
  };
}
function nr(e) {
  let { config: t, facts: l, store: o, onSnapshot: i, onTimeTravel: s } = e,
    c = t.timeTravel ?? !1,
    u = t.maxSnapshots ?? 100,
    g = [],
    f = -1,
    d = 1,
    $ = !1,
    T = !1,
    I = [],
    D = null,
    A = -1;
  function C() {
    return o.toObject();
  }
  function O() {
    const _ = C();
    return structuredClone(_);
  }
  function N(_) {
    if (!we(_)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    o.batch(() => {
      for (const [p, b] of Object.entries(_)) {
        if (p === "__proto__" || p === "constructor" || p === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${p}" during fact restoration`,
          );
          continue;
        }
        l[p] = b;
      }
    });
  }
  return {
    get isEnabled() {
      return c;
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
    takeSnapshot(_) {
      if (!c || $)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: _ };
      const p = { id: d++, timestamp: Date.now(), facts: O(), trigger: _ };
      for (
        f < g.length - 1 && g.splice(f + 1), g.push(p), f = g.length - 1;
        g.length > u;
      )
        g.shift(), f--;
      return i?.(p), p;
    },
    restore(_) {
      if (c) {
        ($ = !0), (T = !0);
        try {
          N(_.facts);
        } finally {
          ($ = !1), (T = !1);
        }
      }
    },
    goBack(_ = 1) {
      if (!c || g.length === 0) return;
      let p = f,
        b = f,
        h = I.find((R) => f > R.startIndex && f <= R.endIndex);
      if (h) b = h.startIndex;
      else if (I.find((R) => f === R.startIndex)) {
        const R = I.find((q) => q.endIndex < f && f - q.endIndex <= _);
        b = R ? R.startIndex : Math.max(0, f - _);
      } else b = Math.max(0, f - _);
      if (p === b) return;
      f = b;
      const E = g[f];
      E && (this.restore(E), s?.(p, b));
    },
    goForward(_ = 1) {
      if (!c || g.length === 0) return;
      let p = f,
        b = f,
        h = I.find((R) => f >= R.startIndex && f < R.endIndex);
      if ((h ? (b = h.endIndex) : (b = Math.min(g.length - 1, f + _)), p === b))
        return;
      f = b;
      const E = g[f];
      E && (this.restore(E), s?.(p, b));
    },
    goTo(_) {
      if (!c) return;
      const p = g.findIndex((E) => E.id === _);
      if (p === -1) {
        console.warn(`[Directive] Snapshot ${_} not found`);
        return;
      }
      const b = f;
      f = p;
      const h = g[f];
      h && (this.restore(h), s?.(b, p));
    },
    replay() {
      if (!c || g.length === 0) return;
      f = 0;
      const _ = g[0];
      _ && this.restore(_);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: g, currentIndex: f });
    },
    import(_) {
      if (c)
        try {
          const p = JSON.parse(_);
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
          for (const h of p.snapshots) {
            if (typeof h != "object" || h === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof h.id != "number" ||
              typeof h.timestamp != "number" ||
              typeof h.trigger != "string" ||
              typeof h.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!we(h.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (g.length = 0), g.push(...p.snapshots), (f = p.currentIndex);
          const b = g[f];
          b && this.restore(b);
        } catch (p) {
          console.error("[Directive] Failed to import time-travel data:", p);
        }
    },
    beginChangeset(_) {
      c && ((D = _), (A = f));
    },
    endChangeset() {
      !c ||
        D === null ||
        (f > A && I.push({ label: D, startIndex: A, endIndex: f }),
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
function ir() {
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
function xt(e) {
  const t = Object.create(null),
    l = Object.create(null),
    o = Object.create(null),
    i = Object.create(null),
    s = Object.create(null),
    c = Object.create(null);
  for (const r of e.modules) {
    const n = (a, v) => {
      if (a) {
        for (const x of Object.keys(a))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${x}" in ${v}. This could indicate a prototype pollution attempt.`,
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
      r.resolvers && Object.assign(c, r.resolvers);
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
    f = !1,
    d = tr();
  for (const r of e.plugins ?? []) d.register(r);
  let $ = er({
      config: e.errorBoundary,
      onError: (r) => d.emitError(r),
      onRecovery: (r, n) => d.emitErrorRecovery(r, n),
    }),
    T = () => {},
    I = () => {},
    D = null,
    { store: A, facts: C } = Wt({
      schema: t,
      onChange: (r, n, a) => {
        d.emitFactSet(r, n, a),
          T(r),
          !D?.isRestoring && (g === 0 && (f = !0), S.changedKeys.add(r), M());
      },
      onBatch: (r) => {
        d.emitFactsBatch(r);
        const n = [];
        for (const a of r) n.push(a.key);
        if ((I(n), !D?.isRestoring)) {
          g === 0 && (f = !0);
          for (const a of r) S.changedKeys.add(a.key);
          M();
        }
      },
    }),
    O = Yt({
      definitions: o,
      facts: C,
      onCompute: (r, n, a) => d.emitDerivationCompute(r, n, a),
      onInvalidate: (r) => d.emitDerivationInvalidate(r),
      onError: (r, n) => {
        $.handleError("derivation", r, n);
      },
    });
  (T = (r) => O.invalidate(r)), (I = (r) => O.invalidateMany(r));
  const N = Xt({
      definitions: i,
      facts: C,
      store: A,
      onRun: (r) => d.emitEffectRun(r),
      onError: (r, n) => {
        $.handleError("effect", r, n), d.emitEffectError(r, n);
      },
    }),
    _ = Jt({
      definitions: s,
      facts: C,
      onEvaluate: (r, n) => d.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        $.handleError("constraint", r, n), d.emitConstraintError(r, n);
      },
    }),
    p = rr({
      definitions: c,
      facts: C,
      store: A,
      onStart: (r, n) => d.emitResolverStart(r, n),
      onComplete: (r, n, a) => {
        d.emitResolverComplete(r, n, a),
          d.emitRequirementMet(n, r),
          _.markResolved(n.fromConstraint);
      },
      onError: (r, n, a) => {
        $.handleError("resolver", r, a, n), d.emitResolverError(r, n, a);
      },
      onRetry: (r, n, a) => d.emitResolverRetry(r, n, a),
      onCancel: (r, n) => {
        d.emitResolverCancel(r, n), d.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        q(), M();
      },
    }),
    b = new Set();
  function h() {
    for (const r of b) r();
  }
  const E = e.debug?.timeTravel
    ? nr({
        config: e.debug,
        facts: C,
        store: A,
        onSnapshot: (r) => {
          d.emitSnapshot(r), h();
        },
        onTimeTravel: (r, n) => {
          d.emitTimeTravel(r, n), h();
        },
      })
    : ir();
  D = E;
  const R = new Set();
  function q() {
    for (const r of R) r();
  }
  let m = 50,
    w = 0,
    S = {
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
  function M() {
    !S.isRunning ||
      S.reconcileScheduled ||
      S.isInitializing ||
      ((S.reconcileScheduled = !0),
      q(),
      queueMicrotask(() => {
        (S.reconcileScheduled = !1),
          S.isRunning && !S.isInitializing && F().catch((r) => {});
      }));
  }
  async function F() {
    if (!S.isReconciling) {
      if ((w++, w > m)) {
        w = 0;
        return;
      }
      (S.isReconciling = !0), q();
      try {
        S.changedKeys.size > 0 &&
          ((u === null || f) &&
            E.takeSnapshot(`facts-changed:${[...S.changedKeys].join(",")}`),
          (f = !1));
        const r = C.$snapshot();
        d.emitReconcileStart(r), await N.runEffects(S.changedKeys);
        const n = new Set(S.changedKeys);
        S.changedKeys.clear();
        const a = await _.evaluate(n),
          v = new Pe();
        for (const z of a) v.add(z), d.emitRequirementCreated(z);
        const { added: x, removed: j } = v.diff(S.previousRequirements);
        for (const z of j) p.cancel(z.id);
        for (const z of x) p.resolve(z);
        S.previousRequirements = v;
        const P = p.getInflightInfo(),
          W = {
            unmet: a.filter((z) => !p.isResolving(z.id)),
            inflight: P,
            completed: [],
            canceled: j.map((z) => ({
              id: z.id,
              resolverId: P.find((K) => K.id === z.id)?.resolverId ?? "unknown",
            })),
          };
        d.emitReconcileEnd(W),
          S.isReady ||
            ((S.isReady = !0),
            S.readyResolve && (S.readyResolve(), (S.readyResolve = null)));
      } finally {
        (S.isReconciling = !1),
          S.changedKeys.size > 0 ? M() : S.reconcileScheduled || (w = 0),
          q();
      }
    }
  }
  const H = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !le.has(n)) return O.get(n);
        },
        has(r, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in o;
        },
        ownKeys() {
          return Object.keys(o);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !le.has(n) && n in o)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    L = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !le.has(n))
            return (a) => {
              const v = l[n];
              if (v) {
                g++, (u === null || u.has(n)) && (f = !0);
                try {
                  A.batch(() => {
                    v(C, { type: n, ...a });
                  });
                } finally {
                  g--;
                }
              }
            };
        },
        has(r, n) {
          return typeof n == "symbol" || le.has(n) ? !1 : n in l;
        },
        ownKeys() {
          return Object.keys(l);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !le.has(n) && n in l)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: C,
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
        if (!S.isInitialized) {
          S.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              A.batch(() => {
                r.init(C);
              });
          e.onAfterModuleInit &&
            A.batch(() => {
              e.onAfterModuleInit();
            }),
            (S.isInitializing = !1),
            (S.isInitialized = !0);
          for (const r of Object.keys(o)) O.get(r);
        }
      },
      start() {
        if (!S.isRunning) {
          S.isInitialized || this.initialize(), (S.isRunning = !0);
          for (const r of e.modules) r.hooks?.onStart?.(y);
          d.emitStart(y), M();
        }
      },
      stop() {
        if (S.isRunning) {
          (S.isRunning = !1), p.cancelAll(), N.cleanupAll();
          for (const r of e.modules) r.hooks?.onStop?.(y);
          d.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (S.isDestroyed = !0),
          R.clear(),
          b.clear(),
          d.emitDestroy(y);
      },
      dispatch(r) {
        if (le.has(r.type)) return;
        const n = l[r.type];
        if (n) {
          g++, (u === null || u.has(r.type)) && (f = !0);
          try {
            A.batch(() => {
              n(C, r);
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
          v = [];
        for (const j of r) j in o ? a.push(j) : j in t && v.push(j);
        const x = [];
        return (
          a.length > 0 && x.push(O.subscribe(a, n)),
          v.length > 0 && x.push(A.subscribe(v, n)),
          () => {
            for (const j of x) j();
          }
        );
      },
      watch(r, n, a) {
        const v = a?.equalityFn
          ? (j, P) => a.equalityFn(j, P)
          : (j, P) => Object.is(j, P);
        if (r in o) {
          let j = O.get(r);
          return O.subscribe([r], () => {
            const P = O.get(r);
            if (!v(P, j)) {
              const W = j;
              (j = P), n(P, W);
            }
          });
        }
        let x = A.get(r);
        return A.subscribe([r], () => {
          const j = A.get(r);
          if (!v(j, x)) {
            const P = x;
            (x = j), n(j, P);
          }
        });
      },
      when(r, n) {
        return new Promise((a, v) => {
          const x = A.toObject();
          if (r(x)) {
            a();
            return;
          }
          let j,
            P,
            W = () => {
              j?.(), P !== void 0 && clearTimeout(P);
            };
          (j = A.subscribeAll(() => {
            const z = A.toObject();
            r(z) && (W(), a());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (P = setTimeout(() => {
                W(),
                  v(
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
          constraints: _.getAllStates().map((r) => ({
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
        const n = S.previousRequirements.all().find((K) => K.id === r);
        if (!n) return null;
        const a = _.getState(n.fromConstraint),
          v = p.getStatus(r),
          x = {},
          j = A.toObject();
        for (const [K, Y] of Object.entries(j)) x[K] = Y;
        const P = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${a?.priority ?? 0}`,
            `├─ Constraint active: ${a?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${v.state}`,
          ],
          W = Object.entries(n.requirement)
            .filter(([K]) => K !== "type")
            .map(([K, Y]) => `${K}=${JSON.stringify(Y)}`)
            .join(", ");
        W && P.push(`├─ Requirement payload: { ${W} }`);
        const z = Object.entries(x).slice(0, 10);
        return (
          z.length > 0 &&
            (P.push("└─ Relevant facts:"),
            z.forEach(([K, Y], ne) => {
              const te = ne === z.length - 1 ? "   └─" : "   ├─",
                Z = typeof Y == "object" ? JSON.stringify(Y) : String(Y);
              P.push(
                `${te} ${K} = ${Z.slice(0, 50)}${Z.length > 50 ? "..." : ""}`,
              );
            })),
          P.join(`
`)
        );
      },
      async settle(r = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((v) => setTimeout(v, 0));
          const a = this.inspect();
          if (
            a.inflight.length === 0 &&
            !S.isReconciling &&
            !S.reconcileScheduled
          )
            return;
          if (Date.now() - n > r) {
            const v = [];
            a.inflight.length > 0 &&
              v.push(
                `${a.inflight.length} resolvers inflight: ${a.inflight.map((j) => j.resolverId).join(", ")}`,
              ),
              S.isReconciling && v.push("reconciliation in progress"),
              S.reconcileScheduled && v.push("reconcile scheduled");
            const x = S.previousRequirements.all();
            throw (
              (x.length > 0 &&
                v.push(
                  `${x.length} unmet requirements: ${x.map((j) => j.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${r}ms. ${v.join("; ")}`,
              ))
            );
          }
          await new Promise((v) => setTimeout(v, 10));
        }
      },
      getSnapshot() {
        return { facts: A.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: a,
            includeFacts: v,
            ttlSeconds: x,
            metadata: j,
            includeVersion: P,
          } = r,
          W = {},
          z = Object.keys(o),
          K;
        if ((n ? (K = n.filter((te) => z.includes(te))) : (K = z), a)) {
          const te = new Set(a);
          K = K.filter((Z) => !te.has(Z));
        }
        for (const te of K)
          try {
            W[te] = O.get(te);
          } catch {}
        if (v && v.length > 0) {
          const te = A.toObject();
          for (const Z of v) Z in te && (W[Z] = te[Z]);
        }
        const Y = Date.now(),
          ne = { data: W, createdAt: Y };
        return (
          x !== void 0 && x > 0 && (ne.expiresAt = Y + x * 1e3),
          P && (ne.version = Ut(W)),
          j && (ne.metadata = j),
          ne
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: a, excludeDerivations: v } = r,
          x = Object.keys(o),
          j;
        if ((a ? (j = a.filter((W) => x.includes(W))) : (j = x), v)) {
          const W = new Set(v);
          j = j.filter((z) => !W.has(z));
        }
        if (j.length === 0) return () => {};
        let P = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return O.subscribe(j, () => {
          const W = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          W.version !== P && ((P = W.version), n(W));
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
            le.has(n) || A.set(n, a);
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
          b.add(r),
          () => {
            b.delete(r);
          }
        );
      },
      batch(r) {
        A.batch(r);
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
    const n = (a, v) => {
      if (a) {
        for (const x of Object.keys(a))
          if (le.has(x))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${x}" in ${v}.`,
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
      r.derive && (Object.assign(o, r.derive), O.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(i, r.effects), N.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(s, r.constraints), _.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(c, r.resolvers), p.registerDefinitions(r.resolvers)),
      A.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        A.batch(() => {
          r.init(C);
        }),
      r.hooks?.onInit?.(y),
      S.isRunning && (r.hooks?.onStart?.(y), M());
  }
  (y.registerModule = k), d.emitInit(y);
  for (const r of e.modules) r.hooks?.onInit?.(y);
  return y;
}
var ie = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  U = "::";
function or(e) {
  const t = Object.keys(e),
    l = new Set(),
    o = new Set(),
    i = [],
    s = [];
  function c(u) {
    if (l.has(u)) return;
    if (o.has(u)) {
      const f = s.indexOf(u),
        d = [...s.slice(f), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${d}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    o.add(u), s.push(u);
    const g = e[u];
    if (g?.crossModuleDeps)
      for (const f of Object.keys(g.crossModuleDeps)) t.includes(f) && c(f);
    s.pop(), o.delete(u), l.add(u), i.push(u);
  }
  for (const u of t) c(u);
  return i;
}
var nt = new WeakMap(),
  it = new WeakMap(),
  ot = new WeakMap(),
  st = new WeakMap();
function sr(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return ur(e);
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
  return lr(t);
}
function lr(e) {
  const t = e.modules,
    l = new Set(Object.keys(t)),
    o = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    s = e.initOrder ?? "auto";
  if (Array.isArray(s)) {
    const p = s,
      b = Object.keys(t).filter((h) => !p.includes(h));
    if (b.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${b.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = p;
  } else s === "declaration" ? (i = Object.keys(t)) : (i = or(t));
  let c = e.debug,
    u = e.errorBoundary;
  e.zeroConfig &&
    ((c = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (u = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const p of Object.keys(t)) {
    if (p.includes(U))
      throw new Error(
        `[Directive] Module name "${p}" contains the reserved separator "${U}". Module names cannot contain "${U}".`,
      );
    const b = t[p];
    if (b) {
      for (const h of Object.keys(b.schema.facts))
        if (h.includes(U))
          throw new Error(
            `[Directive] Schema key "${h}" in module "${p}" contains the reserved separator "${U}". Schema keys cannot contain "${U}".`,
          );
    }
  }
  const g = [];
  for (const p of i) {
    const b = t[p];
    if (!b) continue;
    const h = b.crossModuleDeps && Object.keys(b.crossModuleDeps).length > 0,
      E = h ? Object.keys(b.crossModuleDeps) : [],
      R = {};
    for (const [y, k] of Object.entries(b.schema.facts)) R[`${p}${U}${y}`] = k;
    const q = {};
    if (b.schema.derivations)
      for (const [y, k] of Object.entries(b.schema.derivations))
        q[`${p}${U}${y}`] = k;
    const m = {};
    if (b.schema.events)
      for (const [y, k] of Object.entries(b.schema.events))
        m[`${p}${U}${y}`] = k;
    const w = b.init
        ? (y) => {
            const k = oe(y, p);
            b.init(k);
          }
        : void 0,
      S = {};
    if (b.derive)
      for (const [y, k] of Object.entries(b.derive))
        S[`${p}${U}${y}`] = (r, n) => {
          const a = h ? ae(r, p, E) : oe(r, p),
            v = Fe(n, p);
          return k(a, v);
        };
    const M = {};
    if (b.events)
      for (const [y, k] of Object.entries(b.events))
        M[`${p}${U}${y}`] = (r, n) => {
          const a = oe(r, p);
          k(a, n);
        };
    const F = {};
    if (b.constraints)
      for (const [y, k] of Object.entries(b.constraints)) {
        const r = k;
        F[`${p}${U}${y}`] = {
          ...r,
          deps: r.deps?.map((n) => `${p}${U}${n}`),
          when: (n) => {
            const a = h ? ae(n, p, E) : oe(n, p);
            return r.when(a);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const a = h ? ae(n, p, E) : oe(n, p);
                  return r.require(a);
                }
              : r.require,
        };
      }
    const H = {};
    if (b.resolvers)
      for (const [y, k] of Object.entries(b.resolvers)) {
        const r = k;
        H[`${p}${U}${y}`] = {
          ...r,
          resolve: async (n, a) => {
            const v = Me(a.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: v[p], signal: a.signal });
          },
        };
      }
    const L = {};
    if (b.effects)
      for (const [y, k] of Object.entries(b.effects)) {
        const r = k;
        L[`${p}${U}${y}`] = {
          ...r,
          run: (n, a) => {
            const v = h ? ae(n, p, E) : oe(n, p),
              x = a ? (h ? ae(a, p, E) : oe(a, p)) : void 0;
            return r.run(v, x);
          },
          deps: r.deps?.map((n) => `${p}${U}${n}`),
        };
      }
    g.push({
      id: b.id,
      schema: {
        facts: R,
        derivations: q,
        events: m,
        requirements: b.schema.requirements ?? {},
      },
      init: w,
      derive: S,
      events: M,
      effects: L,
      constraints: F,
      resolvers: H,
      hooks: b.hooks,
      snapshotEvents:
        o && !o.has(p) ? [] : b.snapshotEvents?.map((y) => `${p}${U}${y}`),
    });
  }
  let f = null,
    d = null;
  function $(p) {
    for (const [b, h] of Object.entries(p))
      if (!ie.has(b) && l.has(b)) {
        if (h && typeof h == "object" && !we(h))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${b}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [E, R] of Object.entries(h))
          ie.has(E) || (d.facts[`${b}${U}${E}`] = R);
      }
  }
  d = xt({
    modules: g.map((p) => ({
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
    debug: c,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && $(e.initialFacts), f && ($(f), (f = null));
    },
  });
  const T = new Map();
  for (const p of Object.keys(t)) {
    const b = t[p];
    if (!b) continue;
    const h = [];
    for (const E of Object.keys(b.schema.facts)) h.push(`${p}${U}${E}`);
    if (b.schema.derivations)
      for (const E of Object.keys(b.schema.derivations)) h.push(`${p}${U}${E}`);
    T.set(p, h);
  }
  const I = { names: null };
  function D() {
    return I.names === null && (I.names = Object.keys(t)), I.names;
  }
  let A = Me(d.facts, t, D),
    C = ar(d.derive, t, D),
    O = cr(d, t, D),
    N = null,
    _ = e.tickMs;
  return {
    _mode: "namespaced",
    facts: A,
    debug: d.debug,
    derive: C,
    events: O,
    constraints: d.constraints,
    effects: d.effects,
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
    async hydrate(p) {
      if (d.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const b = await p();
      b && typeof b == "object" && (f = b);
    },
    initialize() {
      d.initialize();
    },
    start() {
      if ((d.start(), _ && _ > 0)) {
        const p = Object.keys(g[0]?.events ?? {}).find((b) =>
          b.endsWith(`${U}tick`),
        );
        p &&
          (N = setInterval(() => {
            d.dispatch({ type: p });
          }, _));
      }
    },
    stop() {
      N && (clearInterval(N), (N = null)), d.stop();
    },
    destroy() {
      this.stop(), d.destroy();
    },
    dispatch(p) {
      d.dispatch(p);
    },
    batch: d.batch.bind(d),
    read(p) {
      return d.read(ce(p));
    },
    subscribe(p, b) {
      const h = [];
      for (const E of p)
        if (E.endsWith(".*")) {
          const R = E.slice(0, -2),
            q = T.get(R);
          q && h.push(...q);
        } else h.push(ce(E));
      return d.subscribe(h, b);
    },
    subscribeModule(p, b) {
      const h = T.get(p);
      return !h || h.length === 0 ? () => {} : d.subscribe(h, b);
    },
    watch(p, b, h) {
      return d.watch(ce(p), b, h);
    },
    when(p, b) {
      return d.when(() => p(A), b);
    },
    onSettledChange: d.onSettledChange.bind(d),
    onTimeTravelChange: d.onTimeTravelChange.bind(d),
    inspect: d.inspect.bind(d),
    settle: d.settle.bind(d),
    explain: d.explain.bind(d),
    getSnapshot: d.getSnapshot.bind(d),
    restore: d.restore.bind(d),
    getDistributableSnapshot(p) {
      const b = {
          ...p,
          includeDerivations: p?.includeDerivations?.map(ce),
          excludeDerivations: p?.excludeDerivations?.map(ce),
          includeFacts: p?.includeFacts?.map(ce),
        },
        h = d.getDistributableSnapshot(b),
        E = {};
      for (const [R, q] of Object.entries(h.data)) {
        const m = R.indexOf(U);
        if (m > 0) {
          const w = R.slice(0, m),
            S = R.slice(m + U.length);
          E[w] || (E[w] = {}), (E[w][S] = q);
        } else E._root || (E._root = {}), (E._root[R] = q);
      }
      return { ...h, data: E };
    },
    watchDistributableSnapshot(p, b) {
      const h = {
        ...p,
        includeDerivations: p?.includeDerivations?.map(ce),
        excludeDerivations: p?.excludeDerivations?.map(ce),
        includeFacts: p?.includeFacts?.map(ce),
      };
      return d.watchDistributableSnapshot(h, (E) => {
        const R = {};
        for (const [q, m] of Object.entries(E.data)) {
          const w = q.indexOf(U);
          if (w > 0) {
            const S = q.slice(0, w),
              M = q.slice(w + U.length);
            R[S] || (R[S] = {}), (R[S][M] = m);
          } else R._root || (R._root = {}), (R._root[q] = m);
        }
        b({ ...E, data: R });
      });
    },
    registerModule(p, b) {
      if (l.has(p))
        throw new Error(
          `[Directive] Module namespace "${p}" already exists. Cannot register a duplicate namespace.`,
        );
      if (p.includes(U))
        throw new Error(
          `[Directive] Module name "${p}" contains the reserved separator "${U}".`,
        );
      if (ie.has(p))
        throw new Error(
          `[Directive] Module name "${p}" is a blocked property.`,
        );
      for (const y of Object.keys(b.schema.facts))
        if (y.includes(U))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${p}" contains the reserved separator "${U}".`,
          );
      const h = b,
        E = h.crossModuleDeps && Object.keys(h.crossModuleDeps).length > 0,
        R = E ? Object.keys(h.crossModuleDeps) : [],
        q = {};
      for (const [y, k] of Object.entries(h.schema.facts))
        q[`${p}${U}${y}`] = k;
      const m = h.init
          ? (y) => {
              const k = oe(y, p);
              h.init(k);
            }
          : void 0,
        w = {};
      if (h.derive)
        for (const [y, k] of Object.entries(h.derive))
          w[`${p}${U}${y}`] = (r, n) => {
            const a = E ? ae(r, p, R) : oe(r, p),
              v = Fe(n, p);
            return k(a, v);
          };
      const S = {};
      if (h.events)
        for (const [y, k] of Object.entries(h.events))
          S[`${p}${U}${y}`] = (r, n) => {
            const a = oe(r, p);
            k(a, n);
          };
      const M = {};
      if (h.constraints)
        for (const [y, k] of Object.entries(h.constraints)) {
          const r = k;
          M[`${p}${U}${y}`] = {
            ...r,
            deps: r.deps?.map((n) => `${p}${U}${n}`),
            when: (n) => {
              const a = E ? ae(n, p, R) : oe(n, p);
              return r.when(a);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const a = E ? ae(n, p, R) : oe(n, p);
                    return r.require(a);
                  }
                : r.require,
          };
        }
      const F = {};
      if (h.resolvers)
        for (const [y, k] of Object.entries(h.resolvers)) {
          const r = k;
          F[`${p}${U}${y}`] = {
            ...r,
            resolve: async (n, a) => {
              const v = Me(a.facts, t, D);
              await r.resolve(n, { facts: v[p], signal: a.signal });
            },
          };
        }
      const H = {};
      if (h.effects)
        for (const [y, k] of Object.entries(h.effects)) {
          const r = k;
          H[`${p}${U}${y}`] = {
            ...r,
            run: (n, a) => {
              const v = E ? ae(n, p, R) : oe(n, p),
                x = a ? (E ? ae(a, p, R) : oe(a, p)) : void 0;
              return r.run(v, x);
            },
            deps: r.deps?.map((n) => `${p}${U}${n}`),
          };
        }
      l.add(p), (t[p] = h), (I.names = null);
      const L = [];
      for (const y of Object.keys(h.schema.facts)) L.push(`${p}${U}${y}`);
      if (h.schema.derivations)
        for (const y of Object.keys(h.schema.derivations))
          L.push(`${p}${U}${y}`);
      T.set(p, L),
        d.registerModule({
          id: h.id,
          schema: q,
          requirements: h.schema.requirements ?? {},
          init: m,
          derive: Object.keys(w).length > 0 ? w : void 0,
          events: Object.keys(S).length > 0 ? S : void 0,
          effects: Object.keys(H).length > 0 ? H : void 0,
          constraints: Object.keys(M).length > 0 ? M : void 0,
          resolvers: Object.keys(F).length > 0 ? F : void 0,
          hooks: h.hooks,
          snapshotEvents:
            o && !o.has(p) ? [] : h.snapshotEvents?.map((y) => `${p}${U}${y}`),
        });
    },
  };
}
function ce(e) {
  if (e.includes(".")) {
    const [t, ...l] = e.split(".");
    return `${t}${U}${l.join(U)}`;
  }
  return e;
}
function oe(e, t) {
  let l = nt.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), nt.set(e, l);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ie.has(s))
          return s === "$store" || s === "$snapshot" ? e[s] : e[`${t}${U}${s}`];
      },
      set(i, s, c) {
        return typeof s == "symbol" || ie.has(s)
          ? !1
          : ((e[`${t}${U}${s}`] = c), !0);
      },
      has(i, s) {
        return typeof s == "symbol" || ie.has(s) ? !1 : `${t}${U}${s}` in e;
      },
      deleteProperty(i, s) {
        return typeof s == "symbol" || ie.has(s)
          ? !1
          : (delete e[`${t}${U}${s}`], !0);
      },
    },
  );
  return l.set(t, o), o;
}
function Me(e, t, l) {
  const o = it.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, c) {
        if (typeof c != "symbol" && !ie.has(c) && Object.hasOwn(t, c))
          return oe(e, c);
      },
      has(s, c) {
        return typeof c == "symbol" || ie.has(c) ? !1 : Object.hasOwn(t, c);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, c) {
        if (typeof c != "symbol" && Object.hasOwn(t, c))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return it.set(e, i), i;
}
var lt = new WeakMap();
function ae(e, t, l) {
  let o = `${t}:${JSON.stringify([...l].sort())}`,
    i = lt.get(e);
  if (i) {
    const g = i.get(o);
    if (g) return g;
  } else (i = new Map()), lt.set(e, i);
  const s = new Set(l),
    c = ["self", ...l],
    u = new Proxy(
      {},
      {
        get(g, f) {
          if (typeof f != "symbol" && !ie.has(f)) {
            if (f === "self") return oe(e, t);
            if (s.has(f)) return oe(e, f);
          }
        },
        has(g, f) {
          return typeof f == "symbol" || ie.has(f)
            ? !1
            : f === "self" || s.has(f);
        },
        ownKeys() {
          return c;
        },
        getOwnPropertyDescriptor(g, f) {
          if (typeof f != "symbol" && (f === "self" || s.has(f)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(o, u), u;
}
function Fe(e, t) {
  let l = st.get(e);
  if (l) {
    const i = l.get(t);
    if (i) return i;
  } else (l = new Map()), st.set(e, l);
  const o = new Proxy(
    {},
    {
      get(i, s) {
        if (typeof s != "symbol" && !ie.has(s)) return e[`${t}${U}${s}`];
      },
      has(i, s) {
        return typeof s == "symbol" || ie.has(s) ? !1 : `${t}${U}${s}` in e;
      },
    },
  );
  return l.set(t, o), o;
}
function ar(e, t, l) {
  const o = ot.get(e);
  if (o) return o;
  const i = new Proxy(
    {},
    {
      get(s, c) {
        if (typeof c != "symbol" && !ie.has(c) && Object.hasOwn(t, c))
          return Fe(e, c);
      },
      has(s, c) {
        return typeof c == "symbol" || ie.has(c) ? !1 : Object.hasOwn(t, c);
      },
      ownKeys() {
        return l();
      },
      getOwnPropertyDescriptor(s, c) {
        if (typeof c != "symbol" && Object.hasOwn(t, c))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return ot.set(e, i), i;
}
var at = new WeakMap();
function cr(e, t, l) {
  let o = at.get(e);
  return (
    o || ((o = new Map()), at.set(e, o)),
    new Proxy(
      {},
      {
        get(i, s) {
          if (typeof s == "symbol" || ie.has(s) || !Object.hasOwn(t, s)) return;
          const c = o.get(s);
          if (c) return c;
          const u = new Proxy(
            {},
            {
              get(g, f) {
                if (typeof f != "symbol" && !ie.has(f))
                  return (d) => {
                    e.dispatch({ type: `${s}${U}${f}`, ...d });
                  };
              },
            },
          );
          return o.set(s, u), u;
        },
        has(i, s) {
          return typeof s == "symbol" || ie.has(s) ? !1 : Object.hasOwn(t, s);
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
function ur(e) {
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
  s = xt({
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
        for (const [f, d] of Object.entries(e.initialFacts))
          ie.has(f) || (s.facts[f] = d);
      if (i) {
        for (const [f, d] of Object.entries(i)) ie.has(f) || (s.facts[f] = d);
        i = null;
      }
    },
  });
  let c = new Proxy(
      {},
      {
        get(f, d) {
          if (typeof d != "symbol" && !ie.has(d))
            return ($) => {
              s.dispatch({ type: d, ...$ });
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
    events: c,
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
      const d = await f();
      d && typeof d == "object" && (i = d);
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
    dispatch(f) {
      s.dispatch(f);
    },
    batch: s.batch.bind(s),
    read(f) {
      return s.read(f);
    },
    subscribe(f, d) {
      return s.subscribe(f, d);
    },
    watch(f, d, $) {
      return s.watch(f, d, $);
    },
    when(f, d) {
      return s.when(f, d);
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
function ke(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function dr(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function fr(e) {
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
function mr() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var pr = 200,
  De = 340,
  ve = 16,
  ye = 80,
  ct = 2,
  ut = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function gr() {
  return { entries: new Et(pr), inflight: new Map() };
}
function hr() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var vr = 1e4,
  yr = 100;
function br() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var wr = 50,
  dt = 200,
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
  ee = {
    nodeW: 90,
    nodeH: 16,
    nodeGap: 6,
    startY: 16,
    colGap: 20,
    fontSize: 10,
    labelMaxChars: 11,
  };
function Sr(e, t, l, o) {
  let i = !1,
    s = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    c = document.createElement("style");
  (c.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${B.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${B.accent};outline-offset:2px}`),
    document.head.appendChild(c);
  const u = document.createElement("button");
  u.setAttribute("aria-label", "Open Directive DevTools"),
    u.setAttribute("aria-expanded", String(l)),
    (u.title = "Ctrl+Shift+D to toggle"),
    Object.assign(u.style, {
      ...s,
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
      display: l ? "block" : "none",
    });
  const f = document.createElement("div");
  Object.assign(f.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px",
  });
  const d = document.createElement("strong");
  (d.style.color = B.accent),
    (d.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const $ = document.createElement("button");
  $.setAttribute("aria-label", "Close DevTools"),
    Object.assign($.style, {
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
    ($.textContent = "×"),
    f.appendChild(d),
    f.appendChild($),
    g.appendChild(f);
  const T = document.createElement("div");
  (T.style.marginBottom = "6px"), T.setAttribute("aria-live", "polite");
  const I = document.createElement("span");
  (I.style.color = B.green),
    (I.textContent = "Settled"),
    T.appendChild(I),
    g.appendChild(T);
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
    (A.textContent = "◀ Undo"),
    (A.disabled = !0);
  const C = document.createElement("button");
  Object.assign(C.style, {
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
    (C.textContent = "Redo ▶"),
    (C.disabled = !0);
  const O = document.createElement("span");
  (O.style.color = B.muted),
    (O.style.fontSize = "10px"),
    D.appendChild(A),
    D.appendChild(C),
    D.appendChild(O),
    g.appendChild(D);
  function N(V, J) {
    const Q = document.createElement("details");
    J && (Q.open = !0), (Q.style.marginBottom = "4px");
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: B.accent,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (se.textContent = `${V} (`),
      se.appendChild(de),
      se.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      Q.appendChild(se);
    const ue = document.createElement("table");
    Object.assign(ue.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Je = document.createElement("thead"),
      Ye = document.createElement("tr");
    for (const Bt of ["Key", "Value"]) {
      const Se = document.createElement("th");
      (Se.scope = "col"),
        Object.assign(Se.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: B.accent,
        }),
        (Se.textContent = Bt),
        Ye.appendChild(Se);
    }
    Je.appendChild(Ye), ue.appendChild(Je);
    const Xe = document.createElement("tbody");
    return (
      ue.appendChild(Xe),
      Q.appendChild(ue),
      { details: Q, tbody: Xe, countSpan: de }
    );
  }
  function _(V, J) {
    const Q = document.createElement("details");
    Q.style.marginBottom = "4px";
    const se = document.createElement("summary");
    Object.assign(se.style, {
      cursor: "pointer",
      color: J,
      marginBottom: "4px",
    });
    const de = document.createElement("span");
    (se.textContent = `${V} (`),
      se.appendChild(de),
      se.appendChild(document.createTextNode(")")),
      (de.textContent = "0"),
      Q.appendChild(se);
    const ue = document.createElement("ul");
    return (
      Object.assign(ue.style, { margin: "0", paddingLeft: "16px" }),
      Q.appendChild(ue),
      { details: Q, list: ue, countSpan: de }
    );
  }
  const p = N("Facts", !0);
  g.appendChild(p.details);
  const b = N("Derivations", !1);
  g.appendChild(b.details);
  const h = _("Inflight", B.yellow);
  g.appendChild(h.details);
  const E = _("Unmet", B.red);
  g.appendChild(E.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const q = document.createElement("summary");
  Object.assign(q.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (q.textContent = "Performance"),
    R.appendChild(q);
  const m = document.createElement("div");
  (m.style.fontSize = "10px"),
    (m.style.color = B.muted),
    (m.textContent = "No data yet"),
    R.appendChild(m),
    g.appendChild(R);
  const w = document.createElement("details");
  w.style.marginBottom = "4px";
  const S = document.createElement("summary");
  Object.assign(S.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (S.textContent = "Dependency Graph"),
    w.appendChild(S);
  const M = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  M.setAttribute("width", "100%"),
    M.setAttribute("height", "120"),
    M.setAttribute("role", "img"),
    M.setAttribute("aria-label", "System dependency graph"),
    (M.style.display = "block"),
    M.setAttribute("viewBox", "0 0 460 120"),
    M.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    w.appendChild(M),
    g.appendChild(w);
  const F = document.createElement("details");
  F.style.marginBottom = "4px";
  const H = document.createElement("summary");
  Object.assign(H.style, {
    cursor: "pointer",
    color: B.accent,
    marginBottom: "4px",
  }),
    (H.textContent = "Timeline"),
    F.appendChild(H);
  const L = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  L.setAttribute("width", "100%"),
    L.setAttribute("height", "60"),
    L.setAttribute("role", "img"),
    L.setAttribute("aria-label", "Resolver execution timeline"),
    (L.style.display = "block"),
    L.setAttribute("viewBox", `0 0 ${De} 60`),
    L.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(De / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", B.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", B.font),
    (y.textContent = "No resolver activity yet"),
    L.appendChild(y),
    F.appendChild(L),
    g.appendChild(F);
  let k, r, n, a;
  if (o) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
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
    const Q = document.createElement("div");
    (Q.style.color = B.muted),
      (Q.style.padding = "4px"),
      (Q.textContent = "Waiting for events..."),
      (Q.className = "dt-events-empty"),
      r.appendChild(Q),
      V.appendChild(r),
      g.appendChild(V),
      (k = V),
      (a = document.createElement("div"));
  } else
    (k = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (a = document.createElement("div")),
      (a.style.fontSize = "10px"),
      (a.style.color = B.muted),
      (a.style.marginTop = "4px"),
      (a.style.fontStyle = "italic"),
      (a.textContent = "Enable trace: true for event log"),
      g.appendChild(a);
  const v = document.createElement("div");
  Object.assign(v.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const x = document.createElement("button");
  Object.assign(x.style, {
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
    (x.textContent = "⏺ Record");
  const j = document.createElement("button");
  Object.assign(j.style, {
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
    (j.textContent = "⤓ Export"),
    v.appendChild(x),
    v.appendChild(j),
    g.appendChild(v),
    g.addEventListener(
      "wheel",
      (V) => {
        const J = g,
          Q = J.scrollTop === 0 && V.deltaY < 0,
          se = J.scrollTop + J.clientHeight >= J.scrollHeight && V.deltaY > 0;
        (Q || se) && V.preventDefault();
      },
      { passive: !1 },
    );
  let P = l,
    W = new Set();
  function z() {
    (P = !0),
      (g.style.display = "block"),
      (u.style.display = "none"),
      u.setAttribute("aria-expanded", "true"),
      $.focus();
  }
  function K() {
    (P = !1),
      (g.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", z), $.addEventListener("click", K);
  function Y(V) {
    V.key === "Escape" && P && K();
  }
  g.addEventListener("keydown", Y);
  function ne(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), P ? K() : z());
  }
  document.addEventListener("keydown", ne);
  function te() {
    i || (document.body.appendChild(u), document.body.appendChild(g));
  }
  document.body
    ? te()
    : document.addEventListener("DOMContentLoaded", te, { once: !0 });
  function Z() {
    (i = !0),
      u.removeEventListener("click", z),
      $.removeEventListener("click", K),
      g.removeEventListener("keydown", Y),
      document.removeEventListener("keydown", ne),
      document.removeEventListener("DOMContentLoaded", te);
    for (const V of W) clearTimeout(V);
    W.clear(), u.remove(), g.remove(), c.remove();
  }
  return {
    refs: {
      container: g,
      toggleBtn: u,
      titleEl: d,
      statusEl: I,
      factsBody: p.tbody,
      factsCount: p.countSpan,
      derivBody: b.tbody,
      derivCount: b.countSpan,
      derivSection: b.details,
      inflightList: h.list,
      inflightSection: h.details,
      inflightCount: h.countSpan,
      unmetList: E.list,
      unmetSection: E.details,
      unmetCount: E.countSpan,
      perfSection: R,
      perfBody: m,
      timeTravelSection: D,
      timeTravelLabel: O,
      undoBtn: A,
      redoBtn: C,
      flowSection: w,
      flowSvg: M,
      timelineSection: F,
      timelineSvg: L,
      eventsSection: k,
      eventsList: r,
      eventsCount: n,
      traceHint: a,
      recordBtn: x,
      exportBtn: j,
    },
    destroy: Z,
    isOpen: () => P,
    flashTimers: W,
  };
}
function Re(e, t, l, o, i, s) {
  let c = $t(o),
    u = e.get(l);
  if (u) {
    const g = u.cells;
    if (g[1] && ((g[1].textContent = c), i && s)) {
      const f = g[1];
      f.style.background = "rgba(139, 154, 255, 0.25)";
      const d = setTimeout(() => {
        (f.style.background = ""), s.delete(d);
      }, 300);
      s.add(d);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${B.rowBorder}`);
    const g = document.createElement("td");
    Object.assign(g.style, { padding: "2px 4px", color: B.muted }),
      (g.textContent = l);
    const f = document.createElement("td");
    (f.style.padding = "2px 4px"),
      (f.textContent = c),
      u.appendChild(g),
      u.appendChild(f),
      t.appendChild(u),
      e.set(l, u);
  }
}
function xr(e, t) {
  const l = e.get(t);
  l && (l.remove(), e.delete(t));
}
function _e(e, t, l) {
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
      (o.style.color = B.muted),
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
      (o.style.color = B.muted),
      (o.textContent = "None"),
      e.unmetList.appendChild(o);
  }
}
function qe(e, t, l) {
  const o = t === 0 && l === 0;
  (e.statusEl.style.color = o ? B.green : B.yellow),
    (e.statusEl.textContent = o ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = o ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${o ? "" : " (system working)"}`,
    );
}
function ft(e, t, l, o) {
  const i = Object.keys(l.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const c = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = B.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      c.appendChild(u),
      e.derivBody.appendChild(c);
    return;
  }
  const s = new Set(i);
  for (const [c, u] of t) s.has(c) || (u.remove(), t.delete(c));
  for (const c of i) {
    let u;
    try {
      u = $t(l.read(c));
    } catch {
      u = "<error>";
    }
    Re(t, e.derivBody, c, u, !0, o);
  }
}
function Er(e, t, l, o) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const s = document.createElement("div");
  Object.assign(s.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${B.rowBorder}`,
    fontFamily: "inherit",
  });
  let c = new Date(),
    u = `${String(c.getHours()).padStart(2, "0")}:${String(c.getMinutes()).padStart(2, "0")}:${String(c.getSeconds()).padStart(2, "0")}.${String(c.getMilliseconds()).padStart(3, "0")}`,
    g;
  try {
    const T = JSON.stringify(l);
    g = fe(T, 60);
  } catch {
    g = "{}";
  }
  const f = document.createElement("span");
  (f.style.color = B.closeBtn), (f.textContent = u);
  const d = document.createElement("span");
  (d.style.color = B.accent), (d.textContent = ` ${t} `);
  const $ = document.createElement("span");
  for (
    $.style.color = B.muted,
      $.textContent = g,
      s.appendChild(f),
      s.appendChild(d),
      s.appendChild($),
      e.eventsList.prepend(s);
    e.eventsList.childElementCount > wr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(o);
}
function $r(e, t) {
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
      (i.style.color = B.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const s = [...t.resolverStats.entries()].sort(
      (c, u) => u[1].totalMs - c[1].totalMs,
    );
    for (const [c, u] of s) {
      const g = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        f = document.createElement("div");
      (f.style.paddingLeft = "8px"),
        (f.textContent = `${c}: ${u.count}x, avg ${g}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (f.style.color = B.red),
        e.perfBody.appendChild(f);
    }
  }
}
function mt(e, t) {
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
    c = o < i - 1;
  (e.undoBtn.disabled = !s),
    (e.undoBtn.style.opacity = s ? "1" : "0.4"),
    (e.redoBtn.disabled = !c),
    (e.redoBtn.style.opacity = c ? "1" : "0.4");
}
function Cr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Be = new WeakMap();
function kr(e, t, l, o, i, s) {
  return [
    e.join(","),
    t.join(","),
    l.map((c) => `${c.id}:${c.active}`).join(","),
    [...o.entries()].map(([c, u]) => `${c}:${u.status}:${u.type}`).join(","),
    i.join(","),
    s.join(","),
  ].join("|");
}
function Rr(e, t, l, o, i) {
  for (const s of l) {
    const c = e.nodes.get(`0:${s}`);
    if (!c) continue;
    const u = t.recentlyChangedFacts.has(s);
    c.rect.setAttribute("fill", u ? B.text + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of o) {
    const c = e.nodes.get(`1:${s}`);
    if (!c) continue;
    const u = t.recentlyComputedDerivations.has(s);
    c.rect.setAttribute("fill", u ? B.accent + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const s of i) {
    const c = e.nodes.get(`2:${s}`);
    if (!c) continue;
    const u = t.recentlyActiveConstraints.has(s),
      g = c.rect.getAttribute("stroke") ?? B.muted;
    c.rect.setAttribute("fill", u ? g + "33" : "none"),
      c.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function pt(e, t, l) {
  const o = ke(t);
  if (!o) return;
  let i;
  try {
    i = Object.keys(t.facts.$store.toObject());
  } catch {
    i = [];
  }
  const s = Object.keys(t.derive),
    c = o.constraints,
    u = o.unmet,
    g = o.inflight,
    f = Object.keys(o.resolvers),
    d = new Map();
  for (const y of u)
    d.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of g)
    d.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && s.length === 0 && c.length === 0 && f.length === 0) {
    Be.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
    y.setAttribute("x", "230"),
      y.setAttribute("y", "24"),
      y.setAttribute("text-anchor", "middle"),
      y.setAttribute("fill", B.muted),
      y.setAttribute("font-size", "10"),
      y.setAttribute("font-family", B.font),
      (y.textContent = "No system topology"),
      e.flowSvg.appendChild(y);
    return;
  }
  const $ = g.map((y) => y.resolverId).sort(),
    T = kr(i, s, c, d, f, $),
    I = Be.get(e.flowSvg);
  if (I && I.fingerprint === T) {
    Rr(
      I,
      l,
      i,
      s,
      c.map((y) => y.id),
    );
    return;
  }
  const D = ee.nodeW + ee.colGap,
    A = [5, 5 + D, 5 + D * 2, 5 + D * 3, 5 + D * 4],
    C = A[4] + ee.nodeW + 5;
  function O(y) {
    let k = ee.startY + 12;
    return y.map((r) => {
      const n = { ...r, y: k };
      return (k += ee.nodeH + ee.nodeGap), n;
    });
  }
  const N = O(i.map((y) => ({ id: y, label: fe(y, ee.labelMaxChars) }))),
    _ = O(s.map((y) => ({ id: y, label: fe(y, ee.labelMaxChars) }))),
    p = O(
      c.map((y) => ({
        id: y.id,
        label: fe(y.id, ee.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    b = O(
      [...d.entries()].map(([y, k]) => ({
        id: y,
        type: k.type,
        fromConstraint: k.fromConstraint,
        status: k.status,
      })),
    ),
    h = O(f.map((y) => ({ id: y, label: fe(y, ee.labelMaxChars) }))),
    E = Math.max(N.length, _.length, p.length, b.length, h.length, 1),
    R = ee.startY + 12 + E * (ee.nodeH + ee.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${C} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${s.length} derivations, ${c.length} constraints, ${d.size} requirements, ${f.length} resolvers`,
    );
  const q = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, k] of q.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(A[y] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", B.accent),
      r.setAttribute("font-size", String(ee.fontSize)),
      r.setAttribute("font-family", B.font),
      (r.textContent = k),
      e.flowSvg.appendChild(r);
  }
  const m = { fingerprint: T, nodes: new Map() };
  function w(y, k, r, n, a, v, x, j) {
    const P = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(k)),
      W.setAttribute("y", String(r - 6)),
      W.setAttribute("width", String(ee.nodeW)),
      W.setAttribute("height", String(ee.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", j ? v + "33" : "none"),
      W.setAttribute("stroke", v),
      W.setAttribute("stroke-width", j ? "2" : "1"),
      W.setAttribute("opacity", x ? "0.35" : "1"),
      P.appendChild(W);
    const z = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      z.setAttribute("x", String(k + 4)),
      z.setAttribute("y", String(r + 4)),
      z.setAttribute("fill", v),
      z.setAttribute("font-size", String(ee.fontSize)),
      z.setAttribute("font-family", B.font),
      z.setAttribute("opacity", x ? "0.35" : "1"),
      (z.textContent = a),
      P.appendChild(z),
      e.flowSvg.appendChild(P),
      m.nodes.set(`${y}:${n}`, { g: P, rect: W, text: z }),
      { midX: k + ee.nodeW / 2, midY: r }
    );
  }
  function S(y, k, r, n, a, v) {
    const x = document.createElementNS("http://www.w3.org/2000/svg", "line");
    x.setAttribute("x1", String(y)),
      x.setAttribute("y1", String(k)),
      x.setAttribute("x2", String(r)),
      x.setAttribute("y2", String(n)),
      x.setAttribute("stroke", a),
      x.setAttribute("stroke-width", "1"),
      x.setAttribute("stroke-dasharray", "3,2"),
      x.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(x);
  }
  const M = new Map(),
    F = new Map(),
    H = new Map(),
    L = new Map();
  for (const y of N) {
    const k = l.recentlyChangedFacts.has(y.id),
      r = w(0, A[0], y.y, y.id, y.label, B.text, !1, k);
    M.set(y.id, r);
  }
  for (const y of _) {
    const k = l.recentlyComputedDerivations.has(y.id),
      r = w(1, A[1], y.y, y.id, y.label, B.accent, !1, k);
    F.set(y.id, r);
  }
  for (const y of p) {
    const k = l.recentlyActiveConstraints.has(y.id),
      r = w(
        2,
        A[2],
        y.y,
        y.id,
        y.label,
        y.active ? B.yellow : B.muted,
        !y.active,
        k,
      );
    H.set(y.id, r);
  }
  for (const y of b) {
    const k = y.status === "unmet" ? B.red : B.yellow,
      r = w(3, A[3], y.y, y.id, fe(y.type, ee.labelMaxChars), k, !1, !1);
    L.set(y.id, r);
  }
  for (const y of h) {
    const k = g.some((r) => r.resolverId === y.id);
    w(4, A[4], y.y, y.id, y.label, k ? B.green : B.muted, !k, !1);
  }
  for (const y of _) {
    const k = l.derivationDeps.get(y.id),
      r = F.get(y.id);
    if (k && r)
      for (const n of k) {
        const a = M.get(n);
        a &&
          S(
            a.midX + ee.nodeW / 2,
            a.midY,
            r.midX - ee.nodeW / 2,
            r.midY,
            B.accent,
          );
      }
  }
  for (const y of b) {
    const k = H.get(y.fromConstraint),
      r = L.get(y.id);
    k &&
      r &&
      S(k.midX + ee.nodeW / 2, k.midY, r.midX - ee.nodeW / 2, r.midY, B.muted);
  }
  for (const y of g) {
    const k = L.get(y.id);
    if (k) {
      const r = h.find((n) => n.id === y.resolverId);
      r && S(k.midX + ee.nodeW / 2, k.midY, A[4], r.y, B.green);
    }
  }
  Be.set(e.flowSvg, m);
}
function Or(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function Ar(e, t) {
  const l = t.entries.toArray();
  if (l.length === 0) return;
  e.timelineSvg.replaceChildren();
  let o = 1 / 0,
    i = -1 / 0;
  for (const I of l)
    I.startMs < o && (o = I.startMs), I.endMs > i && (i = I.endMs);
  const s = performance.now();
  for (const I of t.inflight.values()) I < o && (o = I), s > i && (i = s);
  const c = i - o || 1,
    u = De - ye - 10,
    g = [],
    f = new Set();
  for (const I of l)
    f.has(I.resolver) || (f.add(I.resolver), g.push(I.resolver));
  for (const I of t.inflight.keys()) f.has(I) || (f.add(I), g.push(I));
  const d = g.slice(-12),
    $ = ve * d.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${De} ${$}`),
    e.timelineSvg.setAttribute("height", String(Math.min($, 200)));
  const T = 5;
  for (let I = 0; I <= T; I++) {
    const D = ye + (u * I) / T,
      A = (c * I) / T,
      C = document.createElementNS("http://www.w3.org/2000/svg", "text");
    C.setAttribute("x", String(D)),
      C.setAttribute("y", "8"),
      C.setAttribute("fill", B.muted),
      C.setAttribute("font-size", "6"),
      C.setAttribute("font-family", B.font),
      C.setAttribute("text-anchor", "middle"),
      (C.textContent =
        A < 1e3 ? `${A.toFixed(0)}ms` : `${(A / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(C);
    const O = document.createElementNS("http://www.w3.org/2000/svg", "line");
    O.setAttribute("x1", String(D)),
      O.setAttribute("y1", "10"),
      O.setAttribute("x2", String(D)),
      O.setAttribute("y2", String($)),
      O.setAttribute("stroke", B.border),
      O.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(O);
  }
  for (let I = 0; I < d.length; I++) {
    const D = d[I],
      A = 12 + I * ve,
      C = I % ut.length,
      O = ut[C],
      N = document.createElementNS("http://www.w3.org/2000/svg", "text");
    N.setAttribute("x", String(ye - 4)),
      N.setAttribute("y", String(A + ve / 2 + 3)),
      N.setAttribute("fill", B.muted),
      N.setAttribute("font-size", "7"),
      N.setAttribute("font-family", B.font),
      N.setAttribute("text-anchor", "end"),
      (N.textContent = fe(D, 12)),
      e.timelineSvg.appendChild(N);
    const _ = l.filter((b) => b.resolver === D);
    for (const b of _) {
      const h = ye + ((b.startMs - o) / c) * u,
        E = Math.max(((b.endMs - b.startMs) / c) * u, ct),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(h)),
        R.setAttribute("y", String(A + 2)),
        R.setAttribute("width", String(E)),
        R.setAttribute("height", String(ve - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", b.error ? B.red : O),
        R.setAttribute("opacity", "0.8");
      const q = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        m = b.endMs - b.startMs;
      (q.textContent = `${D}: ${m.toFixed(1)}ms${b.error ? " (error)" : ""}`),
        R.appendChild(q),
        e.timelineSvg.appendChild(R);
    }
    const p = t.inflight.get(D);
    if (p !== void 0) {
      const b = ye + ((p - o) / c) * u,
        h = Math.max(((s - p) / c) * u, ct),
        E = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      E.setAttribute("x", String(b)),
        E.setAttribute("y", String(A + 2)),
        E.setAttribute("width", String(h)),
        E.setAttribute("height", String(ve - 4)),
        E.setAttribute("rx", "2"),
        E.setAttribute("fill", O),
        E.setAttribute("opacity", "0.4"),
        E.setAttribute("stroke", O),
        E.setAttribute("stroke-width", "1"),
        E.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${D}: inflight ${(s - p).toFixed(0)}ms`),
        E.appendChild(R),
        e.timelineSvg.appendChild(E);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${l.length} resolver executions across ${d.length} resolvers`,
  );
}
function Ir() {
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
              c = setInterval(() => {
                const g = o ? e.get(o) : e.values().next().value;
                g && !s && ((s = !0), g.subscribers.add(l));
              }, 100),
              u = setTimeout(() => clearInterval(c), 1e4);
            return () => {
              clearInterval(c), clearTimeout(u);
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
            const c = s.maxEvents,
              u = i.events,
              g = u.length > c ? u.length - c : 0;
            s.events.clear();
            for (let f = g; f < u.length; f++) {
              const d = u[f];
              d &&
                typeof d == "object" &&
                !Array.isArray(d) &&
                typeof d.timestamp == "number" &&
                typeof d.type == "string" &&
                d.type !== "__proto__" &&
                d.type !== "constructor" &&
                d.type !== "prototype" &&
                s.events.push({
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
        clearEvents(l) {
          const o = l ? e.get(l) : e.values().next().value;
          o && o.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Ve(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function Dr(e = {}) {
  const {
      name: t = "default",
      trace: l = !1,
      maxEvents: o,
      panel: i = !1,
      position: s = "bottom-right",
      defaultOpen: c = !1,
    } = e,
    u = fr(o),
    g = Ir(),
    f = {
      system: null,
      events: new Et(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  g.systems.set(t, f);
  let d = (n, a) => {
      const v = { timestamp: Date.now(), type: n, data: a };
      l && f.events.push(v);
      for (const x of f.subscribers)
        try {
          x(v);
        } catch {}
    },
    $ = null,
    T = new Map(),
    I = new Map(),
    D = mr(),
    A = hr(),
    C = br(),
    O = gr(),
    N = i && typeof window < "u" && typeof document < "u" && Ve(),
    _ = null,
    p = 0,
    b = 1,
    h = 2,
    E = 4,
    R = 8,
    q = 16,
    m = 32,
    w = 64,
    S = 128,
    M = new Map(),
    F = new Set(),
    H = null;
  function L(n) {
    (p |= n),
      _ === null &&
        typeof requestAnimationFrame < "u" &&
        (_ = requestAnimationFrame(y));
  }
  function y() {
    if (((_ = null), !$ || !f.system)) {
      p = 0;
      return;
    }
    const n = $.refs,
      a = f.system,
      v = p;
    if (((p = 0), v & b)) {
      for (const x of F) xr(T, x);
      F.clear();
      for (const [x, { value: j, flash: P }] of M)
        Re(T, n.factsBody, x, j, P, $.flashTimers);
      M.clear(), (n.factsCount.textContent = String(T.size));
    }
    if ((v & h && ft(n, I, a, $.flashTimers), v & R))
      if (H) qe(n, H.inflight.length, H.unmet.length);
      else {
        const x = ke(a);
        x && qe(n, x.inflight.length, x.unmet.length);
      }
    if (v & E)
      if (H) _e(n, H.inflight, H.unmet);
      else {
        const x = ke(a);
        x && _e(n, x.inflight, x.unmet);
      }
    v & q && $r(n, D),
      v & m && pt(n, a, A),
      v & w && mt(n, a),
      v & S && Ar(n, O);
  }
  function k(n, a) {
    $ && l && Er($.refs, n, a, f.events.size);
  }
  function r(n, a) {
    C.isRecording &&
      C.recordedEvents.length < vr &&
      C.recordedEvents.push({ timestamp: Date.now(), type: n, data: dr(a) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((f.system = n),
        d("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        N)
      ) {
        const a = f.system;
        $ = Sr(t, s, c, l);
        const v = $.refs;
        try {
          const j = a.facts.$store.toObject();
          for (const [P, W] of Object.entries(j)) Re(T, v.factsBody, P, W, !1);
          v.factsCount.textContent = String(Object.keys(j).length);
        } catch {}
        ft(v, I, a);
        const x = ke(a);
        x &&
          (qe(v, x.inflight.length, x.unmet.length),
          _e(v, x.inflight, x.unmet)),
          mt(v, a),
          Cr(v, a),
          pt(v, a, A),
          v.recordBtn.addEventListener("click", () => {
            if (
              ((C.isRecording = !C.isRecording),
              (v.recordBtn.textContent = C.isRecording ? "⏹ Stop" : "⏺ Record"),
              (v.recordBtn.style.color = C.isRecording ? B.red : B.text),
              C.isRecording)
            ) {
              (C.recordedEvents = []), (C.snapshots = []);
              try {
                C.snapshots.push({
                  timestamp: Date.now(),
                  facts: a.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          v.exportBtn.addEventListener("click", () => {
            const j =
                C.recordedEvents.length > 0
                  ? C.recordedEvents
                  : f.events.toArray(),
              P = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: j,
                  snapshots: C.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([P], { type: "application/json" }),
              z = URL.createObjectURL(W),
              K = document.createElement("a");
            (K.href = z),
              (K.download = `directive-session-${t}-${Date.now()}.json`),
              K.click(),
              URL.revokeObjectURL(z);
          });
      }
    },
    onStart: (n) => {
      d("start", {}), k("start", {}), r("start", {});
    },
    onStop: (n) => {
      d("stop", {}), k("stop", {}), r("stop", {});
    },
    onDestroy: (n) => {
      d("destroy", {}),
        g.systems.delete(t),
        _ !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(_), (_ = null)),
        A.animationTimer && clearTimeout(A.animationTimer),
        $ && ($.destroy(), ($ = null), T.clear(), I.clear());
    },
    onFactSet: (n, a, v) => {
      d("fact.set", { key: n, value: a, prev: v }),
        r("fact.set", { key: n, value: a, prev: v }),
        A.recentlyChangedFacts.add(n),
        $ &&
          f.system &&
          (M.set(n, { value: a, flash: !0 }),
          F.delete(n),
          L(b),
          k("fact.set", { key: n, value: a }));
    },
    onFactDelete: (n, a) => {
      d("fact.delete", { key: n, prev: a }),
        r("fact.delete", { key: n, prev: a }),
        $ && (F.add(n), M.delete(n), L(b), k("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (d("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        $ && f.system)
      ) {
        for (const a of n)
          a.type === "delete"
            ? (F.add(a.key), M.delete(a.key))
            : (A.recentlyChangedFacts.add(a.key),
              M.set(a.key, { value: a.value, flash: !0 }),
              F.delete(a.key));
        L(b), k("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, a, v) => {
      d("derivation.compute", { id: n, value: a, deps: v }),
        r("derivation.compute", { id: n, deps: v }),
        A.derivationDeps.set(n, v),
        A.recentlyComputedDerivations.add(n),
        k("derivation.compute", { id: n, deps: v });
    },
    onDerivationInvalidate: (n) => {
      d("derivation.invalidate", { id: n }),
        k("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      d("reconcile.start", {}),
        (D.lastReconcileStartMs = performance.now()),
        k("reconcile.start", {}),
        r("reconcile.start", {});
    },
    onReconcileEnd: (n) => {
      if (
        (d("reconcile.end", n),
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
      if (C.isRecording && f.system && C.snapshots.length < yr)
        try {
          C.snapshots.push({
            timestamp: Date.now(),
            facts: f.system.facts.$store.toObject(),
          });
        } catch {}
      $ &&
        f.system &&
        ((H = n),
        Or(A),
        L(h | R | E | q | m | w),
        k("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, a) => {
      d("constraint.evaluate", { id: n, active: a }),
        r("constraint.evaluate", { id: n, active: a }),
        a
          ? (A.activeConstraints.add(n), A.recentlyActiveConstraints.add(n))
          : A.activeConstraints.delete(n),
        k("constraint.evaluate", { id: n, active: a });
    },
    onConstraintError: (n, a) => {
      d("constraint.error", { id: n, error: String(a) }),
        k("constraint.error", { id: n, error: String(a) });
    },
    onRequirementCreated: (n) => {
      d("requirement.created", { id: n.id, type: n.requirement.type }),
        r("requirement.created", { id: n.id, type: n.requirement.type }),
        k("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, a) => {
      d("requirement.met", { id: n.id, byResolver: a }),
        r("requirement.met", { id: n.id, byResolver: a }),
        k("requirement.met", { id: n.id, byResolver: a });
    },
    onRequirementCanceled: (n) => {
      d("requirement.canceled", { id: n.id }),
        r("requirement.canceled", { id: n.id }),
        k("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, a) => {
      d("resolver.start", { resolver: n, requirementId: a.id }),
        r("resolver.start", { resolver: n, requirementId: a.id }),
        O.inflight.set(n, performance.now()),
        $ &&
          f.system &&
          (L(E | R | S),
          k("resolver.start", { resolver: n, requirementId: a.id }));
    },
    onResolverComplete: (n, a, v) => {
      d("resolver.complete", { resolver: n, requirementId: a.id, duration: v }),
        r("resolver.complete", {
          resolver: n,
          requirementId: a.id,
          duration: v,
        });
      const x = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (x.count++,
        (x.totalMs += v),
        D.resolverStats.set(n, x),
        D.resolverStats.size > dt)
      ) {
        const P = D.resolverStats.keys().next().value;
        P !== void 0 && D.resolverStats.delete(P);
      }
      const j = O.inflight.get(n);
      O.inflight.delete(n),
        j !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !1,
          }),
        $ &&
          f.system &&
          (L(E | R | q | S),
          k("resolver.complete", { resolver: n, duration: v }));
    },
    onResolverError: (n, a, v) => {
      d("resolver.error", {
        resolver: n,
        requirementId: a.id,
        error: String(v),
      }),
        r("resolver.error", {
          resolver: n,
          requirementId: a.id,
          error: String(v),
        });
      const x = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((x.errors++, D.resolverStats.set(n, x), D.resolverStats.size > dt)) {
        const P = D.resolverStats.keys().next().value;
        P !== void 0 && D.resolverStats.delete(P);
      }
      const j = O.inflight.get(n);
      O.inflight.delete(n),
        j !== void 0 &&
          O.entries.push({
            resolver: n,
            startMs: j,
            endMs: performance.now(),
            error: !0,
          }),
        $ &&
          f.system &&
          (L(E | R | q | S),
          k("resolver.error", { resolver: n, error: String(v) }));
    },
    onResolverRetry: (n, a, v) => {
      d("resolver.retry", { resolver: n, requirementId: a.id, attempt: v }),
        r("resolver.retry", { resolver: n, requirementId: a.id, attempt: v }),
        k("resolver.retry", { resolver: n, attempt: v });
    },
    onResolverCancel: (n, a) => {
      d("resolver.cancel", { resolver: n, requirementId: a.id }),
        r("resolver.cancel", { resolver: n, requirementId: a.id }),
        O.inflight.delete(n),
        k("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      d("effect.run", { id: n }),
        r("effect.run", { id: n }),
        D.effectRunCount++,
        k("effect.run", { id: n });
    },
    onEffectError: (n, a) => {
      d("effect.error", { id: n, error: String(a) }),
        D.effectErrorCount++,
        k("effect.error", { id: n, error: String(a) });
    },
    onSnapshot: (n) => {
      d("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        $ && f.system && L(w),
        k("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, a) => {
      if (
        (d("timetravel.jump", { from: n, to: a }),
        r("timetravel.jump", { from: n, to: a }),
        $ && f.system)
      ) {
        const v = f.system;
        try {
          const x = v.facts.$store.toObject();
          T.clear(), $.refs.factsBody.replaceChildren();
          for (const [j, P] of Object.entries(x))
            Re(T, $.refs.factsBody, j, P, !1);
          $.refs.factsCount.textContent = String(Object.keys(x).length);
        } catch {}
        I.clear(),
          A.derivationDeps.clear(),
          $.refs.derivBody.replaceChildren(),
          (H = null),
          L(h | R | E | m | w),
          k("timetravel.jump", { from: n, to: a });
      }
    },
    onError: (n) => {
      d("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        r("error", { source: n.source, message: n.message }),
        k("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, a) => {
      d("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: a,
      }),
        k("error.recovery", { source: n.source, strategy: a });
    },
  };
}
const xe = { easy: 20 * 60, medium: 15 * 60, hard: 10 * 60 },
  jr = { easy: 46, medium: 36, hard: 26 },
  je = 3,
  Mr = 120,
  _r = 30,
  qr = 60,
  Br = 30;
function Ct(e) {
  return { row: Math.floor(e / 9), col: e % 9 };
}
function Ke(e, t) {
  return e * 9 + t;
}
function Tr(e, t) {
  return Math.floor(e / 3) * 3 + Math.floor(t / 3);
}
function kt(e) {
  const t = [];
  for (let l = 0; l < 9; l++) t.push(Ke(e, l));
  return t;
}
function Rt(e) {
  const t = [];
  for (let l = 0; l < 9; l++) t.push(Ke(l, e));
  return t;
}
function Ot(e) {
  const t = Math.floor(e / 3) * 3,
    l = (e % 3) * 3,
    o = [];
  for (let i = 0; i < 3; i++)
    for (let s = 0; s < 3; s++) o.push(Ke(t + i, l + s));
  return o;
}
function Oe(e) {
  const { row: t, col: l } = Ct(e),
    o = Tr(t, l),
    i = new Set();
  for (const s of kt(t)) i.add(s);
  for (const s of Rt(l)) i.add(s);
  for (const s of Ot(o)) i.add(s);
  return i.delete(e), [...i];
}
function Ee(e) {
  const t = [],
    l = new Set();
  function o(i) {
    for (let s = 0; s < i.length; s++) {
      const c = e[i[s]];
      if (c !== 0) {
        for (let u = s + 1; u < i.length; u++)
          if (e[i[u]] === c) {
            const g = `${i[s]}-${i[u]}`,
              f = `${i[u]}-${i[s]}`;
            l.has(g) ||
              (l.add(g),
              l.add(f),
              t.push({ index: i[s], value: c, peerIndex: i[u] }),
              t.push({ index: i[u], value: c, peerIndex: i[s] }));
          }
      }
    }
  }
  for (let i = 0; i < 9; i++) o(kt(i));
  for (let i = 0; i < 9; i++) o(Rt(i));
  for (let i = 0; i < 9; i++) o(Ot(i));
  return t;
}
function gt(e) {
  return e.every((t) => t !== 0);
}
function We(e, t) {
  if (e[t] !== 0) return [];
  const l = new Set();
  for (const i of Oe(t)) e[i] !== 0 && l.add(e[i]);
  const o = [];
  for (let i = 1; i <= 9; i++) l.has(i) || o.push(i);
  return o;
}
function ht() {
  return Array.from({ length: 81 }, () => new Set());
}
function Ge(e) {
  for (let t = e.length - 1; t > 0; t--) {
    const l = Math.floor(Math.random() * (t + 1)),
      o = e[t];
    (e[t] = e[l]), (e[l] = o);
  }
  return e;
}
const zr = 1e5;
function vt(e) {
  const t = [...e];
  let l = 0;
  function o() {
    let s = -1,
      c = 10;
    for (let u = 0; u < 81; u++) {
      if (t[u] !== 0) continue;
      const g = We(t, u).length;
      if (g === 0) return -1;
      g < c && ((c = g), (s = u));
    }
    return s;
  }
  function i() {
    if ((l++, l > zr)) return !1;
    const s = o();
    if (s === -1) return !t.includes(0);
    const c = Ge([...We(t, s)]);
    for (const u of c) {
      if (((t[s] = u), i())) return !0;
      t[s] = 0;
    }
    return !1;
  }
  return i() ? t : null;
}
function Te(e, t, l) {
  const o = Ge([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let i = 0;
  for (let s = 0; s < 3; s++)
    for (let c = 0; c < 3; c++) e[(t + s) * 9 + (l + c)] = o[i++];
}
const Lr = 10;
function He(e, t = 0) {
  const l = new Array(81).fill(0);
  Te(l, 0, 0), Te(l, 3, 3), Te(l, 6, 6);
  const o = vt(l);
  if (!o) {
    if (t >= Lr)
      throw new Error(
        "Failed to generate a valid Sudoku puzzle after max retries.",
      );
    return He(e, t + 1);
  }
  const i = [...o],
    c = 81 - jr[e],
    u = Ge(Array.from({ length: 81 }, (f, d) => d));
  let g = 0;
  for (const f of u) {
    if (g >= c) break;
    const d = i[f];
    i[f] = 0;
    const $ = vt(i);
    $ && $[f] === d ? g++ : (i[f] = d);
  }
  return { puzzle: i, solution: o };
}
const Ue = {
    facts: {
      grid: G.object(),
      solution: G.object(),
      givens: G.object(),
      selectedIndex: G.object(),
      difficulty: G.object(),
      timerRemaining: G.number(),
      timerRunning: G.boolean(),
      gameOver: G.boolean(),
      won: G.boolean(),
      message: G.string(),
      notesMode: G.boolean(),
      notes: G.object(),
      hintsUsed: G.number(),
      errorsCount: G.number(),
      hintRequested: G.boolean(),
    },
    derivations: {
      conflicts: G.object(),
      conflictIndices: G.object(),
      hasConflicts: G.boolean(),
      filledCount: G.number(),
      progress: G.number(),
      isComplete: G.boolean(),
      isSolved: G.boolean(),
      selectedPeers: G.object(),
      highlightValue: G.number(),
      sameValueIndices: G.object(),
      candidates: G.object(),
      timerDisplay: G.string(),
      timerUrgency: G.object(),
    },
    events: {
      newGame: { difficulty: G.object() },
      selectCell: { index: G.number() },
      inputNumber: { value: G.number() },
      toggleNote: { value: G.number() },
      toggleNotesMode: {},
      requestHint: {},
      tick: {},
    },
    requirements: {
      SHOW_CONFLICT: {
        index: G.number(),
        value: G.number(),
        row: G.number(),
        col: G.number(),
      },
      GAME_WON: {
        timeLeft: G.number(),
        hintsUsed: G.number(),
        errors: G.number(),
      },
      GAME_OVER: { reason: G.string() },
      REVEAL_HINT: { index: G.number(), value: G.number() },
    },
  },
  Nr = Ht("sudoku", {
    schema: Ue,
    snapshotEvents: ["inputNumber", "toggleNote", "requestHint", "newGame"],
    init: (e) => {
      const { puzzle: t, solution: l } = He("easy"),
        o = new Set();
      for (let i = 0; i < 81; i++) t[i] !== 0 && o.add(i);
      (e.grid = t),
        (e.solution = l),
        (e.givens = o),
        (e.selectedIndex = null),
        (e.difficulty = "easy"),
        (e.timerRemaining = xe.easy),
        (e.timerRunning = !0),
        (e.gameOver = !1),
        (e.won = !1),
        (e.message =
          "Fill in the grid. No duplicates in rows, columns, or boxes."),
        (e.notesMode = !1),
        (e.notes = ht()),
        (e.hintsUsed = 0),
        (e.errorsCount = 0),
        (e.hintRequested = !1);
    },
    derive: {
      conflicts: (e) => Ee(e.grid),
      conflictIndices: (e, t) => {
        const l = new Set(),
          o = e.givens;
        for (const i of t.conflicts) o.has(i.index) || l.add(i.index);
        return l;
      },
      hasConflicts: (e, t) => t.conflicts.length > 0,
      filledCount: (e) => {
        let t = 0;
        const l = e.grid;
        for (let o = 0; o < 81; o++) l[o] !== 0 && t++;
        return t;
      },
      progress: (e, t) => Math.round((t.filledCount / 81) * 100),
      isComplete: (e) => gt(e.grid),
      isSolved: (e, t) => t.isComplete && !t.hasConflicts,
      selectedPeers: (e) => {
        const t = e.selectedIndex;
        return t === null ? [] : Oe(t);
      },
      highlightValue: (e) => {
        const t = e.selectedIndex;
        return t === null ? 0 : e.grid[t];
      },
      sameValueIndices: (e, t) => {
        const l = t.highlightValue;
        if (l === 0) return new Set();
        const o = new Set(),
          i = e.grid;
        for (let s = 0; s < 81; s++) i[s] === l && o.add(s);
        return o;
      },
      candidates: (e) => {
        const t = e.selectedIndex;
        return t === null ? [] : We(e.grid, t);
      },
      timerDisplay: (e) => {
        const t = e.timerRemaining,
          l = Math.max(0, Math.floor(t / 60)),
          o = Math.max(0, t % 60);
        return `${String(l).padStart(2, "0")}:${String(o).padStart(2, "0")}`;
      },
      timerUrgency: (e) => {
        const t = e.timerRemaining;
        return t <= _r ? "critical" : t <= Mr ? "warning" : "normal";
      },
    },
    events: {
      newGame: (e, { difficulty: t }) => {
        const { puzzle: l, solution: o } = He(t),
          i = new Set();
        for (let s = 0; s < 81; s++) l[s] !== 0 && i.add(s);
        (e.grid = l),
          (e.solution = o),
          (e.givens = i),
          (e.selectedIndex = null),
          (e.difficulty = t),
          (e.timerRemaining = xe[t]),
          (e.timerRunning = !0),
          (e.gameOver = !1),
          (e.won = !1),
          (e.message =
            "Fill in the grid. No duplicates in rows, columns, or boxes."),
          (e.notesMode = !1),
          (e.notes = ht()),
          (e.hintsUsed = 0),
          (e.errorsCount = 0),
          (e.hintRequested = !1);
      },
      selectCell: (e, { index: t }) => {
        e.gameOver || (e.selectedIndex = t);
      },
      inputNumber: (e, { value: t }) => {
        if (e.gameOver) return;
        const l = e.selectedIndex;
        if (l === null) return;
        if (e.givens.has(l)) {
          e.message = "That cell is locked.";
          return;
        }
        if (e.notesMode && t !== 0) {
          const s = [...e.notes];
          (s[l] = new Set(s[l])),
            s[l].has(t) ? s[l].delete(t) : s[l].add(t),
            (e.notes = s),
            (e.message = "");
          return;
        }
        const i = [...e.grid];
        if (((i[l] = t), (e.grid = i), t !== 0)) {
          const s = [...e.notes];
          s[l] = new Set();
          for (const c of Oe(l))
            s[c].has(t) && ((s[c] = new Set(s[c])), s[c].delete(t));
          e.notes = s;
        }
        e.message = "";
      },
      toggleNote: (e, { value: t }) => {
        if (e.gameOver) return;
        const l = e.selectedIndex;
        if (l === null || e.givens.has(l) || e.grid[l] !== 0) return;
        const i = [...e.notes];
        (i[l] = new Set(i[l])),
          i[l].has(t) ? i[l].delete(t) : i[l].add(t),
          (e.notes = i);
      },
      toggleNotesMode: (e) => {
        e.notesMode = !e.notesMode;
      },
      requestHint: (e) => {
        if (e.gameOver) return;
        if (e.hintsUsed >= je) {
          e.message = "No hints remaining.";
          return;
        }
        const t = e.selectedIndex;
        if (t === null) {
          e.message = "Select a cell first.";
          return;
        }
        if (e.givens.has(t)) {
          e.message = "That cell is already filled.";
          return;
        }
        if (e.grid[t] !== 0) {
          e.message = "Clear the cell first, or select an empty cell.";
          return;
        }
        e.hintRequested = !0;
      },
      tick: (e) => {
        !e.timerRunning ||
          e.gameOver ||
          (e.timerRemaining = Math.max(0, e.timerRemaining - 1));
      },
    },
    constraints: {
      timerExpired: {
        priority: 200,
        when: (e) => (e.gameOver ? !1 : e.timerRemaining <= 0),
        require: () => ({ type: "GAME_OVER", reason: "Time's up!" }),
      },
      detectConflict: {
        priority: 100,
        when: (e) => {
          if (e.gameOver) return !1;
          const t = Ee(e.grid),
            l = e.givens;
          return t.some((o) => !l.has(o.index));
        },
        require: (e) => {
          const t = Ee(e.grid),
            l = e.givens,
            o = t.find((u) => !l.has(u.index)),
            i = o?.index ?? 0,
            { row: s, col: c } = Ct(i);
          return {
            type: "SHOW_CONFLICT",
            index: i,
            value: o?.value ?? 0,
            row: s + 1,
            col: c + 1,
          };
        },
      },
      puzzleSolved: {
        priority: 90,
        when: (e) => (e.gameOver ? !1 : gt(e.grid) && Ee(e.grid).length === 0),
        require: (e) => ({
          type: "GAME_WON",
          timeLeft: e.timerRemaining,
          hintsUsed: e.hintsUsed,
          errors: e.errorsCount,
        }),
      },
      hintAvailable: {
        priority: 70,
        when: (e) => {
          if (e.gameOver || !e.hintRequested) return !1;
          const t = e.selectedIndex;
          return t === null ? !1 : e.grid[t] === 0;
        },
        require: (e) => {
          const t = e.selectedIndex,
            l = e.solution;
          return { type: "REVEAL_HINT", index: t, value: l[t] };
        },
      },
    },
    resolvers: {
      showConflict: {
        requirement: "SHOW_CONFLICT",
        resolve: async (e, t) => {
          (t.facts.errorsCount = t.facts.errorsCount + 1),
            (t.facts.message = `Conflict at row ${e.row}, column ${e.col} – duplicate ${e.value}.`);
        },
      },
      gameWon: {
        requirement: "GAME_WON",
        resolve: async (e, t) => {
          (t.facts.timerRunning = !1),
            (t.facts.gameOver = !0),
            (t.facts.won = !0);
          const l = Math.floor((xe[t.facts.difficulty] - e.timeLeft) / 60),
            o = (xe[t.facts.difficulty] - e.timeLeft) % 60;
          t.facts.message = `Solved in ${l}m ${o}s! Hints: ${e.hintsUsed}, Errors: ${e.errors}`;
        },
      },
      gameOver: {
        requirement: "GAME_OVER",
        resolve: async (e, t) => {
          (t.facts.timerRunning = !1),
            (t.facts.gameOver = !0),
            (t.facts.won = !1),
            (t.facts.message = e.reason);
        },
      },
      revealHint: {
        requirement: "REVEAL_HINT",
        resolve: async (e, t) => {
          const l = [...t.facts.grid];
          (l[e.index] = e.value), (t.facts.grid = l);
          const o = [...t.facts.notes];
          o[e.index] = new Set();
          for (const i of Oe(e.index))
            o[i].has(e.value) && ((o[i] = new Set(o[i])), o[i].delete(e.value));
          (t.facts.notes = o),
            (t.facts.hintRequested = !1),
            (t.facts.hintsUsed = t.facts.hintsUsed + 1),
            (t.facts.message = `Hint revealed! ${je - t.facts.hintsUsed} remaining.`);
        },
      },
    },
    effects: {
      timerWarning: {
        deps: ["timerRemaining"],
        run: (e) => {
          const t = e.timerRemaining;
          t === qr && console.log("[Sudoku] 1 minute remaining!"),
            t === Br && console.log("[Sudoku] 30 seconds remaining!");
        },
      },
      gameResult: {
        deps: ["gameOver"],
        run: (e) => {
          e.gameOver &&
            (e.won
              ? console.log(
                  `[Sudoku] Puzzle solved! Difficulty: ${e.difficulty}, Hints: ${e.hintsUsed}, Errors: ${e.errorsCount}`,
                )
              : console.log(`[Sudoku] Game over: ${e.message}`));
        },
      },
    },
  }),
  X = sr({
    module: Nr,
    debug: { timeTravel: !0, maxSnapshots: 200 },
    plugins: [Dr({ name: "sudoku" })],
  });
X.start();
const Pr = [...Object.keys(Ue.facts), ...Object.keys(Ue.derivations)],
  ze = document.getElementById("sudoku-grid"),
  $e = document.getElementById("sudoku-timer"),
  Le = document.getElementById("sudoku-message"),
  Fr = document.getElementById("sudoku-progress"),
  Wr = document.getElementById("sudoku-progress-bar"),
  Hr = document.getElementById("sudoku-hints-remaining"),
  Ur = document.getElementById("sudoku-errors"),
  At = document.getElementById("sudoku-notes-toggle"),
  It = document.getElementById("sudoku-hint-btn"),
  Vr = document.getElementById("sudoku-undo-btn"),
  Kr = document.getElementById("sudoku-redo-btn"),
  Gr = document.getElementById("sudoku-new-game"),
  pe = document.getElementById("sudoku-modal"),
  yt = document.getElementById("sudoku-modal-title"),
  bt = document.getElementById("sudoku-modal-message"),
  Jr = document.getElementById("sudoku-modal-new-game"),
  Dt = document.getElementById("sudoku-mode-easy"),
  jt = document.getElementById("sudoku-mode-medium"),
  Mt = document.getElementById("sudoku-mode-hard");
let he = null;
function _t() {
  ge(),
    (he = setInterval(() => {
      X.events.tick();
    }, 1e3));
}
function ge() {
  he !== null && (clearInterval(he), (he = null));
}
function qt() {
  const e = X.facts,
    t = X.derive,
    l = e.grid,
    o = e.givens,
    i = e.selectedIndex,
    s = e.difficulty,
    c = e.gameOver,
    u = e.won,
    g = e.notesMode,
    f = e.notes,
    d = e.hintsUsed,
    $ = e.errorsCount;
  t.conflicts;
  const T = t.conflictIndices,
    I = t.selectedPeers,
    D = t.sameValueIndices,
    A = t.progress,
    C = t.timerDisplay,
    O = t.timerUrgency,
    N = new Set(I);
  ($e.textContent = C),
    ($e.className = "sudoku-timer"),
    O === "warning"
      ? $e.classList.add("warning")
      : O === "critical" && $e.classList.add("critical"),
    e.timerRunning && !c && !he ? _t() : (!e.timerRunning || c) && he && ge(),
    (Fr.textContent = `${A}%`),
    (Wr.style.width = `${A}%`),
    (Hr.textContent = `${je - d}`),
    (Ur.textContent = `${$}`);
  const _ = e.message;
  _
    ? ((Le.textContent = _), Le.classList.remove("hidden"))
    : Le.classList.add("hidden"),
    At.classList.toggle("notes-active", g),
    ze.classList.toggle("notes-mode", g);
  const p = d >= je || c;
  (It.disabled = p),
    Dt.classList.toggle("active", s === "easy"),
    jt.classList.toggle("active", s === "medium"),
    Mt.classList.toggle("active", s === "hard"),
    (ze.innerHTML = "");
  for (let b = 0; b < 81; b++) {
    const h = document.createElement("div"),
      E = l[b],
      R = o.has(b),
      q = b === i,
      m = T.has(b),
      w = N.has(b),
      S = D.has(b) && E !== 0,
      M = Math.floor(b / 9),
      F = b % 9;
    if (
      ((h.className = "sudoku-cell"),
      (h.dataset.testid = `sudoku-cell-${b}`),
      h.setAttribute(
        "aria-label",
        `Row ${M + 1}, Column ${F + 1}${E ? `, value ${E}` : ", empty"}`,
      ),
      R && h.classList.add("given"),
      q && h.classList.add("selected"),
      m && h.classList.add("conflict"),
      w && !q && h.classList.add("peer"),
      S && !q && h.classList.add("same-value"),
      F % 3 === 0 && F !== 0 && h.classList.add("box-left"),
      M % 3 === 0 && M !== 0 && h.classList.add("box-top"),
      E !== 0)
    )
      h.textContent = String(E);
    else if (f[b] && f[b].size > 0) {
      const H = document.createElement("div");
      H.className = "notes-grid";
      for (let L = 1; L <= 9; L++) {
        const y = document.createElement("span");
        (y.className = "note-digit"),
          f[b].has(L) && (y.textContent = String(L)),
          H.appendChild(y);
      }
      h.appendChild(H);
    }
    (h.tabIndex = 0),
      h.addEventListener("click", () => {
        X.events.selectCell({ index: b });
      }),
      ze.appendChild(h);
  }
  for (let b = 1; b <= 9; b++) {
    const h = document.getElementById(`sudoku-num-${b}`);
    if (h) {
      let E = 0;
      for (let m = 0; m < 81; m++) l[m] === b && E++;
      const R = 9 - E,
        q = h.querySelector(".num-badge");
      q &&
        ((q.textContent = String(R)), q.classList.toggle("complete", R === 0));
    }
  }
  c
    ? (pe.classList.remove("hidden"),
      u
        ? ((yt.textContent = "Puzzle Solved!"), (bt.textContent = _))
        : ((yt.textContent = "Game Over"), (bt.textContent = _)))
    : pe.classList.add("hidden");
}
X.subscribe(Pr, qt);
for (let e = 0; e <= 9; e++) {
  const t = document.getElementById(`sudoku-num-${e}`);
  t &&
    t.addEventListener("click", () => {
      X.events.inputNumber({ value: e });
    });
}
At.addEventListener("click", () => {
  X.events.toggleNotesMode();
});
It.addEventListener("click", () => {
  X.events.requestHint();
});
Vr.addEventListener("click", () => {
  X.debug?.goBack();
});
Kr.addEventListener("click", () => {
  X.debug?.goForward();
});
Gr.addEventListener("click", () => {
  ge(), X.events.newGame({ difficulty: X.facts.difficulty });
});
Jr.addEventListener("click", () => {
  ge(), X.events.newGame({ difficulty: X.facts.difficulty });
});
Dt.addEventListener("click", () => {
  ge(), X.events.newGame({ difficulty: "easy" });
});
jt.addEventListener("click", () => {
  ge(), X.events.newGame({ difficulty: "medium" });
});
Mt.addEventListener("click", () => {
  ge(), X.events.newGame({ difficulty: "hard" });
});
document.addEventListener("keydown", (e) => {
  const t = X.facts,
    l = t.selectedIndex;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const o = l ?? 40,
      i = Math.floor(o / 9),
      s = o % 9;
    let c = i,
      u = s;
    e.key === "ArrowUp"
      ? (c = Math.max(0, i - 1))
      : e.key === "ArrowDown"
        ? (c = Math.min(8, i + 1))
        : e.key === "ArrowLeft"
          ? (u = Math.max(0, s - 1))
          : e.key === "ArrowRight" && (u = Math.min(8, s + 1)),
      X.events.selectCell({ index: c * 9 + u });
    return;
  }
  if (e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const o = Number.parseInt(e.key, 10);
    t.notesMode
      ? X.events.toggleNote({ value: o })
      : X.events.inputNumber({ value: o });
    return;
  }
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault(), X.events.inputNumber({ value: 0 });
    return;
  }
  if (e.key === "n" || e.key === "N") {
    e.preventDefault(), X.events.toggleNotesMode();
    return;
  }
  if (e.key === "h" || e.key === "H") {
    e.preventDefault(), X.events.requestHint();
    return;
  }
  if (e.key === "Escape" && !pe.classList.contains("hidden")) {
    e.preventDefault(), pe.classList.add("hidden");
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault(), e.shiftKey ? X.debug?.goForward() : X.debug?.goBack();
    return;
  }
});
pe.addEventListener("click", (e) => {
  e.target === pe && pe.classList.add("hidden");
});
_t();
qt();
