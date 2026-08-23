import { NextRequest, NextResponse } from "next/server";
import { getSessionRecord } from "@/lib/data";
import { getFreshAccessToken } from "@/lib/session";
import { uploadToBucket } from "@/lib/prompted";

export const dynamic = "force-dynamic";

// Media upload at COMPOSE time (not fire time): bytes go straight from the
// browser through this route into Prompted's own Supabase storage buckets,
// so queues in Redis only ever hold URLs. Bytes are capped small — this is a
// free-tier tool, not a CDN.

const MAX_BYTES = parseInt(process.env.CADENCE_MEDIA_MAX_BYTES || `${3 * 1024 * 1024}`, 10);

const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

export async function POST(req: NextRequest) {
  let b: { name?: string; mime?: string; dataUrl?: string };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!b.dataUrl || !b.name) {
    return NextResponse.json({ error: "name and dataUrl are required" }, { status: 400 });
  }

  const match = b.dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) {
    return NextResponse.json({ error: "dataUrl must be a base64 data URL" }, { status: 400 });
  }
  const mime = b.mime || match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${(bytes.length / 1048576).toFixed(1)}MB — cap is ${(
          MAX_BYTES / 1048576
        ).toFixed(0)}MB on the free tier. Try a smaller export or paste a URL instead.`,
      },
      { status: 413 },
    );
  }

  const record = await getSessionRecord();
  if (!record || record.needsReconnect) {
    return NextResponse.json(
      { error: "Connect your Prompted account before uploading media" },
      { status: 401 },
    );
  }
  const token = await getFreshAccessToken();
  if (!token.ok || !token.accessToken) {
    return NextResponse.json({ error: token.error }, { status: 401 });
  }

  const bucket: "post-images" | "post-videos" =
    mime.startsWith("video/") || VIDEO_EXT.test(b.name) ? "post-videos" : "post-images";

  try {
    const { path, publicUrl } = await uploadToBucket(
      token.accessToken,
      bucket,
      record.user.id,
      b.name,
      mime,
      bytes,
    );
    return NextResponse.json({
      media: {
        kind: bucket === "post-videos" ? "video" : "image",
        name: b.name,
        mime,
        url: publicUrl,
        path,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 502 },
    );
  }
}
