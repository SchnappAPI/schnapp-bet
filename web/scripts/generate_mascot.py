#!/usr/bin/env python3
"""Generate Schnappy the Gator SVG assets — v2 refined design system.

Single source of truth for every mascot asset AND the character sheet at
web/public/mascot/index.html. Edit this generator, never the SVGs.

Locked design system (v2):
- Canvas: 240 units wide. Full body 240x250, head chips 160x190, exports 128x128.
- Line weights: 5 outer silhouette / 3 inner structure / 2.5 teeth & micro detail.
- Proportions (front): eye bumps r26 at y52; cranium ellipse (120,105) rx72 ry52;
  muzzle (120,126) rx48 ry27; torso (120,188) rx46 ry38; total ~1.4 heads tall.
- Shading: flat two-tone only. BODY_DK for scutes, far limbs, scale patches.
  No gradients, ever.
- The violet analyst specs are the brand tie and never come off.
"""

import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "mascot")
os.makedirs(OUT, exist_ok=True)

# palette (harmonized with site: brand #5E6AD2, pos #2EBD85)
BODY = "#33A876"  # gator green
BODY_DK = "#22815A"  # flat shade: scutes, far limbs, scale patches
BELLY = "#A9E8C9"
OUTLINE = "#0E3B2A"
VIOLET = "#5E6AD2"  # specs = site --brand
VIOLET_DK = "#4A54B0"
WHITE = "#FFFFFF"
DARK = "#16181B"
GOLD = "#F5A623"
RED = "#E5484D"
POSG = "#2EBD85"
WATER = "#4493F8"

SW = 5  # outer stroke
SWI = 3  # inner structure stroke
SWT = 2.5  # teeth / micro detail


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" fill="none">\n{body}\n</svg>\n'


def g(tx=0, ty=0, inner="", rot=0, cx=0, cy=0):
    t = f"translate({tx} {ty})"
    if rot:
        t += f" rotate({rot} {cx} {cy})"
    return f'<g transform="{t}">{inner}</g>'


# ---------- head parts (front view) ----------
def eye(cx, cy, pupil="center", lid=None, closed=False, star=False, pr=6.5):
    """One periscope eye bump w/ eyeball. pupil: center|down|up|side|downside|upside."""
    s = f'<circle cx="{cx}" cy="{cy}" r="26" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    if closed:
        s += f'<path d="M {cx - 12} {cy + 2} Q {cx} {cy + 10} {cx + 12} {cy + 2}" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round"/>'
        return s
    s += f'<circle cx="{cx}" cy="{cy}" r="15" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
    if star:
        s += (
            f'<path d="M {cx} {cy - 9} L {cx + 2.6} {cy - 2.8} L {cx + 9} {cy - 2.6} L {cx + 4} {cy + 1.8}'
            f" L {cx + 5.6} {cy + 8.4} L {cx} {cy + 4.6} L {cx - 5.6} {cy + 8.4} L {cx - 4} {cy + 1.8}"
            f' L {cx - 9} {cy - 2.6} L {cx - 2.6} {cy - 2.8} Z" fill="{GOLD}"/>'
        )
    else:
        dx, dy = {
            "center": (0, 2),
            "down": (0, 7),
            "side": (6, 3),
            "up": (0, -4),
            "downside": (6, 6),
            "upside": (5, -4),
        }[pupil]
        s += f'<circle cx="{cx + dx}" cy="{cy + dy}" r="{pr}" fill="{DARK}"/>'
        s += f'<circle cx="{cx + dx + 2.2}" cy="{cy + dy - 2.2}" r="2" fill="{WHITE}"/>'
    if lid == "half":
        s += f'<path d="M {cx - 16} {cy - 6} A 16 16 0 0 1 {cx + 16} {cy - 6} L {cx + 16} {cy - 16} A 26 26 0 0 0 {cx - 16} {cy - 16} Z" fill="{BODY}"/>'
        s += (
            f'<line x1="{cx - 15}" y1="{cy - 6}" x2="{cx + 15}" y2="{cy - 6}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
        )
    return s


def specs(shades=False, lx=86, rx=154, y=52, r=20):
    """Round violet analyst specs. shades=True fills the lenses dark."""
    fill = f'fill="{DARK}" fill-opacity="0.92"' if shades else 'fill="none"'
    s = ""
    for cx in (lx, rx):
        s += f'<circle cx="{cx}" cy="{y}" r="{r}" {fill} stroke="{VIOLET}" stroke-width="5"/>'
        if shades:
            s += f'<path d="M {cx - 10} {y - 6} L {cx - 2} {y - 8}" stroke="#6f7ae0" stroke-width="{SWI}" stroke-linecap="round" opacity="0.7"/>'
    mx = (lx + rx) / 2
    s += f'<path d="M {lx + r} {y} Q {mx} {y - 8} {rx - r} {y}" stroke="{VIOLET}" stroke-width="5" fill="none"/>'
    return s


def tooth(x, y, flip=False):
    d = f"M {x} {y} l 7 9 l 7 -6 Z" if not flip else f"M {x} {y} l -7 9 l -7 -6 Z"
    return f'<path d="{d}" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWT}" stroke-linejoin="round"/>'


def mouth(kind):
    if kind == "smile":
        return (
            f'<path d="M 88 128 Q 120 150 152 128" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
            + tooth(100, 133)
            + tooth(134, 135)
        )
    if kind == "grin":
        return (
            f'<path d="M 84 124 Q 120 154 156 124 Q 120 140 84 124 Z" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4" stroke-linejoin="round"/>'
            f'<path d="M 96 128 l 6 8 l 6 -5 Z" fill="{WHITE}"/>'
            f'<path d="M 138 130 l 5 7 l 6 -6 Z" fill="{WHITE}"/>'
        )
    if kind == "smirk":
        return (
            f'<path d="M 92 132 Q 120 142 148 130" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
            + tooth(102, 134)
        )
    if kind == "smug":
        return (
            f'<path d="M 94 134 Q 118 144 142 132 Q 149 128 151 122" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
            + tooth(104, 136)
        )
    if kind == "flat":
        return f'<path d="M 96 134 L 144 132" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round"/>' + tooth(
            104, 136
        )
    if kind == "deadpan":
        return f'<path d="M 96 134 L 144 134" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round"/>' + tooth(
            104, 137
        )
    if kind == "frown":
        return f'<path d="M 94 140 Q 120 126 146 140" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
    if kind == "o":
        return f'<ellipse cx="120" cy="136" rx="12" ry="14" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
    if kind == "wavy":
        return f'<path d="M 100 136 Q 110 131 120 135 Q 130 139 140 134" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
    if kind == "soft":
        return f'<path d="M 92 130 Q 120 146 148 130" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
    raise ValueError(kind)


# expression -> (eyes, mouth kind, brows, extra)
def _eyes(spec):
    return spec


EXPRESSIONS = {
    # celebrating / baseline
    "happy": dict(eyes=lambda: eye(86, 52) + eye(154, 52), mouth="smile"),
    # confident — half-lid smirk
    "focused": dict(eyes=lambda: eye(86, 52, lid="half") + eye(154, 52, lid="half"), mouth="smirk"),
    "skeptical": dict(
        eyes=lambda: eye(86, 52, "side", lid="half") + eye(154, 52, "side"),
        mouth="flat",
        brows="raised",
    ),
    "shocked": dict(eyes=lambda: eye(86, 52, "up", pr=5) + eye(154, 52, "up", pr=5), mouth="o"),
    # hyped
    "starry": dict(eyes=lambda: eye(86, 52, star=True) + eye(154, 52, star=True), mouth="grin"),
    "cool": dict(eyes=lambda: eye(86, 52) + eye(154, 52), mouth="grin", shades=True),
    # smug — side glance, hooked smile
    "smug": dict(eyes=lambda: eye(86, 52, "side", lid="half") + eye(154, 52, "side", lid="half"), mouth="smug"),
    "deadpan": dict(eyes=lambda: eye(86, 52, lid="half") + eye(154, 52, lid="half"), mouth="deadpan"),
    # disappointed
    "down": dict(eyes=lambda: eye(86, 52, "down") + eye(154, 52, "down"), mouth="frown"),
    "sleep": dict(eyes=lambda: eye(86, 52, closed=True) + eye(154, 52, closed=True), mouth="soft"),
    "think": dict(eyes=lambda: eye(86, 52, "upside") + eye(154, 52, "upside"), mouth="wavy"),
    # looking down-right at a held prop (phone, slip)
    "checking": dict(eyes=lambda: eye(86, 52, "downside") + eye(154, 52, "downside"), mouth="smirk"),
}


def head(expr="happy"):
    """Front-facing head, local coords ~(0..240 x 20..165), center 120."""
    e = EXPRESSIONS[expr]
    brows = ""
    if e.get("brows") == "raised":
        brows = f'<path d="M 140 20 Q 154 14 168 22" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
    return (
        # cranium
        f'<ellipse cx="120" cy="105" rx="72" ry="52" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        # cheek scale patches — flat shade tone, keeps the flat-vector language
        f'<rect x="54" y="86" width="9" height="7" rx="2.5" fill="{BODY_DK}" opacity="0.55"/>'
        f'<rect x="177" y="86" width="9" height="7" rx="2.5" fill="{BODY_DK}" opacity="0.55"/>'
        # muzzle
        f'<ellipse cx="120" cy="126" rx="48" ry="27" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<ellipse cx="104" cy="112" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        f'<ellipse cx="136" cy="112" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        + mouth(e["mouth"])
        + e["eyes"]()
        + specs(shades=e.get("shades", False))
        + brows
    )


# ---------- body parts (front view) ----------
def tail(flip=False):
    p = f'<path d="M 150 196 Q 208 200 220 176 Q 226 164 216 160 Q 222 150 210 148 Q 216 138 200 140 Q 172 146 150 172 Z" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linejoin="round"/>'
    ridges = (
        f'<path d="M 164 158 l 7 -10 l 5 9 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'
        f'<path d="M 178 150 l 8 -12 l 6 10 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'
        f'<path d="M 196 144 l 8 -11 l 5 10 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'
    )
    s = p + ridges
    if flip:
        s = f'<g transform="translate(240 0) scale(-1 1)">{s}</g>'
    return s


def legs():
    s = ""
    for x in (88, 126):
        s += f'<rect x="{x}" y="208" width="26" height="26" rx="12" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        # toe notches
        s += f'<line x1="{x + 9}" y1="228" x2="{x + 9}" y2="234" stroke="{OUTLINE}" stroke-width="{SWT}"/>'
        s += f'<line x1="{x + 17}" y1="228" x2="{x + 17}" y2="234" stroke="{OUTLINE}" stroke-width="{SWT}"/>'
    return s


def torso():
    return (
        f'<ellipse cx="120" cy="188" rx="46" ry="38" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<ellipse cx="120" cy="194" rx="30" ry="27" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
        # belly plates
        f'<path d="M 94 188 Q 120 194 146 188" stroke="{OUTLINE}" stroke-width="{SWT}" opacity="0.18" fill="none"/>'
        f'<path d="M 96 200 Q 120 206 144 200" stroke="{OUTLINE}" stroke-width="{SWT}" opacity="0.18" fill="none"/>'
    )


def arm(x1, y1, x2, y2):
    return (
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{OUTLINE}" stroke-width="18" stroke-linecap="round"/>'
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{BODY}" stroke-width="13" stroke-linecap="round"/>'
    )


def arm_path(d):
    """Curved arm along an SVG path (for crossed arms etc.)."""
    return (
        f'<path d="{d}" stroke="{OUTLINE}" stroke-width="18" stroke-linecap="round" fill="none"/>'
        f'<path d="{d}" stroke="{BODY}" stroke-width="13" stroke-linecap="round" fill="none"/>'
    )


def hand(cx, cy, fingers=None):
    """Mitt hand. fingers: angle in degrees the notches point toward, or None for fist."""
    s = f'<circle cx="{cx}" cy="{cy}" r="11" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    if fingers is not None:
        s += g(
            0,
            0,
            f'<line x1="{cx - 4}" y1="{cy - 11}" x2="{cx - 4}" y2="{cy - 4}" stroke="{OUTLINE}" stroke-width="{SWT}"/>'
            f'<line x1="{cx + 3}" y1="{cy - 11}" x2="{cx + 3}" y2="{cy - 4}" stroke="{OUTLINE}" stroke-width="{SWT}"/>',
            rot=fingers,
            cx=cx,
            cy=cy,
        )
    return s


def thumb(x1, y1, x2, y2):
    return (
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{OUTLINE}" stroke-width="12" stroke-linecap="round"/>'
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{BODY}" stroke-width="7" stroke-linecap="round"/>'
    )


def finger(x1, y1, x2, y2):
    return (
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{OUTLINE}" stroke-width="11" stroke-linecap="round"/>'
        f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{BODY}" stroke-width="6.5" stroke-linecap="round"/>'
    )


# ---------- props ----------
def odds_chip(x, y):
    """Floating odds chip: dark pill + green up-trend sparkline. No text (font-safe)."""
    return (
        f'<rect x="{x}" y="{y}" width="54" height="34" rx="9" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
        f'<path d="M {x + 8} {y + 24} l 10 -8 l 7 4 l 12 -11" stroke="{POSG}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<path d="M {x + 37} {y + 8} l 9 0 l 0 9" stroke="{POSG}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    )


def phone(x, y, rot=-8):
    inner = (
        f'<rect x="{x}" y="{y}" width="36" height="60" rx="7" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
        f'<rect x="{x + 5}" y="{y + 7}" width="26" height="42" rx="3" fill="#0F1011"/>'
        f'<path d="M {x + 9} {y + 38} l 6 -7 l 5 3 l 8 -10" stroke="{POSG}" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="{x + 18}" cy="{y + 54}" r="2.5" fill="#3A3D42"/>'
    )
    return g(0, 0, inner, rot=rot, cx=x + 18, cy=y + 30)


def slip_prop():
    return (
        f'<g transform="rotate(-8 178 160)">'
        f'<rect x="152" y="128" width="52" height="64" rx="6" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="4"/>'
        f'<line x1="160" y1="142" x2="196" y2="142" stroke="#9094A0" stroke-width="4" stroke-linecap="round"/>'
        f'<line x1="160" y1="152" x2="188" y2="152" stroke="#9094A0" stroke-width="4" stroke-linecap="round"/>'
        f'<path d="M 164 172 l 8 8 l 16 -16" stroke="{POSG}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        f"</g>"
    )


sweat_drop = f'<path d="M 196 58 q 9 12 0 18 q -9 -6 0 -18 Z" fill="{WATER}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'


# ---------- full-body poses ----------
poses = {}

# hero / turnaround front — the locked reference: neutral stand, open mitts
poses["schnappy-hero"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(84, 178, 64, 200)
    + hand(63, 202, fingers=170)
    + arm(156, 178, 176, 200)
    + hand(177, 202, fingers=190)
    + head("happy"),
)
poses["schnappy-turn-front"] = poses["schnappy-hero"]

# default — wave (legacy filename, kept for existing embeds)
poses["schnappy-default"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(84, 178, 54, 150)
    + hand(51, 146, fingers=-35)
    + arm(156, 178, 176, 200)
    + hand(177, 202, fingers=190)
    + head("happy"),
)

# point — pointing at the odds chip, confident
poses["schnappy-point"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 64, 200)
    + hand(63, 202, fingers=170)
    + arm(156, 178, 190, 156)
    + hand(190, 156)
    + finger(196, 152, 212, 142)
    + odds_chip(182, 66)
    + head("focused"),
)

# thumbs-up — graded W, confident
poses["schnappy-thumbs"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 64, 200)
    + hand(63, 202, fingers=170)
    + arm(156, 178, 184, 156)
    + hand(186, 152)
    + thumb(188, 144, 190, 128)
    + head("focused"),
)

# phone — checking the card on schnapp.bet
poses["schnappy-phone"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(84, 178, 64, 200)
    + hand(63, 202, fingers=170)
    + arm(156, 178, 178, 162)
    + phone(168, 118)
    + hand(178, 166)
    + head("checking"),
)

# crossed — arms folded, smug; "the line moved, I didn't"
poses["schnappy-crossed"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm_path("M 84 176 Q 106 196 144 190")
    + hand(146, 190)
    + arm_path("M 156 176 Q 134 198 98 190")
    + hand(96, 190)
    + head("smug"),
)

# win — arms up + confetti (celebrating)
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
    240,
    250,
    confetti
    + tail()
    + legs()
    + torso()
    + arm(84, 178, 48, 134)
    + hand(45, 130, fingers=-25)
    + arm(156, 178, 192, 134)
    + hand(195, 130, fingers=25)
    + head("starry"),
)

# lurk — eyes above the waterline (signature pose)
lurk = (
    f'<ellipse cx="120" cy="118" rx="72" ry="40" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    + eye(86, 72)
    + eye(154, 72)
    + specs(y=72)
    + f'<path d="M 0 112 Q 20 104 40 112 T 80 112 T 120 112 T 160 112 T 200 112 T 240 112 L 240 150 L 0 150 Z" fill="{VIOLET}" fill-opacity="0.30"/>'
    + f'<path d="M 0 112 Q 20 104 40 112 T 80 112 T 120 112 T 160 112 T 200 112 T 240 112" stroke="{VIOLET}" stroke-width="4" fill="none"/>'
    + f'<path d="M 28 128 q 10 -5 20 0" stroke="{VIOLET}" stroke-width="3" fill="none" opacity="0.7"/>'
    + f'<path d="M 190 132 q 10 -5 20 0" stroke="{VIOLET}" stroke-width="3" fill="none" opacity="0.7"/>'
)
poses["schnappy-lurk"] = svg(240, 160, lurk)

# analyst — magnifying glass over mini bar chart
chart = (
    f'<rect x="10" y="150" width="72" height="66" rx="8" fill="{DARK}" stroke="{OUTLINE}" stroke-width="4"/>'
    f'<rect x="20" y="188" width="10" height="20" rx="2" fill="{POSG}"/>'
    f'<rect x="36" y="176" width="10" height="32" rx="2" fill="{POSG}"/>'
    f'<rect x="52" y="182" width="10" height="26" rx="2" fill="{RED}"/>'
    f'<rect x="66" y="166" width="10" height="42" rx="2" fill="{POSG}"/>'
)
magnifier = (
    f'<circle cx="60" cy="150" r="24" fill="{WATER}" fill-opacity="0.18" stroke="{VIOLET}" stroke-width="6"/>'
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
    + hand(188, 158)
    + head("focused")
    + arm(84, 182, 90, 180)
    + magnifier
    + hand(88, 178),
)

# slip — holding a checked bet slip
poses["schnappy-slip"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 62, 198)
    + hand(60, 200, fingers=160)
    + head("checking")
    + arm(150, 180, 168, 168)
    + slip_prop()
    + hand(170, 170),
)

# sweat — flat mouth + drop (close call / honest L)
poses["schnappy-sweat"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(84, 178, 60, 194)
    + hand(58, 196, fingers=160)
    + arm(156, 178, 180, 194)
    + hand(182, 196, fingers=200)
    + head("deadpan")
    + sweat_drop,
)

# think — hand to chin, eyes up, thought dots
poses["schnappy-think"] = svg(
    240,
    250,
    tail(flip=True)
    + legs()
    + torso()
    + arm(84, 178, 62, 192)
    + hand(60, 194, fingers=160)
    + head("think")
    + arm(150, 182, 148, 160)
    + hand(148, 156)
    + f'<circle cx="196" cy="46" r="5" fill="{BODY_DK}"/>'
    + f'<circle cx="208" cy="30" r="7" fill="{BODY_DK}"/>'
    + f'<circle cx="222" cy="10" r="9" fill="{BODY_DK}"/>',
)


# ---------- turnaround: 3/4 and side ----------
def head_34():
    """Three-quarter head, turned toward viewer-left. Near eye full, far eye smaller."""
    return (
        f'<ellipse cx="118" cy="105" rx="70" ry="52" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<rect x="172" y="88" width="9" height="7" rx="2.5" fill="{BODY_DK}" opacity="0.55"/>'
        # muzzle shifted left
        f'<ellipse cx="100" cy="127" rx="46" ry="26" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        f'<ellipse cx="82" cy="113" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        f'<ellipse cx="112" cy="115" rx="4.5" ry="6" fill="{OUTLINE}"/>'
        f'<path d="M 66 130 Q 100 150 138 128" stroke="{OUTLINE}" stroke-width="{SW}" stroke-linecap="round" fill="none"/>'
        + tooth(78, 134)
        + tooth(114, 136)
        # far eye (smaller), then near eye
        + f'<circle cx="142" cy="54" r="23" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        + f'<circle cx="142" cy="54" r="13" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
        + f'<circle cx="138" cy="56" r="5.5" fill="{DARK}"/><circle cx="140" cy="54" r="1.8" fill="{WHITE}"/>'
        + f'<circle cx="78" cy="50" r="26" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
        + f'<circle cx="78" cy="50" r="15" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
        + f'<circle cx="72" cy="52" r="6.5" fill="{DARK}"/><circle cx="74.2" cy="49.8" r="2" fill="{WHITE}"/>'
        # specs — near ring full, far ring smaller, bridge between
        + f'<circle cx="78" cy="50" r="20" fill="none" stroke="{VIOLET}" stroke-width="5"/>'
        + f'<circle cx="142" cy="54" r="17.5" fill="none" stroke="{VIOLET}" stroke-width="5"/>'
        + f'<path d="M 98 50 Q 110 46 124.5 52" stroke="{VIOLET}" stroke-width="5" fill="none"/>'
        # temple arm to far side
        + f'<path d="M 159.5 52 L 180 56" stroke="{VIOLET}" stroke-width="4" fill="none" stroke-linecap="round"/>'
    )


poses["schnappy-turn-34"] = svg(
    240,
    250,
    tail()
    + legs()
    + torso()
    + arm(88, 178, 70, 200)
    + hand(69, 202, fingers=170)
    + arm(152, 178, 172, 200)
    + hand(173, 202, fingers=190)
    + head_34(),
)

# side profile, facing left — same bipedal chibi proportions as the front view
side = (
    # tail sweeps back, lowered to hip height
    g(10, 22, tail())
    # far leg — flat shade tone
    + f'<rect x="132" y="208" width="22" height="26" rx="11" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="4"/>'
    # body
    + f'<ellipse cx="126" cy="188" rx="38" ry="36" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    # near leg
    + f'<rect x="100" y="212" width="26" height="26" rx="12" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    + f'<line x1="109" y1="232" x2="109" y2="238" stroke="{OUTLINE}" stroke-width="{SWT}"/>'
    + f'<line x1="117" y1="232" x2="117" y2="238" stroke="{OUTLINE}" stroke-width="{SWT}"/>'
    # belly patch on the body's front
    + f'<ellipse cx="102" cy="196" rx="15" ry="19" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
    # stub arm hanging at the body's side, clear of the belly — profile keeps limbs minimal
    + arm(122, 180, 112, 198)
    # head: big chibi cranium overlapping the torso
    + f'<ellipse cx="122" cy="102" rx="50" ry="52" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    # scutes along the top-back of the head
    + f'<path d="M 142 56 l 11 -8 l 3 11 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'
    + f'<path d="M 158 70 l 11 -6 l 1 11 Z" fill="{BODY_DK}" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linejoin="round"/>'
    # cheek scale patch
    + f'<rect x="138" y="118" width="9" height="7" rx="2.5" fill="{BODY_DK}" opacity="0.55"/>'
    # snout at eye level, long and forward
    + f'<rect x="24" y="78" width="78" height="30" rx="14" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    # lower jaw
    + f'<rect x="28" y="96" width="66" height="12" rx="6" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
    # mouth line + the signature up-tooth near the tip
    + f'<path d="M 30 96 L 92 96" stroke="{OUTLINE}" stroke-width="{SWI}" stroke-linecap="round"/>'
    + f'<path d="M 44 96 l 5 -8 l 5 8 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWT}" stroke-linejoin="round"/>'
    # nostril bump at snout tip
    + f'<circle cx="32" cy="75" r="8" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
    + f'<ellipse cx="30" cy="74" rx="2.5" ry="3.5" fill="{OUTLINE}"/>'
    # eye bump on top, looking forward — same r26 as front view
    + f'<circle cx="100" cy="44" r="26" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{SW}"/>'
    + f'<circle cx="100" cy="44" r="15" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="{SWI}"/>'
    + f'<circle cx="93.5" cy="46" r="6.5" fill="{DARK}"/><circle cx="95.5" cy="44" r="2" fill="{WHITE}"/>'
    # spec: one ring + temple arm going back
    + f'<circle cx="100" cy="44" r="20" fill="none" stroke="{VIOLET}" stroke-width="5"/>'
    + f'<path d="M 120 46 L 146 52" stroke="{VIOLET}" stroke-width="4" fill="none" stroke-linecap="round"/>'
)
poses["schnappy-turn-side"] = svg(240, 250, side)


# ---------- head-only expression chips (160x190) ----------
def head_chip(expr, extra=""):
    return svg(160, 190, g(-40, 20, head(expr) + extra))


heads = {
    "head-happy": head_chip("happy"),
    "head-focused": head_chip("focused"),
    "head-skeptical": head_chip("skeptical"),
    "head-shocked": head_chip("shocked"),
    "head-starry": head_chip("starry"),
    "head-cool": head_chip("cool"),
    "head-smug": head_chip("smug"),
    "head-deadpan": head_chip("deadpan"),
    "head-down": head_chip("down", extra=sweat_drop),
    "head-sleep": head_chip("sleep"),
    "head-think": head_chip(
        "think",
        extra=f'<circle cx="188" cy="40" r="4" fill="{BODY_DK}"/><circle cx="200" cy="26" r="6" fill="{BODY_DK}"/>',
    ),
}


# ---------- exports: 32px icon + silhouette (128x128) ----------
def icon_body(stroke_main=6, stroke_specs=6):
    """Simplified head for tiny sizes: no nostrils, one tooth, bigger features."""
    return (
        f'<ellipse cx="64" cy="74" rx="46" ry="34" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{stroke_main}"/>'
        f'<ellipse cx="64" cy="88" rx="30" ry="17" fill="{BELLY}" stroke="{OUTLINE}" stroke-width="4"/>'
        f'<path d="M 46 88 Q 64 100 82 88" stroke="{OUTLINE}" stroke-width="4.5" stroke-linecap="round" fill="none"/>'
        f'<path d="M 55 91 l 5 6 l 5 -4 Z" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="2"/>'
        f'<circle cx="42" cy="36" r="18" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{stroke_main}"/>'
        f'<circle cx="42" cy="36" r="10" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="3"/>'
        f'<circle cx="42" cy="38" r="4.5" fill="{DARK}"/>'
        f'<circle cx="86" cy="36" r="18" fill="{BODY}" stroke="{OUTLINE}" stroke-width="{stroke_main}"/>'
        f'<circle cx="86" cy="36" r="10" fill="{WHITE}" stroke="{OUTLINE}" stroke-width="3"/>'
        f'<circle cx="86" cy="38" r="4.5" fill="{DARK}"/>'
        f'<circle cx="42" cy="36" r="14" fill="none" stroke="{VIOLET}" stroke-width="{stroke_specs}"/>'
        f'<circle cx="86" cy="36" r="14" fill="none" stroke="{VIOLET}" stroke-width="{stroke_specs}"/>'
        f'<path d="M 56 36 Q 64 31 72 36" stroke="{VIOLET}" stroke-width="{stroke_specs}" fill="none"/>'
    )


exports = {
    "schnappy-icon-32": svg(128, 128, icon_body()),
    # bold one-tone silhouette; violet spec rings stay — they ARE the brand mark
    "schnappy-silhouette": svg(
        128,
        128,
        f'<ellipse cx="64" cy="74" rx="49" ry="37" fill="{OUTLINE}"/>'
        f'<circle cx="42" cy="36" r="21" fill="{OUTLINE}"/>'
        f'<circle cx="86" cy="36" r="21" fill="{OUTLINE}"/>'
        f'<circle cx="42" cy="36" r="13" fill="none" stroke="{VIOLET}" stroke-width="7"/>'
        f'<circle cx="86" cy="36" r="13" fill="none" stroke="{VIOLET}" stroke-width="7"/>'
        f'<path d="M 55 36 Q 64 31 73 36" stroke="{VIOLET}" stroke-width="7" fill="none"/>',
    ),
}

ALL = {**poses, **heads, **exports}


# ---------- character sheet (index.html) ----------
def build_sheet():
    def art(name):
        return ALL[name].strip()

    def pose_fig(name, title, use):
        return (
            f'<figure class="pose"><div class="art">{art(name)}</div>'
            f"<figcaption><b>{title}</b><span>{use}</span>"
            f"<code>/mascot/{name}.svg</code></figcaption></figure>"
        )

    def chip_fig(name, title):
        return (
            f'<figure class="chip"><div class="art">{art(name)}</div>'
            f"<figcaption>{title}<code>/mascot/{name}.svg</code></figcaption></figure>"
        )

    turnaround = "".join(
        pose_fig(n, t, u)
        for n, t, u in [
            ("schnappy-turn-front", "Front", "The locked hero reference. Every other frame derives from this."),
            (
                "schnappy-turn-34",
                "Three-quarter",
                "Feature layout for angled compositions. Far lens smaller, temple arm shows.",
            ),
            ("schnappy-turn-side", "Side", "Profile: one eye periscope, full snout, back scutes, tail."),
        ]
    )
    expressions = "".join(
        chip_fig(n, t)
        for n, t in [
            ("head-focused", "Confident"),
            ("head-starry", "Hyped"),
            ("head-smug", "Smug"),
            ("head-shocked", "Shocked"),
            ("head-deadpan", "Deadpan"),
            ("head-happy", "Celebrating"),
            ("head-think", "Thinking"),
            ("head-down", "Disappointed"),
            ("head-skeptical", "Skeptical"),
            ("head-cool", "Cool"),
            ("head-sleep", "Off day"),
        ]
    )
    pose_set = "".join(
        pose_fig(n, t, u)
        for n, t, u in [
            ("schnappy-point", "The Point", "Pointing at an edge. Odds callouts, value alerts, CTA blocks."),
            ("schnappy-thumbs", "Thumbs-up", "Graded winner confirmations, positive empty states."),
            ("schnappy-phone", "The Check", "Checking the card on schnapp.bet. App/feature promos."),
            ("schnappy-crossed", "Arms crossed", "“The line moved. I didn’t.” Discipline content, about page."),
            ("schnappy-win", "Cash", "Graded winners only. Never for ungraded picks."),
            ("schnappy-default", "Wave", "Hero, nav, about page. The friendly baseline."),
            ("schnappy-lurk", "The Lurk", "Signature. Patience = the brand thesis. Empty states, ‘no value today’."),
            ("schnappy-analyst", "Analyst", "Research features, model explainers, deep-dive thumbnails."),
            ("schnappy-slip", "The Slip", "Pick published / bet tracked confirmations."),
            ("schnappy-sweat", "Sweat", "Close calls, honest L recaps. No tilt, just the drop."),
            ("schnappy-think", "Hmm", "Line-movement alerts, ‘should you take this?’ content, FAQs."),
        ]
    )
    icon = art("schnappy-icon-32")
    sil = art("schnappy-silhouette")
    sizes = "".join(
        f'<div class="px" style="width:{px}px;height:{px}px">{icon}</div>' for px in (16, 24, 32, 48, 64)
    ) + "".join(f'<div class="px" style="width:{px}px;height:{px}px">{sil}</div>' for px in (24, 48, 96))

    swatches = "".join(
        f'<div class="sw"><i style="background:{hexv}"></i><div><b>{hexv}</b>{label}</div></div>'
        for hexv, label in [
            (BODY, "gator green — body"),
            (BODY_DK, "shade — scutes, far limbs"),
            (BELLY, "belly + muzzle"),
            (OUTLINE, "outline — 5px outer / 3px inner"),
            (VIOLET, "specs = site --brand"),
            (POSG, "win = site --pos"),
            (RED, "loss = site --neg"),
            (GOLD, "star eyes / confetti"),
        ]
    )

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Schnappy — schnapp.bet mascot sheet</title>
<style>
  :root {{
    --canvas:#08090A; --raised:#0F1011; --surface:#16181B; --border:#26282D;
    --fg:#F4F5F6; --muted:#C8CBD1; --subtle:#9094A0;
    --brand:#5E6AD2; --pos:#2EBD85; --neg:#E5484D; --warn:#F5A623;
    --gator:#33A876; --belly:#A9E8C9;
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--canvas); color:var(--fg);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; }}
  .wrap {{ max-width:1020px; margin:0 auto; padding:48px 28px 80px; }}
  .eyebrow {{ font-size:11px; letter-spacing:.14em; text-transform:uppercase;
    color:var(--brand); font-weight:600; }}
  h1 {{ font-size:44px; line-height:1.05; letter-spacing:-.02em; margin:.2em 0 .15em; text-wrap:balance; }}
  h2 {{ font-size:20px; letter-spacing:-.01em; margin:0 0 4px; }}
  section {{ margin-top:56px; }}
  section > .eyebrow {{ display:block; margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:8px; }}
  .hero {{ display:grid; grid-template-columns:1.2fr .8fr; gap:32px; align-items:center; }}
  .hero .art svg {{ width:100%; max-width:340px; display:block; margin:0 auto;
    filter:drop-shadow(0 12px 40px rgba(51,168,118,.25)); }}
  .tag {{ color:var(--muted); font-size:17px; max-width:46ch; }}
  .tag b {{ color:var(--pos); }}
  .factrow {{ display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; }}
  .fact {{ background:var(--surface); border:1px solid var(--border); border-radius:8px;
    padding:8px 14px; font-size:13px; color:var(--muted); }}
  .fact b {{ display:block; font-size:11px; letter-spacing:.1em;
    text-transform:uppercase; color:var(--subtle); margin-bottom:2px; font-weight:600; }}
  .cols {{ display:grid; grid-template-columns:1fr 1fr; gap:28px; }}
  .card {{ background:var(--raised); border:1px solid var(--border); border-radius:12px; padding:22px 24px; }}
  .card p {{ color:var(--muted); margin:.5em 0; }}
  ul {{ margin:.4em 0; padding-left:20px; color:var(--muted); }}
  li {{ margin:.35em 0; }}
  li b {{ color:var(--fg); }}
  .quote {{ border-left:3px solid var(--gator); padding:2px 14px; color:var(--fg);
    font-style:italic; margin:14px 0 0; }}
  .quote span {{ display:block; font-style:normal; color:var(--subtle); font-size:12px; margin-top:4px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:18px; }}
  .pose, .chip {{ margin:0; background:var(--raised); border:1px solid var(--border);
    border-radius:12px; padding:18px 16px 14px; display:flex; flex-direction:column; gap:10px; }}
  .pose .art svg {{ width:100%; height:190px; display:block; }}
  .chip .art svg {{ width:100%; height:120px; display:block; }}
  figcaption {{ font-size:13px; color:var(--subtle); display:flex; flex-direction:column; gap:3px; }}
  figcaption b {{ color:var(--fg); font-size:14px; }}
  code {{ font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--brand);
    background:rgba(94,106,210,.10); border-radius:4px; padding:1px 6px; align-self:flex-start; }}
  .chipgrid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:14px; }}
  .swatches {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; }}
  .sw {{ border:1px solid var(--border); border-radius:10px; overflow:hidden; background:var(--raised); }}
  .sw i {{ display:block; height:56px; }}
  .sw div {{ padding:8px 12px; font-size:12px; color:var(--muted); }}
  .sw div b {{ display:block; color:var(--fg); }}
  .rules {{ display:grid; grid-template-columns:1fr 1fr; gap:28px; }}
  .do b {{ color:var(--pos); }} .dont b {{ color:var(--neg); }}
  .sizes {{ display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap;
    background:var(--raised); border:1px solid var(--border); border-radius:12px; padding:20px; }}
  .px svg {{ width:100%; height:100%; display:block; }}
  table {{ border-collapse:collapse; font-size:13px; color:var(--muted); width:100%; }}
  th, td {{ text-align:left; padding:6px 10px; border-bottom:1px solid var(--border); }}
  th {{ color:var(--subtle); font-size:11px; letter-spacing:.1em; text-transform:uppercase; }}
  @media (max-width:760px) {{ .hero,.cols,.rules {{ grid-template-columns:1fr; }} h1 {{ font-size:34px; }} }}
</style>
</head>
<body>
<div class="wrap">

  <div class="hero">
    <div>
      <span class="eyebrow">schnapp.bet · brand mascot · character sheet v2</span>
      <h1>Schnappy<br>the Gator</h1>
      <p class="tag">A bayou gator who never chases. He sits at the waterline, watches the
      numbers drift, and strikes exactly once — when the line is wrong.
      <b>Wait. Watch. Schnapp.</b></p>
      <div class="factrow">
        <div class="fact"><b>Species</b>Louisiana alligator</div>
        <div class="fact"><b>Home</b>The Bayou Book</div>
        <div class="fact"><b>Job</b>Prop-line analyst</div>
        <div class="fact"><b>Motto</b>“Snap only on value.”</div>
      </div>
    </div>
    <div class="art">{art("schnappy-hero")}</div>
  </div>

  <section>
    <span class="eyebrow">Backstory</span>
    <div class="cols">
      <div class="card">
        <p>Schnappy grew up in a Louisiana bayou where every other gator lunged at whatever
        splashed. They went hungry a lot. Schnappy noticed something: the water tells you
        everything if you sit still long enough. So he waited — eyes just above the surface —
        and struck maybe once a day. He never missed.</p>
        <p>One flood season a riverboat casino washed a stack of odds sheets into his swamp.
        He read them the way he read the water: most numbers were noise, a few were wrong,
        and the wrong ones were dinner. He's been grading lines ever since. The name on the
        door — <b>schnapp.bet</b> — is his: <i>schnappen</i>, to snap it up.</p>
      </div>
      <div class="card">
        <h2>Personality</h2>
        <ul>
          <li><b>Patient, not passive.</b> Default state is the lurk. No pick is a fine day.</li>
          <li><b>Numbers-first.</b> Talks in stats and edges, never in locks and vibes.</li>
          <li><b>Dry humor.</b> Deadpan one-liners; the specs do the smiling.</li>
          <li><b>Honest with Ls.</b> Losses get one sweat drop and a graded row, never tilt.</li>
          <li><b>Anti-degen.</b> He is the opposite of chase culture; that is the whole point of him.</li>
        </ul>
        <p class="quote">“Everything that splashes ain’t food.”<span>— Schnappy, on parlays</span></p>
        <p class="quote">“The line moved. I didn’t.”<span>— Schnappy, on discipline</span></p>
      </div>
    </div>
  </section>

  <section>
    <span class="eyebrow">Locked reference — build spec</span>
    <div class="cols">
      <div class="card">
        <h2>Construction</h2>
        <ul>
          <li>Flat vector on a <b>240-unit canvas</b> (full body 240×250). Transparent background.</li>
          <li>Line weights: <b>5 outer / 3 inner / 2.5 teeth</b>. Never black — outline is {OUTLINE}.</li>
          <li>Eye bumps r26 at y52 · white r15 · pupil r6.5. Cranium (120,105) rx72 ry52.
              Muzzle (120,126) rx48 ry27. Torso (120,188) rx46 ry38.</li>
          <li>Eyes sit <b>on top of the head</b> (gator, not frog). Round violet specs r20 —
              the brand tie, never removed.</li>
          <li>Shading is <b>flat two-tone only</b>: {BODY_DK} scutes, far limbs, cheek scale
              patches. No gradients, ever.</li>
          <li>Two teeth in almost every mouth. Ridged tail. Mitt hands with two finger notches.</li>
        </ul>
      </div>
      <div><div class="swatches">{swatches}</div></div>
    </div>
  </section>

  <section>
    <span class="eyebrow">Turnaround</span>
    <div class="grid">{turnaround}</div>
  </section>

  <section>
    <span class="eyebrow">Expressions — head chips (avatars, reaction posts, inline UI)</span>
    <div class="chipgrid">{expressions}</div>
  </section>

  <section>
    <span class="eyebrow">Poses — full body</span>
    <div class="grid">{pose_set}</div>
  </section>

  <section>
    <span class="eyebrow">Exports — icon &amp; silhouette</span>
    <div class="sizes">{sizes}</div>
    <p style="color:var(--subtle);font-size:13px;margin-top:10px">
      <code>/mascot/schnappy-icon-32.svg</code> — simplified head (no nostrils, one tooth,
      heavier strokes) legible at 16–64px: favicon, avatars, notification badges.
      <code>/mascot/schnappy-silhouette.svg</code> — one-tone mark with the violet specs
      knocked in: watermarks, loading states, thumbnail branding.
    </p>
  </section>

  <section>
    <span class="eyebrow">Usage rules</span>
    <div class="rules">
      <div class="card do">
        <h2><b>Do</b></h2>
        <ul>
          <li>Use the lurk as the signature mark; pair Schnappy with real data.</li>
          <li>Keep the specs on in every frame; keep eyes on top of the head.</li>
          <li>Recolor props per sport accent; the gator himself never recolors.</li>
          <li>Win pose for <b>graded</b> winners only; losses get the sweat drop and a graded row.</li>
          <li>Voice: adult, dry, numbers-first. He talks probabilities, not promises.</li>
        </ul>
      </div>
      <div class="card dont">
        <h2><b>Don’t</b></h2>
        <ul>
          <li>No gradients, no black outlines, no drop shadows baked into the SVGs.</li>
          <li>No hype framing — fire/lock emojis, “can’t lose”, streak-chasing.</li>
          <li>Never childlike styling or kid-targeted contexts — this is an 18+ product.</li>
          <li>Don’t redraw by hand — every asset regenerates from
              <code>web/scripts/generate_mascot.py</code>.</li>
          <li>Don’t use the win pose, starry eyes, or confetti on ungraded picks.</li>
        </ul>
      </div>
    </div>
  </section>

</div>
</body>
</html>
"""


for name, content in ALL.items():
    with open(f"{OUT}/{name}.svg", "w") as f:
        f.write(content)
    print(name)
with open(f"{OUT}/index.html", "w") as f:
    f.write(build_sheet())
print("index.html")
print("done ->", OUT, f"({len(ALL)} files + sheet)")
