/**
 * Data Fetching Example - React App
 *
 * Demonstrates:
 * - React Query for HOW to fetch (caching, deduplication, retries)
 * - Directive for WHEN to fetch (constraint-driven prefetching)
 */

import React, { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createDataFetchingBridge, queryOptions, queryKeys } from "./directive.js";
import type { User, Post, Comment } from "./types.js";

// Create query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

// Create Directive bridge
const bridge = createDataFetchingBridge(queryClient);

// ============================================================================
// Components
// ============================================================================

function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading } = useQuery(queryOptions.user(userId));
  const { data: posts } = useQuery(queryOptions.userPosts(userId));

  if (isLoading) return <div>Loading profile...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <div style={{ padding: 16, background: "#f5f5f5", borderRadius: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 48 }}>{user.avatar}</span>
        <div>
          <h2 style={{ margin: 0 }}>{user.name}</h2>
          <div style={{ color: "#666" }}>{user.email}</div>
        </div>
      </div>
      {posts && (
        <div style={{ marginTop: 16 }}>
          <strong>{posts.length} posts</strong>
        </div>
      )}
    </div>
  );
}

function PostCard({
  post,
  selected,
  onSelect,
}: {
  post: Post;
  selected: boolean;
  onSelect: () => void;
}) {
  const { data: author } = useQuery({
    ...queryOptions.user(post.userId),
    enabled: selected, // Only fetch author when selected
  });

  return (
    <div
      onClick={onSelect}
      style={{
        padding: 16,
        marginBottom: 12,
        border: selected ? "2px solid #007bff" : "1px solid #ddd",
        borderRadius: 8,
        cursor: "pointer",
        background: selected ? "#f0f7ff" : "white",
      }}
    >
      <h3 style={{ margin: "0 0 8px" }}>{post.title}</h3>
      <p style={{ color: "#666", margin: "0 0 8px" }}>{post.body}</p>
      <div style={{ fontSize: 12, color: "#999" }}>
        {author ? `By ${author.name}` : `User ${post.userId}`} •{" "}
        {new Date(post.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function Comments({ postId }: { postId: string }) {
  const { data: comments, isLoading } = useQuery(queryOptions.postComments(postId));
  const { data: users } = useQuery(queryOptions.users());

  if (isLoading) return <div>Loading comments...</div>;

  const getUserName = (userId: string) =>
    users?.find((u) => u.id === userId)?.name ?? `User ${userId}`;

  return (
    <div style={{ marginTop: 16 }}>
      <h4>Comments ({comments?.length ?? 0})</h4>
      {comments?.map((comment) => (
        <div
          key={comment.id}
          style={{
            padding: 12,
            marginBottom: 8,
            background: "#f9f9f9",
            borderRadius: 4,
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>
            {getUserName(comment.userId)}
          </div>
          <div>{comment.body}</div>
        </div>
      ))}
    </div>
  );
}

function QueryCacheStatus() {
  const queryClient = useQueryClient();
  const [cacheStats, setCacheStats] = useState({ queries: 0, fresh: 0, stale: 0 });

  useEffect(() => {
    const update = () => {
      const cache = queryClient.getQueryCache();
      const queries = cache.findAll();
      const fresh = queries.filter((q) => q.state.dataUpdatedAt > Date.now() - 60000).length;
      setCacheStats({
        queries: queries.length,
        fresh,
        stale: queries.length - fresh,
      });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [queryClient]);

  return (
    <div
      style={{
        padding: 12,
        background: "#e9ecef",
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <strong>React Query Cache</strong>
      <div>
        {cacheStats.queries} queries ({cacheStats.fresh} fresh, {cacheStats.stale}{" "}
        stale)
      </div>
    </div>
  );
}

function DirectiveStatus() {
  const [state, setState] = useState<{
    unmet: number;
    inflight: number;
  }>({ unmet: 0, inflight: 0 });

  useEffect(() => {
    const update = () => {
      const inspection = bridge.system.inspect();
      setState({
        unmet: inspection.unmet.length,
        inflight: inspection.inflight.length,
      });
    };

    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        padding: 12,
        background: "#d4edda",
        borderRadius: 8,
        fontSize: 14,
      }}
    >
      <strong>Directive Status</strong>
      <div>
        {state.unmet} unmet requirements, {state.inflight} inflight
      </div>
    </div>
  );
}

function App() {
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const { data: posts, isLoading: postsLoading } = useQuery(queryOptions.recentPosts());
  const { data: users } = useQuery(queryOptions.users());

  // Sync UI state to Directive facts
  useEffect(() => {
    bridge.facts.currentUserId = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    bridge.facts.selectedPostId = selectedPostId;
  }, [selectedPostId]);

  useEffect(() => {
    bridge.facts.profilePanelOpen = profileOpen;
  }, [profileOpen]);

  useEffect(() => {
    bridge.facts.commentsExpanded = commentsExpanded;
  }, [commentsExpanded]);

  const handleSelectPost = (postId: string) => {
    setSelectedPostId(postId);
    setCommentsExpanded(false);
  };

  const handleViewProfile = (userId: string) => {
    setCurrentUserId(userId);
    setProfileOpen(true);
    // Directive will automatically prefetch user data!
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 20 }}>
      <h1>Data Fetching Example</h1>
      <p style={{ color: "#666" }}>
        Demonstrates Directive + React Query for constraint-driven prefetching.
      </p>

      {/* Status panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <QueryCacheStatus />
        <DirectiveStatus />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 24 }}>
        {/* User list */}
        <div>
          <h2>Users</h2>
          {users?.map((user) => (
            <div
              key={user.id}
              onClick={() => handleViewProfile(user.id)}
              style={{
                padding: 12,
                marginBottom: 8,
                border: "1px solid #ddd",
                borderRadius: 8,
                cursor: "pointer",
                background: currentUserId === user.id ? "#f0f7ff" : "white",
              }}
            >
              <span style={{ fontSize: 24, marginRight: 8 }}>{user.avatar}</span>
              {user.name}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div>
          {/* Profile panel (when open) */}
          {profileOpen && currentUserId && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>Profile</h2>
                <button onClick={() => setProfileOpen(false)}>Close</button>
              </div>
              <UserProfile userId={currentUserId} />
            </div>
          )}

          {/* Posts */}
          <h2>Recent Posts</h2>
          {postsLoading ? (
            <div>Loading posts...</div>
          ) : (
            posts?.map((post) => (
              <div key={post.id}>
                <PostCard
                  post={post}
                  selected={selectedPostId === post.id}
                  onSelect={() => handleSelectPost(post.id)}
                />
                {selectedPostId === post.id && (
                  <div style={{ marginLeft: 20, marginBottom: 16 }}>
                    <button
                      onClick={() => setCommentsExpanded(!commentsExpanded)}
                      style={{ marginBottom: 8 }}
                    >
                      {commentsExpanded ? "Hide Comments" : "Show Comments"}
                    </button>
                    {commentsExpanded && <Comments postId={post.id} />}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* How it works */}
      <div
        style={{
          marginTop: 40,
          padding: 20,
          background: "#f8f9fa",
          borderRadius: 8,
        }}
      >
        <h3>How Directive + React Query Work Together</h3>
        <ul style={{ lineHeight: 1.8 }}>
          <li>
            <strong>React Query</strong> handles HOW to fetch: caching,
            deduplication, retries, background refetch
          </li>
          <li>
            <strong>Directive</strong> decides WHEN to fetch: constraint-driven
            prefetching based on UI state
          </li>
          <li>
            <strong>Example</strong>: "If profile panel is open AND user not
            loaded → prefetch user data"
          </li>
          <li>
            <strong>Automatic</strong>: Just update facts (profilePanelOpen =
            true), Directive handles the rest
          </li>
          <li>
            <strong>No manual prefetch calls</strong>: Constraints declare
            intent, resolvers execute
          </li>
        </ul>
      </div>
    </div>
  );
}

// Root component with providers
export function DataFetchingApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

export default DataFetchingApp;
