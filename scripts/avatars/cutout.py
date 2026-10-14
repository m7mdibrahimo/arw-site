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
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
alt = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml')
COLOURS = {'WWE': ((226, 65, 47), (70, 16, 12)), 'AEW': ((214, 168, 52), (52, 38, 8))}

def background(fed):
    inner, outer = COLOURS[fed]
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    d = np.clip(np.sqrt((x - SIZE * 0.5) ** 2 + (y - SIZE * 0.36) ** 2) / (SIZE * 0.78), 0, 1)[..., None]
    rgb = np.array(inner) * (1 - d) + np.array(outer) * d
    return Image.fromarray(np.uint8(rgb)).convert('RGBA')

def face(rgba):
    rgb = Image.alpha_composite(Image.new('RGBA', rgba.size, (128, 128, 128, 255)), rgba).convert('RGB')
    grey = cv2.cvtColor(np.array(rgb), cv2.COLOR_RGB2GRAY)
    w = rgba.size[0]
    for c in (cascade, alt):
        found = c.detectMultiScale(grey, scaleFactor=1.08, minNeighbors=6, minSize=(int(w * 0.07),) * 2)
        if len(found):
            # the highest of the big ones (a face on a shirt or a belt is lower and smaller)
            big = [f for f in found if f[2] >= max(g[2] for g in found) * 0.6]
            return min(big, key=lambda f: f[1])
    return None

credits, sheet = [], []
for it in items:
    img = Image.open(it['file']).convert('RGBA')
    if img.size[0] > 1400:
        img = img.resize((1400, round(img.size[1] * 1400 / img.size[0])), Image.LANCZOS)
    if it['fed'] != 'WWE' or img.getextrema()[3][0] == 255:  # no transparency: take the background away
        img = remove(img, session=session, post_process_mask=True)
    box = img.getbbox()
    f = face(img)
    if f is not None:
        x, y, w, h = f
        side = h * 2.75 * it.get('zoom', 1)
        cx, top = x + w / 2 + it.get('dx', 0) * w, y + h / 2 - side * 0.43
        how = 'face'
    else:  # no face found: the head is at the top middle of the figure
        bw = box[2] - box[0]
        side = bw * 0.55 * it.get('zoom', 1)
        cx, top = (box[0] + box[2]) / 2, box[1] - side * 0.08
        how = 'figure'
    crop = img.crop((round(cx - side / 2), round(top), round(cx + side / 2), round(top + side))).resize((SIZE, SIZE), Image.LANCZOS)
    out = Image.alpha_composite(background(it['fed']), crop).convert('RGB')
    out.save(os.path.join(OUT, it['slug'] + '.webp'), 'WEBP', quality=86, method=6)
    credits.append({k: it.get(k, '') for k in ('slug', 'ar', 'en', 'fed', 'owner', 'license', 'source', 'year')})
    sheet.append(out)
    print(f"✓ {it['slug']} ({how})")

json.dump(credits, open(os.path.join(OUT, 'credits.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
cols = 10
board = Image.new('RGB', (cols * 128, -(-len(sheet) // cols) * 128), 'white')
for i, s in enumerate(sheet):
    board.paste(s.resize((128, 128)), ((i % cols) * 128, (i // cols) * 128))
board.save('tmp/avatars/sheet.png')
