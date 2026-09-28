// Cover images: resized and compressed in the browser before upload (a 6 MB poster
// becomes ~250 KB), named like the existing files (16 random letters/digits).

const MAX_W = 1600;
const QUALITY = 0.86;

export function randomName(len = 16) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => abc[b % abc.length]).join('');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('الصورة مش مقروءة'));
    img.src = src;
  });
}

/** File/Blob → { path, base64, previewUrl, width, height, bytes } ready to commit */
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('الملف ده مش صورة.');
  if (file.size > 25 * 1024 * 1024) throw new Error('الصورة أكبر من 25 ميجا.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
    const base64 = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.readAsDataURL(blob);
    });
    const name = randomName();
    // Already small and not too wide: keep the original file (re-encoding would only grow it)
    if (scale === 1 && /^image\/jpe?g$/.test(file.type) && file.size <= blob.size) {
      const orig = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });
      return { path: `content/images/${name}.jpg`, publicPath: `/content/images/${name}.jpg`, base64: orig, previewUrl: URL.createObjectURL(file), width: w, height: h, bytes: file.size, originalBytes: file.size };
    }
    return { path: `content/images/${name}.jpg`, publicPath: `/content/images/${name}.jpg`, base64, previewUrl: URL.createObjectURL(blob), width: w, height: h, bytes: blob.size, originalBytes: file.size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Image from a link: fetched and prepared the same way (works when the host allows it). */
export async function prepareImageFromUrl(link) {
  const res = await fetch(link, { mode: 'cors' }).catch(() => null);
  if (!res || !res.ok) throw new Error('الموقع ده مش بيسمح بتحميل الصورة. نزّلها وارفعها من جهازك.');
  const blob = await res.blob();
  return prepareImage(new File([blob], 'image', { type: blob.type || 'image/jpeg' }));
}

export function kb(bytes) { return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ميجا` : `${Math.round(bytes / 1024)} ك.ب`; }
