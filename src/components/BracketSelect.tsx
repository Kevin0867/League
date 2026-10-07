"use client";

import { useRef } from "react";
import { bracketLabel } from "@/lib/domain/bracketGroups";

// Inline bracket picker for a league team: choosing a value posts op=setTeamBracket
// and the page reloads with the team moved to that gender+level bracket. No save
// button — the change IS the submit.

const BANDS = ["2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.0+"];
const OPTIONS: string[] = [
  "UNASSIGNED",
  ...BANDS.map((b) => `M${b}`),
  ...BANDS.map((b) => `W${b}`),
  "ELE", "MID", "HS",
];

export function BracketSelect({
  ticket, seasonId, teamId, current,
}: {
  ticket: string;
  seasonId: string;
  teamId: string;
  current: string; // bracket code, or "UNASSIGNED"
}) {
  const formRef = useRef<HTMLFormElement>(null);
  // Make sure the current value is always selectable even if it's a non-standard code.
  const options = OPTIONS.includes(current) ? OPTIONS : [current, ...OPTIONS];
  return (
    <form ref={formRef} method="POST" action="/api/console/league" className="inline">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="setTeamBracket" />
      <input type="hidden" name="seasonId" value={seasonId} />
      <input type="hidden" name="teamId" value={teamId} />
      <select
        name="bracketCode"
        defaultValue={current}
        onChange={() => formRef.current?.requestSubmit()}
        className="input py-1 text-xs"
        aria-label="Move to bracket"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === "UNASSIGNED" ? "Unassigned" : bracketLabel(o)}</option>
        ))}
      </select>
    </form>
  );
}
