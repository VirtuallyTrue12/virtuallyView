# Procedural 35mm film strips: seamless horizontally, 8 frames per tile.
import random, math, sys
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # supersample, downscaled at the end for smooth edges
W, H = 4096, 400           # final tile size
FRAMES = 8
PITCH = W // FRAMES        # 512
BAND = 64                  # sprocket band height, top and bottom
FH = H - 2 * BAND          # frame height 272
GAP = 20                   # black gap between frames

PALETTES = [
    [(18, 10, 40), (120, 40, 90), (240, 120, 70), (255, 200, 120)],   # sunset
    [(5, 8, 25), (20, 30, 70), (60, 80, 140), (150, 170, 220)],       # night
    [(10, 30, 40), (20, 90, 100), (230, 140, 70), (250, 210, 150)],   # teal and orange
    [(30, 10, 10), (110, 30, 20), (210, 90, 40), (250, 180, 90)],     # desert
    [(8, 12, 20), (30, 50, 70), (110, 140, 160), (210, 220, 225)],    # overcast
    [(20, 5, 35), (80, 20, 110), (200, 70, 150), (255, 160, 190)],    # neon dusk
]

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def sky(d, x0, y0, w, h, pal):
    for y in range(h):
        t = y / h
        c = lerp(pal[0], pal[1], t / 0.5) if t < 0.5 else lerp(pal[1], pal[3], (t - 0.5) / 0.5)
        d.line([(x0, y0 + y), (x0 + w, y0 + y)], fill=c)

def ridge(rng, w, base, amp, rough):
    pts = [base + rng.uniform(-amp, amp) for _ in range(9)]
    out = []
    for x in range(w + 1):
        f = x / w * 8
        i = min(int(f), 7)
        t = f - i
        t = t * t * (3 - 2 * t)
        y = pts[i] + (pts[i + 1] - pts[i]) * t + math.sin(x * rough) * amp * 0.08
        out.append(y)
    return out

def frame(rng, w, h):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    pal = rng.choice(PALETTES)
    sky(d, 0, 0, w, h, pal)
    kind = rng.choice(['sun', 'moon', 'stars', 'sun', 'city'])
    if kind in ('stars', 'moon') or pal is PALETTES[1]:
        for _ in range(rng.randint(40, 110)):
            x, y, r = rng.uniform(0, w), rng.uniform(0, h * 0.6), rng.uniform(0.6, 2.2) * S
            d.ellipse([x - r, y - r, x + r, y + r], fill=(235, 235, 245))
    if kind in ('sun', 'moon'):
        cx, cy, r = rng.uniform(w * 0.2, w * 0.8), rng.uniform(h * 0.25, h * 0.55), rng.uniform(h * 0.09, h * 0.18)
        glow = Image.new('RGB', (w, h), (0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse([cx - r * 2.4, cy - r * 2.4, cx + r * 2.4, cy + r * 2.4], fill=pal[3])
        glow = glow.filter(ImageFilter.GaussianBlur(r * 1.1))
        img = Image.blend(img, Image.composite(glow, img, glow.convert('L')), 0.55)
        d = ImageDraw.Draw(img)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 238, 205) if kind == 'sun' else (230, 232, 240))
    layers = rng.randint(2, 4)
    for L in range(layers):
        t = (L + 1) / layers
        base = h * (0.55 + 0.3 * t)
        ys = ridge(rng, w, base, h * (0.14 - 0.03 * L), rng.uniform(0.01, 0.04) / S)
        col = lerp(pal[1], (4, 4, 8), 0.45 + 0.5 * t)
        d.polygon([(0, h)] + [(x, ys[x]) for x in range(0, w + 1, 2)] + [(w, h)], fill=col)
    if kind == 'city':
        x = 0
        while x < w:
            bw, bh = rng.uniform(w * 0.04, w * 0.1), rng.uniform(h * 0.15, h * 0.55)
            d.rectangle([x, h - bh, x + bw, h], fill=(6, 6, 12))
            for wy in range(int(h - bh + 8 * S), int(h - 6 * S), int(10 * S)):
                for wx in range(int(x + 5 * S), int(x + bw - 5 * S), int(9 * S)):
                    if rng.random() < 0.28:
                        d.rectangle([wx, wy, wx + 3 * S, wy + 4 * S], fill=(255, 205, 120))
            x += bw + rng.uniform(1, 6) * S
    # vignette and film grain
    vig = Image.new('L', (w, h), 0)
    ImageDraw.Draw(vig).ellipse([-w * 0.25, -h * 0.35, w * 1.25, h * 1.35], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w * 0.08))
    img = Image.composite(img, Image.new('RGB', (w, h), (0, 0, 0)), vig)
    noise = Image.effect_noise((w, h), 22).convert('RGB')
    img = Image.blend(img, noise, 0.06)
    return img

def strip(seed):
    rng = random.Random(seed)
    w, h, band, fh, pitch, gap = W * S, H * S, BAND * S, FH * S, PITCH * S, GAP * S
    tile = Image.new('RGB', (w, h), (11, 11, 13))
    for i in range(FRAMES):
        fw = pitch - gap
        f = frame(rng, fw, fh)
        # soft rounded corners like a real frame gate
        m = Image.new('L', (fw, fh), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, fw - 1, fh - 1], radius=10 * S, fill=255)
        tile.paste(f, (i * pitch + gap // 2, band), m)
    d = ImageDraw.Draw(tile)
    holes = 64                               # divides W evenly, so the tile wraps cleanly
    hp = w / holes
    for k in range(holes):
        x = k * hp + hp * 0.22
        for y in (band * 0.28, h - band * 0.72):
            d.rounded_rectangle([x, y, x + hp * 0.56, y + band * 0.44], radius=5 * S, fill=(214, 206, 190))
    # faint edge print, just dots and ticks
    for k in range(FRAMES):
        x = k * pitch + pitch * 0.5
        d.rectangle([x - 1 * S, band * 0.84, x + 1 * S, band * 0.96], fill=(120, 110, 90))
    return tile.resize((W, H), Image.LANCZOS)

out = sys.argv[1]
for n, seed in enumerate([7, 42, 1337], 1):
    strip(seed).save(f'{out}/filmstrip-{n}.webp', 'WEBP', quality=80, method=6)
    print('wrote', n)
