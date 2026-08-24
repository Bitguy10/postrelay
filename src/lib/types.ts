// Shared domain types for PostRelay.

export type PostType = "build" | "discussion" | "video" | "question";

// "draft" = saved for preview, not yet scheduled into the queue
export type PostStatus = "draft" | "queued" | "in_progress" | "posted" | "failed";

export interface MediaRef {
  kind: "image" | "video" | "file";
  name: string;
  mime: string;
  /** Public URL — either uploaded to Prompted's Supabase storage at compose time, or user-provided. */
  url: string;
  /** Storage path inside the bucket, when uploaded. */
  path?: string;
}

export interface PromptStep {
  step_number: number;
  prompt_text: string;
}

/**
 * One flat shape for all four post types (Prompted's composer writes a single
 * `posts` row with inline fields, so a flat local shape maps 1:1 onto it).
 * Per-type meaning:
 *   build:      title = "What did you build?", body = "Explain your post", link = build URL
 *   discussion: title/body, link = optional link, poll fields
 *   video:      title, body = description, link = demo URL, githubUrl, video
 *   question:   title = the question, body = details, link unused
 */
export interface Post {
  id: string;
  type: PostType;
  status: PostStatus;
  /** ISO timestamp — the exact moment this post should fire. */
  fireAt: string;
  createdAt: string;
  batchId: string | null;

  title: string;
  body: string;
  promptSteps: PromptStep[];
  link?: string;
  githubUrl?: string;
  remixUrl?: string;
  difficulty?: string; // build only: beginner | intermediate | advanced
  pollEnabled?: boolean; // discussion only
  pollOptions?: string[]; // discussion only

  categoryIds: string[];
  toolNames: string[]; // display names, matched against synced ai_tools
  communityIds: string[];
  media: MediaRef[]; // images (build project media / discussion & question media)
  video?: MediaRef | null; // video post upload
  designDoc?: { name: string; html: string } | null; // build only

  // worker bookkeeping
  attempts: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  postedAt?: string | null;
  lockedAt?: string | null;
  /** Prompted's own post id once it fires, for deep-linking. */
  promptedPostId?: string | null;
}

export interface Batch {
  id: string;
  intervalDays: number;
  timeOfDay: string; // "HH:mm" wall-clock time
  /** IANA zone the cadence is anchored to (e.g. "Africa/Lagos"). */
  timezone: string;
  status: "active" | "paused";
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  at: string; // ISO
  postId: string;
  postType: PostType;
  title: string;
  status: "posted" | "retrying" | "failed";
  attempts?: number; // e.g. 2 of 3 when retrying
  reason?: string;
  authFailure?: boolean;
}

export interface PromptedUser {
  id: string;
  username?: string;
  email?: string;
}

/** The exact JSON Prompted stores in Local Storage under "prompted-auth". */
export interface PromptedSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
    raw_user_meta_data?: Record<string, unknown>;
  };
}

/** What we persist — the session itself only as an AES-256-GCM ciphertext. */
export interface SessionRecord {
  enc: string;
  user: PromptedUser;
  /** IANA zone all of this user's times are entered/displayed in. */
  timezone: string;
  /** True when a provided timezone was invalid and we fell back to UTC. */
  tzFallback?: boolean;
  needsReconnect: boolean;
  connectedAt: string;
  refreshedAt?: string;
  /**
   * Email+password connect: the password, separately AES-256-GCM encrypted.
   * Present only for password-mode connections — enables self-healing
   * (re-sign-in when the refresh token is ever invalidated).
   */
  passwordEnc?: string;
  /** How this account connected: independent password session vs pasted token. */
  authMode?: "password" | "token";
}

export interface Refs {
  categories: { id: string; name: string }[];
  tools: { id: string; name: string }[];
  communities: { id: string; name: string; member_count?: number }[];
  syncedAt: string | null;
}
