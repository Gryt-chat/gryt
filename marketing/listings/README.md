# Store listing copy

What each store shows on the product page, kept here rather than only in the
console that publishes it.

The console isn't a good home on its own. Partner Center, App Store Connect and
the Play Console each hold one copy. None of them diffs. None of them tells you
the text changed, or who changed it. Copy that lives only there gets rewritten
from nothing the next time somebody opens the form. That is the same shape as the
SVG purge decision and `patch-notes-style.md`, both of which CLAUDE.md has a
paragraph about.

One file per store per language. The file is where the copy lives, and what is in
the console is a paste of it. Change the file first, run both copy skills over it,
then paste.

| File | Store | Where it goes |
|---|---|---|
| `microsoft-store.en-US.md` | Microsoft Store | Partner Center, product 9PKPT1C2M95Q |
| `microsoft-store.nb-NO.md` | Microsoft Store | same product, Norwegian listing |

App Store and Google Play were written straight into their consoles and aren't
here yet. They have the same problem and want the same treatment.

## Before pasting anything in

Run `no-ai-slop` first, then `natural-writing`. CLAUDE.md's Style section says
why and is blunt about it. Store copy is product surface, so it takes
contractions and short sentences — the formal register belongs in the Terms and
the Privacy Policy, not here.
