import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/rbac";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireStaff();
  if (!["COO", "DIRECTOR"].includes(session.role)) redirect("/console");

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
