# -*- coding: utf-8 -*-
"""Generate the two demo photos as base64 data URLs (no network needed)."""
import base64
import io
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / "js" / "demo-assets.js"
random.seed(20261121)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(stops, w, h):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / max(1e-6, p1 - p0)
                c = lerp(c0, c1, k)
                break
        else:
            c = stops[-1][1]
        for x in range(w):
            px[x, y] = c
    return img


def sunset():
    w, h = 900, 620
    img = gradient(
        [
            (0.00, (26, 30, 72)),
            (0.28, (67, 52, 116)),
            (0.48, (154, 82, 132)),
            (0.62, (226, 112, 102)),
            (0.74, (250, 154, 97)),
            (0.88, (255, 201, 137)),
            (1.00, (255, 226, 174)),
        ],
        w,
        h,
    )
    draw = ImageDraw.Draw(img, "RGBA")

    # sun glow
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy, r = 610, 330, 58
    for i in range(28, 0, -1):
        rr = r + i * 7
        alpha = int(26 * (1 - i / 29))
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=(255, 214, 150, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), glow)
    draw = ImageDraw.Draw(img, "RGBA")
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 238, 195, 255))
    draw.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6], fill=(255, 248, 220, 255))

    # distant hills
    layers = [
        (0.50, (120, 91, 128, 255)),
        (0.62, (89, 72, 110, 255)),
        (0.74, (58, 52, 88, 255)),
        (0.86, (33, 34, 62, 255)),
    ]
    for i, (base, color) in enumerate(layers):
        pts = [(0, h)]
        x = 0
        amp = 40 - i * 6
        while x <= w:
            y = h * base + math.sin(x / (170 + i * 40) + i * 1.7) * amp + math.sin(x / 57 + i) * 6
            pts.append((x, y))
            x += 12
        pts.append((w, h))
        draw.polygon(pts, fill=color)

    # water reflection strip
    draw.rectangle([0, h - 26, w, h], fill=(28, 27, 48, 255))
    for i in range(60):
        y = h - 24 + random.random() * 22
        x = random.random() * w
        ln = 10 + random.random() * 60
        draw.line([(x, y), (x + ln, y)], fill=(255, 190, 130, 40 + random.randint(0, 40)), width=1)

    # birds
    for bx, by, s in [(250, 200, 9), (285, 185, 6), (740, 210, 8)]:
        draw.arc([bx - s, by - s, bx, by + s], 200, 340, fill=(35, 32, 52, 220), width=2)
        draw.arc([bx, by - s, bx + s, by + s], 200, 340, fill=(35, 32, 52, 220), width=2)

    # film grain
    img = img.convert("RGB")
    grain = Image.effect_noise((w, h), 8).convert("L")
    img = Image.blend(img, Image.merge("RGB", (grain, grain, grain)), 0.035)
    img = img.filter(ImageFilter.GaussianBlur(0.3))
    return img


def latte():
    w, h = 800, 800
    img = Image.new("RGB", (w, h), (124, 82, 52))
    px = img.load()
    for y in range(h):
        for x in range(w):
            grain = (
                math.sin(x * 0.012 + y * 0.004) * 7
                + math.sin(y * 0.05) * 3
                + random.random() * 5
            )
            px[x, y] = (
                int(max(0, min(255, 124 + grain))),
                int(max(0, min(255, 82 + grain * 0.7))),
                int(max(0, min(255, 52 + grain * 0.45))),
            )
    draw = ImageDraw.Draw(img, "RGBA")

    # soft window light
    light = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(light)
    ld.ellipse([60, -140, 520, 320], fill=(255, 240, 210, 46))
    light = light.filter(ImageFilter.GaussianBlur(80))
    img = Image.alpha_composite(img.convert("RGBA"), light)
    draw = ImageDraw.Draw(img, "RGBA")

    cx, cy = 400, 410
    # shadows
    draw.ellipse([cx - 300, cy + 210, cx + 300, cy + 330], fill=(40, 24, 14, 90))
    # saucer
    draw.ellipse([cx - 250, cy - 250, cx + 250, cy + 250], fill=(244, 240, 232, 255))
    draw.ellipse([cx - 246, cy - 246, cx + 246, cy + 246], fill=(228, 223, 213, 255))
    draw.ellipse([cx - 236, cy - 236, cx + 236, cy + 236], fill=(250, 247, 241, 255))
    # cup
    draw.ellipse([cx - 170, cy - 170, cx + 170, cy + 170], fill=(253, 252, 249, 255))
    draw.ellipse([cx - 164, cy - 164, cx + 164, cy + 164], fill=(240, 236, 228, 255))
    # coffee
    draw.ellipse([cx - 140, cy - 140, cx + 140, cy + 140], fill=(92, 55, 31, 255))
    draw.ellipse([cx - 132, cy - 132, cx + 132, cy + 132], fill=(120, 74, 42, 255))
    draw.ellipse([cx - 126, cy - 126, cx + 126, cy + 126], fill=(153, 98, 55, 255))
    # crema swirl
    for i in range(7):
        r = 118 - i * 7
        draw.arc(
            [cx - r, cy - r, cx + r, cy + r],
            start=200 + i * 12,
            end=330 + i * 12,
            fill=(196, 146, 92, 110),
            width=4,
        )
    # latte art heart
    cream = (247, 235, 214, 255)
    draw.ellipse([cx - 74, cy - 80, cx - 4, cy - 14], fill=cream)
    draw.ellipse([cx + 4, cy - 80, cx + 74, cy - 14], fill=cream)
    draw.polygon([(cx - 80, cy - 34), (cx + 80, cy - 34), (cx, cy + 82)], fill=cream)
    # highlight
    draw.arc([cx - 150, cy - 150, cx + 60, cy + 60], 190, 250, fill=(255, 255, 255, 55), width=10)

    # spoon
    draw.ellipse([cx + 232, cy + 92, cx + 306, cy + 150], fill=(214, 214, 218, 255))
    draw.rectangle([cx + 290, cy + 128, cx + 470, cy + 140], fill=(205, 205, 210, 255))
    draw.ellipse([cx + 236, cy + 98, cx + 300, cy + 144], fill=(238, 238, 242, 255))
    return img


def data_url(img, quality=84):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return "data:image/jpeg;base64," + b64, len(buf.getvalue())


def main():
    sunset_url, sunset_size = data_url(sunset(), 86)
    latte_url, latte_size = data_url(latte(), 84)
    payload = {
        "sunset": {"dataUrl": sunset_url, "size": sunset_size, "name": "晚霞.jpg"},
        "latte": {"dataUrl": latte_url, "size": latte_size, "name": "咖啡.jpg"},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "/* Generated by tools/gen-assets.py — local demo images, no network. */\n"
        "window.DEMO_ASSETS = " + json.dumps(payload, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print("wrote", OUT, "sunset", sunset_size, "latte", latte_size, "total", OUT.stat().st_size)


if __name__ == "__main__":
    main()
