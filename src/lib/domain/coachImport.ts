import "server-only";
import type { PrismaClient } from "@prisma/client";
import { parseCsv } from "./enrollmentImport";
import { WEEKDAYS } from "../enums";

// Coach roster import. Maps a coaches spreadsheet (contact, credentials,
// experience, per-day availability, bio) into Coach + Person accounts, parsing
// the free-text weekly-availability columns into day/time blocks. Idempotent —
// people are matched by email, so re-running updates rather than duplicating.
//
// The parsing is deliberately forgiving and the availability heuristics are
// surfaced in the preview so an admin verifies exactly what will be recorded
// before committing.

const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
// AvailabilityBlock.dayOfWeek codes, aligned to DAY_NAMES order (WEEKDAYS is MON..SUN).
const DAY_CODES = WEEKDAYS as readonly string[]; // ["MON","TUE","WED","THU","FRI","SAT","SUN"]

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type TimeBlock = { start: string; end: string }; // "HH:MM"
export type DayAvailability = { day: string; code: string; raw: string; blocks: TimeBlock[]; note?: string };

export type CoachRecord = {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  certifications: string | null;
  rpoCertLevel: string | null;
  coachingLevels: string | null;
  bio: string | null;
  availability: DayAvailability[];
  skipReason?: string; // set when the row can't be imported (e.g. no email)
};

// ---- time parsing ----------------------------------------------------------

const NAMED: Record<string, [string, string]> = {
  morning: ["08:00", "12:00"],
  afternoon: ["12:00", "17:00"],
  evening: ["17:00", "21:00"],
  evenings: ["17:00", "21:00"],
  night: ["18:00", "21:00"],
  "all day": ["08:00", "21:00"],
  anytime: ["08:00", "21:00"],
  flexible: ["08:00", "21:00"],
  open: ["08:00", "21:00"],
  available: ["08:00", "21:00"],
};

const NONE_VALUES = new Set(["", "n/a", "na", "no", "none", "not available", "unavailable", "-", "—", "x", "off", "closed"]);

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** Parse one day's free-text availability into 0+ HH:MM blocks. */
export function parseDayAvailability(raw: string): { blocks: TimeBlock[]; note?: string } {
  const s = raw.trim().toLowerCase();
  if (NONE_VALUES.has(s)) return { blocks: [] };

  const blocks: TimeBlock[] = [];
  const rangeRe = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|—|to|until|till|thru|through)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/g;
  let m: RegExpExecArray | null;
  let approx = false;
  while ((m = rangeRe.exec(s))) {
    const [, h1, min1, ap1, h2, min2, ap2] = m;
    let sh = parseInt(h1, 10);
    let eh = parseInt(h2, 10);
    const sm = min1 ? parseInt(min1, 10) : 0;
    const em = min2 ? parseInt(min2, 10) : 0;
    let sap = ap1 ? (ap1.startsWith("p") ? "pm" : "am") : null;
    let eap = ap2 ? (ap2.startsWith("p") ? "pm" : "am") : null;
    // Borrow a missing meridiem from the other side.
    if (!sap && eap) sap = eap;
    if (!eap && sap) eap = sap;
    // Neither side stated am/pm — assume afternoon/evening (typical practice
    // hours): 1–7 → pm, 8–11 → am, 12 → noon.
    if (!sap && !eap) {
      approx = true;
      sap = sh >= 1 && sh <= 7 ? "pm" : "am";
      eap = eh >= 1 && eh <= 7 ? "pm" : "am";
    }
    if (sap === "pm" && sh < 12) sh += 12;
    if (sap === "am" && sh === 12) sh = 0;
    if (eap === "pm" && eh < 12) eh += 12;
    if (eap === "am" && eh === 12) eh = 0;
    // If end lands before start, the range likely crosses into the afternoon.
    if (eh < sh) { eh += 12; approx = true; }
    if (eh > 23) eh = 23;
    blocks.push({ start: `${pad(sh)}:${pad(sm)}`, end: `${pad(eh)}:${pad(em)}` });
  }

  if (blocks.length === 0) {
    for (const key of Object.keys(NAMED)) {
      if (s.includes(key)) { blocks.push({ start: NAMED[key][0], end: NAMED[key][1] }); approx = true; }
    }
  }

  // De-dupe (e.g. text containing both "evening" and "evenings").
  const seen = new Set<string>();
  const unique = blocks.filter((b) => {
    const k = `${b.start}-${b.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length === 0) return { blocks: [], note: "couldn't read times" };
  return { blocks: unique, note: approx ? "assumed am/pm — please verify" : undefined };
}

// ---- row mapping -----------------------------------------------------------

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function detectRpo(cert: string): string | null {
  const m = cert.match(/rpo\s*(?:level\s*)?(1|2|i{1,2})/i);
  if (!m) return null;
  const lvl = m[1].toLowerCase();
  const n = lvl === "1" || lvl === "i" ? "1" : "2";
  return `RPO Level ${n}`;
}

function findCol(headers: string[], test: (h: string) => boolean): number {
  return headers.findIndex((h) => test(norm(h)));
}

export function parseCoachRows(text: string): { records: CoachRecord[]; headerRow: string[] } {
  // CSV export is the robust path (quoted bios with commas/newlines). A pasted
  // spreadsheet is usually tab-separated — detect that from the header line and
  // split simply (best-effort; a CSV upload is recommended for long bios).
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const table = firstLine.includes("\t")
    ? text.split(/\r?\n/).filter((l) => l.length > 0).map((l) => l.split("\t"))
    : parseCsv(text);
  if (table.length === 0) return { records: [], headerRow: [] };
  const headers = table[0];

  const col = {
    name: findCol(headers, (h) => h.includes("full name")) >= 0 ? findCol(headers, (h) => h.includes("full name")) : findCol(headers, (h) => h.includes("name") && !h.includes("parent") && !h.includes("organization")),
    first: findCol(headers, (h) => h === "first name" || h === "first" || (h.includes("first") && h.includes("name"))),
    last: findCol(headers, (h) => h === "last name" || h === "last" || (h.includes("last") && h.includes("name"))),
    email: findCol(headers, (h) => h.includes("email")),
    phone: findCol(headers, (h) => h.includes("phone") || h.includes("mobile") || h.includes("cell")),
    address: findCol(headers, (h) => h.includes("mailing")) >= 0 ? findCol(headers, (h) => h.includes("mailing")) : findCol(headers, (h) => h.includes("address")),
    // Certifications: accept the application-form columns OR any plain
    // "certification(s)" / "cert" / "credential" header.
    certOrg: findCol(headers, (h) => h.includes("accredited") || (h.includes("certification") && h.includes("organization"))) >= 0
      ? findCol(headers, (h) => h.includes("accredited") || (h.includes("certification") && h.includes("organization")))
      : findCol(headers, (h) => h.includes("certification") || h.includes("cert") || h.includes("credential")),
    certAdd: findCol(headers, (h) => h.includes("additional") && h.includes("certification")),
    // Levels: the application "coaching preference" columns OR a plain
    // "coaching level(s)" / "level" / "specialt(y|ies)" header.
    prefType: findCol(headers, (h) => h.includes("coaching preference") && !h.includes("skill")) >= 0
      ? findCol(headers, (h) => h.includes("coaching preference") && !h.includes("skill"))
      : findCol(headers, (h) => h.includes("level") || h.includes("specialt")),
    prefSkill: findCol(headers, (h) => h.includes("coaching preference") && h.includes("skill")),
    years: findCol(headers, (h) => h.includes("years") && h.includes("experience")),
    bio: findCol(headers, (h) => h.includes("bio")),
    days: DAY_NAMES.map((d) => findCol(headers, (h) => (h.includes("availability") || h.includes("avail")) && h.includes(d))),
  };

  const get = (row: string[], i: number) => (i >= 0 && i < row.length ? (row[i] ?? "").trim() : "");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^[+()\d][\d\s().-]{6,}$/;

  const records: CoachRecord[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (row.every((c) => !c || !c.trim())) continue; // blank line

    // Name: a single "Full Name" column, else separate First/Last columns.
    let fullName = get(row, col.name);
    if (!fullName && (col.first >= 0 || col.last >= 0)) {
      fullName = [get(row, col.first), get(row, col.last)].filter(Boolean).join(" ");
    }
    const { first, last } = splitName(fullName);

    // Email / phone: prefer the mapped column, but fall back to detecting them
    // by content anywhere in the row, so a paste with odd headers still works.
    let email = get(row, col.email).toLowerCase() || null;
    if (!email) {
      const found = row.map((c) => (c ?? "").trim()).find((c) => EMAIL_RE.test(c.toLowerCase()));
      email = found ? found.toLowerCase() : null;
    }

    const certParts = [get(row, col.certOrg), get(row, col.certAdd)].filter(Boolean);
    const certifications = certParts.join(" · ") || null;
    const rpoCertLevel = certifications ? detectRpo(certifications) : null;

    const levelParts = [get(row, col.prefType), get(row, col.prefSkill)].filter(Boolean);
    const coachingLevels = levelParts.join(" · ") || null;

    const years = get(row, col.years);
    let bio = get(row, col.bio) || null;
    if (years) {
      const sentence = `${years}${/year/i.test(years) ? "" : " years"} of formal coaching experience.`;
      bio = bio ? `${bio}\n\n${sentence}` : sentence;
    }

    const availability: DayAvailability[] = [];
    DAY_NAMES.forEach((day, i) => {
      const raw = get(row, col.days[i]);
      if (col.days[i] < 0 || !raw) return;
      const { blocks, note } = parseDayAvailability(raw);
      if (blocks.length || note) availability.push({ day: day[0].toUpperCase() + day.slice(1), code: DAY_CODES[i], raw, blocks, note });
    });

    let phone = get(row, col.phone) || null;
    if (!phone) {
      const found = row.map((c) => (c ?? "").trim()).find((c) => PHONE_RE.test(c) && !EMAIL_RE.test(c.toLowerCase()));
      phone = found ?? null;
    }

    const rec: CoachRecord = {
      fullName,
      firstName: first,
      lastName: last,
      email,
      phone,
      address: get(row, col.address) || null,
      certifications,
      rpoCertLevel,
      coachingLevels,
      bio,
      availability,
    };
    // A coach can import without an email — just as a profile with no login
    // (add the email later, then invite them). Only a nameless row is unusable.
    if (!first) rec.skipReason = "no name — nothing to import";
    records.push(rec);
  }

  return { records, headerRow: headers };
}

export type CoachImportPreview = {
  total: number;
  importable: number;
  skipped: number;
  records: CoachRecord[];
};

export function previewCoachImport(text: string): CoachImportPreview {
  const { records } = parseCoachRows(text);
  const importable = records.filter((r) => !r.skipReason).length;
  return { total: records.length, importable, skipped: records.length - importable, records };
}

export type CoachImportResult = {
  created: number;
  updated: number;
  blocks: number;
  logins: number;
  errors: { name: string; reason: string }[];
  perCoach: { name: string; email: string; action: "created" | "updated"; blocks: number }[];
};

/** Commit the import: upsert Person + Coach, replace availability, and (optionally)
 *  create a login so each coach has an account. Never sends email. */
export async function runCoachImport(
  prisma: PrismaClient,
  text: string,
  opts: { createLogins: boolean; makePasswordHash: () => Promise<string> },
): Promise<CoachImportResult> {
  const { records } = parseCoachRows(text);
  const result: CoachImportResult = { created: 0, updated: 0, blocks: 0, logins: 0, errors: [], perCoach: [] };

  for (const rec of records) {
    if (rec.skipReason) {
      result.errors.push({ name: rec.fullName || rec.email || "(unnamed)", reason: rec.skipReason });
      continue;
    }
    try {
      // Person — match on email; for an email-less coach, match an existing
      // coach by name so re-running stays idempotent, else create fresh.
      let person = rec.email
        ? await prisma.person.findFirst({ where: { email: rec.email } })
        : (await prisma.coach.findFirst({ where: { person: { firstName: rec.firstName, lastName: rec.lastName, email: null } }, include: { person: true } }))?.person ?? null;
      if (person) {
        person = await prisma.person.update({
          where: { id: person.id },
          data: {
            firstName: person.firstName || rec.firstName,
            lastName: person.lastName || rec.lastName,
            phone: rec.phone ?? person.phone,
            address: rec.address ?? person.address,
          },
        });
      } else {
        person = await prisma.person.create({
          data: { firstName: rec.firstName, lastName: rec.lastName, email: rec.email, phone: rec.phone, address: rec.address },
        });
      }

      // Coach profile — create or update the credential/level/bio fields.
      const existingCoach = await prisma.coach.findUnique({ where: { personId: person.id } });
      const coachData = {
        certifications: rec.certifications ?? existingCoach?.certifications ?? null,
        rpoCertLevel: rec.rpoCertLevel ?? existingCoach?.rpoCertLevel ?? null,
        coachingLevels: rec.coachingLevels ?? existingCoach?.coachingLevels ?? null,
        bio: rec.bio ?? existingCoach?.bio ?? null,
      };
      const coach = existingCoach
        ? await prisma.coach.update({ where: { id: existingCoach.id }, data: coachData })
        : await prisma.coach.create({ data: { personId: person.id, ...coachData } });

      // Availability — replace this coach's blocks with the parsed ones.
      await prisma.availabilityBlock.deleteMany({ where: { coachId: coach.id } });
      let blockCount = 0;
      for (const day of rec.availability) {
        for (const b of day.blocks) {
          await prisma.availabilityBlock.create({ data: { coachId: coach.id, dayOfWeek: day.code, startTime: b.start, endTime: b.end } });
          blockCount++;
        }
      }
      result.blocks += blockCount;

      // Login — create one so the coach has an account (no email sent here).
      // Needs an email; an email-less coach imports as a profile only.
      if (opts.createLogins && rec.email) {
        const existingUser = await prisma.user.findUnique({ where: { email: rec.email } });
        if (!existingUser) {
          await prisma.user.create({ data: { email: rec.email, passwordHash: await opts.makePasswordHash(), role: "COACH", personId: person.id } });
          result.logins++;
        } else if (!existingUser.personId) {
          await prisma.user.update({ where: { id: existingUser.id }, data: { personId: person.id } });
        }
      }

      if (existingCoach) result.updated++; else result.created++;
      result.perCoach.push({ name: `${person.firstName} ${person.lastName}`.trim(), email: rec.email ?? "no email", action: existingCoach ? "updated" : "created", blocks: blockCount });
    } catch (e) {
      result.errors.push({ name: rec.fullName || rec.email || "(unnamed)", reason: e instanceof Error ? e.message.slice(0, 160) : "unknown error" });
    }
  }

  return result;
}
