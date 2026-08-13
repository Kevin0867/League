import { relativeTime, formatDateTime12 } from "@/lib/time";

/**
 * Account activity at a glance — answers "have they gotten onto the platform?"
 *
 * - No login account at all → neutral "No login".
 * - Disabled account → rose "Disabled".
 * - Account exists but never signed in → amber "Never signed in" (an invite is
 *   out but they haven't set a password / logged in the first time).
 * - Signed in before → green dot + "Active · {relative}" (hover for exact time).
 *
 * `lastLoginAt` is stamped on every successful login, so its presence is the
 * definitive signal that someone logged on at least once.
 */
export function LoginStatus({
  lastLoginAt,
  active = true,
  hasAccount = true,
  className = "",
}: {
  lastLoginAt: Date | null;
  active?: boolean;
  hasAccount?: boolean;
  className?: string;
}) {
  if (!hasAccount) {
    return <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-slate-100 text-slate-500 ${className}`}>No login</span>;
  }
  if (!active) {
    return <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-rose-50 text-rose-700 ${className}`}>Disabled</span>;
  }
  if (!lastLoginAt) {
    return (
      <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 ${className}`} title="An invite has been sent, but they haven't set a password or signed in yet.">
        Never signed in
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 ${className}`} title={`Last signed in ${formatDateTime12(lastLoginAt)}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      Active · {relativeTime(lastLoginAt)}
    </span>
  );
}
