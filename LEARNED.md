# LEARNED.md

Append-only correction log. One or two lines per entry. Newest at the top.
Claude reads this at the start of every session. When Austin corrects a mistake mid-session,
append an entry immediately — do not wait until end of session.

Format: YYYY-MM-DD: description of the mistake and the correct behavior.

---

2026-07-05: A middleware change shipped with only tsc as verification 500'd the live ?unlock=go
path (Next's edge runtime rejects a hand-built 3xx with a relative Location — behavior tsc cannot
catch). Middleware/edge-runtime changes must be exercised on a dev server (curl the exact path,
check status + headers) BEFORE merge, same as the UI browser-check rule. The pass-through rewrite
was dev-verified first and worked first try.

2026-07-05: Two sessions independently executed the same "merge PR #11 → deploy → live browser-pass"
task hours apart (duplicate PR #12 merge-commit on main, second deploy, two MEMORY closeouts that
had to be conflict-merged). Before starting a handed-off task, check open/recently-merged PRs and
main's last few commits for evidence another session already did it — MEMORY.md can lag main.

2026-05-18: When you notice something stale or wrong in passing (untracked-but-not-gitignored file,
doc that references a retired component, missed cleanup), fix it in the next commit rather than
queue it. The user has stated they will likely never circle back to follow-ups. This applies to
incidental fix-ups, not scope-creeping a stated task.

2026-05-17: When the user says "simple over complex" + "as efficiently as possible", treat it as
override for any prior recommendation to split / refactor / abstract before porting. Port-as-is.
The earlier MEMORY.md note to "plan a per-concern split before porting grade_props.py" was
correctly ignored in favor of a single port-as-is commit.

2026-05-17: When introducing a new committed file whose name matches a protect-files.sh pattern
(`.env`, `.plist`, `package-lock.json`), update `.claude/hooks/protect-files.sh` ALLOWED list in
the same commit. Don't discover the block when running the Write.

2026-05-17: A multi-commit batch isn't done until it's pushed. Don't start the next task
with unpushed commits accumulating. (The post-commit auto-push hook now prevents
this, but the instinct — "the batch is not done until it's pushed or you've
explicitly stopped" — must hold even without the hook.)

2026-05-17: When user critiques doc structure as "cluttered" or "unorganized", surface
whether each layer earns its weight and propose deletions of pure-pointer files —
don't just regroup sections. The user wants optimization, not reorganization.

2026-05-17: Repo is SchnappAPI/schnapp-bet, not SchnappAPI/sports-modeling. All work
for this project goes here. Do not confuse the two repos.

2026-07-04: A push to main touching web/** fires deploy-web, whose success path SWAPS
/Users/schnapp/code/schnapp-bet for a fresh clone and rm-rf's the old directory —
any uncommitted edits or unpushed commits in the live repo at swap time are destroyed
(happened this session; only an already-auto-pushed commit survived). The workflow now
guards the swap (aborts on dirty tree / unpushed commits), but the session-side rule
stands: while working in this repo, treat every web/** push as scheduling a directory
swap ~20 min out — commit AND verify-push everything promptly; never let work sit
uncommitted while a deploy may be in flight.
