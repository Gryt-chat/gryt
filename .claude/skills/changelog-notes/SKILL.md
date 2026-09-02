---
name: changelog-notes
description: Write the release notes for a Gryt version. Finds which releases have no note, works the commit range out of the manifest diffs, and writes the MDX the changelog page renders. Use when a release has shipped, when somebody asks for patch notes, or when backfilling the ones that were never written.
---

# Writing a Gryt release note

A script used to do this. It drafted 105 notes on a local model and 4 were
published, so the job is done here now.

Two files carry the rules and this one carries the procedure:

- [`patch-notes-style.md`](../../../patch-notes-style.md) is the house style.
  Read it in full before writing. Shape, voice, bullets, what goes in Security,
  what a picture has to earn. Don't summarise it to yourself first.
- `no-ai-slop` then `natural-writing`, in that order, over everything you write
  here. That's the rule in `CLAUDE.md` and this is the prose it was written for.

## Which releases have no note

The notes on the page come from two places. `packages/site/content/changelog/*.mdx`
is the hand-written ones, and `changelog.json` served under `/release-notes/` is
what the old drafter produced. New notes go in the first one.

```bash
gh api --paginate -q '.[] | select(.draft|not) | [.tag_name, .prerelease] | @tsv' repos/Gryt-chat/gryt/releases
```

```bash
ls packages/site/content/changelog/
```

Stable releases are the ones that need a note. A beta only earns one when it has
something above **Under the hood**, and it covers the whole `1.4.0` line rather
than the individual `-beta.N` builds.

## Where the facts come from

**Never from memory, and never from Vikunja alone.** `.release/manifest.json` is
committed on every release tag and names the exact commit each component shipped
at. Diff two manifests, take the range per component, write from that.

Writing the 1.4.0 notes this way caught two things that felt certain and were not
in the range: animated GIF server icons landed after the release was cut, and
there was no 120fps change in it at all. Both would have shipped as fact.

Get the two manifests:

```bash
git show v1.6.52:.release/manifest.json | jq '.components | to_entries[] | [.key, .value.commit] | @tsv' -r
```

Do the same for the release before it, then for each component whose commit
moved, read that range in the submodule:

```bash
git -C packages/client log --no-merges --format='%s%n%b%n---' <before>..<after>
```

If a commit isn't in the checkout, the submodule is shallow. Fetch it rather
than writing the note without it:

```bash
git -C packages/client fetch --unshallow origin
```

A range you can't read in full is a note you can't write. Say so instead of
covering the part you could see.

### What to call each component

The manifest names repositories. A reader deciding whether they need to update
anything doesn't know what `sfu` is.

| Manifest | On the page |
|---|---|
| `client` | The app |
| `server` | The server |
| `sfu` | Voice |
| `imageWorker` | Images |

### Commits that aren't about the release

Skip anything matching these. They describe the release rather than anything in
it, and nobody wants "Build 19, because 18 is uploaded" in their patch notes.

```
release: · chore: · ci: · build: · Version Packages · Merge pull request
Merge branch · Bump … · Build N, because …
```

### Why, as opposed to what

The commits carry `GRYT-` numbers. Those lead to the tasks at
[tasks.sivert.io](https://tasks.sivert.io), which is where the reason lives. Use
the range for what changed and the task for why it was worth doing.

A commit with no body gives you a subject and nothing else. It doesn't give you a
symptom, a cause, or who it affected. Three drafts were thrown away for inventing
those: "fix themed titlebar and identity settings" became a titlebar showing the
wrong colour "especially on systems with dark mode enabled", plus a whole second
section about names reverting. The range said none of it. Where the body is
missing, write the subject in a reader's words and stop.

## The file

`packages/site/content/changelog/<version>.mdx`, named for the version, which is
also its URL.

```mdx
---
version: 1.6.0
date: 2026-08-14
channel: beta
headline: One sentence naming the two things that actually matter.
---
```

`channel` is `beta` or omitted for stable. Then the note, as prose, in the shape
`patch-notes-style.md` describes: an untitled opening paragraph, a few sections
with real headings, and the recap list after a `---`.

Recap groups, in this order, skipping any that are empty:

```
Voice · Avatars and images · Emoji · Updates · Hosting · Security ·
Accessibility · Under the hood
```

Pictures are plain markdown images. Clips use `<Clip>`, which is imported for
you by the page and plays silently on a loop with no controls. Both are
full-width; the page handles the sizing.

## Before you open the PR

- Every claim traceable to a commit in the range. This is the check that caught
  a paraphrased security section that read perfectly well.
- A Security section only if the release actually contains a security fix. Most
  don't. The old drafter read the heading as a shape to fill and wrote one about
  insecure connections for a release whose only commit was a CORS preflight
  failing behind a proxy.
- Nothing above **Under the hood** mentions a task number, a PR, a file or a
  function.
- [One-time sponsors](https://github.com/sponsors/Gryt-chat) since the last note
  get their names above the recap list. Recurring sponsors don't — they're on the
  README and gryt.chat/sponsors, which is what those tiers promise.
- Both writing skills have been run over it.

## Shipping it

`packages/site` is a submodule, so it's two pushes and the order matters:

```bash
git -C packages/site push && gh pr create --repo Gryt-chat/site
```

The superproject gitlink moves after that PR merges, not before. A gitlink
pointing at a commit that isn't on the remote is the failure this order avoids.

The site rebuilds itself from source on the Pi on a ten-minute timer, so the
note is live shortly after the gitlink lands.
