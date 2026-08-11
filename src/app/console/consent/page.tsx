import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime12 } from "@/lib/time";
import { CONSENT_VERSION } from "@/lib/consent";

// Auditable messaging-consent log — the defensible record of who opted in to
// email/SMS, when, in what language, and from where. This is what we show a
// carrier or Twilio if opt-in is ever questioned (TCPA / A2P 10DLC).
export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  "opt-in-form": "Opt-in form",
  registration: "Registration",
};

export default async function ConsentLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const channel = sp.channel === "email" || sp.channel === "sms" ? sp.channel : null;
  const source = sp.source && sp.source !== "all" ? sp.source : null;

  const where = {
    ...(channel === "email" ? { emailOptIn: true } : {}),
    ...(channel === "sms" ? { smsOptIn: true } : {}),
    ...(source ? { source } : {}),
  };

  const [total, emailCount, smsCount, bothCount, records] = await Promise.all([
    prisma.messagingConsent.count(),
    prisma.messagingConsent.count({ where: { emailOptIn: true } }),
    prisma.messagingConsent.count({ where: { smsOptIn: true } }),
    prisma.messagingConsent.count({ where: { emailOptIn: true, smsOptIn: true } }),
    prisma.messagingConsent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Consent log</h1>
          <p className="text-slate-500">
            Express email / SMS opt-ins. Proof of consent for TCPA &amp; Twilio A2P 10DLC — who, when,
            what language, and which channels.
          </p>
        </div>
        <a href="/console/consent/export" className="btn-secondary whitespace-nowrap">
          Export CSV
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total consent records" value={total} />
        <Metric label="Email opt-ins" value={emailCount} />
        <Metric label="SMS opt-ins" value={smsCount} />
        <Metric label="Both channels" value={bothCount} />
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">Filter:</span>
          <Chip href="/console/consent" active={!channel && !source} label="All" />
          <Chip href="/console/consent?channel=email" active={channel === "email"} label="Email" />
          <Chip href="/console/consent?channel=sms" active={channel === "sms"} label="SMS" />
          <span className="mx-1 text-slate-300">·</span>
          <Chip href="/console/consent?source=opt-in-form" active={source === "opt-in-form"} label="Opt-in form" />
          <Chip href="/console/consent?source=registration" active={source === "registration"} label="Registration" />
        </div>

        {records.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            No consent records yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Phone</th>
                  <th className="py-2 pr-4">Channels</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Ver.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {records.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{formatDateTime12(r.createdAt)}</td>
                    <td className="py-2 pr-4 font-medium text-slate-700">
                      {r.personId ? (
                        <Link href={`/console/people/${r.personId}`} className="hover:text-brand-700 hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-500">{r.email ?? "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{r.phone ?? "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-4">
                      {r.emailOptIn && <span className="badge bg-sky-100 text-sky-800">email</span>}{" "}
                      {r.smsOptIn && <span className="badge bg-violet-100 text-violet-800">sms</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-500">{SOURCE_LABEL[r.source] ?? r.source}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-slate-400">{r.consentVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {records.length >= 500 && (
          <p className="mt-3 text-xs text-slate-400">
            Showing the 500 most recent records. Export CSV for the full log.
          </p>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Current consent language version: <span className="font-mono">{CONSENT_VERSION}</span>. Every
        record stores the exact language shown, plus IP address and user agent, in the CSV export.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-extrabold text-brand-700">{value}</div>
    </div>
  );
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 ${
        active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </Link>
  );
}
