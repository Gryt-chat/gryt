/* eslint-env node */

/**
 * The three refusals added for GRYT-734, against the drafts that caused them.
 *
 * Eleven drafts were waiting in `/admin/changelog` on 2026-08-30 and all eleven
 * were rejected by hand. Six failed for reasons a check can state, and the
 * fixtures below are those drafts cut down to the part that failed. Run it:
 *
 *     node ops/internal/changelog-notes.test.mjs
 *
 * The existing guards are not tested here. They were written against drafts
 * nobody kept, and inventing fixtures for them would test the fixture.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { askWithRetry, borrowedHeading, drafterRevision, liftedParagraph, neverReachedTheModel, refusalBlock, styleProblems } from "./changelog-notes.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const style = readFileSync(join(REPO, "patch-notes-style.md"), "utf8");

const said = (problems, pattern) =>
  problems.some((p) => pattern.test(p.text ?? p.message ?? String(p)));

/* ── A heading lifted out of the style guide (1.5.7) ──────────────────── */

// The guide offers "Everyone has a face" as an example of a heading that is a
// sentence rather than a label. It is about avatars. The draft put it over a
// section about importing a theme from a link, with a clause added on the end —
// so neither string contains the other whole, which is why the match is both
// ways round.
assert.ok(
  borrowedHeading(
    {
      headline: "Gryt now lets you save and switch between custom themes",
      sections: [
        { heading: "Everyone has a face, and you can give it a name", body: ["You can now import a theme by pasting a link."] },
      ],
    },
    style,
  ),
  "a heading extending one of the guide's examples is still the guide's example",
);

// A heading of its own is left alone, including one that happens to share
// ordinary words with the guide.
assert.equal(
  borrowedHeading(
    {
      headline: "Gryt now lets server hosts keep their assigned ports",
      sections: [
        { heading: "Servers keep the ports they were given, and report conflicts when they happen", body: ["A server keeps the ports it was given at creation."] },
      ],
    },
    style,
  ),
  null,
  "a heading written for the commits must pass",
);

/* ── A note explaining a release that has nothing to explain from (1.6.10) ─ */

const bodiless = [{ commits: [{ subject: "fix themed titlebar and identity settings (#164)", body: "" }] }];

// What the draft actually did: two sections, six sentences, a dark-mode symptom
// and a story about names reverting on restart. The range says none of it.
assert.ok(
  said(
    styleProblems(
      {
        headline: "Themed titlebars and identity settings now work properly",
        intro: ["This release fixes two long-standing issues."],
        sections: [
          {
            heading: "The app now keeps your theme settings in the titlebar",
            body: [
              "Previously the titlebar would often show the wrong background, especially on systems with dark mode enabled. This made the app feel disconnected from your system settings. Now the titlebar matches what you expect.",
            ],
          },
          {
            heading: "Your identity settings are saved and applied correctly",
            body: [
              "Before this change your name and avatar would sometimes be lost when you reopened the app. Your name might revert to a default. Now those settings are saved every time.",
            ],
          },
        ],
        recap: [],
        omitted: [],
      },
      bodiless,
    ),
    /no commit in this release has a body/,
  ),
  "a bodiless range explained at length is invention",
);

// One sentence per section is what a subject line can carry, so the same range
// written honestly has to pass.
assert.ok(
  !said(
    styleProblems(
      {
        headline: "The themed titlebar and identity settings are fixed",
        intro: ["One fix, and the commit does not say more than that."],
        sections: [
          { heading: "The themed titlebar and identity settings are fixed", body: ["The commit says both were fixed and does not say how."] },
        ],
        recap: [],
        omitted: [],
      },
      bodiless,
    ),
    /no commit in this release has a body/,
  ),
  "a short honest note about a bodiless range must pass",
);

// And a range that does have bodies is none of this check's business, however
// long the note is.
assert.ok(
  !said(
    styleProblems(
      {
        headline: "Leaving a server now forgets it properly",
        intro: ["Leaving a server used to leave traces behind."],
        sections: [
          {
            heading: "Leaving a server no longer leaves behind identity links or access tokens",
            body: ["Leaving removed it from the sidebar and left the pinned identity. That mattered because removeServer is what drops the tokens. Matching is on the server id now."],
          },
        ],
        recap: [],
        omitted: [],
      },
      [{ commits: [{ subject: "Leaving a server forgets it (GRYT-233)", body: "Deleting a hosted server removed the rail entry keyed on its loopback address and nothing else." }] }],
    ),
    /no commit in this release has a body/,
  ),
  "a range with bodies can be explained at any length",
);

/* ── American spelling (1.5.10, and four others in the queue) ─────────── */

const withBody = [{ commits: [{ subject: "Keep the titlebar on Gryt's own palette", body: "The titlebar followed the theme." }] }];

for (const [wrong, right] of [
  ["The titlebar would show the wrong background color.", "colour"],
  ["Voice detection stopped when you minimize the window.", "minimise"],
  ["The server would not recognize the identity.", "recognise"],
  ["This changes the behavior of the mute button.", "behaviour"],
]) {
  assert.ok(
    said(
      styleProblems(
        { headline: "A fix", intro: [wrong], sections: [{ heading: "A fix landed", body: [wrong] }], recap: [], omitted: [] },
        withBody,
      ),
      /American spelling/,
    ),
    `"${wrong}" should be refused in favour of ${right}`,
  );
}

/* An American spelling in Under the hood is still an American spelling.

   `readerProse` drops that group so identifiers can live in it, and the check
   reused it at first. The 1.6.18 draft got through with "consistent behavior"
   as an Under the hood recap line (GRYT-755). */
assert.ok(
  said(
    styleProblems(
      {
        headline: "Popups now appear above dialogs",
        intro: ["Two fixes to the interface."],
        sections: [{ heading: "Dropdowns inside modals are visible again", body: ["They were behind the dialog."] }],
        recap: [
          { group: "Interface", items: ["Dropdowns inside modals are visible again"] },
          { group: "Under the hood", items: ["Moved camera cleanup into a single function to ensure consistent behavior"] },
        ],
        omitted: [],
      },
      withBody,
    ),
    /American spelling/,
  ),
  "Under the hood is read by the same reader as everything else",
);

assert.ok(
  !said(
    styleProblems(
      {
        headline: "A fix",
        intro: ["The titlebar keeps its own colour now."],
        sections: [{ heading: "The titlebar keeps its own colour", body: ["It no longer follows the theme."] }],
        recap: [],
        omitted: [],
      },
      withBody,
    ),
    /American spelling/,
  ),
  "British spelling must pass",
);

/* ── One retry when the request never reached the model (GRYT-763) ────── */

// Undici throws a bare TypeError for a request that got no reply, including
// the five-minute headersTimeout that skipped 1.6.43 on 2026-08-30. An error
// the model sent back is a different thing and must not be retried: asking the
// same question again unchanged will get the same answer.
assert.equal(neverReachedTheModel(new TypeError("fetch failed")), true, "a transport failure is one");
assert.equal(neverReachedTheModel(new Error("ollama 500 boom")), false, "a status from the model is not");
assert.equal(
  neverReachedTheModel(Object.assign(new Error("aborted"), { name: "AbortError" })),
  false,
  "our own OLLAMA_TIMEOUT_MS abort is not — the model had its time and used it",
);

// Nothing here should sleep for the real minute.
process.env.OLLAMA_RETRY_DELAY_MS = "0";

const answering = () => ({
  ok: true,
  body: (async function* () {
    yield Buffer.from(`${JSON.stringify({ message: { content: '{"ok":true}' } })}\n`);
  })(),
});

const realFetch = globalThis.fetch;
const countingFetch = (behaviour) => {
  const state = { calls: 0 };
  globalThis.fetch = async () => {
    state.calls += 1;
    return behaviour(state.calls);
  };
  return state;
};

try {
  // Fails once, then answers. Two calls, and the answer comes back.
  let state = countingFetch((n) => {
    if (n === 1) throw new TypeError("fetch failed");
    return answering();
  });
  assert.deepEqual(await askWithRetry("hello"), { ok: true }, "the retry's answer is returned");
  assert.equal(state.calls, 2, "one retry, so two calls");

  // Fails twice. One retry, not a spiral: the next timer run is a better place
  // to discover the model is gone.
  state = countingFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(askWithRetry("hello"), TypeError, "the transport error is rethrown");
  assert.equal(state.calls, 2, "it gives up after one retry");

  // A model-side error is passed straight out, untouched.
  state = countingFetch(() => ({ ok: false, status: 500, text: async () => "boom" }));
  await assert.rejects(askWithRetry("hello"), /ollama 500/, "a model error is rethrown as it was");
  assert.equal(state.calls, 1, "and is not retried");
} finally {
  globalThis.fetch = realFetch;
  delete process.env.OLLAMA_RETRY_DELAY_MS;
}

/* ── A body paragraph copied out of the intro (GRYT-778) ─────────────── */

// 1.6.42 opened its only section with its own intro paragraph, two words
// changed. The threshold is measured, not guessed: 0.607 is the highest any
// hand-written note scores (1.7.0 restating that DMs are not encrypted, which
// is deliberate), and that copy scored 0.810.
const copied = {
  headline: "Voice tiles take their colour from the owl on them",
  intro: [
    "Before this release there was a mismatch between how you saw your avatar and how everyone else saw it, because the app used two different ways to pick the colour of your tile.",
  ],
  sections: [
    {
      heading: "The tile and the owl agree now",
      body: [
        "Before this release there was a mismatch between how you saw your avatar and how everyone else saw it, because the app picked the colour of your tile two different ways.",
        "Both now read the same nickname and the same worn look, so the tile is the colour of the owl sitting on it.",
      ],
    },
  ],
  recap: [{ group: "Avatars and images", items: ["Voice tiles take their colour from the owl on them"] }],
  omitted: [],
};

assert.ok(
  said(styleProblems(copied, withBody), /repeats the intro/),
  "a section paragraph that restates the intro is caught",
);

// The same note with the second copy replaced by something that says
// anything new must pass. This is the half that stops the rule being a
// blanket ban on mentioning a subject twice.
assert.ok(
  !said(
    styleProblems(
      { ...copied, sections: [{ ...copied.sections[0], body: copied.sections[0].body.slice(1) }] },
      withBody,
    ),
    /repeats the intro/,
  ),
  "a section that does not restate the intro passes",
);

// 1.7.0 repeats the not-encrypted warning between intro and body on purpose,
// and scores 0.607. Deliberate repetition of a caveat has to stay allowed.
assert.ok(
  !said(
    styleProblems(
      {
        headline: "You can message one person instead of a channel",
        intro: [
          "Direct messages are not encrypted yet. Whoever runs the server can read them, the same as any channel, and Gryt says so above the box you type into rather than letting a conversation that looks private stand in for a private one.",
        ],
        sections: [
          {
            heading: "What this does not do",
            body: [
              "Direct messages are not encrypted. They are stored on the server like any other message and whoever runs it can read them. The notice above the composer says so and links to the documentation.",
            ],
          },
        ],
        recap: [{ group: "Voice", items: ["Ring somebody from a direct message"] }],
        omitted: [],
      },
      withBody,
    ),
    /repeats the intro/,
  ),
  "a caveat repeated on purpose is not a copied paragraph",
);

/* ── The reason a person refused the last draft (GRYT-781) ────────────── */

// Rejecting a draft has always meant "write it again". Until this it did not
// mean "and here is what was wrong": the reason sat in reports and reached
// nobody, so 1.6.41 was refused for its recap group and came back with the
// same group, and "The fixes are subtle but important" was refused on one
// release and reappeared verbatim on the next.
const refused = refusalBlock("The recap files a proxy fix under Updates.");
assert.match(refused, /REFUSED/, "the block says the last note was refused");
assert.match(refused, /The recap files a proxy fix under Updates\./, "and carries the reason verbatim");

// A version nobody has refused adds nothing at all. The block is concatenated
// onto every prompt, so an empty one has to be genuinely empty rather than a
// heading with nothing under it.
assert.equal(refusalBlock(undefined), "", "no refusal is no block");
assert.equal(refusalBlock(null), "", "null is no block");
assert.equal(refusalBlock("   "), "", "a refusal with nothing typed in it is no block");

/* ── The commit the drafter is running from (GRYT-780) ────────────────── */

// ExecStartPre pulls the checkout and is allowed to fail, so a run can write
// notes against rules that are no longer the rules. Three times in three days.
// The commit goes on every draft so that question is answerable from the
// review page rather than from the journal.
const gitSays = execFileSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], {
  encoding: "utf8",
}).trim();

assert.equal(
  drafterRevision(),
  gitSays,
  "the drafter reports the commit it is actually running from",
);

// Not a placeholder, not an empty string: absent is what a tarball with no
// .git should produce, and a draft is worth posting without the label.
assert.ok(
  drafterRevision() === undefined || /^[0-9a-f]{7,}$/.test(drafterRevision()),
  "a revision is a commit or nothing at all",
);

/* ── A paragraph taken from another release's note (GRYT-787) ─────────── */

// The real one: a draft for 1.6.38 opened with 1.6.0's first paragraph, about
// guest identity and owning a server, for a release whose commits are avatar
// storage and websocket pings. It scored 11 on contamination's word count —
// well under the 20 that catches wholesale retelling — and reached the queue
// twice, the second time after being refused for exactly that.
const oneSixZero = {
  version: "1.6.0",
  text: [
    "Using Gryt without an account has always had one sharp edge: whatever you were on",
    "a server lived in one browser on one machine. Clear your site data and it was gone,",
    "along with any roles you had and any server you owned. This release takes that apart.",
  ].join(" "),
};

const lifted = {
  headline: "Your avatar follows you between devices",
  intro: [
    "Using Gryt without an account has always had one sharp edge: whatever you were on a server lived in one browser on one machine. Clear your site data and it was gone, along with any roles you had and any server you owned. This release takes that apart.",
  ],
  sections: [{ heading: "The look is stored beside the nickname", body: ["The server keeps the short string the editor produced."] }],
  recap: [{ group: "Avatars and images", items: ["A designed owl follows you between devices"] }],
  omitted: [],
};

assert.match(
  liftedParagraph(lifted, [oneSixZero]) ?? "",
  /taken from the 1\.6\.0 note/,
  "a paragraph copied out of another release's note is caught, and named",
);

// The measurement that set the threshold: 0.625 for the copied paragraph
// against 0.313 for the worst honest draft in the same batch. A note that
// merely shares a subject with an older one has to pass.
assert.equal(
  liftedParagraph(
    {
      ...lifted,
      intro: [
        "A designed owl used to be a picture, so it stayed on the machine that made it and never followed anybody anywhere.",
      ],
    },
    [oneSixZero],
  ),
  null,
  "writing about the same subject in your own words is not lifting",
);

assert.equal(liftedParagraph(lifted, []), null, "no notes to compare against is not a finding");

// Short paragraphs are skipped: two brief sentences about one feature share
// most of their words honestly.
assert.equal(
  liftedParagraph({ ...lifted, intro: ["Clear your site data and it was gone."] }, [oneSixZero]),
  null,
  "a short paragraph is not enough to call it lifted",
);

/* ── The spelling list stops guessing at suffixes (GRYT-787) ──────────── */

// "customizable" passed a clean run on 2026-08-31 because the pattern was
// customiz(e|ed|es|ing) and -able was not one of the four.
const withWord = (word) => ({
  headline: "A release",
  intro: [`The editor is ${word} in every way that matters to somebody setting one up.`],
  sections: [{ heading: "The editor changed", body: ["It did."] }],
  recap: [],
  omitted: [],
});
const parts = [{ component: "The app", commits: [{ subject: "x", body: "y" }] }];

for (const word of ["customizable", "organizational", "minimizer", "recognizable"]) {
  assert.ok(
    said(styleProblems(withWord(word), parts), /American spelling/),
    `"${word}" is caught whatever its ending`,
  );
}

for (const word of ["customisable", "recognisable", "colourful"]) {
  assert.ok(
    !said(styleProblems(withWord(word), parts), /American spelling/),
    `"${word}" is British and must pass`,
  );
}

console.log("changelog-notes checks: ok");
