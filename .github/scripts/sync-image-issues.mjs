#!/usr/bin/env node
/* eslint-env node */

/** Opens an issue per image that fails the check, closes it once the image
 *  recovers. Runs here — GITHUB_TOKEN can't write to the image's own repo. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.GRYT_IMAGE_ISSUES_REPO ?? "Gryt-chat/gryt";
const LABEL = "image-check";
const DRY_RUN = process.argv.includes("--dry-run");

const RUN_URL =
  process.env.GRYT_RUN_URL ??
  (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "(no run URL — local run)");

const WORKAROUND =
  "If the image is already cached locally, `docker compose pull --ignore-pull-failures && docker compose up -d` " +
  "brings the stack up on the version you have while this is unresolved.";

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

/* `gh ... --json` prints nothing at all for an empty result, not "[]". */
function ghJson(args) {
  const out = gh(args).trim();
  return out === "" ? [] : JSON.parse(out);
}

function title(ref) {
  return `Image unavailable: ${ref}`;
}

/* A marker line in the body, not a comment scan, decides whether the reason
   changed — comments are for history, not for the current state. */
function reasonMarker(reason) {
  return `<!-- image-check-reason: ${reason.replace(/\n/g, " ").slice(0, 500)} -->`;
}

function ensureLabelExists() {
  const existing = ghJson(["label", "list", "--repo", REPO, "--search", LABEL, "--json", "name"]);
  if (existing.some((l) => l.name === LABEL)) return;

  if (DRY_RUN) {
    console.log(`[dry-run] would create label "${LABEL}"`);
    return;
  }
  gh([
    "label",
    "create",
    LABEL,
    "--repo",
    REPO,
    "--color",
    "b60205",
    "--description",
    "An image a self-hoster pulls failed the anonymous registry check",
  ]);
}

function findOpenIssue(ref) {
  const issues = ghJson([
    "issue",
    "list",
    "--repo",
    REPO,
    "--label",
    LABEL,
    "--state",
    "open",
    "--search",
    `in:title "${title(ref)}"`,
    "--json",
    "number,title,body",
    "--limit",
    "50",
  ]);
  return issues.find((i) => i.title === title(ref)) ?? null;
}

function currentReason(existingBody) {
  const m = existingBody?.match(/<!-- image-check-reason: (.*) -->/);
  return m?.[1] ?? null;
}

function openOrUpdate(result) {
  const existing = findOpenIssue(result.ref);
  const reason = result.error ?? `missing ${result.missing.join(", ")}`;
  const body = [
    `**Image:** \`${result.ref}\``,
    `**Named in:** ${result.sources.map((s) => `\`${s}\``).join(", ")}`,
    `**Error:** ${reason}`,
    `**Run:** ${RUN_URL}`,
    "",
    WORKAROUND,
    "",
    reasonMarker(reason),
  ].join("\n");

  if (!existing) {
    if (DRY_RUN) {
      console.log(`[dry-run] would open "${title(result.ref)}"`);
      return;
    }
    gh(["issue", "create", "--repo", REPO, "--title", title(result.ref), "--body", body, "--label", LABEL]);
    return;
  }

  if (currentReason(existing.body) === reason) {
    console.log(`#${existing.number} ${title(result.ref)}: reason unchanged, no comment`);
    return;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] would comment on #${existing.number} (reason changed) and update the body`);
    return;
  }
  gh(["issue", "comment", String(existing.number), "--repo", REPO, "--body", `Still failing:\n\n${body}`]);
  gh(["issue", "edit", String(existing.number), "--repo", REPO, "--body", body]);
}

function closeIfRecovered(result) {
  const existing = findOpenIssue(result.ref);
  if (!existing) return;

  if (DRY_RUN) {
    console.log(`[dry-run] would comment on #${existing.number} and close it (image recovered)`);
    return;
  }
  gh([
    "issue",
    "comment",
    String(existing.number),
    "--repo",
    REPO,
    "--body",
    `Passing again: ${RUN_URL}`,
  ]);
  gh(["issue", "close", String(existing.number), "--repo", REPO]);
}

function main() {
  const resultsPath = process.argv[2] ?? process.env.GRYT_IMAGE_CHECK_RESULTS;
  if (!resultsPath) {
    console.error("usage: sync-image-issues.mjs <results.json> [--dry-run]");
    process.exit(2);
  }
  const results = JSON.parse(readFileSync(resultsPath, "utf8"));

  ensureLabelExists();
  for (const result of results) {
    if (result.ok) closeIfRecovered(result);
    else openOrUpdate(result);
  }
}

main();
