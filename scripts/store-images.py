"""Makes upload-ready Chrome Web Store images from the originals in store-assets/ (originals untouched)."""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageOps

SRC = 'store-assets'
OUT = os.path.join(SRC, 'upload')
os.makedirs(OUT, exist_ok=True)
os.makedirs('docs/images', exist_ok=True)


def gradient(w, h, top=(20, 22, 48), bottom=(42, 30, 92)):
    g = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(g)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g


def framed(src, w=1280, h=800, margin=28, radius=14):
    im = Image.open(src).convert('RGB')
    scale = min((w - 2 * margin) / im.width, (h - 2 * margin) / im.height)
    sw, sh = round(im.width * scale), round(im.height * scale)
    im = im.resize((sw, sh), Image.LANCZOS)
    bg = gradient(w, h)
    x, y = (w - sw) // 2, (h - sh) // 2
    # soft shadow
    shadow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([x, y + 8, x + sw, y + sh + 8], radius, fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    bg.paste((0, 0, 0), (0, 0), shadow)
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw - 1, sh - 1], radius, fill=255)
    bg.paste(im, (x, y), mask)
    return bg


shots = sorted(f for f in os.listdir(SRC) if f.startswith('screenshot-') and f.endswith('.png'))
for f in shots:
    framed(os.path.join(SRC, f)).save(os.path.join(OUT, f), optimize=True)
    print('screenshot', f)

for name, size in [('promo-small.png', (440, 280)), ('promo-marquee.png', (1400, 560))]:
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    ImageOps.fit(im, size, Image.LANCZOS, centering=(0.5, 0.5)).save(os.path.join(OUT, name), optimize=True)
    print('promo', name)

Image.open(os.path.join(SRC, 'icon-128.png')).save(os.path.join(OUT, 'icon-128.png'))

# README pictures: 1600 px wide, no transparency.
for src, dst in [('screenshot-1-capture.png', 'hero.png'), ('screenshot-2-editor.png', 'editor.png'),
                 ('screenshot-3-recording.png', 'video-editor.png'), ('screenshot-4-flow.png', 'flow-editor.png'),
                 ('screenshot-6-collage.png', 'collage.png')]:
    p = os.path.join(SRC, src)
    if not os.path.exists(p):
        continue
    im = Image.open(p).convert('RGB')
    im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
    im.save(os.path.join('docs/images', dst), optimize=True)
    print('readme', dst)

for f in sorted(os.listdir(OUT)):
    im = Image.open(os.path.join(OUT, f))
    print(f'{f}: {im.size[0]}x{im.size[1]} {im.mode} {os.path.getsize(os.path.join(OUT, f)) // 1024} KB')
