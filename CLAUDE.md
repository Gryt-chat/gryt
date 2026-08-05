# Working rules for Gryt

Gryt is a WebRTC voice chat platform maintained by one person. It's a superproject with
seven git submodules under `packages/`. Read these rules before making changes.

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

Rules for these paths:

- **Always a branch and a PR. Never commit to `main` and never merge your own PR here** —
  merging is Sivert's, after he has read it.
- **Keep the diff small and reviewable.** A 600-line refactor in the SFU is not reviewable
  in practice, so it will not get a real review. Split it up.
- **Say what to look at.** In the PR body, call out the parts you're least sure about, and
  anything that changes behaviour rather than shape.
- **Don't bundle.** A change to a review-required path shouldn't ride along with unrelated
  edits elsewhere.

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

**Never push to `main`.** It's the only long-lived branch. Always work on a branch and open
a PR.

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
| PR merged | Move to **Done**, which sets the task's done flag | CI |

CI covers the last two through `.github/workflows/vikunja-task-done.yml`, which calls a
reusable workflow in `Gryt-chat/.github`. All eight repos have it, so you don't normally
need to touch a task after opening the PR.

Moving a task is not exposed by the Vikunja MCP server, so use the REST API directly:

```bash
# bucket ids: resolve by title from /projects/2/views/<kanban view>/buckets
POST /api/v1/projects/2/views/12/buckets/<bucket>/tasks   {"task_id": <id>}
```

Dropping a task into **Done** sets its `done` flag automatically — no separate update.

If something merges outside a PR, or CI fails, **check the Review column at the start of
Vikunja work and close anything whose PR has landed.**

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
- Never touch the `auth` compose project (Keycloak + Postgres)
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
