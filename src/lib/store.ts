import { Redis } from "@upstash/redis";
import { redisConfigured } from "./env";

// Thin transport layer over Upstash Redis (REST). When Upstash env vars are
// absent (local dev / preview), an in-memory Map keeps the whole app runnable
// — data resets on restart and never leaves the process. Production requires
// real env vars; the API surfaces that clearly.

let client: Redis | null | undefined;

function redis(): Redis | null {
  if (client !== undefined) return client;
  client = redisConfigured()
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      })
    : null;
  return client;
}

const mem = new Map<string, string>();

export async function kvGet(key: string): Promise<string | null> {
  const r = redis();
  if (r) {
    // @upstash/redis auto-deserializes JSON-looking values — normalize back to
    // strings so the data layer can own parsing.
    const v = await r.get(key);
    if (v == null) return null;
    return typeof v === "string" ? v : JSON.stringify(v);
  }
  return mem.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const r = redis();
  if (r) {
    await r.set(key, value);
    return;
  }
  mem.set(key, value);
}

export async function kvDel(key: string): Promise<void> {
  const r = redis();
  if (r) {
    await r.del(key);
    return;
  }
  mem.delete(key);
}

export async function kvHgetall(key: string): Promise<Record<string, string>> {
  const r = redis();
  if (r) {
    const raw = (await r.hgetall(key)) ?? {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
  }
  const raw = mem.get(key);
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
}

export async function kvHset(
  key: string,
  fields: Record<string, string>,
): Promise<void> {
  const r = redis();
  if (r) {
    await r.hset(key, fields);
    return;
  }
  const cur = await kvHgetall(key);
  mem.set(key, JSON.stringify({ ...cur, ...fields }));
}

export async function kvHdel(key: string, field: string): Promise<void> {
  const r = redis();
  if (r) {
    await r.hdel(key, field);
    return;
  }
  const cur = await kvHgetall(key);
  delete cur[field];
  mem.set(key, JSON.stringify(cur));
}

export async function kvLpush(key: string, value: string): Promise<void> {
  const r = redis();
  if (r) {
    await r.lpush(key, value);
    return;
  }
  const cur = await kvLrange(key, 0, -1);
  cur.unshift(value);
  mem.set(key, JSON.stringify(cur));
}

export async function kvLrange(
  key: string,
  start: number,
  end: number,
): Promise<string[]> {
  const r = redis();
  if (r) {
    const rows = (await r.lrange(key, start, end)) ?? [];
    return rows.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
  }
  const raw = mem.get(key);
  return raw ? (JSON.parse(raw) as string[]) : [];
}
