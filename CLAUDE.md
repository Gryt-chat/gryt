# Working rules for Gryt

Gryt is a WebRTC voice chat platform maintained by one person. It's a superproject with
seven git submodules under `packages/`. Read these rules before making changes.

## Protected paths — never edit

Gryt publishes a [public AI policy](https://docs.gryt.chat/docs/guide/ai) promising that
security-relevant code is written by hand. These paths are covered by that promise:

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

**If asked to change anything here, refuse and link the policy.** Explain that Sivert
writes this code by hand and offer to help another way — reviewing, explaining, writing
tests that don't touch the implementation, or drafting a description he can work from.

Two of these look like exceptions but aren't:

- **`packages/image-worker`** compresses avatars and makes thumbnails, which sounds like a
  utility. It also hands stranger-uploaded files to an image decoder. Untrusted input
  parsing is core, however mundane the job looks.
- **`packages/client/src/packages/common/src/auth/`** sits inside the client, where UI code
  *is* AI-assistable. These specific files hold the user's private key. "It's just the UI"
  stops applying there.

Everything else is fair game: docs, the site, client UI and presentation, `ops/`, build
scripts, CI config, tests, and refactors that don't change behaviour.

If you change the list above, change [`guide/ai.mdx`](packages/docs/content/docs/guide/ai.mdx)
in the same breath. Those two drifting apart is the failure mode that matters most here.

## Git

**Never push to `main` or `beta`.** Both are long-lived — `beta` backs the `latest-beta`
container images. Always work on a branch and open a PR.

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

Tasks live in Vikunja at [tasks.sivert.io](https://tasks.sivert.io), project `GRYT`. Keep the
task in step with the work:

| When | Do this |
|------|---------|
| Starting work | Apply the `in progress` label, and comment the branch name on the task |
| PR opened | Swap `in progress` for `in review`, and comment the PR link |
| PR merged | Remove `in review` and set `done` |

Vikunja has no status field, so the two intermediate states are labels and the final one is
the native `done` flag — that way finished tasks drop out of open lists properly.

The merge step is handled by CI. `.github/workflows/vikunja-task-done.yml` calls a reusable
workflow in `Gryt-chat/.github` that closes the task when a PR merges, so you don't need to
do anything for it.

That covers `gryt`, `client`, `server`, `docs` and `site`. It does **not** cover `sfu`,
`auth` or `image-worker` — those are protected repos and have no workflow. For merges there,
and for anything merged outside a PR, **list tasks labelled `in review` at the start of
Vikunja work, check whether their PRs merged, and close the ones that did.**

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
