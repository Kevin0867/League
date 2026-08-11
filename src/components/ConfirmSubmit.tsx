"use client";

// A native form-POST button that asks for confirmation before submitting, for
// actions that are irreversible or send outbound email. Keeps the app's
// ticket-authed form pattern (no client fetch) while adding a guard so an admin
// knows the consequence before clicking.
export function ConfirmSubmit({
  action,
  fields,
  confirm,
  label,
  className = "btn-primary",
  disabled,
}: {
  action: string;
  fields: Record<string, string>;
  confirm: string;
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <form
      method="POST"
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className={className} disabled={disabled}>
        {label}
      </button>
    </form>
  );
}
