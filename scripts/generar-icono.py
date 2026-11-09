# Genera assets/icon.png (512x512) y assets/icon.ico: un núcleo tipo reactor con LEDs.
# Solo hace falta si quieres regenerar el icono:  python scripts/generar-icono.py
import math, colorsys, os
from PIL import Image, ImageDraw, ImageFilter

S = 512
c = S / 2
base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(base)
d.ellipse([8, 8, S - 8, S - 8], fill=(3, 8, 12, 255), outline=(0, 229, 255, 120), width=4)
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
g = ImageDraw.Draw(glow)
for radio, n, desf in [(0.80, 36, 0), (0.62, 28, 0.25), (0.44, 20, 0.5)]:
    R = c * radio
    for i in range(n):
        a = 2 * math.pi * i / n
        r, gg, b = colorsys.hsv_to_rgb((i / n + desf) % 1, 1, 1)
        x, y = c + math.cos(a) * R, c + math.sin(a) * R
        t = 9 if radio > 0.7 else 8
        g.ellipse([x - t, y - t, x + t, y + t], fill=(int(r * 255), int(gg * 255), int(b * 255), 255))
for k in range(40, 0, -1):
    a = int(255 * (1 - k / 40) ** 1.5)
    g.ellipse([c - k * 2.4, c - k * 2.4, c + k * 2.4, c + k * 2.4], fill=(120, 240, 255, a))
g.ellipse([c - 34, c - 34, c + 34, c + 34], fill=(255, 255, 255, 255))
img = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(10)))
img = Image.alpha_composite(img, glow)
out = os.path.join(os.path.dirname(__file__), '..', 'assets')
img.save(os.path.join(out, 'icon.png'))
img.save(os.path.join(out, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Icono generado')
