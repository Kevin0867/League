import { NextResponse } from "next/server";
import { z } from "zod";
import { ingestRegistration } from "@/lib/domain/intake";

// Automatic registration intake (§3). An external signup source (your website
// enrollment form, a form tool via Zapier/Make, etc.) POSTs a submission here
// and the player record is created in the system immediately — with the same
// duplicate-detection + merge as the on-site form.
//
// Auth: send header `x-api-key: <INTAKE_API_KEY>`. Configure INTAKE_API_KEY in
// the environment; if it isn't set, the endpoint refuses all requests.

const schema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  dob: z.string().optional().nullable(),
  skillLevel: z.string().optional().nullable(),
  duprId: z.string().optional().nullable(),
  duprRating: z.number().optional().nullable(),
  practiceTimePref: z.string().optional().nullable(),
  daysThatDontWork: z.string().optional().nullable(),
  partnerRequests: z.string().optional().nullable(),
  medicalDisclosures: z.string().optional().nullable(),
  mediaOptOut: z.boolean().optional(),
  emergency: z
    .object({
      name: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      relation: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  isCoachRegistration: z.boolean().optional(),
  waiver: z
    .object({
      signed: z.boolean().optional(),
      signatureName: z.string().optional().nullable(),
      parentalConsent: z.boolean().optional(),
    })
    .optional()
    .nullable(),
  seasonId: z.string().optional().nullable(),
  seasonName: z.string().optional().nullable(),
  divisionId: z.string().optional().nullable(),
  divisionName: z.string().optional().nullable(),
  locationPrefs: z
    .array(
      z.object({
        facilityId: z.string().optional().nullable(),
        facilityName: z.string().optional().nullable(),
        marketName: z.string().optional().nullable(),
        rank: z.number().optional(),
      })
    )
    .optional(),
  source: z.string().optional(),
});

export async function POST(req: Request) {
  const key = process.env.INTAKE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "Intake API is not configured." }, { status: 503 });
  }
  const provided = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== key) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const result = await ingestRegistration({ ...parsed.data, source: parsed.data.source ?? "api" });
    return NextResponse.json(
      { ok: true, ...result },
      { status: result.duplicate ? 200 : 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Intake failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
