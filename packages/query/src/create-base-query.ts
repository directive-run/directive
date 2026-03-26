/**
 * createBaseQuery — Factory for shared fetcher configuration.
 *
 * Creates a pre-configured fetcher wrapper that can be reused across
 * multiple createQuery definitions. Handles baseUrl, headers,
 * response parsing, status validation, and error transformation.
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for a base query (shared fetcher config).
 *
 * @typeParam TMeta - Optional metadata type passed through headers/transform
 */
export interface BaseQueryConfig<TMeta = unknown> {
  /** Base URL prepended to all fetcher paths. */
  baseUrl: string;

  /**
   * Prepare headers for every request. Receives current headers and metadata.
   * Return the modified headers object.
   */
  prepareHeaders?: (
    headers: Headers,
    meta: { signal: AbortSignal; extra?: TMeta },
  ) => Headers | Promise<Headers>;

  /**
   * Custom response handler. Defaults to `response.json()`.
   * Use for text, blob, arrayBuffer, or custom parsing.
   */
  responseHandler?:
    | "json"
    | "text"
    | ((response: Response) => Promise<unknown>);

  /**
   * Validate the response status code. Return true for success.
   * Defaults to `status >= 200 && status < 300`.
   */
  validateStatus?: (response: Response) => boolean;

  /**
   * Transform errors into a consistent shape before they reach the query.
   * Receives the raw error (could be a Response or Error).
   */
  transformError?: (error: unknown, response?: Response) => unknown;

  /**
   * Default timeout in milliseconds for all requests.
   * The request is aborted after this duration.
   */
  timeout?: number;

  /**
   * Default fetch options merged into every request.
   */
  fetchOptions?: Omit<RequestInit, "signal" | "headers">;
}

/**
 * Arguments passed to a base query fetcher function.
 */
export interface BaseQueryArgs {
  /** URL path (appended to baseUrl). */
  url: string;
  /** HTTP method. @default "GET" */
  method?: string;
  /** Request body (auto-serialized to JSON for objects). */
  body?: unknown;
  /** Per-request headers (merged with prepareHeaders result). */
  headers?: Record<string, string>;
  /** Per-request params serialized as query string. */
  params?: Record<string, string | number | boolean>;
  /** Override responseHandler for this request. */
  responseHandler?:
    | "json"
    | "text"
    | ((response: Response) => Promise<unknown>);
}

/**
 * A configured fetcher function produced by createBaseQuery.
 * Drop-in for the `fetcher` option of `createQuery`.
 */
export type BaseQueryFetcher = (
  args: BaseQueryArgs,
  signal: AbortSignal,
) => Promise<unknown>;

// ============================================================================
// createBaseQuery
// ============================================================================

/**
 * Create a shared fetcher factory with pre-configured base URL, headers,
 * and response handling.
 *
 * @example
 * ```typescript
 * const api = createBaseQuery({
 *   baseUrl: "/api/v1",
 *   prepareHeaders: (headers) => {
 *     headers.set("Authorization", `Bearer ${getToken()}`);
 *     return headers;
 *   },
 *   transformError: (error, response) => ({
 *     status: response?.status,
 *     message: error instanceof Error ? error.message : "Unknown error",
 *   }),
 * });
 *
 * const users = createQuery({
 *   name: "users",
 *   key: () => ({ all: true }),
 *   fetcher: (params, signal) => api({ url: "/users" }, signal),
 * });
 * ```
 */
export function createBaseQuery<TMeta = unknown>(
  config: BaseQueryConfig<TMeta>,
): BaseQueryFetcher {
  const {
    baseUrl,
    prepareHeaders,
    responseHandler = "json",
    validateStatus = (res) => res.status >= 200 && res.status < 300,
    transformError,
    timeout,
    fetchOptions = {},
  } = config;

  return async (args: BaseQueryArgs, signal: AbortSignal): Promise<unknown> => {
    const {
      url,
      method = "GET",
      body,
      headers: perRequestHeaders,
      params,
      responseHandler: perRequestHandler,
    } = args;

    // Build URL with query params
    let fullUrl = `${baseUrl}${url}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        searchParams.set(key, String(value));
      }
      fullUrl += `?${searchParams.toString()}`;
    }

    // Build headers
    const headers = new Headers(perRequestHeaders);
    if (prepareHeaders) {
      const prepared = await prepareHeaders(headers, { signal });
      // If a new Headers instance was returned, copy its entries
      if (prepared instanceof Headers && prepared !== headers) {
        prepared.forEach((value, key) => {
          headers.set(key, value);
        });
      }
    }

    // Serialize body
    let serializedBody: BodyInit | undefined;
    if (body !== undefined) {
      if (
        typeof body === "string" ||
        body instanceof FormData ||
        body instanceof Blob ||
        body instanceof ArrayBuffer
      ) {
        serializedBody = body as BodyInit;
      } else {
        serializedBody = JSON.stringify(body);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      }
    }

    // Handle timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let fetchSignal = signal;
    let onAbort: (() => void) | undefined;
    if (timeout) {
      const controller = new AbortController();
      fetchSignal = controller.signal;

      // Abort on either: external signal or timeout
      onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort);
      timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    let response: Response | undefined;
    try {
      response = await fetch(fullUrl, {
        ...fetchOptions,
        method,
        headers,
        body: serializedBody,
        signal: fetchSignal,
      });

      if (!validateStatus(response)) {
        const error = new Error(
          `[Directive] Request failed with status ${response.status}`,
        );
        if (transformError) {
          throw transformError(error, response);
        }

        throw error;
      }

      // Parse response
      const handler = perRequestHandler ?? responseHandler;
      if (handler === "json") {
        return await response.json();
      }
      if (handler === "text") {
        return await response.text();
      }

      return await handler(response);
    } catch (error) {
      // Only transform network/parsing errors, not already-transformed validation errors
      if (
        transformError &&
        response === undefined &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        throw transformError(error);
      }

      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }
  };
}
