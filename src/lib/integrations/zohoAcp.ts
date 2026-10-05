import "server-only";
import { prisma } from "@/lib/db";
import { pushContactToZoho } from "@/lib/integrations/zoho";

// Sync ACP entries to the same Zoho mailing list as season registrations: the
// team contact plus every roster player who gave an email. Idempotent via
// zohoSyncedAt markers (and Zoho upserts by email anyway), so re-runs are safe
// and never re-push what's already in. Dormant until Zoho is configured —
// pushContactToZoho then skips, leaving the markers unset so a later backfill
// picks them up.

function splitName(full: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const t = (full ?? "").trim();
  if (!t) return { firstName: null, lastName: null };
  const parts = t.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

/** Push one ACP entry's contact + roster players (with emails) to Zoho and stamp
 *  the ones that succeed. Best-effort; never throws. */
export async function syncAcpEntryToZoho(entryId: string): Promise<{ synced: number }> {
  const entry = await prisma.acpEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true, contactName: true, contactEmail: true, contactPhone: true, zohoSyncedAt: true,
      players: { select: { id: true, name: true, email: true, zohoSyncedAt: true } },
    },
  });
  if (!entry) return { synced: 0 };
  let synced = 0;

  if (entry.contactEmail && !entry.zohoSyncedAt) {
    const { firstName, lastName } = splitName(entry.contactName);
    const r = await pushContactToZoho({ email: entry.contactEmail, firstName, lastName, phone: entry.contactPhone }).catch(() => null);
    if (r && r.ok) {
      await prisma.acpEntry.update({ where: { id: entry.id }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
      synced++;
    }
  }

  for (const p of entry.players) {
    if (!p.email || p.zohoSyncedAt) continue;
    const { firstName, lastName } = splitName(p.name);
    const r = await pushContactToZoho({ email: p.email, firstName, lastName }).catch(() => null);
    if (r && r.ok) {
      await prisma.acpEntryPlayer.update({ where: { id: p.id }, data: { zohoSyncedAt: new Date() } }).catch(() => {});
      synced++;
    }
  }
  return { synced };
}

/** Backfill every ACP entry/player not yet synced to Zoho. */
export async function backfillAcpZoho(): Promise<{ entriesScanned: number; synced: number }> {
  const pending = await prisma.acpEntry.findMany({
    where: { OR: [{ zohoSyncedAt: null }, { players: { some: { zohoSyncedAt: null, email: { not: null } } } }] },
    select: { id: true },
    take: 500,
  });
  let synced = 0;
  for (const e of pending) synced += (await syncAcpEntryToZoho(e.id)).synced;
  return { entriesScanned: pending.length, synced };
}
