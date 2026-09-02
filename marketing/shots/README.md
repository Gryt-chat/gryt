# Store screenshots

Panels for the App Store and Play listings: a real capture, dropped into a real
device frame, on a Gryt-coloured ground with an icon and a headline.

```bash
cd marketing/shots
yarn install
node capture.mjs iphone-6.9 channels    # once per panel, app driven by hand
node render.mjs                          # writes out/<set>/<device>/
```

`out/` is what you upload. Nothing in here is committed except the code.

## Before the first run: get the frames

`frames/` is gitignored. Device frames are Apple's and Google's marketing
assets and this repository is public, so they are not committed. Download them
and drop them in with the exact filenames `devices.mjs` names:

| Device | File | Where |
|---|---|---|
| iPhone 6.9" | `iPhone 17 Pro - Silver - Portrait.png` | [Apple Design Resources](https://developer.apple.com/design/resources/) → Device Bezels |
| iPad 13" | `iPad Pro 13 - Silver - Portrait.png` | same |
| Android phone | `android-phone.png` | [Android device art generator](https://developer.android.com/distribute/marketing-tools/device-art-generator) |

`render.mjs` fails with the missing path rather than rendering something wrong.

## How a panel is built

1. The ground — flat colour or a gradient, from the theme.
2. The icon, then the headline, centred, from the top down.
3. The framed device, centred, running off the bottom edge.

Two rules keep a set looking like a set rather than six posters:

- **One headline size across every panel**, the largest that fits them all.
  Sizing each panel on its own gives the short headlines bigger type.
- **One device y across every panel**, derived from the tallest text block. A
  phone that shifts down a line between panels is what makes a set look
  assembled.

The screenshot goes **under** the frame. The bezel is opaque and covers the
capture's square corners, so nothing needs a rounded mask.

## Sizes, and why capture ≠ output

Three different numbers, and conflating them is the mistake to avoid:

| | iPhone 6.9" | iPad 13" |
|---|---|---|
| `capture` — what the simulator produces, and the frame's aperture | 1206×2622 | 2064×2752 |
| `output` — what the store accepts | 1320×2868 | 2064×2752 |

The panel is a poster the phone sits on, not the phone's screen blown up. A
capture off the right simulator lands in the aperture at 1:1 with no
resampling; anything else is resized with a warning.

App Store: 1 to 10 per set, flattened PNG or JPEG, **no alpha channel** — a PNG
carrying one uploads and then fails validation without saying why, which is why
`render.mjs` flattens.

## Measuring a frame

The aperture is measured from the alpha every run, not written down, so
replacing a frame when the hardware changes needs no code edit:

```bash
node measure-frame.mjs "frames/iPhone 17 Pro - Silver - Portrait.png" 1206 2622
```

A whole-image transparent bounding box gives the wrong answer — outside the
rounded body is transparent too. It walks the centre row inward for the left
and right edges, the centre column up from the bottom for the bottom edge, and
derives the top from the device height. That last step is what handles the
Dynamic Island, which is opaque and sits inside the screen.

## What Apple allows

Coloured and gradient grounds, overlaid copy, and 3D device frames are all
fine. Two things are not:

- **A frame that does not match current Apple hardware.** The outline-drawing
  treatment is safer on Play and the website than on the App Store.
- **Anything that is not the real app.** Screenshots must be actual UI with
  real data, not mockups. A headline promising something the capture behind it
  does not show is a rejection.

## The part that is not solved

Getting a populated server, a live call and a readable history onto a simulator
repeatably. `capture.mjs` deliberately does not drive the app — a script
guessing at deep links produces a screenshot of the wrong screen, which looks
finished and is not. `marketing/video/demo-mode.md` argues for a demo mode in
the client for the launch video; the same thing would serve this.

## Adding an icon

`icons.mjs` holds Phosphor path data, vendored because the icon packages in
this repository are React components and neither renders outside a React tree.
They are the regular weight on Phosphor's 256 grid — the same icons the app
draws. Add one by copying the first `d` out of the `regular` block of
`phosphor-react-native/src/defs/<Name>.tsx`.
