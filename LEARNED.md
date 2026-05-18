# LEARNED.md

Append-only correction log. One or two lines per entry. Newest at the top.
Claude reads this at the start of every session. When Austin corrects a mistake mid-session,
append an entry immediately — do not wait until end of session.

Format: YYYY-MM-DD: description of the mistake and the correct behavior.

---

2026-05-17: A multi-commit batch isn't done until it's pushed. Don't start the next task
with unpushed commits accumulating. (The post-commit auto-push hook now prevents
this, but the instinct — "the batch is not done until it's pushed or you've
explicitly stopped" — must hold even without the hook.)

2026-05-17: When user critiques doc structure as "cluttered" or "unorganized", surface
whether each layer earns its weight and propose deletions of pure-pointer files —
don't just regroup sections. The user wants optimization, not reorganization.

2026-05-17: Repo is SchnappAPI/schnapp-bet, not SchnappAPI/sports-modeling. All work
for this project goes here. Do not confuse the two repos.
