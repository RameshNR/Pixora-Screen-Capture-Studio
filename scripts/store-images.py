"""Makes upload-ready Chrome Web Store images from the originals in store-assets/ (originals untouched)."""
import os
from PIL import Image, ImageOps

SRC = 'store-assets'
OUT = os.path.join(SRC, 'upload')
os.makedirs(OUT, exist_ok=True)
os.makedirs('docs/images', exist_ok=True)


def page_only(src, w=1280, h=800):
    """The page as captured (Pixora's own window only, no backdrop or frame), at the store size."""
    im = Image.open(src).convert('RGB')
    return im if im.size == (w, h) else ImageOps.fit(im, (w, h), Image.LANCZOS, centering=(0.5, 0.0))


# Screenshots are made by tests/e2e/store-shots.spec.ts (STORE_SHOTS=1), 1280 x 800, Purple Lavender theme.
shots = sorted(f for f in os.listdir(SRC) if f.startswith('screenshot-') and f.endswith('.png'))
for f in os.listdir(OUT):
    if f.startswith('screenshot-') and f not in shots:
        os.remove(os.path.join(OUT, f))
for f in shots:
    page_only(os.path.join(SRC, f)).save(os.path.join(OUT, f), optimize=True)
    print('screenshot', f)

for name, size in [('promo-small.png', (440, 280)), ('promo-marquee.png', (1400, 560))]:
    im = Image.open(os.path.join(SRC, name)).convert('RGB')
    ImageOps.fit(im, size, Image.LANCZOS, centering=(0.5, 0.5)).save(os.path.join(OUT, name), optimize=True)
    print('promo', name)

Image.open(os.path.join(SRC, 'icon-128.png')).save(os.path.join(OUT, 'icon-128.png'))

# README pictures: 1600 px wide, no transparency.
for src, dst in [('screenshot-1-editor.png', 'editor.png'), ('screenshot-2-video.png', 'video-editor.png'),
                 ('screenshot-3-clicks.png', 'click-highlights.png'), ('screenshot-4-captures.png', 'hero.png'),
                 ('screenshot-5-themes.png', 'themes.png')]:
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
