(() => {
  const t = document.createElement("link").relList;
  if (t && t.supports && t.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) s(i);
  new MutationObserver((i) => {
    for (const o of i)
      if (o.type === "childList")
        for (const f of o.addedNodes)
          f.tagName === "LINK" && f.rel === "modulepreload" && s(f);
  }).observe(document, { childList: !0, subtree: !0 });
  function a(i) {
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
    const o = a(i);
    fetch(i.href, o);
  }
})();
var rt = class extends Error {
    constructor(t, a, s, i, o = !0) {
      super(t),
        (this.source = a),
        (this.sourceId = s),
        (this.context = i),
        (this.recoverable = o),
        (this.name = "DirectiveError");
    }
  },
  ye = [];
function Bt() {
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
var Pt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function zt() {
  return ye[ye.length - 1] ?? Pt;
}
function Me(e) {
  const t = Bt();
  ye.push(t);
  try {
    return { value: e(), deps: t.getDependencies() };
  } finally {
    ye.pop();
  }
}
function nt(e) {
  const t = ye.splice(0, ye.length);
  try {
    return e();
  } finally {
    ye.push(...t);
  }
}
function Ke(e) {
  zt().track(e);
}
function Lt(e, t = 100) {
  try {
    return JSON.stringify(e)?.slice(0, t) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Te(e = [], t, a, s, i, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: t,
    _default: a,
    _transform: s,
    _description: i,
    _refinements: o,
    validate(f) {
      return Te([...e, f], t, a, s, i, o);
    },
  };
}
function te(e, t, a, s, i, o) {
  return {
    ...Te(e, t, a, s, i, o),
    default(f) {
      return te(e, t, f, s, i, o);
    },
    transform(f) {
      return te(
        [],
        t,
        void 0,
        (u) => {
          const h = s ? s(u) : u;
          return f(h);
        },
        i,
      );
    },
    brand() {
      return te(e, `Branded<${t}>`, a, s, i, o);
    },
    describe(f) {
      return te(e, t, a, s, f, o);
    },
    refine(f, u) {
      const h = [...(o ?? []), { predicate: f, message: u }];
      return te([...e, f], t, a, s, i, h);
    },
    nullable() {
      return te(
        [(f) => f === null || e.every((u) => u(f))],
        `${t} | null`,
        a,
        s,
        i,
      );
    },
    optional() {
      return te(
        [(f) => f === void 0 || e.every((u) => u(f))],
        `${t} | undefined`,
        a,
        s,
        i,
      );
    },
  };
}
var Y = {
  string() {
    return te([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (t, a, s, i, o) => ({
      ...te(t, "number", a, s, i, o),
      min(f) {
        return e([...t, (u) => u >= f], a, s, i, o);
      },
      max(f) {
        return e([...t, (u) => u <= f], a, s, i, o);
      },
      default(f) {
        return e(t, f, s, i, o);
      },
      describe(f) {
        return e(t, a, s, f, o);
      },
      refine(f, u) {
        const h = [...(o ?? []), { predicate: f, message: u }];
        return e([...t, f], a, s, i, h);
      },
    });
    return e([(t) => typeof t == "number"]);
  },
  boolean() {
    return te([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (t, a, s, i, o) => {
      const f = te(t, "array", s, void 0, i),
        u = o ?? { value: -1 };
      return {
        ...f,
        get _lastFailedIndex() {
          return u.value;
        },
        set _lastFailedIndex(h) {
          u.value = h;
        },
        of(h) {
          const p = { value: -1 };
          return e(
            [
              ...t,
              (d) => {
                for (let C = 0; C < d.length; C++) {
                  const _ = d[C];
                  if (!h._validators.every((O) => O(_)))
                    return (p.value = C), !1;
                }
                return !0;
              },
            ],
            h,
            s,
            i,
            p,
          );
        },
        nonEmpty() {
          return e([...t, (h) => h.length > 0], a, s, i, u);
        },
        maxLength(h) {
          return e([...t, (p) => p.length <= h], a, s, i, u);
        },
        minLength(h) {
          return e([...t, (p) => p.length >= h], a, s, i, u);
        },
        default(h) {
          return e(t, a, h, i, u);
        },
        describe(h) {
          return e(t, a, s, h, u);
        },
      };
    };
    return e([(t) => Array.isArray(t)]);
  },
  object() {
    const e = (t, a, s) => ({
      ...te(t, "object", a, void 0, s),
      shape(i) {
        return e(
          [
            ...t,
            (o) => {
              for (const [f, u] of Object.entries(i)) {
                const h = o[f],
                  p = u;
                if (p && !p._validators.every((d) => d(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          s,
        );
      },
      nonNull() {
        return e([...t, (i) => i != null], a, s);
      },
      hasKeys(...i) {
        return e([...t, (o) => i.every((f) => f in o)], a, s);
      },
      default(i) {
        return e(t, i, s);
      },
      describe(i) {
        return e(t, a, i);
      },
    });
    return e([(t) => typeof t == "object" && t !== null && !Array.isArray(t)]);
  },
  enum(...e) {
    const t = new Set(e);
    return te(
      [(a) => typeof a == "string" && t.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return te([(t) => t === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const t = e._typeName ?? "unknown";
    return Te(
      [(a) => (a === null ? !0 : e._validators.every((s) => s(a)))],
      `${t} | null`,
    );
  },
  optional(e) {
    const t = e._typeName ?? "unknown";
    return Te(
      [(a) => (a === void 0 ? !0 : e._validators.every((s) => s(a)))],
      `${t} | undefined`,
    );
  },
  union(...e) {
    const t = e.map((a) => a._typeName ?? "unknown");
    return te(
      [(a) => e.some((s) => s._validators.every((i) => i(a)))],
      t.join(" | "),
    );
  },
  record(e) {
    const t = e._typeName ?? "unknown";
    return te(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((s) => e._validators.every((i) => i(s))),
      ],
      `Record<string, ${t}>`,
    );
  },
  tuple(...e) {
    const t = e.map((a) => a._typeName ?? "unknown");
    return te(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((s, i) => s._validators.every((o) => o(a[i]))),
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
function Ht(e) {
  const { schema: t, onChange: a, onBatch: s } = e;
  Object.keys(t).length;
  let i = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    f = e.redactErrors ?? !1,
    u = new Map(),
    h = new Set(),
    p = new Map(),
    d = new Set(),
    C = 0,
    _ = [],
    O = new Set(),
    D = !1,
    j = [],
    E = 100;
  function x(m) {
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
  function T(m) {
    const S = m;
    if (S._typeName) return S._typeName;
    if (x(m)) {
      const b = m._def;
      if (b?.typeName) return b.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function M(m) {
    return f ? "[redacted]" : Lt(m);
  }
  function c(m, S) {
    if (!i) return;
    const b = t[m];
    if (!b) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${m}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${m}"`);
      return;
    }
    if (x(b)) {
      const P = b.safeParse(S);
      if (!P.success) {
        const v = S === null ? "null" : Array.isArray(S) ? "array" : typeof S,
          R = M(S),
          r =
            P.error?.message ??
            P.error?.issues?.[0]?.message ??
            "Validation failed",
          n = T(b);
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${n}, got ${v} ${R}. ${r}`,
        );
      }
      return;
    }
    const I = b,
      z = I._validators;
    if (!z || !Array.isArray(z) || z.length === 0) return;
    const K = I._typeName ?? "unknown";
    for (let P = 0; P < z.length; P++) {
      const v = z[P];
      if (typeof v == "function" && !v(S)) {
        let R = S === null ? "null" : Array.isArray(S) ? "array" : typeof S,
          r = M(S),
          n = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((n = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const l = P === 0 ? "" : ` (validator ${P + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${m}": expected ${K}, got ${R} ${r}${l}${n}`,
        );
      }
    }
  }
  function w(m) {
    p.get(m)?.forEach((S) => S());
  }
  function g() {
    d.forEach((m) => m());
  }
  function $(m, S, b) {
    if (D) {
      j.push({ key: m, value: S, prev: b });
      return;
    }
    D = !0;
    try {
      a?.(m, S, b), w(m), g();
      let I = 0;
      while (j.length > 0) {
        if (++I > E)
          throw (
            ((j.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${E} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const z = [...j];
        j.length = 0;
        for (const K of z) a?.(K.key, K.value, K.prev), w(K.key);
        g();
      }
    } finally {
      D = !1;
    }
  }
  function A() {
    if (!(C > 0)) {
      if ((s && _.length > 0 && s([..._]), O.size > 0)) {
        D = !0;
        try {
          for (const S of O) w(S);
          g();
          let m = 0;
          while (j.length > 0) {
            if (++m > E)
              throw (
                ((j.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${E} iterations.`,
                ))
              );
            const S = [...j];
            j.length = 0;
            for (const b of S) a?.(b.key, b.value, b.prev), w(b.key);
            g();
          }
        } finally {
          D = !1;
        }
      }
      (_.length = 0), O.clear();
    }
  }
  const F = {
    get(m) {
      return Ke(m), u.get(m);
    },
    has(m) {
      return Ke(m), u.has(m);
    },
    set(m, S) {
      c(m, S);
      const b = u.get(m);
      Object.is(b, S) ||
        (u.set(m, S),
        h.add(m),
        C > 0
          ? (_.push({ key: m, value: S, prev: b, type: "set" }), O.add(m))
          : $(m, S, b));
    },
    delete(m) {
      const S = u.get(m);
      u.delete(m),
        h.delete(m),
        C > 0
          ? (_.push({ key: m, value: void 0, prev: S, type: "delete" }),
            O.add(m))
          : $(m, void 0, S);
    },
    batch(m) {
      C++;
      try {
        m();
      } finally {
        C--, A();
      }
    },
    subscribe(m, S) {
      for (const b of m) {
        const I = b;
        p.has(I) || p.set(I, new Set()), p.get(I).add(S);
      }
      return () => {
        for (const b of m) {
          const I = p.get(b);
          I && (I.delete(S), I.size === 0 && p.delete(b));
        }
      };
    },
    subscribeAll(m) {
      return d.add(m), () => d.delete(m);
    },
    toObject() {
      const m = {};
      for (const S of h) u.has(S) && (m[S] = u.get(S));
      return m;
    },
  };
  return (
    (F.registerKeys = (m) => {
      for (const S of Object.keys(m)) xe.has(S) || ((t[S] = m[S]), h.add(S));
    }),
    F
  );
}
var xe = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function Kt(e, t) {
  const a = () => ({
    get: (s) => nt(() => e.get(s)),
    has: (s) => nt(() => e.has(s)),
  });
  return new Proxy(
    {},
    {
      get(s, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return a;
        if (typeof i != "symbol" && !xe.has(i)) return e.get(i);
      },
      set(s, i, o) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          xe.has(i)
          ? !1
          : (e.set(i, o), !0);
      },
      deleteProperty(s, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          xe.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(s, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || xe.has(i)
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
function Wt(e) {
  const t = Ht(e),
    a = Kt(t, e.schema);
  return { store: t, facts: a };
}
function Jt(e, t) {
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
async function Ae(e, t, a) {
  let s,
    i = new Promise((o, f) => {
      s = setTimeout(() => f(new Error(a)), t);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(s);
  }
}
function $t(e, t = 50) {
  const a = new WeakSet();
  function s(i, o) {
    if (o > t) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const f = typeof i;
    if (f === "string") return JSON.stringify(i);
    if (f === "number" || f === "boolean") return String(i);
    if (f === "function") return '"[function]"';
    if (f === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (a.has(i)) return '"[circular]"';
      a.add(i);
      const u = `[${i.map((h) => s(h, o + 1)).join(",")}]`;
      return a.delete(i), u;
    }
    if (f === "object") {
      const u = i;
      if (a.has(u)) return '"[circular]"';
      a.add(u);
      const h = `{${Object.keys(u)
        .sort()
        .map((p) => `${JSON.stringify(p)}:${s(u[p], o + 1)}`)
        .join(",")}}`;
      return a.delete(u), h;
    }
    return '"[unknown]"';
  }
  return s(e, 0);
}
function Ee(e, t = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    s = new WeakSet();
  function i(o, f) {
    if (f > t) return !1;
    if (o == null || typeof o != "object") return !0;
    const u = o;
    if (s.has(u)) return !0;
    if ((s.add(u), Array.isArray(u))) {
      for (const h of u) if (!i(h, f + 1)) return s.delete(u), !1;
      return s.delete(u), !0;
    }
    for (const h of Object.keys(u))
      if (a.has(h) || !i(u[h], f + 1)) return s.delete(u), !1;
    return s.delete(u), !0;
  }
  return i(e, 0);
}
function Ut(e) {
  let t = $t(e),
    a = 5381;
  for (let s = 0; s < t.length; s++) a = ((a << 5) + a) ^ t.charCodeAt(s);
  return (a >>> 0).toString(16);
}
function Yt(e, t) {
  if (t) return t(e);
  const { type: a, ...s } = e,
    i = $t(s);
  return `${a}:${i}`;
}
function Vt(e, t, a) {
  return { requirement: e, id: Yt(e, a), fromConstraint: t };
}
var We = class Et {
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
      const t = new Et();
      for (const a of this.map.values()) t.add(a);
      return t;
    }
    diff(t) {
      const a = [],
        s = [],
        i = [];
      for (const o of this.map.values()) t.has(o.id) ? i.push(o) : a.push(o);
      for (const o of t.map.values()) this.map.has(o.id) || s.push(o);
      return { added: a, removed: s, unchanged: i };
    }
  },
  Gt = 5e3;
function Xt(e) {
  let {
      definitions: t,
      facts: a,
      requirementKeys: s = {},
      defaultTimeout: i = Gt,
      onEvaluate: o,
      onError: f,
    } = e,
    u = new Map(),
    h = new Set(),
    p = new Set(),
    d = new Map(),
    C = new Map(),
    _ = new Set(),
    O = new Map(),
    D = new Map(),
    j = !1,
    E = new Set(),
    x = new Set(),
    T = new Map(),
    M = [],
    c = new Map();
  function w() {
    for (const [r, n] of Object.entries(t))
      if (n.after)
        for (const l of n.after)
          t[l] && (T.has(l) || T.set(l, new Set()), T.get(l).add(r));
  }
  function g() {
    const r = new Set(),
      n = new Set(),
      l = [];
    function y(k, q) {
      if (r.has(k)) return;
      if (n.has(k)) {
        const H = q.indexOf(k),
          B = [...q.slice(H), k].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${B}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      n.add(k), q.push(k);
      const L = t[k];
      if (L?.after) for (const H of L.after) t[H] && y(H, q);
      q.pop(), n.delete(k), r.add(k), l.push(k);
    }
    for (const k of Object.keys(t)) y(k, []);
    (M = l), (c = new Map(M.map((k, q) => [k, q])));
  }
  g(), w();
  function $(r, n) {
    return n.async !== void 0 ? n.async : !!p.has(r);
  }
  function A(r) {
    const n = t[r];
    if (!n) throw new Error(`[Directive] Unknown constraint: ${r}`);
    const l = $(r, n);
    l && p.add(r);
    const y = {
      id: r,
      priority: n.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: n.after ?? [],
    };
    return u.set(r, y), y;
  }
  function F(r) {
    return u.get(r) ?? A(r);
  }
  function m(r, n) {
    const l = d.get(r) ?? new Set();
    for (const y of l) {
      const k = C.get(y);
      k?.delete(r), k && k.size === 0 && C.delete(y);
    }
    for (const y of n) C.has(y) || C.set(y, new Set()), C.get(y).add(r);
    d.set(r, n);
  }
  function S(r) {
    const n = t[r];
    if (!n) return !1;
    const l = F(r);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let y;
      if (n.deps) (y = n.when(a)), O.set(r, new Set(n.deps));
      else {
        const k = Me(() => n.when(a));
        (y = k.value), O.set(r, k.deps);
      }
      return y instanceof Promise
        ? (p.add(r),
          (l.isAsync = !0),
          y
            .then(
              (k) => ((l.lastResult = k), (l.isEvaluating = !1), o?.(r, k), k),
            )
            .catch(
              (k) => (
                (l.error = k instanceof Error ? k : new Error(String(k))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                f?.(r, k),
                !1
              ),
            ))
        : ((l.lastResult = y), (l.isEvaluating = !1), o?.(r, y), y);
    } catch (y) {
      return (
        (l.error = y instanceof Error ? y : new Error(String(y))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        f?.(r, y),
        !1
      );
    }
  }
  async function b(r) {
    const n = t[r];
    if (!n) return !1;
    const l = F(r),
      y = n.timeout ?? i;
    if (((l.isEvaluating = !0), (l.error = null), n.deps?.length)) {
      const k = new Set(n.deps);
      m(r, k), O.set(r, k);
    }
    try {
      const k = n.when(a),
        q = await Ae(k, y, `Constraint "${r}" timed out after ${y}ms`);
      return (l.lastResult = q), (l.isEvaluating = !1), o?.(r, q), q;
    } catch (k) {
      return (
        (l.error = k instanceof Error ? k : new Error(String(k))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        f?.(r, k),
        !1
      );
    }
  }
  function I(r, n) {
    return r == null ? [] : Array.isArray(r) ? r.filter((y) => y != null) : [r];
  }
  function z(r) {
    const n = t[r];
    if (!n) return { requirements: [], deps: new Set() };
    const l = n.require;
    if (typeof l == "function") {
      const { value: y, deps: k } = Me(() => l(a));
      return { requirements: I(y), deps: k };
    }
    return { requirements: I(l), deps: new Set() };
  }
  function K(r, n) {
    if (n.size === 0) return;
    const l = d.get(r) ?? new Set();
    for (const y of n)
      l.add(y), C.has(y) || C.set(y, new Set()), C.get(y).add(r);
    d.set(r, l);
  }
  let P = null;
  function v() {
    return (
      P ||
        (P = Object.keys(t).sort((r, n) => {
          const l = F(r),
            y = F(n).priority - l.priority;
          if (y !== 0) return y;
          const k = c.get(r) ?? 0,
            q = c.get(n) ?? 0;
          return k - q;
        })),
      P
    );
  }
  for (const r of Object.keys(t)) A(r);
  function R(r) {
    const n = u.get(r);
    if (!n || n.after.length === 0) return !0;
    for (const l of n.after)
      if (t[l] && !h.has(l) && !x.has(l) && !E.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(r) {
      const n = new We();
      x.clear();
      let l = v().filter((B) => !h.has(B)),
        y;
      if (!j || !r || r.size === 0) (y = l), (j = !0);
      else {
        const B = new Set();
        for (const U of r) {
          const G = C.get(U);
          if (G) for (const ne of G) h.has(ne) || B.add(ne);
        }
        for (const U of _) h.has(U) || B.add(U);
        _.clear(), (y = [...B]);
        for (const U of l)
          if (!B.has(U)) {
            const G = D.get(U);
            if (G) for (const ne of G) n.add(ne);
          }
      }
      function k(B, U) {
        if (h.has(B)) return;
        const G = O.get(B);
        if (!U) {
          G !== void 0 && m(B, G), x.add(B), D.set(B, []);
          return;
        }
        x.delete(B);
        let ne, ee;
        try {
          const Z = z(B);
          (ne = Z.requirements), (ee = Z.deps);
        } catch (Z) {
          f?.(B, Z), G !== void 0 && m(B, G), D.set(B, []);
          return;
        }
        if (G !== void 0) {
          const Z = new Set(G);
          for (const J of ee) Z.add(J);
          m(B, Z);
        } else K(B, ee);
        if (ne.length > 0) {
          const Z = s[B],
            J = ne.map((V) => Vt(V, B, Z));
          for (const V of J) n.add(V);
          D.set(B, J);
        } else D.set(B, []);
      }
      async function q(B) {
        const U = [],
          G = [];
        for (const J of B)
          if (R(J)) G.push(J);
          else {
            U.push(J);
            const V = D.get(J);
            if (V) for (const X of V) n.add(X);
          }
        if (G.length === 0) return U;
        const ne = [],
          ee = [];
        for (const J of G) F(J).isAsync ? ee.push(J) : ne.push(J);
        const Z = [];
        for (const J of ne) {
          const V = S(J);
          if (V instanceof Promise) {
            Z.push({ id: J, promise: V });
            continue;
          }
          k(J, V);
        }
        if (Z.length > 0) {
          const J = await Promise.all(
            Z.map(async ({ id: V, promise: X }) => ({
              id: V,
              active: await X,
            })),
          );
          for (const { id: V, active: X } of J) k(V, X);
        }
        if (ee.length > 0) {
          const J = await Promise.all(
            ee.map(async (V) => ({ id: V, active: await b(V) })),
          );
          for (const { id: V, active: X } of J) k(V, X);
        }
        return U;
      }
      let L = y,
        H = y.length + 1;
      while (L.length > 0 && H > 0) {
        const B = L.length;
        if (((L = await q(L)), L.length === B)) break;
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
      h.add(r), (P = null), D.delete(r);
      const n = d.get(r);
      if (n) {
        for (const l of n) {
          const y = C.get(l);
          y && (y.delete(r), y.size === 0 && C.delete(l));
        }
        d.delete(r);
      }
      O.delete(r);
    },
    enable(r) {
      h.delete(r), (P = null), _.add(r);
    },
    invalidate(r) {
      const n = C.get(r);
      if (n) for (const l of n) _.add(l);
    },
    markResolved(r) {
      E.add(r);
      const n = u.get(r);
      n && (n.lastResolvedAt = Date.now());
      const l = T.get(r);
      if (l) for (const y of l) _.add(y);
    },
    isResolved(r) {
      return E.has(r);
    },
    registerDefinitions(r) {
      for (const [n, l] of Object.entries(r)) (t[n] = l), A(n), _.add(n);
      (P = null), g(), w();
    },
  };
}
function Zt(e) {
  let {
      definitions: t,
      facts: a,
      onCompute: s,
      onInvalidate: i,
      onError: o,
    } = e,
    f = new Map(),
    u = new Map(),
    h = new Map(),
    p = new Map(),
    d = new Set(["__proto__", "constructor", "prototype"]),
    C = 0,
    _ = new Set(),
    O = !1,
    D = 100,
    j;
  function E(g) {
    if (!t[g]) throw new Error(`[Directive] Unknown derivation: ${g}`);
    const $ = {
      id: g,
      compute: () => T(g),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return f.set(g, $), $;
  }
  function x(g) {
    return f.get(g) ?? E(g);
  }
  function T(g) {
    const $ = x(g),
      A = t[g];
    if (!A) throw new Error(`[Directive] Unknown derivation: ${g}`);
    if ($.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${g}`,
      );
    $.isComputing = !0;
    try {
      const { value: F, deps: m } = Me(() => A(a, j));
      return (
        ($.cachedValue = F), ($.isStale = !1), M(g, m), s?.(g, F, [...m]), F
      );
    } catch (F) {
      throw (o?.(g, F), F);
    } finally {
      $.isComputing = !1;
    }
  }
  function M(g, $) {
    const A = x(g),
      F = A.dependencies;
    for (const m of F)
      if (f.has(m)) {
        const S = p.get(m);
        S?.delete(g), S && S.size === 0 && p.delete(m);
      } else {
        const S = h.get(m);
        S?.delete(g), S && S.size === 0 && h.delete(m);
      }
    for (const m of $)
      t[m]
        ? (p.has(m) || p.set(m, new Set()), p.get(m).add(g))
        : (h.has(m) || h.set(m, new Set()), h.get(m).add(g));
    A.dependencies = $;
  }
  function c() {
    if (!(C > 0 || O)) {
      O = !0;
      try {
        let g = 0;
        while (_.size > 0) {
          if (++g > D) {
            const A = [..._];
            throw (
              (_.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${D} iterations. Remaining: ${A.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const $ = [..._];
          _.clear();
          for (const A of $) u.get(A)?.forEach((F) => F());
        }
      } finally {
        O = !1;
      }
    }
  }
  function w(g, $ = new Set()) {
    if ($.has(g)) return;
    $.add(g);
    const A = f.get(g);
    if (!A || A.isStale) return;
    (A.isStale = !0), i?.(g), _.add(g);
    const F = p.get(g);
    if (F) for (const m of F) w(m, $);
  }
  return (
    (j = new Proxy(
      {},
      {
        get(g, $) {
          if (typeof $ == "symbol" || d.has($)) return;
          Ke($);
          const A = x($);
          return A.isStale && T($), A.cachedValue;
        },
      },
    )),
    {
      get(g) {
        const $ = x(g);
        return $.isStale && T(g), $.cachedValue;
      },
      isStale(g) {
        return f.get(g)?.isStale ?? !0;
      },
      invalidate(g) {
        const $ = h.get(g);
        if ($) {
          C++;
          try {
            for (const A of $) w(A);
          } finally {
            C--, c();
          }
        }
      },
      invalidateMany(g) {
        C++;
        try {
          for (const $ of g) {
            const A = h.get($);
            if (A) for (const F of A) w(F);
          }
        } finally {
          C--, c();
        }
      },
      invalidateAll() {
        C++;
        try {
          for (const g of f.values())
            g.isStale || ((g.isStale = !0), _.add(g.id));
        } finally {
          C--, c();
        }
      },
      subscribe(g, $) {
        for (const A of g) {
          const F = A;
          u.has(F) || u.set(F, new Set()), u.get(F).add($);
        }
        return () => {
          for (const A of g) {
            const F = A,
              m = u.get(F);
            m?.delete($), m && m.size === 0 && u.delete(F);
          }
        };
      },
      getProxy() {
        return j;
      },
      getDependencies(g) {
        return x(g).dependencies;
      },
      registerDefinitions(g) {
        for (const [$, A] of Object.entries(g)) (t[$] = A), E($);
      },
    }
  );
}
function Qt(e) {
  let { definitions: t, facts: a, store: s, onRun: i, onError: o } = e,
    f = new Map(),
    u = null,
    h = !1;
  function p(E) {
    const x = t[E];
    if (!x) throw new Error(`[Directive] Unknown effect: ${E}`);
    const T = {
      id: E,
      enabled: !0,
      hasExplicitDeps: !!x.deps,
      dependencies: x.deps ? new Set(x.deps) : null,
      cleanup: null,
    };
    return f.set(E, T), T;
  }
  function d(E) {
    return f.get(E) ?? p(E);
  }
  function C() {
    return s.toObject();
  }
  function _(E, x) {
    const T = d(E);
    if (!T.enabled) return !1;
    if (T.dependencies) {
      for (const M of T.dependencies) if (x.has(M)) return !0;
      return !1;
    }
    return !0;
  }
  function O(E) {
    if (E.cleanup) {
      try {
        E.cleanup();
      } catch (x) {
        o?.(E.id, x),
          console.error(
            `[Directive] Effect "${E.id}" cleanup threw an error:`,
            x,
          );
      }
      E.cleanup = null;
    }
  }
  function D(E, x) {
    if (typeof x == "function")
      if (h)
        try {
          x();
        } catch (T) {
          o?.(E.id, T),
            console.error(
              `[Directive] Effect "${E.id}" cleanup threw an error:`,
              T,
            );
        }
      else E.cleanup = x;
  }
  async function j(E) {
    const x = d(E),
      T = t[E];
    if (!(!x.enabled || !T)) {
      O(x), i?.(E);
      try {
        if (x.hasExplicitDeps) {
          let M;
          if (
            (s.batch(() => {
              M = T.run(a, u);
            }),
            M instanceof Promise)
          ) {
            const c = await M;
            D(x, c);
          } else D(x, M);
        } else {
          let M = null,
            c,
            w = Me(
              () => (
                s.batch(() => {
                  c = T.run(a, u);
                }),
                c
              ),
            );
          M = w.deps;
          let g = w.value;
          g instanceof Promise && (g = await g),
            D(x, g),
            (x.dependencies = M.size > 0 ? M : null);
        }
      } catch (M) {
        o?.(E, M),
          console.error(`[Directive] Effect "${E}" threw an error:`, M);
      }
    }
  }
  for (const E of Object.keys(t)) p(E);
  return {
    async runEffects(E) {
      const x = [];
      for (const T of Object.keys(t)) _(T, E) && x.push(T);
      await Promise.all(x.map(j)), (u = C());
    },
    async runAll() {
      const E = Object.keys(t);
      await Promise.all(
        E.map((x) => (d(x).enabled ? j(x) : Promise.resolve())),
      ),
        (u = C());
    },
    disable(E) {
      const x = d(E);
      x.enabled = !1;
    },
    enable(E) {
      const x = d(E);
      x.enabled = !0;
    },
    isEnabled(E) {
      return d(E).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const E of f.values()) O(E);
    },
    registerDefinitions(E) {
      for (const [x, T] of Object.entries(E)) (t[x] = T), p(x);
    },
  };
}
function er(e = {}) {
  const {
      delayMs: t = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: s = 2,
      maxDelayMs: i = 3e4,
    } = e,
    o = new Map();
  function f(u) {
    const h = t * Math.pow(s, u - 1);
    return Math.min(h, i);
  }
  return {
    scheduleRetry(u, h, p, d, C) {
      if (d > a) return null;
      const _ = f(d),
        O = {
          source: u,
          sourceId: h,
          context: p,
          attempt: d,
          nextRetryTime: Date.now() + _,
          callback: C,
        };
      return o.set(h, O), O;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const u = Date.now(),
        h = [];
      for (const [p, d] of o) d.nextRetryTime <= u && (h.push(d), o.delete(p));
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
var tr = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function rr(e = {}) {
  const { config: t = {}, onError: a, onRecovery: s } = e,
    i = [],
    o = 100,
    f = er(t.retryLater),
    u = new Map();
  function h(d, C, _, O) {
    if (_ instanceof rt) return _;
    const D = _ instanceof Error ? _.message : String(_),
      j = d !== "system";
    return new rt(D, d, C, O, j);
  }
  function p(d, C, _) {
    const O = (() => {
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
    if (typeof O == "function") {
      try {
        O(_, C);
      } catch (D) {
        console.error("[Directive] Error in error handler callback:", D);
      }
      return "skip";
    }
    return typeof O == "string" ? O : tr[d];
  }
  return {
    handleError(d, C, _, O) {
      const D = h(d, C, _, O);
      i.push(D), i.length > o && i.shift();
      try {
        a?.(D);
      } catch (E) {
        console.error("[Directive] Error in onError callback:", E);
      }
      try {
        t.onError?.(D);
      } catch (E) {
        console.error("[Directive] Error in config.onError callback:", E);
      }
      let j = p(d, C, _ instanceof Error ? _ : new Error(String(_)));
      if (j === "retry-later") {
        const E = (u.get(C) ?? 0) + 1;
        u.set(C, E),
          f.scheduleRetry(d, C, O, E) ||
            ((j = "skip"), u.delete(C), typeof process < "u");
      }
      try {
        s?.(D, j);
      } catch (E) {
        console.error("[Directive] Error in onRecovery callback:", E);
      }
      if (j === "throw") throw D;
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
      return f;
    },
    processDueRetries() {
      return f.processDueRetries();
    },
    clearRetryAttempts(d) {
      u.delete(d), f.cancelRetry(d);
    },
  };
}
function nr() {
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
  async function a(s) {
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
      for (const i of e) await a(() => i.onInit?.(s));
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
      for (const f of e) t(() => f.onFactSet?.(s, i, o));
    },
    emitFactDelete(s, i) {
      for (const o of e) t(() => o.onFactDelete?.(s, i));
    },
    emitFactsBatch(s) {
      for (const i of e) t(() => i.onFactsBatch?.(s));
    },
    emitDerivationCompute(s, i, o) {
      for (const f of e) t(() => f.onDerivationCompute?.(s, i, o));
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
      for (const f of e) t(() => f.onResolverComplete?.(s, i, o));
    },
    emitResolverError(s, i, o) {
      for (const f of e) t(() => f.onResolverError?.(s, i, o));
    },
    emitResolverRetry(s, i, o) {
      for (const f of e) t(() => f.onResolverRetry?.(s, i, o));
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
var st = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  it = { enabled: !1, windowMs: 50 };
function ot(e, t) {
  let { backoff: a, initialDelay: s = 100, maxDelay: i = 3e4 } = e,
    o;
  switch (a) {
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
function sr(e) {
  const {
      definitions: t,
      facts: a,
      store: s,
      onStart: i,
      onComplete: o,
      onError: f,
      onRetry: u,
      onCancel: h,
      onResolutionComplete: p,
    } = e,
    d = new Map(),
    C = new Map(),
    _ = 1e3,
    O = new Map(),
    D = new Map(),
    j = 1e3;
  function E() {
    if (C.size > _) {
      const m = C.size - _,
        S = C.keys();
      for (let b = 0; b < m; b++) {
        const I = S.next().value;
        I && C.delete(I);
      }
    }
  }
  function x(m) {
    return (
      typeof m == "object" &&
      m !== null &&
      "requirement" in m &&
      typeof m.requirement == "string"
    );
  }
  function T(m) {
    return (
      typeof m == "object" &&
      m !== null &&
      "requirement" in m &&
      typeof m.requirement == "function"
    );
  }
  function M(m, S) {
    return x(m) ? S.type === m.requirement : T(m) ? m.requirement(S) : !1;
  }
  function c(m) {
    const S = m.type,
      b = D.get(S);
    if (b)
      for (const I of b) {
        const z = t[I];
        if (z && M(z, m)) return I;
      }
    for (const [I, z] of Object.entries(t))
      if (M(z, m)) {
        if (!D.has(S)) {
          if (D.size >= j) {
            const P = D.keys().next().value;
            P !== void 0 && D.delete(P);
          }
          D.set(S, []);
        }
        const K = D.get(S);
        return K.includes(I) || K.push(I), I;
      }
    return null;
  }
  function w(m) {
    return { facts: a, signal: m, snapshot: () => a.$snapshot() };
  }
  async function g(m, S, b) {
    const I = t[m];
    if (!I) return;
    let z = { ...st, ...I.retry },
      K = null;
    for (let P = 1; P <= z.attempts; P++) {
      if (b.signal.aborted) return;
      const v = d.get(S.id);
      v &&
        ((v.attempt = P),
        (v.status = {
          state: "running",
          requirementId: S.id,
          startedAt: v.startedAt,
          attempt: P,
        }));
      try {
        const R = w(b.signal);
        if (I.resolve) {
          let n;
          s.batch(() => {
            n = I.resolve(S.requirement, R);
          });
          const l = I.timeout;
          l && l > 0
            ? await Ae(n, l, `Resolver "${m}" timed out after ${l}ms`)
            : await n;
        }
        const r = Date.now() - (v?.startedAt ?? Date.now());
        C.set(S.id, {
          state: "success",
          requirementId: S.id,
          completedAt: Date.now(),
          duration: r,
        }),
          E(),
          o?.(m, S, r);
        return;
      } catch (R) {
        if (
          ((K = R instanceof Error ? R : new Error(String(R))),
          b.signal.aborted)
        )
          return;
        if (z.shouldRetry && !z.shouldRetry(K, P)) break;
        if (P < z.attempts) {
          if (b.signal.aborted) return;
          const r = ot(z, P);
          if (
            (u?.(m, S, P + 1),
            await new Promise((n) => {
              const l = setTimeout(n, r),
                y = () => {
                  clearTimeout(l), n();
                };
              b.signal.addEventListener("abort", y, { once: !0 });
            }),
            b.signal.aborted)
          )
            return;
        }
      }
    }
    C.set(S.id, {
      state: "error",
      requirementId: S.id,
      error: K,
      failedAt: Date.now(),
      attempts: z.attempts,
    }),
      E(),
      f?.(m, S, K);
  }
  async function $(m, S) {
    const b = t[m];
    if (!b) return;
    if (!b.resolveBatch && !b.resolveBatchWithResults) {
      await Promise.all(
        S.map((r) => {
          const n = new AbortController();
          return g(m, r, n);
        }),
      );
      return;
    }
    let I = { ...st, ...b.retry },
      z = { ...it, ...b.batch },
      K = new AbortController(),
      P = Date.now(),
      v = null,
      R = z.timeoutMs ?? b.timeout;
    for (let r = 1; r <= I.attempts; r++) {
      if (K.signal.aborted) return;
      try {
        const n = w(K.signal),
          l = S.map((y) => y.requirement);
        if (b.resolveBatchWithResults) {
          let y, k;
          if (
            (s.batch(() => {
              k = b.resolveBatchWithResults(l, n);
            }),
            R && R > 0
              ? (y = await Ae(
                  k,
                  R,
                  `Batch resolver "${m}" timed out after ${R}ms`,
                ))
              : (y = await k),
            y.length !== S.length)
          )
            throw new Error(
              `[Directive] Batch resolver "${m}" returned ${y.length} results but expected ${S.length}. Results array must match input order.`,
            );
          let q = Date.now() - P,
            L = !1;
          for (let H = 0; H < S.length; H++) {
            const B = S[H],
              U = y[H];
            if (U.success)
              C.set(B.id, {
                state: "success",
                requirementId: B.id,
                completedAt: Date.now(),
                duration: q,
              }),
                o?.(m, B, q);
            else {
              L = !0;
              const G = U.error ?? new Error("Batch item failed");
              C.set(B.id, {
                state: "error",
                requirementId: B.id,
                error: G,
                failedAt: Date.now(),
                attempts: r,
              }),
                f?.(m, B, G);
            }
          }
          if (!L || S.some((H, B) => y[B]?.success)) return;
        } else {
          let y;
          s.batch(() => {
            y = b.resolveBatch(l, n);
          }),
            R && R > 0
              ? await Ae(y, R, `Batch resolver "${m}" timed out after ${R}ms`)
              : await y;
          const k = Date.now() - P;
          for (const q of S)
            C.set(q.id, {
              state: "success",
              requirementId: q.id,
              completedAt: Date.now(),
              duration: k,
            }),
              o?.(m, q, k);
          return;
        }
      } catch (n) {
        if (
          ((v = n instanceof Error ? n : new Error(String(n))),
          K.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(v, r)) break;
        if (r < I.attempts) {
          const l = ot(I, r);
          for (const y of S) u?.(m, y, r + 1);
          if (
            (await new Promise((y) => {
              const k = setTimeout(y, l),
                q = () => {
                  clearTimeout(k), y();
                };
              K.signal.addEventListener("abort", q, { once: !0 });
            }),
            K.signal.aborted)
          )
            return;
        }
      }
    }
    for (const r of S)
      C.set(r.id, {
        state: "error",
        requirementId: r.id,
        error: v,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        f?.(m, r, v);
    E();
  }
  function A(m, S) {
    const b = t[m];
    if (!b) return;
    const I = { ...it, ...b.batch };
    O.has(m) || O.set(m, { resolverId: m, requirements: [], timer: null });
    const z = O.get(m);
    z.requirements.push(S),
      z.timer && clearTimeout(z.timer),
      (z.timer = setTimeout(() => {
        F(m);
      }, I.windowMs));
  }
  function F(m) {
    const S = O.get(m);
    if (!S || S.requirements.length === 0) return;
    const b = [...S.requirements];
    (S.requirements = []),
      (S.timer = null),
      $(m, b).then(() => {
        p?.();
      });
  }
  return {
    resolve(m) {
      if (d.has(m.id)) return;
      const S = c(m.requirement);
      if (!S) {
        console.warn(`[Directive] No resolver found for requirement: ${m.id}`);
        return;
      }
      const b = t[S];
      if (!b) return;
      if (b.batch?.enabled) {
        A(S, m);
        return;
      }
      const I = new AbortController(),
        z = Date.now(),
        K = {
          requirementId: m.id,
          resolverId: S,
          controller: I,
          startedAt: z,
          attempt: 1,
          status: { state: "pending", requirementId: m.id, startedAt: z },
          originalRequirement: m,
        };
      d.set(m.id, K),
        i?.(S, m),
        g(S, m, I).finally(() => {
          d.delete(m.id) && p?.();
        });
    },
    cancel(m) {
      const S = d.get(m);
      S &&
        (S.controller.abort(),
        d.delete(m),
        C.set(m, {
          state: "canceled",
          requirementId: m,
          canceledAt: Date.now(),
        }),
        E(),
        h?.(S.resolverId, S.originalRequirement));
    },
    cancelAll() {
      for (const [m] of d) this.cancel(m);
      for (const m of O.values()) m.timer && clearTimeout(m.timer);
      O.clear();
    },
    getStatus(m) {
      const S = d.get(m);
      return S ? S.status : C.get(m) || { state: "idle" };
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
      for (const m of O.keys()) F(m);
    },
    registerDefinitions(m) {
      for (const [S, b] of Object.entries(m)) t[S] = b;
      D.clear();
    },
  };
}
function ir(e) {
  let { config: t, facts: a, store: s, onSnapshot: i, onTimeTravel: o } = e,
    f = t.timeTravel ?? !1,
    u = t.maxSnapshots ?? 100,
    h = [],
    p = -1,
    d = 1,
    C = !1,
    _ = !1,
    O = [],
    D = null,
    j = -1;
  function E() {
    return s.toObject();
  }
  function x() {
    const M = E();
    return structuredClone(M);
  }
  function T(M) {
    if (!Ee(M)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    s.batch(() => {
      for (const [c, w] of Object.entries(M)) {
        if (c === "__proto__" || c === "constructor" || c === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${c}" during fact restoration`,
          );
          continue;
        }
        a[c] = w;
      }
    });
  }
  return {
    get isEnabled() {
      return f;
    },
    get isRestoring() {
      return _;
    },
    get isPaused() {
      return C;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return p;
    },
    takeSnapshot(M) {
      if (!f || C)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: M };
      const c = { id: d++, timestamp: Date.now(), facts: x(), trigger: M };
      for (
        p < h.length - 1 && h.splice(p + 1), h.push(c), p = h.length - 1;
        h.length > u;
      )
        h.shift(), p--;
      return i?.(c), c;
    },
    restore(M) {
      if (f) {
        (C = !0), (_ = !0);
        try {
          T(M.facts);
        } finally {
          (C = !1), (_ = !1);
        }
      }
    },
    goBack(M = 1) {
      if (!f || h.length === 0) return;
      let c = p,
        w = p,
        g = O.find((A) => p > A.startIndex && p <= A.endIndex);
      if (g) w = g.startIndex;
      else if (O.find((A) => p === A.startIndex)) {
        const A = O.find((F) => F.endIndex < p && p - F.endIndex <= M);
        w = A ? A.startIndex : Math.max(0, p - M);
      } else w = Math.max(0, p - M);
      if (c === w) return;
      p = w;
      const $ = h[p];
      $ && (this.restore($), o?.(c, w));
    },
    goForward(M = 1) {
      if (!f || h.length === 0) return;
      let c = p,
        w = p,
        g = O.find((A) => p >= A.startIndex && p < A.endIndex);
      if ((g ? (w = g.endIndex) : (w = Math.min(h.length - 1, p + M)), c === w))
        return;
      p = w;
      const $ = h[p];
      $ && (this.restore($), o?.(c, w));
    },
    goTo(M) {
      if (!f) return;
      const c = h.findIndex(($) => $.id === M);
      if (c === -1) {
        console.warn(`[Directive] Snapshot ${M} not found`);
        return;
      }
      const w = p;
      p = c;
      const g = h[p];
      g && (this.restore(g), o?.(w, c));
    },
    replay() {
      if (!f || h.length === 0) return;
      p = 0;
      const M = h[0];
      M && this.restore(M);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: p });
    },
    import(M) {
      if (f)
        try {
          const c = JSON.parse(M);
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
          for (const g of c.snapshots) {
            if (typeof g != "object" || g === null)
              throw new Error("Invalid snapshot: expected object");
            if (
              typeof g.id != "number" ||
              typeof g.timestamp != "number" ||
              typeof g.trigger != "string" ||
              typeof g.facts != "object"
            )
              throw new Error("Invalid snapshot structure");
            if (!Ee(g.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...c.snapshots), (p = c.currentIndex);
          const w = h[p];
          w && this.restore(w);
        } catch (c) {
          console.error("[Directive] Failed to import time-travel data:", c);
        }
    },
    beginChangeset(M) {
      f && ((D = M), (j = p));
    },
    endChangeset() {
      !f ||
        D === null ||
        (p > j && O.push({ label: D, startIndex: j, endIndex: p }),
        (D = null),
        (j = -1));
    },
    pause() {
      C = !0;
    },
    resume() {
      C = !1;
    },
  };
}
function or() {
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
function Ct(e) {
  const t = Object.create(null),
    a = Object.create(null),
    s = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    f = Object.create(null);
  for (const r of e.modules) {
    const n = (l, y) => {
      if (l) {
        for (const k of Object.keys(l))
          if (ce.has(k))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${k}" in ${y}. This could indicate a prototype pollution attempt.`,
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
      r.derive && Object.assign(s, r.derive),
      r.effects && Object.assign(i, r.effects),
      r.constraints && Object.assign(o, r.constraints),
      r.resolvers && Object.assign(f, r.resolvers);
  }
  let u = null;
  if (e.modules.some((r) => r.snapshotEvents)) {
    u = new Set();
    for (const r of e.modules) {
      const n = r;
      if (n.snapshotEvents) for (const l of n.snapshotEvents) u.add(l);
      else if (n.events) for (const l of Object.keys(n.events)) u.add(l);
    }
  }
  let h = 0,
    p = !1,
    d = nr();
  for (const r of e.plugins ?? []) d.register(r);
  let C = rr({
      config: e.errorBoundary,
      onError: (r) => d.emitError(r),
      onRecovery: (r, n) => d.emitErrorRecovery(r, n),
    }),
    _ = () => {},
    O = () => {},
    D = null,
    { store: j, facts: E } = Wt({
      schema: t,
      onChange: (r, n, l) => {
        d.emitFactSet(r, n, l),
          _(r),
          !D?.isRestoring && (h === 0 && (p = !0), b.changedKeys.add(r), I());
      },
      onBatch: (r) => {
        d.emitFactsBatch(r);
        const n = [];
        for (const l of r) n.push(l.key);
        if ((O(n), !D?.isRestoring)) {
          h === 0 && (p = !0);
          for (const l of r) b.changedKeys.add(l.key);
          I();
        }
      },
    }),
    x = Zt({
      definitions: s,
      facts: E,
      onCompute: (r, n, l) => d.emitDerivationCompute(r, n, l),
      onInvalidate: (r) => d.emitDerivationInvalidate(r),
      onError: (r, n) => {
        C.handleError("derivation", r, n);
      },
    });
  (_ = (r) => x.invalidate(r)), (O = (r) => x.invalidateMany(r));
  const T = Qt({
      definitions: i,
      facts: E,
      store: j,
      onRun: (r) => d.emitEffectRun(r),
      onError: (r, n) => {
        C.handleError("effect", r, n), d.emitEffectError(r, n);
      },
    }),
    M = Xt({
      definitions: o,
      facts: E,
      onEvaluate: (r, n) => d.emitConstraintEvaluate(r, n),
      onError: (r, n) => {
        C.handleError("constraint", r, n), d.emitConstraintError(r, n);
      },
    }),
    c = sr({
      definitions: f,
      facts: E,
      store: j,
      onStart: (r, n) => d.emitResolverStart(r, n),
      onComplete: (r, n, l) => {
        d.emitResolverComplete(r, n, l),
          d.emitRequirementMet(n, r),
          M.markResolved(n.fromConstraint);
      },
      onError: (r, n, l) => {
        C.handleError("resolver", r, l, n), d.emitResolverError(r, n, l);
      },
      onRetry: (r, n, l) => d.emitResolverRetry(r, n, l),
      onCancel: (r, n) => {
        d.emitResolverCancel(r, n), d.emitRequirementCanceled(n);
      },
      onResolutionComplete: () => {
        F(), I();
      },
    }),
    w = new Set();
  function g() {
    for (const r of w) r();
  }
  const $ = e.debug?.timeTravel
    ? ir({
        config: e.debug,
        facts: E,
        store: j,
        onSnapshot: (r) => {
          d.emitSnapshot(r), g();
        },
        onTimeTravel: (r, n) => {
          d.emitTimeTravel(r, n), g();
        },
      })
    : or();
  D = $;
  const A = new Set();
  function F() {
    for (const r of A) r();
  }
  let m = 50,
    S = 0,
    b = {
      isRunning: !1,
      isReconciling: !1,
      reconcileScheduled: !1,
      isInitializing: !1,
      isInitialized: !1,
      isReady: !1,
      isDestroyed: !1,
      changedKeys: new Set(),
      previousRequirements: new We(),
      readyPromise: null,
      readyResolve: null,
    };
  function I() {
    !b.isRunning ||
      b.reconcileScheduled ||
      b.isInitializing ||
      ((b.reconcileScheduled = !0),
      F(),
      queueMicrotask(() => {
        (b.reconcileScheduled = !1),
          b.isRunning && !b.isInitializing && z().catch((r) => {});
      }));
  }
  async function z() {
    if (!b.isReconciling) {
      if ((S++, S > m)) {
        S = 0;
        return;
      }
      (b.isReconciling = !0), F();
      try {
        b.changedKeys.size > 0 &&
          ((u === null || p) &&
            $.takeSnapshot(`facts-changed:${[...b.changedKeys].join(",")}`),
          (p = !1));
        const r = E.$snapshot();
        d.emitReconcileStart(r), await T.runEffects(b.changedKeys);
        const n = new Set(b.changedKeys);
        b.changedKeys.clear();
        const l = await M.evaluate(n),
          y = new We();
        for (const B of l) y.add(B), d.emitRequirementCreated(B);
        const { added: k, removed: q } = y.diff(b.previousRequirements);
        for (const B of q) c.cancel(B.id);
        for (const B of k) c.resolve(B);
        b.previousRequirements = y;
        const L = c.getInflightInfo(),
          H = {
            unmet: l.filter((B) => !c.isResolving(B.id)),
            inflight: L,
            completed: [],
            canceled: q.map((B) => ({
              id: B.id,
              resolverId: L.find((U) => U.id === B.id)?.resolverId ?? "unknown",
            })),
          };
        d.emitReconcileEnd(H),
          b.isReady ||
            ((b.isReady = !0),
            b.readyResolve && (b.readyResolve(), (b.readyResolve = null)));
      } finally {
        (b.isReconciling = !1),
          b.changedKeys.size > 0 ? I() : b.reconcileScheduled || (S = 0),
          F();
      }
    }
  }
  const K = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ce.has(n)) return x.get(n);
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
    P = new Proxy(
      {},
      {
        get(r, n) {
          if (typeof n != "symbol" && !ce.has(n))
            return (l) => {
              const y = a[n];
              if (y) {
                h++, (u === null || u.has(n)) && (p = !0);
                try {
                  j.batch(() => {
                    y(E, { type: n, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(r, n) {
          return typeof n == "symbol" || ce.has(n) ? !1 : n in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(r, n) {
          if (typeof n != "symbol" && !ce.has(n) && n in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    v = {
      facts: E,
      debug: $.isEnabled ? $ : null,
      derive: K,
      events: P,
      constraints: { disable: (r) => M.disable(r), enable: (r) => M.enable(r) },
      effects: {
        disable: (r) => T.disable(r),
        enable: (r) => T.enable(r),
        isEnabled: (r) => T.isEnabled(r),
      },
      initialize() {
        if (!b.isInitialized) {
          b.isInitializing = !0;
          for (const r of e.modules)
            r.init &&
              j.batch(() => {
                r.init(E);
              });
          e.onAfterModuleInit &&
            j.batch(() => {
              e.onAfterModuleInit();
            }),
            (b.isInitializing = !1),
            (b.isInitialized = !0);
          for (const r of Object.keys(s)) x.get(r);
        }
      },
      start() {
        if (!b.isRunning) {
          b.isInitialized || this.initialize(), (b.isRunning = !0);
          for (const r of e.modules) r.hooks?.onStart?.(v);
          d.emitStart(v), I();
        }
      },
      stop() {
        if (b.isRunning) {
          (b.isRunning = !1), c.cancelAll(), T.cleanupAll();
          for (const r of e.modules) r.hooks?.onStop?.(v);
          d.emitStop(v);
        }
      },
      destroy() {
        this.stop(),
          (b.isDestroyed = !0),
          A.clear(),
          w.clear(),
          d.emitDestroy(v);
      },
      dispatch(r) {
        if (ce.has(r.type)) return;
        const n = a[r.type];
        if (n) {
          h++, (u === null || u.has(r.type)) && (p = !0);
          try {
            j.batch(() => {
              n(E, r);
            });
          } finally {
            h--;
          }
        }
      },
      read(r) {
        return x.get(r);
      },
      subscribe(r, n) {
        const l = [],
          y = [];
        for (const q of r) q in s ? l.push(q) : q in t && y.push(q);
        const k = [];
        return (
          l.length > 0 && k.push(x.subscribe(l, n)),
          y.length > 0 && k.push(j.subscribe(y, n)),
          () => {
            for (const q of k) q();
          }
        );
      },
      watch(r, n, l) {
        const y = l?.equalityFn
          ? (q, L) => l.equalityFn(q, L)
          : (q, L) => Object.is(q, L);
        if (r in s) {
          let q = x.get(r);
          return x.subscribe([r], () => {
            const L = x.get(r);
            if (!y(L, q)) {
              const H = q;
              (q = L), n(L, H);
            }
          });
        }
        let k = j.get(r);
        return j.subscribe([r], () => {
          const q = j.get(r);
          if (!y(q, k)) {
            const L = k;
            (k = q), n(q, L);
          }
        });
      },
      when(r, n) {
        return new Promise((l, y) => {
          const k = j.toObject();
          if (r(k)) {
            l();
            return;
          }
          let q,
            L,
            H = () => {
              q?.(), L !== void 0 && clearTimeout(L);
            };
          (q = j.subscribeAll(() => {
            const B = j.toObject();
            r(B) && (H(), l());
          })),
            n?.timeout !== void 0 &&
              n.timeout > 0 &&
              (L = setTimeout(() => {
                H(),
                  y(
                    new Error(
                      `[Directive] when: timed out after ${n.timeout}ms`,
                    ),
                  );
              }, n.timeout));
        });
      },
      inspect() {
        return {
          unmet: b.previousRequirements.all(),
          inflight: c.getInflightInfo(),
          constraints: M.getAllStates().map((r) => ({
            id: r.id,
            active: r.lastResult ?? !1,
            priority: r.priority,
          })),
          resolvers: Object.fromEntries(
            c.getInflight().map((r) => [r, c.getStatus(r)]),
          ),
        };
      },
      explain(r) {
        const n = b.previousRequirements.all().find((U) => U.id === r);
        if (!n) return null;
        const l = M.getState(n.fromConstraint),
          y = c.getStatus(r),
          k = {},
          q = j.toObject();
        for (const [U, G] of Object.entries(q)) k[U] = G;
        const L = [
            `Requirement "${n.requirement.type}" (id: ${n.id})`,
            `├─ Produced by constraint: ${n.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${y.state}`,
          ],
          H = Object.entries(n.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, G]) => `${U}=${JSON.stringify(G)}`)
            .join(", ");
        H && L.push(`├─ Requirement payload: { ${H} }`);
        const B = Object.entries(k).slice(0, 10);
        return (
          B.length > 0 &&
            (L.push("└─ Relevant facts:"),
            B.forEach(([U, G], ne) => {
              const ee = ne === B.length - 1 ? "   └─" : "   ├─",
                Z = typeof G == "object" ? JSON.stringify(G) : String(G);
              L.push(
                `${ee} ${U} = ${Z.slice(0, 50)}${Z.length > 50 ? "..." : ""}`,
              );
            })),
          L.join(`
`)
        );
      },
      async settle(r = 5e3) {
        const n = Date.now();
        for (;;) {
          await new Promise((y) => setTimeout(y, 0));
          const l = this.inspect();
          if (
            l.inflight.length === 0 &&
            !b.isReconciling &&
            !b.reconcileScheduled
          )
            return;
          if (Date.now() - n > r) {
            const y = [];
            l.inflight.length > 0 &&
              y.push(
                `${l.inflight.length} resolvers inflight: ${l.inflight.map((q) => q.resolverId).join(", ")}`,
              ),
              b.isReconciling && y.push("reconciliation in progress"),
              b.reconcileScheduled && y.push("reconcile scheduled");
            const k = b.previousRequirements.all();
            throw (
              (k.length > 0 &&
                y.push(
                  `${k.length} unmet requirements: ${k.map((q) => q.requirement.type).join(", ")}`,
                ),
              new Error(
                `[Directive] settle() timed out after ${r}ms. ${y.join("; ")}`,
              ))
            );
          }
          await new Promise((y) => setTimeout(y, 10));
        }
      },
      getSnapshot() {
        return { facts: j.toObject(), version: 1 };
      },
      getDistributableSnapshot(r = {}) {
        let {
            includeDerivations: n,
            excludeDerivations: l,
            includeFacts: y,
            ttlSeconds: k,
            metadata: q,
            includeVersion: L,
          } = r,
          H = {},
          B = Object.keys(s),
          U;
        if ((n ? (U = n.filter((ee) => B.includes(ee))) : (U = B), l)) {
          const ee = new Set(l);
          U = U.filter((Z) => !ee.has(Z));
        }
        for (const ee of U)
          try {
            H[ee] = x.get(ee);
          } catch {}
        if (y && y.length > 0) {
          const ee = j.toObject();
          for (const Z of y) Z in ee && (H[Z] = ee[Z]);
        }
        const G = Date.now(),
          ne = { data: H, createdAt: G };
        return (
          k !== void 0 && k > 0 && (ne.expiresAt = G + k * 1e3),
          L && (ne.version = Ut(H)),
          q && (ne.metadata = q),
          ne
        );
      },
      watchDistributableSnapshot(r, n) {
        let { includeDerivations: l, excludeDerivations: y } = r,
          k = Object.keys(s),
          q;
        if ((l ? (q = l.filter((H) => k.includes(H))) : (q = k), y)) {
          const H = new Set(y);
          q = q.filter((B) => !H.has(B));
        }
        if (q.length === 0) return () => {};
        let L = this.getDistributableSnapshot({
          ...r,
          includeVersion: !0,
        }).version;
        return x.subscribe(q, () => {
          const H = this.getDistributableSnapshot({ ...r, includeVersion: !0 });
          H.version !== L && ((L = H.version), n(H));
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
        if (!Ee(r))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        j.batch(() => {
          for (const [n, l] of Object.entries(r.facts))
            ce.has(n) || j.set(n, l);
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
          w.add(r),
          () => {
            w.delete(r);
          }
        );
      },
      batch(r) {
        j.batch(r);
      },
      get isSettled() {
        return (
          this.inspect().inflight.length === 0 &&
          !b.isReconciling &&
          !b.reconcileScheduled
        );
      },
      get isRunning() {
        return b.isRunning;
      },
      get isInitialized() {
        return b.isInitialized;
      },
      get isReady() {
        return b.isReady;
      },
      whenReady() {
        return b.isReady
          ? Promise.resolve()
          : b.isRunning
            ? (b.readyPromise ||
                (b.readyPromise = new Promise((r) => {
                  b.readyResolve = r;
                })),
              b.readyPromise)
            : Promise.reject(
                new Error(
                  "[Directive] whenReady() called before start(). Call system.start() first, then await system.whenReady().",
                ),
              );
      },
    };
  function R(r) {
    if (b.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (b.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${r.id}" on a destroyed system.`,
      );
    const n = (l, y) => {
      if (l) {
        for (const k of Object.keys(l))
          if (ce.has(k))
            throw new Error(
              `[Directive] Security: Module "${r.id}" has dangerous key "${k}" in ${y}.`,
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
      u === null && (u = new Set(Object.keys(a)));
      for (const l of r.snapshotEvents) u.add(l);
    } else if (u !== null && r.events)
      for (const l of Object.keys(r.events)) u.add(l);
    Object.assign(t, r.schema),
      r.events && Object.assign(a, r.events),
      r.derive && (Object.assign(s, r.derive), x.registerDefinitions(r.derive)),
      r.effects &&
        (Object.assign(i, r.effects), T.registerDefinitions(r.effects)),
      r.constraints &&
        (Object.assign(o, r.constraints), M.registerDefinitions(r.constraints)),
      r.resolvers &&
        (Object.assign(f, r.resolvers), c.registerDefinitions(r.resolvers)),
      j.registerKeys(r.schema),
      e.modules.push(r),
      r.init &&
        j.batch(() => {
          r.init(E);
        }),
      r.hooks?.onInit?.(v),
      b.isRunning && (r.hooks?.onStart?.(v), I());
  }
  (v.registerModule = R), d.emitInit(v);
  for (const r of e.modules) r.hooks?.onInit?.(v);
  return v;
}
var se = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  W = "::";
function ar(e) {
  const t = Object.keys(e),
    a = new Set(),
    s = new Set(),
    i = [],
    o = [];
  function f(u) {
    if (a.has(u)) return;
    if (s.has(u)) {
      const p = o.indexOf(u),
        d = [...o.slice(p), u].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${d}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    s.add(u), o.push(u);
    const h = e[u];
    if (h?.crossModuleDeps)
      for (const p of Object.keys(h.crossModuleDeps)) t.includes(p) && f(p);
    o.pop(), s.delete(u), a.add(u), i.push(u);
  }
  for (const u of t) f(u);
  return i;
}
var at = new WeakMap(),
  lt = new WeakMap(),
  ct = new WeakMap(),
  ut = new WeakMap();
function lr(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return fr(e);
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
  return cr(t);
}
function cr(e) {
  const t = e.modules,
    a = new Set(Object.keys(t)),
    s = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const c = o,
      w = Object.keys(t).filter((g) => !c.includes(g));
    if (w.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${w.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = c;
  } else o === "declaration" ? (i = Object.keys(t)) : (i = ar(t));
  let f = e.debug,
    u = e.errorBoundary;
  e.zeroConfig &&
    ((f = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (u = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const c of Object.keys(t)) {
    if (c.includes(W))
      throw new Error(
        `[Directive] Module name "${c}" contains the reserved separator "${W}". Module names cannot contain "${W}".`,
      );
    const w = t[c];
    if (w) {
      for (const g of Object.keys(w.schema.facts))
        if (g.includes(W))
          throw new Error(
            `[Directive] Schema key "${g}" in module "${c}" contains the reserved separator "${W}". Schema keys cannot contain "${W}".`,
          );
    }
  }
  const h = [];
  for (const c of i) {
    const w = t[c];
    if (!w) continue;
    const g = w.crossModuleDeps && Object.keys(w.crossModuleDeps).length > 0,
      $ = g ? Object.keys(w.crossModuleDeps) : [],
      A = {};
    for (const [v, R] of Object.entries(w.schema.facts)) A[`${c}${W}${v}`] = R;
    const F = {};
    if (w.schema.derivations)
      for (const [v, R] of Object.entries(w.schema.derivations))
        F[`${c}${W}${v}`] = R;
    const m = {};
    if (w.schema.events)
      for (const [v, R] of Object.entries(w.schema.events))
        m[`${c}${W}${v}`] = R;
    const S = w.init
        ? (v) => {
            const R = oe(v, c);
            w.init(R);
          }
        : void 0,
      b = {};
    if (w.derive)
      for (const [v, R] of Object.entries(w.derive))
        b[`${c}${W}${v}`] = (r, n) => {
          const l = g ? ue(r, c, $) : oe(r, c),
            y = Je(n, c);
          return R(l, y);
        };
    const I = {};
    if (w.events)
      for (const [v, R] of Object.entries(w.events))
        I[`${c}${W}${v}`] = (r, n) => {
          const l = oe(r, c);
          R(l, n);
        };
    const z = {};
    if (w.constraints)
      for (const [v, R] of Object.entries(w.constraints)) {
        const r = R;
        z[`${c}${W}${v}`] = {
          ...r,
          deps: r.deps?.map((n) => `${c}${W}${n}`),
          when: (n) => {
            const l = g ? ue(n, c, $) : oe(n, c);
            return r.when(l);
          },
          require:
            typeof r.require == "function"
              ? (n) => {
                  const l = g ? ue(n, c, $) : oe(n, c);
                  return r.require(l);
                }
              : r.require,
        };
      }
    const K = {};
    if (w.resolvers)
      for (const [v, R] of Object.entries(w.resolvers)) {
        const r = R;
        K[`${c}${W}${v}`] = {
          ...r,
          resolve: async (n, l) => {
            const y = _e(l.facts, t, () => Object.keys(t));
            await r.resolve(n, { facts: y[c], signal: l.signal });
          },
        };
      }
    const P = {};
    if (w.effects)
      for (const [v, R] of Object.entries(w.effects)) {
        const r = R;
        P[`${c}${W}${v}`] = {
          ...r,
          run: (n, l) => {
            const y = g ? ue(n, c, $) : oe(n, c),
              k = l ? (g ? ue(l, c, $) : oe(l, c)) : void 0;
            return r.run(y, k);
          },
          deps: r.deps?.map((n) => `${c}${W}${n}`),
        };
      }
    h.push({
      id: w.id,
      schema: {
        facts: A,
        derivations: F,
        events: m,
        requirements: w.schema.requirements ?? {},
      },
      init: S,
      derive: b,
      events: I,
      effects: P,
      constraints: z,
      resolvers: K,
      hooks: w.hooks,
      snapshotEvents:
        s && !s.has(c) ? [] : w.snapshotEvents?.map((v) => `${c}${W}${v}`),
    });
  }
  let p = null,
    d = null;
  function C(c) {
    for (const [w, g] of Object.entries(c))
      if (!se.has(w) && a.has(w)) {
        if (g && typeof g == "object" && !Ee(g))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${w}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [$, A] of Object.entries(g))
          se.has($) || (d.facts[`${w}${W}${$}`] = A);
      }
  }
  d = Ct({
    modules: h.map((c) => ({
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
    debug: f,
    errorBoundary: u,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && C(e.initialFacts), p && (C(p), (p = null));
    },
  });
  const _ = new Map();
  for (const c of Object.keys(t)) {
    const w = t[c];
    if (!w) continue;
    const g = [];
    for (const $ of Object.keys(w.schema.facts)) g.push(`${c}${W}${$}`);
    if (w.schema.derivations)
      for (const $ of Object.keys(w.schema.derivations)) g.push(`${c}${W}${$}`);
    _.set(c, g);
  }
  const O = { names: null };
  function D() {
    return O.names === null && (O.names = Object.keys(t)), O.names;
  }
  let j = _e(d.facts, t, D),
    E = ur(d.derive, t, D),
    x = dr(d, t, D),
    T = null,
    M = e.tickMs;
  return {
    _mode: "namespaced",
    facts: j,
    debug: d.debug,
    derive: E,
    events: x,
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
    async hydrate(c) {
      if (d.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const w = await c();
      w && typeof w == "object" && (p = w);
    },
    initialize() {
      d.initialize();
    },
    start() {
      if ((d.start(), M && M > 0)) {
        const c = Object.keys(h[0]?.events ?? {}).find((w) =>
          w.endsWith(`${W}tick`),
        );
        c &&
          (T = setInterval(() => {
            d.dispatch({ type: c });
          }, M));
      }
    },
    stop() {
      T && (clearInterval(T), (T = null)), d.stop();
    },
    destroy() {
      this.stop(), d.destroy();
    },
    dispatch(c) {
      d.dispatch(c);
    },
    batch: d.batch.bind(d),
    read(c) {
      return d.read(fe(c));
    },
    subscribe(c, w) {
      const g = [];
      for (const $ of c)
        if ($.endsWith(".*")) {
          const A = $.slice(0, -2),
            F = _.get(A);
          F && g.push(...F);
        } else g.push(fe($));
      return d.subscribe(g, w);
    },
    subscribeModule(c, w) {
      const g = _.get(c);
      return !g || g.length === 0 ? () => {} : d.subscribe(g, w);
    },
    watch(c, w, g) {
      return d.watch(fe(c), w, g);
    },
    when(c, w) {
      return d.when(() => c(j), w);
    },
    onSettledChange: d.onSettledChange.bind(d),
    onTimeTravelChange: d.onTimeTravelChange.bind(d),
    inspect: d.inspect.bind(d),
    settle: d.settle.bind(d),
    explain: d.explain.bind(d),
    getSnapshot: d.getSnapshot.bind(d),
    restore: d.restore.bind(d),
    getDistributableSnapshot(c) {
      const w = {
          ...c,
          includeDerivations: c?.includeDerivations?.map(fe),
          excludeDerivations: c?.excludeDerivations?.map(fe),
          includeFacts: c?.includeFacts?.map(fe),
        },
        g = d.getDistributableSnapshot(w),
        $ = {};
      for (const [A, F] of Object.entries(g.data)) {
        const m = A.indexOf(W);
        if (m > 0) {
          const S = A.slice(0, m),
            b = A.slice(m + W.length);
          $[S] || ($[S] = {}), ($[S][b] = F);
        } else $._root || ($._root = {}), ($._root[A] = F);
      }
      return { ...g, data: $ };
    },
    watchDistributableSnapshot(c, w) {
      const g = {
        ...c,
        includeDerivations: c?.includeDerivations?.map(fe),
        excludeDerivations: c?.excludeDerivations?.map(fe),
        includeFacts: c?.includeFacts?.map(fe),
      };
      return d.watchDistributableSnapshot(g, ($) => {
        const A = {};
        for (const [F, m] of Object.entries($.data)) {
          const S = F.indexOf(W);
          if (S > 0) {
            const b = F.slice(0, S),
              I = F.slice(S + W.length);
            A[b] || (A[b] = {}), (A[b][I] = m);
          } else A._root || (A._root = {}), (A._root[F] = m);
        }
        w({ ...$, data: A });
      });
    },
    registerModule(c, w) {
      if (a.has(c))
        throw new Error(
          `[Directive] Module namespace "${c}" already exists. Cannot register a duplicate namespace.`,
        );
      if (c.includes(W))
        throw new Error(
          `[Directive] Module name "${c}" contains the reserved separator "${W}".`,
        );
      if (se.has(c))
        throw new Error(
          `[Directive] Module name "${c}" is a blocked property.`,
        );
      for (const v of Object.keys(w.schema.facts))
        if (v.includes(W))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${c}" contains the reserved separator "${W}".`,
          );
      const g = w,
        $ = g.crossModuleDeps && Object.keys(g.crossModuleDeps).length > 0,
        A = $ ? Object.keys(g.crossModuleDeps) : [],
        F = {};
      for (const [v, R] of Object.entries(g.schema.facts))
        F[`${c}${W}${v}`] = R;
      const m = g.init
          ? (v) => {
              const R = oe(v, c);
              g.init(R);
            }
          : void 0,
        S = {};
      if (g.derive)
        for (const [v, R] of Object.entries(g.derive))
          S[`${c}${W}${v}`] = (r, n) => {
            const l = $ ? ue(r, c, A) : oe(r, c),
              y = Je(n, c);
            return R(l, y);
          };
      const b = {};
      if (g.events)
        for (const [v, R] of Object.entries(g.events))
          b[`${c}${W}${v}`] = (r, n) => {
            const l = oe(r, c);
            R(l, n);
          };
      const I = {};
      if (g.constraints)
        for (const [v, R] of Object.entries(g.constraints)) {
          const r = R;
          I[`${c}${W}${v}`] = {
            ...r,
            deps: r.deps?.map((n) => `${c}${W}${n}`),
            when: (n) => {
              const l = $ ? ue(n, c, A) : oe(n, c);
              return r.when(l);
            },
            require:
              typeof r.require == "function"
                ? (n) => {
                    const l = $ ? ue(n, c, A) : oe(n, c);
                    return r.require(l);
                  }
                : r.require,
          };
        }
      const z = {};
      if (g.resolvers)
        for (const [v, R] of Object.entries(g.resolvers)) {
          const r = R;
          z[`${c}${W}${v}`] = {
            ...r,
            resolve: async (n, l) => {
              const y = _e(l.facts, t, D);
              await r.resolve(n, { facts: y[c], signal: l.signal });
            },
          };
        }
      const K = {};
      if (g.effects)
        for (const [v, R] of Object.entries(g.effects)) {
          const r = R;
          K[`${c}${W}${v}`] = {
            ...r,
            run: (n, l) => {
              const y = $ ? ue(n, c, A) : oe(n, c),
                k = l ? ($ ? ue(l, c, A) : oe(l, c)) : void 0;
              return r.run(y, k);
            },
            deps: r.deps?.map((n) => `${c}${W}${n}`),
          };
        }
      a.add(c), (t[c] = g), (O.names = null);
      const P = [];
      for (const v of Object.keys(g.schema.facts)) P.push(`${c}${W}${v}`);
      if (g.schema.derivations)
        for (const v of Object.keys(g.schema.derivations))
          P.push(`${c}${W}${v}`);
      _.set(c, P),
        d.registerModule({
          id: g.id,
          schema: F,
          requirements: g.schema.requirements ?? {},
          init: m,
          derive: Object.keys(S).length > 0 ? S : void 0,
          events: Object.keys(b).length > 0 ? b : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(z).length > 0 ? z : void 0,
          hooks: g.hooks,
          snapshotEvents:
            s && !s.has(c) ? [] : g.snapshotEvents?.map((v) => `${c}${W}${v}`),
        });
    },
  };
}
function fe(e) {
  if (e.includes(".")) {
    const [t, ...a] = e.split(".");
    return `${t}${W}${a.join(W)}`;
  }
  return e;
}
function oe(e, t) {
  let a = at.get(e);
  if (a) {
    const i = a.get(t);
    if (i) return i;
  } else (a = new Map()), at.set(e, a);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !se.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${t}${W}${o}`];
      },
      set(i, o, f) {
        return typeof o == "symbol" || se.has(o)
          ? !1
          : ((e[`${t}${W}${o}`] = f), !0);
      },
      has(i, o) {
        return typeof o == "symbol" || se.has(o) ? !1 : `${t}${W}${o}` in e;
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" || se.has(o)
          ? !1
          : (delete e[`${t}${W}${o}`], !0);
      },
    },
  );
  return a.set(t, s), s;
}
function _e(e, t, a) {
  const s = lt.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, f) {
        if (typeof f != "symbol" && !se.has(f) && Object.hasOwn(t, f))
          return oe(e, f);
      },
      has(o, f) {
        return typeof f == "symbol" || se.has(f) ? !1 : Object.hasOwn(t, f);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(o, f) {
        if (typeof f != "symbol" && Object.hasOwn(t, f))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return lt.set(e, i), i;
}
var dt = new WeakMap();
function ue(e, t, a) {
  let s = `${t}:${JSON.stringify([...a].sort())}`,
    i = dt.get(e);
  if (i) {
    const h = i.get(s);
    if (h) return h;
  } else (i = new Map()), dt.set(e, i);
  const o = new Set(a),
    f = ["self", ...a],
    u = new Proxy(
      {},
      {
        get(h, p) {
          if (typeof p != "symbol" && !se.has(p)) {
            if (p === "self") return oe(e, t);
            if (o.has(p)) return oe(e, p);
          }
        },
        has(h, p) {
          return typeof p == "symbol" || se.has(p)
            ? !1
            : p === "self" || o.has(p);
        },
        ownKeys() {
          return f;
        },
        getOwnPropertyDescriptor(h, p) {
          if (typeof p != "symbol" && (p === "self" || o.has(p)))
            return { configurable: !0, enumerable: !0 };
        },
      },
    );
  return i.set(s, u), u;
}
function Je(e, t) {
  let a = ut.get(e);
  if (a) {
    const i = a.get(t);
    if (i) return i;
  } else (a = new Map()), ut.set(e, a);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !se.has(o)) return e[`${t}${W}${o}`];
      },
      has(i, o) {
        return typeof o == "symbol" || se.has(o) ? !1 : `${t}${W}${o}` in e;
      },
    },
  );
  return a.set(t, s), s;
}
function ur(e, t, a) {
  const s = ct.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, f) {
        if (typeof f != "symbol" && !se.has(f) && Object.hasOwn(t, f))
          return Je(e, f);
      },
      has(o, f) {
        return typeof f == "symbol" || se.has(f) ? !1 : Object.hasOwn(t, f);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(o, f) {
        if (typeof f != "symbol" && Object.hasOwn(t, f))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return ct.set(e, i), i;
}
var ft = new WeakMap();
function dr(e, t, a) {
  let s = ft.get(e);
  return (
    s || ((s = new Map()), ft.set(e, s)),
    new Proxy(
      {},
      {
        get(i, o) {
          if (typeof o == "symbol" || se.has(o) || !Object.hasOwn(t, o)) return;
          const f = s.get(o);
          if (f) return f;
          const u = new Proxy(
            {},
            {
              get(h, p) {
                if (typeof p != "symbol" && !se.has(p))
                  return (d) => {
                    e.dispatch({ type: `${o}${W}${p}`, ...d });
                  };
              },
            },
          );
          return s.set(o, u), u;
        },
        has(i, o) {
          return typeof o == "symbol" || se.has(o) ? !1 : Object.hasOwn(t, o);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(i, o) {
          if (typeof o != "symbol" && Object.hasOwn(t, o))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function fr(e) {
  const t = e.module;
  if (!t)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof t,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !Ee(e.initialFacts))
    throw new Error(
      "[Directive] initialFacts contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
    );
  let a = e.debug,
    s = e.errorBoundary;
  e.zeroConfig &&
    ((a = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (s = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  let i = null,
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
    debug: a,
    errorBoundary: s,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [p, d] of Object.entries(e.initialFacts))
          se.has(p) || (o.facts[p] = d);
      if (i) {
        for (const [p, d] of Object.entries(i)) se.has(p) || (o.facts[p] = d);
        i = null;
      }
    },
  });
  let f = new Proxy(
      {},
      {
        get(p, d) {
          if (typeof d != "symbol" && !se.has(d))
            return (C) => {
              o.dispatch({ type: d, ...C });
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
    events: f,
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
      const d = await p();
      d && typeof d == "object" && (i = d);
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
    dispatch(p) {
      o.dispatch(p);
    },
    batch: o.batch.bind(o),
    read(p) {
      return o.read(p);
    },
    subscribe(p, d) {
      return o.subscribe(p, d);
    },
    watch(p, d, C) {
      return o.watch(p, d, C);
    },
    when(p, d) {
      return o.when(p, d);
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
var Rt = class {
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
function Xe() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function At(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const t = JSON.stringify(e, (a, s) =>
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
function ge(e, t) {
  return e.length <= t ? e : e.slice(0, t - 3) + "...";
}
function Oe(e) {
  try {
    return e.inspect();
  } catch {
    return null;
  }
}
function pr(e) {
  try {
    return e == null || typeof e != "object"
      ? e
      : JSON.parse(JSON.stringify(e));
  } catch {
    return null;
  }
}
function mr(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (Xe() &&
          console.warn(
            `[directive:devtools] Invalid maxEvents value (${e}), using default 1000`,
          ),
        1e3)
      : Math.floor(e);
}
function hr() {
  return {
    reconcileCount: 0,
    reconcileTotalMs: 0,
    resolverStats: new Map(),
    effectRunCount: 0,
    effectErrorCount: 0,
    lastReconcileStartMs: 0,
  };
}
var gr = 200,
  Ie = 340,
  be = 16,
  we = 80,
  pt = 2,
  mt = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function yr() {
  return { entries: new Rt(gr), inflight: new Map() };
}
function vr() {
  return {
    derivationDeps: new Map(),
    activeConstraints: new Set(),
    recentlyChangedFacts: new Set(),
    recentlyComputedDerivations: new Set(),
    recentlyActiveConstraints: new Set(),
    animationTimer: null,
  };
}
var br = 1e4,
  wr = 100;
function Sr() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var xr = 50,
  ht = 200,
  N = {
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
function kr(e, t, a, s) {
  let i = !1,
    o = {
      position: "fixed",
      zIndex: "99999",
      ...(t.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(t.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    f = document.createElement("style");
  (f.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${N.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${N.accent};outline-offset:2px}`),
    document.head.appendChild(f);
  const u = document.createElement("button");
  u.setAttribute("aria-label", "Open Directive DevTools"),
    u.setAttribute("aria-expanded", String(a)),
    (u.title = "Ctrl+Shift+D to toggle"),
    Object.assign(u.style, {
      ...o,
      background: N.bg,
      color: N.text,
      border: `1px solid ${N.border}`,
      borderRadius: "6px",
      padding: "10px 14px",
      minWidth: "44px",
      minHeight: "44px",
      cursor: "pointer",
      fontFamily: N.font,
      fontSize: "12px",
      display: a ? "none" : "block",
    }),
    (u.textContent = "Directive");
  const h = document.createElement("div");
  h.setAttribute("role", "region"),
    h.setAttribute("aria-label", "Directive DevTools"),
    h.setAttribute("data-directive-devtools", ""),
    (h.tabIndex = -1),
    Object.assign(h.style, {
      ...o,
      background: N.bg,
      color: N.text,
      border: `1px solid ${N.border}`,
      borderRadius: "8px",
      padding: "12px",
      fontFamily: N.font,
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
  const d = document.createElement("strong");
  (d.style.color = N.accent),
    (d.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const C = document.createElement("button");
  C.setAttribute("aria-label", "Close DevTools"),
    Object.assign(C.style, {
      background: "none",
      border: "none",
      color: N.closeBtn,
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
    (C.textContent = "×"),
    p.appendChild(d),
    p.appendChild(C),
    h.appendChild(p);
  const _ = document.createElement("div");
  (_.style.marginBottom = "6px"), _.setAttribute("aria-live", "polite");
  const O = document.createElement("span");
  (O.style.color = N.green),
    (O.textContent = "Settled"),
    _.appendChild(O),
    h.appendChild(_);
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
    border: `1px solid ${N.border}`,
    color: N.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: N.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (j.textContent = "◀ Undo"),
    (j.disabled = !0);
  const E = document.createElement("button");
  Object.assign(E.style, {
    background: "none",
    border: `1px solid ${N.border}`,
    color: N.text,
    cursor: "pointer",
    padding: "4px 10px",
    borderRadius: "3px",
    fontFamily: N.font,
    fontSize: "11px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (E.textContent = "Redo ▶"),
    (E.disabled = !0);
  const x = document.createElement("span");
  (x.style.color = N.muted),
    (x.style.fontSize = "10px"),
    D.appendChild(j),
    D.appendChild(E),
    D.appendChild(x),
    h.appendChild(D);
  function T(J, V) {
    const X = document.createElement("details");
    V && (X.open = !0), (X.style.marginBottom = "4px");
    const ae = document.createElement("summary");
    Object.assign(ae.style, {
      cursor: "pointer",
      color: N.accent,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (ae.textContent = `${J} (`),
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
    const Qe = document.createElement("thead"),
      et = document.createElement("tr");
    for (const Nt of ["Key", "Value"]) {
      const Re = document.createElement("th");
      (Re.scope = "col"),
        Object.assign(Re.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: N.accent,
        }),
        (Re.textContent = Nt),
        et.appendChild(Re);
    }
    Qe.appendChild(et), pe.appendChild(Qe);
    const tt = document.createElement("tbody");
    return (
      pe.appendChild(tt),
      X.appendChild(pe),
      { details: X, tbody: tt, countSpan: me }
    );
  }
  function M(J, V) {
    const X = document.createElement("details");
    X.style.marginBottom = "4px";
    const ae = document.createElement("summary");
    Object.assign(ae.style, {
      cursor: "pointer",
      color: V,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (ae.textContent = `${J} (`),
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
  const c = T("Facts", !0);
  h.appendChild(c.details);
  const w = T("Derivations", !1);
  h.appendChild(w.details);
  const g = M("Inflight", N.yellow);
  h.appendChild(g.details);
  const $ = M("Unmet", N.red);
  h.appendChild($.details);
  const A = document.createElement("details");
  A.style.marginBottom = "4px";
  const F = document.createElement("summary");
  Object.assign(F.style, {
    cursor: "pointer",
    color: N.accent,
    marginBottom: "4px",
  }),
    (F.textContent = "Performance"),
    A.appendChild(F);
  const m = document.createElement("div");
  (m.style.fontSize = "10px"),
    (m.style.color = N.muted),
    (m.textContent = "No data yet"),
    A.appendChild(m),
    h.appendChild(A);
  const S = document.createElement("details");
  S.style.marginBottom = "4px";
  const b = document.createElement("summary");
  Object.assign(b.style, {
    cursor: "pointer",
    color: N.accent,
    marginBottom: "4px",
  }),
    (b.textContent = "Dependency Graph"),
    S.appendChild(b);
  const I = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  I.setAttribute("width", "100%"),
    I.setAttribute("height", "120"),
    I.setAttribute("role", "img"),
    I.setAttribute("aria-label", "System dependency graph"),
    (I.style.display = "block"),
    I.setAttribute("viewBox", "0 0 460 120"),
    I.setAttribute("preserveAspectRatio", "xMinYMin meet"),
    S.appendChild(I),
    h.appendChild(S);
  const z = document.createElement("details");
  z.style.marginBottom = "4px";
  const K = document.createElement("summary");
  Object.assign(K.style, {
    cursor: "pointer",
    color: N.accent,
    marginBottom: "4px",
  }),
    (K.textContent = "Timeline"),
    z.appendChild(K);
  const P = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  P.setAttribute("width", "100%"),
    P.setAttribute("height", "60"),
    P.setAttribute("role", "img"),
    P.setAttribute("aria-label", "Resolver execution timeline"),
    (P.style.display = "block"),
    P.setAttribute("viewBox", `0 0 ${Ie} 60`),
    P.setAttribute("preserveAspectRatio", "xMinYMin meet");
  const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
  v.setAttribute("x", String(Ie / 2)),
    v.setAttribute("y", "30"),
    v.setAttribute("text-anchor", "middle"),
    v.setAttribute("fill", N.muted),
    v.setAttribute("font-size", "10"),
    v.setAttribute("font-family", N.font),
    (v.textContent = "No resolver activity yet"),
    P.appendChild(v),
    z.appendChild(P),
    h.appendChild(z);
  let R, r, n, l;
  if (s) {
    const J = document.createElement("details");
    J.style.marginBottom = "4px";
    const V = document.createElement("summary");
    Object.assign(V.style, {
      cursor: "pointer",
      color: N.accent,
      marginBottom: "4px",
    }),
      (n = document.createElement("span")),
      (n.textContent = "0"),
      (V.textContent = "Events ("),
      V.appendChild(n),
      V.appendChild(document.createTextNode(")")),
      J.appendChild(V),
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
    (X.style.color = N.muted),
      (X.style.padding = "4px"),
      (X.textContent = "Waiting for events..."),
      (X.className = "dt-events-empty"),
      r.appendChild(X),
      J.appendChild(r),
      h.appendChild(J),
      (R = J),
      (l = document.createElement("div"));
  } else
    (R = document.createElement("details")),
      (r = document.createElement("div")),
      (n = document.createElement("span")),
      (l = document.createElement("div")),
      (l.style.fontSize = "10px"),
      (l.style.color = N.muted),
      (l.style.marginTop = "4px"),
      (l.style.fontStyle = "italic"),
      (l.textContent = "Enable trace: true for event log"),
      h.appendChild(l);
  const y = document.createElement("div");
  Object.assign(y.style, { display: "flex", gap: "6px", marginTop: "6px" });
  const k = document.createElement("button");
  Object.assign(k.style, {
    background: "none",
    border: `1px solid ${N.border}`,
    color: N.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: N.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (k.textContent = "⏺ Record");
  const q = document.createElement("button");
  Object.assign(q.style, {
    background: "none",
    border: `1px solid ${N.border}`,
    color: N.text,
    cursor: "pointer",
    padding: "8px 12px",
    borderRadius: "3px",
    fontFamily: N.font,
    fontSize: "10px",
    minWidth: "44px",
    minHeight: "44px",
  }),
    (q.textContent = "⤓ Export"),
    y.appendChild(k),
    y.appendChild(q),
    h.appendChild(y),
    h.addEventListener(
      "wheel",
      (J) => {
        const V = h,
          X = V.scrollTop === 0 && J.deltaY < 0,
          ae = V.scrollTop + V.clientHeight >= V.scrollHeight && J.deltaY > 0;
        (X || ae) && J.preventDefault();
      },
      { passive: !1 },
    );
  let L = a,
    H = new Set();
  function B() {
    (L = !0),
      (h.style.display = "block"),
      (u.style.display = "none"),
      u.setAttribute("aria-expanded", "true"),
      C.focus();
  }
  function U() {
    (L = !1),
      (h.style.display = "none"),
      (u.style.display = "block"),
      u.setAttribute("aria-expanded", "false"),
      u.focus();
  }
  u.addEventListener("click", B), C.addEventListener("click", U);
  function G(J) {
    J.key === "Escape" && L && U();
  }
  h.addEventListener("keydown", G);
  function ne(J) {
    J.key === "d" &&
      J.shiftKey &&
      (J.ctrlKey || J.metaKey) &&
      (J.preventDefault(), L ? U() : B());
  }
  document.addEventListener("keydown", ne);
  function ee() {
    i || (document.body.appendChild(u), document.body.appendChild(h));
  }
  document.body
    ? ee()
    : document.addEventListener("DOMContentLoaded", ee, { once: !0 });
  function Z() {
    (i = !0),
      u.removeEventListener("click", B),
      C.removeEventListener("click", U),
      h.removeEventListener("keydown", G),
      document.removeEventListener("keydown", ne),
      document.removeEventListener("DOMContentLoaded", ee);
    for (const J of H) clearTimeout(J);
    H.clear(), u.remove(), h.remove(), f.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: u,
      titleEl: d,
      statusEl: O,
      factsBody: c.tbody,
      factsCount: c.countSpan,
      derivBody: w.tbody,
      derivCount: w.countSpan,
      derivSection: w.details,
      inflightList: g.list,
      inflightSection: g.details,
      inflightCount: g.countSpan,
      unmetList: $.list,
      unmetSection: $.details,
      unmetCount: $.countSpan,
      perfSection: A,
      perfBody: m,
      timeTravelSection: D,
      timeTravelLabel: x,
      undoBtn: j,
      redoBtn: E,
      flowSection: S,
      flowSvg: I,
      timelineSection: z,
      timelineSvg: P,
      eventsSection: R,
      eventsList: r,
      eventsCount: n,
      traceHint: l,
      recordBtn: k,
      exportBtn: q,
    },
    destroy: Z,
    isOpen: () => L,
    flashTimers: H,
  };
}
function je(e, t, a, s, i, o) {
  let f = At(s),
    u = e.get(a);
  if (u) {
    const h = u.cells;
    if (h[1] && ((h[1].textContent = f), i && o)) {
      const p = h[1];
      p.style.background = "rgba(139, 154, 255, 0.25)";
      const d = setTimeout(() => {
        (p.style.background = ""), o.delete(d);
      }, 300);
      o.add(d);
    }
  } else {
    (u = document.createElement("tr")),
      (u.style.borderBottom = `1px solid ${N.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: N.muted }),
      (h.textContent = a);
    const p = document.createElement("td");
    (p.style.padding = "2px 4px"),
      (p.textContent = f),
      u.appendChild(h),
      u.appendChild(p),
      t.appendChild(u),
      e.set(a, u);
  }
}
function $r(e, t) {
  const a = e.get(t);
  a && (a.remove(), e.delete(t));
}
function qe(e, t, a) {
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
      (s.style.color = N.muted),
      (s.textContent = "None"),
      e.inflightList.appendChild(s);
  }
  if (
    (e.unmetList.replaceChildren(),
    (e.unmetCount.textContent = String(a.length)),
    a.length > 0)
  )
    for (const s of a) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.requirement.type} from ${s.fromConstraint}`),
        e.unmetList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = N.muted),
      (s.textContent = "None"),
      e.unmetList.appendChild(s);
  }
}
function Fe(e, t, a) {
  const s = t === 0 && a === 0;
  (e.statusEl.style.color = s ? N.green : N.yellow),
    (e.statusEl.textContent = s ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = s ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${s ? "" : " (system working)"}`,
    );
}
function gt(e, t, a, s) {
  const i = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    t.clear(), e.derivBody.replaceChildren();
    const f = document.createElement("tr"),
      u = document.createElement("td");
    (u.colSpan = 2),
      (u.style.color = N.muted),
      (u.style.fontSize = "10px"),
      (u.textContent = "No derivations defined"),
      f.appendChild(u),
      e.derivBody.appendChild(f);
    return;
  }
  const o = new Set(i);
  for (const [f, u] of t) o.has(f) || (u.remove(), t.delete(f));
  for (const f of i) {
    let u;
    try {
      u = At(a.read(f));
    } catch {
      u = "<error>";
    }
    je(t, e.derivBody, f, u, !0, s);
  }
}
function Er(e, t, a, s) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${N.rowBorder}`,
    fontFamily: "inherit",
  });
  let f = new Date(),
    u = `${String(f.getHours()).padStart(2, "0")}:${String(f.getMinutes()).padStart(2, "0")}:${String(f.getSeconds()).padStart(2, "0")}.${String(f.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const _ = JSON.stringify(a);
    h = ge(_, 60);
  } catch {
    h = "{}";
  }
  const p = document.createElement("span");
  (p.style.color = N.closeBtn), (p.textContent = u);
  const d = document.createElement("span");
  (d.style.color = N.accent), (d.textContent = ` ${t} `);
  const C = document.createElement("span");
  for (
    C.style.color = N.muted,
      C.textContent = h,
      o.appendChild(p),
      o.appendChild(d),
      o.appendChild(C),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > xr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(s);
}
function Cr(e, t) {
  e.perfBody.replaceChildren();
  const a =
      t.reconcileCount > 0
        ? (t.reconcileTotalMs / t.reconcileCount).toFixed(1)
        : "—",
    s = [
      `Reconciles: ${t.reconcileCount}  (avg ${a}ms)`,
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
      (i.style.color = N.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const o = [...t.resolverStats.entries()].sort(
      (f, u) => u[1].totalMs - f[1].totalMs,
    );
    for (const [f, u] of o) {
      const h = u.count > 0 ? (u.totalMs / u.count).toFixed(1) : "0",
        p = document.createElement("div");
      (p.style.paddingLeft = "8px"),
        (p.textContent = `${f}: ${u.count}x, avg ${h}ms${u.errors > 0 ? `, ${u.errors} err` : ""}`),
        u.errors > 0 && (p.style.color = N.red),
        e.perfBody.appendChild(p);
    }
  }
}
function yt(e, t) {
  const a = t.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const s = a.currentIndex,
    i = a.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${s + 1} / ${i}` : "0 snapshots";
  const o = s > 0,
    f = s < i - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !f),
    (e.redoBtn.style.opacity = f ? "1" : "0.4");
}
function Rr(e, t) {
  e.undoBtn.addEventListener("click", () => {
    t.debug && t.debug.currentIndex > 0 && t.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      t.debug &&
        t.debug.currentIndex < t.debug.snapshots.length - 1 &&
        t.debug.goForward(1);
    });
}
var Ne = new WeakMap();
function Ar(e, t, a, s, i, o) {
  return [
    e.join(","),
    t.join(","),
    a.map((f) => `${f.id}:${f.active}`).join(","),
    [...s.entries()].map(([f, u]) => `${f}:${u.status}:${u.type}`).join(","),
    i.join(","),
    o.join(","),
  ].join("|");
}
function Or(e, t, a, s, i) {
  for (const o of a) {
    const f = e.nodes.get(`0:${o}`);
    if (!f) continue;
    const u = t.recentlyChangedFacts.has(o);
    f.rect.setAttribute("fill", u ? N.text + "33" : "none"),
      f.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const o of s) {
    const f = e.nodes.get(`1:${o}`);
    if (!f) continue;
    const u = t.recentlyComputedDerivations.has(o);
    f.rect.setAttribute("fill", u ? N.accent + "33" : "none"),
      f.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
  for (const o of i) {
    const f = e.nodes.get(`2:${o}`);
    if (!f) continue;
    const u = t.recentlyActiveConstraints.has(o),
      h = f.rect.getAttribute("stroke") ?? N.muted;
    f.rect.setAttribute("fill", u ? h + "33" : "none"),
      f.rect.setAttribute("stroke-width", u ? "2" : "1");
  }
}
function vt(e, t, a) {
  const s = Oe(t);
  if (!s) return;
  let i;
  try {
    i = Object.keys(t.facts.$store.toObject());
  } catch {
    i = [];
  }
  const o = Object.keys(t.derive),
    f = s.constraints,
    u = s.unmet,
    h = s.inflight,
    p = Object.keys(s.resolvers),
    d = new Map();
  for (const v of u)
    d.set(v.id, {
      type: v.requirement.type,
      fromConstraint: v.fromConstraint,
      status: "unmet",
    });
  for (const v of h)
    d.set(v.id, { type: v.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && o.length === 0 && f.length === 0 && p.length === 0) {
    Ne.delete(e.flowSvg),
      e.flowSvg.replaceChildren(),
      e.flowSvg.setAttribute("viewBox", "0 0 460 40");
    const v = document.createElementNS("http://www.w3.org/2000/svg", "text");
    v.setAttribute("x", "230"),
      v.setAttribute("y", "24"),
      v.setAttribute("text-anchor", "middle"),
      v.setAttribute("fill", N.muted),
      v.setAttribute("font-size", "10"),
      v.setAttribute("font-family", N.font),
      (v.textContent = "No system topology"),
      e.flowSvg.appendChild(v);
    return;
  }
  const C = h.map((v) => v.resolverId).sort(),
    _ = Ar(i, o, f, d, p, C),
    O = Ne.get(e.flowSvg);
  if (O && O.fingerprint === _) {
    Or(
      O,
      a,
      i,
      o,
      f.map((v) => v.id),
    );
    return;
  }
  const D = Q.nodeW + Q.colGap,
    j = [5, 5 + D, 5 + D * 2, 5 + D * 3, 5 + D * 4],
    E = j[4] + Q.nodeW + 5;
  function x(v) {
    let R = Q.startY + 12;
    return v.map((r) => {
      const n = { ...r, y: R };
      return (R += Q.nodeH + Q.nodeGap), n;
    });
  }
  const T = x(i.map((v) => ({ id: v, label: ge(v, Q.labelMaxChars) }))),
    M = x(o.map((v) => ({ id: v, label: ge(v, Q.labelMaxChars) }))),
    c = x(
      f.map((v) => ({
        id: v.id,
        label: ge(v.id, Q.labelMaxChars),
        active: v.active,
        priority: v.priority,
      })),
    ),
    w = x(
      [...d.entries()].map(([v, R]) => ({
        id: v,
        type: R.type,
        fromConstraint: R.fromConstraint,
        status: R.status,
      })),
    ),
    g = x(p.map((v) => ({ id: v, label: ge(v, Q.labelMaxChars) }))),
    $ = Math.max(T.length, M.length, c.length, w.length, g.length, 1),
    A = Q.startY + 12 + $ * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${E} ${A}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${o.length} derivations, ${f.length} constraints, ${d.size} requirements, ${p.length} resolvers`,
    );
  const F = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [v, R] of F.entries()) {
    const r = document.createElementNS("http://www.w3.org/2000/svg", "text");
    r.setAttribute("x", String(j[v] ?? 0)),
      r.setAttribute("y", "10"),
      r.setAttribute("fill", N.accent),
      r.setAttribute("font-size", String(Q.fontSize)),
      r.setAttribute("font-family", N.font),
      (r.textContent = R),
      e.flowSvg.appendChild(r);
  }
  const m = { fingerprint: _, nodes: new Map() };
  function S(v, R, r, n, l, y, k, q) {
    const L = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      H = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    H.setAttribute("x", String(R)),
      H.setAttribute("y", String(r - 6)),
      H.setAttribute("width", String(Q.nodeW)),
      H.setAttribute("height", String(Q.nodeH)),
      H.setAttribute("rx", "3"),
      H.setAttribute("fill", q ? y + "33" : "none"),
      H.setAttribute("stroke", y),
      H.setAttribute("stroke-width", q ? "2" : "1"),
      H.setAttribute("opacity", k ? "0.35" : "1"),
      L.appendChild(H);
    const B = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      B.setAttribute("x", String(R + 4)),
      B.setAttribute("y", String(r + 4)),
      B.setAttribute("fill", y),
      B.setAttribute("font-size", String(Q.fontSize)),
      B.setAttribute("font-family", N.font),
      B.setAttribute("opacity", k ? "0.35" : "1"),
      (B.textContent = l),
      L.appendChild(B),
      e.flowSvg.appendChild(L),
      m.nodes.set(`${v}:${n}`, { g: L, rect: H, text: B }),
      { midX: R + Q.nodeW / 2, midY: r }
    );
  }
  function b(v, R, r, n, l, y) {
    const k = document.createElementNS("http://www.w3.org/2000/svg", "line");
    k.setAttribute("x1", String(v)),
      k.setAttribute("y1", String(R)),
      k.setAttribute("x2", String(r)),
      k.setAttribute("y2", String(n)),
      k.setAttribute("stroke", l),
      k.setAttribute("stroke-width", "1"),
      k.setAttribute("stroke-dasharray", "3,2"),
      k.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(k);
  }
  const I = new Map(),
    z = new Map(),
    K = new Map(),
    P = new Map();
  for (const v of T) {
    const R = a.recentlyChangedFacts.has(v.id),
      r = S(0, j[0], v.y, v.id, v.label, N.text, !1, R);
    I.set(v.id, r);
  }
  for (const v of M) {
    const R = a.recentlyComputedDerivations.has(v.id),
      r = S(1, j[1], v.y, v.id, v.label, N.accent, !1, R);
    z.set(v.id, r);
  }
  for (const v of c) {
    const R = a.recentlyActiveConstraints.has(v.id),
      r = S(
        2,
        j[2],
        v.y,
        v.id,
        v.label,
        v.active ? N.yellow : N.muted,
        !v.active,
        R,
      );
    K.set(v.id, r);
  }
  for (const v of w) {
    const R = v.status === "unmet" ? N.red : N.yellow,
      r = S(3, j[3], v.y, v.id, ge(v.type, Q.labelMaxChars), R, !1, !1);
    P.set(v.id, r);
  }
  for (const v of g) {
    const R = h.some((r) => r.resolverId === v.id);
    S(4, j[4], v.y, v.id, v.label, R ? N.green : N.muted, !R, !1);
  }
  for (const v of M) {
    const R = a.derivationDeps.get(v.id),
      r = z.get(v.id);
    if (R && r)
      for (const n of R) {
        const l = I.get(n);
        l &&
          b(
            l.midX + Q.nodeW / 2,
            l.midY,
            r.midX - Q.nodeW / 2,
            r.midY,
            N.accent,
          );
      }
  }
  for (const v of w) {
    const R = K.get(v.fromConstraint),
      r = P.get(v.id);
    R &&
      r &&
      b(R.midX + Q.nodeW / 2, R.midY, r.midX - Q.nodeW / 2, r.midY, N.muted);
  }
  for (const v of h) {
    const R = P.get(v.id);
    if (R) {
      const r = g.find((n) => n.id === v.resolverId);
      r && b(R.midX + Q.nodeW / 2, R.midY, j[4], r.y, N.green);
    }
  }
  Ne.set(e.flowSvg, m);
}
function jr(e) {
  e.animationTimer && clearTimeout(e.animationTimer),
    (e.animationTimer = setTimeout(() => {
      e.recentlyChangedFacts.clear(),
        e.recentlyComputedDerivations.clear(),
        e.recentlyActiveConstraints.clear(),
        (e.animationTimer = null);
    }, 600));
}
function Dr(e, t) {
  const a = t.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let s = 1 / 0,
    i = -1 / 0;
  for (const O of a)
    O.startMs < s && (s = O.startMs), O.endMs > i && (i = O.endMs);
  const o = performance.now();
  for (const O of t.inflight.values()) O < s && (s = O), o > i && (i = o);
  const f = i - s || 1,
    u = Ie - we - 10,
    h = [],
    p = new Set();
  for (const O of a)
    p.has(O.resolver) || (p.add(O.resolver), h.push(O.resolver));
  for (const O of t.inflight.keys()) p.has(O) || (p.add(O), h.push(O));
  const d = h.slice(-12),
    C = be * d.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Ie} ${C}`),
    e.timelineSvg.setAttribute("height", String(Math.min(C, 200)));
  const _ = 5;
  for (let O = 0; O <= _; O++) {
    const D = we + (u * O) / _,
      j = (f * O) / _,
      E = document.createElementNS("http://www.w3.org/2000/svg", "text");
    E.setAttribute("x", String(D)),
      E.setAttribute("y", "8"),
      E.setAttribute("fill", N.muted),
      E.setAttribute("font-size", "6"),
      E.setAttribute("font-family", N.font),
      E.setAttribute("text-anchor", "middle"),
      (E.textContent =
        j < 1e3 ? `${j.toFixed(0)}ms` : `${(j / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(E);
    const x = document.createElementNS("http://www.w3.org/2000/svg", "line");
    x.setAttribute("x1", String(D)),
      x.setAttribute("y1", "10"),
      x.setAttribute("x2", String(D)),
      x.setAttribute("y2", String(C)),
      x.setAttribute("stroke", N.border),
      x.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(x);
  }
  for (let O = 0; O < d.length; O++) {
    const D = d[O],
      j = 12 + O * be,
      E = O % mt.length,
      x = mt[E],
      T = document.createElementNS("http://www.w3.org/2000/svg", "text");
    T.setAttribute("x", String(we - 4)),
      T.setAttribute("y", String(j + be / 2 + 3)),
      T.setAttribute("fill", N.muted),
      T.setAttribute("font-size", "7"),
      T.setAttribute("font-family", N.font),
      T.setAttribute("text-anchor", "end"),
      (T.textContent = ge(D, 12)),
      e.timelineSvg.appendChild(T);
    const M = a.filter((w) => w.resolver === D);
    for (const w of M) {
      const g = we + ((w.startMs - s) / f) * u,
        $ = Math.max(((w.endMs - w.startMs) / f) * u, pt),
        A = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      A.setAttribute("x", String(g)),
        A.setAttribute("y", String(j + 2)),
        A.setAttribute("width", String($)),
        A.setAttribute("height", String(be - 4)),
        A.setAttribute("rx", "2"),
        A.setAttribute("fill", w.error ? N.red : x),
        A.setAttribute("opacity", "0.8");
      const F = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        m = w.endMs - w.startMs;
      (F.textContent = `${D}: ${m.toFixed(1)}ms${w.error ? " (error)" : ""}`),
        A.appendChild(F),
        e.timelineSvg.appendChild(A);
    }
    const c = t.inflight.get(D);
    if (c !== void 0) {
      const w = we + ((c - s) / f) * u,
        g = Math.max(((o - c) / f) * u, pt),
        $ = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      $.setAttribute("x", String(w)),
        $.setAttribute("y", String(j + 2)),
        $.setAttribute("width", String(g)),
        $.setAttribute("height", String(be - 4)),
        $.setAttribute("rx", "2"),
        $.setAttribute("fill", x),
        $.setAttribute("opacity", "0.4"),
        $.setAttribute("stroke", x),
        $.setAttribute("stroke-width", "1"),
        $.setAttribute("stroke-dasharray", "3,2");
      const A = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (A.textContent = `${D}: inflight ${(o - c).toFixed(0)}ms`),
        $.appendChild(A),
        e.timelineSvg.appendChild($);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${d.length} resolvers`,
  );
}
function Mr() {
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
        explain(a, s) {
          return this.getSystem(s)?.explain(a) ?? null;
        },
        subscribe(a, s) {
          const i = s ? e.get(s) : e.values().next().value;
          if (!i) {
            let o = !1,
              f = setInterval(() => {
                const h = s ? e.get(s) : e.values().next().value;
                h && !o && ((o = !0), h.subscribers.add(a));
              }, 100),
              u = setTimeout(() => clearInterval(f), 1e4);
            return () => {
              clearInterval(f), clearTimeout(u);
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
          const s = a ? e.get(a) : e.values().next().value;
          return s
            ? JSON.stringify({
                version: 1,
                name: a ?? e.keys().next().value ?? "default",
                exportedAt: Date.now(),
                events: s.events.toArray(),
              })
            : null;
        },
        importSession(a, s) {
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
            const o = s ? e.get(s) : e.values().next().value;
            if (!o) return !1;
            const f = o.maxEvents,
              u = i.events,
              h = u.length > f ? u.length - f : 0;
            o.events.clear();
            for (let p = h; p < u.length; p++) {
              const d = u[p];
              d &&
                typeof d == "object" &&
                !Array.isArray(d) &&
                typeof d.timestamp == "number" &&
                typeof d.type == "string" &&
                d.type !== "__proto__" &&
                d.type !== "constructor" &&
                d.type !== "prototype" &&
                o.events.push({
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
        clearEvents(a) {
          const s = a ? e.get(a) : e.values().next().value;
          s && s.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: t,
        writable: !1,
        configurable: Xe(),
        enumerable: !0,
      }),
      t
    );
  }
  return window.__DIRECTIVE__;
}
function Tr(e = {}) {
  const {
      name: t = "default",
      trace: a = !1,
      maxEvents: s,
      panel: i = !1,
      position: o = "bottom-right",
      defaultOpen: f = !1,
    } = e,
    u = mr(s),
    h = Mr(),
    p = {
      system: null,
      events: new Rt(u),
      maxEvents: u,
      subscribers: new Set(),
    };
  h.systems.set(t, p);
  let d = (n, l) => {
      const y = { timestamp: Date.now(), type: n, data: l };
      a && p.events.push(y);
      for (const k of p.subscribers)
        try {
          k(y);
        } catch {}
    },
    C = null,
    _ = new Map(),
    O = new Map(),
    D = hr(),
    j = vr(),
    E = Sr(),
    x = yr(),
    T = i && typeof window < "u" && typeof document < "u" && Xe(),
    M = null,
    c = 0,
    w = 1,
    g = 2,
    $ = 4,
    A = 8,
    F = 16,
    m = 32,
    S = 64,
    b = 128,
    I = new Map(),
    z = new Set(),
    K = null;
  function P(n) {
    (c |= n),
      M === null &&
        typeof requestAnimationFrame < "u" &&
        (M = requestAnimationFrame(v));
  }
  function v() {
    if (((M = null), !C || !p.system)) {
      c = 0;
      return;
    }
    const n = C.refs,
      l = p.system,
      y = c;
    if (((c = 0), y & w)) {
      for (const k of z) $r(_, k);
      z.clear();
      for (const [k, { value: q, flash: L }] of I)
        je(_, n.factsBody, k, q, L, C.flashTimers);
      I.clear(), (n.factsCount.textContent = String(_.size));
    }
    if ((y & g && gt(n, O, l, C.flashTimers), y & A))
      if (K) Fe(n, K.inflight.length, K.unmet.length);
      else {
        const k = Oe(l);
        k && Fe(n, k.inflight.length, k.unmet.length);
      }
    if (y & $)
      if (K) qe(n, K.inflight, K.unmet);
      else {
        const k = Oe(l);
        k && qe(n, k.inflight, k.unmet);
      }
    y & F && Cr(n, D),
      y & m && vt(n, l, j),
      y & S && yt(n, l),
      y & b && Dr(n, x);
  }
  function R(n, l) {
    C && a && Er(C.refs, n, l, p.events.size);
  }
  function r(n, l) {
    E.isRecording &&
      E.recordedEvents.length < br &&
      E.recordedEvents.push({ timestamp: Date.now(), type: n, data: pr(l) });
  }
  return {
    name: "devtools",
    onInit: (n) => {
      if (
        ((p.system = n),
        d("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${t}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        T)
      ) {
        const l = p.system;
        C = kr(t, o, f, a);
        const y = C.refs;
        try {
          const q = l.facts.$store.toObject();
          for (const [L, H] of Object.entries(q)) je(_, y.factsBody, L, H, !1);
          y.factsCount.textContent = String(Object.keys(q).length);
        } catch {}
        gt(y, O, l);
        const k = Oe(l);
        k &&
          (Fe(y, k.inflight.length, k.unmet.length),
          qe(y, k.inflight, k.unmet)),
          yt(y, l),
          Rr(y, l),
          vt(y, l, j),
          y.recordBtn.addEventListener("click", () => {
            if (
              ((E.isRecording = !E.isRecording),
              (y.recordBtn.textContent = E.isRecording ? "⏹ Stop" : "⏺ Record"),
              (y.recordBtn.style.color = E.isRecording ? N.red : N.text),
              E.isRecording)
            ) {
              (E.recordedEvents = []), (E.snapshots = []);
              try {
                E.snapshots.push({
                  timestamp: Date.now(),
                  facts: l.facts.$store.toObject(),
                });
              } catch {}
            }
          }),
          y.exportBtn.addEventListener("click", () => {
            const q =
                E.recordedEvents.length > 0
                  ? E.recordedEvents
                  : p.events.toArray(),
              L = JSON.stringify(
                {
                  version: 1,
                  name: t,
                  exportedAt: Date.now(),
                  events: q,
                  snapshots: E.snapshots,
                },
                null,
                2,
              ),
              H = new Blob([L], { type: "application/json" }),
              B = URL.createObjectURL(H),
              U = document.createElement("a");
            (U.href = B),
              (U.download = `directive-session-${t}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(B);
          });
      }
    },
    onStart: (n) => {
      d("start", {}), R("start", {}), r("start", {});
    },
    onStop: (n) => {
      d("stop", {}), R("stop", {}), r("stop", {});
    },
    onDestroy: (n) => {
      d("destroy", {}),
        h.systems.delete(t),
        M !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(M), (M = null)),
        j.animationTimer && clearTimeout(j.animationTimer),
        C && (C.destroy(), (C = null), _.clear(), O.clear());
    },
    onFactSet: (n, l, y) => {
      d("fact.set", { key: n, value: l, prev: y }),
        r("fact.set", { key: n, value: l, prev: y }),
        j.recentlyChangedFacts.add(n),
        C &&
          p.system &&
          (I.set(n, { value: l, flash: !0 }),
          z.delete(n),
          P(w),
          R("fact.set", { key: n, value: l }));
    },
    onFactDelete: (n, l) => {
      d("fact.delete", { key: n, prev: l }),
        r("fact.delete", { key: n, prev: l }),
        C && (z.add(n), I.delete(n), P(w), R("fact.delete", { key: n }));
    },
    onFactsBatch: (n) => {
      if (
        (d("facts.batch", { changes: n }),
        r("facts.batch", { count: n.length }),
        C && p.system)
      ) {
        for (const l of n)
          l.type === "delete"
            ? (z.add(l.key), I.delete(l.key))
            : (j.recentlyChangedFacts.add(l.key),
              I.set(l.key, { value: l.value, flash: !0 }),
              z.delete(l.key));
        P(w), R("facts.batch", { count: n.length });
      }
    },
    onDerivationCompute: (n, l, y) => {
      d("derivation.compute", { id: n, value: l, deps: y }),
        r("derivation.compute", { id: n, deps: y }),
        j.derivationDeps.set(n, y),
        j.recentlyComputedDerivations.add(n),
        R("derivation.compute", { id: n, deps: y });
    },
    onDerivationInvalidate: (n) => {
      d("derivation.invalidate", { id: n }),
        R("derivation.invalidate", { id: n });
    },
    onReconcileStart: (n) => {
      d("reconcile.start", {}),
        (D.lastReconcileStartMs = performance.now()),
        R("reconcile.start", {}),
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
        const l = performance.now() - D.lastReconcileStartMs;
        D.reconcileCount++,
          (D.reconcileTotalMs += l),
          (D.lastReconcileStartMs = 0);
      }
      if (E.isRecording && p.system && E.snapshots.length < wr)
        try {
          E.snapshots.push({
            timestamp: Date.now(),
            facts: p.system.facts.$store.toObject(),
          });
        } catch {}
      C &&
        p.system &&
        ((K = n),
        jr(j),
        P(g | A | $ | F | m | S),
        R("reconcile.end", {
          unmet: n.unmet.length,
          inflight: n.inflight.length,
        }));
    },
    onConstraintEvaluate: (n, l) => {
      d("constraint.evaluate", { id: n, active: l }),
        r("constraint.evaluate", { id: n, active: l }),
        l
          ? (j.activeConstraints.add(n), j.recentlyActiveConstraints.add(n))
          : j.activeConstraints.delete(n),
        R("constraint.evaluate", { id: n, active: l });
    },
    onConstraintError: (n, l) => {
      d("constraint.error", { id: n, error: String(l) }),
        R("constraint.error", { id: n, error: String(l) });
    },
    onRequirementCreated: (n) => {
      d("requirement.created", { id: n.id, type: n.requirement.type }),
        r("requirement.created", { id: n.id, type: n.requirement.type }),
        R("requirement.created", { id: n.id, type: n.requirement.type });
    },
    onRequirementMet: (n, l) => {
      d("requirement.met", { id: n.id, byResolver: l }),
        r("requirement.met", { id: n.id, byResolver: l }),
        R("requirement.met", { id: n.id, byResolver: l });
    },
    onRequirementCanceled: (n) => {
      d("requirement.canceled", { id: n.id }),
        r("requirement.canceled", { id: n.id }),
        R("requirement.canceled", { id: n.id });
    },
    onResolverStart: (n, l) => {
      d("resolver.start", { resolver: n, requirementId: l.id }),
        r("resolver.start", { resolver: n, requirementId: l.id }),
        x.inflight.set(n, performance.now()),
        C &&
          p.system &&
          (P($ | A | b),
          R("resolver.start", { resolver: n, requirementId: l.id }));
    },
    onResolverComplete: (n, l, y) => {
      d("resolver.complete", { resolver: n, requirementId: l.id, duration: y }),
        r("resolver.complete", {
          resolver: n,
          requirementId: l.id,
          duration: y,
        });
      const k = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (k.count++,
        (k.totalMs += y),
        D.resolverStats.set(n, k),
        D.resolverStats.size > ht)
      ) {
        const L = D.resolverStats.keys().next().value;
        L !== void 0 && D.resolverStats.delete(L);
      }
      const q = x.inflight.get(n);
      x.inflight.delete(n),
        q !== void 0 &&
          x.entries.push({
            resolver: n,
            startMs: q,
            endMs: performance.now(),
            error: !1,
          }),
        C &&
          p.system &&
          (P($ | A | F | b),
          R("resolver.complete", { resolver: n, duration: y }));
    },
    onResolverError: (n, l, y) => {
      d("resolver.error", {
        resolver: n,
        requirementId: l.id,
        error: String(y),
      }),
        r("resolver.error", {
          resolver: n,
          requirementId: l.id,
          error: String(y),
        });
      const k = D.resolverStats.get(n) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((k.errors++, D.resolverStats.set(n, k), D.resolverStats.size > ht)) {
        const L = D.resolverStats.keys().next().value;
        L !== void 0 && D.resolverStats.delete(L);
      }
      const q = x.inflight.get(n);
      x.inflight.delete(n),
        q !== void 0 &&
          x.entries.push({
            resolver: n,
            startMs: q,
            endMs: performance.now(),
            error: !0,
          }),
        C &&
          p.system &&
          (P($ | A | F | b),
          R("resolver.error", { resolver: n, error: String(y) }));
    },
    onResolverRetry: (n, l, y) => {
      d("resolver.retry", { resolver: n, requirementId: l.id, attempt: y }),
        r("resolver.retry", { resolver: n, requirementId: l.id, attempt: y }),
        R("resolver.retry", { resolver: n, attempt: y });
    },
    onResolverCancel: (n, l) => {
      d("resolver.cancel", { resolver: n, requirementId: l.id }),
        r("resolver.cancel", { resolver: n, requirementId: l.id }),
        x.inflight.delete(n),
        R("resolver.cancel", { resolver: n });
    },
    onEffectRun: (n) => {
      d("effect.run", { id: n }),
        r("effect.run", { id: n }),
        D.effectRunCount++,
        R("effect.run", { id: n });
    },
    onEffectError: (n, l) => {
      d("effect.error", { id: n, error: String(l) }),
        D.effectErrorCount++,
        R("effect.error", { id: n, error: String(l) });
    },
    onSnapshot: (n) => {
      d("timetravel.snapshot", { id: n.id, trigger: n.trigger }),
        C && p.system && P(S),
        R("timetravel.snapshot", { id: n.id, trigger: n.trigger });
    },
    onTimeTravel: (n, l) => {
      if (
        (d("timetravel.jump", { from: n, to: l }),
        r("timetravel.jump", { from: n, to: l }),
        C && p.system)
      ) {
        const y = p.system;
        try {
          const k = y.facts.$store.toObject();
          _.clear(), C.refs.factsBody.replaceChildren();
          for (const [q, L] of Object.entries(k))
            je(_, C.refs.factsBody, q, L, !1);
          C.refs.factsCount.textContent = String(Object.keys(k).length);
        } catch {}
        O.clear(),
          j.derivationDeps.clear(),
          C.refs.derivBody.replaceChildren(),
          (K = null),
          P(g | A | $ | m | S),
          R("timetravel.jump", { from: n, to: l });
      }
    },
    onError: (n) => {
      d("error", {
        source: n.source,
        sourceId: n.sourceId,
        message: n.message,
      }),
        r("error", { source: n.source, message: n.message }),
        R("error", { source: n.source, message: n.message });
    },
    onErrorRecovery: (n, l) => {
      d("error.recovery", {
        source: n.source,
        sourceId: n.sourceId,
        strategy: l,
      }),
        R("error.recovery", { source: n.source, strategy: l });
    },
  };
}
var Ir = "__agent",
  _r = "__approval",
  qr = "__conversation",
  Fr = "__toolCalls",
  Nr = "__breakpoints";
Ir + "",
  Y.object(),
  _r + "",
  Y.object(),
  qr + "",
  Y.array(),
  Fr + "",
  Y.array(),
  Nr + "",
  Y.object();
function Ot(e) {
  const {
      fetch: t = globalThis.fetch,
      buildRequest: a,
      parseResponse: s,
      parseOutput: i,
      hooks: o,
    } = e,
    f =
      i ??
      ((u) => {
        try {
          return JSON.parse(u);
        } catch {
          return u;
        }
      });
  return async (u, h, p) => {
    const d = Date.now();
    o?.onBeforeCall?.({ agent: u, input: h, timestamp: d });
    const C = [{ role: "user", content: h }];
    try {
      const { url: _, init: O } = a(u, h, C),
        D = p?.signal ? { ...O, signal: p.signal } : O,
        j = await t(_, D);
      if (!j.ok) {
        const w = await j.text().catch(() => "");
        throw new Error(
          `[Directive] AgentRunner request failed: ${j.status} ${j.statusText}${w ? ` – ${w.slice(0, 300)}` : ""}`,
        );
      }
      const E = await s(j, C),
        x = {
          inputTokens: E.inputTokens ?? 0,
          outputTokens: E.outputTokens ?? 0,
        },
        T = { role: "assistant", content: E.text },
        M = [...C, T];
      p?.onMessage?.(T);
      const c = Date.now() - d;
      return (
        o?.onAfterCall?.({
          agent: u,
          input: h,
          output: E.text,
          totalTokens: E.totalTokens,
          tokenUsage: x,
          durationMs: c,
          timestamp: Date.now(),
        }),
        {
          output: f(E.text),
          messages: M,
          toolCalls: [],
          totalTokens: E.totalTokens,
          tokenUsage: x,
        }
      );
    } catch (_) {
      const O = Date.now() - d;
      throw (
        (_ instanceof Error &&
          o?.onError?.({
            agent: u,
            input: h,
            error: _,
            durationMs: O,
            timestamp: Date.now(),
          }),
        _)
      );
    }
  };
}
const jt = "goal-heist-api-key";
function ke() {
  return localStorage.getItem(jt);
}
function Br(e) {
  localStorage.setItem(jt, e);
}
const de = {
    gigi: {
      id: "gigi",
      name: "Gigi",
      emoji: "💄",
      title: "The Grifter",
      produces: ["guard_schedule"],
      requires: [],
      instruction:
        'You are Gigi "The Grifter", a master of social engineering. You sweet-talked the night guard and obtained their patrol schedule. Respond with JSON: { "guard_schedule": "<brief schedule description>" }',
      mockResponse: {
        guard_schedule:
          "Guards rotate every 45min. East wing unpatrolled 2:15-3:00 AM. Shift change at 3 AM — 4min blind spot.",
      },
      mockDelay: 800,
    },
    felix: {
      id: "felix",
      name: "Felix",
      emoji: "🖊️",
      title: "The Forger",
      produces: ["blueprints"],
      requires: [],
      instruction:
        'You are Felix "The Forger", an expert document forger. You acquired the museum floor plans from the city records archive. Respond with JSON: { "blueprints": "<brief blueprint description>" }',
      mockResponse: {
        blueprints:
          "Floor plan secured. Vault in sub-basement B2, access via service elevator. Air ducts too narrow — main corridor only.",
      },
      mockDelay: 1e3,
    },
    vince: {
      id: "vince",
      name: "Vince",
      emoji: "🚗",
      title: "The Wheelman",
      produces: ["escape_route"],
      requires: [],
      instruction:
        'You are Vince "The Wheelman", the fastest driver in the city. You scouted three escape routes and picked the best one. Respond with JSON: { "escape_route": "<brief route description>" }',
      mockResponse: {
        escape_route:
          "Primary: loading dock → alley → I-90 on-ramp. Backup: north exit → parking garage swap. ETA to safe house: 8 minutes.",
      },
      mockDelay: 600,
    },
    h4x: {
      id: "h4x",
      name: "H4X",
      emoji: "💻",
      title: "The Hacker",
      produces: ["cameras_disabled"],
      requires: ["guard_schedule"],
      instruction:
        'You are H4X "The Hacker". Using the guard schedule, you found the perfect window to loop the security cameras. Respond with JSON: { "cameras_disabled": "<brief description>" }',
      mockResponse: {
        cameras_disabled:
          "Cameras on loop from 2:15 AM. Feed shows empty corridors on repeat. Motion sensors in east wing bypassed.",
      },
      mockDelay: 1200,
    },
    luca: {
      id: "luca",
      name: "Luca",
      emoji: "🔓",
      title: "The Locksmith",
      produces: ["vault_cracked"],
      requires: ["cameras_disabled", "blueprints"],
      instruction:
        'You are Luca "The Locksmith". With cameras down and blueprints in hand, you cracked the vault. Respond with JSON: { "vault_cracked": "<brief description>" }',
      mockResponse: {
        vault_cracked:
          "Vault open. Biometric bypass took 90 seconds. Package secured. No alarms triggered.",
      },
      mockDelay: 1500,
    },
    ollie: {
      id: "ollie",
      name: "Ollie",
      emoji: "👁️",
      title: "The Lookout",
      produces: ["all_clear"],
      requires: ["vault_cracked", "escape_route"],
      instruction:
        'You are Ollie "The Lookout". The vault is cracked and the escape route is ready. Confirm all clear for extraction. Respond with JSON: { "all_clear": "<brief confirmation>" }',
      mockResponse: {
        all_clear:
          "All clear. No police activity within 2 miles. Team converging on loading dock. Go go go.",
      },
      mockDelay: 700,
    },
  },
  Ce = ["gigi", "felix", "vince", "h4x", "luca", "ollie"],
  Dt = {
    guard_schedule: 0.1,
    blueprints: 0.1,
    escape_route: 0.05,
    cameras_disabled: 0.2,
    vault_cracked: 0.35,
    all_clear: 0.2,
  };
function Be(e) {
  let t = 0;
  for (const [a, s] of Object.entries(Dt)) e[a] != null && (t += s);
  return Math.min(t, 1);
}
function Pe(e) {
  return e
    ? Ot({
        buildRequest: (t, a) => ({
          url: "/api/claude",
          init: {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": e },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 256,
              system: t.instructions ?? "",
              messages: [{ role: "user", content: a }],
            }),
          },
        }),
        parseResponse: async (t) => {
          const a = await t.json(),
            s = a.content?.[0]?.text ?? "",
            i = a.usage?.input_tokens ?? 0,
            o = a.usage?.output_tokens ?? 0;
          return { text: s, totalTokens: i + o };
        },
        parseOutput: (t) => {
          try {
            return JSON.parse(t);
          } catch {
            return t;
          }
        },
      })
    : Pr();
}
let Mt = !1,
  Tt = !1,
  Ue = 0;
function ze(e) {
  (Mt = e), (Ue = 0);
}
function Le(e) {
  Tt = e;
}
function Pr() {
  return Ot({
    buildRequest: (e, t) => ({
      url: "mock://local",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: e.name, input: t }),
      },
    }),
    parseResponse: async (e) => {
      const t = await e.json(),
        a = t.content?.[0]?.text ?? "",
        s = t.usage?.total_tokens ?? 0;
      return { text: a, totalTokens: s };
    },
    parseOutput: (e) => {
      try {
        return JSON.parse(e);
      } catch {
        return e;
      }
    },
    fetch: async (e, t) => {
      const s = JSON.parse(t?.body ?? "{}").agent?.toLowerCase() ?? "",
        i = Object.values(de).find((p) => p.name.toLowerCase() === s),
        o = i?.mockDelay ?? 800;
      if (
        (await new Promise((p) => setTimeout(p, o)),
        s === "h4x" && Mt && (Ue++, Ue <= 3))
      )
        return new Response(
          JSON.stringify({ error: "Firewall upgraded! Intrusion detected." }),
          { status: 500 },
        );
      if (s === "felix" && Tt)
        return new Response(
          JSON.stringify({ error: "Felix arrested at the archive!" }),
          { status: 500 },
        );
      const f = i?.mockResponse ?? {},
        u = Math.floor(Math.random() * 40) + 20,
        h = {
          content: [{ text: JSON.stringify(f) }],
          usage: { total_tokens: u },
        };
      return new Response(JSON.stringify(h), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}
let ve = null,
  $e = null,
  he = null;
function zr() {
  return new Promise((e) => {
    $e = e;
  });
}
function Ze() {
  if ($e) {
    const e = $e;
    ($e = null), e();
  }
}
function Lr(e, t, a) {
  if (e.length <= 1 || t === "allReady") return e;
  if (t === "highestImpact") {
    const s = e.map((i) => {
      const f = de[i]?.produces.reduce((u, h) => u + (Dt[h] ?? 0), 0) ?? 0;
      return { id: i, weight: f };
    });
    return s.sort((i, o) => o.weight - i.weight), [s[0].id];
  }
  if (t === "costEfficient") {
    const s = e.map((i) => ({ id: i, tokens: a[i] ?? 0 }));
    return s.sort((i, o) => i.tokens - o.tokens), [s[0].id];
  }
  return e;
}
function Se(e, t) {
  const a = [];
  for (const s of Ce) {
    if (e[s] !== "pending" && e[s] !== "ready") continue;
    const i = de[s];
    (i.requires.length === 0 || i.requires.every((f) => t[f] != null)) &&
      a.push(s);
  }
  return a;
}
const Hr = {
    facts: {
      status: Y.string(),
      currentStep: Y.number(),
      satisfaction: Y.number(),
      stallCount: Y.number(),
      totalTokens: Y.number(),
      achieved: Y.boolean(),
      error: Y.string(),
      nodeStatuses: Y.object(),
      nodeTokens: Y.object(),
      nodeProduced: Y.object(),
      goalFacts: Y.object(),
      stepHistory: Y.array(),
      relaxations: Y.array(),
      selectedStrategy: Y.string(),
      stepMode: Y.boolean(),
      selectedNode: Y.string(),
      apiKeySet: Y.boolean(),
      failHacker: Y.boolean(),
      failForger: Y.boolean(),
      maxSteps: Y.number(),
    },
    derivations: {
      progressPercent: Y.number(),
      readyNodes: Y.array(),
      summaryText: Y.string(),
      isStalled: Y.boolean(),
      avgTokensPerStep: Y.number(),
    },
    events: {
      start: {},
      pause: {},
      step: {},
      reset: {},
      changeStrategy: { strategy: Y.string() },
      selectNode: { nodeId: Y.string() },
      toggleFailHacker: { enabled: Y.boolean() },
      toggleFailForger: { enabled: Y.boolean() },
      setApiKey: { key: Y.string() },
      setStepMode: { enabled: Y.boolean() },
    },
    requirements: { EXECUTE_NEXT_STEP: {}, APPLY_RELAXATION: {} },
  },
  Kr = Jt("heist", {
    schema: Hr,
    init: (e) => {
      (e.status = "idle"),
        (e.currentStep = 0),
        (e.satisfaction = 0),
        (e.stallCount = 0),
        (e.totalTokens = 0),
        (e.achieved = !1),
        (e.error = "");
      const t = {};
      for (const a of Ce) t[a] = "pending";
      (e.nodeStatuses = t),
        (e.nodeTokens = {}),
        (e.nodeProduced = {}),
        (e.goalFacts = {}),
        (e.stepHistory = []),
        (e.relaxations = []),
        (e.selectedStrategy = "allReady"),
        (e.stepMode = !1),
        (e.selectedNode = ""),
        (e.apiKeySet = !!ke()),
        (e.failHacker = !1),
        (e.failForger = !1),
        (e.maxSteps = 20);
    },
    derive: {
      progressPercent: (e) => Math.round(e.satisfaction * 100),
      readyNodes: (e) => Se(e.nodeStatuses, e.goalFacts),
      summaryText: (e) => {
        if (e.status === "idle") return "Awaiting orders...";
        if (e.achieved)
          return `Mission complete! ${e.currentStep} steps, ${e.totalTokens} tokens.`;
        if (e.status === "error") return `Mission failed: ${e.error}`;
        const t = Object.entries(e.nodeStatuses)
          .filter(([, a]) => a === "running")
          .map(([a]) => de[a]?.name ?? a);
        return t.length > 0
          ? `Step ${e.currentStep}: ${t.join(", ")} in the field...`
          : `Step ${e.currentStep}: Planning next move...`;
      },
      isStalled: (e) => {
        const t = Se(e.nodeStatuses, e.goalFacts);
        return e.status === "running" && e.stallCount >= 2 && t.length === 0;
      },
      avgTokensPerStep: (e) =>
        e.currentStep === 0 ? 0 : Math.round(e.totalTokens / e.currentStep),
    },
    events: {
      start: (e) => {
        he?.abort(),
          (he = new AbortController()),
          (ve = Pe(ke())),
          (e.status = "running"),
          (e.stepMode = !1),
          ze(e.failHacker),
          Le(e.failForger);
      },
      pause: (e) => {
        e.status = "paused";
      },
      step: (e) => {
        e.status === "idle" &&
          (he?.abort(),
          (he = new AbortController()),
          (ve = Pe(ke())),
          (e.status = "running"),
          (e.stepMode = !0),
          ze(e.failHacker),
          Le(e.failForger)),
          Ze();
      },
      reset: (e) => {
        he?.abort(),
          (he = null),
          (ve = null),
          ($e = null),
          (e.status = "idle"),
          (e.currentStep = 0),
          (e.satisfaction = 0),
          (e.stallCount = 0),
          (e.totalTokens = 0),
          (e.achieved = !1),
          (e.error = "");
        const t = {};
        for (const a of Ce) t[a] = "pending";
        (e.nodeStatuses = t),
          (e.nodeTokens = {}),
          (e.nodeProduced = {}),
          (e.goalFacts = {}),
          (e.stepHistory = []),
          (e.relaxations = []);
      },
      changeStrategy: (e, { strategy: t }) => {
        e.selectedStrategy = t;
      },
      selectNode: (e, { nodeId: t }) => {
        e.selectedNode = t;
      },
      toggleFailHacker: (e, { enabled: t }) => {
        (e.failHacker = t), ze(t);
      },
      toggleFailForger: (e, { enabled: t }) => {
        (e.failForger = t), Le(t);
      },
      setApiKey: (e, { key: t }) => {
        Br(t), (e.apiKeySet = !0), (ve = null);
      },
      setStepMode: (e, { enabled: t }) => {
        e.stepMode = t;
      },
    },
    constraints: {
      autoAdvance: {
        priority: 50,
        when: (e) => {
          const t = Se(e.nodeStatuses, e.goalFacts);
          return (
            e.status === "running" &&
            !e.stepMode &&
            e.currentStep < e.maxSteps &&
            !e.achieved &&
            t.length > 0
          );
        },
        require: { type: "EXECUTE_NEXT_STEP" },
      },
      stallDetected: {
        priority: 80,
        when: (e) => {
          const t = Se(e.nodeStatuses, e.goalFacts);
          return (
            e.status === "running" &&
            t.length === 0 &&
            !e.achieved &&
            e.stallCount >= 2
          );
        },
        require: { type: "APPLY_RELAXATION" },
      },
    },
    resolvers: {
      executeStep: {
        requirement: "EXECUTE_NEXT_STEP",
        resolve: async (e, t) => {
          const {
              goalFacts: a,
              nodeStatuses: s,
              nodeTokens: i,
              nodeProduced: o,
              selectedStrategy: f,
              currentStep: u,
              satisfaction: h,
              stepMode: p,
            } = t.facts,
            d = he?.signal;
          if ((p && (await zr()), d?.aborted)) return;
          const C = ve ?? Pe(ke());
          ve = C;
          const _ = Se(s, a),
            O = Lr(_, f, i);
          if (O.length === 0) {
            t.facts.stallCount = t.facts.stallCount + 1;
            return;
          }
          const D = u + 1;
          t.facts.currentStep = D;
          const j = { ...s };
          for (const m of O) j[m] = "running";
          t.facts.nodeStatuses = j;
          const E = await Promise.allSettled(
            O.map(async (m) => {
              const S = de[m],
                b = JSON.stringify(
                  Object.fromEntries(
                    S.requires
                      .filter((z) => a[z] != null)
                      .map((z) => [z, a[z]]),
                  ),
                ),
                I = await C(
                  {
                    name: S.name,
                    instructions: S.instruction,
                    model: "claude-haiku-4-5-20251001",
                  },
                  b.length > 2 ? b : "Execute your mission.",
                );
              return { id: m, result: I };
            }),
          );
          if (d?.aborted) return;
          const x = { ...a },
            T = { ...t.facts.nodeStatuses },
            M = { ...i },
            c = { ...o },
            w = [],
            g = [];
          let $ = 0;
          for (let m = 0; m < E.length; m++) {
            const S = E[m],
              b = O[m];
            if (S.status === "fulfilled") {
              const { result: I } = S.value;
              w.push(b),
                (T[b] = "completed"),
                (M[b] = (M[b] ?? 0) + I.totalTokens),
                ($ += I.totalTokens);
              const z = de[b];
              try {
                const K =
                    typeof I.output == "string"
                      ? JSON.parse(I.output)
                      : I.output,
                  P = [];
                for (const v of z.produces)
                  K[v] != null && ((x[v] = K[v]), P.push(v), g.push(v));
                c[b] = P;
              } catch {
                c[b] = [];
              }
            } else
              w.push(b),
                (T[b] = "failed"),
                console.warn(`[Heist] ${de[b]?.name} failed:`, S.reason);
          }
          (t.facts.goalFacts = x),
            (t.facts.nodeStatuses = T),
            (t.facts.nodeTokens = M),
            (t.facts.nodeProduced = c),
            (t.facts.totalTokens = t.facts.totalTokens + $);
          const A = Be(x),
            F = A - h;
          (t.facts.satisfaction = A),
            F <= 0
              ? (t.facts.stallCount = t.facts.stallCount + 1)
              : (t.facts.stallCount = 0),
            (t.facts.stepHistory = [
              ...t.facts.stepHistory,
              {
                step: D,
                nodesRun: w,
                factsProduced: g,
                satisfaction: A,
                satisfactionDelta: F,
                tokens: $,
              },
            ]),
            x.all_clear != null &&
              ((t.facts.achieved = !0), (t.facts.status = "completed"));
        },
      },
      applyRelaxation: {
        requirement: "APPLY_RELAXATION",
        resolve: async (e, t) => {
          const {
              relaxations: a,
              currentStep: s,
              nodeStatuses: i,
              failHacker: o,
              failForger: f,
            } = t.facts,
            u = a.length;
          if (o && !t.facts.goalFacts.cameras_disabled) {
            if (u === 0) {
              const p = { ...i };
              (p.h4x = "pending"),
                (t.facts.nodeStatuses = p),
                (t.facts.stallCount = 0),
                (t.facts.relaxations = [
                  ...a,
                  {
                    step: s,
                    label: "Retry H4X — rebooting from backup terminal",
                    strategy: "allow_rerun",
                  },
                ]);
              return;
            }
            const h = { ...t.facts.goalFacts };
            (h.cameras_disabled =
              "Insider keycard used — cameras disabled via physical override."),
              (t.facts.goalFacts = h),
              (t.facts.satisfaction = Be(h)),
              (t.facts.stallCount = 0),
              (t.facts.relaxations = [
                ...a,
                {
                  step: s,
                  label: "Insider slipped a keycard — cameras disabled",
                  strategy: "inject_facts",
                },
              ]);
            return;
          }
          if (f && !t.facts.goalFacts.blueprints) {
            const h = { ...t.facts.goalFacts };
            (h.blueprints =
              "Public library records used — floor plan reconstructed from building permits."),
              (t.facts.goalFacts = h),
              (t.facts.satisfaction = Be(h)),
              (t.facts.stallCount = 0),
              (t.facts.relaxations = [
                ...a,
                {
                  step: s,
                  label: "Library records used as backup blueprints",
                  strategy: "inject_facts",
                },
              ]);
            return;
          }
          (t.facts.stallCount = 0),
            (t.facts.status = "error"),
            (t.facts.error = "Mission stalled — no recovery available.");
        },
      },
    },
    effects: {
      logStep: {
        run: (e, t) => {
          if (t && e.currentStep !== t.currentStep && e.currentStep > 0) {
            const a = e.stepHistory[e.stepHistory.length - 1];
            a &&
              console.log(
                `[Heist] Step ${a.step}: ${a.nodesRun.join(", ")} → ${a.satisfaction.toFixed(3)}`,
              );
          }
        },
      },
      announceResult: {
        deps: ["achieved"],
        run: (e, t) => {
          e.achieved &&
            (!t || !t.achieved) &&
            console.log(
              `[Heist] Mission complete! ${e.stepHistory.length} steps, ${e.totalTokens} tokens`,
            );
        },
      },
    },
  }),
  ie = lr({ module: Kr, plugins: [Tr({ name: "goal-heist" })] });
ie.start();
const re = (e) => document.getElementById(e),
  It = re("apiKeyBar"),
  bt = re("apiKeyInput"),
  Wr = re("apiKeySave"),
  Jr = re("apiKeySaved"),
  Ye = re("btnRun"),
  _t = re("btnStep"),
  qt = re("btnReset"),
  wt = re("strategySelect"),
  Ve = re("chkFailHacker"),
  Ge = re("chkFailForger"),
  St = re("summaryText"),
  Ur = re("satisfactionFill"),
  Yr = re("satisfactionLabel"),
  xt = re("factsList"),
  Vr = re("strategyBadge"),
  kt = re("crewList"),
  Gr = re("statStep"),
  Xr = re("statTokens"),
  Zr = re("statAvg"),
  le = re("logEntries"),
  Qr = re("mobileSatisfaction"),
  en = re("mobileStep");
ke() && It.classList.add("hidden");
Wr.addEventListener("click", () => {
  const e = bt.value.trim();
  e &&
    (ie.dispatch({ type: "setApiKey", key: e }),
    (Jr.style.display = "inline"),
    (bt.value = ""),
    setTimeout(() => {
      It.classList.add("hidden");
    }, 1e3));
});
Ye.addEventListener("click", () => {
  const { status: e, stepMode: t } = ie.facts;
  e === "idle"
    ? ie.dispatch({ type: "start" })
    : e === "running" &&
      t &&
      (ie.dispatch({ type: "setStepMode", enabled: !1 }), Ze());
});
_t.addEventListener("click", () => {
  const e = ie.facts.status;
  e === "idle"
    ? ie.dispatch({ type: "step" })
    : e === "running" && ie.facts.stepMode && Ze();
});
qt.addEventListener("click", () => {
  ie.dispatch({ type: "reset" }), (De = 0), (le.innerHTML = "");
});
wt.addEventListener("change", () => {
  ie.dispatch({ type: "changeStrategy", strategy: wt.value });
});
Ve.addEventListener("change", () => {
  ie.dispatch({ type: "toggleFailHacker", enabled: Ve.checked });
});
Ge.addEventListener("change", () => {
  ie.dispatch({ type: "toggleFailForger", enabled: Ge.checked });
});
document.querySelectorAll("[data-node]").forEach((e) => {
  e.setAttribute("tabindex", "0"),
    e.addEventListener("click", () => {
      const t = e.dataset.node;
      ie.dispatch({ type: "selectNode", nodeId: t });
    }),
    e.addEventListener("keydown", (t) => {
      if (t.key === "Enter" || t.key === " ") {
        t.preventDefault();
        const a = e.dataset.node;
        ie.dispatch({ type: "selectNode", nodeId: a });
      }
    });
});
const tn = {
    pending: "#475569",
    ready: "#3b82f6",
    running: "#fbbf24",
    completed: "#4ade80",
    failed: "#ef4444",
  },
  rn = [
    ["gigi", "h4x", "gigi-h4x"],
    ["felix", "luca", "felix-luca"],
    ["h4x", "luca", "h4x-luca"],
    ["vince", "ollie", "vince-ollie"],
    ["luca", "ollie", "luca-ollie"],
  ],
  nn = [
    "guard_schedule",
    "blueprints",
    "escape_route",
    "cameras_disabled",
    "vault_cracked",
    "all_clear",
  ];
let De = 0,
  He = 0;
function sn() {
  He ||
    (He = requestAnimationFrame(() => {
      (He = 0), Ft();
    }));
}
function Ft() {
  const e = ie.facts,
    t = e.nodeStatuses,
    a = e.goalFacts,
    s = e.stepHistory,
    i = e.relaxations,
    o = Number(ie.read("progressPercent") ?? 0),
    f = String(ie.read("summaryText") ?? ""),
    u = !!ie.read("isStalled"),
    h = e.status,
    p = e.achieved,
    d = e.selectedStrategy,
    C = e.selectedNode;
  (St.textContent = f), (St.className = `heist-status${u ? " stalled" : ""}`);
  const _ = h === "idle",
    O = h === "running",
    D = h === "completed" || h === "error",
    j = O && e.stepMode;
  (Ye.disabled = (O && !e.stepMode) || D),
    (Ye.textContent = _
      ? "Run Heist"
      : j
        ? "Continue Auto"
        : O
          ? "Running..."
          : p
            ? "Complete"
            : "Run Heist"),
    (_t.disabled = D),
    (qt.disabled = _),
    (Ve.disabled = !_),
    (Ge.disabled = !_);
  for (const x of Ce) {
    const T = t[x] ?? "pending",
      M = document.querySelector(`[data-node="${x}"]`);
    if (!M) continue;
    const c = M.querySelector("rect"),
      w = M.querySelector(`[data-status-label="${x}"]`),
      g = C === x;
    if (
      (c.setAttribute("stroke", tn[T]),
      T === "running"
        ? (c.setAttribute("stroke-width", "2.5"),
          (c.style.animation = "pulse 1s infinite"))
        : T === "failed"
          ? (c.setAttribute("stroke-width", "2.5"),
            (c.style.animation = "shake 0.3s"))
          : (c.setAttribute("stroke-width", g ? "2.5" : "1.5"),
            (c.style.animation = "")),
      g &&
        T !== "running" &&
        T !== "failed" &&
        c.setAttribute("stroke", "#a78bfa"),
      T === "completed")
    ) {
      const $ = de[x];
      (w.textContent = `✓ ${$.produces[0]}`), w.setAttribute("fill", "#4ade80");
    } else
      T === "failed"
        ? ((w.textContent = "✗ failed"), w.setAttribute("fill", "#ef4444"))
        : ((w.textContent = T), w.setAttribute("fill", "#64748b"));
  }
  for (const [x, T, M] of rn) {
    const c = document.querySelector(`[data-edge="${M}"]`);
    if (!c) continue;
    const w = t[x] ?? "pending",
      g = t[T] ?? "pending";
    g === "completed"
      ? (c.setAttribute("stroke", "#4ade80"),
        c.setAttribute("stroke-dasharray", ""))
      : g === "running" || w === "completed"
        ? (c.setAttribute("stroke", "#fbbf24"),
          c.setAttribute("stroke-dasharray", "6,3"))
        : (c.setAttribute("stroke", "#334155"),
          c.setAttribute("stroke-dasharray", "6,3"));
  }
  (Ur.style.width = `${o}%`),
    (Yr.textContent = `${o}%`),
    (Qr.textContent = `${o}%`),
    (en.textContent = `Step ${e.currentStep}`),
    (xt.textContent = "");
  for (const x of nn) {
    const T = a[x] != null,
      M = document.createElement("li"),
      c = document.createElement("span");
    (c.className = T ? "fact-check" : "fact-empty"),
      (c.textContent = T ? "●" : "○");
    const w = document.createElement("span");
    (w.className = "fact-key"),
      (w.textContent = x),
      M.append(c, w),
      xt.appendChild(M);
  }
  (Vr.textContent = d), (kt.textContent = "");
  for (const x of Ce) {
    const T = de[x],
      M = t[x] ?? "pending",
      c = e.nodeTokens[x] ?? 0,
      w = document.createElement("div");
    w.className = "agent-row";
    const g = document.createElement("span");
    g.className = `agent-dot ${M}`;
    const $ = document.createElement("span");
    ($.className = "agent-name"), ($.textContent = `${T.emoji} ${T.name}`);
    const A = document.createElement("span");
    (A.className = "agent-tokens"),
      (A.textContent = c > 0 ? `${c}t` : ""),
      w.append(g, $, A),
      kt.appendChild(w);
  }
  if (
    ((Gr.textContent = String(e.currentStep)),
    (Xr.textContent = String(e.totalTokens)),
    (Zr.textContent = String(Number(ie.read("avgTokensPerStep") ?? 0))),
    s.length + i.length > De || (p && !le.querySelector(".completion")))
  ) {
    for (let x = De; x < s.length; x++) {
      const T = s[x],
        M = T.nodesRun.map((F) => de[F]?.name ?? F).join(", "),
        c = T.satisfactionDelta > 0 ? "" : "zero",
        w = T.satisfactionDelta > 0 ? "+" : "",
        g = document.createElement("div");
      g.className = "log-entry";
      const $ = document.createElement("span");
      ($.className = "log-step"), ($.textContent = `Step ${T.step}:`);
      const A = document.createElement("span");
      (A.className = `log-delta ${c}`),
        (A.textContent = `${w}${(T.satisfactionDelta * 100).toFixed(0)}%`),
        g.append($, ` ${M} `, A),
        le.appendChild(g);
    }
    for (const x of i)
      if (!le.querySelector(`[data-rel-step="${x.step}-${x.strategy}"]`)) {
        const M = document.createElement("div");
        (M.className = "log-entry relaxation"),
          M.setAttribute("data-rel-step", `${x.step}-${x.strategy}`);
        const c = document.createElement("span");
        (c.className = "log-step"),
          (c.textContent = `⚠ Step ${x.step}:`),
          M.append(c, ` ${x.label} [${x.strategy}]`),
          le.appendChild(M);
      }
    if (p && !le.querySelector(".completion")) {
      const x = document.createElement("div");
      (x.className = "log-entry completion"),
        (x.textContent = `✅ Mission complete! ${s.length} steps, ${e.totalTokens} tokens.`),
        le.appendChild(x);
    }
    if (h === "error" && !le.querySelector(".error")) {
      const x = document.createElement("div");
      (x.className = "log-entry error"),
        (x.textContent = `❌ ${e.error}`),
        le.appendChild(x);
    }
    (De = s.length), (le.scrollTop = le.scrollHeight);
  }
}
ie.subscribe(
  [
    "status",
    "currentStep",
    "satisfaction",
    "nodeStatuses",
    "goalFacts",
    "stepHistory",
    "relaxations",
    "achieved",
    "error",
    "selectedStrategy",
    "selectedNode",
    "totalTokens",
    "nodeTokens",
    "nodeProduced",
    "stallCount",
    "stepMode",
  ],
  sn,
);
Ft();
