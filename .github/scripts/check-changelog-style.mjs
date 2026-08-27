#!/usr/bin/env node
//
// The changelog drafter's style rules, checked against writing we already
// trust and writing we already know is bad.
//
// `styleProblems` in ops/internal/changelog-notes.mjs is what decides whether a
// drafted release note is written or thrown away. It is a pile of thresholds
// and word lists, and every one of them was tuned by hand against real output —
// which means every one of them can be quietly broken by the next person who
// tightens a number.
//
// Two directions, and the first matters more:
//
//   1. The three notes written by hand must pass clean. They are the target the
//      whole drafter is aiming at, so a rule that refuses one of them is not a
//      rule, it is a bug. Tuning these checks produced two such bugs — `auth`
//      matching "unauthenticated", and short headings scoring as duplicates
//      because they are mostly stopwords — and both were found this way.
//
//   2. The drafts that were actually wrong must still be caught. The fixtures
//      below are trimmed from real output off the box, including the fabricated
//      security section that started all of this.
//
// Run by .github/workflows/changelog-style.yml on any pull request touching the
// rules, the notes or this file.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..')

const { styleProblems } = await import(
  join(REPO, 'ops', 'internal', 'changelog-notes.mjs')
)

/* A range big enough that the "tiny release" rules stay out of the way, and
   with real security words in a subject, because the hand-written notes cover
   whole minor lines and 1.6.0's identity work genuinely was security work. */
const WIDE_RANGE = [
  {
    component: 'client',
    commits: [
      {
        subject: 'feat: keychain-sealed identity with an encrypted backup',
        body: 'credential handling, signature checks and permission changes',
      },
      ...Array.from({ length: 40 }, (_, i) => ({ subject: `change ${i}`, body: '' })),
    ],
  },
]

/**
 * The hand-written notes, in the shape the model is asked to fill.
 *
 * Parsed rather than transcribed, so a note that gets edited is still what the
 * check runs against. Everything before the first `##` is the intro, and the
 * block below the rule is the recap.
 */
function handWritten(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8')
      const [, front, body] = raw.split(/^---$/m)
      const headline = front.match(/^headline:\s*(.+)$/m)?.[1]?.trim() ?? ''

      const clean = body
        .replace(/^<(Image|Clip)[^>]*\/>\s*$/gm, '')
        .replace(/^import .*$/gm, '')
      const [article, recapRaw = ''] = clean.split(/^---$/m)

      const chunks = article.split(/^## /m)
      const paragraphs = (text) =>
        text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

      const sections = chunks.slice(1).map((chunk) => {
        const [heading, ...rest] = chunk.split('\n')
        return { heading: heading.trim(), body: paragraphs(rest.join('\n')) }
      })

      const recap = []
      for (const block of recapRaw.split(/\n{2,}/)) {
        const group = block.match(/^\*\*(.+?)\*\*/)?.[1]
        if (!group) continue
        const items = block
          .split('\n')
          .slice(1)
          .map((line) => line.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean)
        recap.push({ group, items })
      }

      return { name: file.replace(/\.mdx$/, ''), headline, intro: paragraphs(chunks[0]), sections, recap }
    })
}

/* Trimmed from drafts the box actually produced. The comment on each is the
   reason it was refused, and the reason the rule exists. */
const BAD_DRAFTS = [
  {
    name: '1.6.41, which invented a security section',
    expect: 'claims security, and nothing in the commits is about security',
    range: [
      {
        component: 'client',
        commits: [
          {
            subject: "fix: learn a server's scheme instead of guessing it forever (#254)",
            /* "unauthenticated" is the trap: it contains "auth", and the first
               version of the security check cleared this draft because of it. */
            body: 'ensureSchemeKnown does one unauthenticated GET to /info per host. A preflight may not be redirected, so it fails as a CORS error.',
          },
        ],
      },
    ],
    note: {
      headline: 'Gryt now remembers whether your server uses HTTP or HTTPS.',
      intro: ['A problem where Gryt would get stuck using the wrong protocol.'],
      sections: [
        {
          heading: 'Gryt learns the scheme when you first join',
          body: ['It used to assume HTTP and never change its mind.'],
        },
        {
          heading: 'Gryt no longer risks insecure connections',
          body: ['This change improves security by using the correct protocol.'],
        },
      ],
      recap: [{ group: 'Hosting', items: ['Gryt remembers the scheme'] }],
    },
  },
  {
    name: '1.6.42, which used the headline again as a heading and padded a one-commit release',
    expect: 'is the headline again',
    range: [
      {
        component: 'client',
        commits: [{ subject: 'fix: tint voice tiles from the designed owl', body: '' }],
      },
    ],
    note: {
      headline: 'Voice tiles now use the right colour for designed owls.',
      intro: ['One paragraph.', 'And a second one, for a single commit.'],
      sections: [
        {
          heading: 'Voice tiles now use the correct colour for designed owls',
          body: ['If you have ever noticed a tile looking off, this change is for you.'],
        },
      ],
      recap: [
        { group: 'Voice', items: ['Voice tiles now use the correct colour for designed owls'] },
      ],
    },
  },
  {
    name: '1.6.39, which listed three things in the headline and hid a new logo under the hood',
    expect: 'lists three things',
    range: [
      {
        component: 'client',
        commits: [
          { subject: 'The new Gryt mark', body: '' },
          { subject: 'Save an owl to a file', body: '' },
          { subject: 'Give the avatar editor a backdrop', body: '' },
        ],
      },
    ],
    note: {
      headline: 'Gryt now lets you save custom avatars, adds a new logo, and fixes the avatar editor',
      intro: ['A new mark, a clearer way to save avatars, and a more usable editor.'],
      sections: [
        { heading: 'Gryt has a new brand mark', body: ['A violet owl on a dark indigo ground.'] },
        { heading: 'You can save avatars in four formats', body: ['SVG first.'] },
        { heading: 'The editor has a backdrop and a way out', body: ['It could not be dismissed.'] },
      ],
      recap: [
        { group: 'Under the hood', items: ['Updated the Gryt brand mark to a new design'] },
      ],
    },
  },
]

let failed = 0

const notes = join(REPO, 'packages', 'site', 'content', 'changelog')
if (!existsSync(notes)) {
  console.error(`✗ ${notes} is not here — the site submodule needs checking out`)
  process.exit(1)
}

console.log('The notes written by hand, which must all pass:\n')
for (const note of handWritten(notes)) {
  const problems = styleProblems(note, WIDE_RANGE)
  if (problems.length) {
    failed++
    console.error(`  ✗ ${note.name} was refused by its own house style:`)
    for (const p of problems) console.error(`      ${p}`)
  } else {
    console.log(`  ✓ ${note.name}`)
  }
}

console.log('\nDrafts that were wrong, which must still be caught:\n')
for (const { name, note, range, expect } of BAD_DRAFTS) {
  const problems = styleProblems(note, range)
  const caught = problems.some((p) => p.includes(expect))
  if (caught) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`      expected a problem containing "${expect}"`)
    console.error(`      got: ${problems.length ? problems.join('; ') : 'nothing at all'}`)
  }
}

if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed.`)
  process.exit(1)
}
console.log('\nAll good.')
