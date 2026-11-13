"""Draws Herdr's islands background for the yozakura themes: a sky, a pale moon (or sun),
a cherry branch, falling petals, mist bands and seigaiha waves. Writes an SVG.

    python3 yozakura.py out.svg [tsukiyo|yugure|harugasumi]   (tsukiyo by default)

Each sky goes with the theme of the same name, as backgrounds/<name>.png: tsukiyo (月夜, a
moonlit night), yugure (夕暮れ, dusk), harugasumi (春霞, spring haze, the light one)."""
import math
import random
import sys

SKIES = {
    "tsukiyo": dict(
        sky=["#262940", "#1c1e2c", "#14151d"], halo=("#f6dcc8", 0.20, "#e9b9c4", 0.06),
        moon=("#f8ead2", 0.30, "#f1dcc0", 0.22, "#f1d6c4", 0.12),
        mist=("#cfd6f0", 0.026), wave=("#9aa8cc", 0.11), branch=("#0c0d14", 0.9),
        flowers=["#f2b8c6", "#f6cdd7", "#eaa2b4"], heart="#c06a84", bud="#e58fa6",
        petal=("#efb2c1", 0.22, 0.5), shade=0.35),
    # Dusk: the same scene lifted, a glycine-violet sky over the evening's indigo.
    "yugure": dict(
        sky=["#4b4870", "#3d3f59", "#34364b"], halo=("#f6d4c0", 0.28, "#eab4c4", 0.09),
        moon=("#fbefd9", 0.40, "#f4e0c4", 0.30, "#f1d6c4", 0.16),
        mist=("#e6dcf2", 0.04), wave=("#b8bedc", 0.13), branch=("#1a1a26", 0.85),
        flowers=["#f4c0cc", "#f8d4dc", "#eeaabb"], heart="#c87590", bud="#e996ac",
        petal=("#f2bccb", 0.25, 0.55), shade=0.15),
    # Spring haze, by day: washi-pale sky, gold mist as on folding screens, ink branch.
    "harugasumi": dict(
        sky=["#dfe3ec", "#ece7e3", "#efe9df"], halo=("#fff8ea", 0.70, "#fbeee2", 0.25),
        moon=("#f6d0bd", 0.55, "#f3c6b2", 0.45, "#f0bfae", 0.30),
        mist=("#e2cc98", 0.22), wave=("#7d93b8", 0.20), branch=("#4a3c3e", 0.78),
        flowers=["#eda6b9", "#f4c2cf", "#e690a8"], heart="#b4506d", bud="#de8098",
        petal=("#e9a2b5", 0.35, 0.65), shade=0.06),
}
P = SKIES[sys.argv[2] if len(sys.argv) > 2 else "tsukiyo"]

W, H = 3000, 2000
rng = random.Random(7)
out: list[str] = []
add = out.append

PETAL = "M0,0 C-7,-4 -8,-13 -3,-17 L0,-14 L3,-17 C8,-13 7,-4 0,0 Z"
BASE = P["sky"][2]  # the sky's flat bottom, under the waves

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add(f"""<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="{P['sky'][0]}"/><stop offset="0.45" stop-color="{P['sky'][1]}"/>
  <stop offset="0.78" stop-color="{BASE}"/><stop offset="1" stop-color="{BASE}"/>
</linearGradient>
<radialGradient id="halo" cx="2580" cy="470" r="700" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="{P['halo'][0]}" stop-opacity="{P['halo'][1]}"/>
  <stop offset="0.35" stop-color="{P['halo'][2]}" stop-opacity="{P['halo'][3]}"/>
  <stop offset="1" stop-color="{P['halo'][2]}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="moon" cx="0.42" cy="0.4" r="0.65">
  <stop offset="0" stop-color="{P['moon'][0]}" stop-opacity="{P['moon'][1]}"/>
  <stop offset="0.75" stop-color="{P['moon'][2]}" stop-opacity="{P['moon'][3]}"/>
  <stop offset="1" stop-color="{P['moon'][4]}" stop-opacity="{P['moon'][5]}"/>
</radialGradient>
<radialGradient id="shade" cx="0.5" cy="0.45" r="0.75">
  <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity="{P['shade']}"/>
</radialGradient>
<linearGradient id="waveFade" x1="0" y1="1500" x2="0" y2="1850" gradientUnits="userSpaceOnUse">
  <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/>
</linearGradient>
<mask id="waveMask" maskUnits="userSpaceOnUse" x="0" y="0" width="3000" height="2000">
  <rect width="3000" height="2000" fill="url(#waveFade)"/>
</mask>
</defs>""")
add(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
add(f'<rect width="{W}" height="{H}" fill="url(#halo)"/>')

# Kasumi: stacked mist bands with rounded ends, as on folding screens.
for group in [
    [(-200, 690, 1500, 64), (180, 748, 1200, 54), (560, 640, 720, 42)],
    [(1680, 1150, 1500, 70), (2080, 1214, 1100, 52), (1900, 1100, 560, 40)],
    [(520, 1430, 1400, 50), (900, 1478, 900, 40)],
]:
    for x, y, w, h in group:
        add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2}" fill="{P["mist"][0]}" fill-opacity="{P["mist"][1]}"/>')

# The moon (by day, a pale sun).
add('<circle cx="2580" cy="470" r="165" fill="url(#moon)"/>')

# Seigaiha: rows of concentric arcs, each row over the one above it.
R = 72
waves = ['<g mask="url(#waveMask)">']
row = 0
y = 1520.0
while y < H + R:
    offset = 0 if row % 2 == 0 else R
    x = -R + offset
    while x < W + 2 * R:
        waves.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{R}" fill="{BASE}"/>')
        for k in (1.0, 0.76, 0.52, 0.28):
            waves.append(f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{R * k:.1f}" fill="none" stroke="{P["wave"][0]}" stroke-opacity="{P["wave"][1]}" stroke-width="3"/>')
        x += 2 * R
    y += R / 2
    row += 1
waves.append("</g>")
out.extend(waves)


def bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def tangent(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(3 * u * u * (b - a) + 6 * u * t * (c - b) + 3 * t * t * (d - c) for a, b, c, d in zip(p0, p1, p2, p3))


# The branch: (curve, width at its start, width at its end, blossoms along it).
BRANCHES = [
    (((3080, 40), (2820, 30), (2580, 150), (2300, 190)), 24, 14, 7),
    (((2300, 190), (2110, 220), (1960, 170), (1760, 230)), 14, 6, 8),
    (((2600, 120), (2540, 200), (2460, 260), (2380, 290)), 11, 4, 5),
    (((2300, 190), (2250, 120), (2170, 80), (2060, 70)), 9, 4, 5),
    (((2030, 195), (1990, 240), (1940, 265), (1870, 280)), 6, 3, 3),
    (((2860, 50), (2850, 120), (2800, 170), (2740, 195)), 8, 4, 4),
    (((1760, 230), (1700, 250), (1650, 245), (1600, 265)), 5, 2.5, 3),
]
for curve, w0, w1, _ in BRANCHES:
    steps = 24
    for i in range(steps):
        a = bezier(*curve, i / steps)
        b = bezier(*curve, (i + 1) / steps)
        w = w0 + (w1 - w0) * (i + 0.5) / steps
        add(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{P["branch"][0]}" stroke-opacity="{P["branch"][1]}" stroke-width="{w:.1f}" stroke-linecap="round"/>')


def flower(x, y, s, rot, opacity, color):
    petals = "".join(f'<path d="{PETAL}" transform="rotate({rot + k * 72:.1f}) translate(0,-2)"/>' for k in range(5))
    add(f'<g transform="translate({x:.1f},{y:.1f}) scale({s:.2f})" fill="{color}" fill-opacity="{opacity:.2f}">{petals}'
        f'<circle r="3.2" fill="{P["heart"]}" fill-opacity="{min(1, opacity + 0.15):.2f}"/></g>')


for curve, _, _, count in BRANCHES:
    for i in range(count):
        t = (i + 0.5) / count + rng.uniform(-0.04, 0.04)
        x, y = bezier(*curve, t)
        dx, dy = tangent(*curve, t)
        n = math.hypot(dx, dy) or 1
        nx, ny = -dy / n, dx / n
        for _ in range(rng.randint(1, 3)):
            d = rng.uniform(-26, 26)
            color = rng.choice(P["flowers"])
            flower(x + nx * d + rng.uniform(-10, 10), y + ny * d + rng.uniform(-10, 10),
                   rng.uniform(0.85, 1.45), rng.uniform(0, 72), rng.uniform(0.55, 0.85), color)
        if rng.random() < 0.6:  # a bud
            bx, by = x + nx * rng.uniform(-40, 40), y + ny * rng.uniform(-40, 40)
            add(f'<ellipse cx="{bx:.1f}" cy="{by:.1f}" rx="5" ry="7" fill="{P["bud"]}" fill-opacity="0.7" transform="rotate({rng.uniform(0, 180):.0f} {bx:.1f} {by:.1f})"/>')

# Falling petals, drifting down and left from the branch.
for _ in range(34):
    x = rng.uniform(300, 2950)
    y = rng.uniform(380, 1500) if x > 1500 else rng.uniform(600, 1700)
    s = rng.uniform(0.9, 1.9)
    add(f'<path d="{PETAL}" fill="{P["petal"][0]}" fill-opacity="{rng.uniform(P["petal"][1], P["petal"][2]):.2f}" '
        f'transform="translate({x:.0f},{y:.0f}) rotate({rng.uniform(0, 360):.0f}) scale({s:.2f} {s * rng.uniform(0.6, 1):.2f})"/>')

add(f'<rect width="{W}" height="{H}" fill="url(#shade)"/>')
add("</svg>")

with open(sys.argv[1], "w") as f:
    f.write("\n".join(out))
