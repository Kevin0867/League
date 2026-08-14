import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";

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
          Brings the database up to date with the latest features (needed once after a new feature ships). Safe
          to run more than once — it only adds what&apos;s missing. If a team page or the apparel setup is showing a
          server error, run this.
        </p>
        <form method="POST" action="/api/console/db-repair" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-primary text-sm">Apply database updates</button>
        </form>
      </div>
    </div>
  );
}
