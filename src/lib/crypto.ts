import crypto from "crypto";

// Field-level encryption at rest for minors' personal data, medical disclosures,
// and emergency contacts (§18). AES-256-GCM (authenticated) with a random IV per
// value. Ciphertext is self-describing: "enc:v1:" + base64(iv|tag|ciphertext),
// so we can detect already-encrypted values (idempotent writes), rotate keys by
// version later, and read legacy plaintext gracefully during migration.

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const b64 = process.env.FIELD_ENCRYPTION_KEY;
  if (b64) {
    const k = Buffer.from(b64, "base64");
    if (k.length === 32) return k;
    throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes (base64-encoded).");
  }
  // Dev fallback — derive a stable key from AUTH_SECRET so the app runs without
  // a dedicated key. Production MUST set FIELD_ENCRYPTION_KEY.
  return crypto.createHash("sha256").update(process.env.AUTH_SECRET ?? "dev-secret").digest();
}

export function isEncrypted(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a string value. No-op for null/empty or already-encrypted input. */
export function encryptField<T extends string | null | undefined>(plain: T): T {
  if (plain == null || plain === "") return plain;
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (PREFIX + Buffer.concat([iv, tag, ct]).toString("base64")) as T;
}

/** Decrypt a value. Returns non-encrypted input unchanged (legacy plaintext). */
export function decryptField<T extends string | null | undefined>(val: T): T {
  if (val == null || !isEncrypted(val)) return val;
  try {
    const raw = Buffer.from((val as string).slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8") as T;
  } catch {
    // Tampered/undecryptable — never throw into a page render; surface a marker.
    return "[unable to decrypt]" as T;
  }
}
