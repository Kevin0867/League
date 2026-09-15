import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { unreadInboxCount, unreadBroadcastCount } from "@/lib/domain/inbox";

// Current unread counts for the signed-in person — polled by the in-app poller
// so the unread banner/badge updates when a new message arrives, without a
// manual reload. Read-only, no-store.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const personId = session?.personId ?? null;
  const [dm, broadcast] = await Promise.all([
    unreadInboxCount(personId).catch(() => 0),
    unreadBroadcastCount(personId).catch(() => 0),
  ]);
  return NextResponse.json({ count: dm, broadcast }, { headers: { "Cache-Control": "no-store" } });
}
