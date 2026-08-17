// Zoho Campaigns sync. Pushes a registrant (the account-holder contact — the
// adult player, or the guardian for a minor) into a Zoho Campaigns mailing list
// server-to-server, so every registration lands in Zoho automatically with
// nothing for the user to see or do.
//
// We deliberately use the Zoho Campaigns API rather than replaying the public
// newsletter web-optin form: the optin form is CAPTCHA-gated (it rejects
// automated posts) and double-opt-in (it emails a confirmation link). The API
// has neither problem — it adds the contact directly. Registrants have already
// consented during registration, so no second confirmation step is wanted.
//
// Configuration (all via env — nothing is committed):
//   ZOHO_CAMPAIGNS_CLIENT_ID       OAuth client id (Zoho API console self-client)
//   ZOHO_CAMPAIGNS_CLIENT_SECRET   OAuth client secret
//   ZOHO_CAMPAIGNS_REFRESH_TOKEN   Long-lived refresh token for the self-client
//   ZOHO_CAMPAIGNS_LIST_KEY        Target mailing list key (the newsletter list)
//   ZOHO_ACCOUNTS_HOST  (optional) default accounts.zoho.com  (US data center)
//   ZOHO_CAMPAIGNS_HOST (optional) default campaigns.zoho.com (US data center)
//
// When any of the first four are missing the module is dormant: every call is a
// no-op that reports `skipped`, so the app runs exactly as before until the
// credentials are set.

const ACCOUNTS_HOST = process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com";
const CAMPAIGNS_HOST = process.env.ZOHO_CAMPAIGNS_HOST || "campaigns.zoho.com";
const TIMEOUT_MS = 6000;

export function isZohoConfigured(): boolean {
  return isZohoAuthConfigured() && Boolean(process.env.ZOHO_CAMPAIGNS_LIST_KEY);
}

// OAuth is configured (the three credentials) even if the list key isn't yet —
// enough to look the list key up from Zoho so you never have to hunt for it.
export function isZohoAuthConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CAMPAIGNS_CLIENT_ID &&
    process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET &&
    process.env.ZOHO_CAMPAIGNS_REFRESH_TOKEN,
  );
}

export function configuredListKey(): string | null {
  return process.env.ZOHO_CAMPAIGNS_LIST_KEY || null;
}

export type ZohoList = { listkey: string; listname: string; count: number };

/** Fetch the account's mailing lists (name + list key) so the admin can copy the
 *  right key. Needs only the OAuth credentials, not the list key itself. */
export async function listZohoMailingLists(): Promise<{ ok: true; lists: ZohoList[] } | { ok: false; error: string }> {
  if (!isZohoAuthConfigured()) return { ok: false, error: "not-configured" };
  try {
    const token = await getAccessToken();
    const params = new URLSearchParams({ resfmt: "JSON", sortBy: "asc", range: "100", fromindex: "1" });
    const res = await fetchWithTimeout(`https://${CAMPAIGNS_HOST}/api/v1.1/getmailinglists?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string; code?: string; message?: string;
      list_of_details?: { listkey: string; listname: string; noofcontacts?: string | number }[];
    };
    if (!res.ok || data.status !== "success") return { ok: false, error: data.message || data.code || `HTTP ${res.status}` };
    const lists = (data.list_of_details ?? []).map((l) => ({
      listkey: l.listkey, listname: l.listname, count: Number(l.noofcontacts ?? 0),
    }));
    return { ok: true, lists };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}

export type ZohoContact = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

export type ZohoResult =
  | { ok: true; skipped?: false }
  | { ok: false; skipped: true; reason: "not-configured" | "no-email" }
  | { ok: false; skipped?: false; error: string };

// Access-token cache. A refresh-token exchange yields an access token valid ~1h;
// we cache it in-process (per warm serverless instance) and refresh with a small
// safety margin so we don't spend a network round-trip on every contact.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_CAMPAIGNS_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CAMPAIGNS_CLIENT_ID!,
    client_secret: process.env.ZOHO_CAMPAIGNS_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await fetchWithTimeout(`https://${ACCOUNTS_HOST}/oauth/v2/token?${params.toString()}`, {
    method: "POST",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`token exchange failed: ${data.error || res.status}`);
  }
  cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

/**
 * Add (or update) one contact in the configured Zoho Campaigns list. Idempotent:
 * re-adding an existing email updates that contact rather than duplicating it.
 * Never throws — all failures are returned so callers can log without ever
 * breaking the user-facing flow they're attached to.
 */
export async function pushContactToZoho(contact: ZohoContact): Promise<ZohoResult> {
  if (!isZohoConfigured()) return { ok: false, skipped: true, reason: "not-configured" };
  const email = contact.email?.trim().toLowerCase();
  if (!email) return { ok: false, skipped: true, reason: "no-email" };

  try {
    const token = await getAccessToken();

    // contactinfo keys are the list's field display names (as seen in the
    // newsletter form): "Contact Email", "First Name", "Last Name", "Mobile".
    const info: Record<string, string> = { "Contact Email": email };
    if (contact.firstName?.trim()) info["First Name"] = contact.firstName.trim();
    if (contact.lastName?.trim()) info["Last Name"] = contact.lastName.trim();
    if (contact.phone?.trim()) info["Mobile"] = contact.phone.trim();

    const params = new URLSearchParams({
      resfmt: "JSON",
      listkey: process.env.ZOHO_CAMPAIGNS_LIST_KEY!,
      contactinfo: JSON.stringify(info),
    });
    const res = await fetchWithTimeout(
      `https://${CAMPAIGNS_HOST}/api/v1.1/json/listsubscribe?${params.toString()}`,
      { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    );
    const data = (await res.json().catch(() => ({}))) as { status?: string; code?: string; message?: string };
    // Campaigns returns {"status":"success"} on success; anything else is a
    // real failure (invalid token, bad list key, unmapped field, rate limit).
    if (res.ok && (data.status === "success" || data.code === "0")) return { ok: true };
    return { ok: false, error: data.message || data.code || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}
