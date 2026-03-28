/**
 * createGraphQLQuery – Typed GraphQL query integration.
 *
 * Works with graphql-codegen's TypedDocumentNode for full end-to-end type safety.
 * Also supports raw query strings for simpler setups.
 *
 * @module
 */

import { createQuery } from "./create-query.js";
import type { QueryDefinition, QueryOptions } from "./types.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal TypedDocumentNode interface – compatible with @graphql-typed-document-node/core
 * without requiring the dependency.
 */
export interface TypedDocumentNode<
  TResult = Record<string, unknown>,
  TVariables = Record<string, unknown>,
> {
  /** Runtime: standard GraphQL DocumentNode shape */
  readonly kind: "Document";
  readonly definitions: readonly unknown[];
  /** Type brand – carries TResult and TVariables through the type system */
  __apiType?: (variables: TVariables) => TResult;
}

/** Extract the result type from a TypedDocumentNode. */
export type ResultOf<T> = T extends TypedDocumentNode<infer R, unknown>
  ? R
  : never;

/** Extract the variables type from a TypedDocumentNode. */
export type VariablesOf<T> = T extends TypedDocumentNode<unknown, infer V>
  ? V
  : never;

/**
 * Options for a GraphQL query.
 *
 * @typeParam TResult - The query result type (inferred from document)
 * @typeParam TVariables - The query variables type (inferred from document)
 * @typeParam TData - The transformed data type (defaults to TResult)
 * @typeParam TError - The error type
 */
export interface GraphQLQueryOptions<
  TResult,
  TVariables extends Record<string, unknown>,
  TData = TResult,
  TError = Error,
> {
  /** Unique query name. Becomes the derivation key. */
  name: string;

  /**
   * The GraphQL document – either a TypedDocumentNode (from codegen)
   * or a raw query string.
   */
  document: TypedDocumentNode<TResult, TVariables> | string;

  /**
   * Derive variables from facts. Return `null` to disable the query.
   * Variables are fully typed from the document.
   */
  variables: (facts: Record<string, unknown>) => TVariables | null;

  /** GraphQL endpoint URL. @default "/graphql" */
  endpoint?: string;

  /** Additional headers for the GraphQL request. */
  headers?: Record<string, string> | (() => Record<string, string>);

  /** Transform the raw GraphQL result before caching. */
  transform?: (result: TResult) => TData;

  /**
   * Extract the data from the GraphQL response envelope.
   * Defaults to `(res) => res.data` which handles standard `{ data, errors }` responses.
   */
  extractData?: (response: {
    data?: TResult;
    errors?: GraphQLError[];
  }) => TResult;

  /** Handle GraphQL errors (errors array in response). */
  onGraphQLError?: (errors: GraphQLError[]) => void;

  // Pass-through to createQuery
  refetchAfter?: number;
  retry?: QueryOptions<
    TData,
    TResult,
    TError,
    TVariables & Record<string, unknown>
  >["retry"];
  enabled?: (facts: Record<string, unknown>) => boolean;
  dependsOn?: string[];
  tags?: string[];
  keepPreviousData?: boolean;
  placeholderData?: TData | ((prev?: TData) => TData | undefined);
  initialData?: TData;
  initialDataUpdatedAt?: number;
  structuralSharing?: boolean;
  refetchOnWindowFocus?: boolean | "always";
  refetchOnReconnect?: boolean | "always";
  refetchInterval?:
    | number
    | false
    | ((data: TData | undefined) => number | false);
  onSuccess?: (data: TData) => void;
  onError?: (error: TError) => void;
  onSettled?: (data: TData | undefined, error: TError | null) => void;
  suspense?: boolean;
  throwOnError?: boolean;
}

/** Standard GraphQL error shape. */
export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

/** Options for the shared GraphQL client. */
export interface GraphQLClientOptions {
  /** GraphQL endpoint URL. @default "/graphql" */
  endpoint?: string;
  /** Default headers for all requests. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Custom fetch implementation. */
  fetch?: typeof globalThis.fetch;
}

// ============================================================================
// createGraphQLQuery
// ============================================================================

/**
 * Create a typed GraphQL query.
 *
 * Works with graphql-codegen's TypedDocumentNode for full type safety,
 * or with raw query strings for simpler setups.
 *
 * @example
 * ```typescript
 * // With TypedDocumentNode (from graphql-codegen)
 * import { GetUserDocument } from "./generated";
 *
 * const user = createGraphQLQuery({
 *   name: "user",
 *   document: GetUserDocument,
 *   variables: (facts) => facts.userId ? { id: facts.userId } : null,
 * });
 *
 * // With raw query string
 * const user = createGraphQLQuery({
 *   name: "user",
 *   document: `query GetUser($id: ID!) { user(id: $id) { id name email } }`,
 *   variables: (facts) => facts.userId ? { id: facts.userId } : null,
 *   endpoint: "/graphql",
 * });
 * ```
 */
export function createGraphQLQuery<
  TResult,
  TVariables extends Record<string, unknown>,
  TData = TResult,
  TError = Error,
>(
  options: GraphQLQueryOptions<TResult, TVariables, TData, TError>,
): QueryDefinition<TData> {
  const {
    name,
    document,
    variables: variablesFn,
    endpoint = "/graphql",
    headers: headersFn,
    transform,
    extractData,
    onGraphQLError,
    // Pass-through options
    ...queryOptions
  } = options;

  // Get the query string from the document
  const queryString =
    typeof document === "string"
      ? document
      : printDocument(
          document as TypedDocumentNode<
            Record<string, unknown>,
            Record<string, unknown>
          >,
        );

  // biome-ignore lint/suspicious/noExplicitAny: Generic constraints require widening at the boundary
  return createQuery<TData, TResult, TError, any>({
    name,

    key: (facts) => {
      const vars = variablesFn(facts);
      if (vars === null) {
        return null;
      }

      return vars as TVariables & Record<string, unknown>;
    },

    fetcher: async (
      params: TVariables & Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<TResult> => {
      // Build headers
      const resolvedHeaders: Record<string, string> =
        typeof headersFn === "function" ? headersFn() : (headersFn ?? {});

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...resolvedHeaders,
        },
        body: JSON.stringify({
          query: queryString,
          variables: params,
        }),
        signal,
      });

      if (!res.ok) {
        throw new Error(
          `[Directive] GraphQL request failed with status ${res.status}`,
        );
      }

      const json = (await res.json()) as {
        data?: TResult;
        errors?: GraphQLError[];
      };

      // Handle GraphQL errors
      if (json.errors && json.errors.length > 0) {
        onGraphQLError?.(json.errors);

        if (!json.data) {
          throw new Error(
            `[Directive] GraphQL error: ${json.errors[0]!.message}`,
          );
        }
      }

      // Extract data from envelope
      if (extractData) {
        return extractData(json);
      }

      if (!json.data) {
        throw new Error("[Directive] GraphQL response missing data field");
      }

      return json.data;
    },

    transform,

    // biome-ignore lint/suspicious/noExplicitAny: Pass-through options need widened types
    ...(queryOptions as any),
  });
}

// ============================================================================
// createGraphQLClient
// ============================================================================

/**
 * Create a shared GraphQL client with default endpoint and headers.
 * Returns a factory function that creates typed queries with shared config.
 *
 * @example
 * ```typescript
 * const gql = createGraphQLClient({
 *   endpoint: "/api/graphql",
 *   headers: () => ({ Authorization: `Bearer ${getToken()}` }),
 * });
 *
 * const user = gql.query({
 *   name: "user",
 *   document: GetUserDocument,
 *   variables: (facts) => facts.userId ? { id: facts.userId } : null,
 * });
 *
 * const posts = gql.query({
 *   name: "posts",
 *   document: GetPostsDocument,
 *   variables: () => ({ limit: 10 }),
 * });
 * ```
 */
export function createGraphQLClient(clientOptions: GraphQLClientOptions = {}) {
  const { endpoint = "/graphql", headers: defaultHeaders } = clientOptions;

  return {
    query: <
      TResult,
      TVariables extends Record<string, unknown>,
      TData = TResult,
      TError = Error,
    >(
      options: Omit<
        GraphQLQueryOptions<TResult, TVariables, TData, TError>,
        "endpoint"
      > & { endpoint?: string },
    ): QueryDefinition<TData> => {
      // Merge client headers with per-query headers
      const mergedHeaders: GraphQLQueryOptions<
        TResult,
        TVariables,
        TData,
        TError
      >["headers"] = () => {
        const clientH =
          typeof defaultHeaders === "function"
            ? defaultHeaders()
            : (defaultHeaders ?? {});
        const queryH =
          typeof options.headers === "function"
            ? options.headers()
            : (options.headers ?? {});

        return { ...clientH, ...queryH };
      };

      return createGraphQLQuery({
        ...options,
        endpoint: options.endpoint ?? endpoint,
        headers: mergedHeaders,
      });
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Minimal document printer – extracts the query string from a DocumentNode.
 * For production, users should use graphql's `print()` function or
 * pre-compiled persisted queries.
 */
function printDocument(doc: TypedDocumentNode): string {
  // If the document has a loc.source.body, use it directly
  const firstDef = doc.definitions[0] as
    | {
        loc?: { source?: { body?: string } };
      }
    | undefined;
  if (firstDef?.loc?.source?.body) {
    return firstDef.loc.source.body;
  }

  // Fallback: the document should have been pre-compiled
  // In production, use graphql's print() or persisted queries
  throw new Error(
    "[Directive] Cannot extract query string from DocumentNode. " +
      "Use a raw query string or ensure your codegen preserves source.",
  );
}
