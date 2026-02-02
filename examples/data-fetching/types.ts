/**
 * Types for Data Fetching Example
 */

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
}

export interface Post {
  id: string;
  userId: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  userId: string;
  body: string;
}

export interface AppFacts {
  currentUserId: string | null;
  selectedPostId: string | null;
  profilePanelOpen: boolean;
  commentsExpanded: boolean;
}
