import Link from "next/link";
import { PageHeader } from "@/components/RoadmapNote";
import { mintConsoleTicket } from "@/lib/auth";
import { requireAdmin } from "@/lib/rbac";
import { isZohoConfigured, isZohoAuthConfigured, configuredListKey, listZohoMailingLists, hasZohoClientCreds } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";

// Deliberately does NO database queries beyond auth, so it still loads even when
// the schema is behind the code (which is exactly when you'd need it).
export default async function SystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ticket = await mintConsoleTicket();
  const zohoOn = isZohoConfigured();
  const zohoAuthOn = isZohoAuthConfigured();
  const zohoClientOn = hasZohoClientCreds();
  const currentListKey = configuredListKey();
  // When the OAuth credentials are in but the list key isn't (or to double-check
  // it), fetch the account's lists so the admin can copy the right key.
  const zohoLists = zohoAuthOn ? await listZohoMailingLists() : null;

  return (
    <div className="space-y-6">
      <PageHeader title="System" subtitle="Maintenance actions for admins." />

      {sp.ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Database updates applied. The apparel setup, pay page, and team pages should work now.
        </div>
      )}
      {sp.err && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Couldn&apos;t apply updates: {sp.err}
        </div>
      )}
      {sp.enc && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Encryption backfill complete — encrypted {sp.enc.split(".")[0]} people and {sp.enc.split(".")[1]} registrations that still had plaintext fields.
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-slate-900">Encrypt existing records</h2>
        <p className="mt-1 text-sm text-slate-600">
          New and edited records encrypt their sensitive fields (home address, emergency contact, medical notes)
          automatically. Run this once to also encrypt any older records that were saved before a field was added to
          the encrypted set. Safe to run more than once — already-encrypted values are skipped.
        </p>
        <form method="POST" action="/api/console/encrypt-backfill" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-primary text-sm">Encrypt existing records</button>
        </form>
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-900">Apply database updates</h2>
        <p className="mt-1 text-sm text-slate-600">
          Database updates now apply automatically on every deploy, so you shouldn&apos;t normally need this. It stays
          here as a manual safety net: if a page ever shows a &ldquo;table/column does not exist&rdquo; server error,
          run this to bring the database up to date. Safe to run more than once — it only adds what&apos;s missing.
        </p>
        <form method="POST" action="/api/console/db-repair" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-primary text-sm">Apply database updates</button>
        </form>
      </div>

      {sp.bfok && (
        <div className={`rounded-lg px-4 py-3 text-sm ${sp.failed && sp.failed !== "0" ? "border-l-4 border-amber-400 bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>
          <p>
            Synced {sp.pushed ?? "0"} contact{sp.pushed === "1" ? "" : "s"} to Zoho
            {sp.failed && sp.failed !== "0" ? ` · ${sp.failed} failed` : ""}
            {sp.remaining && sp.remaining !== "0" ? ` · ${sp.remaining} still to go — run again to continue` : " · all caught up"}.
          </p>
          {sp.failinfo && (
            <div className="mt-2">
              <p className="font-medium">Why the failures (Zoho&apos;s reason):</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {sp.failinfo.split(" | ").map((r, i) => {
                  // Each item is "email — reason". Link the email straight to the
                  // person's record (registrations search) so it's one click to fix.
                  const dash = r.indexOf(" — ");
                  const email = dash > 0 ? r.slice(0, dash) : "";
                  const reason = dash > 0 ? r.slice(dash + 3) : r;
                  return (
                    <li key={i} className="text-xs">
                      {email ? (
                        <Link href={`/console/registrations?q=${encodeURIComponent(email)}`} className="font-mono font-semibold text-amber-900 underline hover:text-amber-700">
                          {email}
                        </Link>
                      ) : null}
                      <span className="font-mono"> — {reason}</span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                Click an email to open that person&apos;s record, fix the email field, and save — then press{" "}
                <strong>Sync registrations to Zoho</strong> below again. It only retries contacts not yet synced, so it&apos;s safe to run repeatedly.
                Common causes: a typo in the domain (e.g. <span className="font-mono">.fom</span> → <span className="font-mono">.com</span>,
                {" "}<span className="font-mono">.nwt</span> → <span className="font-mono">.net</span>), a blank email, a bad phone format, or a
                contact Zoho has marked unsubscribed / do-not-mail (those you clear on the Zoho side).
              </p>
            </div>
          )}
        </div>
      )}
      {sp.bferr === "notconfigured" && (
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Zoho isn&apos;t connected yet. Add the Zoho Campaigns credentials to the environment, then run the sync.
        </div>
      )}
      {sp.bferr === "auth" && (
        <div className="rounded-lg border-l-4 border-rose-400 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Not authorized to run the Zoho sync.
        </div>
      )}

      {/* Connect step — exchange a Self-Client grant code for the refresh token,
          no terminal required. Shown until the full connection is live. */}
      {!zohoOn && (
        <div className="card">
          <h2 className="font-semibold text-slate-900">Connect Zoho — get your refresh token</h2>
          <p className="mt-1 text-sm text-slate-600">
            In your Zoho Self Client, generate a grant code with scope
            <span className="font-mono text-xs"> ZohoCampaigns.contact.ALL</span> (this covers reading your lists and
            adding contacts), 10&nbsp;minutes, then paste it below and we&apos;ll exchange it for the permanent refresh
            token to put in Vercel. Do it right after generating the code — grant codes expire in about 10 minutes.
          </p>
          <form method="POST" action="/api/console/zoho-connect" className="mt-3 space-y-2">
            <input type="hidden" name="ticket" value={ticket} />
            {!zohoClientOn && (
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="clientId" className="input text-sm" placeholder="Client ID (1000.xxxx)" />
                <input name="clientSecret" className="input text-sm" placeholder="Client Secret" />
              </div>
            )}
            <input name="code" className="input w-full text-sm" placeholder="Paste grant code (1000.xxxx.xxxx)" required />
            <button className="btn-primary text-sm">Get refresh token</button>
          </form>
          {zohoClientOn && (
            <p className="mt-2 text-xs text-slate-400">Using the Client ID and Secret already set in the environment — you only need the grant code.</p>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Sync registrations to Zoho</h2>
          <span className={`badge ${zohoOn ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
            {zohoOn ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          New registrations are pushed to your Zoho Campaigns list automatically — the account holder (the adult,
          or the parent for a minor) is added silently, with no confirmation email. Use this to backfill everyone
          who registered before the sync was turned on. It only sends contacts not already synced, so it&apos;s safe
          to run more than once — and it picks up anyone added by import since the last run.
        </p>
        <form method="POST" action="/api/console/zoho-backfill" className="mt-3">
          <input type="hidden" name="ticket" value={ticket} />
          <button className="btn-secondary text-sm" disabled={!zohoOn}>Sync existing registrations</button>
        </form>

        {zohoOn && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">Send a test contact</h3>
            <p className="mt-1 text-xs text-slate-500">
              Push one contact to your Zoho list to confirm the connection end-to-end. Use your own email, then
              check that it appears in the list in Zoho.
            </p>
            <form method="POST" action="/api/console/zoho-test" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="ticket" value={ticket} />
              <input name="email" type="email" required placeholder="you@example.com" className="input text-sm" />
              <button className="btn-secondary text-sm">Send test contact</button>
            </form>
          </div>
        )}
        {!zohoOn && (
          <p className="mt-2 text-xs text-slate-400">
            Set ZOHO_CAMPAIGNS_CLIENT_ID, ZOHO_CAMPAIGNS_CLIENT_SECRET, ZOHO_CAMPAIGNS_REFRESH_TOKEN, and
            ZOHO_CAMPAIGNS_LIST_KEY to connect.
          </p>
        )}

        {/* List-key finder — appears once the three OAuth vars are set. */}
        {zohoAuthOn && zohoLists && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800">Your Zoho mailing lists</h3>
            {zohoLists.ok ? (
              zohoLists.lists.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No mailing lists found on this Zoho account.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-slate-500">
                    Copy the key of the list you want, then set it as <span className="font-mono">ZOHO_CAMPAIGNS_LIST_KEY</span> and redeploy.
                  </p>
                  <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">List</th>
                          <th className="px-3 py-2 font-semibold">Contacts</th>
                          <th className="px-3 py-2 font-semibold">List key</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zohoLists.lists.map((l) => (
                          <tr key={l.listkey} className={`border-b border-slate-100 last:border-0 ${currentListKey === l.listkey ? "bg-emerald-50" : ""}`}>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              {l.listname}
                              {currentListKey === l.listkey && <span className="ml-2 badge bg-emerald-100 text-emerald-800">in use</span>}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-slate-500">{l.count}</td>
                            <td className="px-3 py-2"><span className="select-all font-mono text-xs text-slate-700">{l.listkey}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            ) : zohoLists.error !== "not-configured" ? (
              <p className="mt-1 text-sm text-rose-700">Couldn&apos;t reach Zoho: {zohoLists.error}. Double-check the OAuth credentials.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
