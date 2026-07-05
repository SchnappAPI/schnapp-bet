#!/usr/bin/env python3
"""Generate Schnappy the Gator SVG assets (poses + head expressions)."""

import os

OUT = "/Users/schnapp/code/schnapp-bet/web/public/mascot"
os.makedirs(OUT, exist_ok=True)

# palette (harmonized with site: brand #5E6AD2, pos #2EBD85)
BODY = "#33A876"  # gator green
BODY_DK = "#22815A"  # shading / ridges
BELLY = "#A9E8C9"
OUTLINE = "#0E3B2A"
VIOLET = "#5E6AD2"
VIOLET_DK = "#4A54B0"
WHITE = "#FFFFFF"
DARK = "#16181B"
GOLD = "#F5A623"
RED = "#E5484D"
POSG = "#2EBD85"

SW = 5  # stroke width


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill="none">\n{body}\n</svg>\n'


def g(tx=0, ty=0, inner="", scale=1, rot=0, cx=0, cy=0):
    t = f"translate({tx} {ty})"
    if rot:
        t += f" rotate({rot} {cx} {cy})"
    if scale != 1:
        t += f" scale({scale})"
    return f'<g transform="{t}">{inner}</g>'


# ---------- head ----------
def eye(cx, cy, pupil="center", lid=None, closed=False, star=False):
    """One eye bump w/ eyeball."""
    s = f'<circle cx="{cx}" cy="{cy}" r="26" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    if closed:
        s += f'<path d="M {cx - 12} {cy + 2} Q {cx} {cy + 10} {cx + 12} {cy + 2}" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round"/>'
        return s
    s += f'<circle cx="{cx}" cy="{cy}" r="15" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="3"/>'
    if star:
        s += f'<path d="M {cx} {cy - 9} L {cx + 2.6} {cy - 2.8} L {cx + 9} {cy - 2.6} L {cx + 4} {cy + 1.8} L {cx + 5.6} {cy + 8.4} L {cx} {cy + 4.6} L {cx - 5.6} {cy + 8.4} L {cx - 4} {cy + 1.8} L {cx - 9} {cy - 2.6} L {cx - 2.6} {cy - 2.8} Z" fill="{GOLD}"/>'
    else:
        dx, dy = {"center": (0, 2), "down": (0, 7), "side": (6, 3), "up": (0, -4)}[pupil]
        s += f'<circle cx="{cx + dx}" cy="{cy + dy}" r="6.5" fill="{DARK}"/>'
        s += f'<circle cx="{cx + dx + 2.2}" cy="{cy + dy - 2.2}" r="2" fill="{WHITE}"/>'
    if lid == "half":
        s += f'<path d="M {cx - 16} {cy - 6} A 16 16 0 0 1 {cx + 16} {cy - 6} L {cx + 16} {cy - 16} A 26 26 0 0 0 {cx - 16} {cy - 16} Z" fill="{BODY}"/>'
        s += f'<line x1="{cx - 15}" y1="{cy - 6}" x2="{cx + 15}" y2="{cy - 6}" stroke="{OUTLINE}" stroke-width="3"/>'
    return s


def glasses(shades=False):
    fill = DARK if shades else "none"
    op = "" if shades else ""
    s = ""
    for cx in (86, 154):
        s += f'<circle cx="{cx}" cy="52" r="20" fill="{fill}" fill-opacity="0.92" stroke="{VIOLET}" stroke-width="5"/>'
        if shades:
            s += f'<path d="M {cx - 10} {cx and 46} L {cx - 2} 44" stroke="#6f7ae0" stroke-width="3" stroke-linecap="round" opacity="0.7"/>'
    s += f'<path d="M 106 52 Q 120 44 134 52" stroke="{VIOLET}" stroke-width="5" fill="none"/>'
    return s


def head(expr="happy", wear_glasses=True, shades=False, brow=None):
    """Front-facing head, local coords ~ (0..240 x 20..165), center 120."""
    e = expr
    # eye variants
    if e == "focused":
        eyes = eye(86, 52, "center", lid="half") + eye(154, 52, "center", lid="half")
    elif e == "skeptical":
        eyes = eye(86, 52, "side", lid="half") + eye(154, 52, "side")
    elif e == "shocked":
        eyes = eye(86, 52, "up") + eye(154, 52, "up")
    elif e == "happy-closed":
        eyes = eye(86, 52, closed=True) + eye(154, 52, closed=True)
    elif e == "starry":
        eyes = eye(86, 52, star=True) + eye(154, 52, star=True)
    elif e == "down":
        eyes = eye(86, 52, "down") + eye(154, 52, "down")
    else:
        eyes = eye(86, 52) + eye(154, 52)

    # mouths on muzzle
    if e in ("happy", "starry", "happy-closed"):
        mouth = (
            f'<path d="M 88 128 Q 120 150 152 128" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
            f'<path d="M 100 133 l 7 9 l 7 -6 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>'
            f'<path d="M 134 135 l 6 8 l 7 -7 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>'
        )
    elif e == "grin":
        mouth = (
            f'<path d="M 84 124 Q 120 154 156 124 Q 120 140 84 124 Z" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4" stroke-linejoin="round"/>'
            f'<path d="M 96 128 l 6 8 l 6 -5 Z" fill="{WHITE}"/>'
            f'<path d="M 138 130 l 5 7 l 6 -6 Z" fill="{WHITE}"/>'
        )
    elif e == "shocked":
        mouth = f'<ellipse cx="120" cy="136" rx="12" ry="14" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
    elif e in ("flat", "skeptical"):
        mouth = (
            f'<path d="M 96 134 L 144 132" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round"/>'
            f'<path d="M 104 136 l 6 8 l 6 -6 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>'
        )
    elif e == "down":
        mouth = f'<path d="M 94 140 Q 120 126 146 140" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
    elif e == "focused":
        mouth = (
            f'<path d="M 92 132 Q 120 142 148 130" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
            f'<path d="M 102 134 l 6 9 l 7 -6 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="2.5" stroke-linejoin="round"/>'
        )
    else:
        mouth = f'<path d="M 92 130 Q 120 146 148 130" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'

    brows = ""
    if brow == "raised":
        brows = f'<path d="M 140 20 Q 154 14 168 22" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'

    s = (
        # head base
        f'<ellipse cx="120" cy="105" rx="72" ry="52" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        # muzzle
        f'<ellipse cx="120" cy="126" rx="48" ry="27" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<ellipse cx="104" cy="112" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        f'<ellipse cx="136" cy="112" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        + mouth
        + eyes
        + (glasses(shades) if wear_glasses else "")
        + brows
    )
    return s


# ---------- body ----------
def tail(flip=False):
    p = f'<path d="M 150 196 Q 208 200 220 176 Q 226 164 216 160 Q 222 150 210 148 Q 216 138 200 140 Q 172 146 150 172 Z" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linejoin="round"/>'
    ridges = (
        f'<path d="M 178 150 l 8 -12 l 6 10 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="3" stroke-linejoin="round"/>'
        f'<path d="M 196 144 l 8 -11 l 5 10 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="3" stroke-linejoin="round"/>'
    )
    s = p + ridges
    if flip:
        s = f'<g transform="translate(240 0) scale(-1 1)">{s}</g>'
    return s


def legs():
    return (
        f'<rect x="88" y="208" width="26" height="26" rx="12" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<rect x="126" y="208" width="26" height="26" rx="12" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    )


def torso():
    return (
        f'<ellipse cx="120" cy="188" rx="46" ry="38" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<ellipse cx="120" cy="194" rx="30" ry="27" fill="{BELLY}"/>'
    )


def arm(x1, y1, x2, y2):
    return (
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{OUTLINE}" stroke-width="{SW + 13}" stroke-linecap="round"/>'
        + f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{BODY}" stroke-width="13" stroke-linecap="round"/>'
    )


# ---------- poses ----------
poses = {}

# 1. default — wave
poses["schnappy-default"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(84, 178, 52, 148)  # left arm raised waving
    + arm(156, 178, 178, 196)  # right arm down
    + head("happy"),
)

# 2. lurk — eyes above the waterline (patience pose)
lurk = (
    # submerged head hint
    f'<ellipse cx="120" cy="118" rx="72" ry="40" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    + eye(86, 72)
    + eye(154, 72)
    + f'<circle cx="86" cy="72" r="20" fill="none" stroke="{VIOLET}" stroke-width="5"/>'
    + f'<circle cx="154" cy="72" r="20" fill="none" stroke="{VIOLET}" stroke-width="5"/>'
    + f'<path d="M 106 72 Q 120 64 134 72" stroke="{VIOLET}" stroke-width="5" fill="none"/>'
    # water band
    + f'<path d="M 0 112 Q 20 104 40 112 T 80 112 T 120 112 T 160 112 T 200 112 T 240 112 L 240 150 L 0 150 Z" fill="{VIOLET}" fill-opacity="0.30"/>'
    + f'<path d="M 0 112 Q 20 104 40 112 T 80 112 T 120 112 T 160 112 T 200 112 T 240 112" stroke="{VIOLET}" stroke-width="4" fill="none"/>'
    # ripples
    + f'<path d="M 28 128 q 10 -5 20 0" stroke="{VIOLET}" stroke-width="3" fill="none" opacity="0.7"/>'
    + f'<path d="M 190 132 q 10 -5 20 0" stroke="{VIOLET}" stroke-width="3" fill="none" opacity="0.7"/>'
)
poses["schnappy-lurk"] = svg(240, 160, lurk)

# 3. analyst — magnifying glass over mini bar chart
chart = (
    f'<rect x="10" y="150" width="72" height="66" rx="8" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
    f'<rect x="20" y="188" width="10" height="20" rx="2" fill="{POSG}"/>'
    f'<rect x="36" y="176" width="10" height="32" rx="2" fill="{POSG}"/>'
    f'<rect x="52" y="182" width="10" height="26" rx="2" fill="{RED}"/>'
    f'<rect x="68" y="164" width="6" height="44" rx="2" fill="{VIOLET}" opacity="0"/>'
    f'<rect x="66" y="166" width="10" height="42" rx="2" fill="{POSG}"/>'
)
magnifier = (
    f'<circle cx="60" cy="150" r="24" fill="#4493F8" fill-opacity="0.18" stroke="{VIOLET}" stroke-width="6"/>'
    f'<line x1="78" y1="168" x2="96" y2="186" stroke="{VIOLET_DK}" stroke-width="9" stroke-linecap="round"/>'
)
poses["schnappy-analyst"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + chart
    + arm(156, 178, 186, 160)
    + head("focused")
    + arm(84, 182, 88, 180)  # stub left arm toward glass
    + magnifier,
)

# 4. lock — holding a bet slip w/ check
slip = (
    f'<g transform="rotate(-8 178 160)">'
    f'<rect x="152" y="128" width="52" height="64" rx="6" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="4"/>'
    f'<line x1="160" y1="142" x2="196" y2="142" stroke="#9094A0" stroke-width="4" stroke-linecap="round"/>'
    f'<line x1="160" y1="152" x2="188" y2="152" stroke="#9094A0" stroke-width="4" stroke-linecap="round"/>'
    f'<path d="M 164 172 l 8 8 l 16 -16" stroke="{POSG}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    f"</g>"
)
poses["schnappy-slip"] = svg(
    240, 250, tail(flip=True) + legs() + torso() + arm(84, 178, 60, 196) + head("grin") + arm(150, 180, 170, 166) + slip
)

# 5. win — arms up + confetti
confetti = "".join(
    f'<rect x="{x}" y="{y}" width="9" height="9" rx="2" fill="{c}" transform="rotate({r} {x} {y})"/>'
    for x, y, c, r in [
        (30, 40, POSG, 20),
        (60, 18, VIOLET, -15),
        (196, 30, GOLD, 30),
        (216, 64, POSG, -20),
        (18, 90, VIOLET, 10),
        (222, 110, GOLD, -30),
        (48, 64, GOLD, 45),
        (206, 14, VIOLET, 15),
    ]
)
poses["schnappy-win"] = svg(
    240, 250, confetti + tail() + legs() + torso() + arm(84, 178, 48, 132) + arm(156, 178, 192, 132) + head("starry")
)

# 6. sweat — flat mouth + sweat drop (loss / fade)
sweat = f'<path d="M 196 58 q 9 12 0 18 q -9 -6 0 -18 Z" fill="#4493F8" stroke="{OUTLINE}" stroke-width="3" stroke-linejoin="round"/>'
poses["schnappy-sweat"] = svg(
    240, 250, tail() + legs() + torso() + arm(84, 178, 58, 192) + arm(156, 178, 182, 192) + head("flat") + sweat
)

# 7. think — hand to chin, eyes up
poses["schnappy-think"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 60, 190)
    + head("shocked-quiet" if False else "hmm"),  # fallback generic
)
# rebuild think properly: pupils up + hand near chin + thought dots
think_head = head("flat").replace("M 96 134 L 144 132", "M 100 136 Q 120 130 140 136")
poses["schnappy-think"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 60, 190)
    + f"<g>{think_head}</g>".replace(eye(86, 52), eye(86, 52, "up")).replace(eye(154, 52), eye(154, 52, "up"))
    + arm(150, 182, 148, 158)
    + f'<circle cx="196" cy="46" r="5" fill="{BODY_DK}"/>'
    + f'<circle cx="208" cy="30" r="7" fill="{BODY_DK}"/>'
    + f'<circle cx="222" cy="10" r="9" fill="{BODY_DK}"/>',
)


# ---------- head-only expression chips (160x150) ----------
def head_chip(expr, shades=False, brow=None, extra=""):
    inner = g(-40, 20, head(expr, shades=shades, brow=brow) + extra)
    return svg(160, 190, inner)


heads = {
    "head-happy": head_chip("happy"),
    "head-focused": head_chip("focused"),
    "head-skeptical": head_chip("skeptical", brow="raised"),
    "head-shocked": head_chip("shocked"),
    "head-starry": head_chip("starry"),
    "head-cool": head_chip("grin", shades=True),
    "head-down": head_chip(
        "down",
        extra=f'<path d="M 196 58 q 9 12 0 18 q -9 -6 0 -18 Z" fill="#4493F8" stroke="{OUTLINE}" stroke-width="3"/>',
    ),
    "head-sleep": head_chip("happy-closed"),
}

for name, content in {**poses, **heads}.items():
    with open(f"{OUT}/{name}.svg", "w") as f:
        f.write(content)
    print(name)
print("done ->", OUT)
