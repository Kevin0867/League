import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";

// Full messaging-consent log as CSV — the exportable proof of opt-in for Twilio
// A2P 10DLC / carrier audits. Staff-only; includes the exact consent language,
// IP address, and user agent captured at opt-in time.
export const dynamic = "force-dynamic";

function csvCell(v: string | boolean | Date | null | undefined): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote and escape any cell — consent text contains commas and quotes.
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET() {
  await requireStaff();

  const records = await prisma.messagingConsent.findMany({
    orderBy: { createdAt: "desc" },
  });

  const header = [
    "createdAt",
    "name",
    "email",
    "phone",
    "emailOptIn",
    "smsOptIn",
    "source",
    "consentVersion",
    "ipAddress",
    "userAgent",
    "personId",
    "consentText",
  ];

  const rows = records.map((r) =>
    [
      r.createdAt,
      r.name,
      r.email,
      r.phone,
      r.emailOptIn,
      r.smsOptIn,
      r.source,
      r.consentVersion,
      r.ipAddress,
      r.userAgent,
      r.personId,
      r.consentText,
    ]
      .map(csvCell)
      .join(",")
  );

  const csv = [header.map(csvCell).join(","), ...rows].join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pure-messaging-consent-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
