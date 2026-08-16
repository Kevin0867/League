import { redirect } from "next/navigation";
import { getSession, signActionTicket } from "@/lib/auth";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "This import form expired — refresh the page (it re-authorizes automatically) and try again.",
  role: "Importing needs a COO or Director account.",
  file: "Choose a CSV file first.",
  empty: "No valid rows found. Is this the enrollment CSV export?",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center ring-1 ring-slate-200">
      <div className="text-2xl font-extrabold text-brand-900">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const canImport = !!session && ["ADMIN", "COO", "DIRECTOR"].includes(session.role);
  if (session && !canImport) redirect("/console");
  const sp = await searchParams;

  // Mint a short-lived ticket so the POST can be authorized from the body even
  // though the session cookie isn't delivered on POSTs to route handlers here.
  const ticket =
    canImport
      ? await signActionTicket(
          { userId: session.userId, role: session.role, scope: "console.import" },
          60 * 30
        )
      : "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import enrollments</h1>
        <p className="text-slate-500">
          Upload your enrollment CSV to load registrations in bulk. Each person is matched
          on name + email/phone and merged if they already exist, so re-running is safe.
          Divisions found in the file are created automatically under the active season.
        </p>
      </div>

      <ImportForm ticket={ticket} />

      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {ERRORS[sp.err] ?? "Something went wrong — please try again."}
        </p>
      )}

      {sp.preview === "1" && (
        <div className="card">
          <h3 className="font-semibold text-brand-900">Preview</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={sp.total ?? "0"} />
            <Stat label="Will import" value={sp.mapped ?? "0"} />
            <Stat label="Skipped" value={sp.skipped ?? "0"} />
            <Stat label="Youth (child)" value={sp.child ?? "0"} />
          </div>
          <p className="mt-4 text-sm text-slate-600">
            <span className="font-medium">{sp.divc} divisions</span> will be created if missing.
          </p>
          {sp.markets && (
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium">Locations:</span> {sp.markets}
            </p>
          )}
          <p className="mt-3 text-sm text-slate-500">
            Looks right? Click <span className="font-semibold">Import now</span> above.
          </p>
        </div>
      )}

      {sp.done === "1" && (
        <div className="card border-l-4 border-accent-500">
          <h3 className="font-semibold text-brand-900">Import complete</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Created" value={sp.created ?? "0"} />
            <Stat label="Duplicates merged" value={sp.dup ?? "0"} />
            <Stat label="Divisions added" value={sp.div ?? "0"} />
            <Stat label="Errors" value={sp.err ?? "0"} />
          </div>
          <p className="mt-4 text-sm text-slate-600">
            Imported into <span className="font-medium">{sp.season}</span>. Head to{" "}
            <a href="/console/registrations" className="text-brand-700 underline">Registrations</a> or{" "}
            <a href="/console/pools" className="text-brand-700 underline">Assignment</a> to start placing players.
          </p>
        </div>
      )}
    </div>
  );
}
