import { redirect } from "next/navigation";
import { getSession, signActionTicket } from "@/lib/auth";
import { PageHeader } from "@/components/RoadmapNote";
import { CoachImportForm } from "./CoachImportForm";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  auth: "This form expired — refresh the page (it re-authorizes automatically) and try again.",
  role: "Importing coaches needs an admin account.",
  file: "Choose a CSV file or paste the rows first.",
  empty: "No rows found. Make sure the first line is the column headings.",
};

export default async function CoachImportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const canImport = !!session && ["ADMIN", "COO", "DIRECTOR"].includes(session.role);
  if (session && !canImport) redirect("/console");
  const sp = await searchParams;

  const ticket = canImport
    ? await signActionTicket({ userId: session!.userId, role: session!.role, scope: "console.coachImport" }, 60 * 30)
    : "";

  return (
    <div className="space-y-6">
      <PageHeader title="Import coaches" subtitle="Load your coaches spreadsheet — contact, credentials, experience, weekly availability, and bio — straight into their coaching accounts." />

      {sp.err && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ERRORS[sp.err] ?? "Something went wrong — please try again."}</p>
      )}

      <CoachImportForm ticket={ticket} />

      <div className="card text-sm">
        <h2 className="font-semibold text-slate-900">What gets recorded</h2>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-slate-600 sm:grid-cols-2">
          <li><span className="font-medium">Full Name</span> → coach name</li>
          <li><span className="font-medium">Primary Email / Phone / Mailing Address</span> → contact</li>
          <li><span className="font-medium">Certification orgs + Additional Certifications</span> → credentials</li>
          <li><span className="font-medium">Coaching Preference + skill level</span> → coaching levels</li>
          <li><span className="font-medium">Years of experience + Bio</span> → bio</li>
          <li><span className="font-medium">Weekly Availability [Mon–Sun]</span> → day/time availability</li>
        </ul>
        <p className="mt-3 text-slate-500">
          Coaches are matched by email, so re-running updates rather than duplicating. You&apos;ll see a
          <span className="font-medium"> preview of exactly what was parsed</span> — including each day&apos;s times —
          before anything is saved. Availability times without a stated am/pm are assumed and flagged for you to check.
        </p>
      </div>
    </div>
  );
}
