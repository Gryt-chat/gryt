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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { borrowedHeading, styleProblems } from "./changelog-notes.mjs";

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

console.log("changelog-notes checks: ok");
