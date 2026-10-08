// A picture at the size a page asks for (owner's request, INCIDENTS #369): «/content/images/a.jpg?w=480» is the original
// in R2, resized here and sent as WebP. Nothing is stored: the result lives in Cloudflare's edge cache, the original
// stays the only copy in R2. Before this the build made a resized copy of every picture for every size — ~7,500 files
// that took the site past Cloudflare Pages' 20,000-file limit (INCIDENTS #368).
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode";
import decodePng, { init as initPngDec } from "@jsquash/png/decode";
import decodeWebp, { init as initWebpDec } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEnc } from "@jsquash/webp/encode";
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
const setup = () => (ready ||= Promise.all([initJpegDec(JPEG_DEC), initPngDec(PNG_DEC), initWebpDec(WEBP_DEC), initWebpEnc(WEBP_ENC), initResize(RESIZE)]));


/** The original's bytes → WebP at most `width` wide, proportions kept (a narrower original is only re-encoded). */
export async function resizedWebp(buf: ArrayBuffer, type: string, width: number, quality = 76): Promise<ArrayBuffer> {
  await setup();
  const t = type.toLowerCase();
  const img: ImageData = t.includes("png") ? await decodePng(buf) : t.includes("webp") ? await decodeWebp(buf) : await decodeJpeg(buf);
  const w = Math.min(width, img.width);
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = w < img.width ? await resize(img, { width: w, height: h, method: "lanczos3" }) : img;
  return encodeWebp(out, { quality });
}
