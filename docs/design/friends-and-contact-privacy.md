# Friends, and who can message or call me

GRYT-1468. Read against `origin/main` on 2026-09-25: server `5bc22f7`, client
`5b76ebf`, crypto `d9ae4f7`, auth `b9e634d`, docs `82bc82e`.

A design for Sivert to decide on. No code ships from it. It covers three things
he asked for: a "who can send me messages" setting, a "who can call me"
setting, and a friends list that a "what are my friends doing right now?"
dashboard could be built on later.

The hard part is identity. A direct message lives on one server, between two
members of it. A friend is a person, and people are on several servers. A local
identity uses a separate key on every server so that no two servers can tell
it's the same person. So a friends list that spans servers needs something to
carry the person across, and whatever carries them could also link them. Most
of this page is about keeping that link between the two friends and nobody
else.

## Recommendation

**Stage 1 is two settings per server, enforced by the server, plus closing
three gaps in blocking.** No friends yet. It's small, and it's useful on its
own.

- **Who can send me messages:** Everyone on this server (default, and what
  happens today) or Nobody. "Friends only" joins the list in stage 2.
- **Who can call me:** Everyone who can message me, People I've replied to
  (default), or Nobody.
- One default in the app's settings, which the client writes to every server
  you're on, and an override per server.
- Rings, typing indicators and one-to-one call rooms start respecting blocks.
  Messages already do. Details under [Blocking](#blocking).

**Stage 2 is mutual friends, made on a server, kept in a list only you can
read.** You send a request to somebody on a server you're both on. If they say
yes, that server records the pair so it can enforce "Friends only". Your own
copy of the list is sealed under a key worked out from your 24 words and kept
on your Gryt account, next to the message key backup. Keycloak holds
ciphertext it can't grind, and no server sees anything beyond the friendships
between its own members. Local identities get friends per server and no more.

**Stage 3 is the dashboard, and it exposes the most.** I'd leave it until
stage 2 has been used for a while. It needs an invisible status first, and a
way to publish presence to friends that doesn't tell anybody central who your
friends are.

## What exists today

### Direct messages

A DM belongs to the server it was opened on. `dm:open` in
`packages/server/src/socket/handlers/dm.ts` (line 148) lets any member open a
one-to-one with any other active member, as long as:

- the sender holds `send_direct_messages` (`constants/permissions.ts`),
- the server hasn't set `server_config.allow_dms` off,
- the target isn't a bot (`isBotIdentity`), and
- neither of them has blocked the other (`eitherHasBlocked`).

Failing the block check gets the same answer as somebody who isn't a member
("That person is not a member of this server"), so a blocked person can't tell
they were blocked.

An empty conversation shows only in the opener's list. The other person hears
about it with the first message (GRYT-1121).

Group DMs (`dm:group:create`, line 222, and `dm:group:add`, line 302) need
`create_groups` as well, and run the same block check on every member. There's
no group owner. Anybody in a group can add people.

Once a conversation exists, messages go through the same `chat:*` events as
channels, gated by `resolveConversationAccess` in
`socket/utils/conversationAccess.ts`. The gate there is membership. Nothing
checks whether the recipient still wants to hear from the sender, apart from
the block filter at delivery.

There's no request flow, so nobody accepts a DM before it arrives. Hiding a
conversation is per device and lives in the client (GRYT-1379,
`client/.../components/hideConversation.tsx`).

The public roadmap (`docs/content/docs/about/roadmap.mdx`, "Direct messages
and social") is behind. It lists group DMs and blocking as planned, and says
whoever runs the server can read DMs. Groups and blocking have both shipped,
and DMs are sealed now. It also lists "Friend list / friend requests" as
planned, which is this page.

### Calls

A DM call is a ring plus a voice room. `call:ring` in
`socket/handlers/calls.ts` (line 61) needs `send_direct_messages`,
`start_calls` and `join_voice`, and a conversation the caller is in. It rings
every other member of the conversation on every device they have open, for a
fixed time. Answering is joining the SFU room for the conversation, and there's
no `call:accept`. `voice.ts` (line 347) lets anybody into that room who is a
member of the conversation.

**Rings don't check blocks.** If two people had a one-to-one before one blocked
the other, the blocked one can still ring. Their messages are dropped, but the
phone rings. They can also join the call room, since `voice.ts` checks
membership only. `blocks.test.ts` has thirteen cases covering messages, history
and groups, and none for calls. `callRinging.test.ts` never mentions blocks.

### Blocking

Blocking exists, per server, from GRYT-1342 and GRYT-1379.

- `socket/handlers/blocks.ts`: `user:block`, `user:unblock`,
  `user:blocks:list`. No permission needed, and it works on somebody who
  outranks you.
- `db/sqlite/blocks.ts`: a `blocks` table keyed on Gryt user ids rather than
  server ids, so a block survives the person leaving and rejoining.
- `chat.ts` drops a blocked sender's messages, edits and reactions before
  delivery (`deliverableClientIds`, line 243), and drops them from history on
  fetch. The sender keeps their own copy, so nothing tells them.
- DMs and groups refuse in both directions, as above.
- A block on a guest carries over when they move to an account (GRYT-1249).
- The client has `useBlocks` (`client/.../hooks/useBlocks.ts`) and a Block
  entry in the member list.

The gaps are rings, the call room and typing indicators. `typing.ts` checks
conversation access but not blocks, so a blocked person typing in an old
one-to-one still shows "typing…" to the person who blocked them.

Blocks are per server. The same person on another server isn't blocked there.

### Presence

Presence is per server and comes from open sockets, in `buildMemberList` in
`socket/utils/clients.ts`:

- `status` is `online`, `in_voice`, `afk` or `offline`. `afk` comes from the
  client (`voice:state:update`). There's no invisible and no do-not-disturb.
- `activity` is free text somebody sets (`presence:activity` in `members.ts`,
  gated by `set_activity`). It exists only while they're connected.
- `voiceChannelId` says which channel they're in. A DM call room is blanked
  (`publicVoiceRoom`), and so is a channel the viewer can't see.
- `streamID` says whether they're sharing a screen, and `lastSeen` when they
  were last here.

Every member with `view_members` sees all of it for everybody on that server.
Nothing crosses to another server.

### Identity

From `docs/content/docs/host/identity.mdx` and `server/src/auth/identity.ts`:

- **Account.** The certificate's `sub` is the Keycloak user. It's stored as
  `gryt_user_id` and it's the same on every server, so two servers comparing
  notes can already tell an account holder is the same person. Other members
  can't. They see a fingerprint, an HMAC of the id keyed on that server's
  `JWT_SECRET` (`memberIdentity.ts`), which differs per server.
- **Local.** `gryt_user_id` is `local:` plus a thumbprint of a key derived for
  that server from the 24 words. Two servers see two unrelated ids, which is
  what stops them telling it's the same person.

### Encryption, and where things are kept

From `docs/content/docs/about/security.mdx` and
`packages/crypto/docs/message-security.md`:

- DMs are sealed on the sending device. The server stores an envelope and sees
  who talks to whom, and when.
- Each device derives a DM key per server from the seed (the 24 words), and
  publishes it signed by the identity key it joined with. `id.gryt.chat` isn't
  involved, on purpose: a certificate listing your servers would be the map
  Gryt is built not to hand anybody.
- The seed reaches a second device as a sealed bundle in the Keycloak
  attribute `grytMessageVault` (`client/.../common/src/auth/message-vault.ts`,
  `auth/bootstrap/gryt-user-profile.json`, `view: [user]`, max 8192
  characters). That bundle is sealed under a password, which is why it can be
  ground offline. Pairing (a QR or six digits between two devices) is the
  planned way round that.

The rule this has to meet is Sivert's from 2026-09-23: the server holds nothing
that could take over an account, not even something slow to crack. A friends
list can't take over an account. It is a social graph, though, so the same
thinking applies: hold as little as possible, and seal what has to be held.

## Who can message me, and who can call me

### The options

A DM lives on one server, so "people who share a server with me" means the
same as "everyone on this server". The server only ever sees its own members.
That option falls away.

"People who share a role with me" sounds useful, but every member holds the
default role, so it would mean everyone unless the person picked roles by hand.
That's a lot of settings screen for a rare case, and I'd leave it out. A server
owner who wants something like it can already take `send_direct_messages` away
from a role.

That leaves these:

| Setting | Options | Default |
|---|---|---|
| Who can send me messages | Everyone on this server, Friends only (stage 2), Nobody | Everyone on this server |
| Who can call me | Everyone who can message me, People I've replied to, Friends only (stage 2), Nobody | People I've replied to |
| Who can send me friend requests (stage 2) | Everyone on this server, Nobody | Everyone on this server |

**People I've replied to** means somebody in a conversation where you've sent
at least one message. The server can tell, because it stores the sender of
every envelope (`messages.sender_server_id`) even when it can't read the
contents. So a stranger can message you, but can't make your phone ring until
you've answered once. In a group, having posted in it counts.

**Why that default for calls.** Messages default to what happens today, so
nobody finds out they can't be reached. Calls are louder. A ring interrupts,
and a ring from a stranger who opened a DM a minute ago is what people will
want this setting to stop. This default does change current behaviour: today
anybody who can message you can ring you.

Calls can't be looser than messages. A ring happens inside a conversation, so
"Nobody" for messages means there's no conversation to ring from. The client
should grey out call options that are looser than the message setting, and the
server should treat the call setting as the stricter of the two.

### The server has to enforce it

A setting that lives only in the client stops nothing. A modified client
ignores it, and so does a bot written against the socket API. So the server
checks it here:

| Where | What gets checked |
|---|---|
| `dm:open` | the target's message setting |
| `dm:group:create`, `dm:group:add` | the message setting of each person being added |
| `chat:send` into a one-to-one | the recipient's message setting, see [existing conversations](#existing-conversations) |
| `call:ring` | each recipient's call setting |
| `friend:request` (stage 2) | the target's friend request setting |

For a ring in a group, the server skips the people who don't take calls from
the caller and rings the rest. For a one-to-one, it refuses.

What the sender hears back:

- **When a setting says no:** a plain refusal, like "They're not taking
  messages from you on this server." That tells them what the setting is,
  which is fine for a preference.
- **When a block says no:** the answer somebody who left the server gets, as
  today. For a ring, it rings on the caller's side until it times out, and
  nobody on the other side hears it.

### Where it's stored

On each server, in a new table next to `blocks`, keyed on the Gryt user id so
it survives leaving and rejoining:

```sql
CREATE TABLE contact_prefs (
  gryt_user_id    TEXT PRIMARY KEY,
  messages        TEXT NOT NULL,  -- 'everyone' | 'friends' | 'nobody'
  calls           TEXT NOT NULL,  -- 'messageable' | 'replied' | 'friends' | 'nobody'
  friend_requests TEXT NOT NULL,  -- 'everyone' | 'nobody'
  updated_at      TEXT NOT NULL
);
```

No row means the defaults. That keeps the table empty for everybody who never
opens the setting, and changing a default later is a code change rather than a
migration.

**Per server or global.** It has to be stored per server, because each server
enforces it. The only question is what the settings screen shows. I'd have one
default under **Settings → Privacy**, which the client writes to every server
it connects to that has no override, and an override per server in that
server's menu.

Writing the same value to every server doesn't link a local identity. Each
server learns one of a handful of values that most people share.

One catch: a server you haven't opened since changing the default keeps the
old value until you next connect. The settings screen should say so, something
like "Applies to each server the next time you connect to it".

### Existing conversations

When somebody makes the setting stricter, what happens to conversations
already open? Three ways:

1. **Everything open keeps working.** Easy, but somebody who switches to
   "Nobody" to get away from a person finds it did nothing.
2. **Everything is gated.** Switching to "Friends only" cuts off somebody
   you've talked to for months, which you probably didn't mean.
3. **Conversations you've replied in keep working.** You said yes to those by
   answering. Everything else is gated.

I'd go with 3. Block covers the case where you replied and now regret it.

Group DMs work differently. Once you're in a group, everybody in it can post,
and the way out is **Leave**. The setting decides whether somebody can put you
in a group. It doesn't decide what gets said in one.

### Moderators, owners and bots

**No bypass for moderators or owners.** Blocking already works against
somebody who outranks you, and the comment in `blocks.ts` says that's on
purpose. A setting that anyone with `kick_members` could ignore would fail
against the people best placed to lean on somebody. Moderators have channels,
mutes, kicks and bans, and none of those need a DM.

**Bots** can't be messaged (`dm.ts`) and have no way to DM a person today. If
that's ever added, a bot counts as not a friend and goes through the same
check.

**Server-wide switches still win.** `allow_dms = false` turns DMs off for
everybody, and a role without `send_direct_messages` still can't send. The
personal setting can only narrow what the server already allows.

## Friends

### The model

Three shapes:

- **Mutual, with a request.** One sends, the other accepts. Discord and Steam
  work like this.
- **One-way contacts.** You add somebody and they don't find out, like a phone
  contact. "Friends only" would mean "people I've added".
- **One-way follow.** Twitter's shape. It fits a public profile, which Gryt
  doesn't have.

I'd pick mutual. It's what people expect from the word "friends", and the
dashboard needs it, since showing somebody what you're doing needs their yes
as well as yours. Contacts would be enough for the settings, but they'd need
replacing as soon as stage 3 starts.

A request carries nothing but "they'd like to be friends". It shows in a
**Requests** list with Accept and Ignore. Ignoring doesn't tell the sender, and
their request stays pending on their side until they withdraw it. A request to
somebody who has blocked you is dropped silently.

### Where a friendship is made

**On a server you share.** That's where people meet in Gryt, and it's the only
place two clients can find each other without a directory. The request goes
over that server's socket (`friend:request`, `friend:accept`,
`friend:remove`), and the server stores the pair once it's accepted:

```sql
CREATE TABLE friendships (
  a_gryt_user_id TEXT NOT NULL,  -- the smaller of the two, so each pair has one row
  b_gryt_user_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (a_gryt_user_id, b_gryt_user_id)
);
```

The server needs that row to enforce "Friends only", and it's the least it can
hold for that: a friendship between two of its own members, which it could
mostly guess already from who DMs whom. Pending requests go in a second small
table. I'd expire them after 30 days.

**No friend codes and no search by name** in stage 2. Search needs a directory
of everybody, and Gryt doesn't have one. A friend code pasted to somebody out
of band would work without a directory, but it still needs somewhere central
to resolve the code, and that's a later decision.

### Your own list

The server rows are enough to enforce the setting. They aren't enough for a
Friends page. A page listing all your friends would have to ask every server
you're on and merge the answers, and a friend you met on a server that has
since shut down would vanish.

So each person also keeps their own list. There are three places it could
live:

| Where | Who can read it | Cost |
|---|---|---|
| **The account service, in plain** (`id.gryt.chat` or Keycloak) | Whoever runs auth sees everyone's whole friend graph, across every server | Easiest. Discord's model |
| **The account service, sealed** (a Keycloak attribute, like `grytMessageVault`) | Only you. Keycloak sees a blob, its size and when it changes | Needs the seed on the device, the same as reading a DM |
| **Only on your devices** | Nobody | A new device starts with an empty list |

**I'd seal it and keep it on the account.** The key comes from the seed through
HKDF under its own label (something like `gryt-friends:v1`), so it has the
seed's full 256 bits behind it. Unlike the message key backup, there's no
password to grind. Somebody with the Keycloak database gets a blob they can't
open, however long they spend on it. That clears the "server holds nothing
that could take over an account" bar with room to spare.

Syncing works the way the message vault does: read the attribute, merge, write
it back. The Account API replaces the whole representation rather than
patching it, so `message-vault.ts` already reads before it writes, and a
friends list needs the same care. Two devices adding friends at the same time
need a merge rather than last-write-wins. If each friendship is a set entry
with an added-at and a removed-at time, the merge has no conflicts.

Each entry holds roughly a random friendship id, the nickname when you became
friends, the servers where you know them with their server user id on each,
and a pairwise secret (see below). By my rough count the 8192-character cap on
the attribute fits around 30 friends, which is too few. Either raise the cap in
`gryt-user-profile.json` or spread the list over several attributes. That needs
measuring against a real Keycloak before choosing.

### Seeing the same friend on another server

Say you became friends with Kari on server A, and you're both on server B too.
Server B has no idea you're friends, and neither does your client, because on
B she has a different server user id and a different fingerprint.

Three ways to handle it:

1. **Don't.** You're friends on A. On B you send another request. Simple and
   private, and a bit annoying.
2. **Ask server B.** Your client sends B the account ids of your friends and
   asks which are members. That tells B your whole friend list, including
   people who have never been near B, and it only works for accounts. I'd rule
   it out.
3. **Pairwise tags.** When you become friends, the two clients agree a secret
   inside a sealed DM. On each server, each client publishes a tag per friend,
   `HMAC(secret, server scope || "a" or "b")`. Your client works out the tag
   Kari would publish on B and looks for it. The server sees a handful of
   random-looking values per member. It can't pair Kari's tag with yours,
   since each side uses its own label, and it can't match tags across servers,
   since the scope is in the HMAC. Once your client has found her, it records
   the friendship on B like any other.

Option 3 gives cross-server friends without breaking the promise to servers.
It does tell *Kari* that you're the same person on A and B, but she's your
friend and you agreed to that. It also shows each server how many friends
somebody has, which padding to a fixed count would hide.

It's more machinery than stage 2 needs, though. I'd start with option 1 and
add tags as stage 2b.

### Local identities

A local identity has a seed, so it can seal a list. It has no account, so
there's nowhere central to keep it, and that's the reason to have one.

- **Friends per server work the same as for accounts.** The server stores the
  pair and enforces "Friends only". Nothing about that links the person
  anywhere else.
- **The personal list stays on the device** in stage 2. A second device using
  the same 24 words gets the same identity but not the list. It fills back in
  from each server's friendship rows as the client connects.
- **Pairwise tags (2b) work for local identities too,** and they're the only
  cross-server option that does. They never hand a server anything it could
  link.

### Removing and blocking

**Remove friend** deletes the row on the server and marks the entry removed in
your list. The other person's list keeps the entry until their client next
talks to that server and finds the row gone. Nothing else tells them.

**Block** removes the friendship on that server as well, and refuses any new
request from them.

### Who can see what

| | Stage 1 | Stage 2 |
|---|---|---|
| A server | Your contact settings | Also friendships between its own members, and pending requests |
| The account service | Nothing new | A sealed blob, its size, and when it changes |
| Other members | Nothing, until a DM or ring is refused | Nothing. Friendships aren't shown on profiles |
| Your friend | n/a | That you're friends. With tags (2b), that you're the same person on servers you share |

Whoever runs a server can read its `friendships` table directly. That's the
cost of a "Friends only" the server enforces, and the docs should say so
plainly when this ships.

## Blocking

Blocking exists, so this section is about the gaps above. All three belong in
stage 1:

1. **`call:ring` skips anybody who has blocked the caller.** In a one-to-one
   the ring runs out on the caller's side and the other person hears nothing.
2. **The call room refuses a blocked pair in a one-to-one.** `voice.ts` lets
   people into a conversation room on membership alone. A group call room
   stays as it is, because in a group a block hides messages and doesn't take
   anybody out of the room. That matches channels (`blocks.test.ts`, "does not
   stop the blocker being heard").
3. **Typing indicators** go through the same filter as messages.

**Blocks stay per server.** A block that followed somebody to other servers
would need the same recognition as friends, and tags only exist between
friends. The other route is the server giving you the blocked person's account
id, which lets you recognise and follow them elsewhere. That's a worse leak
than the harm it prevents. If cross-server blocking comes up later, a sealed
block list on the account is probably the shape, and it would still need some
way to recognise the person first.

## Friends dashboard (later)

This is stage 3, and only sketched here.

**What it could show:** for each friend, whether they're online, away or in
voice, which server and channel they're in, their activity text, and whether
they're streaming. There's no game detection in Gryt today, so "what game"
means the activity text until somebody builds that.

**On servers you share,** all of it is already visible to you as a member. The
dashboard only gathers it from each server's member list, which exposes
nothing new.

**On servers you don't share,** the friend's client would have to publish its
status somewhere you can read. A relay on the account service could carry
status sealed per friend. It couldn't read the status, but it would see who
posts, who fetches, and when, which comes close to the friend graph again. A
mailbox keyed by the pairwise tag rather than the account id helps. The relay
still sees addresses and timing.

**Switches it would need before it ships:**

- **Invisible**, as a status. It doesn't exist today, and the member list
  reports whatever the sockets say.
- **Share my status with friends:** on or off.
- **Show which server I'm on:** off by default. Server names say a lot about a
  person.
- **Show my voice channel:** off by default.
- **Hide from this friend**, per friend, without unfriending them.

## Staged build

Rough sizes, from the files each stage touches. Review-required paths are
marked, per `.claude/CLAUDE.md`.

### Stage 1: contact settings and block gaps

| Repo | What | Size | Review |
|---|---|---|---|
| server | `contact_prefs` table and queries (`src/db/sqlite/`) | ~80 lines | **required**, `src/db/**` |
| server | Setting checks in `dm.ts`, `chat.ts`, `calls.ts`. Block checks in `calls.ts`, `voice.ts`, `typing.ts`. `contact:prefs:get` and `contact:prefs:set` events | ~250 lines, plus tests | normal |
| client | **Settings → Privacy** with the two settings, the per-server override in the server menu, the refusal messages, writing the default on connect | ~300 lines | normal |
| docs | A privacy section for DMs, and fixing the stale roadmap section | ~60 lines | normal |
| mobile | Same settings | own task | mobile stays behind |

Two PRs, server and client, cross-linked, with the server released first. The
block gaps go in the server PR as their own commits, or in a PR of their own if
the settings take a while.

### Stage 2: friends

| Repo | What | Size | Review |
|---|---|---|---|
| server | `friendships` and `friend_requests` tables | ~120 lines | **required**, `src/db/**` |
| server | `friend:*` events, and "Friends only" in the stage 1 checks | ~250 lines, plus tests | normal |
| client | Sealing and opening the list, with the key from the seed | ~150 lines | **required**, `common/src/auth/**` |
| client | Friends page in the DM space, requests, Add friend on a member's card | ~500 lines | normal |
| auth | A `grytFriends` attribute in `bootstrap/gryt-user-profile.json`, applied through the admin API the way `keycloak-user-profile` does it | ~20 lines | **required**, `packages/auth/**` |
| crypto | Only if the HKDF label and the sealing move into `@gryt/crypto` | ~60 lines | **required**, published to npm |

I'd keep the sealing in the client's `common/src/auth` next to
`identity-vault.ts`, and stay out of `@gryt/crypto` until mobile needs it. A
published version can't be taken back, and in stage 2 only the web and desktop
client read the list.

Stage 2b, pairwise tags, touches the same places again: a column for each
member's tags on the server, the tag maths in `common/src/auth`, and a matching
pass when the member list arrives.

### Stage 3: dashboard

| Repo | What | Review |
|---|---|---|
| server | Invisible status in `buildMemberList` and `memberStateHash` | normal |
| client | The dashboard, built from the member lists of shared servers | normal |
| auth | A presence relay for servers you don't share, if that part is wanted | **required** |

## Decisions for Sivert

1. **What does "friend" mean?**
   - a. Mutual, with a request the other person accepts
   - b. One-way contacts, which the other person never hears about
   - c. Contacts for the settings now, mutual later for the dashboard

   Recommend **a**. The dashboard shares a friend's activity, which needs their
   yes, and switching models between stages means migrating everyone's list.

2. **Where does your own friends list live?**
   - a. On the account service in plain, like Discord
   - b. Sealed on the Keycloak account, under a key from the 24 words
   - c. Only on your devices

   Recommend **b**. Keycloak holds a blob it can't open or grind, and a new
   device gets the list. Option a hands whoever runs auth the whole social
   graph.

3. **Should a friend on server A be recognised on server B?**
   - a. No, send another request there
   - b. Yes, with pairwise tags, as a later step (2b)
   - c. Yes, by asking B about your friends' account ids

   Recommend **a now, b later**. Option c tells every server your whole friend
   list and only works for accounts.

4. **What can a local identity do with friends?**
   - a. Nothing, friends need an account
   - b. Friends per server, with the list kept on the device
   - c. The same as an account, with the list kept sealed on each server

   Recommend **b**. It costs nothing extra and links nothing. Option c puts a
   copy of the list on every server you use, and even sealed and padded, the
   copies can be matched by when they change.

5. **Per server or global settings?**
   - a. Per server only
   - b. One global default, with an override per server
   - c. Global only

   Recommend **b**. It's stored and enforced per server either way. Most people
   want one answer, and some want a different one for a big public server.

6. **What are the defaults?**
   - a. Messages: everyone on the server. Calls: people I've replied to
   - b. Both "everyone", which is today's behaviour
   - c. Messages: everyone on the server. Calls: friends only (from stage 2)

   Recommend **a**. Nobody stops being reachable, and a stranger can't ring
   you before you've answered once. It does change today's behaviour for calls.

7. **When the message setting gets stricter, what happens to conversations
   already open?**
   - a. They all keep working
   - b. They're all gated like new ones
   - c. The ones you've replied in keep working, and the rest are gated

   Recommend **c**. Answering was already a yes, and Block covers the rest.

8. **Do moderators or the owner get past somebody's settings?**
   - a. Nobody does
   - b. The server owner only
   - c. Anybody with `kick_members` or `ban_members`

   Recommend **a**. It matches how blocking works against people who outrank
   you, and moderation doesn't need a DM.
