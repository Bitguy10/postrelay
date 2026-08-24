import { NextRequest } from "next/server";
import { getDeviceUser, getUserRecord } from "./data";
import { UserRecord } from "./types";

// Request-scoped identity: each browser holds a random deviceId in
// localStorage and sends it as the x-postrelay-device header on every API
// call. The device hash maps it to exactly one connected Prompted account,
// and all data access is scoped to that account.

export const DEVICE_HEADER = "x-postrelay-device";

/** Resolve the account making this request, or null if the device has none. */
export async function currentUser(req: NextRequest): Promise<UserRecord | null> {
  const deviceId = req.headers.get(DEVICE_HEADER);
  if (!deviceId) return null;
  const userId = await getDeviceUser(deviceId);
  if (!userId) return null;
  return getUserRecord(userId);
}
