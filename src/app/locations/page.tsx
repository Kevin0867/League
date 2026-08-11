import Link from "next/link";
import { PublicNav } from "@/components/PublicNav";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const facilities = await prisma.facility.findMany({ where: { archived: false }, orderBy: [{ market: "asc" }, { name: "asc" }] });

  // Group by market. Private courts are generalized to market + general area only —
  // never owner name, never street address (§15, a contractual privacy obligation).
  const byMarket = new Map<string, { id: string; label: string; sub: string; private: boolean }[]>();
  for (const f of facilities) {
    const market = f.market ?? "Other";
    const label = f.isPrivate ? `${f.generalArea ?? market} — private court` : f.name;
    const sub = f.isPrivate
      ? "Exact location shared with assigned players after login."
      : `${f.courtCount} court${f.courtCount === 1 ? "" : "s"}`;
    if (!byMarket.has(market)) byMarket.set(market, []);
    byMarket.get(market)!.push({ id: f.id, label, sub, private: f.isPrivate });
  }

  return (
    <div>
      <PublicNav />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="display text-3xl text-brand-900 sm:text-4xl">Locations</h1>
        <p className="mt-2 text-slate-600">
          We play across the Valley. Pick a location to start your registration — private residences and
          single-site courts are shown by general area only, with the exact site released to assigned
          players behind login.
        </p>

        <div className="mt-8 space-y-8">
          {[...byMarket.entries()].map(([market, items]) => (
            <section key={market}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{market}</h2>
                {market !== "Other" && (
                  <Link href={`/register?location=${encodeURIComponent(market)}`} className="text-xs font-semibold text-brand-600 hover:underline">
                    Register in {market} →
                  </Link>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((it) => (
                  <Link
                    key={it.id}
                    href={`/register?facility=${encodeURIComponent(it.id)}`}
                    className="group card flex flex-col transition-colors hover:border-brand-300 hover:ring-brand-200"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 group-hover:text-brand-800">{it.label}</span>
                      {it.private && <span className="badge bg-amber-100 text-amber-800">private</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{it.sub}</p>
                    <span className="mt-2 text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                      Register to play here →
                    </span>
                  </Link>
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
