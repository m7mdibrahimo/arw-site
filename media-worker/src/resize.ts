// A picture at the size a page asks for (owner's request, INCIDENTS #369): «/content/images/a.jpg?w=480» is the original
// in R2, resized here and sent as WebP. Nothing is stored: the result lives in Cloudflare's edge cache, the original
// stays the only copy in R2. Before this the build made a resized copy of every picture for every size — ~7,500 files
// that took the site past Cloudflare Pages' 20,000-file limit (INCIDENTS #368).
import decodeJpeg, { init as initJpegDec } from "@jsquash/jpeg/decode";
import decodePng, { init as initPngDec } from "@jsquash/png/decode";
import decodeWebp, { init as initWebpDec } from "@jsquash/webp/decode";
import encodeWebp, { init as initWebpEnc } from "@jsquash/webp/encode";
import encodeJpeg, { init as initJpegEnc } from "@jsquash/jpeg/encode";
import { downscale } from "./downscale";
// @ts-ignore — wasm modules bundled by wrangler
import JPEG_DEC from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
// @ts-ignore
import PNG_DEC from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
// @ts-ignore
import WEBP_DEC from "@jsquash/webp/codec/dec/webp_dec.wasm";
// @ts-ignore
import WEBP_ENC from "@jsquash/webp/codec/enc/webp_enc_simd.wasm";
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

// The JPEG and WebP codecs (C, Emscripten) can be started again; the PNG decoder (Rust) can't, so it starts once.
// A codec that traps — out of memory on a big picture — stays broken in this Worker until restarted: «fresh» starts
// them again, and the picture is tried once more (INCIDENTS #372).
let ready: Promise<unknown> | null = null;
let pngReady: Promise<unknown> | null = null;
const setup = (fresh = false) => {
  if (fresh) ready = null;
  pngReady ||= initPngDec(PNG_DEC);
  return (ready ||= Promise.all([initJpegDec(JPEG_DEC), initWebpDec(WEBP_DEC), initWebpEnc(WEBP_ENC), initJpegEnc(JPEG_ENC), pngReady]));
};
async function withCodecs<T>(fn: () => Promise<T>): Promise<T> {
  await setup();
  try { return await fn(); }
  catch { await setup(true); return await fn(); }
}


const decode = async (buf: ArrayBuffer, type: string): Promise<ImageData> => {
  const t = type.toLowerCase();
  return t.includes("png") ? decodePng(buf) : t.includes("webp") ? decodeWebp(buf) : decodeJpeg(buf);
};


/** The original's bytes → WebP at most `width` wide, proportions kept (a narrower original is only re-encoded). */
export async function resizedWebp(buf: ArrayBuffer, type: string, width: number, quality = 76): Promise<ArrayBuffer> {
  return withCodecs(async () => {
    const img = await decode(buf, type);
    const w = Math.min(width, img.width);
    const h = Math.max(1, Math.round((img.height * w) / img.width));
    return encodeWebp(downscale(img, w, h), { quality });
  });
}

/** How a stored original is kept small (owner's request, INCIDENTS #372 — the pictures' R2 store is 10 GB, «300 KB
 *  is still big», «at most 1280×720»): it fits inside 1280×720, proportions kept (the site never shows a picture wider
 *  than 800; a tall poster is held by its height), and is JPEG of 150 KB or less: quality 72, then 68, then 64 while
 *  still over 150 KB — at 1280×720, side by side at full size, 82, 72 and 68 can't be told apart, even on a poster
 *  full of fine texture and lettering (2026-10-08). JPEG because Instagram and Facebook take nothing else for the posts that share these pictures. */
export const ORIGINAL_MAX_W = 1280;
export const ORIGINAL_MAX_H = 720;
export const ORIGINAL_QUALITY = 72;
export const ORIGINAL_MAX_BYTES = 150 * 1024;
const LOWER_QUALITIES = [68, 64];

/** The original's bytes → a smaller JPEG, or null when it is already small enough / would not get smaller.
 *  Transparent pixels (a PNG logo, a screenshot) go on white, as JPEG has no transparency. */
/** `oversizeOnly`: only a picture still larger than 1280×720 — never a JPEG this already made, as encoding a JPEG
 *  again loses a little each time. */
export async function compressOriginal(buf: ArrayBuffer, type: string, oversizeOnly = false): Promise<ArrayBuffer | null> {
  return withCodecs(() => compressOnce(buf, type, oversizeOnly));
}
async function compressOnce(buf: ArrayBuffer, type: string, oversizeOnly: boolean): Promise<ArrayBuffer | null> {
  let img = await decode(buf, type);
  const scale = Math.min(1, ORIGINAL_MAX_W / img.width, ORIGINAL_MAX_H / img.height);
  if (scale === 1 && (oversizeOnly || buf.byteLength <= ORIGINAL_MAX_BYTES)) return null;
  if (scale < 1) {
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    img = downscale(img, w, h);
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 255) { const k = a / 255; d[i] = d[i] * k + 255 * (1 - k); d[i + 1] = d[i + 1] * k + 255 * (1 - k); d[i + 2] = d[i + 2] * k + 255 * (1 - k); d[i + 3] = 255; }
  }
  let out = await encodeJpeg(img, { quality: ORIGINAL_QUALITY });
  for (const q of LOWER_QUALITIES) { if (out.byteLength <= ORIGINAL_MAX_BYTES) break; out = await encodeJpeg(img, { quality: q }); }
  return out.byteLength < buf.byteLength ? out : null;
}
