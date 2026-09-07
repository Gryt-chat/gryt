#!/usr/bin/env node
/**
 * Writes the reference pages for the three APIs somebody outside Gryt builds
 * against, from the TypeScript that defines them (GRYT-950).
 *
 * - `docs/server/plugin-api` — what a server plugin is handed
 * - `docs/client/addon-api`  — what a client plugin is handed
 * - `docs/bot/api-reference` — everything `@gryt/bot` exports
 *
 * ## Why generated
 *
 * Because a handwritten one goes stale, and there is a worked example. The
 * site's developer page printed the whole of `pluginApi.ts` with a comment
 * above it saying it had to grow with the file or become a lie. The file was
 * deleted in GRYT-930 and the page kept printing `window.gryt` and the sentence
 * "no sandbox, no permission model" for as long as it took somebody to read it
 * again. Nothing failed. The three guide pages beside these can drift the same
 * way, and mostly the guides should — they teach a shape and skip the surface —
 * but a reference that skips half the surface is worse than none.
 *
 * ## Why the superproject
 *
 * The same reason as `check-permission-labels.mjs` next door: nothing else can
 * see server, client, bot and docs at once. Each repository's CI is green while
 * its own source and the page describing it have already parted company.
 *
 * ## Usage
 *
 *   generate-api-reference.mjs           write the pages
 *   generate-api-reference.mjs --check   fail if what is on disk is not what
 *                                        this would write
 *
 * Reads whatever `packages/*` holds. The caller decides what is checked out
 * there; this script has no opinion about it.
 *
 * ## What it does not do
 *
 * It resolves nothing. A type annotation is copied through as the text in the
 * source, so `Promise<ModerationOutcome>` stays those words rather than being
 * expanded — which is what somebody reading wants, since that name is what they
 * will search for. The cost is that renaming a type in a file this does not
 * read leaves the old name on the page, and nothing here notices.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const ROOT =
  process.env.GRYT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/*
 * TypeScript is resolved from whichever package has it rather than depended on
 * here, because the superproject has no package.json and adding one to hold a
 * single devDependency would give Dependabot a fourteenth manifest to open pull
 * requests against.
 *
 * The workflow installs it into packages/docs, which is checked out anyway
 * because this writes into it.
 */
const require = createRequire(import.meta.url);
let ts;
for (const from of ["docs", "client", "server", "site"]) {
  try {
    ts = require(require.resolve("typescript", { paths: [`${ROOT}/packages/${from}`] }));
    break;
  } catch {
    /* next */
  }
}
if (!ts) {
  console.error(
    "generate-api-reference: no typescript to parse with.\n" +
      "  Install it somewhere this can see, e.g. `yarn --cwd packages/docs add -D typescript`,\n" +
      "  or run this from a checkout where a submodule's node_modules is populated.",
  );
  process.exit(1);
}

const CHECK = process.argv.includes("--check");

/* ── Reading TypeScript ──────────────────────────────────────────────── */

const parsed = new Map();

function sourceFile(path) {
  if (parsed.has(path)) return parsed.get(path);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.error(`generate-api-reference: cannot read ${path.slice(ROOT.length + 1)}`);
    console.error("  Is the submodule checked out?");
    process.exit(1);
  }
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  parsed.set(path, file);
  return file;
}

/**
 * The doc comment above a node, as prose.
 *
 * Only the description: `@param` and the rest are dropped, because a reference
 * page renders parameters from the signature and printing both would put the
 * same fact on the page twice in two shapes.
 *
 * Markdown from the source survives — these comments are written with backticks
 * and lists in them already, and MDX renders that.
 */
function docOf(node) {
  const [doc] = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  if (!doc) return "";
  const comment = typeof doc.comment === "string"
    ? doc.comment
    : (doc.comment ?? []).map((part) => part.text ?? "").join("");
  return comment.trim();
}

/** Every top-level declaration in a file, by the name it is declared under. */
function declarations(file) {
  const found = new Map();
  for (const statement of file.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      found.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          /* The JSDoc hangs on the statement, not the declarator. Keep both so
             docOf can be asked for either. */
          found.set(decl.name.text, Object.assign(decl, { grytStatement: statement }));
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      found.set(statement.name.text, statement);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      found.set(statement.name.text, statement);
    }
  }
  return found;
}

function declaration(path, name) {
  const found = declarations(sourceFile(path)).get(name);
  if (!found) {
    console.error(`generate-api-reference: ${path.slice(ROOT.length + 1)} declares no ${name}.`);
    console.error("  It was renamed or moved. Update this script to match.");
    process.exit(1);
  }
  return found;
}

/** Source text of a node, with runs of whitespace flattened onto one line. */
function text(node) {
  return node.getText().replace(/\s+/g, " ").trim();
}

/**
 * The members of an interface, as `{ name, signature, doc }`.
 *
 * `signature` is the member as written minus its own name, so a method reads as
 * its parameter list and return type and a property reads as its type.
 */
function interfaceMembers(node) {
  const members = [];
  for (const member of node.members) {
    /* A string-literal name is not an oddity here: every key in `PluginEvents`
       is one, because an event is called `message:created` and a colon cannot
       go in an identifier. Reading identifiers only skipped the whole events
       section and left the heading above it with nothing under it. */
    if (!member.name || !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) continue;
    const name = member.name.text;
    const whole = text(member).replace(/;$/, "");
    /* Past the name as it is written, quotes included, so a quoted key does not
       leave its closing quote at the front of the signature. */
    const written = ts.isStringLiteral(member.name) ? `"${name}"` : name;
    members.push({
      name,
      signature: whole.slice(whole.indexOf(written) + written.length).trim(),
      doc: docOf(member),
      readonly: !!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword),
      /* Kept so a caller can look past the text — the events section reads the
         payload's own members out of this. */
      node: member,
    });
  }
  return members;
}

/**
 * The members of a `const x = { … }`, the same shape as an interface's.
 *
 * The client's whole API is an object literal rather than a type — it is the
 * thing itself, assigned onto `globalThis` — so a reference for it has to read
 * the value. Getters are reported as properties, which is what they are from
 * the outside.
 */
function objectMembers(node) {
  const init = node.initializer;
  if (!init || !ts.isObjectLiteralExpression(init)) {
    console.error(`generate-api-reference: ${node.name.getText()} is not an object literal.`);
    process.exit(1);
  }

  const members = [];
  for (const property of init.properties) {
    if (!property.name || !ts.isIdentifier(property.name)) continue;
    const name = property.name.text;
    const doc = docOf(property);

    if (ts.isMethodDeclaration(property)) {
      const params = property.parameters.map(text).join(", ");
      const returns = property.type ? `: ${text(property.type)}` : "";
      members.push({ name, signature: `(${params})${returns}`, doc, kind: "method" });
    } else if (ts.isGetAccessorDeclaration(property)) {
      /*
       * Refused rather than inferred. This reads source as text and resolves
       * nothing, on purpose — `Promise<ModerationOutcome>` should stay the words
       * somebody will search for — but the cost is that an unannotated getter
       * has no type to print, and `gryt.version` was one. It listed as `version`
       * with nothing beside it, which is a reference page lying by omission.
       *
       * A checker was the first fix and it is the wrong one: it drags in module
       * resolution for a surface of two getters, and it did not answer anyway
       * without the lib files. Annotating the source is a smaller change and
       * makes the source better too.
       */
      if (!property.type) {
        console.error(
          `generate-api-reference: \`${name}\` in ${node.name.getText()} has no return type.\n` +
            "  This reads types as written and cannot work one out. Annotate the getter\n" +
            `  in ${property.getSourceFile().fileName.slice(ROOT.length + 1)} and run this again.`,
        );
        process.exit(1);
      }
      members.push({ name, signature: `: ${text(property.type)}`, doc, kind: "property" });
    } else if (ts.isPropertyAssignment(property)) {
      const value = property.initializer;
      if (ts.isObjectLiteralExpression(value)) {
        members.push({
          name,
          signature: "",
          doc,
          kind: "group",
          nested: objectMembers({ name: property.name, initializer: value }),
        });
      } else if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
        /* `gryt.log.info` and its two siblings are arrow properties rather than
           methods. Without this they came out as headings with an empty code
           block under them. */
        const params = value.parameters.map(text).join(", ");
        const returns = value.type ? `: ${text(value.type)}` : "";
        members.push({ name, signature: `(${params})${returns}`, doc, kind: "method" });
      } else {
        members.push({ name, signature: "", doc, kind: "property" });
      }
    }
  }
  return members;
}

/** A `const X = [...] as const` or a plain array, as its string entries. */
function stringArray(node) {
  let init = node.initializer;
  if (init && ts.isAsExpression(init)) init = init.expression;
  if (!init || !ts.isArrayLiteralExpression(init)) return [];
  return init.elements.filter(ts.isStringLiteral).map((e) => e.text);
}

/** A `const X: Record<…> = { a: "b" }`, as a Map, keeping the doc on each entry. */
function stringRecord(node) {
  const init = node.initializer;
  const out = new Map();
  if (!init || !ts.isObjectLiteralExpression(init)) return out;
  for (const property of init.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
      ? property.name.text
      : null;
    if (key === null) continue;
    out.set(key, {
      value: ts.isStringLiteral(property.initializer) ? property.initializer.text : text(property.initializer),
      doc: docOf(property),
    });
  }
  return out;
}

/** Numeric consts by name, so a documented limit is the number that ships. */
function numbers(path, names) {
  const found = declarations(sourceFile(path));
  const out = new Map();
  for (const name of names) {
    const decl = found.get(name);
    if (!decl?.initializer) continue;
    const written = text(decl.initializer);
    /* `MAX_PAYLOAD_BYTES` is written `8 * 1024`, which is the right way to write
       it and the wrong thing to print at somebody. Folded when it is nothing but
       digits and arithmetic, and left alone otherwise — the guard is what keeps
       this from being an eval of whatever the source happens to say. */
    const value = /^[\d_+*\s]+$/.test(written)
      ? String(Function(`"use strict"; return (${written})`)())
      : written;
    out.set(name, value);
  }
  return out;
}

/* ── Writing MDX ─────────────────────────────────────────────────────── */

const BANNER =
  "{/* Generated by .github/scripts/generate-api-reference.mjs in the monorepo.\n" +
  "    Do not edit this file. Change the source it reads, then run the script. */}";

function frontmatter({ title, description, icon }) {
  return ["---", `title: ${title}`, `description: ${description}`, `icon: ${icon}`, "---", "", BANNER, ""].join("\n");
}

/**
 * One member as a heading, a signature block and its prose.
 *
 * The heading is the name and nothing else. Putting the parameter list in it
 * looked precise and was not: the first version cut at the first `)`, so a
 * handler parameter left the heading ending mid-type, and `ban`'s three-line
 * signature became a heading three lines long. The signature is in the code
 * block directly underneath either way.
 */
function member({ name, signature, doc, needs }, level = "###") {
  const callable = signature.startsWith("(") || signature.startsWith("<");
  const out = [`${level} \`${name}${callable ? "()" : ""}\``, ""];
  out.push("```ts");
  out.push(`${name}${signature}`);
  out.push("```");
  if (needs) out.push(`\nNeeds \`${needs}\`.`);
  /* The doc comments say "Needs `messaging`." themselves, because they were
     written to be read in the editor. Printing both put the sentence on the
     page twice, two lines apart. */
  const prose = needs
    ? doc.replace(new RegExp(`\\s*Needs \`${needs}\`\\.`, "g"), "").trim()
    : doc;
  if (prose) out.push(`\n${prose}`);
  /* Trailing blank line: these get spread into a list joined by one newline, and
     without it every heading sat against the paragraph above it. */
  out.push("");
  return out.join("\n");
}

/*
 * A union type is full of pipes and a pipe ends a markdown column, so
 * `string | null` rendered as two cells and pushed the row's last value off the
 * end of the table. Escaped here rather than at each call site, because every
 * cell on these pages is a type or a name and none of them wants a raw pipe.
 */
function cell(value) {
  return String(value).replace(/\|/g, "\\|");
}

/**
 * An interface as a table of its fields, with what each one is for.
 *
 * The doc comment on a field is the whole reason this is worth generating. The
 * first version printed name and type only, and `GrytBotOptions` came out as
 * ten rows of `string` — while the source had a four-line warning on `wants`
 * saying the first run's declaration is fixed from then on. That is the single
 * most useful sentence in the file and the page dropped it.
 *
 * Optionality goes on the name as a `?` rather than into a column of its own.
 * It is TypeScript's own spelling, everybody reading this has seen it, and a
 * fourth column would push the descriptions into a two-word ribbon.
 *
 * The whole doc, not the first paragraph. Cutting at the paragraph break was
 * the second version and it lost the sentence that matters most in
 * `GrytBotOptions`: `wants` explains what it is in one paragraph and then says
 * a later run asking for more gets the first run's answer. A long cell is a
 * smaller problem than a reference that quietly drops the warning.
 */
function fieldTable(members, extra) {
  return table(
    ["Field", "Type", "What it is"],
    members.map((f) => {
      const optional = f.signature.startsWith("?");
      const type = f.signature.replace(/^\??:\s*/, "") || "—";
      return [
        `\`${f.name}${optional ? "?" : ""}\``,
        `\`${type}\``,
        (extra?.(f) ?? "") + f.doc.replace(/\s+/g, " ").trim(),
      ];
    }),
  );
}

function table(headings, rows) {
  if (rows.length === 0) return "";
  return [
    `| ${headings.join(" | ")} |`,
    `| ${headings.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

/* ── The three pages ─────────────────────────────────────────────────── */

const SERVER = `${ROOT}/packages/server/src/plugins`;
const CLIENT = `${ROOT}/packages/client/src/packages/addons/src`;
const BOT = `${ROOT}/packages/bot/src`;

function serverPage() {
  const capabilities = stringArray(declaration(`${SERVER}/manifest.ts`, "PLUGIN_CAPABILITIES"));
  const labels = stringRecord(declaration(`${SERVER}/manifest.ts`, "CAPABILITY_LABELS"));
  const eventCapability = stringRecord(declaration(`${SERVER}/api.ts`, "EVENT_CAPABILITY"));
  const api = interfaceMembers(declaration(`${SERVER}/api.ts`, "GrytServerApi"));
  const events = interfaceMembers(declaration(`${SERVER}/bus.ts`, "PluginEvents"));
  const moderation = interfaceMembers(declaration(`${SERVER}/actions.ts`, "PluginModeration"));
  const messaging = interfaceMembers(declaration(`${SERVER}/messaging.ts`, "PluginMessaging"));
  const incoming = interfaceMembers(declaration(`${SERVER}/messaging.ts`, "IncomingPluginMessage"));
  const manifest = interfaceMembers(declaration(`${SERVER}/manifest.ts`, "PluginManifest"));
  const limits = numbers(`${SERVER}/messaging.ts`, [
    "MAX_TOPIC_LENGTH",
    "MAX_PAYLOAD_BYTES",
    "MAX_PAYLOAD_DEPTH",
    "MAX_PAYLOAD_NODES",
  ]);

  const out = [
    frontmatter({
      title: "Server plugin API",
      description: "Every capability, event and call a server plugin gets, generated from the source",
      icon: "Braces",
    }),
    "This is the reference. [Server plugins](/docs/server/plugins) is the page that",
    "teaches the shape, and [plugin pairs](/docs/guide/plugin-pairs) covers talking",
    "to a copy of yourself in somebody's client.",
    "",
    "A plugin starts by exporting `activate`, or a default export, and is called with",
    "the object below.",
    "",
    "```js",
    "export function activate(api) {",
    "  api.log.info(`${api.id} is up`);",
    "}",
    "```",
    "",
    "## Capabilities",
    "",
    "What a manifest may ask for. A name this server has never heard of is dropped",
    "rather than refused, so a plugin written against a newer Gryt still loads.",
    "",
    table(
      ["Capability", "What the operator reads"],
      capabilities.map((c) => [`\`${c}\``, labels.get(c)?.value ?? ""]),
    ),
    "",
    "## The manifest",
    "",
    "`manifest.json`, beside your entry point.",
    "",
    fieldTable(manifest),
    "",
    "## `api`",
    "",
    ...api.map((m) => member(m)),
    "",
    "## Events",
    "",
    "`api.on(name, handler)`. Subscribing throws if the manifest did not declare the",
    "capability behind the event, rather than failing quietly at delivery.",
    "",
    ...events.map((event) => {
      /*
       * The payload as a table rather than as its source text. Every one of
       * these is an inline type literal with doc comments inside it, and
       * flattening that onto one line put `/** The member's id … *\/` in the
       * middle of a type annotation. A field, its type and what it means are
       * three columns.
       */
      const literal = event.node?.type;
      const fields = literal && ts.isTypeLiteralNode(literal) ? interfaceMembers(literal) : [];
      const capability =
        eventCapability.get(`"${event.name}"`)?.value ?? eventCapability.get(event.name)?.value ?? "";

      return [
        `### \`${event.name}\``,
        "",
        `Needs \`${capability}\`.`,
        event.doc ? `\n${event.doc}` : "",
        "",
        "```ts",
        `api.on("${event.name}", (payload) => {})`,
        "```",
        "",
        fields.length > 0
          ? fieldTable(fields)
          : `\`\`\`ts\n// payload: ${event.signature.replace(/^:\s*/, "")}\n\`\`\``,
        "",
      ].join("\n");
    }),
    "## `api.moderation`",
    "",
    "Needs `moderation`. Reading the property throws without it, rather than handing",
    "back an object whose every call refuses.",
    "",
    "A call returns an outcome rather than throwing. A refusal is an ordinary answer",
    "— the member can moderate, or is already gone — and a plugin should log it and",
    "carry on.",
    "",
    ...moderation.map((m) => member(m)),
    "",
    "## `api.messaging`",
    "",
    "Needs `messaging`. The pipe to the client half of this plugin.",
    "",
    ...messaging.map((m) => member(m)),
    "",
    "### What a handler is given",
    "",
    fieldTable(incoming, (f) =>
      f.name === "data"
        ? "**The member's own bytes — check it.** "
        : f.name === "topic"
          ? "**The sender picked it**, within the limits below. "
          : "**From the connection**, so it cannot be faked. ",
    ),
    "",
    "### What Gryt drops before you see it",
    "",
    table(
      ["Limit", "Value"],
      [
        ["Topic length", `${limits.get("MAX_TOPIC_LENGTH") ?? "?"} characters`],
        ["Payload size", `${limits.get("MAX_PAYLOAD_BYTES") ?? "?"} bytes`],
        ["Nesting depth", limits.get("MAX_PAYLOAD_DEPTH") ?? "?"],
        ["Values in a payload", limits.get("MAX_PAYLOAD_NODES") ?? "?"],
      ],
    ),
    "",
    "A `__proto__`, `constructor` or `prototype` key is refused as well, and so is",
    "anybody sending more than thirty messages in ten seconds.",
    "",
  ];
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function clientPage() {
  const capabilities = stringArray(declaration(`${CLIENT}/capabilities.ts`, "ADDON_CAPABILITIES"));
  const labels = stringRecord(declaration(`${CLIENT}/capabilities.ts`, "CAPABILITY_LABELS"));
  const methodCapability = stringRecord(declaration(`${CLIENT}/workerProtocol.ts`, "METHOD_CAPABILITY"));
  const api = objectMembers(declaration(`${CLIENT}/addonWorker.ts`, "gryt"));
  const manifest = interfaceMembers(declaration(`${CLIENT}/types.ts`, "AddonManifest"));

  const needsFor = (path) => {
    for (const [key, entry] of methodCapability) {
      if (key.replace(/"/g, "") === path) return entry.value;
    }
    return null;
  };

  const out = [
    frontmatter({
      title: "Addon API",
      description: "Everything on the gryt object a client plugin runs against, generated from the source",
      icon: "Braces",
    }),
    "This is the reference. [Addons](/docs/client/addons) is the page that teaches",
    "the shape, and [plugin pairs](/docs/guide/plugin-pairs) covers the server half.",
    "",
    "A plugin runs in a worker of its own, and `gryt` is a global in it. There is no",
    "`window.gryt` and no addon id on any call — Gryt already knows which plugin is",
    "asking.",
    "",
    "## What is not there",
    "",
    "A worker has no page, and the rest is taken away before your module is imported:",
    "",
    "```js",
    "window        // a worker has none",
    "document",
    "localStorage",
    "indexedDB     // deleted off the prototype chain, not just off globalThis",
    "caches",
    "Worker        // no nesting out of it",
    "```",
    "",
    "Your network is not. Whatever you are granted, you can send anywhere, and that",
    "is the part worth telling people who install your plugin.",
    "",
    "## Capabilities",
    "",
    "Declared in the manifest and agreed to per addon. Both, or the call rejects and",
    "says which is missing.",
    "",
    table(
      ["Capability", "What the person reads"],
      capabilities.map((c) => [`\`${c}\``, labels.get(c)?.value ?? ""]),
    ),
    "",
    "## The manifest",
    "",
    "`manifest.json`, in your addon's folder.",
    "",
    fieldTable(manifest),
    "",
    "## `gryt`",
    "",
    ...api.flatMap((m) => {
      if (m.kind !== "group") return [member({ ...m, needs: needsFor(m.name) })];
      return [
        `### \`gryt.${m.name}\``,
        m.doc ? `\n${m.doc}` : "",
        "",
        ...(m.nested ?? []).map((n) =>
          member({ ...n, needs: needsFor(`${m.name}.${n.name}`) }, "####"),
        ),
      ];
    }),
    "",
  ];
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

function botPage() {
  const index = sourceFile(`${BOT}/index.ts`);

  /* Everything index.ts re-exports is public and nothing else is, which is a
     cleaner definition of the surface than any heuristic over the other files.
     Kept in the order it is exported: that order is somebody's decision about
     what matters, and sorting it would throw that away. */
  const exports = [];
  for (const statement of index.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const from = statement.moduleSpecifier?.text?.replace(/^\.\//, "").replace(/\.ts$/, "");
    for (const element of statement.exportClause.elements) {
      exports.push({ name: element.name.text, from, isType: statement.isTypeOnly || element.isTypeOnly });
    }
  }

  const rendered = [];
  for (const entry of exports) {
    const path = `${BOT}/${entry.from}.ts`;
    const decl = declarations(sourceFile(path)).get(entry.name);
    if (!decl) continue;

    const doc = docOf(decl.grytStatement ?? decl);

    if (ts.isInterfaceDeclaration(decl)) {
      rendered.push(
        [
          `### \`${entry.name}\``,
          doc ? `\n${doc}` : "",
          "",
          fieldTable(interfaceMembers(decl)),
          "",
        ].join("\n"),
      );
    } else if (ts.isClassDeclaration(decl)) {
      const methods = decl.members
        .filter((m) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name))
        .filter((m) => !m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.PrivateKeyword))
        .filter((m) => !m.name.text.startsWith("#"));
      rendered.push(
        [
          `### \`${entry.name}\``,
          doc ? `\n${doc}` : "",
          "",
          ...methods.map((m) => {
            const params = m.parameters.map(text).join(", ");
            const returns = m.type ? `: ${text(m.type)}` : "";
            const mdoc = docOf(m);
            return [
              `#### \`${m.name.text}()\``,
              "",
              "```ts",
              `${m.name.text}(${params})${returns}`,
              "```",
              mdoc ? `\n${mdoc}` : "",
            ].join("\n");
          }),
        ].join("\n"),
      );
    } else {
      const signature = ts.isFunctionDeclaration(decl)
        ? `${entry.name}(${decl.parameters.map(text).join(", ")})${decl.type ? `: ${text(decl.type)}` : ""}`
        : text(decl);
      rendered.push(
        [`### \`${entry.name}\``, doc ? `\n${doc}` : "", "", "```ts", signature, "```"].join("\n"),
      );
    }
  }

  return (
    [
      frontmatter({
        title: "API reference",
        description: "Everything @gryt/bot exports, generated from the source",
        icon: "Braces",
      }),
      "This is the reference. [Writing a bot](/docs/bot) is the page that teaches the",
      "shape: the handshake, waiting to be approved, and what a bot does when an admin",
      "says no.",
      "",
      "Everything below is exported from `@gryt/bot`. Nothing else in the package is",
      "public.",
      "",
      "```ts",
      `import { ${exports.filter((e) => !e.isType).map((e) => e.name).join(", ")} } from "@gryt/bot";`,
      "```",
      "",
      ...rendered,
      "",
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n") + "\n"
  );
}

/* ── Run ─────────────────────────────────────────────────────────────── */

const PAGES = [
  { path: "packages/docs/content/docs/server/plugin-api.mdx", build: serverPage },
  { path: "packages/docs/content/docs/client/addon-api.mdx", build: clientPage },
  { path: "packages/docs/content/docs/bot/api-reference.mdx", build: botPage },
];

/*
 * A page fumadocs is not told about does not appear in the sidebar. It renders
 * at its URL, so nothing 404s and nothing fails — it is simply not findable,
 * which is the whole point of a reference. `meta.json` is hand-ordered, so this
 * checks rather than writes: where a page sits among its neighbours is somebody's
 * decision and not this script's.
 */
function checkListed(page) {
  const section = dirname(`${ROOT}/${page.path}`);
  const slug = page.path.split("/").pop().replace(/\.mdx$/, "");
  let meta;
  try {
    meta = JSON.parse(readFileSync(`${section}/meta.json`, "utf8"));
  } catch {
    return `no meta.json beside ${page.path}`;
  }
  return meta.pages?.includes(slug)
    ? null
    : `${section.slice(ROOT.length + 1)}/meta.json does not list "${slug}"`;
}

const unlisted = PAGES.map(checkListed).filter(Boolean);
if (unlisted.length > 0) {
  console.error("generate-api-reference: a generated page is not in the sidebar.\n");
  for (const problem of unlisted) console.error(`  ${problem}`);
  console.error("\nAdd it to that file's `pages` array, where you want it to appear.\n");
  process.exit(1);
}

const stale = [];

for (const page of PAGES) {
  const full = `${ROOT}/${page.path}`;
  const next = page.build();

  if (CHECK) {
    let current = null;
    try {
      current = readFileSync(full, "utf8");
    } catch {
      /* missing counts as stale */
    }
    if (current !== next) stale.push(page.path);
    continue;
  }

  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, next);
  console.log(`wrote ${page.path}`);
}

if (!CHECK) process.exit(0);

if (stale.length === 0) {
  console.log(`generate-api-reference: ${PAGES.length} pages match the source.`);
  process.exit(0);
}

console.error("generate-api-reference: these pages no longer match the source they document.\n");
for (const path of stale) console.error(`  ${path}`);
console.error(
  "\nSomething in the server, client or bot API moved and the page was not regenerated.\n" +
    "Run this in a monorepo checkout, then commit packages/docs and bump the gitlink:\n\n" +
    "  node .github/scripts/generate-api-reference.mjs\n",
);
process.exit(1);
