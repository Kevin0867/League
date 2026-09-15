// Helpers for "return to my search results" navigation. When a list page links
// to a record, it stamps the record link with a `back` param carrying the list
// URL (search text + filters). The record's Back link then returns to those
// results instead of a blank list, so you don't have to search again.

/** Build a `?back=<encoded list url>` suffix from the current search params.
 *  Only the given keys are carried, and only when they have a value, so the
 *  returned URL is exactly the search the admin was looking at. Returns "" when
 *  there's nothing to preserve (no search/filters active). */
export function backSuffix(
  listPath: string,
  sp: Record<string, string | undefined>,
  keys: string[],
): string {
  const qs = new URLSearchParams();
  for (const k of keys) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  if (!s) return "";
  return `?back=${encodeURIComponent(`${listPath}?${s}`)}`;
}

/** Resolve a Back link target. Uses the `back` param when it's a safe in-app
 *  path (starts with a single "/"), otherwise the fallback. */
export function backHref(raw: string | undefined, fallback: string): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}
