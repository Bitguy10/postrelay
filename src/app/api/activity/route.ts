import { NextRequest, NextResponse } from "next/server";
import { getActivity, getPosts } from "@/lib/data";
import { currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) {
    return NextResponse.json(
      { entries: [], stats: { posted: 0, failed: 0, retrying: 0, successRate: 100 }, needsReconnect: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const [entries, posts] = await Promise.all([
    getActivity(user.id),
    getPosts(user.id),
  ]);
  const session = user;

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
