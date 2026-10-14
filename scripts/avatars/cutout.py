"""Step 2 of the comment avatars (scripts/avatars/fetch.mjs is step 1): every picture in one look.
A photo loses its background (rembg); the face is found (OpenCV) and every wrestler gets the same framing — the face the
same size, at the same height — on the promotion's colours: WWE red, AEW gold, both fading to dark.
Writes assets/avatars/<slug>.webp and assets/avatars/credits.json; a contact sheet goes to tmp/avatars/sheet.png."""
import json, os, sys
import cv2
import numpy as np
from PIL import Image, ImageDraw
from rembg import remove, new_session

SIZE = 256
OUT = 'assets/avatars'
items = json.load(open('tmp/avatars/list.json', encoding='utf8'))
session = new_session('isnet-general-use')
# OpenCV's face detector (a small neural network, downloaded by the workflow): sure of a face, and of its size
net = cv2.dnn.readNetFromCaffe('tmp/avatars/deploy.prototxt', 'tmp/avatars/face.caffemodel')
# each promotion's colour: WWE red, AEW gold, NJPW blue, MLW purple, UFC charcoal — all fading to dark the same way
COLOURS = {'WWE': ((226, 65, 47), (70, 16, 12)), 'AEW': ((214, 168, 52), (52, 38, 8)), 'NJPW': ((46, 98, 214), (10, 22, 60)),
           'MLW': ((128, 78, 214), (34, 16, 64)), 'UFC': ((104, 110, 120), (16, 17, 20))}

def background(fed):
    inner, outer = COLOURS[fed]
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    d = np.clip(np.sqrt((x - SIZE * 0.5) ** 2 + (y - SIZE * 0.36) ** 2) / (SIZE * 0.78), 0, 1)[..., None]
    rgb = np.array(inner) * (1 - d) + np.array(outer) * d
    return Image.fromarray(np.uint8(rgb)).convert('RGBA')

def faces(rgba):
    """Every face: (x, y, w, h, confidence), most sure first"""
    rgb = np.array(Image.alpha_composite(Image.new('RGBA', rgba.size, (128, 128, 128, 255)), rgba).convert('RGB'))
    H, W = rgb.shape[:2]
    blob = cv2.dnn.blobFromImage(cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), (300, 300)), 1.0, (300, 300), (104.0, 177.0, 123.0))
    net.setInput(blob)
    found = []
    for d in net.forward()[0, 0]:
        conf = float(d[2])
        if conf < 0.5:
            continue
        x1, y1, x2, y2 = (d[3:7] * np.array([W, H, W, H])).astype(int)
        found.append((int(x1), int(y1), int(x2 - x1), int(y2 - y1), conf))
    return sorted(found, key=lambda f: -f[4])

def main_face(found, size):
    """The wrestler's face: sure, big enough, and alone (a photo with a fan has two)"""
    good = [f for f in found if f[4] >= 0.6 and f[2] >= min(size) * 0.06]
    if not good or good[0][4] < 0.85:
        return None
    first = max(good, key=lambda f: f[2])
    if any(g is not first and g[2] >= first[2] * 0.6 for g in good):
        return None
    return first

def load(path):
    img = Image.open(path).convert('RGBA')
    if img.size[0] > 1400:
        img = img.resize((1400, round(img.size[1] * 1400 / img.size[0])), Image.LANCZOS)
    return img

credits, sheet = [], []
debug = []
for it in items:
    # every candidate looked at (they all go on the review sheet); the newest with one sure face is used, unless
    # «pick» in wrestlers.json names one
    seen = []
    for k, c in enumerate(it['candidates']):
        img = load(c['file'])
        found = faces(img)
        seen.append((c, img, main_face(found, img.size), found))
    if 'pick' in it:
        c, img, f, found = seen[it['pick']]
        chosen = (c, img, f or (found[0] if found else None))
    else:
        chosen = next(((c, img, f) for c, img, f, _ in seen if f is not None), None)
    if chosen is None:  # none: the last one (the Wikipedia page's photo, or WWE's only one), framed by its figure
        c, img, _, _ = seen[-1]
        chosen = (c, img, None)
    for k, (c, img, f, found) in enumerate(seen):
        thumb = img.copy().convert('RGB')
        draw = ImageDraw.Draw(thumb)
        for g in found[:4]:
            draw.rectangle((g[0], g[1], g[0] + g[2], g[1] + g[3]), outline=(0, 200, 0) if f and g[:4] == f[:4] else (230, 0, 0), width=max(3, img.size[0] // 150))
        thumb.thumbnail((180, 180))
        debug.append((it['slug'], k, c.get('year', ''), c is chosen[0], thumb))
    c, img, f = chosen
    if img.getextrema()[3][0] == 255:  # no transparency (a photo, not a cut-out): take the background away
        img = remove(img, session=session, post_process_mask=True)
    if f is None:
        f = main_face(faces(img), img.size)
    box = img.getbbox()
    if f is not None:
        x, y, w, h = f[:4]
        side = max(w, h) * 2.45 * it.get('zoom', 1)
        cx, top = x + w / 2 + it.get('dx', 0) * w, y + h / 2 - side * 0.46
        how = 'face'
    else:  # no face found: the head is at the top middle of the figure
        bw = box[2] - box[0]
        side = bw * 0.5 * it.get('zoom', 1)
        cx, top = (box[0] + box[2]) / 2, box[1] - side * 0.08
        how = 'figure'
    crop = img.crop((round(cx - side / 2), round(top), round(cx + side / 2), round(top + side))).resize((SIZE, SIZE), Image.LANCZOS)
    out = Image.alpha_composite(background(it['fed']), crop).convert('RGB')
    out.save(os.path.join(OUT, it['slug'] + '.webp'), 'WEBP', quality=86, method=6)
    credits.append({**{k2: it.get(k2, '') for k2 in ('slug', 'ar', 'en', 'fed')}, **{k2: c.get(k2, '') for k2 in ('owner', 'license', 'source', 'year')}})
    sheet.append(out)
    print(f"✓ {it['slug']} ({how}, {c.get('year') or '?'}, {os.path.basename(c['file'])})")

# every candidate, its faces (green: the one used), for choosing by hand («pick» in wrestlers.json)
cols = 8
dsheet = Image.new('RGB', (cols * 190, -(-len(debug) // cols) * 210), 'white')
dd = ImageDraw.Draw(dsheet)
for i, (slug, k, year, used, t) in enumerate(debug):
    x, y = (i % cols) * 190, (i // cols) * 210
    dsheet.paste(t, (x + 5, y + 5))
    dd.text((x + 5, y + 190), f"{slug} #{k} {year}", fill=(0, 128, 0) if used else (0, 0, 0))
os.makedirs('scripts/avatars/review', exist_ok=True)
dsheet.save('scripts/avatars/review/candidates.jpg', quality=80)

json.dump(credits, open(os.path.join(OUT, 'credits.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
cols = 10
board = Image.new('RGB', (cols * 128, -(-len(sheet) // cols) * 128), 'white')
for i, s in enumerate(sheet):
    board.paste(s.resize((128, 128)), ((i % cols) * 128, (i // cols) * 128))
board.save('tmp/avatars/sheet.png')
