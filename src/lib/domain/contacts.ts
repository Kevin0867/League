// A person's notification contacts — the labeled email addresses on their record
// (and, for a minor, their guardian's) that a sender can pick from. Each contact
// carries a display name so the sender sees "Mom", "Dad", the player, etc. next
// to each checkbox and chooses exactly who receives a given email.

export type ContactPerson = {
  firstName: string;
  lastName: string;
  isMinor?: boolean;
  email?: string | null;
  email2?: string | null;
  email3?: string | null;
  emailLabel?: string | null;
  email2Label?: string | null;
  email3Label?: string | null;
};

export type Contact = {
  email: string;
  /** Display name — the address's label, or a sensible fallback. */
  name: string;
  /** Where this address lives: the player's own record, or their guardian's. */
  source: "self" | "guardian";
};

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** All labeled, de-duplicated contacts for a person (+ optional guardian). */
export function personContacts(person: ContactPerson, guardian?: ContactPerson | null): Contact[] {
  const out: Contact[] = [];
  const seen = new Set<string>();
  const add = (email: string | null | undefined, label: string | null | undefined, fallback: string, source: "self" | "guardian") => {
    const e = (email ?? "").trim();
    if (!e) return;
    const key = e.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ email: e, name: (label ?? "").trim() || fallback, source });
  };
  const selfName = `${person.firstName} ${person.lastName}`.trim();
  add(person.email, person.emailLabel, selfName, "self");
  add(person.email2, person.email2Label, selfName, "self");
  add(person.email3, person.email3Label, selfName, "self");
  if (guardian) {
    const gName = `${guardian.firstName} ${guardian.lastName}`.trim();
    add(guardian.email, guardian.emailLabel, gName, "guardian");
    add(guardian.email2, guardian.email2Label, gName, "guardian");
    add(guardian.email3, guardian.email3Label, gName, "guardian");
  }
  return out;
}

// Default checkboxes for a progress report: the parents/guardians, never the
// minor's own address (not appropriate to email an 8-year-old). We treat any
// contact whose NAME differs from the player's as a parent/other; addresses
// labeled with the player's own name are left unchecked for a minor. Adults
// default to all of their addresses. Falls back to "all" if that leaves nobody.
export function defaultReportSelection(contacts: Contact[], player: { firstName: string; lastName: string; isMinor?: boolean }): Set<string> {
  const sel = new Set<string>();
  if (!player.isMinor) {
    contacts.forEach((c) => sel.add(c.email));
    return sel;
  }
  const playerName = norm(`${player.firstName} ${player.lastName}`);
  for (const c of contacts) {
    if (c.source === "guardian" || norm(c.name) !== playerName) sel.add(c.email);
  }
  if (sel.size === 0) contacts.forEach((c) => sel.add(c.email));
  return sel;
}

/** All addresses (default: everyone). Used for payments and general sends. */
export function allSelection(contacts: Contact[]): Set<string> {
  return new Set(contacts.map((c) => c.email));
}

/** Keep only submitted addresses that are real contacts (server-side guard). */
export function filterToContacts(selected: string[], contacts: Contact[]): string[] {
  const valid = new Map(contacts.map((c) => [c.email.toLowerCase(), c.email]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of selected) {
    const hit = valid.get((s ?? "").trim().toLowerCase());
    if (hit && !seen.has(hit.toLowerCase())) {
      seen.add(hit.toLowerCase());
      out.push(hit);
    }
  }
  return out;
}
