import type { Prisma } from "@prisma/client";

// One shared, comprehensive person search used by every place that searches
// people (global command palette, registrations, and any future list). It looks
// across ALL name and contact fields — first/last name, every email on file
// (email, email2, email3), and phone — case-insensitive and substring, so a
// partial or secondary value still surfaces the record. A two-word query also
// matches "first last" (and "last first") so full names work.
export function personSearchOR(query: string): Prisma.PersonWhereInput[] {
  const s = query.trim();
  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const or: Prisma.PersonWhereInput[] = [
    { firstName: ci(s) },
    { lastName: ci(s) },
    { email: ci(s) },
    { email2: ci(s) },
    { email3: ci(s) },
    { phone: ci(s) },
  ];
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    or.push({ AND: [{ firstName: ci(first) }, { lastName: ci(last) }] });
    or.push({ AND: [{ firstName: ci(last) }, { lastName: ci(first) }] });
  }
  return or;
}
