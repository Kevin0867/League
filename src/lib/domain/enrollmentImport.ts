// Enrollment CSV import (§3, §18). Parses the enrollment export and maps each
// row to the shared intake shape. Pure functions — no DB — so they're testable
// and reused by the console import action.

export type MappedEnrollment = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
  divisionName: string | null;
  divisionType: string; // DUPR_BAND | SCHOOL_LEVEL | LESSON
  minRating: number | null;
  maxRating: number | null;
  extraDivisions: string[];
  markets: string[];
  practiceTimePref: string | null;
  partnerRequests: string | null;
  mediaOptOut: boolean;
  waiverSigned: boolean;
  isChild: boolean;
  parentName: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  dateSubmitted: string | null;
};

/** Minimal RFC4180 CSV parser (handles quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const s = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function inferDivision(name: string): { type: string; min: number | null; max: number | null } {
  const low = name.toLowerCase();
  if (low.includes("lesson")) return { type: "LESSON", min: null, max: null };
  if (low.includes("elementary") || low.includes("middle") || low.includes("high school")) {
    return { type: "SCHOOL_LEVEL", min: null, max: null };
  }
  const m = name.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const n = parseFloat(m[1]);
    const plus = name.includes("+");
    return { type: "DUPR_BAND", min: n, max: plus ? null : n };
  }
  return { type: "DUPR_BAND", min: null, max: null };
}

function extractPractice(program: string): string | null {
  const m = program.split(/Practice Times:/i)[1];
  if (!m) return null;
  return m.split("|")[0].trim() || null;
}

function computeAge(dobStr: string | null): number | null {
  if (!dobStr) return null;
  const d = new Date(dobStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date("2026-08-09T00:00:00Z");
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const mm = now.getUTCMonth() - d.getUTCMonth();
  if (mm < 0 || (mm === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}

/** Map one CSV record (header→value) into a MappedEnrollment. */
export function mapEnrollmentRow(rec: Record<string, string>): MappedEnrollment | null {
  const firstName = (rec["First Name"] ?? "").trim();
  const lastName = (rec["Last Name"] ?? "").trim();
  const email = (rec["Email Address"] ?? "").trim().toLowerCase() || null;
  const phone = (rec["Phone Number"] ?? "").trim() || null;
  if (!firstName || !lastName || (!email && !phone)) return null;

  const program = rec["Program"] ?? "";
  const divisionNames = (rec["Program Names"] ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const primary = divisionNames[0] ?? null;
  const div = primary ? inferDivision(primary) : { type: "DUPR_BAND", min: null, max: null };

  const markets = (rec["Locations"] ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const isChild = /My child/i.test(program) || (rec["Participant Type"] ?? "") === "minor";
  const parentFirst = (rec["Parent First Name"] ?? "").trim();
  const parentLast = (rec["Parent Last Name"] ?? "").trim();
  const parentName = parentFirst || parentLast ? `${parentFirst} ${parentLast}`.trim() : null;

  const comments = (rec["Comments"] ?? "").trim();
  const extraDivisions = divisionNames.slice(1);
  const partnerRequests =
    [comments, extraDivisions.length ? `Also interested in: ${extraDivisions.join(", ")}` : ""]
      .filter(Boolean)
      .join(" · ") || null;

  const photo = (rec["Photo/Video Consent"] ?? "").trim().toUpperCase();
  const waiver = (rec["Waiver Signed"] ?? "").trim().toUpperCase();

  return {
    firstName,
    lastName,
    email,
    phone,
    dob: (rec["Date of Birth"] ?? "").trim() || null,
    divisionName: primary,
    divisionType: div.type,
    minRating: div.min,
    maxRating: div.max,
    extraDivisions,
    markets,
    practiceTimePref: extractPractice(program),
    partnerRequests,
    mediaOptOut: photo === "FALSE",
    waiverSigned: waiver === "TRUE",
    isChild,
    parentName,
    emergencyName: (rec["Emergency Contact"] ?? "").trim() || (isChild ? parentName : null),
    emergencyPhone: (rec["Emergency Phone"] ?? "").trim() || null,
    dateSubmitted: (rec["Date Submitted"] ?? "").trim() || null,
  };
}

export type ParseResult = { rows: MappedEnrollment[]; skipped: number; total: number };

export function parseEnrollments(text: string): ParseResult {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skipped: 0, total: 0 };
  const header = grid[0].map((h) => h.trim());
  const dataRows = grid.slice(1).filter((r) => r.some((c) => c.trim() !== ""));
  const rows: MappedEnrollment[] = [];
  let skipped = 0;
  for (const r of dataRows) {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => (rec[h] = r[i] ?? ""));
    const mapped = mapEnrollmentRow(rec);
    if (mapped) rows.push(mapped);
    else skipped++;
  }
  return { rows, skipped, total: dataRows.length };
}

/** Distinct divisions across the mapped rows, for pre-creating them in the season. */
export function distinctDivisions(rows: MappedEnrollment[]) {
  const map = new Map<string, { name: string; type: string; min: number | null; max: number | null }>();
  for (const r of rows) {
    if (r.divisionName && !map.has(r.divisionName)) {
      map.set(r.divisionName, {
        name: r.divisionName,
        type: r.divisionType,
        min: r.minRating,
        max: r.maxRating,
      });
    }
  }
  return [...map.values()];
}

export { computeAge };
