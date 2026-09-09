"use client";

// Courtside convenience: one tap sets every player to Present, so a coach only
// has to change the few who aren't. It's an explicit action — nothing is
// recorded as Present unless the coach taps here (or taps a player) and saves,
// so attendance still reflects a real check-in, never an unset default.
export function AttendanceQuickFill({ formId }: { formId: string }) {
  function markAllPresent() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    form.querySelectorAll<HTMLInputElement>('input[type="radio"][value="PRESENT"]').forEach((el) => {
      el.checked = true;
    });
  }
  return (
    <button type="button" onClick={markAllPresent} className="btn-ghost text-sm">
      Mark all present
    </button>
  );
}
