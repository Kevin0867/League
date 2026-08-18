"use client";

import { useState } from "react";

type Opt = { id: string; name: string };

export function MessageComposer({
  canBroadcast,
  teams,
  divisions,
  coaches,
  people,
  markets,
  ticket,
}: {
  canBroadcast: boolean;
  teams: Opt[];
  divisions: Opt[];
  coaches: Opt[];
  people: Opt[];
  markets: string[];
  ticket: string;
}) {
  const [audienceType, setAudienceType] = useState(canBroadcast ? "ALL_PLAYERS" : "TEAM");

  const needsRef = ["TEAM", "DIVISION", "MARKET", "SINGLE_COACH", "SINGLE_PERSON"].includes(audienceType);
  const refOptions: Opt[] =
    audienceType === "TEAM" ? teams
    : audienceType === "DIVISION" ? divisions
    : audienceType === "SINGLE_COACH" ? coaches
    : audienceType === "SINGLE_PERSON" ? people
    : audienceType === "MARKET" ? markets.map((m) => ({ id: m, name: m }))
    : [];

  return (
    <form method="POST" action="/api/console/messages" className="card space-y-4">
      <input type="hidden" name="ticket" value={ticket} />
      <input type="hidden" name="op" value="send" />
      <h2 className="font-semibold text-slate-900">Compose message</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="audienceType">Audience</label>
          <select
            id="audienceType" name="audienceType" className="input"
            value={audienceType} onChange={(e) => setAudienceType(e.target.value)}
          >
            {canBroadcast && <option value="ALL_PLAYERS">All players (+ parents)</option>}
            {canBroadcast && <option value="ALL_COACHES">All coaches</option>}
            {canBroadcast && <option value="DIVISION">A division</option>}
            {canBroadcast && <option value="MARKET">A market</option>}
            <option value="TEAM">A team (players + parents)</option>
            {canBroadcast && <option value="SINGLE_COACH">A single coach</option>}
            {canBroadcast && <option value="SINGLE_PERSON">A single person</option>}
          </select>
        </div>

        {needsRef && (
          <div>
            <label className="label" htmlFor="audienceRef">
              {audienceType === "MARKET" ? "Market" : audienceType === "DIVISION" ? "Division" : audienceType === "TEAM" ? "Team" : audienceType === "SINGLE_COACH" ? "Coach" : "Person"}
            </label>
            <select id="audienceRef" name="audienceRef" className="input" required>
              <option value="">— select —</option>
              {refOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="subject">Subject</label>
        <input id="subject" name="subject" className="input" placeholder="Optional" />
      </div>

      <div>
        <label className="label" htmlFor="body">Message</label>
        <textarea id="body" name="body" rows={4} className="input" required placeholder="What do they need to know?" />
      </div>

      <div>
        <span className="label">Channels</span>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="channel_IN_APP" defaultChecked /> In-app</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="channel_EMAIL" defaultChecked /> Email</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="channel_SMS" defaultChecked /> SMS <span className="text-xs text-slate-400">(time-critical)</span></label>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">Everything is logged per person and per team.</p>
        <button type="submit" className="btn-primary">
          Send
        </button>
      </div>
    </form>
  );
}
