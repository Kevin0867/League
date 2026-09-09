// Downscale + re-encode an image in the browser before upload, so a big phone
// photo (often 3–12 MB) fits under the serverless request-body limit (~4.5 MB on
// Vercel). Best-effort: if anything fails or the result isn't smaller, the
// original file is returned unchanged.

function loadImageEl(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  try {
    if (!file.type.startsWith("image/")) return file;

    // Decode the image (createImageBitmap is fastest; fall back to <img>).
    let width: number;
    let height: number;
    let source: CanvasImageSource;
    const bitmap = "createImageBitmap" in window ? await createImageBitmap(file).catch(() => null) : null;
    if (bitmap) {
      width = bitmap.width;
      height = bitmap.height;
      source = bitmap;
    } else {
      const img = await loadImageEl(file);
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    }
    if (!width || !height) return file;

    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, w, h);
    if (bitmap && "close" in bitmap) (bitmap as ImageBitmap).close();

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    // Only use the compressed version if it actually came out smaller.
    if (blob && blob.size > 0 && blob.size < file.size) return blob;
    return file;
  } catch {
    return file;
  }
}
