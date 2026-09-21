import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compare, ingressRules, parseCaddyfile, tokenize } from "./check-ingress.mjs";

const real = parseCaddyfile(readFileSync(new URL("./Caddyfile", import.meta.url), "utf8"));

test("every site in the Caddyfile has one upstream and a unique name", () => {
  assert.ok(real.sites.length > 0);
  for (const site of real.sites) assert.equal(site.upstreams.length, 1, site.host);
  assert.equal(new Set(real.sites.map((s) => s.host)).size, real.sites.length);
});

// A name outside the wildcards gets a certificate of its own, which puts it in the CT logs.
test("every site is covered by one of the wildcard certificates", () => {
  for (const { host } of real.sites) {
    const covered = real.wildcards.some((w) => host.endsWith(w.slice(1)) && host.split(".").length === w.split(".").length);
    assert.ok(covered, `${host} isn't under ${real.wildcards.join(" or ")}`);
  }
});

test("placeholders and quoted braces don't open blocks", () => {
  const caddyfile = `
{
	servers {
		protocols h1 h2
	}
}
(upstream) {
	reverse_proxy {args[0]} {
		header_up X-Test "{ not a block }"
	}
}
# a comment { with braces
a.example.com, b.example.com {
	import upstream http://box:1 # trailing
}
c.example.com {
	reverse_proxy http://box:2
}
`;
  const { sites } = parseCaddyfile(caddyfile);
  assert.deepEqual(
    sites.map((s) => [s.host, s.upstreams]),
    [
      ["a.example.com", ["http://box:1"]],
      ["b.example.com", ["http://box:1"]],
      ["c.example.com", ["http://box:2"]],
    ],
  );
  assert.equal(tokenize(`respond "a\\"b" 421`)[1].value, 'a"b');
});

test("an unclosed block is an error rather than a pass", () => {
  assert.throws(() => parseCaddyfile("a.example.com {\n\timport upstream http://box:1\n"));
});

const sites = [
  { host: "a.gryt.chat", upstreams: ["http://box:1"], line: 1 },
  { host: "b.gryt.chat", upstreams: ["http://box:2"], line: 4 },
];

test("matching routes pass", () => {
  const rules = [
    { hostname: "a.gryt.chat", path: "", service: "http://box:1/" },
    { hostname: "b.gryt.chat", path: "", service: "http://box:2" },
    { hostname: "", path: "", service: "http_status:404" },
  ];
  const result = compare(sites, rules);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok.length, 2);
});

test("a changed port, a missing route and a path rule are problems", () => {
  const rules = [
    { hostname: "a.gryt.chat", path: "", service: "http://box:9" },
    { hostname: "c.gryt.chat", path: "^/x", service: "http://box:3" },
  ];
  const { problems } = compare([...sites, { host: "c.gryt.chat", upstreams: ["http://box:3"], line: 7 }], rules);
  assert.match(problems[0], /a\.gryt\.chat: the tunnel sends it to http:\/\/box:9/);
  assert.match(problems[1], /b\.gryt\.chat: .* no route/);
  assert.match(problems[2], /c\.gryt\.chat: .* by path/);
});

test("the first matching rule wins, as in cloudflared", () => {
  const rules = [
    { hostname: "*.gryt.chat", path: "", service: "http://box:1" },
    { hostname: "b.gryt.chat", path: "", service: "http://box:2" },
  ];
  const { problems } = compare(sites, rules);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /b\.gryt\.chat: the tunnel sends it to http:\/\/box:1/);
});

test("a Gryt route to the same machine that isn't proxied gets a note, other zones don't", () => {
  const rules = [
    { hostname: "a.gryt.chat", path: "", service: "http://box:1" },
    { hostname: "b.gryt.chat", path: "", service: "http://box:2" },
    { hostname: "new.gryt.chat", path: "", service: "http://box:5" },
    { hostname: "elsewhere.gryt.chat", path: "", service: "http://pi:8080" },
    { hostname: "other.example.com", path: "", service: "http://box:6" },
  ];
  const { notes, problems } = compare(sites, rules);
  assert.deepEqual(problems, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^new\.gryt\.chat/);
});

test("both shapes of ingress JSON are read", () => {
  const rule = { hostname: "A.gryt.chat", path: null, service: "http://box:1" };
  const expected = [{ hostname: "a.gryt.chat", path: "", service: "http://box:1" }];
  assert.deepEqual(ingressRules({ version: 1, config: { ingress: [rule] } }), expected);
  assert.deepEqual(ingressRules({ success: true, result: { config: { ingress: [rule] } } }), expected);
  assert.throws(() => ingressRules({ config: {} }));
});
