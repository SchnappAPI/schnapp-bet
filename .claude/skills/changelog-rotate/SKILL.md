---
name: changelog-rotate
description: Cut a new docs/changelog/YYYY.md file at year boundary or when the current year's file exceeds ~50 KB. Archives the prior year. Use this at the turn of a year or when scrolling past entries is becoming slow.
---

# Rotate the CHANGELOG

`docs/changelog/` has one file per year. The current year's file is the only one regularly read; prior years stay archived in place. This skill cuts a new year.

## When to use this skill

- January 1 of any year (cut the new year file).
- Mid-year if `docs/changelog/<current-year>.md` exceeds ~50 KB and reads are noticeably slow.

## Procedure

### Standard year rotation (Jan 1)

1. Create the new file with the year header:

```bash
NEW_YEAR=$(date +%Y)
cat > docs/changelog/${NEW_YEAR}.md <<EOF
# CHANGELOG ${NEW_YEAR}

Newest entries at the top. Tag taxonomy and format documented in docs/changelog/README.md.

EOF
```

2. Verify the prior year's file is intact and complete. Read its last entries; confirm nothing got lost in a partial write.
3. Commit. CHANGELOG entry (in the new file): `## YYYY-01-01 [docs] Cut CHANGELOG ${NEW_YEAR}.md.`
4. ADR optional. Only needed if format also changed.

### Mid-year split (large file)

This is rare and only justified if the current year's file is genuinely impeding reads. Prefer to wait for January.

1. Pick a clean split point — usually the end of a milestone or a quarter boundary.
2. Move entries older than the split point into a new file `docs/changelog/<year>-H1.md` (or similar).
3. Top of `docs/changelog/<year>.md` (the rolling current file) gets a one-line note: `Older entries: docs/changelog/<year>-H1.md`.
4. ADR documenting the split and the rationale.

## Anti-patterns

- Squashing or rewriting entries during rotation. CHANGELOG is append-only.
- Adding a `<year>.md.bak` or any pre-rotation backup file. Git history holds the prior state.
- Deleting the prior year's file. Keep all years; the file count is small even after a decade.
