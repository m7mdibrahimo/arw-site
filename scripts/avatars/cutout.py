"""Step 2 of the comment avatars (scripts/avatars/fetch.mjs is step 1): each star's 2026 photo, cut square round the
face (owner 2026-10-14: «تقصها علي وشهم بالظبط»), the photo as it is (no background taken away, no colours added).
The face is found by OpenCV's face detector; the newest photo with one clear, close face is used (none: the star is
left out). Every face gets the same framing: the same size, at the same height.
Writes assets/avatars/<slug>.webp and assets/avatars/credits.json; every candidate goes on a review sheet
(scripts/avatars/review/candidates.jpg), the one used in green; «pick» in wrestlers.json chooses another by hand.
Every picture made goes on a second sheet with the star's name (scripts/avatars/review/chosen.jpg), to check each face
is the star's."""
import json, os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

SIZE = 256
OUT = 'assets/avatars'
items = json.load(open('tmp/avatars/list.json', encoding='utf8'))
net = cv2.dnn.readNetFromCaffe('tmp/avatars/deploy.prototxt', 'tmp/avatars/face.caffemodel')


def detect(rgb, ox=0, oy=0):
    """The detector on one picture (it sees it shrunk to 300×300), boxes in the whole photo's pixels"""
    H, W = rgb.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
    net.setInput(blob)
    found = []
    for d in net.forward()[0, 0]:
        conf = float(d[2])
        if conf < 0.5:
            continue
        x1, y1, x2, y2 = (d[3:7] * np.array([W, H, W, H])).astype(int)
        found.append((int(x1) + ox, int(y1) + oy, int(x2 - x1), int(y2 - y1), conf))
    return found


def overlap(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / float(min(a[2] * a[3], b[2] * b[3]) or 1)


def faces(img):
    """Every face: (x, y, w, h, confidence), most sure first. The whole photo, then its parts (halves and thirds,
    overlapping): a face far from the camera is too small for the detector in the whole photo, not in a part of it"""
    rgb = np.array(img)
    H, W = rgb.shape[:2]
    found = detect(rgb)
    for n in (2, 3):
        tw, th = int(W / n * 1.5), int(H / n * 1.5)
        for i in range(n):
            for j in range(n):
                x0 = min(max(0, int(W * i / n - tw * 0.17)), max(0, W - tw))
                y0 = min(max(0, int(H * j / n - th * 0.17)), max(0, H - th))
                found += detect(rgb[y0:y0 + th, x0:x0 + tw], x0, y0)
    # the same face seen in several parts: kept once, the surest
    out = []
    for f in sorted(found, key=lambda f: -f[4]):
        if f[2] > 4 and f[3] > 4 and all(overlap(f, g) < 0.5 for g in out):
            out.append(f)
    return out


def main_face(found, size):
    """The star's face: sure, close (big in the photo, and enough pixels for a sharp picture), and alone"""
    good = [f for f in found if f[4] >= 0.6 and f[2] >= 12]
    if not good:
        return None
    first = max(good, key=lambda f: f[2])
    # enough pixels for a sharp picture (the photo is used at full size, so a face far away can still be big enough)
    if first[4] < 0.85 or first[2] < 80:
        return None
    if any(g is not first and g[2] >= first[2] * 0.6 for g in good):
        return None
    return first


def load(path):
    img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if max(img.size) > 3200:
        k = 3200 / max(img.size)
        img = img.resize((round(img.size[0] * k), round(img.size[1] * k)), Image.LANCZOS)
    return img


def frame(img, f):
    """The square round the face: the face and hair only, as the owner asked («تقصها علي وشهم بالظبط»: no belt, no shoulders), its centre a little above the middle; kept inside
    the photo (moved, then made smaller when the photo is too tight)"""
    x, y, w, h = f[:4]
    side = max(w, h) * 1.6
    side = min(side, img.size[0], img.size[1])
    cx, cy = x + w / 2, y + h * 0.45
    left = min(max(0, cx - side / 2), img.size[0] - side)
    top = min(max(0, cy - side * 0.5), img.size[1] - side)
    return img.crop((round(left), round(top), round(left + side), round(top + side))).resize((SIZE, SIZE), Image.LANCZOS)


credits, sheet, debug = [], [], []
os.makedirs(OUT, exist_ok=True)
for it in items:
    seen = []
    for c in it['candidates']:
        img = load(c['file'])
        found = faces(img)
        seen.append((c, img, main_face(found, img.size), found))
    if 'pick' in it:
        c, img, f, found = seen[it['pick']]
        chosen = (c, img, f or (found[0] if found else None))
    else:
        chosen = next(((c, img, f) for c, img, f, _ in seen if f is not None), None)
    for k, (c, img, f, found) in enumerate(seen):
        thumb = img.copy()
        draw = ImageDraw.Draw(thumb)
        for g in found[:4]:
            draw.rectangle((g[0], g[1], g[0] + g[2], g[1] + g[3]), outline=(0, 200, 0) if f and g[:4] == f[:4] else (230, 0, 0), width=max(3, img.size[0] // 150))
        thumb.thumbnail((180, 180))
        debug.append((it['slug'], k, chosen is not None and c is chosen[0], thumb))
    if chosen is None or chosen[2] is None:
        print(f"✗ {it['slug']}: no photo with one clear, close face")
        continue
    c, img, f = chosen
    out = frame(img, f)
    out.save(os.path.join(OUT, it['slug'] + '.webp'), 'WEBP', quality=86, method=6)
    credits.append({**{k: it.get(k, '') for k in ('slug', 'ar', 'en', 'fed')}, **{k: c.get(k, '') for k in ('owner', 'license', 'source', 'year')}})
    sheet.append((it['en'], f"{it['fed']} {c.get('year', '')}", out))
    print(f"✓ {it['slug']} ({os.path.basename(c['file'])})")

json.dump(credits, open(os.path.join(OUT, 'credits.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f"{len(credits)} stars")

cols = 8
dsheet = Image.new('RGB', (cols * 190, max(1, -(-len(debug) // cols)) * 210), 'white')
dd = ImageDraw.Draw(dsheet)
for i, (slug, k, used, t) in enumerate(debug):
    x, y = (i % cols) * 190, (i // cols) * 210
    dsheet.paste(t, (x + 5, y + 5))
    dd.text((x + 5, y + 190), f"{slug} #{k}", fill=(0, 128, 0) if used else (0, 0, 0))
os.makedirs('scripts/avatars/review', exist_ok=True)
dsheet.save('scripts/avatars/review/candidates.jpg', quality=78)

cols = 10
csheet = Image.new('RGB', (cols * 150, max(1, -(-len(sheet) // cols)) * 170), 'white')
cd = ImageDraw.Draw(csheet)
for i, (name, fed, im) in enumerate(sheet):
    x, y = (i % cols) * 150, (i // cols) * 170
    csheet.paste(im.resize((140, 140), Image.LANCZOS), (x + 5, y + 5))
    cd.text((x + 5, y + 150), f"{name} ({fed})", fill=(0, 0, 0))
csheet.save('scripts/avatars/review/chosen.jpg', quality=82)
