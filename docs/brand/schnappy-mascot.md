# Schnappy the Gator — brand mascot

Character sheet for the schnapp.bet mascot. Assets: `web/public/mascot/*.svg`
(15 files, served at `schnapp.bet/mascot/<name>.svg`). Generator lineage: flat
vector, 240-unit canvas, 5px `#0E3B2A` outline, transparent background.

## Identity

- **Name**: Schnappy the Gator (from _schnappen_, German: to snap/grab — the domain's root).
- **Species / home**: Louisiana alligator, "The Bayou Book".
- **Job**: prop-line analyst.
- **Motto**: "Snap only on value."

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

## Poses (full body)

| File                   | Pose                 | Use                                            |
| ---------------------- | -------------------- | ---------------------------------------------- |
| `schnappy-default.svg` | wave                 | hero, nav, about                               |
| `schnappy-lurk.svg`    | eyes above waterline | **signature** — empty states, "no value today" |
| `schnappy-analyst.svg` | magnifier + chart    | research features, model explainers            |
| `schnappy-slip.svg`    | holds checked slip   | pick published / bet tracked                   |
| `schnappy-win.svg`     | arms up + confetti   | graded winners only                            |
| `schnappy-sweat.svg`   | flat mouth + drop    | close calls, L recaps                          |
| `schnappy-think.svg`   | hand to chin         | line-movement alerts, FAQs                     |

## Expressions (head chips, 32–64px avatars)

`head-happy` `head-focused` `head-skeptical` `head-shocked` `head-starry`
`head-cool` `head-down` `head-sleep`

## Palette

Body `#33A876`, belly `#A9E8C9`, outline `#0E3B2A`, specs `#5E6AD2` (= site `--brand`),
win `#2EBD85` (= `--pos`), loss `#E5484D` (= `--neg`).

## Rules

Do: lurk as signature mark; always pair with real data; recolor props per sport accent.
Don't: remove the glasses; move eyes off the top of the head; win pose for ungraded
picks; hype framing (fire/lock emojis); gradients or black outlines.

All 15 SVGs regenerate from `web/scripts/generate_mascot.py` (python3, stdlib only) —
edit the generator, not the SVGs, so new poses stay on-model.
