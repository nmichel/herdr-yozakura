"""Draws the shoji textures of the yozakura themes, as SVGs to render in a browser:

    python3 shoji.py <out-folder>

- paper-<theme>.svg (2400x1600): washi in the theme's background color, its mottled fibers
  kept faint so text reads on it; the panes' and cards' background (`cover`).
- wood-<wood>.svg (4000x60): a rail of the shoji's frame, its grain along it, seamless end to
  end; the headers show it at 2000x30 (or as tall as they are), side by side as needed.
"""
import math
import random
import sys

# Each theme's paper, in its background color: kinari washi by day; at dusk and by night,
# indigo paper, its fibers catching a little light.
PAPERS = {
    "harugasumi": dict(paper="#f3eee5", mottle="#e7dccb", mottle_opacity=0.4,
                       fiber_light="#fffdf8", fiber_dark="#d9cdb8", fibers=1100, speckle="#7a6a50", speckle_opacity=0.10),
    "yugure": dict(paper="#2a2d3d", mottle="#313447", mottle_opacity=0.35,
                   fiber_light="#373a4e", fiber_dark="#22242f", fibers=1100, speckle="#d8d0c0", speckle_opacity=0.035),
    "tsukiyo": dict(paper="#1c1e29", mottle="#222433", mottle_opacity=0.35,
                    fiber_light="#282b3b", fiber_dark="#15161e", fibers=1100, speckle="#d8d0c0", speckle_opacity=0.03),
}
# The frames' wood: pale hinoki for the light theme, dark chestnut (kuri) for the others.
WOODS = {
    "hinoki": dict(wood="#dcc49d", grain_dark="#c7a87a", grain_light="#ead8b6", line="#b48f5c",
                   rail_top="#f0e2c6", rail_bottom="#b8996a"),
    "kuri": dict(wood="#4d3b2c", grain_dark="#3b2c20", grain_light="#5f4a37", line="#2a1e15",
                 rail_top="#7a644e", rail_bottom="#22180f"),
}


def tinted(name, frequency, octaves, seed, color, gain, bias, stitch=False):
    """A filter painting `color` where fractal noise is high: alpha = gain * noise + bias."""
    tiles = ' stitchTiles="stitch"' if stitch else ""
    return (f'<filter id="{name}" x="0" y="0" width="100%" height="100%">'
            f'<feTurbulence type="fractalNoise" baseFrequency="{frequency}" numOctaves="{octaves}" seed="{seed}"{tiles} result="n"/>'
            f'<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  {gain} 0 0 0 {bias}" result="m"/>'
            f'<feFlood flood-color="{color}"/><feComposite in2="m" operator="in"/></filter>')


def paper(k, rng):
    W, H = 2400, 1600
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           f"""<defs>
{tinted("mottle", "0.0045", 4, 3, k["mottle"], 2.4, -1.05)}
{tinted("grain", "0.9", 1, 5, k["speckle"], 1.2, -0.45)}
</defs>""",
           f'<rect width="{W}" height="{H}" fill="{k["paper"]}"/>',
           # Clouds of denser fibers: a slightly darker paper where the noise is high.
           f'<rect width="{W}" height="{H}" filter="url(#mottle)" opacity="{k["mottle_opacity"]}"/>']
    # Fibers: short curved strands, most lighter than the paper, some darker.
    for _ in range(k["fibers"]):
        x, y = rng.uniform(-50, W + 50), rng.uniform(-50, H + 50)
        length = rng.uniform(18, 150) * (1.6 if rng.random() < 0.08 else 1)
        a = rng.uniform(0, math.pi)
        dx, dy = math.cos(a) * length, math.sin(a) * length
        bend = rng.uniform(-0.35, 0.35) * length
        cx, cy = x + dx / 2 - math.sin(a) * bend, y + dy / 2 + math.cos(a) * bend
        dark = rng.random() < 0.3
        color = k["fiber_dark"] if dark else k["fiber_light"]
        opacity = rng.uniform(0.18, 0.4) if dark else rng.uniform(0.45, 0.85)
        out.append(f'<path d="M{x:.0f},{y:.0f} Q{cx:.0f},{cy:.0f} {x + dx:.0f},{y + dy:.0f}" fill="none" stroke="{color}" '
                   f'stroke-opacity="{opacity:.2f}" stroke-width="{rng.uniform(0.5, 1.7):.1f}" stroke-linecap="round"/>')
    out.append(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity="{k["speckle_opacity"]}"/>')
    out.append("</svg>")
    return "\n".join(out)


def wood(k, rng):
    W, H = 4000, 60
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           f"""<defs>
{tinted("grain", "0.0012 0.11", 3, 11, k["grain_dark"], 2.6, -1.15, stitch=True)}
{tinted("light", "0.0009 0.07", 2, 23, k["grain_light"], 2.2, -1.0, stitch=True)}
<linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="{k['rail_top']}" stop-opacity="0.55"/>
  <stop offset="0.12" stop-color="{k['rail_top']}" stop-opacity="0"/>
  <stop offset="0.8" stop-color="{k['rail_bottom']}" stop-opacity="0"/>
  <stop offset="1" stop-color="{k['rail_bottom']}" stop-opacity="0.45"/>
</linearGradient>
</defs>""",
           f'<rect width="{W}" height="{H}" fill="{k["wood"]}"/>',
           f'<rect width="{W}" height="{H}" filter="url(#grain)"/>',
           f'<rect width="{W}" height="{H}" filter="url(#light)"/>']
    # A few fine grain lines, whole waves over the width so the ends meet.
    for _ in range(9):
        y0 = rng.uniform(4, H - 4)
        amp = rng.uniform(1.0, 4.5)
        waves = rng.randint(1, 4)
        phase = rng.uniform(0, 2 * math.pi)
        pts = " ".join(f"{x},{y0 + amp * math.sin(2 * math.pi * waves * x / W + phase):.1f}" for x in range(0, W + 1, 40))
        out.append(f'<polyline points="{pts}" fill="none" stroke="{k["line"]}" stroke-opacity="{rng.uniform(0.18, 0.4):.2f}" '
                   f'stroke-width="{rng.uniform(0.6, 1.4):.1f}"/>')
    out.append(f'<rect width="{W}" height="{H}" fill="url(#rail)"/>')
    out.append("</svg>")
    return "\n".join(out)


folder = sys.argv[1]
for name, k in PAPERS.items():
    with open(f"{folder}/paper-{name}.svg", "w") as f:
        f.write(paper(k, random.Random(5)))
for name, k in WOODS.items():
    with open(f"{folder}/wood-{name}.svg", "w") as f:
        f.write(wood(k, random.Random(9)))
