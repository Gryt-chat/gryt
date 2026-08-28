# The editing skills, as the drafter reads them

Two files, copied whole. `changelog-notes.mjs` reads both into every prompt.

They are Sivert's editing skills, the ones `CLAUDE.md` tells a person to run
over prose before it ships. The drafter had a summary of them for one commit —
fifteen lines of the patterns its own output kept producing — and a summary is
somebody deciding in advance which rules matter. These are the whole files, so
the model is held to the same thing a person is.

## Why they are here and not read from `~/.claude/skills`

The drafter runs on the box that hosts Gryt. Nothing on it has a
`~/.claude/skills`, and a rule the model is judged by is not something to load
from a laptop that may not be on.

## Keeping them in step

Nothing does. They are copies, and the originals live on Sivert's Mac at
`~/.claude/skills/no-ai-slop/SKILL.md` and
`~/.claude/skills/natural-writing/SKILL.md`. Editing one of those does not
reach here, and the drafter will keep quoting whichever version was last
copied.

Copied 2026-08-28.

## What the drafter ignores in them

Both files are written for an agent working with a person: they describe two
jobs, one of which is asking the user for a draft, and they ask for a "What
changed" section afterwards. None of that applies to a script filling a fixed
JSON shape, and the prompt says so above them rather than the files being
edited down — a file trimmed to fit is the summary again.
