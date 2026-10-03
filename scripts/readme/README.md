# README demos

These scripts record `docs/readme/hero.png` and the feature GIFs in `docs/readme/` from the demo data. Rerun them when the UI changes.

Needs Google Chrome, ffmpeg and a C compiler (`cc`), on macOS or Linux (the live session relies on `ps`). Intermediate files go to `.readme-rec/` (gitignored).

## Set up the demo

```sh
pnpm install
pnpm seed:demo                    # synthetic sessions in .demo-claude/
node scripts/readme/ghosts.mjs    # an empty and a crashed session, for the ghost demo
scripts/readme/restart-live.sh    # a running session that adds a turn every 2.5 s
CLAUDE_CONFIG_DIR="$PWD/.demo-claude" node scripts/serve.mjs --port 3344 --no-open &
```

Run `restart-live.sh` again right before recording `live` or the hero, so the live session starts from a low context.

## Record

```sh
# one GIF
node scripts/readme/rec.mjs timeline && scripts/readme/togif.sh timeline

# all GIFs
for n in replay timeline live fleet compare ghost; do
  node scripts/readme/rec.mjs $n && scripts/readme/togif.sh $n
done

# the hero
node scripts/readme/hero.mjs
```

The scenarios (clicks, scrolls, pauses) are in `scn.mjs`, and the hero layout is in `hero.html`.

## Clean up

```sh
pkill -f livesim.mjs; pkill -f .readme-rec/bin/claude; pkill -f "serve.mjs --port 3344"
```
