# Mobile store listings — fill-in sheet for GRYT-1446

Everything below is copy and answers to paste into Google Play Console and App
Store Connect. Nothing here has been submitted anywhere. Where an answer
depends on a judgment call rather than a fact in the code, it's marked **check
this** and left for Sivert.

Facts are pulled from `packages/mobile` and `packages/server` at
`origin/main` (commit `88701ed`, mobile), the site's privacy policy
(`packages/site/src/pages/PrivacyPolicy.tsx`) and terms
(`packages/site/src/pages/TermsOfUse.tsx`), and `packages/mobile/app.json`.
Each claim below names the file it came from. The phone app is behind
desktop. Nothing here claims a feature it doesn't have.

## 1. Google Play listing

| Field | Value |
|---|---|
| App name (≤30) | `Gryt: Voice & Text Chat` (23 chars) |
| Short description (≤80) | `Voice and text chat you host yourself. Open source, no ads, no tracking.` (72 chars) |
| Category | Communication |
| Tags | Play's tag list is fixed and changes over time — pick the closest matches in Console at submission. Closest today: Chat, Video Calling, Communication. **check this** |
| Developer contact email | hello@gryt.chat |
| Developer website | https://gryt.chat |
| Privacy policy URL | https://gryt.chat/privacy — returned `200` when checked today (2026-09-25) |

**Full description (≤4000, 1459 used):**

```
Gryt is voice and text chat you can run yourself. Join a server a friend runs, run your own, or use the one we run at community.gryt.chat. Your call.

Every server stands on its own. There's no single Gryt network watching who talks to whom across servers, no feed deciding what you see, and no ads. The code is open source under AGPL-3.0, so you can read what it actually does before you trust it with anything.

What the phone app does today:
- Text channels, with custom emoji and reactions
- Voice channels, with video and screen share
- Direct messages, end-to-end encrypted so the server can't read them
- Share photos, files, and links in from other apps
- Light and dark themes, and a compact message layout if you want more on screen at once

The phone app is newer than the desktop one and doesn't have everything yet. A few desktop features are still on their way over. If something's missing, it's probably already planned, not forgotten.

No account is required to join a server. If you do sign in, it's so your identity carries between your devices. Gryt never sees your messages, files, or voice. None of it passes through us. It goes straight to whichever server you're on.

You can report bugs or send feedback right from the app. We don't run analytics, and there's no crash reporter phoning home. If something breaks, tell us yourself and we'll see it.

Source code: github.com/Gryt-chat
Privacy policy: gryt.chat/privacy
```

Backing for the claims in that description: text/voice/video/screen share/DMs
from `packages/mobile/app/(tabs)/(server)/`, `src/voice/*`,
`src/identity/dmKeys.*` and the crypto section below; no ads/no analytics from
`package.json` (no ad SDK, no analytics SDK, confirmed below); AGPL-3.0 from
`packages/mobile/package.json` license field matching
`packages/site/src/pages/TermsOfUse.tsx` ("Content and intellectual
property"); account-optional from `TermsOfUse.tsx` ("You do not need an
account to use Gryt") and `src/account/authServer.ts`; bug reports from
`src/feedback/submit.ts`.

## 2. Play Data safety form

Google's form asks what the **app** collects and transmits, not just what
Gryt Chat (the company) stores. Because Gryt is a client for servers you or
someone else chooses, most categories below say "collected — sent to the
server you connect to" rather than "collected by us." That's the honest
answer for a federated app, and it matches how the privacy policy already
describes third-party servers.

| Data type | Collected? | Shared? | Purpose | Optional? | Source |
|---|---|---|---|---|---|
| Name (display name / nickname) | Yes | Sent to whichever server you join | App functionality | No — needed to use a server | `packages/mobile/src/profile/useProfile.ts`, `PrivacyPolicy.tsx` ("Profile information") |
| Email address | Yes, only if you sign in with a Gryt account | Sent to auth.gryt.chat (ours) | Account management | Yes — guest identities need none | `src/account/authServer.ts`, `PrivacyPolicy.tsx` ("Account data") |
| Messages | Yes | Sent to whichever server you join | App functionality | No | `src/connection/useMessages.ts`, `PrivacyPolicy.tsx` |
| Photos and videos | Yes (attachments, avatars, video in calls) | Sent to whichever server you join | App functionality | Yes — nothing sends automatically | `src/chat/upload.ts`, `src/voice/useCamera.ts`, `app.json` (`expo-image-picker` permissions) |
| Audio | Yes (voice channel audio) | Sent live to whichever server's voice relay you're on | App functionality | Yes — only while in a voice channel | `src/voice/*`, `app.json` (`NSMicrophoneUsageDescription`) |
| Files | Yes (attachments) | Sent to whichever server you join | App functionality | Yes | `src/chat/upload.ts`, `src/chat/staging.ts` (`MAX_ATTACHMENTS`) |
| Device or other IDs | Yes — an install id, only when you submit a bug report | Sent to reports.gryt.chat (ours) | App functionality, fraud prevention | Yes — only created when you file a report | `src/feedback/*`, `PrivacyPolicy.tsx` ("Bug reports and feedback") |
| App info and performance | Yes — app version, build, platform, OS version, screen size, timezone, and similar, only when you submit a bug report | Sent to reports.gryt.chat (ours) | App functionality (debugging) | Yes — nothing sent unless you tap "send" | `src/feedback/useDiagnostics.ts` |
| Crash logs | Not collected — no crash reporter is in the app | — | — | — | `packages/mobile/package.json` has no Sentry/Bugsnag/Crashlytics dependency |
| Analytics / app activity | Not collected — no analytics SDK is in the app | — | — | — | `packages/mobile/package.json`; no Amplitude/Mixpanel/Segment/Firebase/PostHog import anywhere in `src/` |
| Location | Not collected | — | — | — | No location permission in `app.json`, no location import in `src/` |
| Contacts | Not collected | — | — | — | No contacts permission in `app.json`, no contacts import in `src/` |
| Personal identifiers shared with third parties | No — data goes to the server you chose, not to an ad network or a data broker | — | — | — | No ad SDK anywhere in `package.json` |

**Data is encrypted in transit:** Yes. Everything is HTTPS/WSS, and direct
messages get a second layer of end-to-end encryption on top of that (X25519
key exchange, Ed25519-signed identity bindings, a random key per message).
See `packages/crypto/README.md` and `packages/mobile/src/identity/dmKeys.*`.
Channel messages are not end-to-end encrypted; the server operator can read
those, which the privacy policy already says plainly.

**Users can request data deletion:** Yes. Point the form at
`https://gryt.chat/privacy#deleting-your-account`. Account deletion goes
through `sivert@gryt.chat` by email. There's no self-service button yet, per
that same section. Data on a third-party server is that operator's to
delete, not ours.

**What surprised me going through the code:** the app talks to three
Gryt-run services (auth.gryt.chat, id.gryt.chat, reports.gryt.chat) and
otherwise touches nothing outside whatever server you point it at. There's
no telemetry endpoint, no ad SDK, and no push notification service at all
(no `expo-notifications` anywhere, so no push token to disclose). The
install id (`src/feedback/*`) only exists once you file a report; it isn't
generated on first launch the way the privacy policy's wording ("the first
time it ran") reads for the other clients. **check this against desktop/web
if the wording needs to differ per platform.** Mobile's version is
report-triggered, not app-launch-triggered.

## 3. Content rating questionnaire (IARC)

IARC's output is computed from the questionnaire, not chosen directly, so
these are the answers to give it and why, not the final rating.

| Question | Answer | Why |
|---|---|---|
| Violence | No — nothing depicted by the app itself | Gryt renders no game content; violence questions are about the app's own content |
| Sexual content | No — nothing depicted by the app itself | Same |
| Profanity / crude humor | No — the app itself contains none | Same |
| Controlled substances | No — the app itself references none | Same |
| Gambling | No | No gambling feature exists |
| Digital purchases | No | No IAP dependency anywhere in `package.json`; no store/purchase code in `src/` |
| Shares user location | No | No location permission or code |
| Users interact / can communicate | **Yes** | Text, voice, video, DMs — the entire product |
| Shares personal info with other users | **Yes** | Nickname, avatar, messages, files are visible to other members of a server |
| Unrestricted internet / user-generated content | **Yes** | Any server address can be entered (`src/servers/address.ts`), messages and files are user-generated and not pre-screened (`TermsOfUse.tsx`: "We do not monitor or pre-screen what people post") |

Because "users interact," "shares personal info," and "unrestricted
internet/UGC" all land on Yes, IARC's own algorithm, not this document,
will very likely land above the lowest tier, similar to how Discord itself
is rated. **check this**: run the actual questionnaire in Play Console and
read what it outputs rather than assuming a specific tier; the answers above
are what to feed it, not a prediction of the result.

## 4. Target audience and content (Play)

`TermsOfUse.tsx` ("Eligibility"): minimum age 16 to create an account, and if
you're under 18, you're confirming a parent or guardian has reviewed and
agreed to the terms on your behalf. Sixteen was picked as the GDPR consent
age, applied everywhere since Gryt doesn't know where you are.

- **Target age groups:** 16–17 and 18 and over. Do **not** select 13 and
  under or 13–15. The terms don't allow an account below 16, and unmoderated
  chat with strangers isn't something to present to Play as child-appropriate.
- **Appeals to children:** No.
- **Ads:** None — no ad SDK in the app.

**check this:** Play's targeting UI phrasing changes between console
versions; confirm the exact age-bracket labels shown at submission match
"16 and over" rather than an "13-15" bracket being selectable alongside 16-17
by mistake.

## 5. App Store Connect

| Field | Value |
|---|---|
| Name | Gryt |
| Subtitle (≤30) | `Chat and voice you host` (23 chars) |
| Promotional text (≤170) | `Gryt is a voice and text chat app you or a friend can host. No ads, no tracking, and messages between two people are end-to-end encrypted.` (138 chars) |
| Keywords (≤100) | `voice chat,group chat,self-hosted,open source,encrypted,voip,community,server,privacy,chat` (90 chars) |
| Support URL | https://gryt.chat |
| Marketing URL | https://gryt.chat |
| Category | Social Networking |
| Description | Same copy as the Play full description above — Apple has no length pressure here, and there's no reason to diverge and have two descriptions to keep in sync. |

### App Privacy ("nutrition label")

Apple's categories don't map one-to-one onto Play's. Same underlying facts,
sorted into Apple's buckets:

| Apple category | Collected? | Linked to you? | Used for tracking? | Source |
|---|---|---|---|---|
| Contact Info → Email Address | Yes, only with a Gryt account | Yes, to that account | No | `src/account/authServer.ts` |
| Contact Info → Name | Yes (nickname) | Yes, on the server you're on | No | `src/profile/useProfile.ts` |
| User Content → Photos or Videos | Yes | Yes, on the server you're on | No | `src/chat/upload.ts` |
| User Content → Audio Data | Yes (voice channels) | Yes, on the server you're on | No | `src/voice/*` |
| User Content → Other User Content (messages, files) | Yes | Yes, on the server you're on | No | `src/connection/useMessages.ts`, `src/chat/staging.ts` |
| Identifiers → Device ID | Yes — the install id, only inside a bug report | **check this**: ties your reports to each other, not to your Apple ID. "Linked" only within the reports database, not to you as a person | No | `src/feedback/*` |
| Diagnostics → Crash Data | Not collected | — | No | No crash reporter dependency |
| Diagnostics → Performance Data | Yes, only inside a bug report | Same install-id caveat as above | No | `src/feedback/useDiagnostics.ts` |
| Usage Data | Not collected | — | No | No analytics dependency |
| Location | Not collected | — | No | No location permission |
| Contacts | Not collected | — | No | No contacts permission |

**check this:** Apple's picker for "Identifiers" and "Diagnostics" asks
whether each item is linked to identity with a plain toggle, and the honest
answer for the install id is "linked to other reports, not to a person."
Apple's form doesn't have a clean third option, so pick "Not Linked" and
say why in the optional description field if it lets you, rather than
picking "Linked" and implying it identifies a person. Sivert should make
that call, since it's Apple's review team reading it, not a fact I can
settle from the code alone.

**No tracking:** every row above is No. There's no ad SDK and no
cross-app/cross-site identifier of any kind (`package.json` has nothing from
an ad network or attribution SDK), so the "Data Used to Track You" section
should be empty across the board.

### Age rating

Apple's own questionnaire covers similar ground to IARC: unrestricted web
access, user-generated content, and user-to-user communication all apply
here for the same reasons as the Play section above (any server address can
be entered, chat isn't pre-screened, and other users' content is visible).
Apps with that combination typically land at the higher end of Apple's age
bands. Discord itself is rated 17+ on the App Store for the same three
reasons. **check this**: don't pre-fill "17+." Answer Apple's actual
questions the same honest way as the IARC table above and read what comes
out, because Apple's bands changed in the last couple of years and I haven't
verified the current wording against a live submission.

### Export compliance: the one to actually check

`packages/mobile/app.json` already sets `ITSAppUsesNonExemptEncryption:
false` in the iOS `infoPlist`. That flag tells App Store Connect to skip the
export compliance questions at submission entirely, on the basis that the
app either uses no encryption or only exempt encryption. That's very likely
the wrong box to leave checked without a decision behind it, because Gryt
does encrypt: direct messages go through `@gryt/crypto`, which uses X25519
key exchange, Ed25519-signed identity bindings, a random symmetric key per
message, and Argon2id (with a legacy PBKDF2 path) for the recovery vault.
See `packages/crypto/README.md`.

The reason this might still be fine: every one of those is a standard,
published algorithm (nothing proprietary or custom), and the code
implementing them is open source under AGPL-3.0, publicly available on
GitHub with no access restriction. That combination is the usual basis
consumer apps use to self-classify as exempt under the U.S. Export
Administration Regulations' "mass market" encryption exemption (Category 5,
Part 2), the same way Signal or WhatsApp do. If that's the right read here,
`false` is defensible. But "defensible" isn't the same as "confirmed," and
this is a legal filing, not a copy decision.

**What Sivert needs to decide, not me:**

1. Whether Gryt's crypto genuinely qualifies for the mass-market exemption
   (standard algorithms, publicly available source, distributed without
   restriction: all seem true from the code, but it's his call to make on
   the record).
2. Whether that decision needs a one-time notification to BIS/NSA about the
   published source, separately from anything in App Store Connect. This is
   a real government filing, not an App Store setting, and outside what a
   code read can settle.
3. Whether to leave `ITSAppUsesNonExemptEncryption: false` as-is, or set it
   to `true` and answer the in-console questionnaire directly at submission
   time instead of pre-declaring the answer in `app.json`.

## 6. Screenshots plan

No screenshots are taken here. This is what to shoot, and on what.

**Required sizes, as of today (2026-09-25):**

- **Google Play:** phone screenshots, 16:9–9:16 aspect ratio, 320–3840 px per
  side (1080×1920 is the safe portrait size), 2–8 images. A 1024×500 feature
  graphic (JPG/PNG, no alpha) is required separately. Tablet screenshots are
  optional unless the listing is marked tablet-optimized.
- **App Store Connect:** only the largest display in each device family needs
  real screenshots now. Apple scales down automatically. That means one set
  at 1320×2868 (6.9" iPhone) and, because `app.json` sets
  `ios.supportsTablet: true`, one set at 2064×2752 (13" iPad Pro) if the
  listing includes iPad. **check this**: confirm the app's tablet layout is
  actually worth screenshotting before committing to a second set. A
  `supportsTablet` flag being on in Expo doesn't by itself mean the phone
  layout looks right stretched to a tablet.

Sizes above are from a web search done today and are worth re-checking
against the live console at upload time. Both stores adjust these
periodically and neither accepts a stale size silently; they just
reject the upload.

**What to shoot, in this order:**

1. **A server's channel list**, showing a few channels and unread state.
   This is the first thing anyone sees after joining, and it's what says
   "this is a real chat app" fastest.
2. **A channel with messages**, custom emoji and a reaction visible. Shows
   the core of what the app does.
3. **A voice channel**, ideally with a second participant and video on, to
   show voice/video/screen-share exists on the phone, not just desktop.
4. **The server discovery or invite screen.** Shows joining a server is the
   whole point, and that Gryt isn't locked to one network.
5. **A direct message**, with something in the UI indicating it's
   end-to-end encrypted (a lock icon or similar, if `@gryt/ui-native` shows
   one). This is the single strongest reason to put in front of someone
   deciding whether to install.
6. **The appearance/preferences screen**, dark and light side by side if the
   store allows a two-up image. Shows the app isn't a bare MVP.

Use real content, not lorem ipsum, and use the community.gryt.chat server or
a throwaway test server rather than screenshotting anyone's actual private
conversation.

## 7. The closed-test requirement

Play's rule for a personal developer account (`Gryt Chat` is one): production
access requires a closed test with **at least 12 testers who've opted in**,
running for **14 straight days**. The internal test track doesn't count
toward this at all. It's fine for building and smoke-testing, but Play
ignores it completely for the 14-day requirement.

Message to post in the Gryt Discord to recruit testers, in Sivert's voice
(English, per the task: the `sivert-voice` skill's shape and habits, not
its Norwegian):

> hey, need some help testing the Android app before I can actually launch it
> for real :slightly_smiling_face:
>
> Google wants a closed test with 12+ people opted in for 14 days straight
> before I'm allowed to apply for production, so if you've got an Android
> phone and don't mind Gryt sitting on it for two weeks, I could use you
>
> don't need you to do anything special, just accept the tester invite, install
> from the Play link, and open it every few days so Google sees it's actually
> being used. that's it :pepeok:
>
> first 12 who say yes get the invite, I'll post the link here once I've got
> the group :eyes:

**check this:** the "opted in" requirement means testers have to actually
accept the tester invite Play sends them (not just be added to a list), and
the 14 days has to be 12+ testers *simultaneously opted in* for the whole
window. Losing a tester partway through resets that tester's clock, not the
whole group's. Still, over-recruit (aim for 15+) rather than stopping at
exactly 12, since somebody always drops off.
