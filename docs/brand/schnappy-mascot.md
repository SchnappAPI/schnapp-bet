# Schnappy the Gator — brand mascot

Character sheet for the schnapp.bet mascot, design system v2. Assets:
`web/public/mascot/*.svg` (28 files, served at `schnapp.bet/mascot/<name>.svg`).
Flat vector, 240-unit canvas, transparent background. Every asset AND the
character sheet (`/mascot/index.html`) regenerate from
`web/scripts/generate_mascot.py` (python3, stdlib only) — edit the generator,
never the SVGs or the sheet.

## Identity

- **Name**: Schnappy the Gator (from _schnappen_, German: to snap/grab — the domain's root).
- **Species / home**: Louisiana alligator, "The Bayou Book".
- **Job**: prop-line analyst.
- **Motto**: "Snap only on value."
- **Catchphrase**: "Wait. Watch. Schnapp."

## Backstory

Grew up in a bayou where every other gator lunged at every splash and went hungry.
Schnappy sat still, eyes just above the waterline, and struck once a day — never missed.
A flood washed riverboat-casino odds sheets into his swamp; he read them like water:
mostly noise, a few wrong numbers, and the wrong ones were dinner. He's graded lines
ever since.

## Personality

- Patient, not passive — default state is the lurk; no pick is a fine day.
- Numbers-first — edges and stats, never locks and vibes.
- Dry deadpan humor.
- Honest with losses — one sweat drop, a graded row, no tilt.
- Anti-degen — the counterpoint to chase culture; that is the brand thesis.

Voice lines: "Everything that splashes ain't food." (on parlays) ·
"The line moved. I didn't." (on discipline)

## Locked build spec (v2)

- Line weights: **5 outer / 3 inner / 2.5 teeth**. Outline is `#0E3B2A`, never black.
- Front proportions: eye bumps r26 at y52 (white r15, pupil r6.5); cranium
  (120,105) rx72 ry52; muzzle (120,126) rx48 ry27; torso (120,188) rx46 ry38.
- Eyes sit **on top of the head** (gator, not frog) with round violet specs r20 —
  the brand tie, never removed.
- Shading is **flat two-tone only**: `#22815A` for tail/back scutes, far limbs in
  profile, and cheek scale patches. No gradients, ever.
- Mitt hands with two finger notches; feet with two toe notches; ridged tail;
  two teeth in almost every mouth.

## Turnaround

`schnappy-turn-front` (= `schnappy-hero`, the locked reference) ·
`schnappy-turn-34` (far lens smaller, temple arm shows) ·
`schnappy-turn-side` (one eye periscope, full snout, back scutes).

## Poses (full body)

| File                   | Pose                 | Use                                            |
| ---------------------- | -------------------- | ---------------------------------------------- |
| `schnappy-hero.svg`    | neutral stand        | locked reference; hero art                     |
| `schnappy-default.svg` | wave                 | hero, nav, about                               |
| `schnappy-lurk.svg`    | eyes above waterline | **signature** — empty states, "no value today" |
| `schnappy-point.svg`   | points at odds chip  | odds callouts, value alerts, CTA blocks        |
| `schnappy-thumbs.svg`  | thumbs-up            | graded winner confirmations                    |
| `schnappy-phone.svg`   | checking phone       | app/feature promos                             |
| `schnappy-crossed.svg` | arms crossed         | discipline content, about page                 |
| `schnappy-analyst.svg` | magnifier + chart    | research features, model explainers            |
| `schnappy-slip.svg`    | holds checked slip   | pick published / bet tracked                   |
| `schnappy-win.svg`     | arms up + confetti   | graded winners only                            |
| `schnappy-sweat.svg`   | flat mouth + drop    | close calls, L recaps                          |
| `schnappy-think.svg`   | hand to chin         | line-movement alerts, FAQs                     |

## Expressions (head chips, 32–64px avatars)

Brief-mapped: `head-focused` (confident) · `head-starry` (hyped) · `head-smug` ·
`head-shocked` · `head-deadpan` · `head-happy` (celebrating) · `head-think` ·
`head-down` (disappointed). Plus `head-skeptical` `head-cool` `head-sleep`.

## Exports

- `schnappy-icon-32.svg` — simplified head (no nostrils, one tooth, heavier
  strokes) legible at 16–64px: favicon, avatars, notification badges.
- `schnappy-silhouette.svg` — one-tone `#0E3B2A` mark with violet specs knocked
  in: watermarks, loading states, thumbnail branding.

## Palette

Body `#33A876`, shade `#22815A`, belly `#A9E8C9`, outline `#0E3B2A`, specs
`#5E6AD2` (= site `--brand`), win `#2EBD85` (= `--pos`), loss `#E5484D`
(= `--neg`), star/confetti `#F5A623`.

## Rules

Do: lurk as signature mark; always pair with real data; recolor props per sport
accent (the gator himself never recolors); specs on in every frame.
Don't: remove the glasses; move eyes off the top of the head; win pose/starry
eyes/confetti for ungraded picks; hype framing (fire/lock emojis, "can't lose");
gradients or black outlines; childlike styling or kid-targeted contexts — this
is an 18+ product.
