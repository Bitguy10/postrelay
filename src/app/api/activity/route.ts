import { NextResponse } from "next/server";
import { getActivity, getPosts, getSessionRecord } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const [entries, posts, session] = await Promise.all([
    getActivity(),
    getPosts(),
    getSessionRecord(),
  ]);

  const posted = posts.filter((p) => p.status === "posted").length;
  const failed = posts.filter((p) => p.status === "failed").length;
  const retrying = posts.filter(
    (p) => p.attempts > 0 && (p.status === "queued" || p.status === "in_progress"),
  ).length;
  const attempted = posted + failed + retrying;

  return NextResponse.json(
    {
      entries,
      stats: {
        posted,
        failed,
        retrying,
        successRate: attempted === 0 ? 100 : Math.round((posted / attempted) * 100),
      },
      needsReconnect: session?.needsReconnect ?? false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
