/**
 * Public types for the 1.35 API surface core-next implements so far.
 *
 * Written for core-next, not copied: they keep the 1.35 shapes a consumer
 * names (schemas, facts, modules, systems, plugins) without the parts later
 * layers add.
 */

/** Optional metadata on any definition (labels, tags) for tooling. */
export interface DefinitionMeta {
  label?: string;
  description?: string;
  category?: string;
  color?: string;
  tags?: string[];
  tagBoundary?: boolean;
  [key: string]: unknown;
}

export interface SchemaType<T> {
  readonly _type: T;
  readonly _validators: Array<(value: any) => boolean>;
  validate(fn: (value: T) => boolean): SchemaType<T>;
}

/** Schema builders (`{ n: t.number() }`) or a type assertion (`{} as { n: number }`). */
export type Schema = Record<string, SchemaType<unknown> | unknown>;

export type InferSchemaType<T> = T extends SchemaType<infer U>
  ? U
  : T extends { _output: infer Z }
    ? Z
    : T;

export type InferSchema<S> = {
  -readonly [K in keyof S]: InferSchemaType<S[K]>;
};

export type FactOrigin = "authored" | "restore" | (string & {});

export interface FactChange {
  key: string;
  value: unknown;
  prev: unknown;
  type: "set" | "delete";
  origin: FactOrigin;
}

export interface FactsSnapshot<S extends Schema = Schema> {
  get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined;
  has(key: keyof InferSchema<S>): boolean;
}

export interface FactsStore<S extends Schema = Schema> {
  get<K extends keyof InferSchema<S>>(key: K): InferSchema<S>[K] | undefined;
  has(key: keyof InferSchema<S>): boolean;
  set<K extends keyof InferSchema<S>>(key: K, value: InferSchema<S>[K]): void;
  delete(key: keyof InferSchema<S>): void;
  batch(fn: () => void): void;
  subscribe(
    keys: Array<keyof InferSchema<S>>,
    listener: () => void,
  ): () => void;
  subscribeAll(listener: () => void): () => void;
  toObject(): Record<string, unknown>;
}

export type Facts<S extends Schema = Schema> = InferSchema<S> & {
  readonly $store: FactsStore<S>;
  readonly $snapshot: () => FactsSnapshot<S>;
};

/** A module's schema: facts, and optionally derivations, events, requirements. */
export interface ModuleSchema {
  facts: Schema;
  derivations?: Schema;
  events?: Record<string, unknown>;
  requirements?: Record<string, unknown>;
}

type FactsOf<M extends ModuleSchema> = InferSchema<M["facts"]>;
type DerivedOf<M extends ModuleSchema> = M["derivations"] extends Schema
  ? InferSchema<M["derivations"]>
  : Record<string, unknown>;
type EventsOf<M extends ModuleSchema> = M["events"] extends Record<
  string,
  unknown
>
  ? M["events"]
  : Record<never, never>;
export type EventPayload<P> = keyof P extends never
  ? Record<string, never>
  : InferSchema<P>;

export type ModuleFacts<M extends ModuleSchema> = FactsOf<M> & {
  readonly $store: FactsStore<M["facts"]>;
  readonly $snapshot: () => FactsSnapshot<M["facts"]>;
};

export interface EffectDef<M extends ModuleSchema = ModuleSchema> {
  run(
    facts: Readonly<FactsOf<M>>,
    prev: Readonly<FactsOf<M>> | null,
    derived: Readonly<DerivedOf<M>>,
  ): void | (() => void) | Promise<void | (() => void)>;
  deps?: Array<keyof FactsOf<M> & string>;
  meta?: DefinitionMeta;
  [key: string]: unknown;
}

export interface ModuleDef<M extends ModuleSchema> {
  schema: M;
  init?: (facts: ModuleFacts<M>) => void;
  derive?: {
    [K in keyof DerivedOf<M>]:
      | ((
          facts: Readonly<FactsOf<M>>,
          derived: Readonly<DerivedOf<M>>,
        ) => DerivedOf<M>[K])
      | {
          compute: (
            facts: Readonly<FactsOf<M>>,
            derived: Readonly<DerivedOf<M>>,
          ) => DerivedOf<M>[K];
          meta?: DefinitionMeta;
        };
  };
  events?: {
    [K in keyof EventsOf<M>]?:
      | ((facts: ModuleFacts<M>, payload: EventPayload<EventsOf<M>[K]>) => void)
      | {
          handler: (
            facts: ModuleFacts<M>,
            payload: EventPayload<EventsOf<M>[K]>,
          ) => void;
          meta?: DefinitionMeta;
        };
  };
  effects?: Record<string, EffectDef<M>>;
  meta?: DefinitionMeta;
  [key: string]: unknown;
}

export interface ModuleDefinition<M extends ModuleSchema = ModuleSchema> {
  readonly id: string;
  readonly schema: M;
  readonly init?: (facts: any) => void;
  readonly derive?: Record<string, unknown>;
  readonly events?: Record<string, unknown>;
  readonly effects?: Record<string, unknown>;
  readonly crossModuleDeps?: Record<string, unknown>;
  readonly meta?: DefinitionMeta;
  readonly [key: string]: unknown;
}

export interface SystemEvent {
  type: string;
  [key: string]: unknown;
}

/** A plugin: any of the 1.35 hooks, by name. */
export interface Plugin {
  name: string;
  [hook: string]: unknown;
}

export interface SystemOptions<M extends ModuleSchema> {
  /** One module, accessed flat (`system.facts.count`). */
  module?: ModuleDefinition<M>;
  /** Several modules, accessed by namespace (`system.facts.auth.token`). */
  modules?: Record<string, ModuleDefinition<any>>;
  /** Module init order: by crossModuleDeps (default), declaration, or explicit. */
  initOrder?: "auto" | "declaration" | string[];
  plugins?: Plugin[];
  [key: string]: unknown;
}

export interface System<M extends ModuleSchema = ModuleSchema> {
  readonly facts: ModuleFacts<M>;
  readonly derive: Readonly<DerivedOf<M>>;
  readonly events: {
    [K in keyof EventsOf<M>]: (payload?: EventPayload<EventsOf<M>[K]>) => void;
  };
  readonly isRunning: boolean;
  readonly isSettled: boolean;
  readonly isInitialized: boolean;
  start(): void;
  stop(): void;
  destroy(): void;
  initialize(): void;
  dispatch(event: SystemEvent): void;
  batch(fn: () => void): void;
  read<T = unknown>(id: string): T;
  subscribe(ids: string[], listener: () => void): () => void;
  watch<T = unknown>(
    id: string,
    callback: (next: T, prev: T | undefined) => void,
    options?: { equalityFn?: (a: T, b: T | undefined) => boolean },
  ): () => void;
  when(
    predicate: (facts: Record<string, unknown>) => boolean,
    options?: { timeout?: number },
  ): Promise<void>;
  settle(maxWait?: number): Promise<void>;
  observe(observer: (event: ObservationEvent) => void): () => void;
  inspect(): Record<string, unknown>;
  getSnapshot(): { facts: Record<string, unknown>; version: number };
  [key: string]: unknown;
}

export interface ObservationEvent {
  type: string;
  [key: string]: unknown;
}

/** The facts a system exposes, from a module schema or a raw `{ facts }` schema. */
export type SystemFacts<M extends { facts: Schema }> = InferSchema<M["facts"]>;
export type SystemDerived<M extends { facts: Schema; derivations?: Schema }> =
  M["derivations"] extends Schema
    ? InferSchema<M["derivations"]>
    : Record<string, never>;
