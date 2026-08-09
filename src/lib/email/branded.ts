import "server-only";
import { appUrl } from "@/lib/stripe";
import { ACADEMY_LOGO, PADEL_LOGO, SUPPORT_EMAIL } from "@/lib/payments/receipt";

// Shared branded email shell: PURE Academy logo top-left, PURE Pickleball &
// Padel top-right, and a "contact us at team@" footer — matching the payment
// receipt so every email the platform sends looks like one family.

/** An email-client-safe CTA button (table-free, inline styles, block-level). */
export function emailButton(
  href: string,
  label: string,
  opts: { primary?: boolean; sub?: string } = {}
): string {
  const bg = opts.primary ? "#4338ca" : "#ffffff";
  const color = opts.primary ? "#ffffff" : "#4338ca";
  const border = opts.primary ? "#4338ca" : "#c7d2fe";
  const sub = opts.sub
    ? `<span style="display:block;font-weight:400;font-size:12px;color:${opts.primary ? "#e0e7ff" : "#94a3b8"};margin-top:2px">${opts.sub}</span>`
    : "";
  return `<a href="${href}" style="display:block;box-sizing:border-box;text-align:center;padding:13px 18px;margin:0 0 10px;background:${bg};color:${color};border:1px solid ${border};border-radius:10px;font-weight:600;font-size:15px;text-decoration:none">${label}${sub}</a>`;
}

export function brandedEmailHtml(opts: {
  heading: string;
  intro?: string;
  contentHtml: string;
  supportEmail?: string;
}): string {
  const base = appUrl();
  const support = opts.supportEmail ?? SUPPORT_EMAIL;
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="padding:16px 22px;background:#ffffff;border-bottom:1px solid #e2e8f0">
      <table style="width:100%"><tr>
        <td style="text-align:left"><img src="${base}${ACADEMY_LOGO}" alt="PURE Academy" height="38" style="height:38px;border-radius:6px"></td>
        <td style="text-align:right"><img src="${base}${PADEL_LOGO}" alt="PURE Pickleball & Padel" height="42" style="height:42px"></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 22px 8px">
      <h1 style="margin:0 0 6px;font-size:22px;color:#0f172a">${opts.heading}</h1>
      ${opts.intro ? `<p style="margin:0;color:#475569;font-size:15px">${opts.intro}</p>` : ""}
    </td></tr>
    <tr><td style="padding:8px 22px">${opts.contentHtml}</td></tr>
    <tr><td style="padding:8px 22px 26px">
      <p style="margin:0;color:#64748b;font-size:13px">Any issues, please contact us at
        <a href="mailto:${support}" style="color:#4338ca">${support}</a>.</p>
    </td></tr>
  </table></body></html>`;
}
