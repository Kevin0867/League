import "server-only";
import { put } from "@vercel/blob";

// Image upload to Vercel Blob. Configured via BLOB_READ_WRITE_TOKEN (set
// automatically when Blob storage is enabled on the Vercel project). Returns the
// public served URL.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// Resolve the Vercel Blob read-write token. Vercel names it BLOB_READ_WRITE_TOKEN
// by default, but when a store is attached with a custom env-var prefix (or when
// more than one store is connected) it becomes e.g. MYSTORE_READ_WRITE_TOKEN.
// Accept either: the plain name first, then any variable that looks like a
// Vercel Blob RW token (they all start with "vercel_blob_rw_").
export function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith("READ_WRITE_TOKEN") && typeof v === "string" && v.startsWith("vercel_blob_rw_")) {
      return v;
    }
  }
  return undefined;
}

export function uploadConfigured(): boolean {
  return !!blobToken();
}

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

export async function uploadImage(file: File, keyPrefix: string): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: "No file provided." };
  if (!ALLOWED.has(file.type)) return { ok: false, error: "Use a JPG, PNG, or WebP image." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Image is too large (max 8 MB)." };
  const token = blobToken();
  if (!token) {
    return { ok: false, error: "Image uploads aren't configured yet — enable Blob storage on the Vercel project." };
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  // A stable-ish, unguessable key. Overwrites are fine — addRandomSuffix keeps
  // old and new distinct so a cached image doesn't linger.
  const key = `${keyPrefix}.${ext}`;
  try {
    const blob = await put(key, file, { access: "public", contentType: file.type, addRandomSuffix: true, token });
    return { ok: true, url: blob.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upload failed." };
  }
}
