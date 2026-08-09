/**
 * Standalone enrollment importer — loads the PURE Academy enrollment CSV into
 * the database pointed to by DATABASE_URL, using the SAME logic as the console
 * import route (src/lib/domain/runEnrollmentImport).
 *
 * Use this when the browser upload isn't an option (e.g. running from CI, where
 * the runner can reach the production database directly).
 *
 * CSV source (first match wins):
 *   1. first CLI arg:            tsx scripts/import-enrollments.ts path/to.csv
 *   2. CSV_PATH env var:         CSV_PATH=path/to.csv tsx scripts/import-enrollments.ts
 *   3. CSV_GZ_B64 env var:       base64(gzip(csv)) — used by the CI workflow so the
 *                                data is never committed to the repo
 *   4. CSV_B64 env var:          base64-encoded CSV contents
 *
 * It is safe to re-run: people are matched on name + email/phone and merged.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PrismaClient } from "@prisma/client";
import {
  previewEnrollments,
  runEnrollmentImport,
} from "../src/lib/domain/runEnrollmentImport";

// A PLAIN client (no encryption extension): this script runs outside the app
// (CI) and has no access to the app's field-encryption key, so writing
// encrypted values would be unreadable in production. Storing the few
// encryptable fields (emergency contact, medical notes) as plaintext is read
// back correctly by the app's legacy-plaintext path.
const prisma = new PrismaClient();

function loadCsv(): string {
  const argPath = process.argv[2];
  if (argPath) return readFileSync(argPath, "utf8");
  if (process.env.CSV_PATH) return readFileSync(process.env.CSV_PATH, "utf8");
  if (process.env.CSV_GZ_B64) {
    return gunzipSync(Buffer.from(process.env.CSV_GZ_B64, "base64")).toString("utf8");
  }
  if (process.env.CSV_B64) return Buffer.from(process.env.CSV_B64, "base64").toString("utf8");
  throw new Error(
    "No CSV provided. Pass a path as the first argument, or set CSV_PATH, CSV_GZ_B64, or CSV_B64."
  );
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const text = loadCsv();
  const pv = previewEnrollments(text);
  console.log(
    `Parsed CSV: ${pv.total} rows -> ${pv.mapped} to import (${pv.skipped} skipped), ` +
      `${pv.child} youth, ${pv.divisions} divisions, locations: ${pv.markets.join(", ")}`
  );
  if (pv.mapped === 0) throw new Error("No valid rows found in CSV.");

  try {
    const r = await runEnrollmentImport(prisma, text);
    console.log(
      `\nImport complete into "${r.seasonName}":\n` +
        `  created:          ${r.created}\n` +
        `  duplicates merged: ${r.duplicates}\n` +
        `  divisions added:   ${r.divisionsAdded}\n` +
        `  errors:            ${r.errors}`
    );

    const people = await prisma.person.count();
    const regs = await prisma.registration.count();
    console.log(`\nDatabase now holds ${people} people and ${regs} registrations.`);

    if (r.errors > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Import failed:", e);
  process.exit(1);
});
