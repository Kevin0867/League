import { NextResponse } from "next/server";
import { actorFromForm } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { exchangeGrantCode } from "@/lib/integrations/zoho";

// "Connect Zoho" — exchange a one-time Self-Client grant code for the permanent
// refresh token, server-side. The deployed app can reach Zoho's OAuth endpoint
// (a local shell / sandbox often can't), so the admin just pastes the grant code
// here and copies the resulting refresh token into the environment. Returns a
// tiny self-contained HTML page rather than putting the token in a redirect URL.
export const dynamic = "force-dynamic";

function page(title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f4;color:#14211b;margin:0;padding:40px 20px;}
  .card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #dce4de;border-radius:16px;padding:28px;box-shadow:0 8px 28px -18px rgba(20,33,27,.28);}
  h1{font-size:20px;margin:0 0 6px;} p{color:#4b5a54;font-size:14px;line-height:1.55;margin:8px 0;}
  textarea{width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;padding:10px;border:1px solid #cbd5cf;border-radius:10px;background:#f8faf9;color:#14211b;margin-top:6px;}
  .ok{color:#065f46;} .err{color:#9f1239;}
  code{background:#eef2f0;padding:2px 6px;border-radius:6px;font-size:13px;}
  a{display:inline-block;margin-top:18px;color:#12694f;font-weight:600;text-decoration:none;}
  ol{color:#4b5a54;font-size:14px;line-height:1.6;padding-left:20px;}
</style></head><body><div class="card">${body}<a href="/console/system">← Back to System</a></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const actor = await actorFromForm(formData);
  if (!actor || !can(actor.role, "manageTeams")) {
    return page("Not authorized", `<h1 class="err">Not authorized</h1><p>You need admin access to connect Zoho.</p>`);
  }

  const code = String(formData.get("code") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim() || undefined;
  const clientSecret = String(formData.get("clientSecret") ?? "").trim() || undefined;

  const r = await exchangeGrantCode(code, clientId, clientSecret);
  if (!r.ok) {
    const hint = r.error === "invalid_code"
      ? "That grant code was already used or has expired. Generate a fresh one in your Zoho Self Client and try again right away."
      : "Double-check the grant code (and the client id/secret if you entered them).";
    return page("Couldn't connect", `<h1 class="err">Couldn't get the token</h1><p>Zoho said: <code>${r.error}</code></p><p>${hint}</p>`);
  }

  return page("Refresh token", `
    <h1 class="ok">✓ Got your refresh token</h1>
    <p>Copy the whole value below and add it in Vercel as <code>ZOHO_CAMPAIGNS_REFRESH_TOKEN</code>, then redeploy.</p>
    <textarea rows="3" readonly onclick="this.select()">${r.refreshToken}</textarea>
    <p style="margin-top:16px"><strong>Next steps:</strong></p>
    <ol>
      <li>Vercel → your project → Settings → Environment Variables.</li>
      <li>Set <code>ZOHO_CAMPAIGNS_REFRESH_TOKEN</code> to the value above (Production scope). Save.</li>
      <li>Redeploy. Then reload the System page — it should show your mailing lists.</li>
    </ol>
    <p style="color:#9f1239">Treat this like a password — it grants access to your Zoho contacts.</p>
  `);
}
