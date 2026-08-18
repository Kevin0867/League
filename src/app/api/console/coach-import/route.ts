import { NextResponse } from "next/server";
import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession, verifyActionTicket, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { previewCoachImport, runCoachImport, type CoachRecord } from "@/lib/domain/coachImport";

// Coach roster import — native multipart POST (the session cookie isn't
// delivered on POSTs here, so we authorize off a signed ticket in the body).
// Preview renders the parsed result as a self-contained page so the admin can
// verify the availability parsing, then commits by posting the CSV text back.
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f4;color:#14211b;margin:0;padding:32px 20px;}
  .wrap{max-width:900px;margin:0 auto;}
  .card{background:#fff;border:1px solid #dce4de;border-radius:16px;padding:24px;box-shadow:0 8px 28px -18px rgba(20,33,27,.28);margin-bottom:16px;}
  h1{font-size:22px;margin:0 0 6px;} h2{font-size:16px;margin:0 0 8px;} p{color:#4b5a54;font-size:14px;line-height:1.5;margin:6px 0;}
  table{width:100%;border-collapse:collapse;font-size:13px;} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #eef2f0;vertical-align:top;}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8aa39a;}
  .muted{color:#8aa39a;} .warn{color:#9a6b00;} .bad{color:#9f1239;} .ok{color:#0b7a53;font-weight:600;}
  code{background:#eef2f0;padding:1px 5px;border-radius:5px;font-size:12px;}
  .btn{display:inline-block;border:0;border-radius:10px;padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;}
  .btn-primary{background:#12694f;color:#fff;} .btn-ghost{background:#eef2f0;color:#14211b;margin-left:8px;}
  label.chk{display:flex;gap:8px;align-items:center;font-size:14px;color:#4b5a54;margin:12px 0;}
  a.back{display:inline-block;margin-top:14px;color:#12694f;font-weight:600;text-decoration:none;}
  .pill{display:inline-block;background:#eef2f0;border-radius:999px;padding:2px 8px;font-size:12px;margin:1px 2px;}
</style></head><body><div class="wrap">${body}<a class="back" href="/console/coach-import">← Back to import</a></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function availabilityHtml(rec: CoachRecord): string {
  if (rec.availability.length === 0) return `<span class="muted">—</span>`;
  return rec.availability
    .map((d) => {
      if (d.blocks.length === 0) return `<span class="pill bad" title="${esc(d.raw)}">${d.day.slice(0, 3)}: ?</span>`;
      const times = d.blocks.map((b) => `${b.start}–${b.end}`).join(", ");
      const cls = d.note ? "warn" : "";
      return `<span class="pill ${cls}" title="${esc(d.raw)}${d.note ? " · " + esc(d.note) : ""}">${d.day.slice(0, 3)}: ${times}${d.note ? " ⚠" : ""}</span>`;
    })
    .join(" ");
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/console/coach-import?${qs}`, origin), 303);

  const formData = await req.formData();
  const ticketStr = formData.get("ticket")?.toString();
  const ticket = await verifyActionTicket(ticketStr, "console.coachImport");
  const session = ticket ?? (await getSession());
  if (!session) return back("err=auth");
  if (!["ADMIN", "COO", "DIRECTOR"].includes(session.role)) return back("err=role");
  const actorId = "userId" in session ? session.userId : "";

  // Text comes from the uploaded file (first pass) or the hidden field (commit).
  const file = formData.get("file");
  let text = file instanceof File && file.size > 0 ? await file.text() : String(formData.get("text") ?? "");
  text = text.replace(/^﻿/, "");
  if (!text.trim()) return back("err=file");

  const createLogins = formData.get("createLogins") === "on";

  // ---- Preview ----
  if (formData.get("mode") !== "commit") {
    const pv = previewCoachImport(text);
    if (pv.total === 0) return back("err=empty");

    const rows = pv.records
      .map((r) => {
        const who = r.skipReason
          ? `<span class="bad">${esc(r.fullName || "(unnamed)")}<br><span style="font-size:11px">${esc(r.skipReason)}</span></span>`
          : `<strong>${esc(r.fullName)}</strong><br><span style="font-size:12px" class="${r.email ? "muted" : "warn"}">${r.email ? esc(r.email) : "no email — imports without a login"}</span>`;
        return `<tr>
          <td>${who}</td>
          <td>${esc(r.coachingLevels ?? "—")}</td>
          <td>${esc(r.certifications ?? "—")}</td>
          <td>${availabilityHtml(r)}</td>
        </tr>`;
      })
      .join("");

    const anyWarn = pv.records.some((r) => r.availability.some((d) => d.note));
    return page("Coach import — preview", `
      <div class="card">
        <h1>Review before importing</h1>
        <p><strong>${pv.total}</strong> rows · <strong class="ok">${pv.importable}</strong> will import · <strong>${pv.skipped}</strong> skipped.</p>
        ${anyWarn ? `<p class="warn">⚠ Some availability times were assumed (am/pm not stated). Hover a day to see the original text; fix the spreadsheet and re-import if any are wrong.</p>` : ""}
        <table>
          <thead><tr><th>Coach</th><th>Levels</th><th>Certifications</th><th>Weekly availability</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card">
        <form method="POST" action="/api/console/coach-import">
          <input type="hidden" name="ticket" value="${esc(ticketStr ?? "")}">
          <input type="hidden" name="mode" value="commit">
          <textarea name="text" style="display:none">${esc(text)}</textarea>
          <label class="chk"><input type="checkbox" name="createLogins" ${createLogins ? "checked" : ""}> Also create a login for each coach (they can be invited to set a password later from the Coaches page)</label>
          <button class="btn btn-primary" type="submit">Import ${pv.importable} coach${pv.importable === 1 ? "" : "es"}</button>
          <a class="btn btn-ghost" href="/console/coach-import">Cancel</a>
        </form>
      </div>
    `);
  }

  // ---- Commit ----
  const result = await runCoachImport(prisma as unknown as PrismaClient, text, {
    createLogins,
    makePasswordHash: () => hashPassword(crypto.randomBytes(24).toString("hex")),
  });

  await audit({
    actorId,
    entityType: "Coach",
    entityId: "import",
    action: "coaches.import",
    summary: `Imported coaches: ${result.created} created, ${result.updated} updated, ${result.blocks} availability blocks, ${result.logins} logins, ${result.errors.length} errors`,
  });

  const perCoach = result.perCoach
    .map((c) => `<tr><td>${esc(c.name)}</td><td class="muted">${esc(c.email)}</td><td>${c.action === "created" ? '<span class="ok">created</span>' : "updated"}</td><td>${c.blocks} time block${c.blocks === 1 ? "" : "s"}</td></tr>`)
    .join("");
  const errs = result.errors.length
    ? `<div class="card"><h2 class="bad">Skipped / errors (${result.errors.length})</h2><table><tbody>${result.errors.map((e) => `<tr><td>${esc(e.name)}</td><td class="bad">${esc(e.reason)}</td></tr>`).join("")}</tbody></table></div>`
    : "";

  return page("Coach import — done", `
    <div class="card">
      <h1 class="ok">Import complete</h1>
      <p><strong>${result.created}</strong> created · <strong>${result.updated}</strong> updated · <strong>${result.blocks}</strong> availability blocks · <strong>${result.logins}</strong> logins · <strong>${result.errors.length}</strong> errors.</p>
      <p><a class="back" href="/console/coaches" style="margin-top:0">Open the Coaches list →</a></p>
    </div>
    ${perCoach ? `<div class="card"><h2>What was recorded</h2><table><thead><tr><th>Coach</th><th>Email</th><th></th><th>Availability</th></tr></thead><tbody>${perCoach}</tbody></table></div>` : ""}
    ${errs}
  `);
}
