"use client";

// Add a coach with their full details directly — no invite required. This is the
// "enter everything myself" counterpart to "Invite a coach": it creates the
// Person + Coach profile with contact, credentials, levels, bio, and screening,
// and only creates a login/sends an invite if the admin ticks the box. You land
// on the coach's profile afterward to add availability, markets, and a photo.
export function AddCoachForm({ ticket }: { ticket: string }) {
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-brand-900">Add a coach (enter all their info)</summary>
      <p className="mt-1 text-sm text-slate-500">
        Creates the coach&apos;s full profile right away — no email sent unless you ask. Add their
        availability, markets, and photo on the profile page next.
      </p>
      <form method="POST" action="/api/console/coaches" className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="op" value="createFull" />

        <div>
          <label className="label">First name *</label>
          <input name="firstName" className="input" required />
        </div>
        <div>
          <label className="label">Last name *</label>
          <input name="lastName" className="input" required />
        </div>
        <div>
          <label className="label">Email <span className="text-slate-400">(optional)</span></label>
          <input name="email" type="email" className="input" placeholder="coach@email.com" />
        </div>
        <div>
          <label className="label">Phone</label>
          <input name="phone" type="tel" className="input" placeholder="(480) 555-0100" />
        </div>

        <div>
          <label className="label">Certifications</label>
          <input name="certifications" className="input" placeholder="PPR, IPTPA…" />
        </div>
        <div>
          <label className="label">RPO level</label>
          <select name="rpoCertLevel" className="input" defaultValue="">
            <option value="">None</option>
            <option value="RPO Level 1">RPO Level 1</option>
            <option value="RPO Level 2">RPO Level 2</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Coaching levels / specialties</label>
          <input name="coachingLevels" className="input" placeholder="Youth beginner–intermediate · Adult 3.0–4.0" />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Bio</label>
          <textarea name="bio" rows={3} className="input" placeholder="Short bio for the roster and public page." />
        </div>

        <div>
          <label className="label">Background check date</label>
          <input name="backgroundCheckDate" type="date" className="input" />
        </div>
        <div>
          <label className="label">Background check company</label>
          <input name="backgroundCheckCompany" className="input" placeholder="e.g. Sterling, Checkr" />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Mailing address <span className="text-slate-400">(optional)</span></label>
          <input name="address" className="input" placeholder="Street, City, State ZIP" />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" name="sendInvite" /> Also create a login and email them an invite to set a password
        </label>

        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary w-full sm:w-auto">Add coach</button>
        </div>
      </form>
    </details>
  );
}
