import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { isZohoConfigured } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";

// Deliberately does NO database queries beyond auth, so it still loads even when
// the schema is behind the code (which is exactly when you'd need it).
export default async function SystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const zohoOn = isZohoConfigured();

  return (
    <div className="space-y-6">
      <PageHeader title="System" subtitle="Maintenance actions for admins." />

      {sp.ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Database updates applied. The apparel setup, pay page, and team pages should work now.
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Couldn&apos;t apply updates: {sp.err}
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-slate-900">Apply database updates</h2>
        <p className="mt-1 text-sm text-slate-600">
          Database updates now apply automatically on every deploy, so you shouldn&apos;t normally need this. It stays
          here as a manual safety net: if a page ever shows a &ldquo;table/column does not exist&rdquo; server error,
          run this to bring the database up to date. Safe to run more than once — it only adds what&apos;s missing.
        </p>
        <form method="POST" action="/api/console/db-repair" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-primary text-sm">Apply database updates</button>
        </form>
      </div>

      {sp.bfok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Synced {sp.pushed ?? "0"} contact{sp.pushed === "1" ? "" : "s"} to Zoho
          {sp.failed && sp.failed !== "0" ? ` · ${sp.failed} failed` : ""}
          {sp.remaining && sp.remaining !== "0" ? ` · ${sp.remaining} still to go — run again to continue` : " · all caught up"}.
        </div>
      )}
      {sp.bferr === "notconfigured" && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Zoho isn&apos;t connected yet. Add the Zoho Campaigns credentials to the environment, then run the sync.
        </div>
      )}
      {sp.bferr === "auth" && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Not authorized to run the Zoho sync.
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Sync registrations to Zoho</h2>
          <span className={`badge ${zohoOn ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            {zohoOn ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          New registrations are pushed to your Zoho Campaigns list automatically — the account holder (the adult,
          or the parent for a minor) is added silently, with no confirmation email. Use this to backfill everyone
          who registered before the sync was turned on. It only sends contacts not already synced, so it&apos;s safe
          to run more than once — and it picks up anyone added by import since the last run.
        </p>
        <form method="POST" action="/api/console/zoho-backfill" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-secondary text-sm" disabled={!zohoOn}>Sync existing registrations</button>
        </form>
        {!zohoOn && (
          <p className="mt-2 text-xs text-slate-400">
            Set ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET, ZOHO_CAMPAIGNS_REFRESH_TOKEN, and
            ZOHO_CAMPAIGNS_LIST_KEY to connect.
          </p>
        )}
      </div>
    </div>
  );
}
