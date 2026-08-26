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
// What it writes is `changelog.json`, which nginx serves beside the site at
// /release-notes/changelog.json and the site fetches at runtime. So a new entry is live as soon as this finishes;
// there is no rebuild and no pull request in the path.
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
//   GRYT_CHANGELOG_OUT     changelog.json to write.
//                          Default ./changelog/changelog.json beside this file.
//   GRYT_CHANGELOG_REPO    the superproject checkout to read releases from.
//                          Default the checkout this script lives in.
//   GRYT_CHANGELOG_CHANNELS  which channels to draft. Default "latest".
//                          "latest beta" also drafts the pre-releases, which
//                          the site hides behind a toggle.
//   GRYT_CHANGELOG_LIMIT   how many releases back to consider. Default 12.
//   OLLAMA_URL             Default http://127.0.0.1:11434
//   OLLAMA_MODEL           Default llama3.1:8b
//   OLLAMA_TIMEOUT_MS      Default 180000

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(process.env.GRYT_CHANGELOG_REPO ?? join(HERE, '..', '..'))
const OUT = resolve(process.env.GRYT_CHANGELOG_OUT ?? join(HERE, 'changelog', 'changelog.json'))
const CHANNELS = (process.env.GRYT_CHANGELOG_CHANNELS ?? 'latest').split(/\s+/).filter(Boolean)
const LIMIT = Number(process.env.GRYT_CHANGELOG_LIMIT ?? 12)
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b'
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS ?? 180_000)
const DRY_RUN = process.argv.includes('--dry-run')

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

function releases() {
  const raw = sh('gh', [
    'release', 'list', '-R', 'Gryt-chat/gryt',
    '--limit', '300',
    '--json', 'tagName,isPrerelease,publishedAt',
  ], { cwd: REPO })

  return JSON.parse(raw)
    .map((r) => {
      /* A tag that was never published, or was published by a rewrite, has a
         date that is not the release's. The manifest records when the release
         was actually cut, so prefer it and keep publishedAt as the fallback. */
      const published = /^\d{4}/.test(r.publishedAt) && !r.publishedAt.startsWith('0001')
        ? r.publishedAt.slice(0, 10)
        : null
      return {
        tag: r.tagName,
        version: r.tagName.replace(/^v/, ''),
        channel: r.isPrerelease ? 'beta' : 'latest',
        date: published,
      }
    })
    .sort((a, b) => compareVersions(a.version, b.version))
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
  required: ['headline', 'sections', 'recap'],
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
    `Gryt ${release.version} shipped on ${release.date}.`,
    '',
    'These are the commits it contains, grouped by component. Commit bodies are',
    'included where the author wrote one, and they are usually the best source',
    'for why a change was made.',
    '',
    lines.join('\n'),
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
    '            These are the headlines written by hand, and they are the',
    '            target:',
    '',
    ...examples(REPO).map((h) => `              ${h}`),
    '',
    '  sections  The article. Two to four, each about one thing that changed,',
    '            in the order the guide gives: what you notice, then what a',
    '            host notices, then what a careful person asks about. Each has',
    '            a heading that is a sentence rather than a label, and a body',
    '            of one to three paragraphs. Security is always its own',
    '            section and is never softened.',
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
    'hood.',
    '',
    'Do not start more than one section with the same word. "Previously" in',
    'front of every contrast reads as a form someone filled in. Vary it, or',
    'put the old behaviour second in the sentence.',
    '',
    'Every fact must come from the commits above. Do not invent a number, a',
    'date, a feature or a reason.',
    '',
    'If nothing in this release is visible to a user, return an empty sections',
    'array, an empty recap, and a headline saying it is a maintenance release.',
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

/* Anything the model got wrong in a way that would reach the page. A bad entry
   is not written at all; the next run tries again. */
function validate(entry) {
  if (typeof entry?.headline !== 'string' || !entry.headline.trim()) return 'no headline'
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

function readOut() {
  if (!existsSync(OUT)) return { generatedAt: null, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(OUT, 'utf8'))
    return { generatedAt: parsed.generatedAt ?? null, entries: parsed.entries ?? [] }
  } catch {
    log('! existing changelog.json is not valid JSON, starting a new one')
    return { generatedAt: null, entries: [] }
  }
}

/* Written to a sibling and renamed, because nginx is serving this file and a
   half-written one is a broken changelog page rather than an old one. */
function writeOut(doc) {
  mkdirSync(dirname(OUT), { recursive: true })
  const tmp = `${OUT}.tmp`
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
  renameSync(tmp, OUT)
}

async function main() {
  const style = readFileSync(join(REPO, 'patch-notes-style.md'), 'utf8')
  const all = releases()
  const doc = readOut()
  const have = new Set(doc.entries.map((e) => e.version))

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

      let entry
      try {
        entry = await ask(text)
      } catch (err) {
        log(`  ! model failed: ${err.message}`)
        continue
      }
      const bad = validate(entry)
      if (bad) { log(`  ! rejected: ${bad}`); continue }

      doc.entries.push({
        version: release.version,
        date,
        channel: release.channel,
        headline: entry.headline.trim(),
        sections: entry.sections,
        recap: entry.recap,
        source: { since: prev.version, commits: count, model: OLLAMA_MODEL },
      })
      have.add(release.version)
      wrote++
      log(`  ✓ ${entry.headline}`)
    }
  }

  if (!wrote) { log('nothing new'); return }
  doc.generatedAt = new Date().toISOString()
  doc.entries.sort((a, b) => (a.version < b.version ? 1 : -1))
  writeOut(doc)
  log(`wrote ${wrote} entr${wrote === 1 ? 'y' : 'ies'} to ${OUT}`)
}

main().catch((err) => {
  console.error('[changelog] failed:', err)
  process.exit(1)
})
