import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { pushContactToZoho, isZohoConfigured } from "@/lib/integrations/zoho";

// End-to-end test: push a single contact to the configured Zoho list and show
// the raw result, so an admin can confirm the connection works without
// backfilling everyone or creating a fake registration.
export const dynamic = "force-dynamic";

function page(title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f4;color:#14211b;margin:0;padding:40px 20px;}
  .card{max-width:600px;margin:0 auto;background:#fff;border:1px solid #dce4de;border-radius:16px;padding:28px;box-shadow:0 8px 28px -18px rgba(20,33,27,.28);}
  h1{font-size:20px;margin:0 0 6px;} p{color:#4b5a54;font-size:14px;line-height:1.55;margin:8px 0;}
  .ok{color:#065f46;} .err{color:#9f1239;} code{background:#eef2f0;padding:2px 6px;border-radius:6px;font-size:13px;}
  a{display:inline-block;margin-top:18px;color:#12694f;font-weight:600;text-decoration:none;}
</style></head><body><div class="card">${body}<a href="/console/system">← Back to System</a></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) {
    return page("Not authorized", `<h1 class="err">Not authorized</h1>`);
  }
  if (!isZohoConfigured()) {
    return page("Not connected", `<h1 class="err">Zoho isn't fully connected</h1><p>Set all four environment variables (including the list key) and redeploy first.</p>`);
  }

  const email = String(formData.get("email") ?? "").trim();
  const firstName = String(formData.get("firstName") ?? "").trim() || "Test";
  const lastName = String(formData.get("lastName") ?? "").trim() || "Contact";
  if (!email) return page("Missing email", `<h1 class="err">Enter an email to test with</h1>`);

  const r = await pushContactToZoho({ email, firstName, lastName });
  if (r.ok) {
    return page("Test succeeded", `
      <h1 class="ok">✓ It works</h1>
      <p>Added <code>${email}</code> to your Zoho Campaigns list. Check your list in Zoho — it should be there
      (as a new contact, or updated if it already existed).</p>
      <p>Every new registration will now flow in automatically. Use <strong>Sync existing registrations</strong>
      on the System page to backfill everyone who registered earlier.</p>
    `);
  }
  return page("Test failed", `
    <h1 class="err">Couldn't add the contact</h1>
    <p>Zoho said: <code>${r.ok === false && "error" in r ? r.error : "unknown"}</code></p>
    <p>If this is a 401, the refresh token is missing the <code>ZohoCampaigns.contact.ALL</code> scope.
    If it's about a field or list key, double-check <code>ZOHO_CAMPAIGNS_LIST_KEY</code>.</p>
  `);
}
