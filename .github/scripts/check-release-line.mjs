/**
 * Refuses a release nobody has written a changelog line for. Run by
 * release-client.yml and release-server.yml once the version is known and
 * before the first commit is made. GRYT-1107.
 *
 * Two ways to ship a release the site cannot build: no line at all, and a line
 * whose date is not the day the release happened. check-changelog-lines.mjs in
 * the site repository asserts both, inside the Docker build, so either one
 * stops gryt.chat and docs.gryt.chat deploying until somebody fixes it — and
 * the app's changelog.json is emitted by that same build, so the notice about
 * what changed never reaches anybody either.
 */

const SOURCE =
  process.env.GRYT_RELEASES_URL ??
  "https://raw.githubusercontent.com/Gryt-chat/site/main/content/changelog/releases.ts";

/* The surfaces released from this repository. voice and images have their own,
   and a 1.11.3 in one of those is a different release from the app's. */
const SURFACES = ["app", "server"];

const [surface, version] = process.argv.slice(2);

if (!surface || !version) {
  console.error("usage: check-release-line.mjs <surface> <version>");
  process.exit(2);
}

if (!SURFACES.includes(surface)) {
  console.error(`Unknown surface ${surface}. Expected one of: ${SURFACES.join(", ")}`);
  process.exit(2);
}

/* A -beta.N is a build of a version rather than a version — 1.4.0 had twenty —
   and the site's own check skips prereleases for that reason. */
if (version.includes("-")) {
  console.log(`changelog line: ${surface} ${version} is a prerelease, no line required`);
  process.exit(0);
}

/** The releases source, read over the network or, for the tests, off disk. */
async function read() {
  if (!SOURCE.startsWith("http")) {
    const { readFile } = await import("node:fs/promises");
    return readFile(SOURCE, "utf8");
  }

  /* Three tries. A release that fails because raw.githubusercontent.com
     blinked burns a version number, and the retry costs a second. */
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(SOURCE);
      if (!res.ok) throw new Error(`answered ${res.status}`);
      return await res.text();
    } catch (e) {
      last = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw last;
}

let source;
try {
  source = await read();
} catch (e) {
  console.error(`Could not read the changelog source, so the line could not be checked.`);
  console.error(`  ${SOURCE}`);
  console.error(`  ${e.message}`);
  console.error("");
  console.error("This is not a missing line — the check itself did not run. Try again.");
  process.exit(1);
}

/* The same shape the site's check-changelog-lines.mjs parses. If the file stops
   matching this, both break together rather than this one passing quietly. */
const array = source.match(
  new RegExp(`export const ${surface}: ReleaseLine\\[\\] = \\[([\\s\\S]*?)\\n\\];`),
);

if (!array) {
  console.error(`Could not find the ${surface} releases in the site's changelog source.`);
  console.error(`Looked in ${SOURCE}`);
  process.exit(1);
}

const quoted = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entry = array[1].match(new RegExp(`version: "${quoted}",\\s*\\n\\s*date: "([^"]+)"`));

/* Today where GitHub reads it. The site compares each line's date against the
   release's published date, which is UTC. */
const today = new Date().toISOString().slice(0, 10);

if (!entry) {
  if (new RegExp(`version: "${quoted}"`).test(array[1])) {
    console.error(`The ${surface} ${version} entry has no date directly after its version.`);
    console.error("The site reads the two together, so an entry shaped any other way is");
    console.error("invisible to it and the release counts as unwritten. Put them back in");
    console.error(`order, with date: "${today}".`);
    process.exit(1);
  }

  console.error(`No changelog line for ${surface} ${version}.`);
  console.error("");
  console.error("The desktop app reads the line to say what changed after it updates, and the");
  console.error("site's build refuses to pass while a release has no line — so releasing this");
  console.error("now stops gryt.chat deploying until somebody writes it.");
  console.error("");
  console.error(`Add an entry to the top of the \`${surface}\` array in the site repository:`);
  console.error("");
  console.error("  content/changelog/releases.ts");
  console.error("");
  console.error(`  {`);
  console.error(`    version: "${version}",`);
  console.error(`    date: "${today}",`);
  console.error(`    line: "One sentence, present tense, from the reader's side.",`);
  if (surface === "app") {
    console.error(`    changes: [{ kind: "fixed", text: "..." }],`);
  }
  console.error(`  },`);
  console.error("");
  console.error("Merge that, then run this release again.");
  process.exit(1);
}

if (entry[1] !== today) {
  console.error(`The ${surface} ${version} line is dated ${entry[1]}, and today is ${today}.`);
  console.error("");
  console.error("The site checks every line's date against the day the release was published,");
  console.error("in UTC, and fails its build when they disagree. Shipping now would break");
  console.error("gryt.chat the same way a missing line does.");
  console.error("");
  console.error(`Change that entry's date to "${today}" in the site repository, or wait and`);
  console.error("release on the day the line already names.");
  process.exit(1);
}

console.log(`changelog line: ${surface} ${version} has one, dated ${entry[1]}`);
