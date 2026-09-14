import { requireStaff } from "@/lib/rbac";
import { mintConsoleTicket } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { SearchableSelect } from "@/components/SearchableSelect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign a waiver" };

export default async function SignWaiverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireStaff();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();

  const season =
    (await prisma.season.findFirst({ where: { active: true, program: "PURE_ACADEMY" }, orderBy: { startDate: "desc" }, select: { id: true } })) ??
    (await prisma.season.findFirst({ where: { active: true }, orderBy: { startDate: "desc" }, select: { id: true } }));

  // The players who might still need a waiver — everyone registered this season.
  const regs = season
    ? await prisma.registration.findMany({
        where: { seasonId: season.id },
        select: { person: { select: { id: true, firstName: true, lastName: true, waiverSignedAt: true, guardianId: true, guardian: { select: { waiverSignedAt: true } } } } },
      })
    : [];

  const seen = new Set<string>();
  const players = [] as { id: string; name: string; signed: boolean }[];
  for (const r of regs) {
    const p = r.person;
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    const payerSigned = p.guardianId ? !!p.guardian?.waiverSignedAt : !!p.waiverSignedAt;
    players.push({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), signed: !!p.waiverSignedAt && payerSigned });
  }
  players.sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <PageHeader title="Sign a waiver" subtitle="Look up a player and hand them your phone to read and sign the participation waiver in person." />

      {sp.err && (
        <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {sp.err === "fields" ? "Pick a player first." : sp.err === "notfound" ? "That player wasn't found." : "Something went wrong."}
        </div>
      )}

      <form method="POST" action="/api/console/waiver-link" className="card space-y-3">
        <input type="hidden" name="ticket" value={ticket} />
        <div>
          <label className="label">Player</label>
          <SearchableSelect
            name="personId"
            required
            placeholder="Search for a player by name…"
            options={players.map((p) => ({ id: p.id, name: p.name, hint: p.signed ? "waiver on file" : "needs waiver" }))}
          />
          <p className="mt-1 text-xs text-slate-500">
            {players.length} player{players.length === 1 ? "" : "s"} this season. For a minor, the waiver opens for their parent/guardian to sign.
          </p>
        </div>
        <button type="submit" className="btn-primary w-full sm:w-auto">Open waiver to sign</button>
      </form>

      <div className="card text-sm text-slate-600">
        <p className="font-semibold text-slate-800">How it works</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>Search for the player and tap <span className="font-medium">Open waiver to sign</span>.</li>
          <li>Hand your phone to the player (or their parent/guardian for a minor).</li>
          <li>They read the waiver, check the box, type their full legal name, and tap <span className="font-medium">Sign waiver</span>.</li>
          <li>You&apos;ll see a &ldquo;Waiver signed&rdquo; confirmation — then head back here for the next one.</li>
        </ol>
      </div>
    </div>
  );
}
