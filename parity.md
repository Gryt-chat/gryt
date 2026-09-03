# One implementation, two apps

The desktop app and the phone app should not diverge in method or choice. Where
they both do something, they should do it the same way, with the same code.
`@gryt/core` is where that code goes, and this file is the plan for getting the
rest of it there.

## What the two apps actually look like

Measured on 2026-09-03 against `origin/main` in both repos, by pairing every
module on the symbols it exports rather than on its filename. Pairing by name
matches `permissions.ts` to `messageAbilities.ts`, which are unrelated.

337 files in the client, 180 in mobile. Of those, about a dozen pairs are
genuinely the same thing:

| Client | Mobile | Shared exports |
|---|---|---|
| `settings/channelPermissionRules` | `permissions/channelRules` | 10 of 15 |
| `common/utils/url` | `servers/address` | 9 of 11 |
| `lib/reports/report` | `feedback/report` | 7 of 7 |
| `common/auth/identity-claims` | `identity/identityClaims` | 4 of 5 |
| `lib/reports/submit` | `feedback/submit` | 3 of 3 |
| `settings/hooks/useOfficialServer` | `servers/useOfficialServer` | 3 of 3 |
| `socket/hooks/useDirectMessages` | `connection/directMessages` | 3 of 5 |
| `common/utils/randomName` | `profile/randomName` | 2 of 2 |
| `socket/hooks/useConversationSealing` | `connection/useConversationSealing` | 2 of 2 |
| `socket/hooks/useCalls` | `connection/calls` | 2 of 3 |
| `socket/components/memberGroups` | `connection/roleGroups` | 2 of 3 |

Two things that survey settled, both of which had been assumed the other way:

**Mobile is not behind on crypto.** Both apps depend on `@gryt/crypto@^0.2.0`,
the same version. Mobile touches crypto in 16 files to the client's 8, and it
has full conversation sealing: `useConversationSealing`, `sealedText`,
`sealedAttachments`, `memberKeys`, `publishDmKey`.

**A matching export list is not a matching implementation.** `report.ts` scored
7 of 7 and was still two different files: different diagnostic fields, most of
which differ for good reason, and `MESSAGE_MAX` at 8000 on one side and 4000 on
the other with nothing recording why.

## What belongs in the package

Two questions, and a module needs both answers to be yes:

- Would it compile with no DOM and no React Native?
- Would both apps otherwise need a copy?

The first is enforced rather than remembered: `@gryt/core`'s tsconfig leaves
`DOM` out of `lib`, so `document`, `window` and `localStorage` fail to
typecheck. The second is a judgement call, and `check-public-surface.mjs` is
what keeps it honest. It fails on an export that went missing, and on one that
appeared without being listed.

Fetching stays in the apps. The two reach a server differently and neither way
belongs in a package with no platform, so the package decides what a preview
means and each app goes and gets it. Artwork stays too: a brand logo is a React
component on one side and an SVG path on the other.

## The sequence

Each step is a release of `@gryt/core` and a version bump in both apps. Both
apps pin the same version, always. Two apps on different versions are two
implementations again, which is where `@gryt/voice` is right now: `0.4.4` in the
client and `^0.3.2` in mobile.

**Done — 0.1.0.** Reports and links.

**Next — the mechanical ones.** `randomName`, `identity-claims`, `url` and
`servers/address`, `channelPermissionRules`. High symbol overlap, no platform
coupling, and the differences are small enough to read in one sitting. Each one
forces a decision where the two disagree. That decision goes in the file as a
comment, not in the pull request, where nobody reads it again.

**Then — the ones with a hook around them.** `useDirectMessages`, `useCalls`,
`useConversationSealing`, `memberGroups`, `useOfficialServer`. The logic is
shared. The React around it isn't. Split each into a pure part that moves and a
hook that stays, the way `@gryt/voice` did.

**Then — the two real divergences.** Neither is an extraction and both need
deciding before anything moves:

- *Markdown.* The client parses with remark and two custom plugins. Mobile
  hand-wrote a 571-line parser, because React Native can't render HTML and a
  `View` can't go inside a `Text`. One parser producing an AST that both render
  is the 1:1 answer, and it means picking which of the two survives.
- *Moderation.* Mobile has a `moderation/` module: `bans`, `banOptions`,
  `memberActions`, `moderationAbilities`, `useModeration`, each with tests. The
  client has `useAdminActions` and a `ServerBansTab`, which is thinner and a
  different shape. That's the gap running the other way, and closing it is
  desktop work rather than a move.

## Rules while this is going on

**Both apps pin the same version of every `@gryt/*` package.** If one needs a
version the other can't take yet, that's the thing to fix.

**A copy that stays a copy gets a comment saying so**, naming the other file.
That's what `MESSAGE_MAX` never had, and it's why it sat at two values for as
long as it did.

**When the two disagree, write down which won**, in the shared file. Write the
why down too. Without it the next person re-argues the whole thing from
nothing.

## Still open

- `@gryt/core` has no repository yet. The package is built and committed
  locally; creating `Gryt-chat/core` and pushing it is the first step.
- No Vikunja tasks exist for any of the above. They should.
- The DNS gap in the server's link-preview fetcher: `checkPreviewUrl` resolves a
  hostname to validate it and the connection resolves it again, so a name that
  answers differently the second time is not covered.
