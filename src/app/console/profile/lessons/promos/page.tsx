import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, mintConsoleTicket } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { PageHeader } from "@/components/RoadmapNote";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lesson promo codes" };

const OKS: Record<string, string> = { created: "Promo code created.", toggled: "Updated.", deleted: "Deleted." };
const ERRS: Record<string, string> = { auth: "Only admins can manage promo codes.", code: "Code must be 2–32 letters/numbers (no spaces).", value: "Enter a valid discount (1–100 for %, any $ amount).", dup: "That code already exists.", missing: "Not found." };

export default async function PromoCodesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isAdmin(session.roles ?? [session.role])) redirect("/console/profile/lessons");
  const ticket = await mintConsoleTicket();

  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <div className="space-y-6">
      <PageHeader title="Lesson promo codes" subtitle="Discount codes players can enter on the lesson booking page — a percentage or flat amount off their first lesson." />
      <div className="flex flex-wrap gap-2 text-sm"><Link href="/console/profile/lessons" className="btn-ghost">← Lesson setup &amp; pricing</Link></div>

      {sp.ok && OKS[sp.ok] && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{OKS[sp.ok]}</p>}
      {sp.err && ERRS[sp.err] && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRS[sp.err]}</p>}

      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Codes ({promos.length})</h2>
        {promos.length === 0 ? (
          <p className="text-sm text-slate-400">No promo codes yet. Add one below.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-1.5 pr-3">Code</th><th className="py-1.5 pr-3">Discount</th><th className="py-1.5 pr-3">Rules</th><th className="py-1.5 pr-3">Used</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5"></th>
              </tr></thead>
              <tbody>
                {promos.map((p) => {
                  const expired = p.expiresAt && p.expiresAt < new Date();
                  const capped = p.maxRedemptions != null && p.timesRedeemed >= p.maxRedemptions;
                  return (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3 font-mono font-semibold text-slate-800">{p.code}</td>
                      <td className="py-1.5 pr-3">{p.kind === "PERCENT" ? `${p.value}%` : formatCents(p.value)} off</td>
                      <td className="py-1.5 pr-3 text-xs text-slate-500">
                        {[p.minAmountCents ? `min ${formatCents(p.minAmountCents)}` : null, p.maxRedemptions != null ? `max ${p.maxRedemptions}` : null, p.expiresAt ? `exp ${formatDate(p.expiresAt)}` : null].filter(Boolean).join(" · ") || "—"}
                        {p.note ? <span className="block text-slate-400">{p.note}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">{p.timesRedeemed}{p.maxRedemptions != null ? `/${p.maxRedemptions}` : ""}</td>
                      <td className="py-1.5 pr-3">
                        {!p.active ? <span className="text-slate-400">off</span> : expired ? <span className="text-rose-600">expired</span> : capped ? <span className="text-rose-600">used up</span> : <span className="text-emerald-700">active</span>}
                      </td>
                      <td className="py-1.5">
                        <div className="flex gap-2">
                          <form method="POST" action="/api/console/promo-codes"><input type="hidden" name="ticket" value={ticket} /><input type="hidden" name="op" value="toggle" /><input type="hidden" name="id" value={p.id} /><button className="btn-chip-muted">{p.active ? "Disable" : "Enable"}</button></form>
                          <form method="POST" action="/api/console/promo-codes"><input type="hidden" name="ticket" value={ticket} /><input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={p.id} /><button className="btn-chip-danger">Delete</button></form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <details>
          <summary className="btn-primary inline-flex cursor-pointer list-none [&::-webkit-details-marker]:hidden">+ Add a promo code</summary>
          <form method="POST" action="/api/console/promo-codes" className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-6">
            <input type="hidden" name="ticket" value={ticket} />
            <div className="sm:col-span-2"><label className="label">Code</label><input name="code" required placeholder="WELCOME10" className="input py-1 uppercase" /></div>
            <div className="sm:col-span-2"><label className="label">Type</label><select name="kind" className="input py-1"><option value="PERCENT">Percent off</option><option value="AMOUNT">Dollar amount off</option></select></div>
            <div className="sm:col-span-2"><label className="label">Value</label><input name="value" type="number" min={1} step="0.01" required placeholder="10" className="input py-1" /><p className="mt-0.5 text-[11px] text-slate-400">% (1–100) or $ amount</p></div>
            <div className="sm:col-span-2"><label className="label">Min order ($, optional)</label><input name="minAmount" type="number" min={0} step="0.01" className="input py-1" /></div>
            <div className="sm:col-span-2"><label className="label">Max redemptions (optional)</label><input name="maxRedemptions" type="number" min={1} className="input py-1" /></div>
            <div className="sm:col-span-2"><label className="label">Expires (optional)</label><input name="expiresAt" type="date" className="input py-1" /></div>
            <div className="sm:col-span-6"><label className="label">Note (optional)</label><input name="note" placeholder="e.g. Fall new-player promo" className="input py-1" /></div>
            <div className="sm:col-span-6"><button className="btn-primary py-1 text-sm">Create code</button></div>
          </form>
        </details>
      </div>
    </div>
  );
}
