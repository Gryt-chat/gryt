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
//   OLLAMA_URL             Default http://127.0.0.1:11434
//   OLLAMA_MODEL           Default llama3.1:8b
//   OLLAMA_TIMEOUT_MS      Default 180000

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(process.env.GRYT_CHANGELOG_REPO ?? join(HERE, '..', '..'))
const CHANNELS = (process.env.GRYT_CHANGELOG_CHANNELS ?? 'latest').split(/\s+/).filter(Boolean)
const LIMIT = Number(process.env.GRYT_CHANGELOG_LIMIT ?? 12)
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b'
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180_000)
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

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
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
    execFileSync('git', ['-C', REPO, 'fetch', '--quiet', '--tags', 'origin'], { stdio: 'ignore' })
  } catch {
    /* Not fatal. Whatever tags are already here still work, and the manifest
       check says plainly which releases cannot be reached. */
    log('! could not fetch tags — working from the ones already here')
  }
}

function manifestAt(tag) {
  try {
    return JSON.parse(sh('git', ['show', `${tag}:.release/manifest.json`], { cwd: REPO }))
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
    execFileSync('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function reach(dir, sha) {
  if (have(dir, sha)) return true
  for (const args of [['fetch', '--quiet', 'origin', sha], ['fetch', '--quiet', '--unshallow', 'origin']]) {
    try {
      execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
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
  },
  required: ['headline', 'intro', 'sections', 'recap'],
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

function prompt(release, changes, style) {
  const lines = []
  for (const part of changes.parts) {
    lines.push(`## ${part.component}`)
    for (const c of part.commits) {
      lines.push(`- ${c.subject}`)
      if (c.body) {
        for (const l of c.body.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8)) {
          lines.push(`    ${l}`)
        }
      }
    }
  }
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
    style,
    '',
    '─────────────────────────────────────────────────────────────────────',
    `THE RELEASE YOU ARE WRITING ABOUT: Gryt ${release.version}, ${release.date}`,
    '',
    'These are the commits it contains, grouped by component, and they are the',
    'only source for what this release changed. Commit bodies are included where',
    'the author wrote one, and are usually the best source for why.',
    '',
    lines.join('\n'),
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
    'If nothing in this release is visible to a user, return an empty sections',
    'array, an empty recap, a one-sentence intro saying so, and a headline',
    'saying it is a maintenance release.',
    '',
  ].join('\n')
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

async function ask(text) {
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
        options: { temperature: 0.4 },
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

/* Words that belong to the example and to nothing in this release.
   The example is there to show the shape, and a model that has just read a
   finished note is very willing to write that note again — the 1.6.43 draft
   came back describing 24-word backups and certificate authorities, none of
   which appear anywhere in its commit range. Telling it not to is not enough,
   so this checks. */
function contamination(entry, exampleText, commitText) {
  if (!exampleText) return null
  const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []))
  const inCommits = words(commitText)
  const distinctive = [...words(exampleText)].filter(
    (w) => !inCommits.has(w) && !COMMON.has(w),
  )
  const draft = words(JSON.stringify(entry))
  const borrowed = distinctive.filter((w) => draft.has(w))
  /* A handful is coincidence. A pile of it is the example being retold. The
     contaminated 1.6.43 draft scored 59 against a correct one's 8, so there is
     a lot of room between them; the ordinary English filtered out by COMMON is
     what keeps a short commit range from making that gap look narrower than it
     is. */
  return borrowed.length > 20
    ? `looks copied from the example (${borrowed.length} of its words, none in the commits: ${borrowed.slice(0, 6).join(', ')})`
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

/* Sentences that would sit unchanged in any other project's release notes.
   The style guide calls this the portability test; this is the short version
   of it, drawn from what the drafts actually produced. */
const FILLER = [
  /this change is for you/i,
  /we('| a)re (excited|pleased|happy)/i,
  /visual language/i,
  /user experience/i,
  /seamless/i,
  /under the hood improvements/i,
  /stay tuned/i,
  /and much more/i,
]

/**
 * The rules that are about writing rather than about shape.
 *
 * Returned as a list rather than the first failure, because a draft that
 * breaks three of these is worth seeing all three of at once when it lands in
 * `rejected/`. Reading a refusal is how the first fabricated draft was
 * diagnosed, and one reason at a time makes that three runs instead of one.
 */
export function styleProblems(entry, parts) {
  const problems = []
  const headings = entry.sections.map((s) => s.heading)
  const prose = [...entry.intro, ...entry.sections.flatMap((s) => s.body)]

  /* At most once in the whole note. It is the obvious way to write a contrast
     and it reads as a form somebody filled in when every paragraph has it. */
  const previously = prose.join(' ').match(/\bpreviously\b/gi)?.length ?? 0
  if (previously > 1) problems.push(`"Previously" ${previously} times, and once is the limit`)

  /* The headline is already on the page, directly above. A section that
     repeats it spends the reader's first heading saying nothing new. */
  for (const heading of headings) {
    if (overlap(entry.headline, heading) > 0.6) {
      problems.push(`the heading "${heading}" is the headline again`)
    }
  }

  /* Two sections opening on the same word reads as a template rather than as
     writing, and "Previously" is the one it always is. */
  const firstWords = headings.map((h) => normalise(h).split(' ')[0]).filter(Boolean)
  const repeated = firstWords.find((w, i) => firstWords.indexOf(w) !== i)
  if (repeated) problems.push(`more than one section starts with "${repeated}"`)

  /* The recap is the short version, not the headings again. Somebody who read
     the article should still find something in it. */
  const items = entry.recap.flatMap((g) => g.items)
  const echoes = items.filter((item) => headings.some((h) => overlap(item, h) > 0.7))
  if (items.length && echoes.length === items.length) {
    problems.push('every recap line is one of the section headings again')
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
    (text) => /\b(security|insecure|vulnerab)/i.test(text),
  )
  if (claimsSecurity && !hasSecurityChange(parts)) {
    problems.push('the note claims security, and nothing in the commits is about security')
  }

  /* A heading is a sentence. "Security:" and "Performance:" are labels with a
     sentence stapled on. */
  const labelled = headings.find((h) => /^[A-Z][A-Za-z ]{0,20}:/.test(h))
  if (labelled) problems.push(`the heading "${labelled}" is a label, not a sentence`)

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
    problems.push('the headline lists three things rather than naming the one that matters')
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
      problems.push(`"${visible}" is under the hood, and the note explains it above`)
    }
  }

  for (const pattern of FILLER) {
    const hit = prose.find((paragraph) => pattern.test(paragraph))
    if (hit) {
      problems.push(`filler: "${hit.match(pattern)[0]}"`)
      break
    }
  }

  /* A release of one commit is a short note. Padding it is how a one-line fix
     became two intro paragraphs and a section saying the same thing again. */
  const commits = parts.reduce((n, part) => n + part.commits.length, 0)
  if (commits <= 2) {
    if (entry.intro.length > 1) problems.push('more than one intro paragraph for a tiny release')
    if (entry.sections.length > 1) problems.push('more than one section for a tiny release')
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
      const text = prompt(release, changes, style)
      if (DRY_RUN) { console.log(`\n───── prompt for ${release.version} ─────\n${text}\n`); continue }

      const commitText = JSON.stringify(changes.parts)
      const judge = (draft) => {
        const shape = validate(draft) ?? contamination(draft, workedExample(REPO), commitText)
        return shape ? [shape] : styleProblems(draft, changes.parts)
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
          entry = await ask(attempt === 1 ? text : text + retryPrompt(entry, problems))
        } catch (err) {
          log(`  ! model failed: ${err.message}`)
          history.push({ attempt, error: err.message })
          entry = null
          break
        }
        problems = judge(entry)
        history.push({ attempt, problems })
        if (!problems.length) break
        log(`  · attempt ${attempt} sent back: ${problems.join('; ')}`)
      }
      if (!entry) continue
      if (history.length > 1 && !problems.length) {
        log(`    accepted on attempt ${history.length}`)
      }

      const bad = problems.length ? problems.join('; ') : null
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
              { version: release.version, reason: bad, attempts: history, entry },
              null,
              2,
            )}\n`,
          )
          log(`    kept for inspection: ${join(dir, `${release.version}.json`)}`)
        } catch { /* the draft is lost, which is the status quo */ }
        continue
      }

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
          model: OLLAMA_MODEL,
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
   being imported is a module nobody can test. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[changelog] failed:', err)
    process.exit(1)
  })
}
