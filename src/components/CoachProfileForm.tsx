"use client";

import { useState } from "react";
import { ACADEMY_MARKETS } from "@/lib/enums";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

type Block = { dayOfWeek: string; startTime: string; endTime: string };

export function CoachProfileForm({
  ticket,
  email,
  targetPersonId,
  initial,
}: {
  ticket: string;
  email: string;
  /** Set when an admin edits another coach; omitted for self-service. */
  targetPersonId?: string;
  initial: {
    phone: string;
    rpoCertLevel: string;
    certifications: string;
    bio: string;
    coachingLevels: string;
    markets: string[];
    availability: Block[];
  };
}) {
  const [blocks, setBlocks] = useState<Block[]>(
    initial.availability.length ? initial.availability : [{ dayOfWeek: "MON", startTime: "", endTime: "" }]
  );

  return (
    <form method="POST" action="/api/console/coach-profile" className="space-y-6">
      <input type="hidden" name="ticket" value={ticket} />
      {targetPersonId && <input type="hidden" name="personId" value={targetPersonId} />}

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Contact</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Email</label>
            <input className="input bg-slate-50" value={email} readOnly />
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="phone" type="tel" className="input" defaultValue={initial.phone} />
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold text-slate-900">Certification &amp; experience</h2>
        <div className="grid gap-4">
          <div>
            <label className="label">Certification level (e.g. RPO Level 2, PPR, IPTPA)</label>
            <input name="rpoCertLevel" className="input" defaultValue={initial.rpoCertLevel} placeholder="RPO Level 2" />
          </div>
          <div>
            <label className="label">Certifications &amp; credentials</label>
            <textarea name="certifications" rows={2} className="input" defaultValue={initial.certifications}
              placeholder="List your certifications, governing bodies, expiry dates…" />
          </div>
          <div>
            <label className="label">Coaching history</label>
            <textarea name="bio" rows={3} className="input" defaultValue={initial.bio}
              placeholder="Where you've coached, years of experience, playing background…" />
          </div>
          <div>
            <label className="label">Levels you can coach</label>
            <input name="coachingLevels" className="input" defaultValue={initial.coachingLevels}
              placeholder="e.g. 2.5–4.0, Youth (Elementary–High School), Beginners" />
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Location availability</h2>
        <p className="text-sm text-slate-500">Which markets can you coach in?</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {ACADEMY_MARKETS.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="market" value={m} defaultChecked={initial.markets.includes(m)} /> {m}
            </label>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-900">Day &amp; time availability</h2>
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div>
                <label className="label">Day</label>
                <select name="availDay" defaultValue={b.dayOfWeek} className="input py-1">
                  {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="label">From</label>
                <input name="availStart" type="time" defaultValue={b.startTime} className="input py-1" />
              </div>
              <div>
                <label className="label">To</label>
                <input name="availEnd" type="time" defaultValue={b.endTime} className="input py-1" />
              </div>
              {blocks.length > 1 && (
                <button type="button" onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}
                  className="mb-1 text-xs text-rose-600 hover:underline">remove</button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setBlocks((bs) => [...bs, { dayOfWeek: "MON", startTime: "", endTime: "" }])}
          className="btn-secondary text-sm">+ Add availability</button>
      </section>

      <button type="submit" className="btn-primary">Save profile</button>
    </form>
  );
}
