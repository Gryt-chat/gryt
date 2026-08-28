---
name: natural-writing
description: Rewrite text so it sounds like a person talking — simple words, short sentences, no marketing voice. Use when the user says writing sounds strange, stiff, academic, or "not how a person talks", asks for it plainer or simpler, or is writing product copy, docs, a README, release notes or a landing page.
---

# Natural writing

Make it sound like something you would actually say out loud.

This is Sivert's brief, kept in his words where it was already clear. The point
is not to make writing friendly or casual for its own sake. The point is that a
reader should never have to slow down.

## Two jobs

**Rewrite (default).** The user hands over a draft, or points at a page. Rewrite
it against the rules below and say what changed. Keep every fact.

**Check.** The user asks whether something reads naturally, or asks you to go
over a page without changing it. Quote each line that breaks a rule, name the
rule, and give the fix in a few words. Do not rewrite.

## The rules

### Language

- **Simple words.** Write like you talk to a friend.
- **Short sentences.** Break a complex thought into pieces.
- **Be direct.** Say what you mean without extra words.
- **Natural flow.** Starting a sentence with "and", "but" or "so" is fine.
- **Real voice.** Do not force friendliness or fake excitement.

### Style

- **Conversational grammar.** Simple structures, not academic ones.
- **Cut fluff.** Drop adjectives and adverbs that are not doing anything.
- **Use examples.** Show a specific case instead of an abstraction.
- **Be honest.** Admit limits. Do not oversell.
- **Write like texting.** Direct, the way you would actually say it.
- **Simple connectors:** "here's the thing", "and", "but".

## Banned

Never write these:

> delve, dive into, unleash, game-changing, revolutionary, transformative,
> leverage, optimize, unlock potential, unlock the secrets, transform your life,
> embark, elevate, harness, seamless, robust, cutting-edge, paradigm shift

And the shapes they come in:

| Instead of | Write |
|---|---|
| "Let's dive into…" | "Here's how it works" |
| "Unleash your potential" | "This can help you" |
| "Game-changing solution" | "Here's what I found" |
| "Revolutionary approach" | "This might work for you" |
| "Leverage this strategy" | "Here's the thing" |
| "Optimize your workflow" | "And that's why it matters" |
| — | "But here's the problem" |
| — | "So here's what happened" |

## How to do it

Work sentence by sentence. Most of the fix is four moves:

1. **Contract.** "It is not" → "It isn't". "There is nothing" → "There's
   nothing". In JSX use `&rsquo;`, not a bare apostrophe.
2. **Cut at the join.** A sentence carrying two or three clauses through a
   semicolon is two or three sentences. "Voice is routed through an SFU for
   fan-out, so the SFU is on the path, and it is run by the server owner" →
   "Voice goes through an SFU so it can reach everyone at once. That puts the
   SFU on the path too. The server owner runs that as well."
3. **Take the ordinary word.** "Infrastructure you control" → "machines you
   control". "Persistent channels" → "channels that stay put". "Engagement
   mechanics" → "nothing built to keep you scrolling".
4. **Name who does the thing.** "The operator" → "whoever runs the server".
   "Uploads are streamed in parts" → "uploads go up in parts".

## What not to touch

- **Facts.** Every number, price, port, version, licence, name and caveat comes
  through unchanged. This is a pass over how the sentences read, not over what
  they claim. If a rewrite would drop a caveat, keep the caveat and write a
  second sentence.
- **Code, identifiers, log lines, test names, comments.** Nobody browses them,
  and comments are often load-bearing.
- **Legal text.** Privacy policies, terms, licences. The formal register is the
  point of them.
- **First-person writing that already sounds like the author.** If somebody is
  telling you why they built something and it already sounds like them, put the
  contractions back and leave the rest alone.

## The check before you finish

Read each line and ask:

- Would you say it out loud?
- Does it use words a normal person uses?
- Does it sound like marketing?
- Is it honest about what the thing does not do?
- Does it get to the point?

If a sentence could be moved to another company's page unchanged, it is filler.
Cut it or replace it with a fact.

## Related

`no-ai-slop` is the other half of this and they compose. That one removes AI
tells and protects a distinctive voice; this one makes the result simple and
spoken. Run `no-ai-slop` when the problem is that writing sounds generated. Run
this one when the problem is that it sounds stiff, clever or academic. On
product copy, running both is normal — slop first, then this.
