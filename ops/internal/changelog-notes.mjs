#!/usr/bin/env node
//
// Draft the user-facing changelog for a release, from the release itself.
//
// The facts are already pinned. `.release/manifest.json` is committed on every
// release and names the exact commit each component shipped at, so the diff
// between two releases is not a guess — it is `git log old..new` in four
// submodules. patch-notes-style.md says how the result should read. This puts
// the two together and asks the Ollama instance on this machine for the prose.
//
// What it produces is not published. Each draft is posted to the reports
// service, which holds it until somebody reads it at /admin/changelog and
// presses Publish or Reject; reports is what writes the changelog.json nginx
// serves beside the site.
//
// This used to write that file itself, so a note nobody had read was public the
// moment the model finished writing it. Two fabricated drafts were caught by
// reading them while this was being built. One retold a different release
// wholesale. The other was a paraphrase: a section headed "Security
// improvements for identity and account tokens", about keychain encryption, in
// a release whose commit range does not contain the word keychain. It read like
// the rest of the note and it scored under the contamination guard below, which
// is why that guard is a backstop rather than a proof.
//
// The model never writes markup. It fills a fixed JSON shape — headline, then
// sections of heading + paragraphs + bullets — and the site renders that with
// its own components. A model cannot inject markup into a page it is not
// allowed to write markup for, and the shape is also what keeps every entry
// reading like the three that were written by hand.
//
// Run from the systemd timer beside this script. Safe to run by hand, and
// `--dry-run` prints what it would ask the model without asking it.
//
// Environment:
//   GRYT_CHANGELOG_URL     the reports service to post drafts to, e.g.
//                          http://127.0.0.1:9476. Required unless --dump.
//   GRYT_CHANGELOG_KEY     what it sends as X-Gryt-Changelog-Key. Required
//                          unless --dump. Matches REPORTS_CHANGELOG_KEY there.
//   GRYT_CHANGELOG_REDRAFT a version to draft again even though reports
//                          already has one for it. Replaces the existing draft;
//                          the old one is kept and marked superseded.
//   GRYT_CHANGELOG_REPO    the superproject checkout to read releases from.
//                          Default the checkout this script lives in.
//   GRYT_CHANGELOG_CHANNELS  which channels to draft. Default "latest".
//                          "latest beta" also drafts the pre-releases, which
//                          the site hides behind a toggle.
//   GRYT_CHANGELOG_LIMIT   how many releases back to consider. Default 12.
//   GRYT_CHANGELOG_ATTEMPTS  how many times to ask for one release before
//                          giving up on it. Default 3. A refused draft is
//                          handed back with the reasons rather than thrown
//                          away, which is what usually fixes it.
//   GRYT_CHANGELOG_DUMP    with --dump, where to write drafts for inspection.
//                          Default ./changelog/drafts beside this file. Nothing
//                          reads what is written there.
//
//   Which model writes the prose. ANTHROPIC_API_KEY picks the API; without
//   one it is Ollama. GRYT_CHANGELOG_PROVIDER overrides that either way.
//
//   ANTHROPIC_API_KEY      the key to draft with. Setting it is what moves
//                          drafting off Ollama, and it is the only setting
//                          here that costs money to use.
//   ANTHROPIC_MODEL        Default claude-opus-5
//   ANTHROPIC_URL          Default https://api.anthropic.com
//   ANTHROPIC_MAX_TOKENS   the cap on one answer, thinking included.
//                          Default 32000.
//   ANTHROPIC_TIMEOUT_MS   Default 600000
//   ANTHROPIC_NUM_CTX      how much prompt to budget for, in tokens.
//                          Default 200000. Well under the model's window,
//                          and past the largest range this has ever seen.
//   GRYT_CHANGELOG_PROVIDER  "anthropic" or "ollama". Worked out from
//                          whether there is a key when this is unset.
//
//   OLLAMA_URL             Default http://127.0.0.1:11434
//   OLLAMA_MODEL           Default llama3.1:8b
//   OLLAMA_TIMEOUT_MS      Default 3600000
//   OLLAMA_RETRY_DELAY_MS  How long to wait before the one retry of a
//                          request that never reached the model. Default
//                          60000.
//   OLLAMA_NUM_CTX         The context window to ask Ollama for. Default
//                          32768. Not optional in practice: Ollama's own
//                          default is 4096 and this prompt is past that, so
//                          leaving it unset silently drops part of the input.
//                          See the comment on askOllama().

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(process.env.GRYT_CHANGELOG_REPO ?? join(HERE, '..', '..'))
const CHANNELS = (process.env.GRYT_CHANGELOG_CHANNELS ?? 'latest').split(/\s+/).filter(Boolean)
const LIMIT = Number(process.env.GRYT_CHANGELOG_LIMIT ?? 12)
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b'
/* Long, because generation here is slow and a half-written note is not
   written at all. Measured on the box on 2026-08-29: qwen3:32b at num_ctx
   24576 runs 58% on the CPU and streams about half a token a second, so a note
   of fifteen hundred tokens is the better part of an hour. Three minutes, which
   this used to be, aborted six of eighteen releases — every one of them a range
   big enough to be worth reading. */
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 3_600_000)

/* The context window to ask for.
   Ollama does not use the model's window, it uses num_ctx, and num_ctx
   defaults to 4096. Everything past that is dropped before the model reads a
   word of it, with no error and nothing in the response to say so — which is
   what a draft that quietly covers two commits out of five looks like from
   the outside.

   Not simply set to the model's own 40960, because this is memory on a card
   rather than a number. qwen3:32b keeps 256 KiB of KV cache per token, so
   40960 is 10 GiB of a 12 GiB card before a single layer of the model is on
   it — and the weights are 20 GB, so every GiB the cache takes is a GiB of
   them left on the CPU. The largest prompt this has produced is 16,300
   tokens; 24576 covers it with the answer and costs 6 GiB, or 3 with a
   quantised cache. See ops/internal/README.md. */
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX ?? 24_576)

/* ── Which model writes the prose ──────────────────────────────────────
   Two providers, and the key picks between them: with ANTHROPIC_API_KEY set
   the drafting goes to the Anthropic API, and without one it goes to Ollama.
   That is the same rule the reports service uses to pick a triage model, so
   there is one thing to learn here rather than two.

   Why there is a choice at all. Ollama costs nothing to run and the notes it
   wrote were not good enough to publish: 105 drafts, 4 published, and all
   101 rejections had already passed every check further down this file. So
   the checks were not the thing to fix.

   The API costs money per draft, which nothing else on this box does. A
   prompt measures 13,000 to 15,000 tokens and the answer is the note plus the
   thinking in front of it, which bills as output — around 15 cents an attempt
   at Opus 5 rates, up to three attempts a release. Nothing is spent until
   somebody sets a key. */
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const PROVIDER = (process.env.GRYT_CHANGELOG_PROVIDER || (ANTHROPIC_API_KEY ? 'anthropic' : 'ollama')).toLowerCase()
const ANTHROPIC_URL = (process.env.ANTHROPIC_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5'

/* The cap on one answer, and it covers thinking as well as the note.
   A finished note measured 200 to 830 tokens across the drafts on disk, so
   the note itself is nowhere near this. Thinking is what the room is for:
   the model reasons before it answers and those tokens count against this
   number, so a cap sized to the note would truncate the answer that was
   about to be written. Streamed either way, so a large cap costs nothing
   when the answer is short. */
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 32_000)
const ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 600_000)

/* How much prompt to budget for, and it is not the model's window.
   The window is far larger than this. The number matters because it is what
   the commit block is trimmed to fit, and the trimming is the thing that
   was quietly losing releases: 1.5.5 is 164 commits and the Ollama budget
   drops some of them before the model reads a word. 200,000 is past the
   largest range this has ever produced, so nothing gets dropped, while
   still being a bound rather than no bound at all. */
const ANTHROPIC_NUM_CTX = Number(process.env.ANTHROPIC_NUM_CTX ?? 200_000)

if (PROVIDER !== 'anthropic' && PROVIDER !== 'ollama') {
  console.error(`[changelog] GRYT_CHANGELOG_PROVIDER is "${PROVIDER}"; it has to be "anthropic" or "ollama"`)
  process.exit(1)
}
if (PROVIDER === 'anthropic' && !ANTHROPIC_API_KEY) {
  console.error('[changelog] GRYT_CHANGELOG_PROVIDER=anthropic without ANTHROPIC_API_KEY set')
  process.exit(1)
}

/* What the rest of the file asks for instead of the provider's own settings.
   Recorded on every draft as well, so a note in reports says which model
   wrote it and a bad run is attributable afterwards. */
const MODEL = PROVIDER === 'anthropic' ? ANTHROPIC_MODEL : OLLAMA_MODEL
const CONTEXT_TOKENS = PROVIDER === 'anthropic' ? ANTHROPIC_NUM_CTX : OLLAMA_NUM_CTX
const CONTEXT_SETTING = PROVIDER === 'anthropic' ? 'ANTHROPIC_NUM_CTX' : 'OLLAMA_NUM_CTX'

/* Four characters to the token. Rough, and on the safe side for English prose
   with code in it, which is what these prompts are. The same estimator is used
   for the budget and for the size printed in the log, so the two agree. */
const TOKENS = (text) => Math.ceil(text.length / 4)

/* What the answer needs, in tokens, kept back from the prompt's share of the
   window. A finished note measured 200 to 830 tokens across the ten drafts on
   disk; 2,048 is comfortably over the longest and costs nothing when the
   prompt is smaller than the window anyway. */
const ANSWER_RESERVE = 2_048

/* How much of the prompt may be commits, as a share of what is left after
   everything that is always there. Not a fixed number of characters: that was
   what this was, and a fixed number budgets one component while the total
   floats. 1.5.5 is 164 commits, the 60,000-character body cap did its job and
   shortened 161 of them, and the prompt still came to 30,130 tokens against a
   window of 24,576 — because the cap never covered the style guide, the two
   skills, the rules, 164 subject lines, or the 161 notes saying a body had
   been shortened. The budget is the whole prompt now, and the commits get
   what is left of it. */
const COMMIT_SHARE = Number(process.env.GRYT_CHANGELOG_COMMIT_SHARE ?? 0.95)
const DRY_RUN = process.argv.includes('--dry-run')

/* How many times to ask for one release before giving up on it.
   Each attempt is a full generation — eight minutes on qwen3:32b — so this is
   the difference between a release drafted and eight minutes wasted, and also
   the difference between a backfill of five hours and one of fifteen. Three is
   enough in practice: the second attempt fixes it almost every time, because
   what gets refused is two sentences rather than the whole note. */
const ATTEMPTS = Math.max(1, Number(process.env.GRYT_CHANGELOG_ATTEMPTS ?? 3))

/* Where a draft goes. */
const REPORTS_URL = (process.env.GRYT_CHANGELOG_URL ?? '').replace(/\/$/, '')
const REPORTS_KEY = process.env.GRYT_CHANGELOG_KEY ?? ''
const REDRAFT = process.env.GRYT_CHANGELOG_REDRAFT?.trim().replace(/^v/, '') || null

/* Writing drafts to disk instead of posting them, for working on the prompt
   without a reports instance to hand. Nothing reads what this writes — the
   flag is spelled out rather than inferred from a path, because the previous
   arrangement was a path and a path is what made an unread note public. */
const DUMP = process.argv.includes('--dump')
const DUMP_DIR = resolve(process.env.GRYT_CHANGELOG_DUMP ?? join(HERE, 'changelog', 'drafts'))

const log = (...a) => console.log('[changelog]', ...a)

/**
 * Who owns the checkout, and where their home is.
 *
 * Everything this script shells out to belongs to that person rather than to
 * the process: the git objects, and gh's login, which lives in their
 * ~/.config/gh/hosts.yml. The unit runs as root, so running either directly
 * gets git refusing the repository as dubiously owned and gh refusing outright:
 *
 *   To get started with GitHub CLI, please run:  gh auth login
 *
 * which is what failed the hourly unit, with a stack trace and exit 1, in the
 * one place a stack trace is least useful. pull-superproject.sh has done this
 * since it was written; the drafter simply never needed to until it started
 * fetching tags of its own.
 *
 * Worked out rather than configured. The alternative is a `User=` in the unit
 * or a name in the env file, and a machine's user account has no business being
 * in a public repository.
 */
const owner = (() => {
  if (process.getuid?.() !== 0) return null
  try {
    const name = execFileSync('stat', ['-c', '%U', REPO], { encoding: 'utf8' }).trim()
    if (!name || name === 'root') return null
    /* HOME is not changed by `runuser -u`, so without this gh looks in
       /root/.config and finds nothing — the same failure, one layer along. */
    const home = execFileSync('getent', ['passwd', name], { encoding: 'utf8' })
      .trim().split(':')[5]
    return home ? { name, home } : null
  } catch {
    return null
  }
})()



/* Not on a normal user's PATH — it lives in /usr/sbin, which is root's, and
   root is the only one who can use it anyway. pull-superproject.sh has the same
   two lines for the same reason. */
const RUNUSER = (() => {
  for (const path of ['/usr/sbin/runuser', '/sbin/runuser', '/usr/bin/runuser']) {
    if (existsSync(path)) return path
  }
  return null
})()

/**
 * The commit this drafter is running from, short.
 *
 * `ExecStartPre` pulls the checkout before every run and is allowed to fail —
 * a network blip should not cost a release its note. The cost is that a
 * checkout which quietly stops updating writes notes judged by rules that are
 * no longer the rules, and nothing about the note says so. Three times in
 * three days: a read-only filesystem, DNS, and a local edit the pull was right
 * to refuse, which left it eleven commits behind.
 *
 * Worked out once per run and put on every draft, so "was this written by the
 * rules that are on main?" is answerable from the review page rather than from
 * the journal.
 *
 * Undefined rather than a guess when git cannot answer. A tarball with no
 * `.git` is a legitimate way to run this, and refusing to draft over a missing
 * label would trade a note for nothing.
 */
export function drafterRevision() {
  try {
    return sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD'], { stdio: 'pipe' }) || undefined
  } catch {
    return undefined
  }
}

/* Once per process. The checkout cannot move under a run: `ExecStartPre` has
   already finished by the time this file is read, and a run that took six
   hours still wrote every one of its notes from this commit. */
const REVISION = drafterRevision()

function sh(cmd, args, opts = {}) {
  const [run, argv] = owner && RUNUSER
    ? [RUNUSER, ['-u', owner.name, '--', 'env', `HOME=${owner.home}`, cmd, ...args]]
    : [cmd, args]
  return execFileSync(run, argv, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  }).trim()
}

/* ── Releases ──────────────────────────────────────────────────────────
   The tag is the source of truth for what shipped, and `isPrerelease` is
   what separates a beta from a stable one. */

/* Ordered by version, not by date. Two reasons, both real here: the February
   history rewrite re-pushed every old tag, so v1.0.137 carries a March 2026
   publish date and sorts *after* releases that shipped long before it; and
   v1.6.21 carries `0001-01-01`, which sorts before everything. "The previous
   release" means the previous version, and only the version says so. */
function compareVersions(a, b) {
  const parse = (v) => v.replace(/^v/, '').split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p))
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y))
  }
  return 0
}

/* Asked for as lines rather than as JSON, and through `gh api` rather than
   `gh release list`. Both halves of that are about the gh on the machine this
   runs on, and both were found by installing the timer rather than by reading
   anything:

   - `--json` on `gh release list` landed in gh 2.24. dev.lan runs Debian's
     2.23, where it is an unknown flag, so the process exited 1 before drafting
     anything and did so every hour.
   - `gh api --paginate` on an array endpoint concatenates one array per page
     on that version, so the output is `[...][...]` and JSON.parse refuses it
     with "Extra data". `--slurp`, which merges them, is gh 2.42.

   A `-q` projection is applied per page and comes back as lines, which is the
   one shape every version in between agrees on. */
const RELEASE_FIELDS =
  '.[] | [.tag_name, (.prerelease|tostring), (.draft|tostring), (.published_at // "")] | @tsv'

function releases() {
  const raw = sh('gh', [
    'api', '--paginate',
    '-q', RELEASE_FIELDS,
    'repos/Gryt-chat/gryt/releases?per_page=100',
  ], { cwd: REPO })

  return raw.split('\n')
    .map((line) => line.split('\t'))
    /* A draft release has no tag pointing at it and never shipped, so there is
       nothing to diff and nobody to tell about it. `gh release list --json`
       could not report this at all, so the old call would have drafted notes
       for the untagged v1.6.21 a workflow left behind. */
    .filter(([tag, , draft]) => tag && draft !== 'true')
    .map(([tag, prerelease, , publishedAt]) => {
      /* A tag that was never published, or was published by a rewrite, has a
         date that is not the release's. The manifest records when the release
         was actually cut, so prefer it and keep published_at as the fallback.
         The REST field is null rather than absent where the CLI said
         "0001-01-01", so both shapes have to miss the test below. */
      const published = /^\d{4}/.test(publishedAt ?? '') && !publishedAt.startsWith('0001')
        ? publishedAt.slice(0, 10)
        : null
      return {
        tag,
        version: tag.replace(/^v/, ''),
        channel: prerelease === 'true' ? 'beta' : 'latest',
        date: published,
      }
    })
    .sort((a, b) => compareVersions(a.version, b.version))
}

/**
 * Bring the release tags in, once, before anything asks for a manifest.
 *
 * The checkout this reads is kept current by `git fetch origin main`, which
 * does not bring tags with it. So every release cut since somebody last fetched
 * tags by hand is simply not a ref here, and `git show <tag>:.release/…` fails
 * for it — which surfaces as "no manifest on one of the tags" for every recent
 * release at once. That reads like a missing file and is a missing ref, and on
 * dev.lan it was the difference between 344 tags present and the three releases
 * that mattered absent.
 */
function fetchTags() {
  try {
    sh('git', ['-C', REPO, 'fetch', '--quiet', '--tags', 'origin'], { stdio: 'pipe' })
  } catch {
    /* Not fatal. Whatever tags are already here still work, and the manifest
       check says plainly which releases cannot be reached. */
    log('! could not fetch tags — working from the ones already here')
  }
}

/**
 * The manifest a tag shipped with, or null for a tag from before there was one.
 *
 * Quiet on the way out. The manifest starts at v1.2.12, so every older tag
 * fails this, and git writes its own complaint to stderr before the catch
 * here ever sees it:
 *
 *   fatal: path '.release/manifest.json' exists on disk, but not in 'v1.1.4'
 *
 * Two of those per tag, ahead of the line that says it was handled, which
 * makes the first screen of every run read like something broke. Nothing did —
 * those six releases predate the record and can never have notes. `stderr`
 * ignored rather than captured, since the only thing said about the failure is
 * the "skipping" line the caller already prints.
 */
function manifestAt(tag) {
  try {
    return JSON.parse(
      sh('git', ['show', `${tag}:.release/manifest.json`], {
        cwd: REPO,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return null
  }
}

/* Commits that describe the release rather than anything in it. A reader does
   not want "Build 19, because 18 is uploaded" in their patch notes. */
const NOISE = /^(release:|chore:|ci:|build:|Version Packages|Merge (pull request|branch)|Bump |Build \d+, because)/i

/* A submodule cloned with --depth does not have the commit a months-old
   release pinned. Try to deepen once; a checkout that cannot reach it is a
   checkout that must not draft notes off half the changes. */
function have(dir, sha) {
  try {
    sh('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function reach(dir, sha) {
  if (have(dir, sha)) return true
  for (const args of [['fetch', '--quiet', 'origin', sha], ['fetch', '--quiet', '--unshallow', 'origin']]) {
    try {
      sh('git', ['-C', dir, ...args], { stdio: 'pipe' })
      if (have(dir, sha)) return true
    } catch { /* try the next one */ }
  }
  return false
}

function commitsFor(component, from, to) {
  const dir = join(REPO, component.path)
  if (!existsSync(dir)) return []
  for (const sha of [from, to]) {
    if (!reach(dir, sha)) {
      log(`  ! ${component.name}: ${sha.slice(0, 8)} is not in this checkout`)
      return null
    }
  }
  try {
    /* %x1f between fields and %x1e between records: a commit body contains
       newlines, and splitting on those loses half of every message. */
    const raw = sh('git', [
      '-C', dir, 'log', '--no-merges', `--format=%s%x1f%b%x1e`, `${from}..${to}`,
    ])
    if (!raw) return []
    return raw.split('\x1e')
      .map((rec) => {
        const [subject = '', body = ''] = rec.split('\x1f')
        return { subject: subject.trim(), body: body.trim() }
      })
      .filter((c) => c.subject && !NOISE.test(c.subject))
  } catch (err) {
    log(`  ! ${component.name}: ${String(err.message).split('\n')[0]}`)
    return null
  }
}

/**
 * What to call each part of Gryt on a page a user reads.
 *
 * The manifest names repositories, and a repository name is the wrong register
 * for release notes — "sfu" and "imageWorker" mean nothing to somebody deciding
 * whether they need to update anything. Mapped here rather than asked of the
 * model, because this is a fact off the manifest diff and the prompt goes out
 * of its way to forbid the model writing these words at all: a draft that
 * leaked "the SFU handles disconnections more clearly" into a headline is what
 * that rule is for.
 *
 * The point of showing them is the question prose cannot answer at a glance —
 * a self-hoster wants to know whether the server moved or whether this is only
 * the app (GRYT-231).
 */
const COMPONENT_NAMES = {
  client: 'The app',
  server: 'The server',
  sfu: 'Voice',
  imageWorker: 'Images',
}

function componentName(key) {
  return COMPONENT_NAMES[key] ?? key
}

function changesBetween(prevTag, tag) {
  const a = manifestAt(prevTag)
  const b = manifestAt(tag)
  if (!a || !b) return null

  const out = []
  let incomplete = false
  for (const [name, comp] of Object.entries(b.components)) {
    const before = a.components[name]
    if (!before || before.commit === comp.commit) continue
    const commits = commitsFor({ ...comp, name }, before.commit, comp.commit)
    if (commits === null) { incomplete = true; continue }
    if (commits.length) out.push({ component: name, commits })
  }
  return { parts: out, incomplete }
}

/* ── The model ─────────────────────────────────────────────────────────
   A fixed shape rather than prose, for three reasons: the site renders it
   with its own components so no markup crosses the boundary, a malformed
   answer is detectable instead of merely ugly, and the shape is most of
   what makes an entry read like the hand-written ones. */
const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    /* The untitled paragraph or two before the first heading. Every note
       written by hand has one, and its absence is most of what made the first
       drafts read like output rather than like writing. */
    intro: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          body: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'body'],
      },
    },
    /* "The short version" from the style guide: one-line bullets grouped under
       a label, after the article. Someone who read the prose stops before it;
       someone who wants only the list starts here. */
    recap: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          group: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['group', 'items'],
      },
    },
    /* One line per commit the note deliberately says nothing about, naming
       its number and why. Not part of the note — it is stripped before the
       draft is posted — and it exists so that "this commit is not worth a
       reader's time" is something the model has to write down rather than
       something it can do by saying nothing. The coverage rule below reads
       it, and the log prints it, so a release that quietly shrank is visible
       to whoever reads the draft. */
    omitted: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          commit: { type: 'number' },
          why: { type: 'string' },
        },
        required: ['commit', 'why'],
      },
    },
  },
  required: ['headline', 'intro', 'sections', 'recap', 'omitted'],
}

/* The three notes written by hand, as the target. A rule can say "a sentence,
   not a label"; an example of one shows what that means, and these are the
   only three examples that exist. Read at run time so a fourth hand-written
   note joins them without anybody editing this file. */
function examples(repo) {
  const dir = join(repo, 'packages/site/content/changelog')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => readFileSync(join(dir, f), 'utf8').match(/^headline:\s*(.+)$/m)?.[1]?.trim())
    .filter(Boolean)
}

/* One hand-written note in full.
   Not in the prompt any more, and the reason is worth keeping. It was added
   because the drafts had no opening paragraph, and it did fix that — and it
   also produced a note for 1.6.43 about 24-word backups and certificate
   authorities, which belong to the release the example described. Reordering
   the prompt fixed the wholesale case and left a paraphrased one: a fabricated
   security section about keychain encryption, in a release whose commit range
   does not contain the word "keychain".
   Still used by the contamination check below, which needs to know what the
   example says in order to notice a draft repeating it. */
function workedExample(repo) {
  const dir = join(repo, 'packages/site/content/changelog')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.endsWith('.mdx')).sort()
  const newest = files[files.length - 1]
  if (!newest) return null
  const raw = readFileSync(join(dir, newest), 'utf8')
  const body = raw.split('---').slice(2).join('---').trim()
  /* Media and MDX components are not something the drafter can produce, and
     showing them invites an attempt. */
  return body
    .replace(/^<(Image|Clip)[^>]*\/>\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* Every hand-written note in full, newest last.
 *
 * `workedExample` returns only the newest, and the contamination guard has
 * been checking against that one alone. On 2026-08-31 a draft for 1.6.38
 * opened with 1.6.0's first paragraph word for word — "one sharp edge",
 * "lived in one browser on one machine", roles and owning a server — for a
 * release whose three commits are about avatar storage and websocket pings.
 * 1.6.0 is not the newest note, so nothing looked at it. Twice: it came back
 * unchanged after being refused for exactly that.
 *
 * These are not in the prompt. The model has them anyway — the changelog is a
 * public page — which is the argument for checking against all of them rather
 * than only the one the prompt happens to show.
 */
function examplesInFull(repo) {
  const dir = join(repo, 'packages/site/content/changelog')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .sort()
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8')
      const body = raw.split('---').slice(2).join('---').trim()
      return {
        version: f.replace(/\.mdx$/, ''),
        text: body.replace(/^<(Image|Clip)[^>]*\/>\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim(),
      }
    })
    .filter((e) => e.text)
}

/* Every commit in the range, in one numbered list.
   Numbered because the coverage rule below has to name the one that went
   missing, and "the third commit under the app" is not something a refusal can
   say back to a model usefully. */
export function flatCommits(parts) {
  const out = []
  for (const part of parts) {
    for (const c of part.commits) out.push({ ...c, component: part.component, n: out.length + 1 })
  }
  return out
}

/**
 * The two editing skills, whole.
 *
 * `ops/internal/writing/` holds a copy of each, because the box the drafter
 * runs on has no ~/.claude/skills and a rule the model is judged by should not
 * come off a laptop that may be shut.
 *
 * Whole rather than summarised. The first version of this was fifteen lines of
 * the patterns these drafts kept producing, which is somebody deciding in
 * advance which of the rules matter — and the openers and the binary contrasts
 * were only two of the things the drafts got wrong.
 *
 * They cost about 4,000 tokens together. That is affordable now and was not
 * before: with num_ctx at its default this would have pushed the commits out
 * of the window, which is the bug directly above.
 */
function writingSkills(repo) {
  const dir = join(repo, 'ops/internal/writing')
  return ['no-ai-slop.md', 'natural-writing.md']
    .map((f) => {
      const path = join(dir, f)
      if (!existsSync(path)) { log(`  ! ${f} is not in this checkout`); return null }
      return readFileSync(path, 'utf8').trim()
    })
    .filter(Boolean)
}

/**
 * The commits, as much of them as the window has room for.
 *
 * Given a character allowance rather than deciding one. Everything else in the
 * prompt — the style guide, both editing skills, the rules — is a fixed cost
 * that has to be paid before a single commit is shown, so the caller measures
 * that first and hands over what is left.
 *
 * Three things get shortened, in this order, because they are worth different
 * amounts to a reader of the finished note:
 *
 *   1. Bodies, shared out shortest-first. A two-line commit does not need its
 *      share, and giving it away means the long bodies keep theirs.
 *   2. Bodies dropped entirely, oldest first, leaving the subject.
 *   3. Commits dropped entirely, oldest first.
 *
 * Every step says so in the prompt and in the log. A range this cannot show in
 * full is a range where the note will be thin, and that is worth knowing when
 * the note is read rather than being discovered from the note itself.
 */
function commitBlock(parts, allowance) {
  const all = flatCommits(parts)
  const overhead = (c) => `- [${c.n}] ${c.subject}\n`.length + 12
  const subjects = all.reduce((n, c) => n + overhead(c), 0)

  /* Not even the subjects fit. Newest first is the honest order to keep: they
     are the changes closest to what somebody is running. */
  let shown = all
  let dropped = 0
  if (subjects > allowance) {
    shown = []
    let used = 0
    for (const c of [...all].reverse()) {
      if (used + overhead(c) > allowance) break
      shown.push(c)
      used += overhead(c)
    }
    shown.reverse()
    dropped = all.length - shown.length
  }

  const forBodies = Math.max(0, allowance - shown.reduce((n, c) => n + overhead(c), 0))
  const budget = new Map()
  {
    let left = forBodies
    const order = [...shown].sort((a, b) => a.body.length - b.body.length)
    order.forEach((c, i) => {
      const share = Math.floor(left / (order.length - i))
      const take = Math.min(c.body.length, share)
      budget.set(c.n, take)
      left -= take
    })
  }

  let shortened = 0
  const lines = []
  for (const part of parts) {
    const mine = shown.filter((x) => x.component === part.component)
    if (!mine.length) continue
    lines.push(`## ${componentName(part.component)}`)
    for (const c of mine) {
      lines.push(`- [${c.n}] ${c.subject}`)
      const body = c.body.split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
      if (!body) continue
      const kept = body.slice(0, budget.get(c.n) ?? 0)
      for (const l of kept.split('\n')) if (l) lines.push(`    ${l}`)
      /* Said out loud rather than cut silently. A model that believes it has
         the whole commit writes as if it does. */
      if (kept.length < body.length) {
        shortened++
        lines.push(`    [commit ${c.n} continues past what would fit here]`)
      }
    }
  }
  if (dropped) {
    lines.push('')
    lines.push(
      `[${dropped} older commits in this range are not shown at all — the range is too long for one prompt, and the note can only be about what is above]`,
    )
  }
  return { text: lines.join('\n'), total: all.length, shown: shown.length, shortened, dropped }
}

/* A placeholder so the prompt can be measured before the commits go into it. */
const COMMITS = '\u0000commits\u0000'

function prompt(release, changes, style) {
  return [
    'You are writing the release notes for one version of Gryt. The style guide',
    'comes first, then the commits this release actually contains, then the',
    'rules for your answer. Write about the commits. Follow the rules.',
    '',
    '─────────────────────────────────────────────────────────────────────',
    'HOW GRYT PATCH NOTES ARE WRITTEN',
    '',
    'This is the house style guide, in full. Follow it. The voice section and',
    'the bullet rules matter most.',
    '',
    'Its examples are illustrations of a shape, never sentences to reuse. A',
    'draft was rejected for heading a section about importing themes with',
    '"Everyone has a face, and you can give it a name" — the guide\'s own',
    'example, and about avatars. Take the shape and write your own sentence',
    'about the commits in front of you.',
    '',
    style,
    '',
    '─────────────────────────────────────────────────────────────────────',
    'HOW THE SENTENCES SHOULD READ',
    '',
    'Two editing skills, in full. Sivert runs both over prose before it ships,',
    'and a draft is held to the same thing. Read them the way an editor would:',
    'they are about the sentences, and everything above is about the shape.',
    '',
    'Both were written for somebody working with a person, and two parts of',
    'that do not apply to you. They describe a choice between editing a draft',
    'and auditing one - you are doing neither, you are writing the note. And',
    'they ask for a note afterwards saying what changed - do not write one.',
    'You return the JSON shape described at the end of this prompt and nothing',
    'else. Everything else in them applies.',
    '',
    ...writingSkills(REPO).flatMap((text) => [text, '']),
    '─────────────────────────────────────────────────────────────────────',
    `THE RELEASE YOU ARE WRITING ABOUT: Gryt ${release.version}, ${release.date}`,
    '',
    'These are the commits it contains, grouped by component, and they are the',
    'only source for what this release changed. Commit bodies are included where',
    'the author wrote one, and are usually the best source for why.',
    '',
    'A commit with no body gives you its subject and nothing else. It does not',
    'give you a symptom, a cause, a scope, or who it affected. Three drafts were',
    'rejected for taking one: "fix themed titlebar and identity settings" became',
    'a titlebar that showed the wrong colour "especially on systems with dark',
    'mode enabled", and a second section about names reverting and avatars',
    'disappearing when the app reopened. The range said none of that. Where the',
    'body is missing, write the subject in a reader\'s words and stop, or put the',
    'commit in "omitted" — a short honest note beats a full one that is invented.',
    '',
    COMMITS,
    '─────────────────────────────────────────────────────────────────────',
    'WHAT APPLIES TO THIS DRAFT',
    '',
    'You are drafting from the commit range alone, so parts of the guide above',
    'are not yours to do:',
    '',
    '- Pictures and clips. You cannot take a screenshot. Never refer to one,',
    '  and never write the sentence that would introduce one.',
    '- Sponsors. You cannot see the sponsors list. Write nothing about them.',
    '- Vikunja. You cannot read the tasks. Where the guide says to use them for',
    '  the "why", use the commit body instead, and if it does not say why, do',
    '  not guess.',
    '',
    'Return JSON in this shape, and nothing else:',
    '',
    '  headline  One sentence naming the thing that actually matters, written',
    '            for somebody deciding whether to read on. Do not name the',
    '            version number in it; the page already shows that. Do not list',
    '            three things to sound complete — pick what matters and say it.',
    '            "Gryt now lets you save custom avatars, adds a new logo, and',
    '            fixes the avatar editor" is three headlines pretending to be',
    '            one, and it tells a reader nothing about which of the three is',
    '            worth their time. Pick the one somebody would mention first and',
    '            write that. The other two have sections; they do not need to be',
    '            in the headline as well.',
    '            These are the headlines written by hand, and they are the',
    '            target:',
    '',
    ...examples(REPO).map((h) => `              ${h}`),
    '',
    '  intro     One or two paragraphs, no heading, before everything else.',
    '            What this release is about: what was wrong, or what changed',
    '            direction, or what somebody notices first.',
    '',
    '            Never a summary of the sections below. "The most visible change',
    '            is the new logo, but the improvements to the editor are where',
    '            the work matters" is a table of contents in prose, and the',
    '            reader is about to read the sections anyway. If the second',
    '            paragraph is listing what the first three headings say, there',
    '            should not be a second paragraph.',
    '  sections  The article. Two to four, each about one thing that changed,',
    '            in the order the guide gives: what you notice, then what a',
    '            host notices, then what a careful person asks about. Each has',
    '            a heading that is a sentence rather than a label, and a body',
    '            of one to three paragraphs.',
    '',
    '            A heading must not be the headline again. The headline is',
    '            directly above it on the page; a section that repeats it',
    '            spends the reader\'s first heading saying nothing.',
    '  recap     The short version. Groups from the guide\'s list: Voice,',
    '            Avatars and images, Emoji, Updates, Hosting, Security,',
    '            Accessibility, Under the hood. Skip a group with nothing in',
    '            it. One line per item, past tense, from the reader\'s side.',
    '',
    '            What the ones that get misused actually mean. "Updates" is',
    '            Gryt updating itself — the installer, the version check, the',
    '            restart-to-update toast. It is not where a change goes when',
    '            nothing else fits: three drafts running put themes, identity',
    '            and a crash on device switch under it, and a group that means',
    '            anything means nothing. "Under the hood" is for what a reader',
    '            cannot see and still deserves an answer about; something they',
    '            can see is never under the hood however internal it felt to',
    '            write.',
    '',
    '            Reach for one of those labels first. A release that genuinely',
    '            does not fit any of them may have its own - the notes written',
    '            by hand use Identity, Servers, Joining and Interface - but a',
    '            new label is for a subject the list has no room for, not for',
    '            rewording one it already covers. "Under the hood" goes last.',
    '',
    '  omitted   One entry per numbered commit you have written nothing about,',
    '            with its number and one line saying why. Empty if you covered',
    '            all of them. This is not part of the note and no reader sees',
    '            it.',
    '',
    'EVERY COMMIT IS ACCOUNTED FOR',
    '',
    'The numbered list above is the whole release. Each commit either appears',
    'in the note - a section, or a line in the recap - or is named in',
    '"omitted" with a reason. Nothing may simply go unmentioned.',
    '',
    'This is the thing to get right. A note that reads well and covers three of',
    'five commits is worse than a clumsy one that covers all five, because',
    'nothing about it says a release was shrunk on the way through: the reader',
    'gets a finished note about a smaller release and never learns there was',
    'more. If a commit changes what somebody sees, hears, or has to do, it goes',
    'in the note whether or not it fits the shape you had in mind.',
    '',
    'A commit that says four things went wrong owes the reader four things, not',
    'the first one. Do not write "it had several issues" and then name one -',
    'either name them or leave the count out.',
    '',
    'A commit in "omitted" is a commit the note does not mention. Not in a',
    'section, not in the recap, not in the intro. Putting one in the list and',
    'then writing about it anyway is the worst of both: the reader gets the',
    'housekeeping you had already decided to spare them, and the list says you',
    'spared them. Decide once.',
    '',
    'Some commits have nothing in them for a reader, and those are what',
    '"omitted" is for. A version number put back, a directory added to',
    '.gitignore, a workflow that closes a task when a pull request merges - a',
    'person using Gryt cannot see any of it and should not be made to read',
    'about it. Put the number in "omitted" with a short reason and move on. Do',
    'not write a section about it, and do not leave it unmentioned either: a',
    'commit you decided against is a decision, and it goes in the list.',
    '',
    'Say when a change only happens on one operating system. A control that',
    'appears on Windows and nowhere else is a control most readers will go',
    'looking for and not find, so the sentence has to carry the platform.',
    '',
    'A change to what the app collects, stores or sends about a person is a',
    'privacy change, and privacy goes in Security. It gets its own section, it',
    'is not folded into a list of fixes, and it is not softened into the app',
    'respecting your privacy - say what it used to do and who could see it.',
    '',
    'British English. Colour, minimise, recognise, behaviour, organise. Gryt is',
    'written in it everywhere else, and a note in American spelling reads as',
    'coming from somewhere other than the rest of the site.',
    '',
    'Plain sentences only. No markdown, no bold, no links, no headings inside a',
    'paragraph. The site renders the shape itself.',
    '',
    'Never mention a task number, a pull request, a file or a function outside',
    'the "Under the hood" recap group. The same goes for:',
    '',
    '- package names such as @gryt/owl, and version numbers of anything that is',
    '  not Gryt itself',
    '- measurements: pixel values, corner radii, percentages, sample sizes. A',
    '  reader does not need "46.1% of avatars over 20,000 seeds" to understand',
    '  that avatars changed. Say that they changed.',
    '- acronyms and internal names: SFU, CDN, socket, module, dependency. If a',
    '  sentence needs one to make sense, the sentence is aimed at the wrong',
    '  reader. Write "the media server" or leave it out.',
    '',
    'Use the word "Previously" at most once in the whole note. It is the obvious',
    'way to write a contrast and it reads as a template when every paragraph has',
    'it. "used to", "before this", or simply putting the old behaviour in the',
    'second half of the sentence all work.',
    '',
    'A section belongs in "Under the hood" only if a user cannot see it. A',
    'redesigned hover card is something they can see, so it is not under the',
    'hood. Neither is a new logo, a new colour, a new button or anything else',
    'you wrote a section about — if it was worth a section, the reader can see',
    'it, and filing it under the hood in the recap contradicts your own note.',
    '',
    'Do not start more than one section with the same word. "Previously" in',
    'front of every contrast reads as a form someone filled in. Vary it, or',
    'put the old behaviour second in the sentence.',
    '',
    'Every fact must come from the commits above. Do not invent a number, a',
    'date, a feature or a reason.',
    '',
    'SECURITY',
    '',
    'If the commits contain a security fix, it gets its own section and is',
    'never softened. If they do not, this release has no security section and',
    'you must not write one. A shape is not a reason: a note about a connection',
    'that failed is not a note about security, however easy it is to describe',
    'it that way. The same goes for the Security group in the recap.',
    '',
    'HOW LONG',
    '',
    'Match the release. One or two commits is one section and one short intro',
    'paragraph — say the thing and stop. Two paragraphs and three headings',
    'about a single fix is the same sentence three times, and a reader can',
    'tell. A release with nothing much in it is allowed to have a short note;',
    'that is information too.',
    '',
    'WHAT NOT TO WRITE',
    '',
    'No sentence that would read the same in another product\'s release notes.',
    'If it would survive a find-and-replace of the word Gryt, it is filler and',
    'it is taking the place of a fact. "Improves the user experience", "keeps',
    'the visual language consistent", "this change is for you" — none of these',
    'say anything. Say what changed and who notices.',
    '',
    'Do not address the reader about the release itself. They are reading it;',
    'they know.',
    '',
    'FROM THE TWO EDITING SKILLS ABOVE, THE FOUR A DRAFT KEEPS BREAKING',
    '',
    'All of both applies. These four are the ones that have actually come back',
    'refused, so check them last before you answer:',
    '',
    '- The throat-clearing opener. "This release focuses on", "This update',
    '  brings", "This release improves". The reader knows what they opened.',
    '- The binary contrast. "It is no longer a picture, it is a live drawing".',
    '  Write the second half and drop the first.',
    '- Telling the reader what to make of a fact: "this makes troubleshooting',
    '  easier", "this ensures the message is read and understood". Give them',
    '  another fact instead.',
    '- Opening a sentence with the release rather than the thing. "This change',
    '  makes the narrow dialogs easier to read" is "The narrow dialogs are',
    '  easier to read now". Nothing refuses this, and none of the three notes',
    '  written by hand does it.',
    '- The portability test, on every sentence. If it would sit unchanged in',
    '  another product\'s notes, it is filler standing where a fact should be.',
    '',
    'If nothing in this release is visible to a user, return an empty sections',
    'array, an empty recap, a one-sentence intro saying so, and a headline',
    'saying it is a maintenance release.',
    '',
  ].join('\n')
}

/**
 * The prompt, with the commits cut to whatever the window has left for them.
 *
 * The fixed part is measured rather than estimated. It is the style guide,
 * both editing skills in full and the rules — about 31 kB, and every character
 * of it is paid before a single commit is shown. Budgeting the commits alone
 * is what let 1.5.5 reach 30,130 tokens against a window of 24,576 with its
 * body cap working exactly as written.
 */
/**
 * What a person said when they refused the last draft of this release.
 *
 * Kept apart from `retryPrompt`, which carries the rules a draft broke inside
 * one run. This is a different thing and reads differently: a person read a
 * finished note, said what was wrong with it in their own words, and asked for
 * another. Pasting it in among "Previously twice" would file a judgement as a
 * lint.
 *
 * Only the reason, never the refused draft. `retryPrompt` hands back the
 * previous answer because it wants the good parts kept; this does not, because
 * the draft it refers to was written from the same commits and starting again
 * from those is the point. Showing it would invite a light edit of a note
 * somebody already turned down.
 */
export function refusalBlock(refusal) {
  const reason = String(refusal ?? '').trim()
  if (!reason) return ''
  return [
    '',
    '─────────────────────────────────────────────────────────────────────',
    'YOUR LAST NOTE FOR THIS RELEASE WAS READ BY A PERSON AND REFUSED',
    '',
    'They said:',
    '',
    `  ${reason}`,
    '',
    'Write this release again from the commits above, with that fixed. It is',
    'the only feedback you have and it is worth more than a guess at what',
    'else might be wrong: change what they named and leave the rest of your',
    'judgement alone.',
    '',
  ].join('\n')
}

function promptFor(release, changes, style, refusal) {
  /* Added before the allowance is worked out, not after, so the commit block
     is asked to fit in what is left rather than in the whole window. It is a
     few hundred characters against twenty-four thousand tokens, but the whole
     of one release was a silent overflow and the way to not repeat that is to
     let nothing sit outside the arithmetic. */
  const skeleton = prompt(release, changes, style) + refusalBlock(refusal)
  const room = (CONTEXT_TOKENS - ANSWER_RESERVE) * 4
  const allowance = Math.max(0, Math.floor((room - (skeleton.length - COMMITS.length)) * COMMIT_SHARE))

  /* Built and measured rather than predicted. The allowance is spent on
     subjects, indented body lines, component headings and a note wherever a
     body was cut, and an arithmetic guess at all of that was wrong by 6 kB on
     a 164-commit range — which is the difference between fitting and not. So:
     build it, measure it, and if it came out over, ask for proportionally
     less. Two rounds is enough in practice and four is the backstop. */
  let asked = allowance
  let block = commitBlock(changes.parts, asked)
  for (let i = 0; i < 6 && block.text.length > allowance; i++) {
    /* Scaled from what was last asked for, not from the original allowance.
       Asking again from the original oscillates: the overshoot shrinks the
       request, the smaller request undershoots, the next round asks for nearly
       the original again, and it never settles. This only ever goes down. */
    asked = Math.floor(asked * (allowance / block.text.length)) - 1
    if (asked <= 0) break
    block = commitBlock(changes.parts, asked)
  }
  if (block.shortened) {
    log(`  ${block.shortened} of ${block.shown} commit bodies shortened to fit`)
  }
  if (block.dropped) {
    log(`  ! ${block.dropped} of ${block.total} commits are not in the prompt at all`)
    log('    the range is too long for one note; the draft can only cover what was shown')
  }
  return skeleton.replace(COMMITS, block.text)
}

/**
 * What to send back when a draft was refused.
 *
 * Rejecting a draft and waiting for the next tick throws away eight minutes of
 * GPU and gets the same mistakes again, because nothing about the next run is
 * different. Telling the model what it broke, with the draft in front of it, is
 * the one thing that changes the answer.
 *
 * The previous answer goes in as well as the reasons. Without it the model
 * writes a new note from scratch and loses whatever was already right — and
 * most of what these drafts get wrong is two sentences in an otherwise sound
 * article.
 */
function retryPrompt(previous, problems) {
  return [
    '',
    '─────────────────────────────────────────────────────────────────────',
    'YOUR LAST ANSWER WAS REFUSED',
    '',
    'You have already written this note once. It was checked and sent back.',
    'Here it is:',
    '',
    JSON.stringify(previous, null, 2),
    '',
    'It was refused for these reasons, and only these:',
    '',
    ...problems.map((p) => `  - ${p}`),
    '',
    'Write it again with those fixed. Everything else was fine — keep it.',
    'Do not start over, do not change what was not named above, and do not',
    'add anything to make up for what you are removing. A note that gets',
    'shorter because a section was wrong is a shorter note, not a worse one.',
    '',
  ].join('\n')
}

/**
 * The same schema, with every object closed to properties it did not name.
 *
 * Ollama takes SCHEMA as it stands. The Anthropic API's json_schema format
 * wants `additionalProperties: false` on each object, and adding it to SCHEMA
 * itself would change what Ollama is sent for no reason — so it is added here,
 * on the way out, and the one definition upstream stays the definition.
 */
export function strictSchema(node) {
  if (Array.isArray(node)) return node.map(strictSchema)
  if (!node || typeof node !== 'object') return node
  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = strictSchema(v)
  if (out.type === 'object' && out.properties) out.additionalProperties = false
  return out
}

/**
 * What the model actually wrote, out of a stream of server-sent events.
 *
 * Only `text_delta` is collected. With thinking on — which it is by default on
 * this model — the answer arrives after a run of `thinking_delta`, and those
 * are the reasoning rather than the note. Kept per block rather than as one
 * string because a turn can carry more than one text block, and two JSON
 * documents concatenated parse as neither.
 */
export function readAnthropicEvent(event, state) {
  if (event.type === 'error') {
    throw new Error(`anthropic: ${event.error?.type ?? 'error'}: ${event.error?.message ?? ''}`.trim())
  }
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
    const i = event.index ?? 0
    state.blocks.set(i, (state.blocks.get(i) ?? '') + event.delta.text)
  }
  if (event.type === 'message_start') {
    state.inputTokens = event.message?.usage?.input_tokens ?? 0
  }
  if (event.type === 'message_delta') {
    state.stopReason = event.delta?.stop_reason ?? state.stopReason
    state.outputTokens = event.usage?.output_tokens ?? state.outputTokens
  }
  return state
}

/* The state `readAnthropicEvent` fills in, so the test and the caller agree
   on its shape. */
export const emptyAnthropicState = () => ({
  blocks: new Map(),
  stopReason: null,
  inputTokens: 0,
  outputTokens: 0,
})

async function askAnthropic(text) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS)
  try {
    /* Streamed for the same reason the Ollama call is: a non-streamed request
       sends nothing until the whole answer exists, and Node's fetch gives up
       waiting for response headers after five minutes. Thinking makes that a
       real risk rather than a theoretical one, and it is what the SDK does for
       a max_tokens this size anyway. */
    const res = await fetch(`${ANTHROPIC_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        /* Server-side fallback. If a safety classifier declines the request,
           the API re-runs it on another model inside the same call instead of
           handing back a refusal. Vanishingly unlikely for a prompt made of
           git commits, and it costs nothing when it does not fire. */
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        stream: true,
        fallbacks: 'default',
        /* The same fixed shape Ollama is asked for, by the same reasoning:
           the site renders it with its own components, and a malformed answer
           is detectable rather than merely ugly. */
        output_config: { format: { type: 'json_schema', schema: strictSchema(SCHEMA) } },
        messages: [{ role: 'user', content: text }],
      }),
    })
    if (!res.ok) throw new Error(`anthropic ${res.status} ${await res.text().catch(() => '')}`.trim())

    const state = emptyAnthropicState()
    let buf = ''
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8')
      /* One event per `data:` line, and the last line of a chunk is usually a
         partial one — keep it for the next chunk rather than parsing it. */
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let event
        try { event = JSON.parse(line.slice(5).trim()) } catch { continue }
        readAnthropicEvent(event, state)
      }
    }

    log(`  ${state.inputTokens} tokens in, ${state.outputTokens} out`)
    /* A refusal is a 200 with nothing usable in it, so it has to be checked
       rather than caught. It means the fallback model declined as well; the
       one before it would have been rescued silently. */
    if (state.stopReason === 'refusal') throw new Error('anthropic: the request was declined')

    const parts = [...state.blocks.values()]
    /* Normally one block. Where there are two, joining them is right when the
       JSON was split across them and wrong when each is its own document, and
       there is no telling which from here — so try the join, then the pieces. */
    for (const candidate of [parts.join(''), ...parts]) {
      try { return JSON.parse(candidate) } catch { /* next */ }
    }
    throw new Error(`anthropic: no JSON in the answer (${parts.join('').slice(0, 200)})`)
  } finally {
    clearTimeout(timer)
  }
}

async function askOllama(text) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS)
  try {
    /* Streamed, and not for the progress. With stream:false the server sends
       nothing at all until the whole answer is generated, and Node's fetch
       gives up waiting for response headers after five minutes — a 13 kB
       prompt into a 32b model is comfortably past that, and it surfaces as a
       bare "fetch failed" that looks like the box is unreachable. Streaming
       puts bytes on the wire immediately, so the only timeout that applies is
       the one above. */
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        format: SCHEMA,
        /* qwen3 reasons out loud by default, and the reasoning is not the
           answer. Without this the content comes back with a think block
           wrapped round the JSON and the parse fails. */
        think: false,
        /* num_ctx, and it is the important one.
           Ollama does not read the model's own window: it allocates num_ctx,
           which is 4096 unless asked otherwise, and quietly drops whatever
           does not fit. Nothing in the response says it happened. A one-commit
           release fits inside 4096 and a five-commit release does not, which
           is why the drafts that read as finished notes about a smaller
           release were all the large ones. */
        options: { temperature: 0.4, num_ctx: OLLAMA_NUM_CTX },
        messages: [{ role: 'user', content: text }],
      }),
    })
    if (!res.ok) throw new Error(`ollama ${res.status} ${await res.text().catch(() => '')}`.trim())

    let out = ''
    let buf = ''
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8')
      /* One JSON object per line, and the last line of a chunk is usually a
         partial one — keep it for the next chunk rather than parsing it. */
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let obj
        try { obj = JSON.parse(line) } catch { continue }
        if (obj.error) throw new Error(`ollama: ${obj.error}`)
        if (obj.message?.content) out += obj.message.content
      }
    }
    return JSON.parse(out)
  } finally {
    clearTimeout(timer)
  }
}

/* Which of the two gets asked. Chosen once at load, so a run cannot be half
   one model and half the other. */
const ask = (text) => (PROVIDER === 'anthropic' ? askAnthropic(text) : askOllama(text))

/* Read when it is used rather than at load, unlike the other settings here.
   A minute of real sleeping in a test is a test nobody runs, and the file is
   imported once per process, so a module-level const cannot be turned down
   afterwards. */
const retryDelayMs = () => Number(process.env.OLLAMA_RETRY_DELAY_MS ?? 60_000)

/* Whether the request never reached the model at all.
   Undici throws a bare `TypeError: fetch failed` for this, which is the same
   shape whether the host is down, the connection dropped, or — the case that
   actually happens here — no response headers arrived within five minutes.
   That five minutes is undici's own `headersTimeout`, not OLLAMA_TIMEOUT_MS,
   and the comment above `ask` is right that streaming avoids it for
   generation: Ollama sends headers before the first token. It does not send
   them while the request is queued behind somebody else's, and this box shares
   its model.
   An error that came back *from* the model — a non-2xx, or an `error` field in
   the stream — is not this. Those mean the model answered, and answered badly,
   and asking again unchanged is not going to help. */
export function neverReachedTheModel(err) {
  return err instanceof TypeError && /fetch failed/i.test(err.message ?? '')
}

/* One retry, because losing the release costs an hour and the retry costs a
   minute.
   Before this, a thrown error broke out of the attempt loop and `continue`d to
   the next release, so a five-minute queue meant that release got no note for
   the whole cycle. On 2026-08-30 that skipped 1.6.43 outright. Once, not in a
   loop: if the model is genuinely unreachable, the next timer run is a better
   place to find that out than a retry spiral inside one. */
export async function askWithRetry(text) {
  try {
    return await ask(text)
  } catch (err) {
    if (!neverReachedTheModel(err)) throw err
    const delay = retryDelayMs()
    log(`  · ${err.message} — never reached the model, retrying once in ${Math.round(delay / 1000)}s`)
    await new Promise((resolve) => setTimeout(resolve, delay))
    return ask(text)
  }
}

/* Words that belong to the material shown to the model and to nothing in this
   release.
   The example is there to show the shape, and a model that has just read a
   finished note is very willing to write that note again — the 1.6.43 draft
   came back describing 24-word backups and certificate authorities, none of
   which appear anywhere in its commit range. Telling it not to is not enough,
   so this checks.

   The two editing skills are deliberately not put through it, and the reason
   is worth keeping. They are the same hazard on paper — fifteen kilobytes of
   worked sentences about deploy times and sponsor trackers, none of which has
   ever been in a Gryt release — so they were, and all three hand-written
   notes came back scoring 40 to 46. The borrowed words were "voice",
   "reading", "person", "words": ordinary English about writing, which is what
   a skill about writing is made of and what a release note is written in. The
   threshold underneath this is calibrated against one short note, and there
   is no version of it that separates a 15kB corpus of general prose from a
   note that happens to be written in English.

   What is left instead is that the skills are rules rather than a finished
   note. The failure this guard exists for was a model retelling an example
   note wholesale, and an instruction to cut adverbs is not something there is
   a wrong way to copy. */
/* A heading lifted out of the style guide.

   The guide is pasted into the prompt in full so the model can follow it, which
   also puts its illustrations in reach. A draft headed a section about importing
   themes with "Everyone has a face, and you can give it a name" — the guide's own
   example of a heading that is a sentence rather than a label, and about avatars.

   `contamination` above will not see this: it counts distinctive words across the
   whole note against a threshold of twenty, and a borrowed heading is nine words
   of ordinary English. This is the exact-match case, which is cheap to ask about
   and has no false positive worth worrying about — a heading that appears verbatim
   in the guide came from the guide. */
export function borrowedHeading(entry, styleText) {
  if (!styleText) return null
  const flat = (t) =>
    t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

  /* The guide's examples are quoted, which is what makes them findable. Three
     words up, because shorter quotes in it are single terms like "Avatars" and
     a heading is allowed to contain those. */
  const quoted = [...styleText.matchAll(/[“"]([^”"]{12,120})[”"]/g)]
    .map((m) => flat(m[1]))
    .filter((q) => q.split(' ').length >= 3)

  for (const heading of [entry.headline, ...entry.sections.map((s) => s.heading)]) {
    const h = flat(heading ?? '')
    if (!h) continue
    /* `includes` both ways: the draft that prompted this took "Everyone has a
       face" and added ", and you can give it a name", so neither string
       contains the other whole. */
    const lifted = quoted.find((q) => h.includes(q) || q.includes(h))
    if (lifted) {
      return `the heading "${heading}" is an example out of the style guide, not a sentence about these commits`
    }
  }
  return null
}

/* A paragraph taken out of a note about a different release.
 *
 * `contamination` is tuned for wholesale retelling — the draft that scored 59
 * against a correct one's 8 — and a single borrowed paragraph goes straight
 * under it. On 2026-08-31 a draft for 1.6.38 opened with 1.6.0's first
 * paragraph, about guest identity, roles and owning a server, for a release
 * whose three commits are avatar storage and websocket pings. It scored 11 on
 * the word count and sailed through, twice, the second time after being
 * refused for exactly that.
 *
 * Measured rather than guessed. Against the four notes written by hand, that
 * paragraph scores 0.625; the worst any honest draft in the same batch scores
 * against any of their paragraphs is 0.313. 0.45 sits between with room on
 * both sides.
 *
 * Only paragraphs of twelve content words or more. Two short sentences about
 * the same feature legitimately share most of their words, and a rule that
 * fires on those is a rule that gets turned off.
 *
 * Not run over the hand-written notes themselves, for the obvious reason.
 */
export function liftedParagraph(entry, examples) {
  const notes = Array.isArray(examples) ? examples.filter((e) => e && e.text) : []
  if (!notes.length) return null

  const paragraphs = [...(entry.intro ?? []), ...(entry.sections ?? []).flatMap((s) => s.body ?? [])]
  for (const note of notes) {
    /* Headings and list items are short and formulaic; a heading matching a
       heading is what `borrowedHeading` is for and it says something else. */
    const theirs = note.text
      .split(/\n\n+/)
      .map((t) => t.trim())
      .filter((t) => t && !/^[#!\-<|]/.test(t) && contentWords(t).size >= 12)
    for (const mine of paragraphs) {
      if (contentWords(mine).size < 12) continue
      for (const other of theirs) {
        if (overlap(mine, other) >= 0.45) {
          return `a paragraph is taken from the ${note.version} note: "${mine.slice(0, 70)}"`
        }
      }
    }
  }
  return null
}

export function contamination(entry, examples, commitText) {
  if (!examples) return null
  /* A string is one note, an array is all of them. Kept accepting a string so
     the older callers and their tests still mean what they meant. */
  const notes = typeof examples === 'string'
    ? [{ version: 'the example', text: examples }]
    : examples.filter((e) => e && e.text)
  if (!notes.length) return null

  const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []))
  const inCommits = words(commitText)
  const draft = words(JSON.stringify(entry))

  /* Each note on its own rather than all of them pooled. Pooled, the set of
     words that are "in some hand-written note and not in this range" is large
     enough that an honest draft collects a score from four notes at once and
     the number stops meaning what it means against one. This way a hit still
     says the same thing it always did: this draft is retelling *that* note. */
  let worst = null
  for (const note of notes) {
    const distinctive = [...words(note.text)].filter(
      (w) => !inCommits.has(w) && !COMMON.has(w),
    )
    const shared = distinctive.filter((w) => draft.has(w))
    if (!worst || shared.length > worst.borrowed.length) {
      worst = { version: note.version, borrowed: shared }
    }
  }
  const borrowed = worst.borrowed
  /* A handful is coincidence. A pile of it is the example being retold. The
     contaminated 1.6.43 draft scored 59 against a correct one's 8, so there is
     a lot of room between them; the ordinary English filtered out by COMMON is
     what keeps a short commit range from making that gap look narrower than it
     is. */
  return borrowed.length > 20
    ? `looks copied from ${worst.version} (${borrowed.length} of its words, none in the commits: ${borrowed.slice(0, 6).join(', ')})`
    : null
}

/* Ordinary English long enough to pass the length filter. A four-commit range
   is small, so plenty of unremarkable words are "not in the commits" without
   meaning anything at all. */
const COMMON = new Set(`about after again against along already also although always
  another anything around because become been before being below better between both
  cannot could different does doing done during each either enough even every
  everything first from further given gives going great group hardly have having
  here however into itself just keep kept know large last later least less like
  little long made make many might more most much must never next nothing
  often once only other others over own part particular perhaps place point
  quite rather really right same seem seems several should since small some
  something sometimes still such take taken than that their them then there
  these they thing things think this those though three through thus time
  together
  under until upon used uses using usually very want well were what when where
  whether which while with within without would your yours` .split(/\s+/).filter(Boolean))

/* ── The house style, as code ────────────────────────────────────────────
   Everything below is also a rule in the prompt, and the prompt is where a
   model is meant to learn it. These exist because it demonstrably does not.
   The first drafts off the box broke the "Previously" rule twice in one note,
   wrote a security section for a release with no security in it, and used the
   headline again as the first section heading — all while being told not to.

   A rule the model can ignore is a suggestion. A rule here is a rule: a draft
   that breaks one is not written and the next run tries again. */

/**
 * The two kinds of problem, and why a draft is only thrown away for one.
 *
 * Every rule used to be fatal. `styleProblems` returned a flat list and any
 * entry in it meant the release got no note at all, so a clumsy sentence
 * opener cost exactly what a fabricated security section cost. That was
 * tolerable while there were four rules and the model saw eight lines of each
 * commit. On the first real run afterwards it attempted eighteen releases in
 * eight hours and posted one: five of the ten refusals were a weak opener or a
 * section count, on notes that were otherwise correct.
 *
 * A note nobody publishes helps nobody, and every note goes to somebody who
 * reads it before it is published — that is what the queue is for. So:
 *
 * **hard** is a note that is wrong. A commit missing with nothing saying so, a
 * security claim the commits do not support, a function name in the article,
 * the example retold. These never ship, on any attempt.
 *
 * **soft** is a note that is worse. "Previously" twice, a recap line echoing
 * its heading, one section too many. Sent back while there are attempts left,
 * because the model usually fixes them — and let through on the last attempt,
 * because a person is about to read it anyway.
 */
const hard = (text) => ({ text, hard: true })
const soft = (text) => ({ text, hard: false })

/** Comparable form, so "the same sentence" survives punctuation and case. */
export function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/* Ignored when comparing two sentences, because a short heading is mostly
   these and they make any two English sentences look alike. Without this,
   1.5.0's "The client is a server" scored 0.8 against its own headline —
   four words shared, and all four of them were "the", "is", "a" and "server". */
const STOPWORDS = new Set(`a an and are as at be been but by can do does for from
  has have how if in into is it its more no not now of on or so than that the
  their them then there these they this to up was were what when which who will
  with you your`.split(/\s+/).filter(Boolean))

/* Deliberately not stemmed.
   Making "sends" and "sending" the same word would have caught one more recap
   line filed under the hood, and it also made the containment check below
   refuse 1.4.0's "The image worker ships with the app now" — a genuinely
   invisible change, in a note whose article is about images. That is the third
   time tuning that measure moved the problem rather than fixing it, so the
   structural rule underneath does the work instead and this stays literal. */
const contentWords = (text) =>
  new Set(normalise(text).split(' ').filter((w) => w && !STOPWORDS.has(w)))

/**
 * How much two sentences are the same sentence.
 *
 * Against the longer of the two, not the shorter. A headline often covers two
 * things and a section takes one of them — 1.5.0's headline is about not
 * needing an account *and* the app being a server, and its first heading is
 * "You do not need an account". Measured against the heading that is a perfect
 * score; measured against the headline it is a quarter, which is the honest
 * answer. Restating the whole headline still scores high, because then there
 * is nothing in the longer one that the shorter one left out.
 */
export function overlap(a, b) {
  const x = contentWords(a)
  const y = contentWords(b)
  if (!x.size || !y.size) return 0
  const shared = [...x].filter((w) => y.has(w)).length
  return shared / Math.max(x.size, y.size)
}

/* Words that make a change a security change.
   Not `auth` on its own, and not a bare substring match. The first version of
   this check used both, and cleared a security section for 1.6.41 — a CORS
   preflight failing behind a proxy — because the commit body happens to
   contain "one unauthenticated GET to /info". `auth` also lives inside
   "author" and "authoritative", and `escap` inside "landscape". */
const SECURITY_WORDS = new RegExp(
  '\\b(security|vulnerabilit(y|ies)|exploit|cve-\\d|xss|csrf|clickjack' +
    '|injection|sanitis|sanitiz|spoof|privilege|credential|password|passphrase' +
    '|secret|encrypt|decrypt|signature|certificate|keychain|authenticat' +
    '|authoris|authoriz|permission)\\b',
  'gi',
)

/**
 * Whether the range actually contains a security change.
 *
 * A subject that says so is taken at its word — that is somebody labelling
 * their own commit. A body is weaker evidence, because a commit explains
 * mechanism and mechanism mentions authentication in passing, so a body has to
 * raise the subject twice over before it counts.
 *
 * The failure this exists to stop is the model reaching for a security section
 * because the house style asks for one, not because the release had one.
 */
export function hasSecurityChange(parts) {
  const subjects = parts.flatMap((part) => part.commits.map((c) => c.subject)).join('\n')
  if (SECURITY_WORDS.test(subjects)) return true

  const bodies = parts.flatMap((part) => part.commits.map((c) => c.body)).join('\n')
  const distinct = new Set((bodies.match(SECURITY_WORDS) ?? []).map((w) => w.toLowerCase()))
  return distinct.size >= 2
}

/**
 * Whether a piece of prose claims this release did something about security.
 *
 * Not "does the word appear". 1.6.14 was a maintenance release and its intro
 * ended "There are no new features, no visible changes to how the app behaves,
 * and no security fixes in this release" — which is the note being careful,
 * and which this refused three times for claiming security. Eighty minutes on
 * a rule that could not read a negation.
 *
 * So the clause is what is tested, not the paragraph, and a clause that denies
 * it does not count. Clause-level rather than sentence-level because these
 * arrive as lists: the sentence above claims nothing, and only its third
 * comma-separated piece is about security at all.
 */
const SECURITY_CLAIM = /\b(security|insecure|vulnerab)/i
const DENIES = /\b(no|not|nothing|none|never|without)\b[^,.;]{0,40}\b(security|insecure|vulnerab)/i

export function claimsSecurityIn(text) {
  return String(text)
    .split(/[,.;]/)
    .some((clause) => SECURITY_CLAIM.test(clause) && !DENIES.test(clause))
}

/* Sentences that would sit unchanged in any other project's release notes.
   The style guide calls this the portability test; this is the short version
   of it, drawn from what the drafts actually produced. */
/* Spellings that say the note came from somewhere other than the rest of the
   site. Gryt is written in British English throughout — the style guide, the
   hand-written notes, the UI strings — and four drafts running came back with
   the American ones. A hard problem rather than a soft one: it is not a matter
   of taste, and it reaches the page. Only the pairs a release note actually
   reaches for; this is not a dictionary. */
/* The suffix is open on purpose.
 *
 * Each of these listed the forms somebody had seen — customiz(e|ed|es|ing) —
 * which meant the word had to end there. "customizable" walked through a
 * clean run on 2026-08-31 because -able was not one of the four. So does
 * "organizational", "minimizer", "recognizable". The stems below do not occur
 * in British English at all, so anything built on one is wrong whatever the
 * ending, and listing endings is a game that only ever loses. */
const AMERICAN = [
  [/\bcolors?\b/i, 'colour'],
  [/\bminimiz[a-z]*\b/i, 'minimise'],
  [/\brecogniz[a-z]*\b/i, 'recognise'],
  [/\bbehaviors?\b/i, 'behaviour'],
  [/\borganiz[a-z]*\b/i, 'organise'],
  [/\bcustomiz[a-z]*\b/i, 'customise'],
  [/\binitializ[a-z]*\b/i, 'initialise'],
  [/\bnormaliz[a-z]*\b/i, 'normalise'],
  [/\boptimiz[a-z]*\b/i, 'optimise'],
  [/\bprioritiz[a-z]*\b/i, 'prioritise'],
  [/\bsynchroniz[a-z]*\b/i, 'synchronise'],
  [/\banaly[sz]?z[a-z]*\b/i, 'analyse'],
  [/\bcanceled\b/i, 'cancelled'],
  [/\bcentered?\b/i, 'centred'],
  [/\bfavorites?\b/i, 'favourite'],
]

const FILLER = [
  /this change is for you/i,
  /we('| a)re (excited|pleased|happy)/i,
  /visual language/i,
  /user experience/i,
  /seamless/i,
  /under the hood improvements/i,
  /stay tuned/i,
  /and much more/i,
  /* The openers. Every draft in the first batch began the same way, and the
     sentence is the reader being told what they already know: they opened a
     release note. */
  /\bthis (release|update|version) (focuses on|brings|improves|adds more|introduces)\b/i,
  /* Not "this change makes …". That was here and it was wrong: it matches a
     construction rather than an empty sentence, and the sentences it caught
     were "This release ensures the webcam card is always shown, and it keeps
     trying until the stream is ready" and "This change makes it easier to
     leave a server without leftover data blocking your next steps". Both name
     something specific and neither would survive a find-and-replace of the
     word Gryt, which is the test the guide actually gives. The construction is
     still not house style — none of the three written by hand use it — so the
     prompt discourages it and nothing here refuses it. */
  /\bwhich is particularly useful\b/i,
  /\bfor both users and developers\b/i,
  /* From natural-writing's banned list and no-ai-slop's. "Refactored" is the
     one that turns up here, in a recap line nobody outside the repository can
     act on. */
  /\b(delve|leverage|seamless|robust|streamline[sd]?|elevate|harness|transformative|cutting-edge|game-changing|revolutionary|empower|foster|utilize|refactored)\b/i,
]

/* Names only somebody with the checkout can use.
   The prompt forbids these outside "Under the hood" and the model writes them
   anyway - resolveAvatarSrc and skewMs both reached a draft as the subject of
   a sentence, and public/logo.svg and `yarn icons:generate` were printed in
   the middle of a paragraph about a logo.

   The camel-case shapes that are ordinary English on a page about a chat app
   are listed rather than guessed at, because "macOS" and "WebRTC" are the two
   this would otherwise fire on constantly. */
/* The recap groups the guide lists, in the order it lists them.
   Where to start, not a closed set: the notes written by hand since have added
   Identity, Servers, Joining and Interface. Shown to the model so it reaches
   for one of these first, and not enforced, because enforcing it would have
   refused two of the three notes it is meant to be imitating. */
export const RECAP_GROUPS = [
  'Voice',
  'Avatars and images',
  'Emoji',
  'Updates',
  'Hosting',
  'Security',
  'Accessibility',
  'Under the hood',
]

/* How a commit says a change only happens on one operating system.
   Narrow on purpose: this has to fire on the sentence that means it and not
   on every commit that mentions Windows in passing. */
const PLATFORM_ONLY = [
  [/\b(windows[- ]only|only (on|where the OS can do this, which is) windows|only appears (on|where).{0,40}windows)\b/i, 'Windows'],
  [/\b(macos[- ]only|only on macos)\b/i, 'macOS'],
  [/\b(linux[- ]only|only on linux)\b/i, 'Linux'],
]

const NOT_IDENTIFIERS = new Set(
  `macos ios ipados androidos webrtc websocket javascript typescript github gitlab
   youtube postgresql sqlite openai iphone ipad javascriptcore webgl webgpu
   nodejs npmjs`.split(/\s+/).filter(Boolean),
)

const IDENTIFIER_SHAPES = [
  /* Backticks are not on this list. The hand-written notes put a hostname and
     an environment variable in them, in the article, and both belong there -
     somebody hosting a server has to type them. What the drafts got wrong was
     the name of a function and the path of a file, which the three shapes
     below catch on their own. */
  [/\b[\w-]+\.(ts|tsx|js|mjs|cjs|jsx|json|svg|png|webp|html|css|scss|md|mdx|go|rs|py|yml|yaml|sh)\b/, 'a file name'],
  [/\b(yarn|npm|pnpm|git|docker|curl)\s+[a-z][\w:-]*/, 'a command'],
  [/\b[a-z]+[A-Z][A-Za-z]*\b/, 'a camel-case name'],
]

/* Prose a reader sees, which is everything except the "Under the hood" group.
   That group is where the guide allows this vocabulary, and the hand-written
   notes use it there. */
function readerProse(entry) {
  const recap = entry.recap
    .filter((g) => !/under the hood/i.test(g.group))
    .flatMap((g) => g.items)
  const sections = entry.sections.flatMap((s) => [s.heading, ...s.body])
  return [entry.headline, ...entry.intro, ...sections, ...recap]
}

/**
 * The rules that are about writing rather than about shape.
 *
 * Returned as a list rather than the first failure, because a draft that
 * breaks three of these is worth seeing all three of at once when it lands in
 * `rejected/`. Reading a refusal is how the first fabricated draft was
 * diagnosed, and one reason at a time makes that three runs instead of one.
 */
/**
 * Prose that says the same thing twice.
 *
 * The most common thing wrong with these drafts, by a distance. Of eleven
 * reviewed on 2026-09-02, five repeated themselves: an intro paragraph restated
 * as the first line of the section below it, a section's second paragraph
 * saying its first one again, and 1.7.2 carrying one sentence three times, once
 * per section, in a note of 1650 characters covering 80 commits.
 *
 * Nothing caught any of it, because every rule here was about a word or a
 * shape, and this is about two sentences being the same sentence.
 *
 * Sentence by sentence rather than paragraph by paragraph. The repetitions were
 * rarely whole paragraphs — usually one sentence lifted into a new position
 * with a word changed, which a paragraph comparison misses entirely.
 *
 * `overlap` is content words over the longer set, so it already ignores the
 * articles and the word order. Eight words is the floor because short sentences
 * legitimately resemble each other: "The tray icon now works" and "The tour
 * works properly now" share most of what little they have.
 */
export function repeatedProse(entry) {
  const problems = []

  const sentences = []
  const push = (where, text) => {
    for (const raw of String(text).split(/(?<=[.!?])\s+/)) {
      const s = raw.trim()
      if (s && contentWords(s).size >= 8) sentences.push({ where, text: s })
    }
  }

  entry.intro.forEach((p) => push('the opening', p))
  entry.sections.forEach((s) => s.body.forEach((p) => push(`"${s.heading}"`, p)))

  /* Every pair once. These are short documents — a dozen sentences, rarely
     forty — so the quadratic does not matter and a cleverer index would only
     be something else to get wrong. */
  outer: for (let i = 0; i < sentences.length; i += 1) {
    for (let j = i + 1; j < sentences.length; j += 1) {
      if (overlap(sentences[i].text, sentences[j].text) <= 0.75) continue

      const a = sentences[i]
      const b = sentences[j]
      const where = a.where === b.where ? `twice in ${a.where}` : `in ${a.where} and again in ${b.where}`
      problems.push(soft(`the same sentence ${where}: "${trim(a.text)}"`))
      /* One is the point. A draft that repeats itself four times would
         otherwise bury every other problem it has. */
      break outer
    }
  }

  /* A recap bullet under two groups. 1.9.2 listed "the server refuses empty
     secrets" under both Voice and Security, and 1.7.2 listed the same call
     bullet twice. The recap is meant to be the whole note read quickly, so a
     line appearing twice makes it longer without making it say more. */
  const items = entry.recap.flatMap((g) => g.items.map((item) => ({ group: g.group, item })))
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (overlap(items[i].item, items[j].item) <= 0.8) continue
      const groups = items[i].group === items[j].group
        ? `twice under ${items[i].group}`
        : `under both ${items[i].group} and ${items[j].group}`
      problems.push(soft(`the same recap line ${groups}: "${trim(items[i].item)}"`))
      i = items.length
      break
    }
  }

  return problems
}

/** Enough of a sentence to recognise it, without filling the log with it. */
function trim(text) {
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

export function styleProblems(entry, parts) {
  const problems = [...repeatedProse(entry)]
  const headings = entry.sections.map((s) => s.heading)
  const prose = [...entry.intro, ...entry.sections.flatMap((s) => s.body)]

  /* At most once in the whole note. It is the obvious way to write a contrast
     and it reads as a form somebody filled in when every paragraph has it. */
  const previously = prose.join(' ').match(/\bpreviously\b/gi)?.length ?? 0
  if (previously > 1) problems.push(soft(`"Previously" ${previously} times, and once is the limit`))

  /* The headline is already on the page, directly above. A section that
     repeats it spends the reader's first heading saying nothing new. */
  for (const heading of headings) {
    if (overlap(entry.headline, heading) > 0.6) {
      problems.push(soft(`the heading "${heading}" is the headline again`))
    }
  }

  /* Two sections opening on the same word reads as a template rather than as
     writing — but only when the word carries something. The reason the guide
     gives is "Previously" in front of every contrast, not the definite article,
     and two sections beginning "The" is ordinary English rather than a form
     somebody filled in.

     This blocked a draft twice before the distinction was made: the model
     fixed the "Previously" it was told about and then had nowhere to go, which
     is what a rule that is wrong looks like from the outside. 1.5.0 varies its
     four openings — You, The, Somebody, Adding — so the rule matches the
     writing; it just should not fire on the article. */
  const firstWords = headings
    .map((h) => normalise(h).split(' ')[0])
    .filter((w) => w && !STOPWORDS.has(w))
  const repeated = firstWords.find((w, i) => firstWords.indexOf(w) !== i)
  if (repeated) problems.push(soft(`more than one section starts with "${repeated}"`))

  /* The recap is the short version, not the headings again. Somebody who read
     the article should still find something in it. */
  const items = entry.recap.flatMap((g) => g.items)
  const echoes = items.filter((item) => headings.some((h) => overlap(item, h) > 0.7))
  if (items.length && echoes.length === items.length) {
    problems.push(soft('every recap line is one of the section headings again'))
  }

  /* A body paragraph that is already in the intro.

     1.6.42 opened its only section with a word-for-word copy of its own intro
     paragraph, and 1.6.41 did the same with two words changed. It reads as a
     note twice as long as it is, and the second copy is always the one that
     could have said something new.

     `overlap` is content-word based, so a verbatim copy scores 1.0 and a
     reworded one still scores high. The threshold is measured rather than
     guessed: across the four notes written by hand the highest any intro
     paragraph scores against any body paragraph is 0.607 — 1.7.0 restating
     that direct messages are not encrypted, which is repetition on purpose
     and must stay allowed. 1.6.42's copy scored 0.810. 0.75 sits between
     them with room either side.

     Short paragraphs are skipped: two eight-word sentences about the same
     feature will legitimately share most of their words. */
  const paragraphs = entry.sections.flatMap((s) => s.body)
  for (const intro of entry.intro) {
    if (contentWords(intro).size < 12) continue
    const copy = paragraphs.find((body) => overlap(intro, body) >= 0.75)
    if (copy) {
      problems.push(soft(`a paragraph repeats the intro: "${copy.slice(0, 60)}"`))
      break
    }
  }

  /* Security is its own section when there is security in the release, and no
     section at all when there is not. The prompt used to say "always", which
     is a shape to fill rather than a fact to report. */
  /* Anywhere in the note, not just in a heading. The draft that started this
     had "Security:" in a heading and was caught by that, but the same
     fabrication written as "Gryt no longer risks insecure connections" with
     "this change improves security" in the body would have gone straight
     through — the claim is what matters, not where it is made. */
  const claimsSecurity = [...headings, ...entry.recap.map((g) => g.group), ...prose].some(
    (text) => claimsSecurityIn(text),
  )
  if (claimsSecurity && !hasSecurityChange(parts)) {
    problems.push(hard('the note claims security, and nothing in the commits is about security'))
  }

  /* A heading is a sentence. "Security:" and "Performance:" are labels with a
     sentence stapled on. */
  const labelled = headings.find((h) => /^[A-Z][A-Za-z ]{0,20}:/.test(h))
  if (labelled) problems.push(soft(`the heading "${labelled}" is a label, not a sentence`))

  /* "A, B, and C" in the headline. The guide says pick what matters and say
     it, and a list of three is the model sounding complete instead of
     choosing — "Gryt now lets you save custom avatars, adds a new logo, and
     fixes the avatar editor" is three releases' worth of headline for one.

     Counting commas alone would refuse 1.6.0's hand-written headline, which
     has two of them and names one thing: the middle segment is "even without
     an account", a qualifier rather than a list item. So a segment that opens
     with a subordinator does not count towards the list. */
  const segments = entry.headline.split(',').map((seg) => seg.trim()).filter(Boolean)
  const subordinator = /^(even|which|so|because|though|although|while|if|when|unless|and then)\b/i
  if (
    segments.length >= 3 &&
    /^and\b/i.test(segments[segments.length - 1]) &&
    !segments.slice(1, -1).some((seg) => subordinator.test(seg))
  ) {
    problems.push(soft('the headline lists three things rather than naming the one that matters'))
  }

  /* Under the hood is for what a user cannot see. A release that got a whole
     section about it is, by construction, something they can — the note itself
     is the evidence. The new brand mark went in there while the intro two
     paragraphs above called it the most visible change in the release. */
  const underHood = entry.recap.find((g) => /under the hood/i.test(g.group))
  if (underHood) {
    /* Two ways of asking the same question. The heading comparison catches an
       item that restates a heading; the containment one catches the same fact
       worded differently, which is what actually happens — "The app no longer
       defaults to HTTP for servers added before HTTPS logic existed" shares
       almost nothing with the heading above it and every word with the
       paragraph underneath.

       The hand-written notes put real invisible things here — a compiled
       SQLite library swapped for Node's, React 19, the client compiling in CI —
       and none of them appear in their own article, which is the whole point:
       if it was worth explaining, the reader can see it. */
    const article = contentWords([...headings, ...prose].join(' '))
    const visible = underHood.items.find((item) => {
      if (headings.some((h) => overlap(item, h) > 0.4)) return true
      const words = [...contentWords(item)]
      if (words.length < 4) return false
      return words.filter((w) => article.has(w)).length / words.length > 0.7
    })
    if (visible) {
      problems.push(soft(`"${visible}" is under the hood, and the note explains it above`))
    }
  }

  /* Under the hood as the only group.
     A note with sections in it has just described something a reader can see,
     so a recap whose only heading is "Under the hood" is not summarising that
     note — it is filing the whole release as invisible. Three drafts running
     did exactly this, and the word matching above missed two of them by a hair
     either way.

     Asked structurally instead: no threshold, no vocabulary, nothing to tune,
     and nothing for a change of wording to slip past. The hand-written notes
     have eight, five and four recap groups. */
  if (entry.sections.length && entry.recap.length === 1 && underHood) {
    problems.push(soft('every recap line is under the hood, for a release with sections in it'))
  }

  for (const pattern of FILLER) {
    const hit = prose.find((paragraph) => pattern.test(paragraph))
    if (hit) {
      problems.push(soft(`filler: "${hit.match(pattern)[0]}"`))
      break
    }
  }

  /* British English, everywhere — including Under the hood.

     `readerProse` drops that recap group because identifiers are allowed in it,
     and this check reused it at first. A spelling is not an identifier: a reader
     reads Under the hood, and "consistent behavior" in it is as wrong as it
     would be anywhere else. A draft got through with exactly that (GRYT-755). */
  const everyLine = [
    entry.headline,
    ...entry.intro,
    ...entry.sections.flatMap((s) => [s.heading, ...s.body]),
    ...entry.recap.flatMap((g) => [g.group, ...g.items]),
  ]
  for (const line of everyLine) {
    const wrong = AMERICAN.find(([shape]) => shape.test(line))
    if (wrong) {
      problems.push(hard(`American spelling, "${line.match(wrong[0])[0]}" — Gryt writes "${wrong[1]}"`))
      break
    }
  }

  /* A release of subject lines cannot support a note that explains anything.

     Three drafts running were written from ranges where every commit was a
     subject and nothing else, and every one of them invented the part a body
     would have carried. 1.6.10's only commit was "fix themed titlebar and
     identity settings"; the draft gave it a dark-mode symptom and a second
     section about names reverting and avatars disappearing on restart.

     Structural rather than a word list: if nothing in the range says why, a
     paragraph explaining why came from somewhere else. One sentence per
     section is the most a subject line can honestly carry, so more than that
     is the tell. The count is of sentences across the whole note rather than
     per section, because the invention shows up as volume. */
  const anyBody = (parts ?? []).some((part) =>
    (part.commits ?? []).some((c) => (c.body ?? '').trim()),
  )
  if (!anyBody && entry.sections.length) {
    const sentences = entry.sections
      .flatMap((s) => s.body)
      .join(' ')
      .split(/[.!?]+\s/)
      .filter((x) => x.trim().length > 20).length
    if (sentences > entry.sections.length) {
      problems.push(
        hard(
          `no commit in this release has a body, and the note explains it in ${sentences} sentences across ${entry.sections.length} section(s) — there is nothing in the range to explain it from`,
        ),
      )
    }
  }

  /* Names only somebody with the checkout can use, anywhere a reader looks. */
  for (const line of readerProse(entry)) {
    let named = null
    for (const [shape, what] of IDENTIFIER_SHAPES) {
      const hit = line.match(shape)
      if (!hit) continue
      if (NOT_IDENTIFIERS.has(hit[0].toLowerCase())) continue
      named = `${what}, "${hit[0]}", outside Under the hood`
      break
    }
    if (named) { problems.push(hard(named)); break }
  }

  /* Under the hood is last when it is there at all.
     Not the whole list, and not the whole order: the guide names eight groups
     and the notes written since use Identity, Servers, Joining, Interface and
     "Hosting from the app", none of which are on it. That list is where to
     start rather than what is allowed, so the only part of it worth refusing a
     draft over is the one every hand-written note agrees on - what a reader
     cannot see goes at the end. A draft put it first. */
  const hoodAt = entry.recap.findIndex((g) => /under the hood/i.test(g.group))
  if (hoodAt >= 0 && hoodAt !== entry.recap.length - 1) {
    problems.push(soft('"Under the hood" is not the last recap group'))
  }

  /* A control that exists on one platform and not the others.
     The screen-share picker is Windows only, the note never said so, and a
     reader on macOS is left looking for it. The commits say which platform;
     the note has to repeat it. */
  const commitText = parts
    .flatMap((part) => part.commits.map((c) => `${c.subject}\n${c.body}`))
    .join('\n')
  for (const [pattern, platform] of PLATFORM_ONLY) {
    if (!pattern.test(commitText)) continue
    if (new RegExp(`\\b${platform}\\b`, 'i').test(prose.join(' '))) continue
    problems.push(hard(`the commits say this is ${platform} only and the note never says so`))
    break
  }

  /* A release of one commit is a short note. Padding it is how a one-line fix
     became two intro paragraphs and a section saying the same thing again.

     One section per commit, not one section. The cap used to be flat, and once
     coverage started asking for every commit the two rules could not both be
     satisfied: 1.6.18 is two commits — dropdowns invisible in a modal, and the
     camera not stopping when you leave a voice channel — and there is no
     honest way to write one section about both. It spent three attempts and
     eighty minutes being told to do the impossible. What the rule is actually
     for is a one-line fix wearing three headings, and a count per commit says
     that without forbidding two changes from being two changes. */
  const commits = parts.reduce((n, part) => n + part.commits.length, 0)
  if (commits <= 2) {
    if (entry.intro.length > 1) {
      problems.push(soft('more than one intro paragraph for a tiny release'))
    }
    if (entry.sections.length > commits) {
      problems.push(soft(`${entry.sections.length} sections for a release of ${commits}`))
    }
  }

  return problems
}

/**
 * Whether every commit in the range reached the note.
 *
 * The failure this exists for is the one none of the rules above can see: a
 * draft that is well written, breaks no style rule, and is about three of the
 * five commits it was given. Nothing in it says a release was shrunk on the
 * way through, so it reads as a finished note about a smaller release, and the
 * only way to notice is to have both in front of you.
 *
 * Asked by vocabulary rather than by meaning, which is crude and is the point:
 * it takes the words that belong to one commit and to no other commit in the
 * range, and asks whether any of them turn up in the note. A commit written
 * about in the reader's own words still shares something with its own body -
 * "wardrobe", "ping", "skew" - and a commit nobody wrote about shares nothing.
 *
 * Commits with nothing distinctive to say are skipped rather than guessed at.
 * A three-word subject and an empty body gives this nothing to work with, and
 * a rule that fires on no evidence is a rule that gets turned off.
 */
export function coverage(entry, parts) {
  const all = flatCommits(parts)
  if (all.length < 2) return []

  const words = (c) =>
    new Set(
      [...contentWords(`${c.subject} ${c.body}`)].filter(
        (w) => w.length >= 5 && !COMMON.has(w),
      ),
    )
  const per = all.map((c) => ({ c, words: words(c) }))

  /* A word that belongs to this commit and to no other one in the range.
     Without this, two commits about the same subsystem cover for each other:
     the note writes about one, and every word it uses is in the other's body
     too, so the missing one scores as present. */
  const own = per.map(({ c, words: mine }, i) => ({
    c,
    words: [...mine].filter((w) => !per.some((other, j) => j !== i && other.words.has(w))),
  }))

  const note = contentWords(
    [
      entry.headline,
      ...entry.intro,
      ...entry.sections.flatMap((s) => [s.heading, ...s.body]),
      ...entry.recap.flatMap((g) => [g.group, ...g.items]),
    ].join(' '),
  )

  const excused = new Set((entry.omitted ?? []).map((o) => Number(o.commit)))
  const problems = []

  for (const { c, words: distinctive } of own) {
    /* Three, so that one word landing by chance is not a pass and a commit
       with almost nothing of its own is not a failure. */
    if (distinctive.length < 3) continue
    if (distinctive.some((w) => note.has(w))) continue
    if (excused.has(c.n)) continue
    /* Soft, and the reasoning matters because this rule is the whole point of
       GRYT-659. What was wrong before was never that a commit got left out —
       it was that nothing said so, and a note about three of five commits read
       as a finished note about a smaller release. A soft problem is printed in
       the run log and kept on the draft, so the omission is on the record and
       the person reading the note knows to look. That is the thing that was
       missing, and it does not need a release thrown away to work.

       Hard would cost more than it buys. 1.3.1 was refused for not writing
       about "Restore package.json to 1.3.1-beta.1" and "Ignore local runtime
       data directory" — housekeeping nobody using Gryt can see. The prompt now
       tells the model to put those in `omitted`, and when it forgets, a line
       in the log is the right price. */
    problems.push(
      soft(`commit ${c.n} is not in the note and not in omitted: "${c.subject}"`),
    )
  }

  for (const o of entry.omitted ?? []) {
    const n = Number(o.commit)
    if (!all.some((c) => c.n === n)) problems.push(hard(`omitted names commit ${n}, which is not in this release`))
  }

  /* A commit named in `omitted` should not then be in the note.

     1.3.1 declared six commits as not worth a reader's time and wrote three of
     them into the recap anyway — "Local runtime data is now ignored by git",
     "PRs now close Vikunja tasks automatically", "CI failures now report to
     Discord" — plus an intro paragraph narrating the list. That is the escape
     hatch being used and then contradicted: the reader gets exactly the
     housekeeping the model had already decided they should not have to read.

     The same vocabulary test coverage uses, inverted. Two distinctive words
     rather than one, because a single word in common is how any two sentences
     about the same app overlap. Soft for the same reason coverage is: it is a
     judgement about wording, and somebody reads the note before it ships. */
  for (const o of entry.omitted ?? []) {
    const match = own.find((entry_) => entry_.c.n === Number(o.commit))
    if (match === undefined || match.words.length < 3) continue
    if (match.words.filter((w) => note.has(w)).length >= 2) {
      problems.push(
        soft(`commit ${match.c.n} is in omitted and in the note anyway: "${match.c.subject}"`),
      )
    }
  }

  /* Everything left out is the model deciding the release was not worth
     writing about, which is a decision somebody should see rather than a
     shortcut it can take quietly. */
  if ((entry.omitted?.length ?? 0) === all.length) {
    problems.push(hard('every commit is in omitted, so there is no note here'))
  }

  return problems
}

/* Anything the model got wrong in a way that would reach the page. A bad entry
   is not written at all; the next run tries again. */
function validate(entry) {
  if (typeof entry?.headline !== 'string' || !entry.headline.trim()) return 'no headline'
  if (!Array.isArray(entry.intro) || entry.intro.some((p) => typeof p !== 'string')) {
    return 'intro is missing or is not all strings'
  }
  if (!Array.isArray(entry.sections)) return 'sections is not an array'
  for (const s of entry.sections) {
    if (typeof s?.heading !== 'string' || !s.heading.trim()) return 'a section has no heading'
    if (!Array.isArray(s.body)) return 'a section body is not an array'
    if (s.body.some((p) => typeof p !== 'string')) return 'a section body is not all strings'
  }
  if (!Array.isArray(entry.recap)) return 'recap is not an array'
  if (!Array.isArray(entry.omitted)) return 'omitted is missing or is not an array'
  for (const o of entry.omitted) {
    if (typeof o?.commit !== 'number') return 'an omitted entry has no commit number'
    if (typeof o?.why !== 'string' || !o.why.trim()) return 'an omitted entry has no reason'
  }
  for (const g of entry.recap) {
    if (typeof g?.group !== 'string' || !g.group.trim()) return 'a recap group has no label'
    if (!Array.isArray(g.items) || g.items.some((p) => typeof p !== 'string')) {
      return 'a recap group is not all strings'
    }
  }
  return null
}

/* ── Reports ───────────────────────────────────────────────────────────
   Drafts go to the reports service and wait there. It owns changelog.json —
   one writer per file — and nothing reaches the changelog page until somebody
   has read the note at /admin/changelog. */

async function reports(path, init = {}) {
  const res = await fetch(`${REPORTS_URL}${path}`, {
    ...init,
    headers: {
      'x-gryt-changelog-key': REPORTS_KEY,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`reports ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`.trim())
  }
  return res.json()
}

/* Versions reports has already been given a draft for, in any state. A
   rejected one is not in this list, so a note somebody refused is drafted
   again on the next tick — which is what rejecting it is for. */
/**
 * Versions reports has already been given a draft for.
 *
 * Told apart from a configuration problem on purpose. A refused key or a
 * missing route means somebody has to go and fix something, and exiting 0 on
 * that would hide it for as long as nobody looked. Anything else — the service
 * restarting for a deploy, a connection refused for two seconds — is not this
 * script's problem and not worth a failed unit every hour, because a unit that
 * cries wolf hourly is a unit whose real failure nobody reads.
 */
async function alreadyDrafted() {
  let last
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { versions } = await reports('/v1/changelog/versions')
      return new Set(Array.isArray(versions) ? versions : [])
    } catch (err) {
      last = err
      if (/reports 4\d\d/.test(err.message)) throw err
      log(`! reports did not answer (${err.message}); attempt ${attempt} of 3`)
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
  return { unreachable: last }
}

/**
 * Why each version's last draft was refused, if reports can say.
 *
 * Absent on an older reports, which answers 404 for an endpoint it has never
 * heard of. That is not a failure: a draft written without the feedback is the
 * behaviour of every run before this existed, and refusing to draft because a
 * nicety is missing would trade a note for nothing. Same for a timeout.
 */
async function priorFeedback() {
  try {
    const { feedback } = await reports('/v1/changelog/feedback')
    return feedback && typeof feedback === 'object' ? feedback : {}
  } catch (err) {
    if (!/reports 404/.test(err.message)) {
      log(`! could not read what was refused (${err.message}) — drafting without it`)
    }
    return {}
  }
}

async function postDraft(entry) {
  const query = REDRAFT === entry.version ? '?force=1' : ''
  return reports(`/v1/changelog${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entry),
  })
}

/* --dump. A draft on disk, for reading while the prompt is being worked on.
   One file per release rather than one document, so a run is a set of things
   to read rather than a file to diff against the last one. */
function dumpDraft(entry) {
  mkdirSync(DUMP_DIR, { recursive: true })
  const path = join(DUMP_DIR, `${entry.version}.json`)
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`)
  return path
}

async function main() {
  if (!DRY_RUN && !DUMP && (!REPORTS_URL || !REPORTS_KEY)) {
    /* Refused rather than defaulted. There is no safe default here: the whole
       point of this script no longer writing the file itself is that a note
       goes somewhere a person reads it first, and a fallback would be a way
       back to the arrangement that published two fabricated drafts. */
    throw new Error(
      'GRYT_CHANGELOG_URL and GRYT_CHANGELOG_KEY are required. Drafts are ' +
        'posted to the reports service, which holds them until somebody reads ' +
        'them at /admin/changelog. Use --dump to write drafts to disk instead, ' +
        'or --dry-run to print the prompt without asking the model.',
    )
  }

  fetchTags()

  const style = readFileSync(join(REPO, 'patch-notes-style.md'), 'utf8')

  /* `gh` reaches the network, and the network is allowed to be down for a
     minute. Same reasoning as the reports call below: nothing here is urgent
     and the next tick is an hour away. */
  let all
  try {
    all = releases()
  } catch (err) {
    log(`! could not list releases (${String(err.message).split('\n')[0]}) — nothing to do this run`)
    return
  }

  const have = DRY_RUN || DUMP ? new Set() : await alreadyDrafted()
  if (have.unreachable) {
    log(`! reports is unreachable (${have.unreachable.message}) — nothing to do this run`)
    return
  }
  if (REDRAFT) {
    have.delete(REDRAFT)
    log(`drafting ${REDRAFT} again, replacing the draft reports already has`)
  }

  const refused = DRY_RUN || DUMP ? {} : await priorFeedback()
  const refusedCount = Object.keys(refused).length
  if (refusedCount) log(`${refusedCount} release(s) carry a reason they were refused`)

  let wrote = 0
  for (const channel of CHANNELS) {
    const inChannel = all.filter((r) => r.channel === channel)
    /* Only the tail: this is a timer, not a backfill. */
    const recent = inChannel.slice(-LIMIT)
    for (let i = 0; i < recent.length; i++) {
      const release = recent[i]
      if (have.has(release.version)) continue

      const prev = inChannel[inChannel.indexOf(release) - 1]
      if (!prev) { log(`${release.version}: no previous ${channel} release, skipping`); continue }

      /* The manifest is the only honest record of when this release happened
         for a tag whose publish date was rewritten. */
      const date = release.date ?? manifestAt(release.tag)?.createdAt?.slice(0, 10) ?? null
      if (!date) { log(`${release.version}: no usable date, skipping`); continue }

      const changes = changesBetween(prev.tag, release.tag)
      if (!changes) { log(`${release.version}: no manifest on one of the tags, skipping`); continue }
      if (changes.incomplete) { log(`${release.version}: incomplete history, skipping`); continue }

      const count = changes.parts.reduce((n, p) => n + p.commits.length, 0)
      if (!count) { log(`${release.version}: nothing user-visible since ${prev.version}, skipping`); continue }

      log(`${release.version}: ${count} commits since ${prev.version}`)
      if (refused[release.version]) {
        log(`  refused before: ${refused[release.version].slice(0, 100)}`)
      }
      const text = promptFor(release, changes, style, refused[release.version])

      /* Say how big the prompt is, every time.
         The whole of this release was one silent overflow: num_ctx defaulted
         to 4096, the prompt was past it, and what came back was a well
         written note about the commits that happened to fit. Nothing in the
         answer says that happened, so the only defence is knowing the number
         before it is sent. Four characters to the token is rough and is on
         the safe side for English prose. */
      const estimate = TOKENS(text)
      log(`  prompt ${(text.length / 1024).toFixed(1)} kB, about ${estimate} tokens of ${CONTEXT_TOKENS}`)
      /* Only when the budget failed to do its job.
         It used to warn at 85% of the window, which fires on every long range
         now that the commits are sized to fill what is left — the budget
         working is not news. What is news is a prompt past what was reserved
         for it, because that means something is in here the budget cannot
         see. */
      if (estimate > CONTEXT_TOKENS - ANSWER_RESERVE) {
        log(`  ! past the ${CONTEXT_TOKENS - ANSWER_RESERVE} tokens budgeted, so part of it may be dropped before the model reads it`)
        log(`    raise ${CONTEXT_SETTING}, or lower GRYT_CHANGELOG_COMMIT_SHARE (${COMMIT_SHARE})`)
      }
      if (DRY_RUN) { console.log(`\n───── prompt for ${release.version} ─────\n${text}\n`); continue }

      const commitText = JSON.stringify(changes.parts)
      const judge = (draft) => {
        const shape =
          validate(draft) ??
          borrowedHeading(draft, style) ??
          contamination(draft, examplesInFull(REPO), commitText) ??
          liftedParagraph(draft, examplesInFull(REPO))
        /* A draft of the wrong shape, or one retelling the example, is not a
           draft. Nothing below is worth reading about it. */
        if (shape) return [hard(shape)]
        /* Coverage first. A note that is missing a commit is missing it
           whatever else is wrong with it, and it is the reason worth reading
           at the top of a refusal. */
        return [...coverage(draft, changes.parts), ...styleProblems(draft, changes.parts)]
      }

      /* Ask, check, and hand the reasons back rather than giving up on the
         first refusal. The rules the model breaks are the same few every time —
         "Previously" twice, a visible change filed under the hood — and it
         fixes them readily once it is told which ones. */
      let entry = null
      let problems = []
      /* Every attempt's verdict, kept for the rejected file. A release that
         fails all three is the interesting case, and the question it raises is
         whether a rule is satisfiable rather than whether the model is bad —
         which you can only answer by seeing whether the same reason came back
         every time or whether it was chasing a different one each round. */
      const history = []
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          entry = await askWithRetry(
            attempt === 1 ? text : text + retryPrompt(entry, problems.map((p) => p.text)),
          )
        } catch (err) {
          log(`  ! model failed: ${err.message}`)
          history.push({ attempt, error: err.message })
          entry = null
          break
        }
        problems = judge(entry)
        history.push({ attempt, problems: problems.map((p) => p.text) })
        if (!problems.length) break
        /* The last attempt is judged differently. Everything gets sent back
           while there is a round left to fix it in, because the model usually
           does; but when the rounds run out, only a note that is wrong is
           worth throwing away. */
        if (attempt === ATTEMPTS && !problems.some((p) => p.hard)) break
        log(`  · attempt ${attempt} sent back: ${problems.map((p) => p.text).join('; ')}`)
      }
      if (!entry) continue

      const blocking = problems.filter((p) => p.hard)
      const nits = problems.filter((p) => !p.hard)
      if (history.length > 1 && !blocking.length) {
        log(`    accepted on attempt ${history.length}`)
      }
      /* Said out loud, because it is the difference between a note somebody
         should look twice at and one they can skim. */
      for (const n of nits) log(`    left as it is: ${n.text}`)

      const bad = blocking.length ? blocking.map((p) => p.text).join('; ') : null
      if (bad) {
        log(`  ! rejected: ${bad}`)
        /* Kept, because a refusal nobody can read is a refusal nobody can
           judge. This is how the first contaminated draft was diagnosed at
           all, and a false positive is only findable this way. */
        try {
          const dir = join(DUMP_DIR, 'rejected')
          mkdirSync(dir, { recursive: true })
          writeFileSync(
            join(dir, `${release.version}.json`),
            `${JSON.stringify(
              /* The range as well as the draft. Checking a claim against the
                 commits it came from is the whole review, and a refusal saved
                 without them cannot be re-judged — which is exactly what was
                 wanted after the run of 2026-08-29, when ten of these had to
                 have their ranges rebuilt from git before the rules could be
                 tested against them. */
              { version: release.version, reason: bad, attempts: history, entry, commits: changes.parts },
              null,
              2,
            )}\n`,
          )
          log(`    kept for inspection: ${join(dir, `${release.version}.json`)}`)
        } catch { /* the draft is lost, which is the status quo */ }
        continue
      }

      /* What the model decided not to write about, said out loud in the log.
         It is allowed to leave a commit out; it is not allowed to do it
         quietly, and this is the line that makes the difference visible to
         whoever reads the draft afterwards. */
      for (const o of entry.omitted ?? []) {
        const c = flatCommits(changes.parts).find((x) => x.n === Number(o.commit))
        log(`    left out: ${c ? c.subject : `commit ${o.commit}`} - ${o.why}`)
      }

      /* `omitted` is working notes between this script and the model. It is
         not part of the note and reports would refuse it, so it stops here. */
      const drafted = {
        version: release.version,
        date,
        channel: release.channel,
        headline: entry.headline.trim(),
        intro: entry.intro,
        sections: entry.sections,
        recap: entry.recap,
        source: {
          since: prev.version,
          commits: count,
          model: MODEL,
          revision: REVISION,
          /* Which parts of Gryt moved, in the order the manifest lists them.
             Straight off the diff, so there is nothing here for a model to get
             wrong, and the page can answer "is this just the app?" without the
             prose having to say a word about it. */
          components: changes.parts.map((part) => componentName(part.component)),
        },
        /* The range this was written from, so whoever reads the note can check
           a claim against the commits rather than agree with prose that reads
           well. Checking is what caught the paraphrased security section; the
           guard above scored that draft as clean. */
        commits: changes.parts,
      }

      if (DUMP) {
        log(`  ✓ ${entry.headline}`)
        log(`    ${dumpDraft(drafted)}`)
      } else {
        try {
          const result = await postDraft(drafted)
          log(`  ✓ ${entry.headline}`)
          log(`    ${result.created ? 'waiting to be read' : `reports already had ${result.version}`}`)
        } catch (err) {
          /* Not fatal. The release is still without a draft, so the next tick
             tries again, and the ones already posted are safe where they are. */
          log(`  ! could not post ${release.version}: ${err.message}`)
          continue
        }
      }

      have.add(release.version)
      wrote++
    }
  }

  if (!wrote) { log('nothing new'); return }
  log(
    DUMP
      ? `wrote ${wrote} draft${wrote === 1 ? '' : 's'} to ${DUMP_DIR}`
      : `posted ${wrote} draft${wrote === 1 ? '' : 's'}, waiting to be read at ${REPORTS_URL}/admin/changelog`,
  )
}

/* Only when run, not when imported.
   The style rules below are exported so CI can check them against the notes
   written by hand, and a module that drafts a changelog as a side effect of
   being imported is a module nobody can test.

   Both sides resolved, because one of them already was. Node resolves an ES
   module to its real path, so `import.meta.url` is the file in the checkout
   while `process.argv[1]` is whatever name it was invoked as — and the README
   tells you to invoke it as a symlink in /usr/local/lib, so that a git pull
   updates the script without reinstalling anything. The two never matched, so
   the unit loaded this file, defined everything in it, and exited 0 without
   drafting.

   It ran hourly for a week like that. Nothing failed: one second, success, no
   output, which is indistinguishable from a run with nothing to do. Every note
   in the queue came from somebody running the backfill by hand from the real
   path.

   realpathSync throws on a path that is not there, which argv[1] can be under
   a shell that made it up, so the comparison falls back to the raw value
   rather than taking the process down on its last line. */
function invokedDirectly() {
  const argv = process.argv[1]
  if (!argv) return false
  let resolved = argv
  try { resolved = realpathSync(argv) } catch { /* use it as given */ }
  return import.meta.url === pathToFileURL(resolved).href
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error('[changelog] failed:', err)
    process.exit(1)
  })
}
