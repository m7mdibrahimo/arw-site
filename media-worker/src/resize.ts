// A picture at the size a page asks for (owner's request, INCIDENTS #369): «/content/images/a.jpg?w=480» is the original
// in R2, resized here and sent as WebP. Nothing is stored: the result lives in Cloudflare's edge cache, the original
// stays the only copy in R2. Before this the build made a resized copy of every picture for every size — ~7,500 files
// that took the site past Cloudflare Pages' 20,000-file limit (INCIDENTS #368).
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode";
import decodePng, { init as initPngDec } from "@jsquash/png/decode";
import decodeWebp, { init as initWebpDec } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEnc } from "@jsquash/webp/encode";
import encodeJpeg, { init as initJpegEnc } from "@jsquash/jpeg/encode";
import resize, { initResize } from "@jsquash/resize";
// @ts-ignore — wasm modules bundled by wrangler
import JPEG_DEC from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// @ts-ignore
import PNG_DEC from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
// @ts-ignore
import WEBP_DEC from "@jsquash/webp/codec/dec/webp_dec.wasm";
// @ts-ignore
import WEBP_ENC from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";
// @ts-ignore
import RESIZE from "@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm";
// @ts-ignore
import JPEG_ENC from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";

// Workers have no ImageData; the codecs hand pixels around in one
if (!(globalThis as any).ImageData) {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray; width: number; height: number; colorSpace = "srgb";
    constructor(a: any, b: number, c?: number) {
      if (typeof a === "number") { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
      else { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; }
    }
  };
}

let ready: Promise<unknown> | null = null;
const setup = () => (ready ||= Promise.all([initJpegDec(JPEG_DEC), initPngDec(PNG_DEC), initWebpDec(WEBP_DEC), initWebpEnc(WEBP_ENC), initResize(RESIZE), initJpegEnc(JPEG_ENC)]));

const decode = async (buf: ArrayBuffer, type: string): Promise<ImageData> => {
  const t = type.toLowerCase();
  return t.includes("png") ? decodePng(buf) : t.includes("webp") ? decodeWebp(buf) : decodeJpeg(buf);
};


/** The original's bytes → WebP at most `width` wide, proportions kept (a narrower original is only re-encoded). */
export async function resizedWebp(buf: ArrayBuffer, type: string, width: number, quality = 76): Promise<ArrayBuffer> {
  await setup();
  const img = await decode(buf, type);
  const w = Math.min(width, img.width);
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = w < img.width ? await resize(img, { width: w, height: h, method: "lanczos3" }) : img;
  return encodeWebp(out, { quality });
}

/** How a stored original is kept small (owner's request, INCIDENTS #372 — the pictures' R2 store is 10 GB): at most
 *  1600 px wide (sharp on any screen the site has; pages ask smaller sizes anyway) and JPEG at quality 80. JPEG because
 *  Instagram and Facebook take nothing else for the posts that share these pictures. */
export const ORIGINAL_MAX_W = 1600;
export const ORIGINAL_QUALITY = 80;
export const ORIGINAL_MAX_BYTES = 300 * 1024;

/** The original's bytes → a smaller JPEG, or null when it is already small enough / would not get smaller.
 *  Transparent pixels (a PNG logo, a screenshot) go on white, as JPEG has no transparency. */
export async function compressOriginal(buf: ArrayBuffer, type: string): Promise<ArrayBuffer | null> {
  await setup();
  let img = await decode(buf, type);
  if (buf.byteLength <= ORIGINAL_MAX_BYTES && img.width <= ORIGINAL_MAX_W) return null;
  if (img.width > ORIGINAL_MAX_W) {
    const h = Math.max(1, Math.round((img.height * ORIGINAL_MAX_W) / img.width));
    img = await resize(img, { width: ORIGINAL_MAX_W, height: h, method: "lanczos3" });
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 255) { const k = a / 255; d[i] = d[i] * k + 255 * (1 - k); d[i + 1] = d[i + 1] * k + 255 * (1 - k); d[i + 2] = d[i + 2] * k + 255 * (1 - k); d[i + 3] = 255; }
  }
  const out = await encodeJpeg(img, { quality: ORIGINAL_QUALITY });
  return out.byteLength < buf.byteLength ? out : null;
}
