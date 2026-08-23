import { NextResponse } from "next/server";
import { getRefs } from "@/lib/data";
import { syncRefs } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Cached categories / tools / communities for the compose screen. The compose
 * UI reads only from this cache — the browser never calls Prompted directly,
 * so the anon key and user token stay server-side.
 */
export async function GET() {
  let refs = await getRefs();
  let source = "cache";
  if (!refs || refs.categories.length === 0) {
    const sync = await syncRefs(true);
    if (sync.synced) {
      refs = await getRefs();
      source = "live-sync";
    }
  }
  return NextResponse.json(
    {
      refs: refs ?? { categories: [], tools: [], communities: [], syncedAt: null },
      source,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
