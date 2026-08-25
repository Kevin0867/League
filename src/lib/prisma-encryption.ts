import { Prisma } from "@prisma/client";
import { encryptField } from "./crypto";

// Encrypt sensitive fields transparently on every write, so plaintext never
// reaches the database (§18). Reads return ciphertext; call sites that display
// these fields decrypt explicitly with decryptField (access-controlled to staff).

// Fields encrypted at the application layer (AES-256-GCM) before they ever reach
// the database — a second layer on top of the provider's at-rest disk encryption.
// Only fields that are NEVER filtered, searched, sorted, or matched on may be
// added here: encryption uses a random IV per value, so ciphertext is not
// equal-comparable or orderable. Identifiers used to run the product (name,
// email, phone) are therefore protected by at-rest encryption + access control,
// not this layer. `address` is safe — it's displayed, never queried.
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  person: ["address", "emergencyName", "emergencyPhone", "emergencyRelation", "medicalNotes"],
  registration: ["medicalDisclosures"],
};

const WRITE_OPS = new Set(["create", "update", "updateMany", "upsert", "createMany"]);

type AnyObj = Record<string, unknown>;

function encryptObject(data: unknown, fields: string[]) {
  if (!data || typeof data !== "object") return;
  const obj = data as AnyObj;
  for (const f of fields) {
    const v = obj[f];
    if (typeof v === "string") {
      obj[f] = encryptField(v);
    } else if (v && typeof v === "object" && "set" in (v as AnyObj) && typeof (v as AnyObj).set === "string") {
      (v as AnyObj).set = encryptField((v as AnyObj).set as string);
    }
  }
}

/** Encrypt the encryptable fields in a write operation's args (data/create/update). */
function encryptArgs(args: unknown, fields: string[]) {
  if (!args || typeof args !== "object") return;
  const a = args as AnyObj;
  if (Array.isArray(a.data)) a.data.forEach((d) => encryptObject(d, fields));
  else encryptObject(a.data, fields);
  encryptObject(a.create, fields);
  encryptObject(a.update, fields);
}

function componentFor(fields: string[]) {
  return {
    $allOperations({ operation, args, query }: { operation: string; args: unknown; query: (a: unknown) => Promise<unknown> }) {
      if (WRITE_OPS.has(operation)) encryptArgs(args, fields);
      return query(args);
    },
  };
}

export const encryptionExtension = Prisma.defineExtension({
  name: "field-encryption",
  query: {
    person: componentFor(ENCRYPTED_FIELDS.person),
    registration: componentFor(ENCRYPTED_FIELDS.registration),
  },
});
