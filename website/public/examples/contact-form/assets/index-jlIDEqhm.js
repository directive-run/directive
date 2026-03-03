(() => {
  const n = document.createElement("link").relList;
  if (n && n.supports && n.supports("modulepreload")) return;
  for (const i of document.querySelectorAll('link[rel="modulepreload"]')) s(i);
  new MutationObserver((i) => {
    for (const o of i)
      if (o.type === "childList")
        for (const d of o.addedNodes)
          d.tagName === "LINK" && d.rel === "modulepreload" && s(d);
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
var Ne = class extends Error {
    constructor(n, a, s, i, o = !0) {
      super(n),
        (this.source = a),
        (this.sourceId = s),
        (this.context = i),
        (this.recoverable = o),
        (this.name = "DirectiveError");
    }
  },
  ge = [];
function vt() {
  const e = new Set();
  return {
    get isTracking() {
      return !0;
    },
    track(n) {
      e.add(n);
    },
    getDependencies() {
      return e;
    },
  };
}
var bt = {
  isTracking: !1,
  track() {},
  getDependencies() {
    return new Set();
  },
};
function wt() {
  return ge[ge.length - 1] ?? bt;
}
function ke(e) {
  const n = vt();
  ge.push(n);
  try {
    return { value: e(), deps: n.getDependencies() };
  } finally {
    ge.pop();
  }
}
function We(e) {
  const n = ge.splice(0, ge.length);
  try {
    return e();
  } finally {
    ge.push(...n);
  }
}
function qe(e) {
  wt().track(e);
}
function St(e, n = 100) {
  try {
    return JSON.stringify(e)?.slice(0, n) ?? String(e);
  } catch {
    return "[circular or non-serializable]";
  }
}
function Re(e = [], n, a, s, i, o) {
  return {
    _type: void 0,
    _validators: e,
    _typeName: n,
    _default: a,
    _transform: s,
    _description: i,
    _refinements: o,
    validate(d) {
      return Re([...e, d], n, a, s, i, o);
    },
  };
}
function ee(e, n, a, s, i, o) {
  return {
    ...Re(e, n, a, s, i, o),
    default(d) {
      return ee(e, n, d, s, i, o);
    },
    transform(d) {
      return ee(
        [],
        n,
        void 0,
        (c) => {
          const h = s ? s(c) : c;
          return d(h);
        },
        i,
      );
    },
    brand() {
      return ee(e, `Branded<${n}>`, a, s, i, o);
    },
    describe(d) {
      return ee(e, n, a, s, d, o);
    },
    refine(d, c) {
      const h = [...(o ?? []), { predicate: d, message: c }];
      return ee([...e, d], n, a, s, i, h);
    },
    nullable() {
      return ee(
        [(d) => d === null || e.every((c) => c(d))],
        `${n} | null`,
        a,
        s,
        i,
      );
    },
    optional() {
      return ee(
        [(d) => d === void 0 || e.every((c) => c(d))],
        `${n} | undefined`,
        a,
        s,
        i,
      );
    },
  };
}
var ne = {
  string() {
    return ee([(e) => typeof e == "string"], "string");
  },
  number() {
    const e = (n, a, s, i, o) => ({
      ...ee(n, "number", a, s, i, o),
      min(d) {
        return e([...n, (c) => c >= d], a, s, i, o);
      },
      max(d) {
        return e([...n, (c) => c <= d], a, s, i, o);
      },
      default(d) {
        return e(n, d, s, i, o);
      },
      describe(d) {
        return e(n, a, s, d, o);
      },
      refine(d, c) {
        const h = [...(o ?? []), { predicate: d, message: c }];
        return e([...n, d], a, s, i, h);
      },
    });
    return e([(n) => typeof n == "number"]);
  },
  boolean() {
    return ee([(e) => typeof e == "boolean"], "boolean");
  },
  array() {
    const e = (n, a, s, i, o) => {
      const d = ee(n, "array", s, void 0, i),
        c = o ?? { value: -1 };
      return {
        ...d,
        get _lastFailedIndex() {
          return c.value;
        },
        set _lastFailedIndex(h) {
          c.value = h;
        },
        of(h) {
          const m = { value: -1 };
          return e(
            [
              ...n,
              (u) => {
                for (let x = 0; x < u.length; x++) {
                  const T = u[x];
                  if (!h._validators.every((D) => D(T)))
                    return (m.value = x), !1;
                }
                return !0;
              },
            ],
            h,
            s,
            i,
            m,
          );
        },
        nonEmpty() {
          return e([...n, (h) => h.length > 0], a, s, i, c);
        },
        maxLength(h) {
          return e([...n, (m) => m.length <= h], a, s, i, c);
        },
        minLength(h) {
          return e([...n, (m) => m.length >= h], a, s, i, c);
        },
        default(h) {
          return e(n, a, h, i, c);
        },
        describe(h) {
          return e(n, a, s, h, c);
        },
      };
    };
    return e([(n) => Array.isArray(n)]);
  },
  object() {
    const e = (n, a, s) => ({
      ...ee(n, "object", a, void 0, s),
      shape(i) {
        return e(
          [
            ...n,
            (o) => {
              for (const [d, c] of Object.entries(i)) {
                const h = o[d],
                  m = c;
                if (m && !m._validators.every((u) => u(h))) return !1;
              }
              return !0;
            },
          ],
          a,
          s,
        );
      },
      nonNull() {
        return e([...n, (i) => i != null], a, s);
      },
      hasKeys(...i) {
        return e([...n, (o) => i.every((d) => d in o)], a, s);
      },
      default(i) {
        return e(n, i, s);
      },
      describe(i) {
        return e(n, a, i);
      },
    });
    return e([(n) => typeof n == "object" && n !== null && !Array.isArray(n)]);
  },
  enum(...e) {
    const n = new Set(e);
    return ee(
      [(a) => typeof a == "string" && n.has(a)],
      `enum(${e.join("|")})`,
    );
  },
  literal(e) {
    return ee([(n) => n === e], `literal(${String(e)})`);
  },
  nullable(e) {
    const n = e._typeName ?? "unknown";
    return Re(
      [(a) => (a === null ? !0 : e._validators.every((s) => s(a)))],
      `${n} | null`,
    );
  },
  optional(e) {
    const n = e._typeName ?? "unknown";
    return Re(
      [(a) => (a === void 0 ? !0 : e._validators.every((s) => s(a)))],
      `${n} | undefined`,
    );
  },
  union(...e) {
    const n = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [(a) => e.some((s) => s._validators.every((i) => i(a)))],
      n.join(" | "),
    );
  },
  record(e) {
    const n = e._typeName ?? "unknown";
    return ee(
      [
        (a) =>
          typeof a != "object" || a === null || Array.isArray(a)
            ? !1
            : Object.values(a).every((s) => e._validators.every((i) => i(s))),
      ],
      `Record<string, ${n}>`,
    );
  },
  tuple(...e) {
    const n = e.map((a) => a._typeName ?? "unknown");
    return ee(
      [
        (a) =>
          !Array.isArray(a) || a.length !== e.length
            ? !1
            : e.every((s, i) => s._validators.every((o) => o(a[i]))),
      ],
      `[${n.join(", ")}]`,
    );
  },
  date() {
    return ee([(e) => e instanceof Date && !isNaN(e.getTime())], "Date");
  },
  uuid() {
    const e =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return ee([(n) => typeof n == "string" && e.test(n)], "uuid");
  },
  email() {
    const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return ee([(n) => typeof n == "string" && e.test(n)], "email");
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
function Et(e) {
  const { schema: n, onChange: a, onBatch: s } = e;
  Object.keys(n).length;
  let i = e.validate ?? !1,
    o = e.strictKeys ?? !1,
    d = e.redactErrors ?? !1,
    c = new Map(),
    h = new Set(),
    m = new Map(),
    u = new Set(),
    x = 0,
    T = [],
    D = new Set(),
    O = !1,
    j = [],
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
  function L(f) {
    const b = f;
    if (b._typeName) return b._typeName;
    if (A(f)) {
      const w = f._def;
      if (w?.typeName) return w.typeName.replace(/^Zod/, "").toLowerCase();
    }
    return "unknown";
  }
  function _(f) {
    return d ? "[redacted]" : St(f);
  }
  function p(f, b) {
    if (!i) return;
    const w = n[f];
    if (!w) {
      if (o)
        throw new Error(
          `[Directive] Unknown fact key: "${f}". Key not defined in schema.`,
        );
      console.warn(`[Directive] Unknown fact key: "${f}"`);
      return;
    }
    if (A(w)) {
      const F = w.safeParse(b);
      if (!F.success) {
        const y = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          C = _(b),
          t =
            F.error?.message ??
            F.error?.issues?.[0]?.message ??
            "Validation failed",
          r = L(w);
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${r}, got ${y} ${C}. ${t}`,
        );
      }
      return;
    }
    const I = w,
      N = I._validators;
    if (!N || !Array.isArray(N) || N.length === 0) return;
    const K = I._typeName ?? "unknown";
    for (let F = 0; F < N.length; F++) {
      const y = N[F];
      if (typeof y == "function" && !y(b)) {
        let C = b === null ? "null" : Array.isArray(b) ? "array" : typeof b,
          t = _(b),
          r = "";
        typeof I._lastFailedIndex == "number" &&
          I._lastFailedIndex >= 0 &&
          ((r = ` (element at index ${I._lastFailedIndex} failed)`),
          (I._lastFailedIndex = -1));
        const l = F === 0 ? "" : ` (validator ${F + 1} failed)`;
        throw new Error(
          `[Directive] Validation failed for "${f}": expected ${K}, got ${C} ${t}${l}${r}`,
        );
      }
    }
  }
  function E(f) {
    m.get(f)?.forEach((b) => b());
  }
  function v() {
    u.forEach((f) => f());
  }
  function $(f, b, w) {
    if (O) {
      j.push({ key: f, value: b, prev: w });
      return;
    }
    O = !0;
    try {
      a?.(f, b, w), E(f), v();
      let I = 0;
      while (j.length > 0) {
        if (++I > k)
          throw (
            ((j.length = 0),
            new Error(
              `[Directive] Infinite notification loop detected after ${k} iterations. A listener is repeatedly mutating facts that re-trigger notifications.`,
            ))
          );
        const N = [...j];
        j.length = 0;
        for (const K of N) a?.(K.key, K.value, K.prev), E(K.key);
        v();
      }
    } finally {
      O = !1;
    }
  }
  function R() {
    if (!(x > 0)) {
      if ((s && T.length > 0 && s([...T]), D.size > 0)) {
        O = !0;
        try {
          for (const b of D) E(b);
          v();
          let f = 0;
          while (j.length > 0) {
            if (++f > k)
              throw (
                ((j.length = 0),
                new Error(
                  `[Directive] Infinite notification loop detected during flush after ${k} iterations.`,
                ))
              );
            const b = [...j];
            j.length = 0;
            for (const w of b) a?.(w.key, w.value, w.prev), E(w.key);
            v();
          }
        } finally {
          O = !1;
        }
      }
      (T.length = 0), D.clear();
    }
  }
  const z = {
    get(f) {
      return qe(f), c.get(f);
    },
    has(f) {
      return qe(f), c.has(f);
    },
    set(f, b) {
      p(f, b);
      const w = c.get(f);
      Object.is(w, b) ||
        (c.set(f, b),
        h.add(f),
        x > 0
          ? (T.push({ key: f, value: b, prev: w, type: "set" }), D.add(f))
          : $(f, b, w));
    },
    delete(f) {
      const b = c.get(f);
      c.delete(f),
        h.delete(f),
        x > 0
          ? (T.push({ key: f, value: void 0, prev: b, type: "delete" }),
            D.add(f))
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
      return u.add(f), () => u.delete(f);
    },
    toObject() {
      const f = {};
      for (const b of h) c.has(b) && (f[b] = c.get(b));
      return f;
    },
  };
  return (
    (z.registerKeys = (f) => {
      for (const b of Object.keys(f)) we.has(b) || ((n[b] = f[b]), h.add(b));
    }),
    z
  );
}
var we = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));
function xt(e, n) {
  const a = () => ({
    get: (s) => We(() => e.get(s)),
    has: (s) => We(() => e.has(s)),
  });
  return new Proxy(
    {},
    {
      get(s, i) {
        if (i === "$store") return e;
        if (i === "$snapshot") return a;
        if (typeof i != "symbol" && !we.has(i)) return e.get(i);
      },
      set(s, i, o) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          we.has(i)
          ? !1
          : (e.set(i, o), !0);
      },
      deleteProperty(s, i) {
        return typeof i == "symbol" ||
          i === "$store" ||
          i === "$snapshot" ||
          we.has(i)
          ? !1
          : (e.delete(i), !0);
      },
      has(s, i) {
        return i === "$store" || i === "$snapshot"
          ? !0
          : typeof i == "symbol" || we.has(i)
            ? !1
            : e.has(i);
      },
      ownKeys() {
        return Object.keys(n);
      },
      getOwnPropertyDescriptor(s, i) {
        return i === "$store" || i === "$snapshot"
          ? { configurable: !0, enumerable: !1, writable: !1 }
          : { configurable: !0, enumerable: !0, writable: !0 };
      },
    },
  );
}
function $t(e) {
  const n = Et(e),
    a = xt(n, e.schema);
  return { store: n, facts: a };
}
function Ct(e, n) {
  const a = "crossModuleDeps" in n ? n.crossModuleDeps : void 0;
  return {
    id: e,
    schema: n.schema,
    init: n.init,
    derive: n.derive ?? {},
    events: n.events ?? {},
    effects: n.effects,
    constraints: n.constraints,
    resolvers: n.resolvers,
    hooks: n.hooks,
    snapshotEvents: n.snapshotEvents,
    crossModuleDeps: a,
  };
}
async function xe(e, n, a) {
  let s,
    i = new Promise((o, d) => {
      s = setTimeout(() => d(new Error(a)), n);
    });
  try {
    return await Promise.race([e, i]);
  } finally {
    clearTimeout(s);
  }
}
function lt(e, n = 50) {
  const a = new WeakSet();
  function s(i, o) {
    if (o > n) return '"[max depth exceeded]"';
    if (i === null) return "null";
    if (i === void 0) return "undefined";
    const d = typeof i;
    if (d === "string") return JSON.stringify(i);
    if (d === "number" || d === "boolean") return String(i);
    if (d === "function") return '"[function]"';
    if (d === "symbol") return '"[symbol]"';
    if (Array.isArray(i)) {
      if (a.has(i)) return '"[circular]"';
      a.add(i);
      const c = `[${i.map((h) => s(h, o + 1)).join(",")}]`;
      return a.delete(i), c;
    }
    if (d === "object") {
      const c = i;
      if (a.has(c)) return '"[circular]"';
      a.add(c);
      const h = `{${Object.keys(c)
        .sort()
        .map((m) => `${JSON.stringify(m)}:${s(c[m], o + 1)}`)
        .join(",")}}`;
      return a.delete(c), h;
    }
    return '"[unknown]"';
  }
  return s(e, 0);
}
function Se(e, n = 50) {
  const a = new Set(["__proto__", "constructor", "prototype"]),
    s = new WeakSet();
  function i(o, d) {
    if (d > n) return !1;
    if (o == null || typeof o != "object") return !0;
    const c = o;
    if (s.has(c)) return !0;
    if ((s.add(c), Array.isArray(c))) {
      for (const h of c) if (!i(h, d + 1)) return s.delete(c), !1;
      return s.delete(c), !0;
    }
    for (const h of Object.keys(c))
      if (a.has(h) || !i(c[h], d + 1)) return s.delete(c), !1;
    return s.delete(c), !0;
  }
  return i(e, 0);
}
function kt(e) {
  let n = lt(e),
    a = 5381;
  for (let s = 0; s < n.length; s++) a = ((a << 5) + a) ^ n.charCodeAt(s);
  return (a >>> 0).toString(16);
}
function Rt(e, n) {
  if (n) return n(e);
  const { type: a, ...s } = e,
    i = lt(s);
  return `${a}:${i}`;
}
function At(e, n, a) {
  return { requirement: e, id: Rt(e, a), fromConstraint: n };
}
var _e = class at {
    map = new Map();
    add(n) {
      this.map.has(n.id) || this.map.set(n.id, n);
    }
    remove(n) {
      return this.map.delete(n);
    }
    has(n) {
      return this.map.has(n);
    }
    get(n) {
      return this.map.get(n);
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
      const n = new at();
      for (const a of this.map.values()) n.add(a);
      return n;
    }
    diff(n) {
      const a = [],
        s = [],
        i = [];
      for (const o of this.map.values()) n.has(o.id) ? i.push(o) : a.push(o);
      for (const o of n.map.values()) this.map.has(o.id) || s.push(o);
      return { added: a, removed: s, unchanged: i };
    }
  },
  jt = 5e3;
function Dt(e) {
  let {
      definitions: n,
      facts: a,
      requirementKeys: s = {},
      defaultTimeout: i = jt,
      onEvaluate: o,
      onError: d,
    } = e,
    c = new Map(),
    h = new Set(),
    m = new Set(),
    u = new Map(),
    x = new Map(),
    T = new Set(),
    D = new Map(),
    O = new Map(),
    j = !1,
    k = new Set(),
    A = new Set(),
    L = new Map(),
    _ = [],
    p = new Map();
  function E() {
    for (const [t, r] of Object.entries(n))
      if (r.after)
        for (const l of r.after)
          n[l] && (L.has(l) || L.set(l, new Set()), L.get(l).add(t));
  }
  function v() {
    const t = new Set(),
      r = new Set(),
      l = [];
    function g(S, M) {
      if (t.has(S)) return;
      if (r.has(S)) {
        const W = M.indexOf(S),
          B = [...M.slice(W), S].join(" → ");
        throw new Error(
          `[Directive] Constraint cycle detected: ${B}. Remove one of the \`after\` dependencies to break the cycle.`,
        );
      }
      r.add(S), M.push(S);
      const P = n[S];
      if (P?.after) for (const W of P.after) n[W] && g(W, M);
      M.pop(), r.delete(S), t.add(S), l.push(S);
    }
    for (const S of Object.keys(n)) g(S, []);
    (_ = l), (p = new Map(_.map((S, M) => [S, M])));
  }
  v(), E();
  function $(t, r) {
    return r.async !== void 0 ? r.async : !!m.has(t);
  }
  function R(t) {
    const r = n[t];
    if (!r) throw new Error(`[Directive] Unknown constraint: ${t}`);
    const l = $(t, r);
    l && m.add(t);
    const g = {
      id: t,
      priority: r.priority ?? 0,
      isAsync: l,
      lastResult: null,
      isEvaluating: !1,
      error: null,
      lastResolvedAt: null,
      after: r.after ?? [],
    };
    return c.set(t, g), g;
  }
  function z(t) {
    return c.get(t) ?? R(t);
  }
  function f(t, r) {
    const l = u.get(t) ?? new Set();
    for (const g of l) {
      const S = x.get(g);
      S?.delete(t), S && S.size === 0 && x.delete(g);
    }
    for (const g of r) x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    u.set(t, r);
  }
  function b(t) {
    const r = n[t];
    if (!r) return !1;
    const l = z(t);
    (l.isEvaluating = !0), (l.error = null);
    try {
      let g;
      if (r.deps) (g = r.when(a)), D.set(t, new Set(r.deps));
      else {
        const S = ke(() => r.when(a));
        (g = S.value), D.set(t, S.deps);
      }
      return g instanceof Promise
        ? (m.add(t),
          (l.isAsync = !0),
          g
            .then(
              (S) => ((l.lastResult = S), (l.isEvaluating = !1), o?.(t, S), S),
            )
            .catch(
              (S) => (
                (l.error = S instanceof Error ? S : new Error(String(S))),
                (l.lastResult = !1),
                (l.isEvaluating = !1),
                d?.(t, S),
                !1
              ),
            ))
        : ((l.lastResult = g), (l.isEvaluating = !1), o?.(t, g), g);
    } catch (g) {
      return (
        (l.error = g instanceof Error ? g : new Error(String(g))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        d?.(t, g),
        !1
      );
    }
  }
  async function w(t) {
    const r = n[t];
    if (!r) return !1;
    const l = z(t),
      g = r.timeout ?? i;
    if (((l.isEvaluating = !0), (l.error = null), r.deps?.length)) {
      const S = new Set(r.deps);
      f(t, S), D.set(t, S);
    }
    try {
      const S = r.when(a),
        M = await xe(S, g, `Constraint "${t}" timed out after ${g}ms`);
      return (l.lastResult = M), (l.isEvaluating = !1), o?.(t, M), M;
    } catch (S) {
      return (
        (l.error = S instanceof Error ? S : new Error(String(S))),
        (l.lastResult = !1),
        (l.isEvaluating = !1),
        d?.(t, S),
        !1
      );
    }
  }
  function I(t, r) {
    return t == null ? [] : Array.isArray(t) ? t.filter((g) => g != null) : [t];
  }
  function N(t) {
    const r = n[t];
    if (!r) return { requirements: [], deps: new Set() };
    const l = r.require;
    if (typeof l == "function") {
      const { value: g, deps: S } = ke(() => l(a));
      return { requirements: I(g), deps: S };
    }
    return { requirements: I(l), deps: new Set() };
  }
  function K(t, r) {
    if (r.size === 0) return;
    const l = u.get(t) ?? new Set();
    for (const g of r)
      l.add(g), x.has(g) || x.set(g, new Set()), x.get(g).add(t);
    u.set(t, l);
  }
  let F = null;
  function y() {
    return (
      F ||
        (F = Object.keys(n).sort((t, r) => {
          const l = z(t),
            g = z(r).priority - l.priority;
          if (g !== 0) return g;
          const S = p.get(t) ?? 0,
            M = p.get(r) ?? 0;
          return S - M;
        })),
      F
    );
  }
  for (const t of Object.keys(n)) R(t);
  function C(t) {
    const r = c.get(t);
    if (!r || r.after.length === 0) return !0;
    for (const l of r.after)
      if (n[l] && !h.has(l) && !A.has(l) && !k.has(l)) return !1;
    return !0;
  }
  return {
    async evaluate(t) {
      const r = new _e();
      A.clear();
      let l = y().filter((B) => !h.has(B)),
        g;
      if (!j || !t || t.size === 0) (g = l), (j = !0);
      else {
        const B = new Set();
        for (const U of t) {
          const J = x.get(U);
          if (J) for (const te of J) h.has(te) || B.add(te);
        }
        for (const U of T) h.has(U) || B.add(U);
        T.clear(), (g = [...B]);
        for (const U of l)
          if (!B.has(U)) {
            const J = O.get(U);
            if (J) for (const te of J) r.add(te);
          }
      }
      function S(B, U) {
        if (h.has(B)) return;
        const J = D.get(B);
        if (!U) {
          J !== void 0 && f(B, J), A.add(B), O.set(B, []);
          return;
        }
        A.delete(B);
        let te, Z;
        try {
          const X = N(B);
          (te = X.requirements), (Z = X.deps);
        } catch (X) {
          d?.(B, X), J !== void 0 && f(B, J), O.set(B, []);
          return;
        }
        if (J !== void 0) {
          const X = new Set(J);
          for (const V of Z) X.add(V);
          f(B, X);
        } else K(B, Z);
        if (te.length > 0) {
          const X = s[B],
            V = te.map((Y) => At(Y, B, X));
          for (const Y of V) r.add(Y);
          O.set(B, V);
        } else O.set(B, []);
      }
      async function M(B) {
        const U = [],
          J = [];
        for (const V of B)
          if (C(V)) J.push(V);
          else {
            U.push(V);
            const Y = O.get(V);
            if (Y) for (const G of Y) r.add(G);
          }
        if (J.length === 0) return U;
        const te = [],
          Z = [];
        for (const V of J) z(V).isAsync ? Z.push(V) : te.push(V);
        const X = [];
        for (const V of te) {
          const Y = b(V);
          if (Y instanceof Promise) {
            X.push({ id: V, promise: Y });
            continue;
          }
          S(V, Y);
        }
        if (X.length > 0) {
          const V = await Promise.all(
            X.map(async ({ id: Y, promise: G }) => ({
              id: Y,
              active: await G,
            })),
          );
          for (const { id: Y, active: G } of V) S(Y, G);
        }
        if (Z.length > 0) {
          const V = await Promise.all(
            Z.map(async (Y) => ({ id: Y, active: await w(Y) })),
          );
          for (const { id: Y, active: G } of V) S(Y, G);
        }
        return U;
      }
      let P = g,
        W = g.length + 1;
      while (P.length > 0 && W > 0) {
        const B = P.length;
        if (((P = await M(P)), P.length === B)) break;
        W--;
      }
      return r.all();
    },
    getState(t) {
      return c.get(t);
    },
    getAllStates() {
      return [...c.values()];
    },
    disable(t) {
      h.add(t), (F = null), O.delete(t);
      const r = u.get(t);
      if (r) {
        for (const l of r) {
          const g = x.get(l);
          g && (g.delete(t), g.size === 0 && x.delete(l));
        }
        u.delete(t);
      }
      D.delete(t);
    },
    enable(t) {
      h.delete(t), (F = null), T.add(t);
    },
    invalidate(t) {
      const r = x.get(t);
      if (r) for (const l of r) T.add(l);
    },
    markResolved(t) {
      k.add(t);
      const r = c.get(t);
      r && (r.lastResolvedAt = Date.now());
      const l = L.get(t);
      if (l) for (const g of l) T.add(g);
    },
    isResolved(t) {
      return k.has(t);
    },
    registerDefinitions(t) {
      for (const [r, l] of Object.entries(t)) (n[r] = l), R(r), T.add(r);
      (F = null), v(), E();
    },
  };
}
function Ot(e) {
  let {
      definitions: n,
      facts: a,
      onCompute: s,
      onInvalidate: i,
      onError: o,
    } = e,
    d = new Map(),
    c = new Map(),
    h = new Map(),
    m = new Map(),
    u = new Set(["__proto__", "constructor", "prototype"]),
    x = 0,
    T = new Set(),
    D = !1,
    O = 100,
    j;
  function k(v) {
    if (!n[v]) throw new Error(`[Directive] Unknown derivation: ${v}`);
    const $ = {
      id: v,
      compute: () => L(v),
      cachedValue: void 0,
      dependencies: new Set(),
      isStale: !0,
      isComputing: !1,
    };
    return d.set(v, $), $;
  }
  function A(v) {
    return d.get(v) ?? k(v);
  }
  function L(v) {
    const $ = A(v),
      R = n[v];
    if (!R) throw new Error(`[Directive] Unknown derivation: ${v}`);
    if ($.isComputing)
      throw new Error(
        `[Directive] Circular dependency detected in derivation: ${v}`,
      );
    $.isComputing = !0;
    try {
      const { value: z, deps: f } = ke(() => R(a, j));
      return (
        ($.cachedValue = z), ($.isStale = !1), _(v, f), s?.(v, z, [...f]), z
      );
    } catch (z) {
      throw (o?.(v, z), z);
    } finally {
      $.isComputing = !1;
    }
  }
  function _(v, $) {
    const R = A(v),
      z = R.dependencies;
    for (const f of z)
      if (d.has(f)) {
        const b = m.get(f);
        b?.delete(v), b && b.size === 0 && m.delete(f);
      } else {
        const b = h.get(f);
        b?.delete(v), b && b.size === 0 && h.delete(f);
      }
    for (const f of $)
      n[f]
        ? (m.has(f) || m.set(f, new Set()), m.get(f).add(v))
        : (h.has(f) || h.set(f, new Set()), h.get(f).add(v));
    R.dependencies = $;
  }
  function p() {
    if (!(x > 0 || D)) {
      D = !0;
      try {
        let v = 0;
        while (T.size > 0) {
          if (++v > O) {
            const R = [...T];
            throw (
              (T.clear(),
              new Error(
                `[Directive] Infinite derivation notification loop detected after ${O} iterations. Remaining: ${R.join(", ")}. This usually means a derivation listener is mutating facts that re-trigger the same derivation.`,
              ))
            );
          }
          const $ = [...T];
          T.clear();
          for (const R of $) c.get(R)?.forEach((z) => z());
        }
      } finally {
        D = !1;
      }
    }
  }
  function E(v, $ = new Set()) {
    if ($.has(v)) return;
    $.add(v);
    const R = d.get(v);
    if (!R || R.isStale) return;
    (R.isStale = !0), i?.(v), T.add(v);
    const z = m.get(v);
    if (z) for (const f of z) E(f, $);
  }
  return (
    (j = new Proxy(
      {},
      {
        get(v, $) {
          if (typeof $ == "symbol" || u.has($)) return;
          qe($);
          const R = A($);
          return R.isStale && L($), R.cachedValue;
        },
      },
    )),
    {
      get(v) {
        const $ = A(v);
        return $.isStale && L(v), $.cachedValue;
      },
      isStale(v) {
        return d.get(v)?.isStale ?? !0;
      },
      invalidate(v) {
        const $ = h.get(v);
        if ($) {
          x++;
          try {
            for (const R of $) E(R);
          } finally {
            x--, p();
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
          x--, p();
        }
      },
      invalidateAll() {
        x++;
        try {
          for (const v of d.values())
            v.isStale || ((v.isStale = !0), T.add(v.id));
        } finally {
          x--, p();
        }
      },
      subscribe(v, $) {
        for (const R of v) {
          const z = R;
          c.has(z) || c.set(z, new Set()), c.get(z).add($);
        }
        return () => {
          for (const R of v) {
            const z = R,
              f = c.get(z);
            f?.delete($), f && f.size === 0 && c.delete(z);
          }
        };
      },
      getProxy() {
        return j;
      },
      getDependencies(v) {
        return A(v).dependencies;
      },
      registerDefinitions(v) {
        for (const [$, R] of Object.entries(v)) (n[$] = R), k($);
      },
    }
  );
}
function Mt(e) {
  let { definitions: n, facts: a, store: s, onRun: i, onError: o } = e,
    d = new Map(),
    c = null,
    h = !1;
  function m(k) {
    const A = n[k];
    if (!A) throw new Error(`[Directive] Unknown effect: ${k}`);
    const L = {
      id: k,
      enabled: !0,
      hasExplicitDeps: !!A.deps,
      dependencies: A.deps ? new Set(A.deps) : null,
      cleanup: null,
    };
    return d.set(k, L), L;
  }
  function u(k) {
    return d.get(k) ?? m(k);
  }
  function x() {
    return s.toObject();
  }
  function T(k, A) {
    const L = u(k);
    if (!L.enabled) return !1;
    if (L.dependencies) {
      for (const _ of L.dependencies) if (A.has(_)) return !0;
      return !1;
    }
    return !0;
  }
  function D(k) {
    if (k.cleanup) {
      try {
        k.cleanup();
      } catch (A) {
        o?.(k.id, A),
          console.error(
            `[Directive] Effect "${k.id}" cleanup threw an error:`,
            A,
          );
      }
      k.cleanup = null;
    }
  }
  function O(k, A) {
    if (typeof A == "function")
      if (h)
        try {
          A();
        } catch (L) {
          o?.(k.id, L),
            console.error(
              `[Directive] Effect "${k.id}" cleanup threw an error:`,
              L,
            );
        }
      else k.cleanup = A;
  }
  async function j(k) {
    const A = u(k),
      L = n[k];
    if (!(!A.enabled || !L)) {
      D(A), i?.(k);
      try {
        if (A.hasExplicitDeps) {
          let _;
          if (
            (s.batch(() => {
              _ = L.run(a, c);
            }),
            _ instanceof Promise)
          ) {
            const p = await _;
            O(A, p);
          } else O(A, _);
        } else {
          let _ = null,
            p,
            E = ke(
              () => (
                s.batch(() => {
                  p = L.run(a, c);
                }),
                p
              ),
            );
          _ = E.deps;
          let v = E.value;
          v instanceof Promise && (v = await v),
            O(A, v),
            (A.dependencies = _.size > 0 ? _ : null);
        }
      } catch (_) {
        o?.(k, _),
          console.error(`[Directive] Effect "${k}" threw an error:`, _);
      }
    }
  }
  for (const k of Object.keys(n)) m(k);
  return {
    async runEffects(k) {
      const A = [];
      for (const L of Object.keys(n)) T(L, k) && A.push(L);
      await Promise.all(A.map(j)), (c = x());
    },
    async runAll() {
      const k = Object.keys(n);
      await Promise.all(
        k.map((A) => (u(A).enabled ? j(A) : Promise.resolve())),
      ),
        (c = x());
    },
    disable(k) {
      const A = u(k);
      A.enabled = !1;
    },
    enable(k) {
      const A = u(k);
      A.enabled = !0;
    },
    isEnabled(k) {
      return u(k).enabled;
    },
    cleanupAll() {
      h = !0;
      for (const k of d.values()) D(k);
    },
    registerDefinitions(k) {
      for (const [A, L] of Object.entries(k)) (n[A] = L), m(A);
    },
  };
}
function It(e = {}) {
  const {
      delayMs: n = 1e3,
      maxRetries: a = 3,
      backoffMultiplier: s = 2,
      maxDelayMs: i = 3e4,
    } = e,
    o = new Map();
  function d(c) {
    const h = n * Math.pow(s, c - 1);
    return Math.min(h, i);
  }
  return {
    scheduleRetry(c, h, m, u, x) {
      if (u > a) return null;
      const T = d(u),
        D = {
          source: c,
          sourceId: h,
          context: m,
          attempt: u,
          nextRetryTime: Date.now() + T,
          callback: x,
        };
      return o.set(h, D), D;
    },
    getPendingRetries() {
      return Array.from(o.values());
    },
    processDueRetries() {
      const c = Date.now(),
        h = [];
      for (const [m, u] of o) u.nextRetryTime <= c && (h.push(u), o.delete(m));
      return h;
    },
    cancelRetry(c) {
      o.delete(c);
    },
    clearAll() {
      o.clear();
    },
  };
}
var qt = {
  constraint: "skip",
  resolver: "skip",
  effect: "skip",
  derivation: "skip",
  system: "throw",
};
function _t(e = {}) {
  const { config: n = {}, onError: a, onRecovery: s } = e,
    i = [],
    o = 100,
    d = It(n.retryLater),
    c = new Map();
  function h(u, x, T, D) {
    if (T instanceof Ne) return T;
    const O = T instanceof Error ? T.message : String(T),
      j = u !== "system";
    return new Ne(O, u, x, D, j);
  }
  function m(u, x, T) {
    const D = (() => {
      switch (u) {
        case "constraint":
          return n.onConstraintError;
        case "resolver":
          return n.onResolverError;
        case "effect":
          return n.onEffectError;
        case "derivation":
          return n.onDerivationError;
        default:
          return;
      }
    })();
    if (typeof D == "function") {
      try {
        D(T, x);
      } catch (O) {
        console.error("[Directive] Error in error handler callback:", O);
      }
      return "skip";
    }
    return typeof D == "string" ? D : qt[u];
  }
  return {
    handleError(u, x, T, D) {
      const O = h(u, x, T, D);
      i.push(O), i.length > o && i.shift();
      try {
        a?.(O);
      } catch (k) {
        console.error("[Directive] Error in onError callback:", k);
      }
      try {
        n.onError?.(O);
      } catch (k) {
        console.error("[Directive] Error in config.onError callback:", k);
      }
      let j = m(u, x, T instanceof Error ? T : new Error(String(T)));
      if (j === "retry-later") {
        const k = (c.get(x) ?? 0) + 1;
        c.set(x, k),
          d.scheduleRetry(u, x, D, k) ||
            ((j = "skip"), c.delete(x), typeof process < "u");
      }
      try {
        s?.(O, j);
      } catch (k) {
        console.error("[Directive] Error in onRecovery callback:", k);
      }
      if (j === "throw") throw O;
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
      c.delete(u), d.cancelRetry(u);
    },
  };
}
function Bt() {
  const e = [];
  function n(s) {
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
      for (const i of e) n(() => i.onStart?.(s));
    },
    emitStop(s) {
      for (const i of e) n(() => i.onStop?.(s));
    },
    emitDestroy(s) {
      for (const i of e) n(() => i.onDestroy?.(s));
    },
    emitFactSet(s, i, o) {
      for (const d of e) n(() => d.onFactSet?.(s, i, o));
    },
    emitFactDelete(s, i) {
      for (const o of e) n(() => o.onFactDelete?.(s, i));
    },
    emitFactsBatch(s) {
      for (const i of e) n(() => i.onFactsBatch?.(s));
    },
    emitDerivationCompute(s, i, o) {
      for (const d of e) n(() => d.onDerivationCompute?.(s, i, o));
    },
    emitDerivationInvalidate(s) {
      for (const i of e) n(() => i.onDerivationInvalidate?.(s));
    },
    emitReconcileStart(s) {
      for (const i of e) n(() => i.onReconcileStart?.(s));
    },
    emitReconcileEnd(s) {
      for (const i of e) n(() => i.onReconcileEnd?.(s));
    },
    emitConstraintEvaluate(s, i) {
      for (const o of e) n(() => o.onConstraintEvaluate?.(s, i));
    },
    emitConstraintError(s, i) {
      for (const o of e) n(() => o.onConstraintError?.(s, i));
    },
    emitRequirementCreated(s) {
      for (const i of e) n(() => i.onRequirementCreated?.(s));
    },
    emitRequirementMet(s, i) {
      for (const o of e) n(() => o.onRequirementMet?.(s, i));
    },
    emitRequirementCanceled(s) {
      for (const i of e) n(() => i.onRequirementCanceled?.(s));
    },
    emitResolverStart(s, i) {
      for (const o of e) n(() => o.onResolverStart?.(s, i));
    },
    emitResolverComplete(s, i, o) {
      for (const d of e) n(() => d.onResolverComplete?.(s, i, o));
    },
    emitResolverError(s, i, o) {
      for (const d of e) n(() => d.onResolverError?.(s, i, o));
    },
    emitResolverRetry(s, i, o) {
      for (const d of e) n(() => d.onResolverRetry?.(s, i, o));
    },
    emitResolverCancel(s, i) {
      for (const o of e) n(() => o.onResolverCancel?.(s, i));
    },
    emitEffectRun(s) {
      for (const i of e) n(() => i.onEffectRun?.(s));
    },
    emitEffectError(s, i) {
      for (const o of e) n(() => o.onEffectError?.(s, i));
    },
    emitSnapshot(s) {
      for (const i of e) n(() => i.onSnapshot?.(s));
    },
    emitTimeTravel(s, i) {
      for (const o of e) n(() => o.onTimeTravel?.(s, i));
    },
    emitError(s) {
      for (const i of e) n(() => i.onError?.(s));
    },
    emitErrorRecovery(s, i) {
      for (const o of e) n(() => o.onErrorRecovery?.(s, i));
    },
  };
}
var Ke = { attempts: 1, backoff: "none", initialDelay: 100, maxDelay: 3e4 },
  He = { enabled: !1, windowMs: 50 };
function Ve(e, n) {
  let { backoff: a, initialDelay: s = 100, maxDelay: i = 3e4 } = e,
    o;
  switch (a) {
    case "none":
      o = s;
      break;
    case "linear":
      o = s * n;
      break;
    case "exponential":
      o = s * Math.pow(2, n - 1);
      break;
    default:
      o = s;
  }
  return Math.max(1, Math.min(o, i));
}
function Tt(e) {
  const {
      definitions: n,
      facts: a,
      store: s,
      onStart: i,
      onComplete: o,
      onError: d,
      onRetry: c,
      onCancel: h,
      onResolutionComplete: m,
    } = e,
    u = new Map(),
    x = new Map(),
    T = 1e3,
    D = new Map(),
    O = new Map(),
    j = 1e3;
  function k() {
    if (x.size > T) {
      const f = x.size - T,
        b = x.keys();
      for (let w = 0; w < f; w++) {
        const I = b.next().value;
        I && x.delete(I);
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
  function L(f) {
    return (
      typeof f == "object" &&
      f !== null &&
      "requirement" in f &&
      typeof f.requirement == "function"
    );
  }
  function _(f, b) {
    return A(f) ? b.type === f.requirement : L(f) ? f.requirement(b) : !1;
  }
  function p(f) {
    const b = f.type,
      w = O.get(b);
    if (w)
      for (const I of w) {
        const N = n[I];
        if (N && _(N, f)) return I;
      }
    for (const [I, N] of Object.entries(n))
      if (_(N, f)) {
        if (!O.has(b)) {
          if (O.size >= j) {
            const F = O.keys().next().value;
            F !== void 0 && O.delete(F);
          }
          O.set(b, []);
        }
        const K = O.get(b);
        return K.includes(I) || K.push(I), I;
      }
    return null;
  }
  function E(f) {
    return { facts: a, signal: f, snapshot: () => a.$snapshot() };
  }
  async function v(f, b, w) {
    const I = n[f];
    if (!I) return;
    let N = { ...Ke, ...I.retry },
      K = null;
    for (let F = 1; F <= N.attempts; F++) {
      if (w.signal.aborted) return;
      const y = u.get(b.id);
      y &&
        ((y.attempt = F),
        (y.status = {
          state: "running",
          requirementId: b.id,
          startedAt: y.startedAt,
          attempt: F,
        }));
      try {
        const C = E(w.signal);
        if (I.resolve) {
          let r;
          s.batch(() => {
            r = I.resolve(b.requirement, C);
          });
          const l = I.timeout;
          l && l > 0
            ? await xe(r, l, `Resolver "${f}" timed out after ${l}ms`)
            : await r;
        }
        const t = Date.now() - (y?.startedAt ?? Date.now());
        x.set(b.id, {
          state: "success",
          requirementId: b.id,
          completedAt: Date.now(),
          duration: t,
        }),
          k(),
          o?.(f, b, t);
        return;
      } catch (C) {
        if (
          ((K = C instanceof Error ? C : new Error(String(C))),
          w.signal.aborted)
        )
          return;
        if (N.shouldRetry && !N.shouldRetry(K, F)) break;
        if (F < N.attempts) {
          if (w.signal.aborted) return;
          const t = Ve(N, F);
          if (
            (c?.(f, b, F + 1),
            await new Promise((r) => {
              const l = setTimeout(r, t),
                g = () => {
                  clearTimeout(l), r();
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
      k(),
      d?.(f, b, K);
  }
  async function $(f, b) {
    const w = n[f];
    if (!w) return;
    if (!w.resolveBatch && !w.resolveBatchWithResults) {
      await Promise.all(
        b.map((t) => {
          const r = new AbortController();
          return v(f, t, r);
        }),
      );
      return;
    }
    let I = { ...Ke, ...w.retry },
      N = { ...He, ...w.batch },
      K = new AbortController(),
      F = Date.now(),
      y = null,
      C = N.timeoutMs ?? w.timeout;
    for (let t = 1; t <= I.attempts; t++) {
      if (K.signal.aborted) return;
      try {
        const r = E(K.signal),
          l = b.map((g) => g.requirement);
        if (w.resolveBatchWithResults) {
          let g, S;
          if (
            (s.batch(() => {
              S = w.resolveBatchWithResults(l, r);
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
          let M = Date.now() - F,
            P = !1;
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
                o?.(f, B, M);
            else {
              P = !0;
              const J = U.error ?? new Error("Batch item failed");
              x.set(B.id, {
                state: "error",
                requirementId: B.id,
                error: J,
                failedAt: Date.now(),
                attempts: t,
              }),
                d?.(f, B, J);
            }
          }
          if (!P || b.some((W, B) => g[B]?.success)) return;
        } else {
          let g;
          s.batch(() => {
            g = w.resolveBatch(l, r);
          }),
            C && C > 0
              ? await xe(g, C, `Batch resolver "${f}" timed out after ${C}ms`)
              : await g;
          const S = Date.now() - F;
          for (const M of b)
            x.set(M.id, {
              state: "success",
              requirementId: M.id,
              completedAt: Date.now(),
              duration: S,
            }),
              o?.(f, M, S);
          return;
        }
      } catch (r) {
        if (
          ((y = r instanceof Error ? r : new Error(String(r))),
          K.signal.aborted)
        )
          return;
        if (I.shouldRetry && !I.shouldRetry(y, t)) break;
        if (t < I.attempts) {
          const l = Ve(I, t);
          for (const g of b) c?.(f, g, t + 1);
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
    for (const t of b)
      x.set(t.id, {
        state: "error",
        requirementId: t.id,
        error: y,
        failedAt: Date.now(),
        attempts: I.attempts,
      }),
        d?.(f, t, y);
    k();
  }
  function R(f, b) {
    const w = n[f];
    if (!w) return;
    const I = { ...He, ...w.batch };
    D.has(f) || D.set(f, { resolverId: f, requirements: [], timer: null });
    const N = D.get(f);
    N.requirements.push(b),
      N.timer && clearTimeout(N.timer),
      (N.timer = setTimeout(() => {
        z(f);
      }, I.windowMs));
  }
  function z(f) {
    const b = D.get(f);
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
      if (u.has(f.id)) return;
      const b = p(f.requirement);
      if (!b) {
        console.warn(`[Directive] No resolver found for requirement: ${f.id}`);
        return;
      }
      const w = n[b];
      if (!w) return;
      if (w.batch?.enabled) {
        R(b, f);
        return;
      }
      const I = new AbortController(),
        N = Date.now(),
        K = {
          requirementId: f.id,
          resolverId: b,
          controller: I,
          startedAt: N,
          attempt: 1,
          status: { state: "pending", requirementId: f.id, startedAt: N },
          originalRequirement: f,
        };
      u.set(f.id, K),
        i?.(b, f),
        v(b, f, I).finally(() => {
          u.delete(f.id) && m?.();
        });
    },
    cancel(f) {
      const b = u.get(f);
      b &&
        (b.controller.abort(),
        u.delete(f),
        x.set(f, {
          state: "canceled",
          requirementId: f,
          canceledAt: Date.now(),
        }),
        k(),
        h?.(b.resolverId, b.originalRequirement));
    },
    cancelAll() {
      for (const [f] of u) this.cancel(f);
      for (const f of D.values()) f.timer && clearTimeout(f.timer);
      D.clear();
    },
    getStatus(f) {
      const b = u.get(f);
      return b ? b.status : x.get(f) || { state: "idle" };
    },
    getInflight() {
      return [...u.keys()];
    },
    getInflightInfo() {
      return [...u.values()].map((f) => ({
        id: f.requirementId,
        resolverId: f.resolverId,
        startedAt: f.startedAt,
      }));
    },
    isResolving(f) {
      return u.has(f);
    },
    processBatches() {
      for (const f of D.keys()) z(f);
    },
    registerDefinitions(f) {
      for (const [b, w] of Object.entries(f)) n[b] = w;
      O.clear();
    },
  };
}
function zt(e) {
  let { config: n, facts: a, store: s, onSnapshot: i, onTimeTravel: o } = e,
    d = n.timeTravel ?? !1,
    c = n.maxSnapshots ?? 100,
    h = [],
    m = -1,
    u = 1,
    x = !1,
    T = !1,
    D = [],
    O = null,
    j = -1;
  function k() {
    return s.toObject();
  }
  function A() {
    const _ = k();
    return structuredClone(_);
  }
  function L(_) {
    if (!Se(_)) {
      console.error(
        "[Directive] Potential prototype pollution detected in snapshot data, skipping restore",
      );
      return;
    }
    s.batch(() => {
      for (const [p, E] of Object.entries(_)) {
        if (p === "__proto__" || p === "constructor" || p === "prototype") {
          console.warn(
            `[Directive] Skipping dangerous key "${p}" during fact restoration`,
          );
          continue;
        }
        a[p] = E;
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
      return x;
    },
    get snapshots() {
      return [...h];
    },
    get currentIndex() {
      return m;
    },
    takeSnapshot(_) {
      if (!d || x)
        return { id: -1, timestamp: Date.now(), facts: {}, trigger: _ };
      const p = { id: u++, timestamp: Date.now(), facts: A(), trigger: _ };
      for (
        m < h.length - 1 && h.splice(m + 1), h.push(p), m = h.length - 1;
        h.length > c;
      )
        h.shift(), m--;
      return i?.(p), p;
    },
    restore(_) {
      if (d) {
        (x = !0), (T = !0);
        try {
          L(_.facts);
        } finally {
          (x = !1), (T = !1);
        }
      }
    },
    goBack(_ = 1) {
      if (!d || h.length === 0) return;
      let p = m,
        E = m,
        v = D.find((R) => m > R.startIndex && m <= R.endIndex);
      if (v) E = v.startIndex;
      else if (D.find((R) => m === R.startIndex)) {
        const R = D.find((z) => z.endIndex < m && m - z.endIndex <= _);
        E = R ? R.startIndex : Math.max(0, m - _);
      } else E = Math.max(0, m - _);
      if (p === E) return;
      m = E;
      const $ = h[m];
      $ && (this.restore($), o?.(p, E));
    },
    goForward(_ = 1) {
      if (!d || h.length === 0) return;
      let p = m,
        E = m,
        v = D.find((R) => m >= R.startIndex && m < R.endIndex);
      if ((v ? (E = v.endIndex) : (E = Math.min(h.length - 1, m + _)), p === E))
        return;
      m = E;
      const $ = h[m];
      $ && (this.restore($), o?.(p, E));
    },
    goTo(_) {
      if (!d) return;
      const p = h.findIndex(($) => $.id === _);
      if (p === -1) {
        console.warn(`[Directive] Snapshot ${_} not found`);
        return;
      }
      const E = m;
      m = p;
      const v = h[m];
      v && (this.restore(v), o?.(E, p));
    },
    replay() {
      if (!d || h.length === 0) return;
      m = 0;
      const _ = h[0];
      _ && this.restore(_);
    },
    export() {
      return JSON.stringify({ version: 1, snapshots: h, currentIndex: m });
    },
    import(_) {
      if (d)
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
            if (!Se(v.facts))
              throw new Error(
                "Invalid fact data: potential prototype pollution detected in nested objects",
              );
          }
          (h.length = 0), h.push(...p.snapshots), (m = p.currentIndex);
          const E = h[m];
          E && this.restore(E);
        } catch (p) {
          console.error("[Directive] Failed to import time-travel data:", p);
        }
    },
    beginChangeset(_) {
      d && ((O = _), (j = m));
    },
    endChangeset() {
      !d ||
        O === null ||
        (m > j && D.push({ label: O, startIndex: j, endIndex: m }),
        (O = null),
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
var le = new Set(["__proto__", "constructor", "prototype"]);
function ut(e) {
  const n = Object.create(null),
    a = Object.create(null),
    s = Object.create(null),
    i = Object.create(null),
    o = Object.create(null),
    d = Object.create(null);
  for (const t of e.modules) {
    const r = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (le.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}. This could indicate a prototype pollution attempt.`,
            );
      }
    };
    r(t.schema, "schema"),
      r(t.events, "events"),
      r(t.derive, "derive"),
      r(t.effects, "effects"),
      r(t.constraints, "constraints"),
      r(t.resolvers, "resolvers"),
      Object.assign(n, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && Object.assign(s, t.derive),
      t.effects && Object.assign(i, t.effects),
      t.constraints && Object.assign(o, t.constraints),
      t.resolvers && Object.assign(d, t.resolvers);
  }
  let c = null;
  if (e.modules.some((t) => t.snapshotEvents)) {
    c = new Set();
    for (const t of e.modules) {
      const r = t;
      if (r.snapshotEvents) for (const l of r.snapshotEvents) c.add(l);
      else if (r.events) for (const l of Object.keys(r.events)) c.add(l);
    }
  }
  let h = 0,
    m = !1,
    u = Bt();
  for (const t of e.plugins ?? []) u.register(t);
  let x = _t({
      config: e.errorBoundary,
      onError: (t) => u.emitError(t),
      onRecovery: (t, r) => u.emitErrorRecovery(t, r),
    }),
    T = () => {},
    D = () => {},
    O = null,
    { store: j, facts: k } = $t({
      schema: n,
      onChange: (t, r, l) => {
        u.emitFactSet(t, r, l),
          T(t),
          !O?.isRestoring && (h === 0 && (m = !0), w.changedKeys.add(t), I());
      },
      onBatch: (t) => {
        u.emitFactsBatch(t);
        const r = [];
        for (const l of t) r.push(l.key);
        if ((D(r), !O?.isRestoring)) {
          h === 0 && (m = !0);
          for (const l of t) w.changedKeys.add(l.key);
          I();
        }
      },
    }),
    A = Ot({
      definitions: s,
      facts: k,
      onCompute: (t, r, l) => u.emitDerivationCompute(t, r, l),
      onInvalidate: (t) => u.emitDerivationInvalidate(t),
      onError: (t, r) => {
        x.handleError("derivation", t, r);
      },
    });
  (T = (t) => A.invalidate(t)), (D = (t) => A.invalidateMany(t));
  const L = Mt({
      definitions: i,
      facts: k,
      store: j,
      onRun: (t) => u.emitEffectRun(t),
      onError: (t, r) => {
        x.handleError("effect", t, r), u.emitEffectError(t, r);
      },
    }),
    _ = Dt({
      definitions: o,
      facts: k,
      onEvaluate: (t, r) => u.emitConstraintEvaluate(t, r),
      onError: (t, r) => {
        x.handleError("constraint", t, r), u.emitConstraintError(t, r);
      },
    }),
    p = Tt({
      definitions: d,
      facts: k,
      store: j,
      onStart: (t, r) => u.emitResolverStart(t, r),
      onComplete: (t, r, l) => {
        u.emitResolverComplete(t, r, l),
          u.emitRequirementMet(r, t),
          _.markResolved(r.fromConstraint);
      },
      onError: (t, r, l) => {
        x.handleError("resolver", t, l, r), u.emitResolverError(t, r, l);
      },
      onRetry: (t, r, l) => u.emitResolverRetry(t, r, l),
      onCancel: (t, r) => {
        u.emitResolverCancel(t, r), u.emitRequirementCanceled(r);
      },
      onResolutionComplete: () => {
        z(), I();
      },
    }),
    E = new Set();
  function v() {
    for (const t of E) t();
  }
  const $ = e.debug?.timeTravel
    ? zt({
        config: e.debug,
        facts: k,
        store: j,
        onSnapshot: (t) => {
          u.emitSnapshot(t), v();
        },
        onTimeTravel: (t, r) => {
          u.emitTimeTravel(t, r), v();
        },
      })
    : Ft();
  O = $;
  const R = new Set();
  function z() {
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
      z(),
      queueMicrotask(() => {
        (w.reconcileScheduled = !1),
          w.isRunning && !w.isInitializing && N().catch((t) => {});
      }));
  }
  async function N() {
    if (!w.isReconciling) {
      if ((b++, b > f)) {
        b = 0;
        return;
      }
      (w.isReconciling = !0), z();
      try {
        w.changedKeys.size > 0 &&
          ((c === null || m) &&
            $.takeSnapshot(`facts-changed:${[...w.changedKeys].join(",")}`),
          (m = !1));
        const t = k.$snapshot();
        u.emitReconcileStart(t), await L.runEffects(w.changedKeys);
        const r = new Set(w.changedKeys);
        w.changedKeys.clear();
        const l = await _.evaluate(r),
          g = new _e();
        for (const B of l) g.add(B), u.emitRequirementCreated(B);
        const { added: S, removed: M } = g.diff(w.previousRequirements);
        for (const B of M) p.cancel(B.id);
        for (const B of S) p.resolve(B);
        w.previousRequirements = g;
        const P = p.getInflightInfo(),
          W = {
            unmet: l.filter((B) => !p.isResolving(B.id)),
            inflight: P,
            completed: [],
            canceled: M.map((B) => ({
              id: B.id,
              resolverId: P.find((U) => U.id === B.id)?.resolverId ?? "unknown",
            })),
          };
        u.emitReconcileEnd(W),
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
  const K = new Proxy(
      {},
      {
        get(t, r) {
          if (typeof r != "symbol" && !le.has(r)) return A.get(r);
        },
        has(t, r) {
          return typeof r == "symbol" || le.has(r) ? !1 : r in s;
        },
        ownKeys() {
          return Object.keys(s);
        },
        getOwnPropertyDescriptor(t, r) {
          if (typeof r != "symbol" && !le.has(r) && r in s)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    F = new Proxy(
      {},
      {
        get(t, r) {
          if (typeof r != "symbol" && !le.has(r))
            return (l) => {
              const g = a[r];
              if (g) {
                h++, (c === null || c.has(r)) && (m = !0);
                try {
                  j.batch(() => {
                    g(k, { type: r, ...l });
                  });
                } finally {
                  h--;
                }
              }
            };
        },
        has(t, r) {
          return typeof r == "symbol" || le.has(r) ? !1 : r in a;
        },
        ownKeys() {
          return Object.keys(a);
        },
        getOwnPropertyDescriptor(t, r) {
          if (typeof r != "symbol" && !le.has(r) && r in a)
            return { configurable: !0, enumerable: !0 };
        },
      },
    ),
    y = {
      facts: k,
      debug: $.isEnabled ? $ : null,
      derive: K,
      events: F,
      constraints: { disable: (t) => _.disable(t), enable: (t) => _.enable(t) },
      effects: {
        disable: (t) => L.disable(t),
        enable: (t) => L.enable(t),
        isEnabled: (t) => L.isEnabled(t),
      },
      initialize() {
        if (!w.isInitialized) {
          w.isInitializing = !0;
          for (const t of e.modules)
            t.init &&
              j.batch(() => {
                t.init(k);
              });
          e.onAfterModuleInit &&
            j.batch(() => {
              e.onAfterModuleInit();
            }),
            (w.isInitializing = !1),
            (w.isInitialized = !0);
          for (const t of Object.keys(s)) A.get(t);
        }
      },
      start() {
        if (!w.isRunning) {
          w.isInitialized || this.initialize(), (w.isRunning = !0);
          for (const t of e.modules) t.hooks?.onStart?.(y);
          u.emitStart(y), I();
        }
      },
      stop() {
        if (w.isRunning) {
          (w.isRunning = !1), p.cancelAll(), L.cleanupAll();
          for (const t of e.modules) t.hooks?.onStop?.(y);
          u.emitStop(y);
        }
      },
      destroy() {
        this.stop(),
          (w.isDestroyed = !0),
          R.clear(),
          E.clear(),
          u.emitDestroy(y);
      },
      dispatch(t) {
        if (le.has(t.type)) return;
        const r = a[t.type];
        if (r) {
          h++, (c === null || c.has(t.type)) && (m = !0);
          try {
            j.batch(() => {
              r(k, t);
            });
          } finally {
            h--;
          }
        }
      },
      read(t) {
        return A.get(t);
      },
      subscribe(t, r) {
        const l = [],
          g = [];
        for (const M of t) M in s ? l.push(M) : M in n && g.push(M);
        const S = [];
        return (
          l.length > 0 && S.push(A.subscribe(l, r)),
          g.length > 0 && S.push(j.subscribe(g, r)),
          () => {
            for (const M of S) M();
          }
        );
      },
      watch(t, r, l) {
        const g = l?.equalityFn
          ? (M, P) => l.equalityFn(M, P)
          : (M, P) => Object.is(M, P);
        if (t in s) {
          let M = A.get(t);
          return A.subscribe([t], () => {
            const P = A.get(t);
            if (!g(P, M)) {
              const W = M;
              (M = P), r(P, W);
            }
          });
        }
        let S = j.get(t);
        return j.subscribe([t], () => {
          const M = j.get(t);
          if (!g(M, S)) {
            const P = S;
            (S = M), r(M, P);
          }
        });
      },
      when(t, r) {
        return new Promise((l, g) => {
          const S = j.toObject();
          if (t(S)) {
            l();
            return;
          }
          let M,
            P,
            W = () => {
              M?.(), P !== void 0 && clearTimeout(P);
            };
          (M = j.subscribeAll(() => {
            const B = j.toObject();
            t(B) && (W(), l());
          })),
            r?.timeout !== void 0 &&
              r.timeout > 0 &&
              (P = setTimeout(() => {
                W(),
                  g(
                    new Error(
                      `[Directive] when: timed out after ${r.timeout}ms`,
                    ),
                  );
              }, r.timeout));
        });
      },
      inspect() {
        return {
          unmet: w.previousRequirements.all(),
          inflight: p.getInflightInfo(),
          constraints: _.getAllStates().map((t) => ({
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
        const r = w.previousRequirements.all().find((U) => U.id === t);
        if (!r) return null;
        const l = _.getState(r.fromConstraint),
          g = p.getStatus(t),
          S = {},
          M = j.toObject();
        for (const [U, J] of Object.entries(M)) S[U] = J;
        const P = [
            `Requirement "${r.requirement.type}" (id: ${r.id})`,
            `├─ Produced by constraint: ${r.fromConstraint}`,
            `├─ Constraint priority: ${l?.priority ?? 0}`,
            `├─ Constraint active: ${l?.lastResult ?? "unknown"}`,
            `├─ Resolver status: ${g.state}`,
          ],
          W = Object.entries(r.requirement)
            .filter(([U]) => U !== "type")
            .map(([U, J]) => `${U}=${JSON.stringify(J)}`)
            .join(", ");
        W && P.push(`├─ Requirement payload: { ${W} }`);
        const B = Object.entries(S).slice(0, 10);
        return (
          B.length > 0 &&
            (P.push("└─ Relevant facts:"),
            B.forEach(([U, J], te) => {
              const Z = te === B.length - 1 ? "   └─" : "   ├─",
                X = typeof J == "object" ? JSON.stringify(J) : String(J);
              P.push(
                `${Z} ${U} = ${X.slice(0, 50)}${X.length > 50 ? "..." : ""}`,
              );
            })),
          P.join(`
`)
        );
      },
      async settle(t = 5e3) {
        const r = Date.now();
        for (;;) {
          await new Promise((g) => setTimeout(g, 0));
          const l = this.inspect();
          if (
            l.inflight.length === 0 &&
            !w.isReconciling &&
            !w.reconcileScheduled
          )
            return;
          if (Date.now() - r > t) {
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
            includeDerivations: r,
            excludeDerivations: l,
            includeFacts: g,
            ttlSeconds: S,
            metadata: M,
            includeVersion: P,
          } = t,
          W = {},
          B = Object.keys(s),
          U;
        if ((r ? (U = r.filter((Z) => B.includes(Z))) : (U = B), l)) {
          const Z = new Set(l);
          U = U.filter((X) => !Z.has(X));
        }
        for (const Z of U)
          try {
            W[Z] = A.get(Z);
          } catch {}
        if (g && g.length > 0) {
          const Z = j.toObject();
          for (const X of g) X in Z && (W[X] = Z[X]);
        }
        const J = Date.now(),
          te = { data: W, createdAt: J };
        return (
          S !== void 0 && S > 0 && (te.expiresAt = J + S * 1e3),
          P && (te.version = kt(W)),
          M && (te.metadata = M),
          te
        );
      },
      watchDistributableSnapshot(t, r) {
        let { includeDerivations: l, excludeDerivations: g } = t,
          S = Object.keys(s),
          M;
        if ((l ? (M = l.filter((W) => S.includes(W))) : (M = S), g)) {
          const W = new Set(g);
          M = M.filter((B) => !W.has(B));
        }
        if (M.length === 0) return () => {};
        let P = this.getDistributableSnapshot({
          ...t,
          includeVersion: !0,
        }).version;
        return A.subscribe(M, () => {
          const W = this.getDistributableSnapshot({ ...t, includeVersion: !0 });
          W.version !== P && ((P = W.version), r(W));
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
        if (!Se(t))
          throw new Error(
            "[Directive] restore() rejected: snapshot contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.",
          );
        j.batch(() => {
          for (const [r, l] of Object.entries(t.facts))
            le.has(r) || j.set(r, l);
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
  function C(t) {
    if (w.isReconciling)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" during reconciliation. Wait for the current reconciliation cycle to complete.`,
      );
    if (w.isDestroyed)
      throw new Error(
        `[Directive] Cannot register module "${t.id}" on a destroyed system.`,
      );
    const r = (l, g) => {
      if (l) {
        for (const S of Object.keys(l))
          if (le.has(S))
            throw new Error(
              `[Directive] Security: Module "${t.id}" has dangerous key "${S}" in ${g}.`,
            );
      }
    };
    r(t.schema, "schema"),
      r(t.events, "events"),
      r(t.derive, "derive"),
      r(t.effects, "effects"),
      r(t.constraints, "constraints"),
      r(t.resolvers, "resolvers");
    for (const l of Object.keys(t.schema))
      if (l in n)
        throw new Error(
          `[Directive] Schema collision: Fact "${l}" already exists. Cannot register module "${t.id}".`,
        );
    if (t.snapshotEvents) {
      c === null && (c = new Set(Object.keys(a)));
      for (const l of t.snapshotEvents) c.add(l);
    } else if (c !== null && t.events)
      for (const l of Object.keys(t.events)) c.add(l);
    Object.assign(n, t.schema),
      t.events && Object.assign(a, t.events),
      t.derive && (Object.assign(s, t.derive), A.registerDefinitions(t.derive)),
      t.effects &&
        (Object.assign(i, t.effects), L.registerDefinitions(t.effects)),
      t.constraints &&
        (Object.assign(o, t.constraints), _.registerDefinitions(t.constraints)),
      t.resolvers &&
        (Object.assign(d, t.resolvers), p.registerDefinitions(t.resolvers)),
      j.registerKeys(t.schema),
      e.modules.push(t),
      t.init &&
        j.batch(() => {
          t.init(k);
        }),
      t.hooks?.onInit?.(y),
      w.isRunning && (t.hooks?.onStart?.(y), I());
  }
  (y.registerModule = C), u.emitInit(y);
  for (const t of e.modules) t.hooks?.onInit?.(y);
  return y;
}
var re = Object.freeze(new Set(["__proto__", "constructor", "prototype"])),
  H = "::";
function Pt(e) {
  const n = Object.keys(e),
    a = new Set(),
    s = new Set(),
    i = [],
    o = [];
  function d(c) {
    if (a.has(c)) return;
    if (s.has(c)) {
      const m = o.indexOf(c),
        u = [...o.slice(m), c].join(" → ");
      throw new Error(
        `[Directive] Circular dependency detected: ${u}. Modules cannot have circular crossModuleDeps. Break the cycle by removing one of the cross-module references.`,
      );
    }
    s.add(c), o.push(c);
    const h = e[c];
    if (h?.crossModuleDeps)
      for (const m of Object.keys(h.crossModuleDeps)) n.includes(m) && d(m);
    o.pop(), s.delete(c), a.add(c), i.push(c);
  }
  for (const c of n) d(c);
  return i;
}
var Ue = new WeakMap(),
  Ye = new WeakMap(),
  Je = new WeakMap(),
  Ge = new WeakMap();
function Lt(e) {
  if ("module" in e) {
    if (!e.module)
      throw new Error(
        "[Directive] createSystem requires a module. Got: " + typeof e.module,
      );
    return Ht(e);
  }
  const n = e;
  if (Array.isArray(n.modules))
    throw new Error(`[Directive] createSystem expects modules as an object, not an array.

Instead of:
  createSystem({ modules: [authModule, dataModule] })

Use:
  createSystem({ modules: { auth: authModule, data: dataModule } })

Or for a single module:
  createSystem({ module: counterModule })`);
  return Nt(n);
}
function Nt(e) {
  const n = e.modules,
    a = new Set(Object.keys(n)),
    s = e.debug?.snapshotModules ? new Set(e.debug.snapshotModules) : null;
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  let i,
    o = e.initOrder ?? "auto";
  if (Array.isArray(o)) {
    const p = o,
      E = Object.keys(n).filter((v) => !p.includes(v));
    if (E.length > 0)
      throw new Error(
        `[Directive] initOrder is missing modules: ${E.join(", ")}. All modules must be included in the explicit order.`,
      );
    i = p;
  } else o === "declaration" ? (i = Object.keys(n)) : (i = Pt(n));
  let d = e.debug,
    c = e.errorBoundary;
  e.zeroConfig &&
    ((d = { timeTravel: !1, maxSnapshots: 100, ...e.debug }),
    (c = {
      onConstraintError: "skip",
      onResolverError: "skip",
      onEffectError: "skip",
      onDerivationError: "skip",
      ...e.errorBoundary,
    }));
  for (const p of Object.keys(n)) {
    if (p.includes(H))
      throw new Error(
        `[Directive] Module name "${p}" contains the reserved separator "${H}". Module names cannot contain "${H}".`,
      );
    const E = n[p];
    if (E) {
      for (const v of Object.keys(E.schema.facts))
        if (v.includes(H))
          throw new Error(
            `[Directive] Schema key "${v}" in module "${p}" contains the reserved separator "${H}". Schema keys cannot contain "${H}".`,
          );
    }
  }
  const h = [];
  for (const p of i) {
    const E = n[p];
    if (!E) continue;
    const v = E.crossModuleDeps && Object.keys(E.crossModuleDeps).length > 0,
      $ = v ? Object.keys(E.crossModuleDeps) : [],
      R = {};
    for (const [y, C] of Object.entries(E.schema.facts)) R[`${p}${H}${y}`] = C;
    const z = {};
    if (E.schema.derivations)
      for (const [y, C] of Object.entries(E.schema.derivations))
        z[`${p}${H}${y}`] = C;
    const f = {};
    if (E.schema.events)
      for (const [y, C] of Object.entries(E.schema.events))
        f[`${p}${H}${y}`] = C;
    const b = E.init
        ? (y) => {
            const C = se(y, p);
            E.init(C);
          }
        : void 0,
      w = {};
    if (E.derive)
      for (const [y, C] of Object.entries(E.derive))
        w[`${p}${H}${y}`] = (t, r) => {
          const l = v ? ae(t, p, $) : se(t, p),
            g = Be(r, p);
          return C(l, g);
        };
    const I = {};
    if (E.events)
      for (const [y, C] of Object.entries(E.events))
        I[`${p}${H}${y}`] = (t, r) => {
          const l = se(t, p);
          C(l, r);
        };
    const N = {};
    if (E.constraints)
      for (const [y, C] of Object.entries(E.constraints)) {
        const t = C;
        N[`${p}${H}${y}`] = {
          ...t,
          deps: t.deps?.map((r) => `${p}${H}${r}`),
          when: (r) => {
            const l = v ? ae(r, p, $) : se(r, p);
            return t.when(l);
          },
          require:
            typeof t.require == "function"
              ? (r) => {
                  const l = v ? ae(r, p, $) : se(r, p);
                  return t.require(l);
                }
              : t.require,
        };
      }
    const K = {};
    if (E.resolvers)
      for (const [y, C] of Object.entries(E.resolvers)) {
        const t = C;
        K[`${p}${H}${y}`] = {
          ...t,
          resolve: async (r, l) => {
            const g = je(l.facts, n, () => Object.keys(n));
            await t.resolve(r, { facts: g[p], signal: l.signal });
          },
        };
      }
    const F = {};
    if (E.effects)
      for (const [y, C] of Object.entries(E.effects)) {
        const t = C;
        F[`${p}${H}${y}`] = {
          ...t,
          run: (r, l) => {
            const g = v ? ae(r, p, $) : se(r, p),
              S = l ? (v ? ae(l, p, $) : se(l, p)) : void 0;
            return t.run(g, S);
          },
          deps: t.deps?.map((r) => `${p}${H}${r}`),
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
      events: I,
      effects: F,
      constraints: N,
      resolvers: K,
      hooks: E.hooks,
      snapshotEvents:
        s && !s.has(p) ? [] : E.snapshotEvents?.map((y) => `${p}${H}${y}`),
    });
  }
  let m = null,
    u = null;
  function x(p) {
    for (const [E, v] of Object.entries(p))
      if (!re.has(E) && a.has(E)) {
        if (v && typeof v == "object" && !Se(v))
          throw new Error(
            `[Directive] initialFacts/hydrate for namespace "${E}" contains potentially dangerous keys (__proto__, constructor, or prototype). This may indicate a prototype pollution attack.`,
          );
        for (const [$, R] of Object.entries(v))
          re.has($) || (u.facts[`${E}${H}${$}`] = R);
      }
  }
  u = ut({
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
    errorBoundary: c,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      e.initialFacts && x(e.initialFacts), m && (x(m), (m = null));
    },
  });
  const T = new Map();
  for (const p of Object.keys(n)) {
    const E = n[p];
    if (!E) continue;
    const v = [];
    for (const $ of Object.keys(E.schema.facts)) v.push(`${p}${H}${$}`);
    if (E.schema.derivations)
      for (const $ of Object.keys(E.schema.derivations)) v.push(`${p}${H}${$}`);
    T.set(p, v);
  }
  const D = { names: null };
  function O() {
    return D.names === null && (D.names = Object.keys(n)), D.names;
  }
  let j = je(u.facts, n, O),
    k = Wt(u.derive, n, O),
    A = Kt(u, n, O),
    L = null,
    _ = e.tickMs;
  return {
    _mode: "namespaced",
    facts: j,
    debug: u.debug,
    derive: k,
    events: A,
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
    async hydrate(p) {
      if (u.isRunning)
        throw new Error(
          "[Directive] hydrate() must be called before start(). The system is already running.",
        );
      const E = await p();
      E && typeof E == "object" && (m = E);
    },
    initialize() {
      u.initialize();
    },
    start() {
      if ((u.start(), _ && _ > 0)) {
        const p = Object.keys(h[0]?.events ?? {}).find((E) =>
          E.endsWith(`${H}tick`),
        );
        p &&
          (L = setInterval(() => {
            u.dispatch({ type: p });
          }, _));
      }
    },
    stop() {
      L && (clearInterval(L), (L = null)), u.stop();
    },
    destroy() {
      this.stop(), u.destroy();
    },
    dispatch(p) {
      u.dispatch(p);
    },
    batch: u.batch.bind(u),
    read(p) {
      return u.read(ue(p));
    },
    subscribe(p, E) {
      const v = [];
      for (const $ of p)
        if ($.endsWith(".*")) {
          const R = $.slice(0, -2),
            z = T.get(R);
          z && v.push(...z);
        } else v.push(ue($));
      return u.subscribe(v, E);
    },
    subscribeModule(p, E) {
      const v = T.get(p);
      return !v || v.length === 0 ? () => {} : u.subscribe(v, E);
    },
    watch(p, E, v) {
      return u.watch(ue(p), E, v);
    },
    when(p, E) {
      return u.when(() => p(j), E);
    },
    onSettledChange: u.onSettledChange.bind(u),
    onTimeTravelChange: u.onTimeTravelChange.bind(u),
    inspect: u.inspect.bind(u),
    settle: u.settle.bind(u),
    explain: u.explain.bind(u),
    getSnapshot: u.getSnapshot.bind(u),
    restore: u.restore.bind(u),
    getDistributableSnapshot(p) {
      const E = {
          ...p,
          includeDerivations: p?.includeDerivations?.map(ue),
          excludeDerivations: p?.excludeDerivations?.map(ue),
          includeFacts: p?.includeFacts?.map(ue),
        },
        v = u.getDistributableSnapshot(E),
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
    watchDistributableSnapshot(p, E) {
      const v = {
        ...p,
        includeDerivations: p?.includeDerivations?.map(ue),
        excludeDerivations: p?.excludeDerivations?.map(ue),
        includeFacts: p?.includeFacts?.map(ue),
      };
      return u.watchDistributableSnapshot(v, ($) => {
        const R = {};
        for (const [z, f] of Object.entries($.data)) {
          const b = z.indexOf(H);
          if (b > 0) {
            const w = z.slice(0, b),
              I = z.slice(b + H.length);
            R[w] || (R[w] = {}), (R[w][I] = f);
          } else R._root || (R._root = {}), (R._root[z] = f);
        }
        E({ ...$, data: R });
      });
    },
    registerModule(p, E) {
      if (a.has(p))
        throw new Error(
          `[Directive] Module namespace "${p}" already exists. Cannot register a duplicate namespace.`,
        );
      if (p.includes(H))
        throw new Error(
          `[Directive] Module name "${p}" contains the reserved separator "${H}".`,
        );
      if (re.has(p))
        throw new Error(
          `[Directive] Module name "${p}" is a blocked property.`,
        );
      for (const y of Object.keys(E.schema.facts))
        if (y.includes(H))
          throw new Error(
            `[Directive] Schema key "${y}" in module "${p}" contains the reserved separator "${H}".`,
          );
      const v = E,
        $ = v.crossModuleDeps && Object.keys(v.crossModuleDeps).length > 0,
        R = $ ? Object.keys(v.crossModuleDeps) : [],
        z = {};
      for (const [y, C] of Object.entries(v.schema.facts))
        z[`${p}${H}${y}`] = C;
      const f = v.init
          ? (y) => {
              const C = se(y, p);
              v.init(C);
            }
          : void 0,
        b = {};
      if (v.derive)
        for (const [y, C] of Object.entries(v.derive))
          b[`${p}${H}${y}`] = (t, r) => {
            const l = $ ? ae(t, p, R) : se(t, p),
              g = Be(r, p);
            return C(l, g);
          };
      const w = {};
      if (v.events)
        for (const [y, C] of Object.entries(v.events))
          w[`${p}${H}${y}`] = (t, r) => {
            const l = se(t, p);
            C(l, r);
          };
      const I = {};
      if (v.constraints)
        for (const [y, C] of Object.entries(v.constraints)) {
          const t = C;
          I[`${p}${H}${y}`] = {
            ...t,
            deps: t.deps?.map((r) => `${p}${H}${r}`),
            when: (r) => {
              const l = $ ? ae(r, p, R) : se(r, p);
              return t.when(l);
            },
            require:
              typeof t.require == "function"
                ? (r) => {
                    const l = $ ? ae(r, p, R) : se(r, p);
                    return t.require(l);
                  }
                : t.require,
          };
        }
      const N = {};
      if (v.resolvers)
        for (const [y, C] of Object.entries(v.resolvers)) {
          const t = C;
          N[`${p}${H}${y}`] = {
            ...t,
            resolve: async (r, l) => {
              const g = je(l.facts, n, O);
              await t.resolve(r, { facts: g[p], signal: l.signal });
            },
          };
        }
      const K = {};
      if (v.effects)
        for (const [y, C] of Object.entries(v.effects)) {
          const t = C;
          K[`${p}${H}${y}`] = {
            ...t,
            run: (r, l) => {
              const g = $ ? ae(r, p, R) : se(r, p),
                S = l ? ($ ? ae(l, p, R) : se(l, p)) : void 0;
              return t.run(g, S);
            },
            deps: t.deps?.map((r) => `${p}${H}${r}`),
          };
        }
      a.add(p), (n[p] = v), (D.names = null);
      const F = [];
      for (const y of Object.keys(v.schema.facts)) F.push(`${p}${H}${y}`);
      if (v.schema.derivations)
        for (const y of Object.keys(v.schema.derivations))
          F.push(`${p}${H}${y}`);
      T.set(p, F),
        u.registerModule({
          id: v.id,
          schema: z,
          requirements: v.schema.requirements ?? {},
          init: f,
          derive: Object.keys(b).length > 0 ? b : void 0,
          events: Object.keys(w).length > 0 ? w : void 0,
          effects: Object.keys(K).length > 0 ? K : void 0,
          constraints: Object.keys(I).length > 0 ? I : void 0,
          resolvers: Object.keys(N).length > 0 ? N : void 0,
          hooks: v.hooks,
          snapshotEvents:
            s && !s.has(p) ? [] : v.snapshotEvents?.map((y) => `${p}${H}${y}`),
        });
    },
  };
}
function ue(e) {
  if (e.includes(".")) {
    const [n, ...a] = e.split(".");
    return `${n}${H}${a.join(H)}`;
  }
  return e;
}
function se(e, n) {
  let a = Ue.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), Ue.set(e, a);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !re.has(o))
          return o === "$store" || o === "$snapshot" ? e[o] : e[`${n}${H}${o}`];
      },
      set(i, o, d) {
        return typeof o == "symbol" || re.has(o)
          ? !1
          : ((e[`${n}${H}${o}`] = d), !0);
      },
      has(i, o) {
        return typeof o == "symbol" || re.has(o) ? !1 : `${n}${H}${o}` in e;
      },
      deleteProperty(i, o) {
        return typeof o == "symbol" || re.has(o)
          ? !1
          : (delete e[`${n}${H}${o}`], !0);
      },
    },
  );
  return a.set(n, s), s;
}
function je(e, n, a) {
  const s = Ye.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !re.has(d) && Object.hasOwn(n, d))
          return se(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || re.has(d) ? !1 : Object.hasOwn(n, d);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(n, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Ye.set(e, i), i;
}
var Xe = new WeakMap();
function ae(e, n, a) {
  let s = `${n}:${JSON.stringify([...a].sort())}`,
    i = Xe.get(e);
  if (i) {
    const h = i.get(s);
    if (h) return h;
  } else (i = new Map()), Xe.set(e, i);
  const o = new Set(a),
    d = ["self", ...a],
    c = new Proxy(
      {},
      {
        get(h, m) {
          if (typeof m != "symbol" && !re.has(m)) {
            if (m === "self") return se(e, n);
            if (o.has(m)) return se(e, m);
          }
        },
        has(h, m) {
          return typeof m == "symbol" || re.has(m)
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
  return i.set(s, c), c;
}
function Be(e, n) {
  let a = Ge.get(e);
  if (a) {
    const i = a.get(n);
    if (i) return i;
  } else (a = new Map()), Ge.set(e, a);
  const s = new Proxy(
    {},
    {
      get(i, o) {
        if (typeof o != "symbol" && !re.has(o)) return e[`${n}${H}${o}`];
      },
      has(i, o) {
        return typeof o == "symbol" || re.has(o) ? !1 : `${n}${H}${o}` in e;
      },
    },
  );
  return a.set(n, s), s;
}
function Wt(e, n, a) {
  const s = Je.get(e);
  if (s) return s;
  const i = new Proxy(
    {},
    {
      get(o, d) {
        if (typeof d != "symbol" && !re.has(d) && Object.hasOwn(n, d))
          return Be(e, d);
      },
      has(o, d) {
        return typeof d == "symbol" || re.has(d) ? !1 : Object.hasOwn(n, d);
      },
      ownKeys() {
        return a();
      },
      getOwnPropertyDescriptor(o, d) {
        if (typeof d != "symbol" && Object.hasOwn(n, d))
          return { configurable: !0, enumerable: !0 };
      },
    },
  );
  return Je.set(e, i), i;
}
var Qe = new WeakMap();
function Kt(e, n, a) {
  let s = Qe.get(e);
  return (
    s || ((s = new Map()), Qe.set(e, s)),
    new Proxy(
      {},
      {
        get(i, o) {
          if (typeof o == "symbol" || re.has(o) || !Object.hasOwn(n, o)) return;
          const d = s.get(o);
          if (d) return d;
          const c = new Proxy(
            {},
            {
              get(h, m) {
                if (typeof m != "symbol" && !re.has(m))
                  return (u) => {
                    e.dispatch({ type: `${o}${H}${m}`, ...u });
                  };
              },
            },
          );
          return s.set(o, c), c;
        },
        has(i, o) {
          return typeof o == "symbol" || re.has(o) ? !1 : Object.hasOwn(n, o);
        },
        ownKeys() {
          return a();
        },
        getOwnPropertyDescriptor(i, o) {
          if (typeof o != "symbol" && Object.hasOwn(n, o))
            return { configurable: !0, enumerable: !0 };
        },
      },
    )
  );
}
function Ht(e) {
  const n = e.module;
  if (!n)
    throw new Error(
      "[Directive] createSystem requires a module. Got: " + typeof n,
    );
  if (e.tickMs !== void 0 && e.tickMs <= 0)
    throw new Error("[Directive] tickMs must be a positive number");
  if (e.initialFacts && !Se(e.initialFacts))
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
  o = ut({
    modules: [
      {
        id: n.id,
        schema: n.schema.facts,
        requirements: n.schema.requirements,
        init: n.init,
        derive: n.derive,
        events: n.events,
        effects: n.effects,
        constraints: n.constraints,
        resolvers: n.resolvers,
        hooks: n.hooks,
        snapshotEvents: n.snapshotEvents,
      },
    ],
    plugins: e.plugins,
    debug: a,
    errorBoundary: s,
    tickMs: e.tickMs,
    onAfterModuleInit: () => {
      if (e.initialFacts)
        for (const [m, u] of Object.entries(e.initialFacts))
          re.has(m) || (o.facts[m] = u);
      if (i) {
        for (const [m, u] of Object.entries(i)) re.has(m) || (o.facts[m] = u);
        i = null;
      }
    },
  });
  let d = new Proxy(
      {},
      {
        get(m, u) {
          if (typeof u != "symbol" && !re.has(u))
            return (x) => {
              o.dispatch({ type: u, ...x });
            };
        },
      },
    ),
    c = null,
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
      const u = await m();
      u && typeof u == "object" && (i = u);
    },
    initialize() {
      o.initialize();
    },
    start() {
      o.start(),
        h &&
          h > 0 &&
          n.events &&
          "tick" in n.events &&
          (c = setInterval(() => {
            o.dispatch({ type: "tick" });
          }, h));
    },
    stop() {
      c && (clearInterval(c), (c = null)), o.stop();
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
    watch(m, u, x) {
      return o.watch(m, u, x);
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
var ct = class {
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
function ze() {
  try {
    if (typeof process < "u") return !1;
  } catch {}
  try {
    if (typeof import.meta < "u") return !1;
  } catch {}
  return !0;
}
function dt(e) {
  try {
    if (e === void 0) return "undefined";
    if (e === null) return "null";
    if (typeof e == "bigint") return String(e) + "n";
    if (typeof e == "symbol") return String(e);
    if (typeof e == "object") {
      const n = JSON.stringify(e, (a, s) =>
        typeof s == "bigint"
          ? String(s) + "n"
          : typeof s == "symbol"
            ? String(s)
            : s,
      );
      return n.length > 120 ? n.slice(0, 117) + "..." : n;
    }
    return String(e);
  } catch {
    return "<error>";
  }
}
function he(e, n) {
  return e.length <= n ? e : e.slice(0, n - 3) + "...";
}
function $e(e) {
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
function Ut(e) {
  return e === void 0
    ? 1e3
    : !Number.isFinite(e) || e < 1
      ? (ze() &&
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
var Jt = 200,
  Ae = 340,
  ve = 16,
  be = 80,
  Ze = 2,
  et = ["#8b9aff", "#4ade80", "#fbbf24", "#c084fc", "#f472b6", "#22d3ee"];
function Gt() {
  return { entries: new ct(Jt), inflight: new Map() };
}
function Xt() {
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
  Zt = 100;
function er() {
  return { isRecording: !1, recordedEvents: [], snapshots: [] };
}
var tr = 50,
  tt = 200,
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
function rr(e, n, a, s) {
  let i = !1,
    o = {
      position: "fixed",
      zIndex: "99999",
      ...(n.includes("bottom") ? { bottom: "12px" } : { top: "12px" }),
      ...(n.includes("right") ? { right: "12px" } : { left: "12px" }),
    },
    d = document.createElement("style");
  (d.textContent = `[data-directive-devtools] summary:focus-visible{outline:2px solid ${q.accent};outline-offset:2px;border-radius:2px}[data-directive-devtools] button:focus-visible{outline:2px solid ${q.accent};outline-offset:2px}`),
    document.head.appendChild(d);
  const c = document.createElement("button");
  c.setAttribute("aria-label", "Open Directive DevTools"),
    c.setAttribute("aria-expanded", String(a)),
    (c.title = "Ctrl+Shift+D to toggle"),
    Object.assign(c.style, {
      ...o,
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
    (c.textContent = "Directive");
  const h = document.createElement("div");
  h.setAttribute("role", "region"),
    h.setAttribute("aria-label", "Directive DevTools"),
    h.setAttribute("data-directive-devtools", ""),
    (h.tabIndex = -1),
    Object.assign(h.style, {
      ...o,
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
  const u = document.createElement("strong");
  (u.style.color = q.accent),
    (u.textContent =
      e === "default" ? "Directive DevTools" : `DevTools (${e})`);
  const x = document.createElement("button");
  x.setAttribute("aria-label", "Close DevTools"),
    Object.assign(x.style, {
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
    (x.textContent = "×"),
    m.appendChild(u),
    m.appendChild(x),
    h.appendChild(m);
  const T = document.createElement("div");
  (T.style.marginBottom = "6px"), T.setAttribute("aria-live", "polite");
  const D = document.createElement("span");
  (D.style.color = q.green),
    (D.textContent = "Settled"),
    T.appendChild(D),
    h.appendChild(T);
  const O = document.createElement("div");
  Object.assign(O.style, {
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
    (j.textContent = "◀ Undo"),
    (j.disabled = !0);
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
    O.appendChild(j),
    O.appendChild(k),
    O.appendChild(A),
    h.appendChild(O);
  function L(V, Y) {
    const G = document.createElement("details");
    Y && (G.open = !0), (G.style.marginBottom = "4px");
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: q.accent,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(me),
      oe.appendChild(document.createTextNode(")")),
      (me.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("table");
    Object.assign(de.style, {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "11px",
    });
    const Fe = document.createElement("thead"),
      Pe = document.createElement("tr");
    for (const yt of ["Key", "Value"]) {
      const Ee = document.createElement("th");
      (Ee.scope = "col"),
        Object.assign(Ee.style, {
          textAlign: "left",
          padding: "2px 4px",
          color: q.accent,
        }),
        (Ee.textContent = yt),
        Pe.appendChild(Ee);
    }
    Fe.appendChild(Pe), de.appendChild(Fe);
    const Le = document.createElement("tbody");
    return (
      de.appendChild(Le),
      G.appendChild(de),
      { details: G, tbody: Le, countSpan: me }
    );
  }
  function _(V, Y) {
    const G = document.createElement("details");
    G.style.marginBottom = "4px";
    const oe = document.createElement("summary");
    Object.assign(oe.style, {
      cursor: "pointer",
      color: Y,
      marginBottom: "4px",
    });
    const me = document.createElement("span");
    (oe.textContent = `${V} (`),
      oe.appendChild(me),
      oe.appendChild(document.createTextNode(")")),
      (me.textContent = "0"),
      G.appendChild(oe);
    const de = document.createElement("ul");
    return (
      Object.assign(de.style, { margin: "0", paddingLeft: "16px" }),
      G.appendChild(de),
      { details: G, list: de, countSpan: me }
    );
  }
  const p = L("Facts", !0);
  h.appendChild(p.details);
  const E = L("Derivations", !1);
  h.appendChild(E.details);
  const v = _("Inflight", q.yellow);
  h.appendChild(v.details);
  const $ = _("Unmet", q.red);
  h.appendChild($.details);
  const R = document.createElement("details");
  R.style.marginBottom = "4px";
  const z = document.createElement("summary");
  Object.assign(z.style, {
    cursor: "pointer",
    color: q.accent,
    marginBottom: "4px",
  }),
    (z.textContent = "Performance"),
    R.appendChild(z);
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
  const N = document.createElement("details");
  N.style.marginBottom = "4px";
  const K = document.createElement("summary");
  Object.assign(K.style, {
    cursor: "pointer",
    color: q.accent,
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
  const y = document.createElementNS("http://www.w3.org/2000/svg", "text");
  y.setAttribute("x", String(Ae / 2)),
    y.setAttribute("y", "30"),
    y.setAttribute("text-anchor", "middle"),
    y.setAttribute("fill", q.muted),
    y.setAttribute("font-size", "10"),
    y.setAttribute("font-family", q.font),
    (y.textContent = "No resolver activity yet"),
    F.appendChild(y),
    N.appendChild(F),
    h.appendChild(N);
  let C, t, r, l;
  if (s) {
    const V = document.createElement("details");
    V.style.marginBottom = "4px";
    const Y = document.createElement("summary");
    Object.assign(Y.style, {
      cursor: "pointer",
      color: q.accent,
      marginBottom: "4px",
    }),
      (r = document.createElement("span")),
      (r.textContent = "0"),
      (Y.textContent = "Events ("),
      Y.appendChild(r),
      Y.appendChild(document.createTextNode(")")),
      V.appendChild(Y),
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
      V.appendChild(t),
      h.appendChild(V),
      (C = V),
      (l = document.createElement("div"));
  } else
    (C = document.createElement("details")),
      (t = document.createElement("div")),
      (r = document.createElement("span")),
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
  const M = document.createElement("button");
  Object.assign(M.style, {
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
    (M.textContent = "⤓ Export"),
    g.appendChild(S),
    g.appendChild(M),
    h.appendChild(g),
    h.addEventListener(
      "wheel",
      (V) => {
        const Y = h,
          G = Y.scrollTop === 0 && V.deltaY < 0,
          oe = Y.scrollTop + Y.clientHeight >= Y.scrollHeight && V.deltaY > 0;
        (G || oe) && V.preventDefault();
      },
      { passive: !1 },
    );
  let P = a,
    W = new Set();
  function B() {
    (P = !0),
      (h.style.display = "block"),
      (c.style.display = "none"),
      c.setAttribute("aria-expanded", "true"),
      x.focus();
  }
  function U() {
    (P = !1),
      (h.style.display = "none"),
      (c.style.display = "block"),
      c.setAttribute("aria-expanded", "false"),
      c.focus();
  }
  c.addEventListener("click", B), x.addEventListener("click", U);
  function J(V) {
    V.key === "Escape" && P && U();
  }
  h.addEventListener("keydown", J);
  function te(V) {
    V.key === "d" &&
      V.shiftKey &&
      (V.ctrlKey || V.metaKey) &&
      (V.preventDefault(), P ? U() : B());
  }
  document.addEventListener("keydown", te);
  function Z() {
    i || (document.body.appendChild(c), document.body.appendChild(h));
  }
  document.body
    ? Z()
    : document.addEventListener("DOMContentLoaded", Z, { once: !0 });
  function X() {
    (i = !0),
      c.removeEventListener("click", B),
      x.removeEventListener("click", U),
      h.removeEventListener("keydown", J),
      document.removeEventListener("keydown", te),
      document.removeEventListener("DOMContentLoaded", Z);
    for (const V of W) clearTimeout(V);
    W.clear(), c.remove(), h.remove(), d.remove();
  }
  return {
    refs: {
      container: h,
      toggleBtn: c,
      titleEl: u,
      statusEl: D,
      factsBody: p.tbody,
      factsCount: p.countSpan,
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
      timeTravelSection: O,
      timeTravelLabel: A,
      undoBtn: j,
      redoBtn: k,
      flowSection: b,
      flowSvg: I,
      timelineSection: N,
      timelineSvg: F,
      eventsSection: C,
      eventsList: t,
      eventsCount: r,
      traceHint: l,
      recordBtn: S,
      exportBtn: M,
    },
    destroy: X,
    isOpen: () => P,
    flashTimers: W,
  };
}
function Ce(e, n, a, s, i, o) {
  let d = dt(s),
    c = e.get(a);
  if (c) {
    const h = c.cells;
    if (h[1] && ((h[1].textContent = d), i && o)) {
      const m = h[1];
      m.style.background = "rgba(139, 154, 255, 0.25)";
      const u = setTimeout(() => {
        (m.style.background = ""), o.delete(u);
      }, 300);
      o.add(u);
    }
  } else {
    (c = document.createElement("tr")),
      (c.style.borderBottom = `1px solid ${q.rowBorder}`);
    const h = document.createElement("td");
    Object.assign(h.style, { padding: "2px 4px", color: q.muted }),
      (h.textContent = a);
    const m = document.createElement("td");
    (m.style.padding = "2px 4px"),
      (m.textContent = d),
      c.appendChild(h),
      c.appendChild(m),
      n.appendChild(c),
      e.set(a, c);
  }
}
function nr(e, n) {
  const a = e.get(n);
  a && (a.remove(), e.delete(n));
}
function De(e, n, a) {
  if (
    (e.inflightList.replaceChildren(),
    (e.inflightCount.textContent = String(n.length)),
    n.length > 0)
  )
    for (const s of n) {
      const i = document.createElement("li");
      (i.style.fontSize = "11px"),
        (i.textContent = `${s.resolverId} (${s.id})`),
        e.inflightList.appendChild(i);
    }
  else {
    const s = document.createElement("li");
    (s.style.fontSize = "10px"),
      (s.style.color = q.muted),
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
      (s.style.color = q.muted),
      (s.textContent = "None"),
      e.unmetList.appendChild(s);
  }
}
function Oe(e, n, a) {
  const s = n === 0 && a === 0;
  (e.statusEl.style.color = s ? q.green : q.yellow),
    (e.statusEl.textContent = s ? "Settled" : "Working..."),
    (e.toggleBtn.textContent = s ? "Directive" : "Directive..."),
    e.toggleBtn.setAttribute(
      "aria-label",
      `Open Directive DevTools${s ? "" : " (system working)"}`,
    );
}
function rt(e, n, a, s) {
  const i = Object.keys(a.derive);
  if (((e.derivCount.textContent = String(i.length)), i.length === 0)) {
    n.clear(), e.derivBody.replaceChildren();
    const d = document.createElement("tr"),
      c = document.createElement("td");
    (c.colSpan = 2),
      (c.style.color = q.muted),
      (c.style.fontSize = "10px"),
      (c.textContent = "No derivations defined"),
      d.appendChild(c),
      e.derivBody.appendChild(d);
    return;
  }
  const o = new Set(i);
  for (const [d, c] of n) o.has(d) || (c.remove(), n.delete(d));
  for (const d of i) {
    let c;
    try {
      c = dt(a.read(d));
    } catch {
      c = "<error>";
    }
    Ce(n, e.derivBody, d, c, !0, s);
  }
}
function ir(e, n, a, s) {
  const i = e.eventsList.querySelector(".dt-events-empty");
  i && i.remove();
  const o = document.createElement("div");
  Object.assign(o.style, {
    padding: "2px 4px",
    borderBottom: `1px solid ${q.rowBorder}`,
    fontFamily: "inherit",
  });
  let d = new Date(),
    c = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`,
    h;
  try {
    const T = JSON.stringify(a);
    h = he(T, 60);
  } catch {
    h = "{}";
  }
  const m = document.createElement("span");
  (m.style.color = q.closeBtn), (m.textContent = c);
  const u = document.createElement("span");
  (u.style.color = q.accent), (u.textContent = ` ${n} `);
  const x = document.createElement("span");
  for (
    x.style.color = q.muted,
      x.textContent = h,
      o.appendChild(m),
      o.appendChild(u),
      o.appendChild(x),
      e.eventsList.prepend(o);
    e.eventsList.childElementCount > tr;
  )
    e.eventsList.lastElementChild?.remove();
  e.eventsCount.textContent = String(s);
}
function sr(e, n) {
  e.perfBody.replaceChildren();
  const a =
      n.reconcileCount > 0
        ? (n.reconcileTotalMs / n.reconcileCount).toFixed(1)
        : "—",
    s = [
      `Reconciles: ${n.reconcileCount}  (avg ${a}ms)`,
      `Effects: ${n.effectRunCount} run, ${n.effectErrorCount} errors`,
    ];
  for (const i of s) {
    const o = document.createElement("div");
    (o.style.marginBottom = "2px"),
      (o.textContent = i),
      e.perfBody.appendChild(o);
  }
  if (n.resolverStats.size > 0) {
    const i = document.createElement("div");
    (i.style.marginTop = "4px"),
      (i.style.marginBottom = "2px"),
      (i.style.color = q.accent),
      (i.textContent = "Resolvers:"),
      e.perfBody.appendChild(i);
    const o = [...n.resolverStats.entries()].sort(
      (d, c) => c[1].totalMs - d[1].totalMs,
    );
    for (const [d, c] of o) {
      const h = c.count > 0 ? (c.totalMs / c.count).toFixed(1) : "0",
        m = document.createElement("div");
      (m.style.paddingLeft = "8px"),
        (m.textContent = `${d}: ${c.count}x, avg ${h}ms${c.errors > 0 ? `, ${c.errors} err` : ""}`),
        c.errors > 0 && (m.style.color = q.red),
        e.perfBody.appendChild(m);
    }
  }
}
function nt(e, n) {
  const a = n.debug;
  if (!a) {
    e.timeTravelSection.style.display = "none";
    return;
  }
  e.timeTravelSection.style.display = "flex";
  const s = a.currentIndex,
    i = a.snapshots.length;
  e.timeTravelLabel.textContent = i > 0 ? `${s + 1} / ${i}` : "0 snapshots";
  const o = s > 0,
    d = s < i - 1;
  (e.undoBtn.disabled = !o),
    (e.undoBtn.style.opacity = o ? "1" : "0.4"),
    (e.redoBtn.disabled = !d),
    (e.redoBtn.style.opacity = d ? "1" : "0.4");
}
function or(e, n) {
  e.undoBtn.addEventListener("click", () => {
    n.debug && n.debug.currentIndex > 0 && n.debug.goBack(1);
  }),
    e.redoBtn.addEventListener("click", () => {
      n.debug &&
        n.debug.currentIndex < n.debug.snapshots.length - 1 &&
        n.debug.goForward(1);
    });
}
var Me = new WeakMap();
function lr(e, n, a, s, i, o) {
  return [
    e.join(","),
    n.join(","),
    a.map((d) => `${d.id}:${d.active}`).join(","),
    [...s.entries()].map(([d, c]) => `${d}:${c.status}:${c.type}`).join(","),
    i.join(","),
    o.join(","),
  ].join("|");
}
function ar(e, n, a, s, i) {
  for (const o of a) {
    const d = e.nodes.get(`0:${o}`);
    if (!d) continue;
    const c = n.recentlyChangedFacts.has(o);
    d.rect.setAttribute("fill", c ? q.text + "33" : "none"),
      d.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
  for (const o of s) {
    const d = e.nodes.get(`1:${o}`);
    if (!d) continue;
    const c = n.recentlyComputedDerivations.has(o);
    d.rect.setAttribute("fill", c ? q.accent + "33" : "none"),
      d.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
  for (const o of i) {
    const d = e.nodes.get(`2:${o}`);
    if (!d) continue;
    const c = n.recentlyActiveConstraints.has(o),
      h = d.rect.getAttribute("stroke") ?? q.muted;
    d.rect.setAttribute("fill", c ? h + "33" : "none"),
      d.rect.setAttribute("stroke-width", c ? "2" : "1");
  }
}
function it(e, n, a) {
  const s = $e(n);
  if (!s) return;
  let i;
  try {
    i = Object.keys(n.facts.$store.toObject());
  } catch {
    i = [];
  }
  const o = Object.keys(n.derive),
    d = s.constraints,
    c = s.unmet,
    h = s.inflight,
    m = Object.keys(s.resolvers),
    u = new Map();
  for (const y of c)
    u.set(y.id, {
      type: y.requirement.type,
      fromConstraint: y.fromConstraint,
      status: "unmet",
    });
  for (const y of h)
    u.set(y.id, { type: y.resolverId, fromConstraint: "", status: "inflight" });
  if (i.length === 0 && o.length === 0 && d.length === 0 && m.length === 0) {
    Me.delete(e.flowSvg),
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
  const x = h.map((y) => y.resolverId).sort(),
    T = lr(i, o, d, u, m, x),
    D = Me.get(e.flowSvg);
  if (D && D.fingerprint === T) {
    ar(
      D,
      a,
      i,
      o,
      d.map((y) => y.id),
    );
    return;
  }
  const O = Q.nodeW + Q.colGap,
    j = [5, 5 + O, 5 + O * 2, 5 + O * 3, 5 + O * 4],
    k = j[4] + Q.nodeW + 5;
  function A(y) {
    let C = Q.startY + 12;
    return y.map((t) => {
      const r = { ...t, y: C };
      return (C += Q.nodeH + Q.nodeGap), r;
    });
  }
  const L = A(i.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    _ = A(o.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    p = A(
      d.map((y) => ({
        id: y.id,
        label: he(y.id, Q.labelMaxChars),
        active: y.active,
        priority: y.priority,
      })),
    ),
    E = A(
      [...u.entries()].map(([y, C]) => ({
        id: y,
        type: C.type,
        fromConstraint: C.fromConstraint,
        status: C.status,
      })),
    ),
    v = A(m.map((y) => ({ id: y, label: he(y, Q.labelMaxChars) }))),
    $ = Math.max(L.length, _.length, p.length, E.length, v.length, 1),
    R = Q.startY + 12 + $ * (Q.nodeH + Q.nodeGap) + 8;
  e.flowSvg.replaceChildren(),
    e.flowSvg.setAttribute("viewBox", `0 0 ${k} ${R}`),
    e.flowSvg.setAttribute(
      "aria-label",
      `Dependency graph: ${i.length} facts, ${o.length} derivations, ${d.length} constraints, ${u.size} requirements, ${m.length} resolvers`,
    );
  const z = ["Facts", "Derivations", "Constraints", "Reqs", "Resolvers"];
  for (const [y, C] of z.entries()) {
    const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
    t.setAttribute("x", String(j[y] ?? 0)),
      t.setAttribute("y", "10"),
      t.setAttribute("fill", q.accent),
      t.setAttribute("font-size", String(Q.fontSize)),
      t.setAttribute("font-family", q.font),
      (t.textContent = C),
      e.flowSvg.appendChild(t);
  }
  const f = { fingerprint: T, nodes: new Map() };
  function b(y, C, t, r, l, g, S, M) {
    const P = document.createElementNS("http://www.w3.org/2000/svg", "g"),
      W = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    W.setAttribute("x", String(C)),
      W.setAttribute("y", String(t - 6)),
      W.setAttribute("width", String(Q.nodeW)),
      W.setAttribute("height", String(Q.nodeH)),
      W.setAttribute("rx", "3"),
      W.setAttribute("fill", M ? g + "33" : "none"),
      W.setAttribute("stroke", g),
      W.setAttribute("stroke-width", M ? "2" : "1"),
      W.setAttribute("opacity", S ? "0.35" : "1"),
      P.appendChild(W);
    const B = document.createElementNS("http://www.w3.org/2000/svg", "text");
    return (
      B.setAttribute("x", String(C + 4)),
      B.setAttribute("y", String(t + 4)),
      B.setAttribute("fill", g),
      B.setAttribute("font-size", String(Q.fontSize)),
      B.setAttribute("font-family", q.font),
      B.setAttribute("opacity", S ? "0.35" : "1"),
      (B.textContent = l),
      P.appendChild(B),
      e.flowSvg.appendChild(P),
      f.nodes.set(`${y}:${r}`, { g: P, rect: W, text: B }),
      { midX: C + Q.nodeW / 2, midY: t }
    );
  }
  function w(y, C, t, r, l, g) {
    const S = document.createElementNS("http://www.w3.org/2000/svg", "line");
    S.setAttribute("x1", String(y)),
      S.setAttribute("y1", String(C)),
      S.setAttribute("x2", String(t)),
      S.setAttribute("y2", String(r)),
      S.setAttribute("stroke", l),
      S.setAttribute("stroke-width", "1"),
      S.setAttribute("stroke-dasharray", "3,2"),
      S.setAttribute("opacity", "0.7"),
      e.flowSvg.appendChild(S);
  }
  const I = new Map(),
    N = new Map(),
    K = new Map(),
    F = new Map();
  for (const y of L) {
    const C = a.recentlyChangedFacts.has(y.id),
      t = b(0, j[0], y.y, y.id, y.label, q.text, !1, C);
    I.set(y.id, t);
  }
  for (const y of _) {
    const C = a.recentlyComputedDerivations.has(y.id),
      t = b(1, j[1], y.y, y.id, y.label, q.accent, !1, C);
    N.set(y.id, t);
  }
  for (const y of p) {
    const C = a.recentlyActiveConstraints.has(y.id),
      t = b(
        2,
        j[2],
        y.y,
        y.id,
        y.label,
        y.active ? q.yellow : q.muted,
        !y.active,
        C,
      );
    K.set(y.id, t);
  }
  for (const y of E) {
    const C = y.status === "unmet" ? q.red : q.yellow,
      t = b(3, j[3], y.y, y.id, he(y.type, Q.labelMaxChars), C, !1, !1);
    F.set(y.id, t);
  }
  for (const y of v) {
    const C = h.some((t) => t.resolverId === y.id);
    b(4, j[4], y.y, y.id, y.label, C ? q.green : q.muted, !C, !1);
  }
  for (const y of _) {
    const C = a.derivationDeps.get(y.id),
      t = N.get(y.id);
    if (C && t)
      for (const r of C) {
        const l = I.get(r);
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
  for (const y of E) {
    const C = K.get(y.fromConstraint),
      t = F.get(y.id);
    C &&
      t &&
      w(C.midX + Q.nodeW / 2, C.midY, t.midX - Q.nodeW / 2, t.midY, q.muted);
  }
  for (const y of h) {
    const C = F.get(y.id);
    if (C) {
      const t = v.find((r) => r.id === y.resolverId);
      t && w(C.midX + Q.nodeW / 2, C.midY, j[4], t.y, q.green);
    }
  }
  Me.set(e.flowSvg, f);
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
function cr(e, n) {
  const a = n.entries.toArray();
  if (a.length === 0) return;
  e.timelineSvg.replaceChildren();
  let s = 1 / 0,
    i = -1 / 0;
  for (const D of a)
    D.startMs < s && (s = D.startMs), D.endMs > i && (i = D.endMs);
  const o = performance.now();
  for (const D of n.inflight.values()) D < s && (s = D), o > i && (i = o);
  const d = i - s || 1,
    c = Ae - be - 10,
    h = [],
    m = new Set();
  for (const D of a)
    m.has(D.resolver) || (m.add(D.resolver), h.push(D.resolver));
  for (const D of n.inflight.keys()) m.has(D) || (m.add(D), h.push(D));
  const u = h.slice(-12),
    x = ve * u.length + 20;
  e.timelineSvg.setAttribute("viewBox", `0 0 ${Ae} ${x}`),
    e.timelineSvg.setAttribute("height", String(Math.min(x, 200)));
  const T = 5;
  for (let D = 0; D <= T; D++) {
    const O = be + (c * D) / T,
      j = (d * D) / T,
      k = document.createElementNS("http://www.w3.org/2000/svg", "text");
    k.setAttribute("x", String(O)),
      k.setAttribute("y", "8"),
      k.setAttribute("fill", q.muted),
      k.setAttribute("font-size", "6"),
      k.setAttribute("font-family", q.font),
      k.setAttribute("text-anchor", "middle"),
      (k.textContent =
        j < 1e3 ? `${j.toFixed(0)}ms` : `${(j / 1e3).toFixed(1)}s`),
      e.timelineSvg.appendChild(k);
    const A = document.createElementNS("http://www.w3.org/2000/svg", "line");
    A.setAttribute("x1", String(O)),
      A.setAttribute("y1", "10"),
      A.setAttribute("x2", String(O)),
      A.setAttribute("y2", String(x)),
      A.setAttribute("stroke", q.border),
      A.setAttribute("stroke-width", "0.5"),
      e.timelineSvg.appendChild(A);
  }
  for (let D = 0; D < u.length; D++) {
    const O = u[D],
      j = 12 + D * ve,
      k = D % et.length,
      A = et[k],
      L = document.createElementNS("http://www.w3.org/2000/svg", "text");
    L.setAttribute("x", String(be - 4)),
      L.setAttribute("y", String(j + ve / 2 + 3)),
      L.setAttribute("fill", q.muted),
      L.setAttribute("font-size", "7"),
      L.setAttribute("font-family", q.font),
      L.setAttribute("text-anchor", "end"),
      (L.textContent = he(O, 12)),
      e.timelineSvg.appendChild(L);
    const _ = a.filter((E) => E.resolver === O);
    for (const E of _) {
      const v = be + ((E.startMs - s) / d) * c,
        $ = Math.max(((E.endMs - E.startMs) / d) * c, Ze),
        R = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      R.setAttribute("x", String(v)),
        R.setAttribute("y", String(j + 2)),
        R.setAttribute("width", String($)),
        R.setAttribute("height", String(ve - 4)),
        R.setAttribute("rx", "2"),
        R.setAttribute("fill", E.error ? q.red : A),
        R.setAttribute("opacity", "0.8");
      const z = document.createElementNS("http://www.w3.org/2000/svg", "title"),
        f = E.endMs - E.startMs;
      (z.textContent = `${O}: ${f.toFixed(1)}ms${E.error ? " (error)" : ""}`),
        R.appendChild(z),
        e.timelineSvg.appendChild(R);
    }
    const p = n.inflight.get(O);
    if (p !== void 0) {
      const E = be + ((p - s) / d) * c,
        v = Math.max(((o - p) / d) * c, Ze),
        $ = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      $.setAttribute("x", String(E)),
        $.setAttribute("y", String(j + 2)),
        $.setAttribute("width", String(v)),
        $.setAttribute("height", String(ve - 4)),
        $.setAttribute("rx", "2"),
        $.setAttribute("fill", A),
        $.setAttribute("opacity", "0.4"),
        $.setAttribute("stroke", A),
        $.setAttribute("stroke-width", "1"),
        $.setAttribute("stroke-dasharray", "3,2");
      const R = document.createElementNS("http://www.w3.org/2000/svg", "title");
      (R.textContent = `${O}: inflight ${(o - p).toFixed(0)}ms`),
        $.appendChild(R),
        e.timelineSvg.appendChild($);
    }
  }
  e.timelineSvg.setAttribute(
    "aria-label",
    `Timeline: ${a.length} resolver executions across ${u.length} resolvers`,
  );
}
function dr() {
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
      n = {
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
              d = setInterval(() => {
                const h = s ? e.get(s) : e.values().next().value;
                h && !o && ((o = !0), h.subscribers.add(a));
              }, 100),
              c = setTimeout(() => clearInterval(d), 1e4);
            return () => {
              clearInterval(d), clearTimeout(c);
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
            const d = o.maxEvents,
              c = i.events,
              h = c.length > d ? c.length - d : 0;
            o.events.clear();
            for (let m = h; m < c.length; m++) {
              const u = c[m];
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
        clearEvents(a) {
          const s = a ? e.get(a) : e.values().next().value;
          s && s.events.clear();
        },
      };
    return (
      Object.defineProperty(window, "__DIRECTIVE__", {
        value: n,
        writable: !1,
        configurable: ze(),
        enumerable: !0,
      }),
      n
    );
  }
  return window.__DIRECTIVE__;
}
function fr(e = {}) {
  const {
      name: n = "default",
      trace: a = !1,
      maxEvents: s,
      panel: i = !1,
      position: o = "bottom-right",
      defaultOpen: d = !1,
    } = e,
    c = Ut(s),
    h = dr(),
    m = {
      system: null,
      events: new ct(c),
      maxEvents: c,
      subscribers: new Set(),
    };
  h.systems.set(n, m);
  let u = (r, l) => {
      const g = { timestamp: Date.now(), type: r, data: l };
      a && m.events.push(g);
      for (const S of m.subscribers)
        try {
          S(g);
        } catch {}
    },
    x = null,
    T = new Map(),
    D = new Map(),
    O = Yt(),
    j = Xt(),
    k = er(),
    A = Gt(),
    L = i && typeof window < "u" && typeof document < "u" && ze(),
    _ = null,
    p = 0,
    E = 1,
    v = 2,
    $ = 4,
    R = 8,
    z = 16,
    f = 32,
    b = 64,
    w = 128,
    I = new Map(),
    N = new Set(),
    K = null;
  function F(r) {
    (p |= r),
      _ === null &&
        typeof requestAnimationFrame < "u" &&
        (_ = requestAnimationFrame(y));
  }
  function y() {
    if (((_ = null), !x || !m.system)) {
      p = 0;
      return;
    }
    const r = x.refs,
      l = m.system,
      g = p;
    if (((p = 0), g & E)) {
      for (const S of N) nr(T, S);
      N.clear();
      for (const [S, { value: M, flash: P }] of I)
        Ce(T, r.factsBody, S, M, P, x.flashTimers);
      I.clear(), (r.factsCount.textContent = String(T.size));
    }
    if ((g & v && rt(r, D, l, x.flashTimers), g & R))
      if (K) Oe(r, K.inflight.length, K.unmet.length);
      else {
        const S = $e(l);
        S && Oe(r, S.inflight.length, S.unmet.length);
      }
    if (g & $)
      if (K) De(r, K.inflight, K.unmet);
      else {
        const S = $e(l);
        S && De(r, S.inflight, S.unmet);
      }
    g & z && sr(r, O),
      g & f && it(r, l, j),
      g & b && nt(r, l),
      g & w && cr(r, A);
  }
  function C(r, l) {
    x && a && ir(x.refs, r, l, m.events.size);
  }
  function t(r, l) {
    k.isRecording &&
      k.recordedEvents.length < Qt &&
      k.recordedEvents.push({ timestamp: Date.now(), type: r, data: Vt(l) });
  }
  return {
    name: "devtools",
    onInit: (r) => {
      if (
        ((m.system = r),
        u("init", {}),
        typeof window < "u" &&
          console.log(
            `%c[Directive Devtools]%c System "${n}" initialized. Access via window.__DIRECTIVE__`,
            "color: #7c3aed; font-weight: bold",
            "color: inherit",
          ),
        L)
      ) {
        const l = m.system;
        x = rr(n, o, d, a);
        const g = x.refs;
        try {
          const M = l.facts.$store.toObject();
          for (const [P, W] of Object.entries(M)) Ce(T, g.factsBody, P, W, !1);
          g.factsCount.textContent = String(Object.keys(M).length);
        } catch {}
        rt(g, D, l);
        const S = $e(l);
        S &&
          (Oe(g, S.inflight.length, S.unmet.length),
          De(g, S.inflight, S.unmet)),
          nt(g, l),
          or(g, l),
          it(g, l, j),
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
            const M =
                k.recordedEvents.length > 0
                  ? k.recordedEvents
                  : m.events.toArray(),
              P = JSON.stringify(
                {
                  version: 1,
                  name: n,
                  exportedAt: Date.now(),
                  events: M,
                  snapshots: k.snapshots,
                },
                null,
                2,
              ),
              W = new Blob([P], { type: "application/json" }),
              B = URL.createObjectURL(W),
              U = document.createElement("a");
            (U.href = B),
              (U.download = `directive-session-${n}-${Date.now()}.json`),
              U.click(),
              URL.revokeObjectURL(B);
          });
      }
    },
    onStart: (r) => {
      u("start", {}), C("start", {}), t("start", {});
    },
    onStop: (r) => {
      u("stop", {}), C("stop", {}), t("stop", {});
    },
    onDestroy: (r) => {
      u("destroy", {}),
        h.systems.delete(n),
        _ !== null &&
          typeof cancelAnimationFrame < "u" &&
          (cancelAnimationFrame(_), (_ = null)),
        j.animationTimer && clearTimeout(j.animationTimer),
        x && (x.destroy(), (x = null), T.clear(), D.clear());
    },
    onFactSet: (r, l, g) => {
      u("fact.set", { key: r, value: l, prev: g }),
        t("fact.set", { key: r, value: l, prev: g }),
        j.recentlyChangedFacts.add(r),
        x &&
          m.system &&
          (I.set(r, { value: l, flash: !0 }),
          N.delete(r),
          F(E),
          C("fact.set", { key: r, value: l }));
    },
    onFactDelete: (r, l) => {
      u("fact.delete", { key: r, prev: l }),
        t("fact.delete", { key: r, prev: l }),
        x && (N.add(r), I.delete(r), F(E), C("fact.delete", { key: r }));
    },
    onFactsBatch: (r) => {
      if (
        (u("facts.batch", { changes: r }),
        t("facts.batch", { count: r.length }),
        x && m.system)
      ) {
        for (const l of r)
          l.type === "delete"
            ? (N.add(l.key), I.delete(l.key))
            : (j.recentlyChangedFacts.add(l.key),
              I.set(l.key, { value: l.value, flash: !0 }),
              N.delete(l.key));
        F(E), C("facts.batch", { count: r.length });
      }
    },
    onDerivationCompute: (r, l, g) => {
      u("derivation.compute", { id: r, value: l, deps: g }),
        t("derivation.compute", { id: r, deps: g }),
        j.derivationDeps.set(r, g),
        j.recentlyComputedDerivations.add(r),
        C("derivation.compute", { id: r, deps: g });
    },
    onDerivationInvalidate: (r) => {
      u("derivation.invalidate", { id: r }),
        C("derivation.invalidate", { id: r });
    },
    onReconcileStart: (r) => {
      u("reconcile.start", {}),
        (O.lastReconcileStartMs = performance.now()),
        C("reconcile.start", {}),
        t("reconcile.start", {});
    },
    onReconcileEnd: (r) => {
      if (
        (u("reconcile.end", r),
        t("reconcile.end", {
          unmet: r.unmet.length,
          inflight: r.inflight.length,
          completed: r.completed.length,
        }),
        O.lastReconcileStartMs > 0)
      ) {
        const l = performance.now() - O.lastReconcileStartMs;
        O.reconcileCount++,
          (O.reconcileTotalMs += l),
          (O.lastReconcileStartMs = 0);
      }
      if (k.isRecording && m.system && k.snapshots.length < Zt)
        try {
          k.snapshots.push({
            timestamp: Date.now(),
            facts: m.system.facts.$store.toObject(),
          });
        } catch {}
      x &&
        m.system &&
        ((K = r),
        ur(j),
        F(v | R | $ | z | f | b),
        C("reconcile.end", {
          unmet: r.unmet.length,
          inflight: r.inflight.length,
        }));
    },
    onConstraintEvaluate: (r, l) => {
      u("constraint.evaluate", { id: r, active: l }),
        t("constraint.evaluate", { id: r, active: l }),
        l
          ? (j.activeConstraints.add(r), j.recentlyActiveConstraints.add(r))
          : j.activeConstraints.delete(r),
        C("constraint.evaluate", { id: r, active: l });
    },
    onConstraintError: (r, l) => {
      u("constraint.error", { id: r, error: String(l) }),
        C("constraint.error", { id: r, error: String(l) });
    },
    onRequirementCreated: (r) => {
      u("requirement.created", { id: r.id, type: r.requirement.type }),
        t("requirement.created", { id: r.id, type: r.requirement.type }),
        C("requirement.created", { id: r.id, type: r.requirement.type });
    },
    onRequirementMet: (r, l) => {
      u("requirement.met", { id: r.id, byResolver: l }),
        t("requirement.met", { id: r.id, byResolver: l }),
        C("requirement.met", { id: r.id, byResolver: l });
    },
    onRequirementCanceled: (r) => {
      u("requirement.canceled", { id: r.id }),
        t("requirement.canceled", { id: r.id }),
        C("requirement.canceled", { id: r.id });
    },
    onResolverStart: (r, l) => {
      u("resolver.start", { resolver: r, requirementId: l.id }),
        t("resolver.start", { resolver: r, requirementId: l.id }),
        A.inflight.set(r, performance.now()),
        x &&
          m.system &&
          (F($ | R | w),
          C("resolver.start", { resolver: r, requirementId: l.id }));
    },
    onResolverComplete: (r, l, g) => {
      u("resolver.complete", { resolver: r, requirementId: l.id, duration: g }),
        t("resolver.complete", {
          resolver: r,
          requirementId: l.id,
          duration: g,
        });
      const S = O.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if (
        (S.count++,
        (S.totalMs += g),
        O.resolverStats.set(r, S),
        O.resolverStats.size > tt)
      ) {
        const P = O.resolverStats.keys().next().value;
        P !== void 0 && O.resolverStats.delete(P);
      }
      const M = A.inflight.get(r);
      A.inflight.delete(r),
        M !== void 0 &&
          A.entries.push({
            resolver: r,
            startMs: M,
            endMs: performance.now(),
            error: !1,
          }),
        x &&
          m.system &&
          (F($ | R | z | w),
          C("resolver.complete", { resolver: r, duration: g }));
    },
    onResolverError: (r, l, g) => {
      u("resolver.error", {
        resolver: r,
        requirementId: l.id,
        error: String(g),
      }),
        t("resolver.error", {
          resolver: r,
          requirementId: l.id,
          error: String(g),
        });
      const S = O.resolverStats.get(r) ?? { count: 0, totalMs: 0, errors: 0 };
      if ((S.errors++, O.resolverStats.set(r, S), O.resolverStats.size > tt)) {
        const P = O.resolverStats.keys().next().value;
        P !== void 0 && O.resolverStats.delete(P);
      }
      const M = A.inflight.get(r);
      A.inflight.delete(r),
        M !== void 0 &&
          A.entries.push({
            resolver: r,
            startMs: M,
            endMs: performance.now(),
            error: !0,
          }),
        x &&
          m.system &&
          (F($ | R | z | w),
          C("resolver.error", { resolver: r, error: String(g) }));
    },
    onResolverRetry: (r, l, g) => {
      u("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        t("resolver.retry", { resolver: r, requirementId: l.id, attempt: g }),
        C("resolver.retry", { resolver: r, attempt: g });
    },
    onResolverCancel: (r, l) => {
      u("resolver.cancel", { resolver: r, requirementId: l.id }),
        t("resolver.cancel", { resolver: r, requirementId: l.id }),
        A.inflight.delete(r),
        C("resolver.cancel", { resolver: r });
    },
    onEffectRun: (r) => {
      u("effect.run", { id: r }),
        t("effect.run", { id: r }),
        O.effectRunCount++,
        C("effect.run", { id: r });
    },
    onEffectError: (r, l) => {
      u("effect.error", { id: r, error: String(l) }),
        O.effectErrorCount++,
        C("effect.error", { id: r, error: String(l) });
    },
    onSnapshot: (r) => {
      u("timetravel.snapshot", { id: r.id, trigger: r.trigger }),
        x && m.system && F(b),
        C("timetravel.snapshot", { id: r.id, trigger: r.trigger });
    },
    onTimeTravel: (r, l) => {
      if (
        (u("timetravel.jump", { from: r, to: l }),
        t("timetravel.jump", { from: r, to: l }),
        x && m.system)
      ) {
        const g = m.system;
        try {
          const S = g.facts.$store.toObject();
          T.clear(), x.refs.factsBody.replaceChildren();
          for (const [M, P] of Object.entries(S))
            Ce(T, x.refs.factsBody, M, P, !1);
          x.refs.factsCount.textContent = String(Object.keys(S).length);
        } catch {}
        D.clear(),
          j.derivationDeps.clear(),
          x.refs.derivBody.replaceChildren(),
          (K = null),
          F(v | R | $ | f | b),
          C("timetravel.jump", { from: r, to: l });
      }
    },
    onError: (r) => {
      u("error", {
        source: r.source,
        sourceId: r.sourceId,
        message: r.message,
      }),
        t("error", { source: r.source, message: r.message }),
        C("error", { source: r.source, message: r.message });
    },
    onErrorRecovery: (r, l) => {
      u("error.recovery", {
        source: r.source,
        sourceId: r.sourceId,
        strategy: l,
      }),
        C("error.recovery", { source: r.source, strategy: l });
    },
  };
}
const st = /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  mr = 1e4,
  Te = [];
function ce(e, n, a) {
  Te.unshift({ time: Date.now(), event: e, detail: n, type: a });
}
function pe(e) {
  console.log(`[contact-form] ${e}`),
    e.startsWith("Sending:")
      ? ce("submit", e.replace("Sending: ", ""), "submit")
      : e.includes("succeeded")
        ? ce("success", e, "submit")
        : e.includes("failed")
          ? ce("error", e, "error")
          : e.startsWith("Status:")
            ? ce("status", e.replace("Status: ", ""), "field")
            : e.includes("Auto-resetting")
              ? ce("auto-reset", e, "reset")
              : e === "Form reset"
                ? ce("reset", "Form cleared", "reset")
                : e.includes("ready") && ce("init", e, "field");
}
const pr = {
    facts: {
      name: ne.string(),
      email: ne.string(),
      subject: ne.string(),
      message: ne.string(),
      touched: ne.object(),
      status: ne.string(),
      errorMessage: ne.string(),
      lastSubmittedAt: ne.number(),
      submissionCount: ne.number(),
    },
    derivations: {
      nameError: ne.string(),
      emailError: ne.string(),
      subjectError: ne.string(),
      messageError: ne.string(),
      isValid: ne.boolean(),
      canSubmit: ne.boolean(),
      messageCharCount: ne.number(),
    },
    events: {
      updateField: { field: ne.string(), value: ne.string() },
      touchField: { field: ne.string() },
      submit: {},
      reset: {},
    },
    requirements: { SEND_MESSAGE: {}, RESET_AFTER_DELAY: {} },
  },
  hr = Ct("contact-form", {
    schema: pr,
    init: (e) => {
      (e.name = ""),
        (e.email = ""),
        (e.subject = ""),
        (e.message = ""),
        (e.touched = {}),
        (e.status = "idle"),
        (e.errorMessage = ""),
        (e.lastSubmittedAt = 0),
        (e.submissionCount = 0);
    },
    derive: {
      nameError: (e) =>
        e.touched.name
          ? e.name.trim()
            ? e.name.trim().length < 2
              ? "Name must be at least 2 characters"
              : ""
            : "Name is required"
          : "",
      emailError: (e) =>
        e.touched.email
          ? e.email.trim()
            ? st.test(e.email)
              ? ""
              : "Enter a valid email address"
            : "Email is required"
          : "",
      subjectError: (e) =>
        e.touched.subject ? (e.subject ? "" : "Please select a subject") : "",
      messageError: (e) =>
        e.touched.message
          ? e.message.trim()
            ? e.message.trim().length < 10
              ? "Message must be at least 10 characters"
              : ""
            : "Message is required"
          : "",
      isValid: (e) =>
        e.name.trim().length >= 2 &&
        st.test(e.email) &&
        e.subject !== "" &&
        e.message.trim().length >= 10,
      canSubmit: (e, n) =>
        !(
          !n.isValid ||
          e.status !== "idle" ||
          (e.lastSubmittedAt > 0 && Date.now() - e.lastSubmittedAt < mr)
        ),
      messageCharCount: (e) => e.message.length,
    },
    events: {
      updateField: (e, { field: n, value: a }) => {
        const s = n;
        s in e && typeof e[s] == "string" && (e[s] = a);
      },
      touchField: (e, { field: n }) => {
        e.touched = { ...e.touched, [n]: !0 };
      },
      submit: (e) => {
        (e.touched = { name: !0, email: !0, subject: !0, message: !0 }),
          (e.status = "submitting");
      },
      reset: (e) => {
        (e.name = ""),
          (e.email = ""),
          (e.subject = ""),
          (e.message = ""),
          (e.touched = {}),
          (e.status = "idle"),
          (e.errorMessage = "");
      },
    },
    constraints: {
      submitForm: {
        when: (e) => e.status === "submitting",
        require: { type: "SEND_MESSAGE" },
      },
      resetAfterSuccess: {
        when: (e) => e.status === "success",
        require: { type: "RESET_AFTER_DELAY" },
      },
    },
    resolvers: {
      sendMessage: {
        requirement: "SEND_MESSAGE",
        resolve: async (e, n) => {
          if (
            (pe(
              `Sending: ${n.facts.name} <${n.facts.email}> [${n.facts.subject}]`,
            ),
            await new Promise((a) => setTimeout(a, 1500)),
            Math.random() < 0.2)
          ) {
            (n.facts.status = "error"),
              (n.facts.errorMessage =
                "Simulated error — try again (20% failure rate for demo)."),
              pe("Submission failed (simulated)");
            return;
          }
          (n.facts.status = "success"),
            (n.facts.lastSubmittedAt = Date.now()),
            n.facts.submissionCount++,
            pe(`Submission #${n.facts.submissionCount} succeeded`);
        },
      },
      resetAfterDelay: {
        requirement: "RESET_AFTER_DELAY",
        resolve: async (e, n) => {
          pe("Auto-resetting in 3 seconds..."),
            await new Promise((a) => setTimeout(a, 3e3)),
            (n.facts.name = ""),
            (n.facts.email = ""),
            (n.facts.subject = ""),
            (n.facts.message = ""),
            (n.facts.touched = {}),
            (n.facts.status = "idle"),
            (n.facts.errorMessage = ""),
            pe("Form reset");
        },
      },
    },
    effects: {
      logSubmission: {
        deps: ["status", "submissionCount"],
        run: (e, n) => {
          n && e.status !== n.status && pe(`Status: ${n.status} → ${e.status}`);
        },
      },
    },
  }),
  ie = Lt({ module: hr, plugins: [fr({ name: "contact-form" })] });
ie.start();
const ft = document.getElementById("name"),
  mt = document.getElementById("email"),
  pt = document.getElementById("subject"),
  ht = document.getElementById("message"),
  ye = document.getElementById("submit-btn"),
  gr = document.getElementById("clear-btn"),
  fe = document.getElementById("status-banner"),
  yr = document.getElementById("name-error"),
  vr = document.getElementById("email-error"),
  br = document.getElementById("subject-error"),
  wr = document.getElementById("message-error"),
  Sr = document.getElementById("char-count"),
  Ie = document.getElementById("cf-timeline");
for (const [e, n] of [
  [ft, "name"],
  [mt, "email"],
  [pt, "subject"],
  [ht, "message"],
])
  e.addEventListener("input", () => {
    ie.events.updateField({ field: n, value: e.value }),
      ce("field", `${n} updated`, "field");
  }),
    e.addEventListener("blur", () => {
      ie.events.touchField({ field: n });
    });
ye.addEventListener("click", () => {
  ie.events.submit({});
});
gr.addEventListener("click", () => {
  ie.events.reset({}), ce("clear", "Form cleared", "reset");
});
function ot(e) {
  const n = document.createElement("div");
  return (n.textContent = e), n.innerHTML;
}
function gt() {
  (ft.value = ie.facts.name),
    (mt.value = ie.facts.email),
    (pt.value = ie.facts.subject),
    (ht.value = ie.facts.message);
  const e = ie.read("nameError"),
    n = ie.read("emailError"),
    a = ie.read("subjectError"),
    s = ie.read("messageError"),
    i = ie.read("messageCharCount"),
    o = ie.read("canSubmit");
  ie.read("isValid"),
    (yr.textContent = e),
    (vr.textContent = n),
    (br.textContent = a),
    (wr.textContent = s),
    (Sr.textContent = `${i} / 10 min`),
    (ye.disabled = !o);
  const d = ie.facts.status;
  if (
    (d === "submitting"
      ? ((ye.textContent = "Sending..."),
        (fe.className = "cf-status-banner visible submitting"),
        (fe.textContent = "Submitting your message..."))
      : d === "success"
        ? ((ye.textContent = "Send Message"),
          (fe.className = "cf-status-banner visible success"),
          (fe.textContent = "Message sent! Form will reset shortly."))
        : d === "error"
          ? ((ye.textContent = "Send Message"),
            (fe.className = "cf-status-banner visible error"),
            (fe.textContent = ie.facts.errorMessage))
          : ((ye.textContent = "Send Message"),
            (fe.className = "cf-status-banner"),
            (fe.textContent = "")),
    Te.length === 0)
  )
    Ie.innerHTML =
      '<div class="cf-timeline-empty">Events appear after interactions</div>';
  else {
    Ie.innerHTML = "";
    for (const c of Te) {
      const h = document.createElement("div");
      h.className = `cf-timeline-entry ${c.type}`;
      const u = new Date(c.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      (h.innerHTML = `
        <span class="cf-timeline-time">${u}</span>
        <span class="cf-timeline-event">${ot(c.event)}</span>
        <span class="cf-timeline-detail">${ot(c.detail)}</span>
      `),
        Ie.appendChild(h);
    }
  }
}
ie.subscribe(
  [
    "name",
    "email",
    "subject",
    "message",
    "touched",
    "status",
    "errorMessage",
    "lastSubmittedAt",
    "submissionCount",
    "nameError",
    "emailError",
    "subjectError",
    "messageError",
    "isValid",
    "canSubmit",
    "messageCharCount",
  ],
  gt,
);
gt();
pe("Contact form ready. Fill in all fields and submit.");
document.body.setAttribute("data-contact-form-ready", "true");
