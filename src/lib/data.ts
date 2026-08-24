import {
  ActivityEntry,
  Batch,
  Post,
  Refs,
  UserRecord,
} from "./types";
import {

  kvGet,
  kvHdel,
  kvHgetall,
  kvHset,
  kvLpush,
  kvLrange,
  kvSet,
} from "./store";

// Multi-account data model. Every connected Prompted account owns an isolated
// namespace; a browser (device) is bound to exactly one account at a time.
// Reference data + cron heartbeat are global.
//
//   pr:devices        hash  deviceId → userId      (which account this browser uses)
//   pr:users          hash  userId → UserRecord    (public metadata, no secrets)
//   pr:{uid}:session  str   AES-256-GCM encrypted Supabase session
//   pr:{uid}:pwd      str   AES-256-GCM encrypted password (password mode)
//   pr:{uid}:posts    hash  postId → Post
//   pr:{uid}:batches  hash  batchId → Batch
//   pr:{uid}:activity list  ActivityEntry (newest first)
//   pr:refs           str   Refs cache (categories/tools/communities — global)
//   pr:heartbeat      str   ISO of the last authenticated cron tick (global)

const K = {
  devices: "pr:devices",
  users: "pr:users",
  session: (uid: string) => `pr:${uid}:session`,
  pwd: (uid: string) => `pr:${uid}:pwd`,
  posts: (uid: string) => `pr:${uid}:posts`,
  batches: (uid: string) => `pr:${uid}:batches`,
  activity: (uid: string) => `pr:${uid}:activity`,
  refs: "pr:refs",
  heartbeat: "pr:heartbeat",
};

// ---- devices (browser → account binding) ----

export async function getDeviceUser(deviceId: string): Promise<string | null> {
  const hash = await kvHgetall(K.devices);
  return hash[deviceId] ?? null;
}

export async function bindDevice(deviceId: string, userId: string): Promise<void> {
  await kvHset(K.devices, { [deviceId]: userId });
}

export async function unbindDevice(deviceId: string): Promise<void> {
  await kvHdel(K.devices, deviceId);
}

// ---- user records ----

export async function getUserRecord(userId: string): Promise<UserRecord | null> {
  const hash = await kvHgetall(K.users);
  const raw = hash[userId];
  return raw ? (JSON.parse(raw) as UserRecord) : null;
}

export async function saveUserRecord(rec: UserRecord): Promise<void> {
  await kvHset(K.users, { [rec.id]: JSON.stringify(rec) });
}

export async function getAllUserIds(): Promise<string[]> {
  return Object.keys(await kvHgetall(K.users));
}

// ---- per-account secrets ----

export async function getSessionEnc(userId: string): Promise<string | null> {
  return kvGet(K.session(userId));
}

export async function setSessionEnc(userId: string, enc: string): Promise<void> {
  await kvSet(K.session(userId), enc);
}

export async function getPasswordEnc(userId: string): Promise<string | null> {
  return kvGet(K.pwd(userId));
}

export async function setPasswordEnc(userId: string, enc: string): Promise<void> {
  await kvSet(K.pwd(userId), enc);
}

// ---- per-account posts ----

export async function getPosts(userId: string): Promise<Post[]> {
  const hash = await kvHgetall(K.posts(userId));
  return Object.values(hash)
    .map((s) => JSON.parse(s) as Post)
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));
}

export async function getPost(userId: string, id: string): Promise<Post | null> {
  const hash = await kvHgetall(K.posts(userId));
  const raw = hash[id];
  return raw ? (JSON.parse(raw) as Post) : null;
}

export async function savePost(userId: string, post: Post): Promise<void> {
  await kvHset(K.posts(userId), { [post.id]: JSON.stringify(post) });
}

export async function deletePost(userId: string, id: string): Promise<void> {
  await kvHdel(K.posts(userId), id);
}

// ---- per-account batches ----

export async function getBatches(userId: string): Promise<Batch[]> {
  const hash = await kvHgetall(K.batches(userId));
  return Object.values(hash)
    .map((s) => JSON.parse(s) as Batch)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function getBatch(userId: string, id: string): Promise<Batch | null> {
  const hash = await kvHgetall(K.batches(userId));
  const raw = hash[id];
  return raw ? (JSON.parse(raw) as Batch) : null;
}

export async function saveBatch(userId: string, batch: Batch): Promise<void> {
  await kvHset(K.batches(userId), { [batch.id]: JSON.stringify(batch) });
}

// ---- per-account activity ----

export async function addActivity(userId: string, entry: ActivityEntry): Promise<void> {
  await kvLpush(K.activity(userId), JSON.stringify(entry));
}

export async function getActivity(
  userId: string,
  limit = 200,
): Promise<ActivityEntry[]> {
  const rows = await kvLrange(K.activity(userId), 0, limit - 1);
  return rows.map((s) => JSON.parse(s) as ActivityEntry);
}

// ---- global reference data ----

export async function getRefs(): Promise<Refs | null> {
  const raw = await kvGet(K.refs);
  return raw ? (JSON.parse(raw) as Refs) : null;
}

export async function saveRefs(refs: Refs): Promise<void> {
  await kvSet(K.refs, JSON.stringify(refs));
}

// ---- global heartbeat ----

/** Written on every authenticated cron tick. */
export async function touchHeartbeat(): Promise<void> {
  await kvSet(K.heartbeat, new Date().toISOString());
}

export async function getHeartbeat(): Promise<string | null> {
  return kvGet(K.heartbeat);
}
