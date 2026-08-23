import {
  ActivityEntry,
  Batch,
  Post,
  Refs,
  SessionRecord,
} from "./types";
import {
  kvDel,
  kvGet,
  kvHdel,
  kvHgetall,
  kvHset,
  kvLpush,
  kvLrange,
  kvSet,
} from "./store";

// All Cadence data lives in Upstash Redis under these keys.
const K = {
  session: "cadence:session",
  posts: "cadence:posts", // hash: postId -> Post JSON
  batches: "cadence:batches", // hash: batchId -> Batch JSON
  activity: "cadence:activity", // list: ActivityEntry JSON (newest first)
  refs: "cadence:refs", // string: Refs JSON
  heartbeat: "cadence:heartbeat", // string: ISO — last successful cron tick
} as const;

// ---- heartbeat ----

/** Written on every authenticated cron tick — the UI warns when it goes stale. */
export async function touchHeartbeat(): Promise<void> {
  await kvSet(K.heartbeat, new Date().toISOString());
}

export async function getHeartbeat(): Promise<string | null> {
  return kvGet(K.heartbeat);
}

// ---- session ----

export const getSessionRecord = async (): Promise<SessionRecord | null> => {
  const raw = await kvGet(K.session);
  return raw ? (JSON.parse(raw) as SessionRecord) : null;
};

export const saveSessionRecord = async (rec: SessionRecord): Promise<void> => {
  await kvSet(K.session, JSON.stringify(rec));
};

export const clearSession = async (): Promise<void> => {
  await kvDel(K.session);
};

// ---- posts ----

export const getPosts = async (): Promise<Post[]> => {
  const hash = await kvHgetall(K.posts);
  return Object.values(hash)
    .map((s) => JSON.parse(s) as Post)
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));
};

export const getPost = async (id: string): Promise<Post | null> => {
  const hash = await kvHgetall(K.posts);
  const raw = hash[id];
  return raw ? (JSON.parse(raw) as Post) : null;
};

export const savePost = async (post: Post): Promise<void> => {
  await kvHset(K.posts, { [post.id]: JSON.stringify(post) });
};

export const deletePost = async (id: string): Promise<void> => {
  await kvHdel(K.posts, id);
};

// ---- batches ----

export const getBatches = async (): Promise<Batch[]> => {
  const hash = await kvHgetall(K.batches);
  return Object.values(hash)
    .map((s) => JSON.parse(s) as Batch)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
};

export const getBatch = async (id: string): Promise<Batch | null> => {
  const hash = await kvHgetall(K.batches);
  const raw = hash[id];
  return raw ? (JSON.parse(raw) as Batch) : null;
};

export const saveBatch = async (batch: Batch): Promise<void> => {
  await kvHset(K.batches, { [batch.id]: JSON.stringify(batch) });
};

// ---- activity ----

export const addActivity = async (entry: ActivityEntry): Promise<void> => {
  await kvLpush(K.activity, JSON.stringify(entry));
};

export const getActivity = async (limit = 200): Promise<ActivityEntry[]> => {
  const rows = await kvLrange(K.activity, 0, limit - 1);
  return rows.map((s) => JSON.parse(s) as ActivityEntry);
};

// ---- reference data (categories / tools / communities cache) ----

export const getRefs = async (): Promise<Refs | null> => {
  const raw = await kvGet(K.refs);
  return raw ? (JSON.parse(raw) as Refs) : null;
};

export const saveRefs = async (refs: Refs): Promise<void> => {
  await kvSet(K.refs, JSON.stringify(refs));
};
