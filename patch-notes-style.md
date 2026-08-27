# How Gryt patch notes are written

Same shape every time, so someone who read the last one knows where to look.

## Where the facts come from

**Never from memory.** The record of what shipped is `manifest.json` on each GitHub
release — it names the exact client, server, sfu and image worker commit. Diff two
manifests, take the commit range per component, and write from that.

The commits carry `GRYT-` numbers, which lead back to the tasks explaining why the
change was worth making. Use Vikunja for the *why*; use the commit range for the
*what*. Vikunja alone will lie to you: some tasks close without shipping, some work
has no task.

This is not a formality. Writing the 1.4.0 notes from the real range caught two
items that felt certain and were not in it — animated GIF server icons landed after
the release was cut, and there was no 120fps change in the range at all. Both would
have shipped as fact.

A note for a version that is still in beta covers the whole line. When
`1.4.0-beta.3` adds something, it belongs in the 1.4.0 note — otherwise the note
describes a build nobody is running.

## Shape

Frontmatter: `version`, `date`, `channel`, and a one-sentence `headline` naming the
two things that actually matter.

Then **the note itself, written as prose**, and **a recap list at the end**.

### The opening

Before the first heading, a paragraph or two with no heading of its own, saying
what this release is about. Every note so far has one and it is the part that
makes the rest read like writing rather than output.

It is not a summary of the sections below. It is the frame the sections hang on
— what was wrong, or what changed direction, or what somebody will notice first:

> Using Gryt without an account has always had one sharp edge: whatever you were
> on a server lived in one browser on one machine. Clear your site data and it
> was gone, along with any roles you had and any server you owned. This release
> takes that apart.

> Two things changed in this release and they point the same way.

If the release is small, say so in a sentence and move on. A release with one
fix in it does not need a paragraph pretending otherwise.

### The article

A few sections with real headings, each about one thing that changed, in the order
someone would care: what you notice, then what a host notices, then what a careful
person asks about.

Write the change, then show the picture of it. The paragraph explains what you are
looking at; the picture proves it happened. A screenshot dropped between two bullets
is decoration, and leaves the reader working out what they are meant to see.

Headings are sentences, not labels — "Everyone has a face" rather than "Avatars".

### The short version

Everything above, as one-line bullets grouped under bold labels, after a `---`:

```
Voice · Avatars and images · Emoji · Updates · Hosting · Security · Accessibility · Under the hood
```

Skip any group with nothing in it. Someone who read the article can stop before
this; someone who wants only the list can start here. Both should end up correctly
informed.

## Bullets

One line each. Past tense. Say what changed, from the reader's side.

> - Avatars are stored at twice the size and no longer go blurry
> - "Discoverable on LAN" does something. The checkbox was decorative
> - Turning beta off now works. It never did

Not:

> - Implemented a new avatar thumbnail pipeline with configurable dimensions
> - We're excited to announce improvements to LAN discovery!
> - Fixed GRYT-66

A second sentence is allowed when the first is useless without it — usually to say
what it was like before. That contrast is what makes a fix land; "improved
reliability" tells nobody anything.

Never mention a task number, a PR, a file or a function above **Under the hood**.

## Under the hood

For changes with no visible effect that still need explaining, because "why is the
app different" is a fair question. Plain language still — this is the section for a
curious user, not a colleague.

Anything genuinely internal — a dead script deleted, a workflow fixed — goes in
neither. If the only honest bullet is "we tidied up", write nothing.

## Security

Its own section, never folded into bug fixes, and never softened. Say what was
wrong and what it meant, in the same voice as everything else:

> - SVG uploads are refused. An SVG can carry scripts, and Gryt was serving them
>   from its own address

If something was exploitable, that belongs here whether or not anyone exploited it.
A patch note is not a place to be reassuring.

## Pictures and clips

Every picture is introduced by the sentence before it. If you cannot write that
sentence, the picture is not earning its place.

Old-versus-new means building an old version to photograph it, and the comparison
rarely earns that. A picture of the new state alone is fine.

The mechanics, all of which are handled by the changelog page rather than by the
note:

- **Full column width, centred.** These are screenshots of a whole app window;
  any smaller and the detail being described cannot be made out. Click for full
  size.
- **Never upscaled.** A clip is drawn at its own pixels or smaller. Blowing up a
  screen capture makes it look worse than the interface it is showing.
- **Clips play themselves, silently, on a loop, with no controls** — use `<Clip>`,
  which sets that. They are recordings of an interface, closer to an animated image
  than to video, and nobody wants to press play on four seconds or be handed sound.
- **AV1 with an H.264 fallback**, both encoded from the original capture rather than
  from an already-compressed copy.

Record at the same scale as screenshots. A 2x screenshot next to a 1x recording is
obvious, and no codec puts back detail that was never captured.

Sections like Security and Under the hood get nothing.

## Sponsors

The $50 one-time tier on GitHub Sponsors promises a name in the notes for the next
release. Nothing enforces it, and nobody drafting a set of notes has any reason to
go and look, so it belongs in this checklist rather than in somebody's memory.

Before publishing a note, check
[the sponsors list](https://github.com/sponsors/Gryt-chat) for one-time sponsorships
since the last one went out. If there are any, credit them at the end, above the recap
list, with nothing more than their names:

```mdx
Thanks to <name> and <name> for sponsoring this release.
```

Use whatever name they sponsored under, or the one they asked for. The tier says a
name, so a name is what goes in. Logos and links have their own places, in the
README and on gryt.chat/sponsors.

Recurring sponsors are not credited per release. They are listed in the README and
on gryt.chat/sponsors, which is what those tiers promise. Repeating them in every
note would turn the notes into a sponsor page.

Nothing to credit is the normal case. Say nothing at all rather than writing that
there were no sponsors.

## Betas

Not every beta deserves notes. If a release contains nothing above **Under the
hood**, skip it — a note saying "we deleted a dead script" is worse than silence.
Accumulate and publish when there is something to say.

## Things that make it read like a machine wrote it

Worth its own section because they are the failures that actually turn up, and
because every one of them survives a read-through unless you are looking for it.

**Groups of three.** "Voice presence is now reliable, avatars are consistent,
and macOS icons look right" is three things in a row because three sounds
finished, not because three things matter equally. Pick the one that matters and
say that.

**The same word starting every paragraph.** "Previously" in front of every
contrast reads as a form somebody filled in. Once per note is plenty. Put the
old behaviour in the second half of the sentence instead, or leave it out where
the fix speaks for itself.

**"Not X, but Y."** State Y. "This is not a redesign, it is a rewrite" is one
sentence pretending to be two.

**A noun phrase, a colon, then a reveal.** "The detail that makes it work: a
separate process." Write it as a sentence.

**Importance claims.** "marks a significant step", "underscores our commitment",
"a major improvement to". Say what changed and let the reader decide what it was
worth. If it needs to be called significant, it probably was not.

**Trailing -ing clauses that pretend to explain.** "…, ensuring a smoother
experience", "…, reflecting our focus on reliability". They add length and no
information. Cut at the comma.

**Every sentence the same length.** Real writing varies. A run of medium
sentences with no short one anywhere is the most reliable tell there is, and the
hardest to notice.

**A closing paragraph that restates the note.** The reader was just there. Stop
on the last real thing.

## Voice

Same as everything else Gryt writes: plain and direct. No marketing, no exclamation
marks, no "we're thrilled". Hedges like "a bit" and "probably" are fine. If a line
sounds like it belongs in a keynote, rewrite it.

Humour is allowed where it is true. "The checkbox was decorative" is funny because
it is what happened. Jokes at the reader's expense, or about how broken something
was, are not.
