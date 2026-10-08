/** The sizes the site asks for (INCIDENTS #369). Any other width is served at the next one up, so only a few copies of
 *  a picture are ever cached and nobody can make the worker resize a picture into thousands of sizes. */
export const WIDTHS = [160, 320, 480, 640, 800, 1080, 1200];
export function widthFor(w: string | null): number | null {
  const n = parseInt(String(w || ""), 10);
  if (!n || n < 1) return null;
  return WIDTHS.find((x) => x >= n) ?? WIDTHS[WIDTHS.length - 1];
}
