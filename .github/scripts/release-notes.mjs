/* eslint-env node */

/**
 * What changed between two releases, as the body of a GitHub release.
 *
 * Every other repository in the org gets this for free from
 * `generate_release_notes: true`, which lists the pull requests merged since the
 * previous tag. That does nothing useful here. The superproject's own commits
 * between two releases are `chore: update all submodules on main [skip ci]` and
 * a version bump — the work is in four other repositories, and GitHub cannot
 * see across them.
 *
 * So this builds the same thing by hand. Both manifests name the exact commit
 * each component was built from, so the range per component is a subtraction,
 * and every merged pull request in that range is one line of `git log`.
 *
 * The alternative it replaces was a release body that said "see manifest.json
 * for the exact commits". True, and nobody has ever done it.
 *
 *   node .github/scripts/release-notes.mjs \
 *     --previous <manifest.json> --current <manifest.json> [--repo-root .]
 *
 * Writes markdown to stdout. Missing a previous manifest is not an error — the
 * first release of a line has nothing to diff against and says so.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/* --- arguments ----------------------------------------------------------- */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const repoRoot = args.get("repo-root") ?? process.cwd();
const currentPath = args.get("current");
const previousPath = args.get("previous");

if (!currentPath) {
  console.error("usage: release-notes.mjs --current <manifest.json> [--previous <manifest.json>]");
  process.exit(1);
}

const current = JSON.parse(readFileSync(currentPath, "utf8"));
const previous =
  previousPath && existsSync(previousPath)
    ? JSON.parse(readFileSync(previousPath, "utf8"))
    : null;

/** The order they are listed in, and what to call each one. */
const COMPONENTS = [
  ["client", "Client"],
  ["server", "Server"],
  ["sfu", "SFU"],
  ["imageWorker", "Image worker"],
];

/* --- reading a component's history --------------------------------------- */

function git(cwd, cmdArgs) {
  return execFileSync("git", cmdArgs, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

/** Does this repository have that commit? A shallow clone often does not. */
function has(cwd, commit) {
  try {
    git(cwd, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits between two points, first parent only.
 *
 * `--first-parent` is what turns a branch's worth of commits into one line per
 * pull request. Without it a squash-merge repository reads correctly and a
 * merge-commit one lists every intermediate commit somebody pushed while
 * working, which is not what a release note is.
 */
function commits(cwd, from, to) {
  const out = git(cwd, [
    "log",
    "--first-parent",
    "--no-merges",
    "--format=%H%x1f%s%x1f%b%x1e",
    `${from}..${to}`,
  ]);
  return out
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f");
      return { sha, subject: subject ?? "", body: body ?? "" };
    });
}

/**
 * The pull request a commit came from, if it names one.
 *
 * Two shapes appear in these repositories. A squash merge — which is how
 * everything lands now — puts the number on the end of the subject:
 * `Say when a join failed (GRYT-559) (#234)`. Older commits came through merge
 * commits, `Merge pull request #68 from Gryt-chat/…`, whose real title is the
 * first line of the body.
 *
 * Anything with no number at all is still listed. A commit pushed straight to
 * main is exactly the kind of thing worth seeing in a release note, and
 * dropping it because it skipped review would be the wrong way round.
 */
function describe(commit) {
  const squashed = /^(.*)\s+\(#(\d+)\)\s*$/.exec(commit.subject);
  if (squashed) return { title: squashed[1].trim(), pr: Number(squashed[2]) };

  const merged = /^Merge pull request #(\d+) from /.exec(commit.subject);
  if (merged) {
    const title = commit.body.split("\n").map((l) => l.trim()).find(Boolean);
    return { title: title || commit.subject, pr: Number(merged[1]) };
  }

  return { title: commit.subject.trim(), pr: null };
}

/**
 * Commits that are about cutting a release rather than about the product.
 *
 * The version bump each component makes on its own release is noise in a note
 * about what changed, and it is always there.
 */
function isRelease(title) {
  return /^(release|chore\(release\)):/i.test(title) || /^v?\d+\.\d+\.\d+/.test(title);
}

/* --- building the note --------------------------------------------------- */

const sections = [];
const compareLinks = [];
const problems = [];

for (const [key, label] of COMPONENTS) {
  const now = current.components?.[key];
  if (!now) continue;

  const before = previous?.components?.[key];
  const cwd = path.join(repoRoot, now.path);

  if (!existsSync(path.join(cwd, ".git"))) {
    problems.push(`${label}: ${now.path} is not checked out, so its changes are not listed.`);
    continue;
  }
  if (!before) {
    sections.push(`### ${label}\n\nFirst release including this component.`);
    continue;
  }
  if (before.commit === now.commit) continue;
  if (!has(cwd, before.commit) || !has(cwd, now.commit)) {
    problems.push(
      `${label}: ${before.commit.slice(0, 7)}..${now.commit.slice(0, 7)} is not in the ` +
        "local clone, so its changes are not listed.",
    );
    continue;
  }

  const entries = commits(cwd, before.commit, now.commit)
    .map(describe)
    .filter((entry) => entry.title && !isRelease(entry.title));

  compareLinks.push(
    `* ${label}: https://github.com/${now.repo}/compare/${before.commit}...${now.commit}`,
  );

  if (entries.length === 0) continue;

  const lines = entries.map((entry) =>
    entry.pr
      ? `* ${entry.title} in https://github.com/${now.repo}/pull/${entry.pr}`
      : `* ${entry.title}`,
  );
  sections.push(`### ${label}\n\n${lines.join("\n")}`);
}

/* --- output -------------------------------------------------------------- */

const out = [];
out.push(`Gryt v${current.version}`, "", `Channel: ${current.channel}`, "");

if (!previous) {
  out.push(
    "No previous release to compare against, so there is no list of changes.",
    "",
  );
} else if (sections.length === 0) {
  out.push(
    `No component moved since v${previous.version}. This release rebuilds the same code.`,
    "",
  );
} else {
  out.push(`## What changed since v${previous.version}`, "", sections.join("\n\n"), "");
}

if (compareLinks.length > 0) {
  out.push("**Full changelogs**", "", compareLinks.join("\n"), "");
}
if (problems.length > 0) {
  out.push("<!-- " + problems.join(" ") + " -->", "");
}

out.push(
  "Built from the monorepo with pinned submodule commits. `manifest.json` below " +
    "names the exact commit each component was built from.",
);

process.stdout.write(out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");
