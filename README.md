# PostRelay

Free scheduling & auto-posting for [Prompted](https://prmpted.com). No accounts,
no always-on backend: Vercel serverless functions + Upstash Redis (free tiers)
+ a cron-job.org ping every 5 minutes.

Connect your Prompted account two ways:

- **Email & password** (recommended) — PostRelay signs in server-side via
  Supabase's password grant, minting an **independent session** that the
  user's open prmpted.com tab can never invalidate (Supabase rotates refresh
  tokens, so two clients sharing one session eventually conflict). The
  password is stored AES-256-GCM encrypted and enables **self-healing**:
  if the session is ever lost, PostRelay silently signs in again.
- **Paste token** — for Google-login accounts (no password exists, and
  Prompted's Supabase OAuth allowlist only permits their own domains, so a
  third-party Google flow isn't possible). Paste the `prompted-auth` session
  from Local Storage; re-paste if it ever goes stale. Compose posts with every field Prompted's
own composer has — Build, Discussion, Video, Question — then fire them at an
exact time or drip a whole batch on a cadence. A protected cron endpoint checks
for due posts, refreshes your token when needed, and posts via Prompted's own
Supabase PostgREST API. Every attempt is logged with retry/backoff and a clear
reconnect prompt when the session goes stale.

## Per-user timezones

Every time in PostRelay belongs to the connected user's own clock:

- The zone is auto-detected at connect (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
  and stored as an **IANA identifier** (`Africa/Lagos`, `America/New_York`,
  `Asia/Tokyo`) on the session record in Redis — never a fixed UTC offset,
  because offsets drift across daylight saving time.
- A searchable timezone picker (connect screen → *Timezone* card) overrides
  detection any time.
- Times entered on compose are interpreted in that zone and converted to UTC
  (via **Luxon**) before storage; every display (countdowns, next-fire stamps,
  activity log, preview) converts UTC back to the user's zone, with the zone
  abbreviation shown where ambiguity is possible (`EDT`, `GMT+1`).
- Drip cadences are stored as *"09:00 in timezone X"* and **each occurrence is
  recomputed against the zone**, so a 9:00am rule still fires at 9:00am across
  DST transitions instead of drifting by an hour (verified by unit test for
  both US fall-back and spring-forward).
- The cron worker always compares due-ness in **UTC instants** — the per-user
  zone only affects input and display, never the firing logic.
- Changing your zone with posts already queued asks explicitly whether to
  **reinterpret** them (9:00 AM stays 9:00 AM in the new zone — different real
  moment) or **keep absolute times** (same real moment). Nothing is picked
  silently; already-fired posts are never touched.
- An invalid/missing zone falls back to **UTC with a visible warning banner**
  and an inline prompt on the connect screen.

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in at least POSTRELAY_ENCRYPTION_KEY
npm run dev                  # http://localhost:3000
```

Without Upstash env vars the app runs on an in-memory dev store (data resets on
restart) so you can click through everything locally.

Type-check + lint:

```bash
npm run build   # runs Next's production build (types + lint)
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | prod | All persistent data (encrypted tokens, queue, batches, activity, reference cache) |
| `POSTRELAY_ENCRYPTION_KEY` | prod | AES-256-GCM key (64-char hex or any string, hashed). Encrypts session tokens at rest |
| `CRON_SECRET` | prod | Shared secret protecting `/api/cron/tick` |
| `PROMPTED_SUPABASE_ANON_KEY` | no | Defaults to Prompted's own public anon key (from their bundle — safe to embed) |
| `POSTRELAY_MEDIA_MAX_BYTES` | no | Per-file upload cap, default 3 MB |

## Deploying (all free tiers)

1. **Vercel** — import the repo, set the four env vars above, deploy.
2. **Upstash** — create a free Redis database, copy the REST URL/token into Vercel env vars.
3. **cron-job.org** — create a free job:
   - URL: `https://<your-app>.vercel.app/api/cron/tick?secret=<CRON_SECRET>`
   - Schedule: every 5 minutes
   - (Vercel Hobby's built-in cron caps at once/day, which is why the trigger lives outside Vercel.)

## How the pieces fit

```
Browser ── /api/session   connect (verify live → AES-256-GCM encrypt → Redis)
        ├─ /api/posts     compose, schedule, edit, cancel (exact time or drip slot)
        ├─ /api/batches   drip cadence rules: pause/resume/edit (re-spaces future slots)
        ├─ /api/activity  attempt log + stats + reconnect state
        ├─ /api/refs      cached categories / ai_tools / communities (daily sync)
        └─ /api/upload    media → Prompted's own Supabase storage at compose time

cron-job.org ── every 5 min ──> /api/cron/tick (secret-protected)
    1. daily reference-data sync from Prompted's PostgREST (piggybacked)
    2. find due posts → refresh token if within 10-min expiry buffer
       (Supabase rotates refresh tokens — both are re-encrypted each time)
    3. submit via Prompted's PostgREST API (their composer's own insert shape)
    4. log every attempt; retry ×3 with backoff (5 min, 10 min); auth failures
       flag "needs reconnect"; idempotency guards against double-fires
```

### Post submission (verified against Prompted's frontend bundle)

PostRelay replicates the exact REST pattern Prompted's own web app uses:

- single `POST /rest/v1/posts` insert with inline fields (`title`,
  `description`, `prompt` + `prompt_steps[{step_number,prompt_text}]`,
  `category_id`/`category_ids`, `demo_url`, `github_repo_url`, `ai_tool` +
  `tool_ids`, `images[]`, `videos[]`, `poll_options[]`, `forked_from_post_id`/
  `fork_type`, `difficulty`, `post_type`, `is_question`)
- `community_posts` rows for cross-posting
- `post_design_docs` upsert + `posts.design_doc_url` update for build docs
- media uploaded to their `post-images` / `post-videos` storage buckets
  (`{userId}/{timestamp}-{rand}.{ext}`, public URLs)

If Prompted ever changes a table shape, `src/lib/submit.ts` is the single file
to update. If a given post type's creation call ever proves impractical over
direct REST (e.g. Prompted adds server-side media processing to a type), the
documented fallback is a headless-browser submission via Browserless.io's free
tier — the architecture (queue → worker → external call) would stay identical,
only `submitPost` would change.

**Reference-data sync:** categories / `ai_tools` / `communities_with_stats`
are fetched daily with the connected user's Bearer token when available —
and, since those three tables are also readable with the public anon key
(verified), the sync falls back to the anon key when no session exists or it
needs reconnection, so the compose dropdowns never silently go stale.

## Security notes

- Session tokens are encrypted at rest (AES-256-GCM, key from env), decrypted
  only in-memory during refresh/post calls, never logged, and never returned by
  any API after the initial "Connected as @username" confirmation.
- The anon key embedded as a default is Prompted's own public Supabase key,
  extracted from their frontend bundle — Supabase designs anon keys for public
  exposure. User-scoped calls always run with the connected user's Bearer token,
  server-side only.

## Free-tier limits & trade-offs

- Media uploads go **browser → Prompted's Supabase storage directly** (the
  server issues a one-shot ticket), so Vercel's 4.5MB request cap isn't in the
  path — capped to Prompted's own composer limits (videos 100MB, images
  50MB — verified from their UI). Larger media: paste a hosted URL, which
  has no limit.
- The cron checks every 5 minutes; a post scheduled at 9:00 fires by 9:05 at
  the latest (usually on the 9:00 tick).
- Upstash free tier: 500k commands/month is comfortably more than a 5-minute
  cron + normal use generates.
- Not a PWA: responsive web only, no manifest or install prompts.
