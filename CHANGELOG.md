# Changelog

## Since your last download

**Changed: `src/lib/Hero.svelte`**
- Layout switched from left-text/right-card split to a centered layout (headline → subheadline → two CTAs, all centered) — matching the placement structure from the Saywell reference.
- Added a second CTA: "See how it works" (scrolls to the How it works section).
- Added 4 floating skill-gap cards positioned around the hero periphery (e.g. "Frontend Dev · 2 skills to close", "Data Analyst · Ready to apply ✓") with a subtle looping float animation — our own content/colors, not Saywell's job-card copy or colors.
- Resume-scan card (the signature animated visual) now sits centered below the CTAs instead of beside the text.

**Added**
- `.gitignore`, and this project is now a git repo (see below) so future changes are tracked as real commits instead of blind re-zips.

## How to sync this with your local copy

Since you already have the previous zip downloaded, don't just overwrite it blindly. Recommended:

1. `cd` into your existing local project folder.
2. If you haven't already, run `git init && git add -A && git commit -m "baseline"` on **your current copy** first — that preserves anything you may have already edited.
3. Unzip this new version into a separate temp folder.
4. Diff the two (e.g. `diff -rq old-folder new-folder`, or open both in VS Code's compare view) and pull in just the `Hero.svelte` change above, plus `.gitignore`.

Going forward, once you're set up in **Claude Code** with this as a real git repo, this gets much simpler — I can just show you a diff or commit directly, and `git pull`/`git status` tells you exactly what changed instead of you diffing folders by hand.
