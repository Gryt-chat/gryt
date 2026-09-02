# Working rules for Gryt

Gryt is a WebRTC voice chat platform maintained by one person. It's a superproject with
thirteen git submodules under `packages/`. Read these rules before making changes.

## Review-required paths

Gryt publishes a [public AI policy](https://docs.gryt.chat/docs/guide/ai). You may work in
these paths, but they never merge without Sivert reading the whole diff:

```
packages/sfu/**                                    # WebRTC media plane, RTP, ICE, SVC
packages/auth/**                                   # identity certificate authority
packages/crypto/**                                 # message encryption, published to npm
packages/image-worker/**                           # decodes untrusted uploads
packages/reports/**                                # public POST endpoint, stranger-written input
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

`packages/crypto` is published to npm, which none of the others are. A change there
becomes what the desktop app and the phone both do the next time either pins a new version,
and a published version cannot be taken back the way a commit can. It is also the only
place where getting the bytes wrong makes messages already sent unreadable rather than
making the next one fail.

Three of these look like exceptions but aren't:

- **`packages/image-worker`** compresses avatars and makes thumbnails, which sounds like a
  utility. It also hands stranger-uploaded files to an image decoder. Untrusted input
  parsing belongs here, however mundane the job looks.
- **`packages/client/src/packages/common/src/auth/`** sits inside the client, where UI code
  gets normal review. These specific files hold the user's private key.
- **`packages/reports`** takes bug reports and feedback from inside the apps, which sounds
  like a form handler. It is also the only Gryt service with an endpoint anyone on the
  internet can POST to, it parses whatever they send, and it stores IP addresses.

Everything else — docs, the site, client UI, `ops/`, build scripts, CI config, tests — gets
normal review.

If you change the list above, change [`guide/ai.mdx`](packages/docs/content/docs/guide/ai.mdx)
in the same breath. Those two drifting apart is the failure mode that matters most here.

## Git

**Never push to `main`.** It's the only long-lived branch. Always work on a branch and open
a PR.

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
reusable workflow in `Gryt-chat/.github`. Every repo has it — the superproject and all ten
submodules — so you don't normally need to touch a task after opening the PR. There is no
longer an exception to work around: `ui` was the last one missing it and GRYT-143 landed
that on 2026-08-11.

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

The procedure that goes with it is the `changelog-notes` skill, in
[`.claude/skills/changelog-notes/`](.claude/skills/changelog-notes/SKILL.md):
which releases have no note, how to get a commit range out of two manifests, and
where the MDX goes. A script on the box used to do this and wrote 105 drafts for
4 published notes, so it was removed in GRYT-861 and the job is done here.

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

### A realm import deletes every Gryt account

`keycloak-import` runs `kc.sh import --override true`, which **deletes the realm first**.
Every registered user goes with it, and the only way back is a dump from
`packages/auth/backups`. It is armed by `GRYT_IMPORT_REALM=1` in `packages/auth/.env` and
does nothing at `0`, which is where it normally sits. Check it before any `up` on the auth
project, and set it back to `0` afterwards.

`import_realm.sh` refuses to run while Keycloak is listening, which catches the obvious
mistake. It does not catch the flag being left on.

**Three settings live only in the running realm and are wiped with it.** None is in
`gryt-realm.json`, because realm-level configuration in the import file is what took the
whole stack down in GRYT-136:

| What | Applied by | Symptom when missing |
|------|-----------|----------------------|
| Declarative user profile | `keycloak-user-profile` | Registration silently rejects inputs the theme hides |
| Brute-force protection, password policy | `keycloak-security-policy` | Unlimited login attempts, any password accepted |
| Registration captcha | nobody — console only, needs keys | An email address is all a script needs to make accounts |

The first two are one-shots and re-running them is the fix. **Both failed silently from
mid-August to 2026-08-31** because they authenticate as the master-realm `admin`, which is
normally disabled on purpose — the containers exited 1 and nothing else said anything. So
after an import, or after anything that touches the auth stack, check they actually ran
rather than assuming:

```bash
docker ps -a --filter name=gryt-auth-keycloak- --format '{{.Names}}	{{.Status}}'
```

`Exited (0)` is success. `Exited (1)` means the realm is running without whatever that
one-shot was meant to apply.

To run one without storing a password, enable `admin` briefly and pass the credentials at
run time rather than putting them in `.env`:

```bash
docker compose -f docker-compose.keycloak.yml -p auth run --rm --no-deps \
  -e GRYT_KEYCLOAK_ADMIN_USERNAME=... -e GRYT_KEYCLOAK_ADMIN_PASSWORD=... \
  keycloak-security-policy
```

`--no-deps` matters: without it Compose starts what the service depends on, and that is how
an import gets triggered by accident.

## Style

Match the surrounding code. Sivert's prose — docs, blog posts, comments — is plain and
direct, with hedges like "a bit", "probably", "honestly". Avoid aphorisms, antithesis pairs
("not X, but Y"), and sections that end on a punchy one-liner. If a sentence sounds like it
belongs in a keynote, rewrite it.

**Don't tell the reader a point is important.** "Worth noting", "worth a close look",
"this is the moment the number is settled", "the one people miss" — each of those spends a
sentence announcing the next one instead of saying anything. Cut the announcement and
state the thing. A test that catches most of it: if a sentence could move to another
project unchanged, it is filler, and it should be a fact, a number or a consequence
specific to this one instead.

**Two skills for this, and they do different jobs.** Run them over prose rather than
trying to hold the lists in your head; that is the failure mode. On 2026-08-21 `no-ai-slop`
was installed, used once on a Discord message, and the docs written an hour later still
went out saying "Worth doing rather than skipping past".

- `no-ai-slop`, at `~/.claude/skills/no-ai-slop/`. For writing that sounds **generated** —
  binary contrasts, faux-insight openers, importance puffery, fake-profound kickers. It
  protects a distinctive voice while removing the tells.
- `natural-writing`, at `~/.claude/skills/natural-writing/`. For writing that sounds
  **stiff** — long sentences carrying three clauses, no contractions, "the operator" where
  a person would say "whoever runs the server". Sivert's own rules, given on 2026-08-28
  after the site's pages read like an essay rather than like somebody talking. His summary
  of the test: would you say it out loud?

On product copy, run both, slop first. They compose: one gets the AI out, the other gets
the starch out.

`packages/site/design.md` has a Voice section carrying the same rules for the site
specifically, with worked before-and-after examples from the pass that produced them.

**Run them on any text you write that is not a code comment.** That is the rule, and it
is deliberately blunt so there is nothing to weigh up. Sentences in a docs page, a UI
string, a README, a PR body, a commit message, a task description, a release note, alt
text, a meta description, a message to somebody outside the repository. If it is prose and
a person will read it, it goes through both skills before you hand it over.

Run them on the copy **before you commit**, not as a later pass. The draft is what ships.

**The one exception is code comments**, along with log lines, test names, and variable and
function names. Those want to be plain and direct, a copy skill spends a turn on prose
nobody browses, and the comments in this repository are load-bearing and long on purpose.
Leave them alone.

This used to carve out PR bodies, commit messages and task descriptions as "in between",
on the argument that they are work records rather than product surface. That carve-out is
gone. They are the longest prose in the repository and the least edited, which is an
argument for running the skills over them rather than against it.

Both skills, and in order: `no-ai-slop` first, then `natural-writing`. One takes out the
AI tells, the other takes out the starch, and running only the second leaves antithesis
pairs and aphorisms behind. That is not hypothetical — on 2026-08-28 the backups page was
written without either, and the slop pass found an aphorism ("a backup nobody has restored
is a guess"), a sentence announcing its own importance, two negative-listing pairs and
eight em dashes. The natural-writing pass then found the whole page had been written
without a single contraction.

This file also named a `humanizer` skill until 2026-08-22. It was never on the Windows
machine and is not in the catalog, so nothing was running it.

One caveat when running it over an existing page. `git blame` will not tell you who
wrote a line: every commit in these repositories is authored `Sivert`, including the ones
an agent makes, so blame says "Sivert" for all of it. The `Co-authored-by: Claude` trailer
on the commit is the only marker, and `git log --format=%b -- <file>` is how to read it.

It matters less than it looks, because the answer is usually "leave it either way". A
phrase like "worth knowing" reads as Sivert's voice in the pages that already had it, and
the rule above is about not adding more rather than about editing what is there. Rewrite a
line when it is genuinely announcing the next one, not because a scan matched it.
