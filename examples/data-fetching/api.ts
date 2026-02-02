/**
 * Mock API for Data Fetching Example
 */

import type { User, Post, Comment } from "./types.js";

// Simulated data
const USERS: User[] = [
  { id: "1", name: "Alice Johnson", email: "alice@example.com", avatar: "👩" },
  { id: "2", name: "Bob Smith", email: "bob@example.com", avatar: "👨" },
  { id: "3", name: "Carol Williams", email: "carol@example.com", avatar: "👩‍💼" },
];

const POSTS: Post[] = [
  {
    id: "1",
    userId: "1",
    title: "Getting Started with Directive",
    body: "Directive is a constraint-driven runtime for TypeScript...",
    createdAt: "2024-01-15T10:00:00Z",
  },
  {
    id: "2",
    userId: "1",
    title: "React Query Integration",
    body: "Learn how to use Directive with React Query...",
    createdAt: "2024-01-16T14:30:00Z",
  },
  {
    id: "3",
    userId: "2",
    title: "State Management Patterns",
    body: "Exploring different approaches to state management...",
    createdAt: "2024-01-17T09:15:00Z",
  },
];

const COMMENTS: Comment[] = [
  { id: "1", postId: "1", userId: "2", body: "Great introduction!" },
  { id: "2", postId: "1", userId: "3", body: "Very helpful, thanks!" },
  { id: "3", postId: "2", userId: "3", body: "This is exactly what I needed." },
  { id: "4", postId: "3", userId: "1", body: "Interesting perspective." },
];

// Simulated network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const api = {
  async fetchUser(userId: string): Promise<User> {
    await delay(300);
    const user = USERS.find((u) => u.id === userId);
    if (!user) throw new Error(`User ${userId} not found`);
    console.log("[API] Fetched user:", user.name);
    return user;
  },

  async fetchUsers(): Promise<User[]> {
    await delay(200);
    console.log("[API] Fetched all users");
    return USERS;
  },

  async fetchPost(postId: string): Promise<Post> {
    await delay(250);
    const post = POSTS.find((p) => p.id === postId);
    if (!post) throw new Error(`Post ${postId} not found`);
    console.log("[API] Fetched post:", post.title);
    return post;
  },

  async fetchUserPosts(userId: string): Promise<Post[]> {
    await delay(300);
    const posts = POSTS.filter((p) => p.userId === userId);
    console.log("[API] Fetched", posts.length, "posts for user", userId);
    return posts;
  },

  async fetchPostComments(postId: string): Promise<Comment[]> {
    await delay(200);
    const comments = COMMENTS.filter((c) => c.postId === postId);
    console.log("[API] Fetched", comments.length, "comments for post", postId);
    return comments;
  },

  async fetchRecentPosts(limit: number = 10): Promise<Post[]> {
    await delay(200);
    console.log("[API] Fetched recent posts");
    return POSTS.slice(0, limit);
  },
};
