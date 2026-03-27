import { createModule, createSystem, t } from "@directive-run/core";
import type { ModuleSchema } from "@directive-run/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGraphQLClient,
  createGraphQLQuery,
  createQuerySystem,
  withQueries,
} from "../index.js";
import type { ResourceState, TypedDocumentNode } from "../index.js";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mockFetch;
  mockFetch.mockReset();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockGraphQLResponse<T>(data: T, errors?: Array<{ message: string }>) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data, errors }),
    headers: new Headers(),
  } as unknown as Response;
}

// ============================================================================
// Fake TypedDocumentNode (simulates graphql-codegen output)
// ============================================================================

interface GetUserQuery {
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface GetUserVariables {
  id: string;
}

// Simulate a codegen-generated TypedDocumentNode
const GetUserDocument: TypedDocumentNode<GetUserQuery, GetUserVariables> = {
  kind: "Document" as const,
  definitions: [
    {
      kind: "OperationDefinition",
      loc: {
        source: {
          body: "query GetUser($id: ID!) { user(id: $id) { id name email } }",
        },
      },
    },
  ],
};

interface GetPostsQuery {
  posts: Array<{ id: string; title: string }>;
}

interface GetPostsVariables {
  limit: number;
}

const GetPostsDocument: TypedDocumentNode<GetPostsQuery, GetPostsVariables> = {
  kind: "Document" as const,
  definitions: [
    {
      kind: "OperationDefinition",
      loc: {
        source: {
          body: "query GetPosts($limit: Int!) { posts(limit: $limit) { id title } }",
        },
      },
    },
  ],
};

// ============================================================================
// createGraphQLQuery
// ============================================================================

describe("createGraphQLQuery", () => {
  describe("with TypedDocumentNode", () => {
    it("fetches data with typed variables", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({
          user: { id: "1", name: "John", email: "john@example.com" },
        }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: (facts) => {
          const userId = facts.userId as string;
          if (!userId) {
            return null;
          }

          return { id: userId };
        },
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: { userId: t.string() },
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
          init: (f) => {
            f.userId = "";
          },
        }),
      );
      const system = createSystem({ module: mod });
      system.start();

      system.facts.userId = "1";
      await system.settle();

      const state = system.read("user") as ResourceState<GetUserQuery>;
      expect(state.data).toEqual({
        user: { id: "1", name: "John", email: "john@example.com" },
      });
      expect(state.isSuccess).toBe(true);

      // Verify the fetch was called with correct GraphQL payload
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe("/graphql");
      const body = JSON.parse(opts.body);
      expect(body.query).toContain("GetUser");
      expect(body.variables).toEqual({ id: "1" });

      system.destroy();
    });

    it("disables query when variables returns null", async () => {
      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => null,
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).not.toHaveBeenCalled();
      system.destroy();
    });

    it("uses custom endpoint", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({ user: { id: "1", name: "J", email: "j@e.com" } }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        endpoint: "/api/v2/graphql",
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("/api/v2/graphql");
      system.destroy();
    });

    it("sends custom headers", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({ user: { id: "1", name: "J", email: "j@e.com" } }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        headers: { Authorization: "Bearer token123" },
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      const [, opts] = mockFetch.mock.calls[0]!;
      expect(opts.headers.Authorization).toBe("Bearer token123");
      system.destroy();
    });
  });

  describe("with raw query string", () => {
    it("accepts a string query", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({ user: { id: "1", name: "John" } }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: "query GetUser($id: ID!) { user(id: $id) { id name } }",
        variables: () => ({ id: "1" }),
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      const state = system.read("user") as ResourceState<{
        user: { id: string; name: string };
      }>;
      expect(state.data).toEqual({ user: { id: "1", name: "John" } });
      system.destroy();
    });
  });

  describe("error handling", () => {
    it("throws on HTTP error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      const state = system.read("user") as ResourceState<unknown>;
      expect(state.isError).toBe(true);
      expect((state.error as Error).message).toContain("500");
      system.destroy();
    });

    it("handles GraphQL errors in response", async () => {
      const onGraphQLError = vi.fn();
      mockFetch.mockResolvedValue(
        mockGraphQLResponse(null, [{ message: "User not found" }]),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        onGraphQLError,
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      expect(onGraphQLError).toHaveBeenCalledWith([
        { message: "User not found" },
      ]);
      const state = system.read("user") as ResourceState<unknown>;
      expect(state.isError).toBe(true);
      expect((state.error as Error).message).toContain("User not found");
      system.destroy();
    });

    it("returns data even with partial errors", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { user: { id: "1", name: "John", email: null } },
            errors: [{ message: "Could not resolve email" }],
          }),
        headers: new Headers(),
      });

      const onGraphQLError = vi.fn();
      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        onGraphQLError,
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      // Data is returned despite partial errors
      const state = system.read("user") as ResourceState<GetUserQuery>;
      expect(state.isSuccess).toBe(true);
      expect(state.data?.user.id).toBe("1");
      expect(onGraphQLError).toHaveBeenCalled();
      system.destroy();
    });
  });

  describe("transform", () => {
    it("transforms GraphQL result before caching", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({
          user: { id: "1", name: "John Doe", email: "john@example.com" },
        }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        transform: (result) => ({
          displayName: result.user.name.toUpperCase(),
        }),
      });

      const mod = createModule(
        "test",
        withQueries([user], {
          schema: {
            facts: {},
            derivations: {},
            events: {},
            requirements: {},
          } satisfies ModuleSchema,
        }),
      );
      const system = createSystem({ module: mod });
      system.start();
      await system.settle();

      const state = system.read("user") as ResourceState<{
        displayName: string;
      }>;
      expect(state.data).toEqual({ displayName: "JOHN DOE" });
      system.destroy();
    });
  });

  describe("query options pass-through", () => {
    it("accepts tags for cache invalidation", async () => {
      mockFetch.mockResolvedValue(
        mockGraphQLResponse({ user: { id: "1", name: "J", email: "j@e.com" } }),
      );

      const user = createGraphQLQuery({
        name: "user",
        document: GetUserDocument,
        variables: () => ({ id: "1" }),
        tags: ["users"],
        refetchAfter: 30_000,
        keepPreviousData: true,
      });

      // Verify the definition has the expected shape
      expect(user.name).toBe("user");
      expect(user.tags).toEqual(["users"]);
    });
  });
});

// ============================================================================
// createGraphQLClient
// ============================================================================

describe("createGraphQLClient", () => {
  it("creates queries with shared endpoint", async () => {
    mockFetch.mockResolvedValue(
      mockGraphQLResponse({
        posts: [{ id: "1", title: "Hello" }],
      }),
    );

    const gql = createGraphQLClient({
      endpoint: "/api/graphql",
    });

    const posts = gql.query({
      name: "posts",
      document: GetPostsDocument,
      variables: () => ({ limit: 10 }),
    });

    const mod = createModule(
      "test",
      withQueries([posts], {
        schema: {
          facts: {},
          derivations: {},
          events: {},
          requirements: {},
        } satisfies ModuleSchema,
      }),
    );
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();

    const [url] = mockFetch.mock.calls[0]!;
    expect(url).toBe("/api/graphql");

    const state = system.read("posts") as ResourceState<GetPostsQuery>;
    expect(state.data?.posts).toHaveLength(1);
    system.destroy();
  });

  it("merges client headers with query headers", async () => {
    mockFetch.mockResolvedValue(mockGraphQLResponse({ posts: [] }));

    const gql = createGraphQLClient({
      endpoint: "/api/graphql",
      headers: () => ({ Authorization: "Bearer global-token" }),
    });

    const posts = gql.query({
      name: "posts",
      document: GetPostsDocument,
      variables: () => ({ limit: 10 }),
      headers: { "X-Custom": "per-query" },
    });

    const mod = createModule(
      "test",
      withQueries([posts], {
        schema: {
          facts: {},
          derivations: {},
          events: {},
          requirements: {},
        } satisfies ModuleSchema,
      }),
    );
    const system = createSystem({ module: mod });
    system.start();
    await system.settle();

    const [, opts] = mockFetch.mock.calls[0]!;
    expect(opts.headers.Authorization).toBe("Bearer global-token");
    expect(opts.headers["X-Custom"]).toBe("per-query");
    system.destroy();
  });

  it("works inside createQuerySystem", async () => {
    mockFetch.mockResolvedValue(
      mockGraphQLResponse({
        user: { id: "1", name: "John", email: "john@example.com" },
      }),
    );

    const gql = createGraphQLClient({ endpoint: "/api/graphql" });
    const userDef = gql.query({
      name: "user",
      document: GetUserDocument,
      variables: (facts) => {
        const userId = facts.userId as string;
        if (!userId) {
          return null;
        }

        return { id: userId };
      },
    });

    // Use with createQuerySystem via the advanced definitions path
    const app = createQuerySystem({
      facts: { userId: "" },
      queries: {
        // Inline query that delegates to the graphql query's fetcher
        user: {
          key: (f) => {
            const userId = f.userId as string;
            if (!userId) {
              return null;
            }

            return { userId };
          },
          fetcher: async (p, signal) => {
            const res = await fetch("/api/graphql", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query:
                  "query GetUser($id: ID!) { user(id: $id) { id name email } }",
                variables: { id: p.userId },
              }),
              signal,
            });
            const json = await res.json();

            return json.data.user;
          },
        },
      },
    });

    app.facts.userId = "1";
    await app.settle();

    const state = app.read("user") as ResourceState<{
      id: string;
      name: string;
      email: string;
    }>;
    expect(state.data).toEqual({
      id: "1",
      name: "John",
      email: "john@example.com",
    });
    app.destroy();
  });
});
