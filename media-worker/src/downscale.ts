/** Smaller copy of a picture by area averaging — every output pixel is the exact average of the source pixels it
 *  covers: the right filter for shrinking, plain JavaScript (its memory is freed after; the Rust resizer ran out of
 *  memory on big pictures and stayed broken, INCIDENTS #372). Never enlarges. */
export function downscale(src: { width: number; height: number; data: Uint8ClampedArray }, w: number, h: number): any {
  const sw = src.width, sh = src.height, s = src.data;
  if (w >= sw && h >= sh) return src;
  const spans = (srcLen: number, dstLen: number) => {
    const k = srcLen / dstLen, out: { i0: number; ws: Float32Array }[] = [];
    for (let d = 0; d < dstLen; d++) {
      const a = d * k, b = (d + 1) * k, i0 = Math.floor(a), i1 = Math.min(srcLen, Math.ceil(b));
      const ws = new Float32Array(i1 - i0);
      for (let i = i0; i < i1; i++) ws[i - i0] = (Math.min(i + 1, b) - Math.max(i, a)) / k;
      out.push({ i0, ws });
    }
    return out;
  };
  const xs = spans(sw, w), ys = spans(sh, h);
  // horizontal pass: sh rows × w columns, then vertical: h × w
  const tmp = new Float32Array(w * sh * 4);
  for (let y = 0; y < sh; y++) {
    const row = y * sw * 4, trow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const { i0, ws } = xs[x];
      let r = 0, g = 0, bl = 0, al = 0;
      for (let j = 0; j < ws.length; j++) { const p = row + (i0 + j) * 4, f = ws[j]; r += s[p] * f; g += s[p + 1] * f; bl += s[p + 2] * f; al += s[p + 3] * f; }
      const t = trow + x * 4; tmp[t] = r; tmp[t + 1] = g; tmp[t + 2] = bl; tmp[t + 3] = al;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const { i0, ws } = ys[y], orow = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, bl = 0, al = 0;
      for (let j = 0; j < ws.length; j++) { const t = ((i0 + j) * w + x) * 4, f = ws[j]; r += tmp[t] * f; g += tmp[t + 1] * f; bl += tmp[t + 2] * f; al += tmp[t + 3] * f; }
      const o = orow + x * 4; out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
    }
  }
  const IData = (globalThis as any).ImageData;
  return IData ? new IData(out, w, h) : { data: out, width: w, height: h };
}
