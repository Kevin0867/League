import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  // Auth is already enforced by the console layout (requireStaff). Only refine
  // the role here — and never redirect to /login from the page, to avoid the
  // double-auth bounce on the deployed runtime.
  const session = await getSession();
  if (session && session.role !== "COO" && session.role !== "DIRECTOR") redirect("/console");

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
      <ImportForm />
    </div>
  );
}
