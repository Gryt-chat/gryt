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

const { styleProblems, coverage } = await import(
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
      /* Four parts, not three: the two rules around the frontmatter, then the
         article, then the rule above "The short version" and the recap after
         it. Reading only the first three silently dropped every recap, and an
         empty recap passes every recap rule — which is why the check below
         refuses a note that parsed to nothing. */
      const raw = readFileSync(join(dir, file), 'utf8')
      const parts = raw.split(/^---$/m)
      const headline = parts[1]?.match(/^headline:\s*(.+)$/m)?.[1]?.trim() ?? ''

      const clean = (parts[2] ?? '')
        .replace(/^<(Image|Clip)[^>]*\/>\s*$/gm, '')
        /* Markdown images too, not only the JSX ones. 1.4.0 illustrates the
           voice panel with `![alt](/changelog/voice-split.webp)`, and reading
           that line as a paragraph puts an asset filename into what is
           supposed to be the note's prose. */
        .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '')
        .replace(/^import .*$/gm, '')
      const article = clean
      const recapRaw = parts.slice(3).join('\n')

      const chunks = article.split(/^## /m)
      const paragraphs = (text) =>
        text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

      const sections = chunks.slice(1).map((chunk) => {
        const [heading, ...rest] = chunk.split('\n')
        return { heading: heading.trim(), body: paragraphs(rest.join('\n')) }
      })

      /* Line by line, not block by block. A blank line sits between the bold
         label and its bullets, so splitting on blank lines separated every
         group from its own items and each of these notes tested with an empty
         recap — which meant the recap rules were never exercised against the
         writing they are supposed to be judged by. */
      const recap = []
      for (const line of recapRaw.split('\n')) {
        const label = line.match(/^\*\*(.+?)\*\*\s*$/)?.[1]
        if (label) {
          recap.push({ group: label, items: [] })
          continue
        }
        const item = line.match(/^[-*]\s+(.*)$/)?.[1]
        if (item && recap.length) recap[recap.length - 1].items.push(item.trim())
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
    name: '1.6.31, which filed a whole privacy fix as invisible',
    expect: 'every recap line is under the hood',
    range: [
      {
        component: 'client',
        commits: [
          {
            subject: 'Do not send the log unless asked, and show the payload (GRYT-532) (#232)',
            body: 'The form attached the last 300 console lines to every report. host is the server address, often a home IP or a personal domain.',
          },
        ],
      },
    ],
    /* Real output, and the third draft running to put the whole user-visible
       change under the hood. The word matching missed it on morphology alone —
       "avoids sending" against "no longer sends". */
    note: {
      headline: 'Gryt no longer sends server addresses in crash reports',
      intro: ['This release removes a privacy risk in the crash reporting form.'],
      sections: [
        {
          heading: 'The app only sends logs when asked',
          body: ['It used to attach the last 300 console lines to every report.'],
        },
      ],
      recap: [
        {
          group: 'Under the hood',
          items: ['The app now avoids sending server addresses in crash logs unless requested'],
        },
      ],
    },
  },
  {
    name: '1.6.38, which put a function name in the article',
    expect: 'a camel-case name',
    range: [
      {
        component: 'client',
        commits: [
          { subject: 'Draw the owl somebody designed', body: '' },
          { subject: 'Keep the look beside the nickname', body: '' },
          { subject: 'Ping each WebSocket', body: '' },
        ],
      },
    ],
    note: {
      headline: 'Designed avatars now travel with you across devices and rooms',
      intro: ['A designed owl is drawn wherever your avatar appears.'],
      sections: [
        {
          heading: 'Your owl follows you between machines',
          /* Real output. The prompt forbids this and the model wrote it
             anyway, which is the argument for a rule rather than a sentence. */
          body: ['The new system uses a single funnel, the resolveAvatarSrc function, to draw your owl.'],
        },
      ],
      recap: [{ group: 'Avatars and images', items: ['Designed owls now follow you'] }],
    },
  },
  {
    name: '1.6.40, which put what a reader cannot see at the top of the recap',
    expect: 'not the last recap group',
    range: [
      {
        component: 'client',
        commits: [
          { subject: 'The plain name belongs to the round mark', body: '' },
          { subject: 'Round the mark in the app', body: '' },
          { subject: 'Send the download link to the download', body: '' },
        ],
      },
    ],
    note: {
      headline: 'The Gryt owl is round now, everywhere you see it',
      intro: ['The mark on the splash screen and in the browser tab is the round one.'],
      sections: [
        { heading: 'A round mark, in every place the app draws it', body: ['Including the splash.'] },
      ],
      recap: [
        { group: 'Under the hood', items: ['The icon build reads the square artboard'] },
        { group: 'Interface', items: ['The mark on the splash screen is the round one'] },
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

/* Coverage is not a style rule and does not run against the hand-written
   notes: those cover a whole minor line, and the range they were written from
   is not in the repository any more. It is checked against the shape of the
   failure it exists for - a note that is well written and about fewer commits
   than it was given. */
const COVERAGE_DRAFTS = [
  {
    name: '1.6.38, which dropped the media server commit entirely',
    expect: 'commit 3 is not in the note',
    range: [
      {
        component: 'client',
        commits: [{ subject: 'Draw the owl somebody designed, instead of a picture of it', body: 'The editor produced a look and encoded it as a short string.' }],
      },
      {
        component: 'server',
        commits: [{ subject: 'Keep the look a member designed, beside their nickname', body: 'users.avatar_worn, added with the same guard as every other column.' }],
      },
      {
        component: 'sfu',
        commits: [{
          subject: 'Ping each WebSocket, and give up on one that stops answering',
          body: 'A peer that went away without a FIN left a socket that read forever. Thirty seconds between pings and ninety of silence before hanging up.',
        }],
      },
    ],
    note: {
      headline: 'Designed avatars now travel with you across devices and rooms',
      intro: ['The owl you designed is drawn wherever your avatar appears, and it follows your account.'],
      sections: [
        { heading: 'Your designed owl is drawn, not photographed', body: ['The editor sends a short string describing the look.'] },
        { heading: 'A server keeps your look beside your nickname', body: ['So it reaches the room you join.'] },
      ],
      recap: [{ group: 'Avatars and images', items: ['A designed owl follows your account between machines'] }],
      omitted: [],
    },
  },
  {
    /* The same draft, with the model saying so. Leaving a commit out is
       allowed; leaving it out silently is what is not. */
    name: 'the same draft, with the commit named in omitted',
    expect: null,
    range: null,
    note: null,
  },
]
COVERAGE_DRAFTS[1].range = COVERAGE_DRAFTS[0].range
COVERAGE_DRAFTS[1].note = {
  ...COVERAGE_DRAFTS[0].note,
  omitted: [{ commit: 3, why: 'a timeout on a socket nobody sees' }],
}

let failed = 0

const notes = join(REPO, 'packages', 'site', 'content', 'changelog')
if (!existsSync(notes)) {
  console.error(`✗ ${notes} is not here — the site submodule needs checking out`)
  process.exit(1)
}

console.log('The notes written by hand, which must all pass:\n')
for (const note of handWritten(notes)) {
  const problems = styleProblems(note, WIDE_RANGE)
  const shape = `${note.sections.length} sections, ${note.recap.length} recap groups, ${note.recap.reduce((n, g) => n + g.items.length, 0)} items`
  if (problems.length) {
    failed++
    console.error(`  ✗ ${note.name} (${shape}) was refused by its own house style:`)
    for (const p of problems) console.error(`      ${p}`)
  } else {
    console.log(`  ✓ ${note.name} (${shape})`)
  }

  /* A note that parsed to nothing passes every rule, which is not the same as
     passing. The parser has been wrong about this once already. */
  if (!note.sections.length || !note.recap.length) {
    failed++
    console.error(`  ✗ ${note.name} parsed to an empty ${note.sections.length ? 'recap' : 'article'} — the parser is wrong, not the note`)
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

/* The skills are read into every prompt, so a checkout without them drafts
   against rules nobody wrote down. Not a style rule, but the prompt is wrong
   without it and nothing else would say so.

   They are not put through the contamination guard. That was tried: all three
   hand-written notes scored as copied from them, on "voice", "reading",
   "person" and "words", because a skill about writing and a note about a chat
   app are both written in English. The reasoning is on the guard itself. */
console.log('\nThe skills the prompt reads:\n')
for (const f of ['no-ai-slop.md', 'natural-writing.md']) {
  const path = join(REPO, 'ops', 'internal', 'writing', f)
  if (existsSync(path) && readFileSync(path, 'utf8').trim()) {
    console.log(`  ✓ ${f}`)
  } else {
    failed++
    console.error(`  ✗ ops/internal/writing/${f} is missing, and the prompt reads it`)
  }
}

console.log('\nEvery commit accounted for:\n')
for (const { name, note, range, expect } of COVERAGE_DRAFTS) {
  const problems = coverage(note, range)
  const ok = expect === null ? !problems.length : problems.some((p) => p.includes(expect))
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
    console.error(`      expected ${expect === null ? 'nothing' : `a problem containing "${expect}"`}`)
    console.error(`      got: ${problems.length ? problems.join('; ') : 'nothing at all'}`)
  }
}

if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed.`)
  process.exit(1)
}
console.log('\nAll good.')
