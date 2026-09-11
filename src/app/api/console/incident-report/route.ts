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

  // HTML report: a clean, branded layout with per-section tables, incident-type
  // chips, a boxed description, embedded photos, and a styled signature.
  const esc = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch] as string));
  const FONT = "Arial,Helvetica,sans-serif";
  const heading = (title: string) =>
    `<div style="font:700 12px ${FONT};text-transform:uppercase;letter-spacing:.05em;color:#2c4670;border-bottom:1px solid #e2e8f0;padding-bottom:6px;margin:22px 0 10px">${esc(title)}</div>`;
  const rowsHtml = (fields: [string, string][]) =>
    fields
      .map(([k, label]) =>
        g(k)
          ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b;font:13px ${FONT};white-space:nowrap;vertical-align:top">${esc(label.trim())}</td><td style="padding:3px 0;color:#0f172a;font:13px ${FONT};line-height:1.5">${esc(g(k))}</td></tr>`
          : ""
      )
      .join("");
  const tableSection = (title: string, fields: [string, string][]) => {
    const r = rowsHtml(fields);
    return r ? heading(title) + `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${r}</table>` : "";
  };
  const chips = (items: string[], bg: string, fg: string) =>
    items.length
      ? `<div>${items.map((t) => `<span style="display:inline-block;background:${bg};color:${fg};font:600 12px ${FONT};padding:4px 10px;border-radius:999px;margin:0 6px 6px 0">${esc(t)}</span>`).join("")}</div>`
      : `<div style="color:#94a3b8;font:13px ${FONT}">(none noted)</div>`;

  const typeHtml = heading("3. Type of incident") + chips(types, "#fee2e2", "#991b1b");
  const descHtml =
    heading("4. Description of what happened") +
    `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;color:#0f172a;font:14px ${FONT};line-height:1.55;white-space:pre-wrap">${esc(g("description"))}</div>`;
  const actionsHtml =
    heading("8. Actions taken / immediate follow-up") +
    chips(actions, "#dbeafe", "#1e40af") +
    (g("additionalActions") ? `<div style="margin-top:6px;color:#0f172a;font:13px ${FONT}">Additional: ${esc(g("additionalActions"))}</div>` : "");
  const mediaHtml = attachments.length
    ? heading(`9. Photos / video (${attachments.length})`) +
      attachments
        .map((a) =>
          a.type === "VIDEO"
            ? `<p style="margin:6px 0"><a href="${esc(a.url)}" style="display:inline-block;background:#059669;color:#fff;font:700 14px ${FONT};text-decoration:none;padding:10px 16px;border-radius:8px">▶ Watch video${a.name ? ` — ${esc(a.name)}` : ""}</a></p>`
            : `<p style="margin:8px 0"><a href="${esc(a.url)}"><img src="${esc(a.url)}" alt="${esc(a.name || "photo")}" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0" /></a></p>`
        )
        .join("")
    : "";
  const certHtml =
    heading("10. Coach certification") +
    `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">` +
    (g("coachPrintedName") ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b;font:13px ${FONT};white-space:nowrap">Printed name</td><td style="padding:3px 0;color:#0f172a;font:13px ${FONT}">${esc(g("coachPrintedName"))}</td></tr>` : "") +
    (g("coachSignature") ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b;font:13px ${FONT};white-space:nowrap">Signature</td><td style="padding:3px 0"><span style="font:italic 22px Georgia,'Times New Roman',serif;color:#0f172a">${esc(g("coachSignature"))}</span></td></tr>` : "") +
    (g("certDate") ? `<tr><td style="padding:3px 14px 3px 0;color:#64748b;font:13px ${FONT};white-space:nowrap">Date</td><td style="padding:3px 0;color:#0f172a;font:13px ${FONT}">${esc(g("certDate"))}</td></tr>` : "") +
    `</table>`;

  const submittedAt = new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" });
  const html =
    `<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">` +
    `<div style="background:#2c4670;padding:18px 22px">` +
    `<table cellpadding="0" cellspacing="0" style="width:100%"><tr>` +
    `<td style="font:800 18px ${FONT};color:#ffffff">PURE Incident Report</td>` +
    `<td align="right"><span style="background:#dc2626;color:#ffffff;font:700 11px ${FONT};letter-spacing:.06em;padding:4px 10px;border-radius:999px">CONFIDENTIAL</span></td>` +
    `</tr></table>` +
    `<div style="color:#c7d2e5;font:13px ${FONT};margin-top:6px">Submitted via the coach console · Program Director / owners only</div>` +
    `</div>` +
    `<div style="padding:8px 22px 22px">` +
    tableSection("1. Basic incident information", SECTIONS[0].fields) +
    tableSection("2. Person(s) involved", SECTIONS[1].fields) +
    typeHtml +
    descHtml +
    tableSection("5. Injury / medical response", SECTIONS[2].fields) +
    tableSection("6. Supervision / pickup details", SECTIONS[3].fields) +
    tableSection("7. Witnesses", SECTIONS[4].fields) +
    actionsHtml +
    mediaHtml +
    certHtml +
    `<div style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:10px;color:#94a3b8;font:12px ${FONT}">Submitted ${esc(submittedAt)} (Phoenix) · Confidential — do not forward.</div>` +
    `</div></div>`;

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
