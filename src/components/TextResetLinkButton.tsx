// A one-click "text + email the password reset link" action, usable anywhere a
// person is shown. For a minor without their own contact info the server routes
// the link to their guardian. Native-form POST with a console ticket.
export function TextResetLinkButton({
  personId,
  userId,
  ticket,
  returnTo,
  label = "Text reset link",
  className = "text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline",
}: {
  personId?: string;
  userId?: string;
  ticket: string;
  returnTo: string;
  label?: string;
  className?: string;
}) {
  if (!personId && !userId) return null;
  return (
    <form method="POST" action="/api/console/reset-link" className="inline">
      <input type="hidden" name="ticket" value={ticket} />
      {personId ? <input type="hidden" name="personId" value={personId} /> : null}
      {userId ? <input type="hidden" name="userId" value={userId} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className={className} title="Send a set/reset-password link by text and email (a minor's link goes to their guardian)">{label}</button>
    </form>
  );
}
