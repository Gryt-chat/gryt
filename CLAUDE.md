# Working rules for Gryt

Gryt is a WebRTC voice chat platform maintained by one person. It's a superproject with
ten git submodules under `packages/`. Read these rules before making changes.

## Review-required paths

Gryt publishes a [public AI policy](https://docs.gryt.chat/docs/guide/ai). You may work in
these paths, but they never merge without Sivert reading the whole diff:

```
packages/sfu/**                                    # WebRTC media plane, RTP, ICE, SVC
packages/auth/**                                   # identity certificate authority
packages/image-worker/**                           # decodes untrusted uploads
packages/server/src/auth/**                        # challenge-response, JWT validation
packages/server/src/middleware/**                  # request auth
packages/server/src/db/**                          # persistence
packages/server/src/storage/**                     # object storage
packages/client/src/packages/common/src/auth/**    # keypair generation and storage
```

**Review-required means it gets reviewed. It does not mean hands off.** Fix the bug where
the bug is. Half a fix, shipped because the other half was in a listed path, is worse than
either doing all of it or leaving it alone — it looks finished and isn't, and Sivert is the
one who finds out. If a change belongs in one of these paths, write it, explain it, and let
the review do its job.

Rules for these paths:

- **Always a branch and a PR. Never commit to `main` and never merge your own PR here** —
  merging is Sivert's, after he has read it.
- **Keep the diff small and reviewable.** A 600-line refactor in the SFU is not reviewable
  in practice, so it will not get a real review. Split it up.
- **Say what to look at.** In the PR body, call out the parts you're least sure about, and
  anything that changes behaviour rather than shape.
- **Don't bundle *unrelated* edits.** A change here shouldn't carry along a docs typo or a
  CI tweak. The other half of the same fix is not unrelated — that belongs with it, or in
  its own PR opened at the same time and cross-linked. Don't drop it.

Two of these look like exceptions but aren't:

- **`packages/image-worker`** compresses avatars and makes thumbnails, which sounds like a
  utility. It also hands stranger-uploaded files to an image decoder. Untrusted input
  parsing belongs here, however mundane the job looks.
- **`packages/client/src/packages/common/src/auth/`** sits inside the client, where UI code
  gets normal review. These specific files hold the user's private key.

Everything else — docs, the site, client UI, `ops/`, build scripts, CI config, tests — gets
normal review.

If you change the list above, change [`guide/ai.mdx`](packages/docs/content/docs/guide/ai.mdx)
in the same breath. Those two drifting apart is the failure mode that matters most here.

## Git

**Never push to `main`.** Always work on a branch and open a PR.

There is one other long-lived branch, `client:sdk`, and it is temporary. The voice SDK
migration (GRYT-341) lands there instead of `client:main` so `main` stays releasable while
the migration settles, which is expected to take weeks. Hotfixes go to `main` as normal and
get released as normal.

This works for the same reason the old `beta` branch did not. `release-client.yml` runs
`git -C packages/client checkout -B main origin/main`, so a release always builds
`client:main` whatever the gitlink says. `beta` was trying to isolate a release channel and
that line defeated it. `sdk` is the opposite arrangement: work stays off `main`, releases
build `main`, and the same line is what keeps releases clean.

Two things it needs to survive:

- **Merge `main` into `sdk` after every hotfix**, not at the end. A month of one-way drift
  is how these branches die, and the migration touches `useSFU`, `controls.tsx` and
  `App.tsx`, which is where a hotfix is most likely to land too.
- **There is no way to release from it.** `release-client.yml` takes a channel and a
  version and no ref for the client submodule, so testing `sdk` means a local build or a
  temporary change to the workflow. Do not discover that when you want an installer.

Delete it once the migration merges to `main`, and delete this section with it.

**Always work in your own worktree. Never `git checkout` in the shared checkout.**
Make one per task, before the branch:

```bash
# superproject
git worktree add .claude/worktrees/GRYT-123 -b claude/GRYT-123-slug origin/main
# a submodule
git -C packages/client worktree add ../../.claude/worktrees/GRYT-123-client \
  -b claude/GRYT-123-slug origin/main
```

More than one agent runs against this repo at a time, and a working tree has exactly
one HEAD. Share it and the second `git checkout -b` moves the first one's branch out
from under it, silently and with no error. What that looks like from inside: commits
land on a branch named for somebody else's task, `git push` sends a branch nobody
touched, `gh pr create` answers "No commits between main and ...", and there are
uncommitted files in the tree that belong to a third piece of work.

That is not hypothetical either. On 2026-08-12 the GRYT-186 commit ended up on
`claude/GRYT-156-custom-identity-service`, and the only reason nothing was lost is
that the commit was recoverable by hash. Untangling it cost more than the worktree
would have.

Remove it once the PR merges — `git worktree remove <path>` — and prune the stale
entries with `git worktree prune`.

There used to be a `beta` branch too. It's gone. Beta is a release *channel* now, picked
from a dropdown when you dispatch `Release Client` or `Release Server`, and it still
produces `1.2.3-beta.N` versions and `latest-beta` container images. The branch never
isolated anything — the client submodule was force-moved to `client:main` on every release
regardless — so all it did in practice was pin stale `server` and `sfu` gitlinks against a
current client.

Branch naming is `claude/<id>-<slug>`, matching the existing `copilot/*` branches:

```
claude/GRYT-118-invite-expiry     # Vikunja task at tasks.sivert.io
claude/gh-42-invite-expiry        # GitHub issue
claude/docs-ai-policy-typo        # no ticket — use a descriptive slug
```

Contributors without Vikunja access use `gh-<n>` or a plain slug. Never block someone on a
tracker they can't reach.

**Keep `Co-Authored-By` trailers on every commit.** The public policy tells readers to audit
AI involvement with `git log`. Stripping the trailer breaks a promise Gryt made in writing.

## Task tracking

Tasks live in Vikunja at [tasks.sivert.io](https://tasks.sivert.io), project `GRYT`. The
kanban board is the state: **To-Do → Doing → Review → Done**.

| When | What happens | Who does it |
|------|--------------|-------------|
| Starting work | Move to **Doing**, comment the branch name on the task | You |
| PR opened | Move to **Review**, comment the PR link | CI |
| PR merged | Move to **Done** *and* set the task's done flag | CI |

CI covers the last two through `.github/workflows/vikunja-task-done.yml`, which calls a
reusable workflow in `Gryt-chat/.github`. Eight of the nine repos have it, so you don't
normally need to touch a task after opening the PR. `ui` is the exception — it was added
as a submodule later and still needs the workflow (GRYT-143), so move its tasks by hand
until that lands.

Moving a task is not exposed by the Vikunja MCP server, so use the REST API directly:

```bash
# bucket ids: resolve by title from /projects/2/views/<kanban view>/buckets
POST /api/v1/projects/2/views/12/buckets/<bucket>/tasks   {"task_id": <id>}
```

Moving a card into **Done** does **not** set its `done` flag. That needs its own write:

```bash
POST /api/v1/tasks/<id>   {"done": true}
```

This file claimed the opposite until 2026-08-18, and the CI workflow was written to match,
so every task CI closed sat in the Done column reporting `done: false`. Thirteen of them
had built up. They read as finished on the board and as open to anything filtering on
`done`, and nothing failed on the way — which is why it went unnoticed for so long. Fixed
in the reusable workflow, but do the second write yourself when moving a task by hand.

If something merges outside a PR, or CI fails, **check the Review column at the start of
Vikunja work and close anything whose PR has landed.**

### Release notes

How they are written is in [`patch-notes-style.md`](patch-notes-style.md): prose
first, a recap list after, facts taken from `manifest.json` diffs rather than from
memory. It lived only in an untracked local file until it nearly went the way of
the SVG purge decision below.

### Anything you defer gets a task

If you write "separate decision", "out of scope", "your call" or "follow-up" in a PR
body, **open a task for it in the same breath and link it.** A merged PR is where notes
go to die: it drops off the open list, nobody reads it again, and the thing you carefully
identified is gone.

That is not hypothetical. The decision about whether to purge the SVG uploads already on
disk — left over from a stored-XSS fix — lived only in the body of a merged PR and an
untracked local file for a week. It surfaced again by accident, during an unrelated audit.

The bar is low: a title and a paragraph saying what was found, what was decided, and what
is still open. If it isn't worth a task, it probably wasn't worth a paragraph in the PR
either.

## Submodules

`packages/*` are separate repositories. Commit and push the **submodule first**, then the
superproject gitlink:

```bash
git -C packages/docs push      # first
git push                        # then the gitlink
```

Reverse that order and the superproject points at a commit that doesn't exist on the remote.

## Package manager

Use **yarn, never npm**. `packages/client` and `packages/server` both ship `yarn.lock` and
run `yarn dev`; `npm install` silently resolves a different tree and writes a competing
`package-lock.json`.

`packages/site` already has both lockfiles committed. That's a known wart — don't make it
worse, and don't "fix" it as a drive-by.

## Local development

```bash
./ops/start_dev.sh
```

Starts MinIO, the SFU, the Vite client on `:3666`, and two servers on `:5001`/`:5002` in a
tmux session named `gryt`. Local overrides go in `ops/.env` (gitignored).

## Production server

`dev.lan` (SSH alias `edition35`) runs Gryt prod, Gryt beta, the auth stack, and several
unrelated projects on **one Docker daemon**. There are no off-box backups.

- Never `docker system prune`, never `compose down -v`, never remove volumes or images
- Target services by name — `up -d --no-deps docs site`, never a bare `up -d`
- Never touch the running `auth` compose project (Keycloak + Postgres) **on this box**.
  That is about the deployment, not the source: editing `packages/auth`, including its
  compose file, is ordinary work. It goes through review like everything else in a
  review-required path, and deploying it is Sivert's call — but write it.
- Check `df -h` before builds; a full disk takes down the auth database
- `docs.gryt.chat` and `gryt.chat` build from submodule source via
  `ops/internal/docker-compose.yml` — `git pull` in the submodule before rebuilding

Keycloak is dumped every 6 hours to `packages/auth/backups` (31-day rolling window), but
those dumps sit on the same disk as the database they back up.

## Style

Match the surrounding code. Sivert's prose — docs, blog posts, comments — is plain and
direct, with hedges like "a bit", "probably", "honestly". Avoid aphorisms, antithesis pairs
("not X, but Y"), and sections that end on a punchy one-liner. If a sentence sounds like it
belongs in a keynote, rewrite it.
