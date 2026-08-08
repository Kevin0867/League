import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const facilities = await prisma.facility.findMany({ orderBy: [{ market: "asc" }, { name: "asc" }] });

  // Group by market. Private courts are generalized to market + general area only —
  // never owner name, never street address (§15, a contractual privacy obligation).
  const byMarket = new Map<string, { label: string; sub: string; private: boolean }[]>();
  for (const f of facilities) {
    const market = f.market ?? "Other";
    const label = f.isPrivate ? `${f.generalArea ?? market} — private court` : f.name;
    const sub = f.isPrivate
      ? "Exact location shared with assigned players after login."
      : `${f.courtCount} court${f.courtCount === 1 ? "" : "s"}`;
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market)!.push({ label, sub, private: f.isPrivate });
  }

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Locations</h1>
        <p className="mt-2 text-slate-600">
          We play across the Valley. Private residences and single-site courts are shown by
          general area only — the exact location is released to assigned players behind login.
        </p>

        <div className="mt-8 space-y-8">
          {[...byMarket.entries()].map(([market, items]) => (
            <section key={market}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{market}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((it, i) => (
                  <div key={i} className="card">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{it.label}</span>
                      {it.private && <span className="badge bg-amber-100 text-amber-800">private</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{it.sub}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {byMarket.size === 0 && <p className="text-slate-500">Locations to be announced.</p>}
        </div>
      </div>
    </div>
  );
}
