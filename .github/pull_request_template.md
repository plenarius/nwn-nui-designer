## What changed and why

<!-- One or two paragraphs. Link the issue it fixes: "Fixes #N". -->

## How it was checked

<!-- Which checks you ran (CONTRIBUTING.md, "Checks"), and anything you tried by hand. -->

- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm smoke` (after `pnpm build`)
- [ ] Drawing changed: the golden check (`pnpm golden`), or "a maintainer to run it" if you cannot

## Client behaviour

<!-- Only if the change is about how the game client draws or reads a window or a skin. Delete otherwise. -->

- Evidence: a 1:1 in-game screenshot, a decompile reference (function name), or a test in game
- [ ] `docs/CLIENT-BEHAVIOUR.md` updated, with the evidence marker

## Docs

- [ ] README, CONTRIBUTING, DESIGN.md or docs/ARCHITECTURE.md updated where the change touches them
- [ ] `docs/GAPS.md`: fixed gaps removed, new ones added
- [ ] No game files, game art or server content added (CONTRIBUTING.md, "Rules")
