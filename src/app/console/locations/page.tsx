import { requireStaff } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/RoadmapNote";
import { formatTime12 } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Locations" };

const DAY_LABEL: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
const TYPE_LABEL: Record<string, string> = {
  COMMERCIAL: "Commercial club", SCHOOL: "School", PARK: "Public park", PRIVATE_RESIDENCE: "Private residence", OTHER: "Other",
};

// Read-only facilities directory for coaches (and admins): where each location
// is, how to get in, and who to contact. Admins manage facilities on the
// Facilities page; this view is purely for reference.
export default async function LocationsPage() {
  await requireStaff();
  const facilities = await prisma.facility.findMany({
    where: { archived: false },
    select: {
      id: true, name: true, facilityType: true, market: true, isPrivate: true,
      generalArea: true, exactAddress: true, crossStreets: true, lights: true, notes: true, photos: true,
      primaryContact: true, contactEmail: true, contactPhone: true,
      courtBlocks: { where: { kind: "AVAILABLE" }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
    },
    orderBy: [{ market: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Locations" subtitle="Every venue, with directions and contact info. Tap an address for directions, an email or phone to reach the site contact." />

      {facilities.length === 0 ? (
        <div className="card text-sm text-slate-400">No locations yet.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {facilities.map((f) => {
            const address = f.exactAddress || null;
            const publicWhere = [f.crossStreets, f.generalArea].filter(Boolean).join(" · ") || null;
            const mapQuery = address || f.crossStreets || f.name;
            const photos = Array.isArray(f.photos) ? (f.photos as unknown as { url: string; type: string; name?: string }[]) : [];
            return (
              <div key={f.id} className="card space-y-3">
                <div>
                  <h2 className="font-bold text-slate-900">{f.name}</h2>
                  <p className="text-xs text-slate-400">
                    {[TYPE_LABEL[f.facilityType ?? ""] ?? null, f.market].filter(Boolean).join(" · ")}
                    {f.isPrivate ? " · Private home" : ""}
                  </p>
                </div>

                <dl className="space-y-1.5 text-sm">
                  {address && (
                    <Row label="Address">
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery!)}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{address}</a>
                    </Row>
                  )}
                  {f.crossStreets && <Row label="Cross streets">{f.crossStreets}</Row>}
                  {!address && publicWhere && <Row label="Area">{publicWhere}</Row>}
                  {(f.primaryContact || f.contactEmail || f.contactPhone) && (
                    <Row label="Contact">
                      <div className="space-y-0.5">
                        {f.primaryContact && <div className="text-slate-700">{f.primaryContact}</div>}
                        {f.contactPhone && <div><a href={`tel:${f.contactPhone.replace(/[^0-9+]/g, "")}`} className="text-brand-700 hover:underline">{f.contactPhone}</a></div>}
                        {f.contactEmail && <div><a href={`mailto:${f.contactEmail}`} className="text-brand-700 hover:underline">{f.contactEmail}</a></div>}
                      </div>
                    </Row>
                  )}
                  {f.lights && <Row label="Lights">{f.lights === "LIGHTS" ? "Has lights (evening play OK)" : "No lights (daylight only)"}</Row>}
                  {f.courtBlocks.length > 0 && (
                    <Row label="Open times">
                      <div className="flex flex-wrap gap-1">
                        {f.courtBlocks.map((b) => (
                          <span key={b.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            {DAY_LABEL[b.dayOfWeek] ?? b.dayOfWeek} {formatTime12(b.startTime)}–{formatTime12(b.endTime)}
                          </span>
                        ))}
                      </div>
                    </Row>
                  )}
                </dl>

                {f.notes && (
                  <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="font-medium text-slate-500">Notes &amp; access: </span>{f.notes}
                  </p>
                )}

                {photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {photos.map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg ring-1 ring-slate-200" title={p.name || "Open"}>
                        {p.type === "VIDEO" ? (
                          <video src={p.url} className="h-20 w-full object-cover" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.url} alt={p.name || "Location photo"} className="h-20 w-full object-cover" />
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:flex sm:gap-2">
      <dt className="shrink-0 font-semibold text-slate-500 sm:w-28">{label}</dt>
      <dd className="text-slate-700">{children}</dd>
    </div>
  );
}
