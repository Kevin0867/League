"use client";

// Delete-team control with a confirm guard. Must be a client component so the
// onSubmit confirm() runs before the native POST to /api/console/teams.
export function DeleteTeamButton({ teamId, ticket, teamName }: { teamId: string; ticket: string; teamName: string }) {
  return (
    <form
      method="POST"
      action="/api/console/teams"
      onSubmit={(e) => {
        if (!confirm(`Delete “${teamName}”? Rostered players return to the pool and any fixtures for this team are removed. This can't be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="deleteTeam" />
      <input type="hidden" name="teamId" value={teamId} />
      <button className="text-sm font-semibold text-rose-600 hover:underline">Delete team</button>
    </form>
  );
}
