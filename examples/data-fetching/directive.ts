/**
 * Directive Configuration for Data Fetching
 *
 * Demonstrates constraint-driven prefetching with React Query.
 */

import { QueryClient } from "@tanstack/react-query";
import {
  createQueryBridge,
  whenThenPrefetch,
  isQueryLoading,
  prefetch,
  type QueryConstraint,
} from "directive/react-query";
import { api } from "./api.js";
import type { AppFacts, User, Post, Comment } from "./types.js";

/**
 * Create the query bridge that coordinates Directive with React Query.
 */
export function createDataFetchingBridge(queryClient: QueryClient) {
  return createQueryBridge<AppFacts>(queryClient, {
    // Application facts schema
    factsSchema: {
      currentUserId: { _type: null as string | null, _validators: [] },
      selectedPostId: { _type: null as string | null, _validators: [] },
      profilePanelOpen: { _type: false as boolean, _validators: [] },
      commentsExpanded: { _type: false as boolean, _validators: [] },
    },

    // Initialize facts
    init: (facts) => {
      facts.currentUserId = null;
      facts.selectedPostId = null;
      facts.profilePanelOpen = false;
      facts.commentsExpanded = false;
    },

    // Constraints: Directive decides WHEN to prefetch
    constraints: {
      // Prefetch user profile when profile panel is opened
      prefetchUserOnProfileOpen: whenThenPrefetch<AppFacts>(
        (facts) => {
          if (!facts.profilePanelOpen) return false;
          if (!facts.currentUserId) return false;
          // Check if already loaded or loading
          const key = JSON.stringify(["user", facts.currentUserId]);
          const state = facts.queryStates[key];
          if (state?.hasData || isQueryLoading(state)) return false;
          return true;
        },
        (facts) => ["user", facts.currentUserId!],
        { priority: 10 }
      ),

      // Prefetch user's posts when viewing their profile
      prefetchUserPostsOnProfile: whenThenPrefetch<AppFacts>(
        (facts) => {
          if (!facts.profilePanelOpen) return false;
          if (!facts.currentUserId) return false;
          const key = JSON.stringify(["userPosts", facts.currentUserId]);
          const state = facts.queryStates[key];
          if (state?.hasData || isQueryLoading(state)) return false;
          return true;
        },
        (facts) => ["userPosts", facts.currentUserId!],
        { priority: 5 } // Lower priority than user fetch
      ),

      // Prefetch comments when post is selected and comments expanded
      prefetchCommentsOnExpand: whenThenPrefetch<AppFacts>(
        (facts) => {
          if (!facts.commentsExpanded) return false;
          if (!facts.selectedPostId) return false;
          const key = JSON.stringify(["postComments", facts.selectedPostId]);
          const state = facts.queryStates[key];
          if (state?.hasData || isQueryLoading(state)) return false;
          return true;
        },
        (facts) => ["postComments", facts.selectedPostId!],
        { priority: 10 }
      ),

      // Prefetch post author when viewing a post
      prefetchPostAuthor: {
        when: (facts) => {
          if (!facts.selectedPostId) return false;
          // We need the post data first to know the author
          const postKey = JSON.stringify(["post", facts.selectedPostId]);
          const postState = facts.queryStates[postKey];
          // If post is loaded, we'd check its userId
          // For this demo, we'll skip this to avoid complexity
          return false;
        },
        require: () => prefetch(["user", "unknown"]),
        priority: 1,
      },
    },

    // Custom resolvers (in addition to built-in prefetch resolver)
    resolvers: {
      // Could add custom resolvers for complex orchestration
    },

    debug: true,
  });
}

/**
 * Query key helpers (for type safety).
 */
export const queryKeys = {
  user: (userId: string) => ["user", userId] as const,
  users: () => ["users"] as const,
  post: (postId: string) => ["post", postId] as const,
  userPosts: (userId: string) => ["userPosts", userId] as const,
  postComments: (postId: string) => ["postComments", postId] as const,
  recentPosts: () => ["recentPosts"] as const,
};

/**
 * Query options factory (for use with useQuery).
 */
export const queryOptions = {
  user: (userId: string) => ({
    queryKey: queryKeys.user(userId),
    queryFn: () => api.fetchUser(userId),
    staleTime: 5 * 60 * 1000, // 5 minutes
  }),

  users: () => ({
    queryKey: queryKeys.users(),
    queryFn: () => api.fetchUsers(),
    staleTime: 5 * 60 * 1000,
  }),

  post: (postId: string) => ({
    queryKey: queryKeys.post(postId),
    queryFn: () => api.fetchPost(postId),
    staleTime: 5 * 60 * 1000,
  }),

  userPosts: (userId: string) => ({
    queryKey: queryKeys.userPosts(userId),
    queryFn: () => api.fetchUserPosts(userId),
    staleTime: 5 * 60 * 1000,
  }),

  postComments: (postId: string) => ({
    queryKey: queryKeys.postComments(postId),
    queryFn: () => api.fetchPostComments(postId),
    staleTime: 2 * 60 * 1000, // 2 minutes (comments change more often)
  }),

  recentPosts: () => ({
    queryKey: queryKeys.recentPosts(),
    queryFn: () => api.fetchRecentPosts(),
    staleTime: 1 * 60 * 1000, // 1 minute
  }),
};
