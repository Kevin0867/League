import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSession } from "@/lib/auth";
import { blobToken } from "@/lib/upload";

// Client-direct upload token endpoint for photo/video attachments. The browser
// uploads the file straight to Vercel Blob (so a large practice video never hits
// the serverless request-body limit); this route only mints a short-lived,
// scoped upload token after checking the uploader is signed in.
export const dynamic = "force-dynamic";

const ALLOWED = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
];
const MAX_BYTES = 500 * 1024 * 1024; // 500 MB — comfortably covers a phone clip.

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      token: blobToken(),
      onBeforeGenerateToken: async () => {
        // Only a signed-in user (staff or a family member) may upload.
        const session = await getSession();
        if (!session) throw new Error("Sign in to upload.");
        return { allowedContentTypes: ALLOWED, maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true };
      },
      // Blob calls this server-to-server when the upload finishes; nothing to do —
      // the URL is returned to the client, which puts it on the message form.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 400 });
  }
}
