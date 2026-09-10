import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/notify";

// Submit a digital Incident Report → email it to the confidential team inbox,
// then 303-redirect back to an empty form so it's reset for the next one.
// Ticket-authenticated like the other console mutations; staff only.
export const dynamic = "force-dynamic";

const TEAM_INBOX = process.env.TEAM_INBOX_EMAIL ?? "team@purepickleball.com";

// Field groups for a readable email, in the order they appear on the form.
const SECTIONS: { title: string; fields: [string, string][] }[] = [
  { title: "1. Basic incident information", fields: [["incidentDate", "Date"], ["incidentTime", "Time"], ["location", "Location / court"], ["program", "Program / class"], ["coachName", "Coach completing report"], ["coachPhone", "Coach phone"]] },
  { title: "2. Person(s) involved", fields: [["participantName", "Participant"], ["participantAge", "Age"], ["parentGuardian", "Parent / guardian"], ["parentPhone", "Phone"], ["otherPerson", "Other person"], ["otherRole", "Role"], ["emergencyContactCalled", "Emergency contact called"], ["timeContacted", "Time contacted"]] },
  { title: "5. Injury / medical response", fields: [["bodyArea", "Body area / condition"], ["visibleInjury", "Visible injury"], ["firstAidProvided", "First aid provided"], ["firstAidBy", "By whom"], ["called911", "911 called"], ["called911Time", "911 time"], ["emsResponded", "EMS / Fire responded"], ["transported", "Transported"], ["medicationUsed", "Medication used"], ["parentNotifiedMedical", "Parent notified"]] },
  { title: "6. Supervision / pickup details", fields: [["scheduledStartEnd", "Scheduled start / end"], ["actualArrivalPickup", "Actual arrival / pickup"], ["approvedPickup", "Approved pickup person"], ["codeIdVerified", "Code / ID verified"], ["parentContactAttempts", "Parent contact attempts"], ["staffEscalatedTo", "Staff escalated to"], ["participantReleasedTo", "Participant released to"], ["timeReleased", "Time released"]] },
  { title: "7. Witnesses", fields: [["w1Name", "Witness 1"], ["w1Rel", "  role"], ["w1Contact", "  contact"], ["w2Name", "Witness 2"], ["w2Rel", "  role"], ["w2Contact", "  contact"]] },
  { title: "9. Coach certification", fields: [["coachPrintedName", "Coach printed name"], ["coachSignature", "Signature"], ["certDate", "Date"]] },
];

const TYPE_FLAGS: [string, string][] = [
  ["type_injury", "Injury / Illness"], ["type_behavioral", "Behavioral / Conflict"], ["type_earlylate", "Early Arrival / Late Pickup"],
  ["type_unauthorized", "Unauthorized Pickup / Release"], ["type_facility", "Facility / Equipment"], ["type_safesport", "SafeSport / Boundary Concern"],
  ["type_missing", "Missing / Unaccounted"], ["type_other", "Other"],
];
const ACTION_FLAGS: [string, string][] = [
  ["act_parentNotified", "Parent/guardian notified"], ["act_directorNotified", "Program Director / Manager notified"], ["act_firstAid", "First aid / EMS provided"],
  ["act_removed", "Participant removed from activity"], ["act_equipmentOOS", "Equipment/court taken out of service"], ["act_safesportInitiated", "SafeSport / misconduct report initiated"],
];

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const fd = await req.formData();
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/incident-report${qs}`, origin), 303);

  const actor = await actorFromForm(fd);
  if (!actor) return back("?err=auth");

  const g = (k: string) => String(fd.get(k) ?? "").trim();
  // Minimum: an incident date and a description, so an empty form isn't emailed.
  if (!g("incidentDate") || !g("description")) return back("?err=fields");

  const types = TYPE_FLAGS.filter(([k]) => g(k) === "1").map(([, l]) => l);
  if (g("typeOther")) types.push(`Other: ${g("typeOther")}`);
  const typeBlock = ["3. Type of incident", types.length ? "  " + types.join(", ") : "  (none checked)", ""];
  const descBlock = ["4. Description of what happened", ...g("description").split("\n").map((l) => `  ${l}`), ""];
  const actions = ACTION_FLAGS.filter(([k]) => g(k) === "1").map(([, l]) => l);
  const actionBlock = ["8. Actions taken / immediate follow-up", actions.length ? "  " + actions.join(", ") : "  (none checked)", ...(g("additionalActions") ? ["  Additional: " + g("additionalActions")] : []), ""];

  // Uploaded photos/video (already on Blob) — parsed from the form's JSON field.
  type Attach = { url: string; type: string; name: string };
  let attachments: Attach[] = [];
  try {
    const parsed = JSON.parse(g("attachments") || "[]");
    if (Array.isArray(parsed)) attachments = parsed.filter((a) => a && typeof a.url === "string");
  } catch { /* ignore malformed */ }
  const photoBlock = attachments.length
    ? ["9. Photos / video", ...attachments.map((a) => `  ${a.type === "VIDEO" ? "Video" : "Photo"}: ${a.url}`), ""]
    : [];

  // Assemble in the form's section order.
  const body = [
    "PURE INCIDENT REPORT — CONFIDENTIAL",
    "Submitted via the coach console. Program Director / owners only.",
    "",
    ...sectionText("1. Basic incident information", SECTIONS[0], g),
    ...sectionText("2. Person(s) involved", SECTIONS[1], g),
    ...typeBlock,
    ...descBlock,
    ...sectionText("5. Injury / medical response", SECTIONS[2], g),
    ...sectionText("6. Supervision / pickup details", SECTIONS[3], g),
    ...sectionText("7. Witnesses", SECTIONS[4], g),
    ...actionBlock,
    ...photoBlock,
    ...sectionText("10. Coach certification", SECTIONS[5], g),
    `Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" })} (Phoenix)`,
  ].join("\n");

  const who = g("coachName") || "A coach";
  const subj = `Incident Report — ${g("incidentDate")}${g("participantName") ? ` · ${g("participantName")}` : ""} (${who})`;

  // HTML mirror: the full report (monospace) plus the photos embedded inline and
  // videos as watch links, so the office sees the media right in the email.
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string));
  const mediaHtml = attachments.length
    ? `<h3 style="font-family:Arial,sans-serif;color:#0f172a;margin:20px 0 8px">Photos / video (${attachments.length})</h3>` +
      attachments
        .map((a) =>
          a.type === "VIDEO"
            ? `<p style="margin:6px 0"><a href="${esc(a.url)}" style="display:inline-block;background:#059669;color:#fff;font-weight:700;text-decoration:none;padding:10px 16px;border-radius:8px">▶ Watch video${a.name ? ` — ${esc(a.name)}` : ""}</a></p>`
            : `<p style="margin:6px 0"><a href="${esc(a.url)}"><img src="${esc(a.url)}" alt="${esc(a.name || "photo")}" style="max-width:100%;border-radius:8px" /></a></p>`
        )
        .join("")
    : "";
  const html = `<pre style="font-family:Menlo,Consolas,monospace;white-space:pre-wrap;font-size:13px;color:#0f172a">${esc(body)}</pre>${mediaHtml}`;

  try {
    // Confidential: ONLY the team inbox — never the parent/player/coach, and no
    // org-wide BCC copy. Nothing is stored in the app or shown back to the coach.
    const res = await sendEmail(TEAM_INBOX, subj, body, html, undefined, { skipBcc: true });
    await audit({
      actorId: actor.userId, entityType: "IncidentReport", entityId: "submit", action: "SUBMITTED",
      summary: `Incident report emailed to ${TEAM_INBOX} — ${g("incidentDate")}${g("participantName") ? ` · ${g("participantName")}` : ""} by ${who}${attachments.length ? ` · ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}${res.simulated ? " (email simulated — provider off)" : ""}`,
    });
    return back("?ok=1");
  } catch (e) {
    console.error("incident report submit failed", e);
    return back("?err=send");
  }
}

function sectionText(title: string, sec: { fields: [string, string][] }, g: (k: string) => string): string[] {
  const rows = sec.fields.map(([k, label]) => (g(k) ? `  ${label}: ${g(k)}` : "")).filter(Boolean);
  return rows.length ? [title, ...rows, ""] : [];
}
