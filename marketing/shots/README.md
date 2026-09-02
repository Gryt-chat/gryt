# Store screenshots

Panels for the App Store and Play listings. Real captures dropped into real
device frames, composed as one wide strip and cut into panels, so a phone can
run off one panel and arrive in the next.

```bash
cd marketing/shots
yarn install
node capture.mjs iphone-6.9 voice       # once per capture, app driven by hand
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

## One strip, cut into panels

Everything is placed against a canvas six panels wide and cut at the end, so a
phone can leave one panel and arrive in the next. Scrolling the carousel then
reads as panning across one picture rather than flicking through six cards.

Coordinates are strip units. `x` counts panels across and `y` is a fraction of
panel height, so `x: 1.6` is a little past halfway through panel two. A
placement reads as where it sits in the sequence rather than as a pixel offset
that has to be recomputed when the device size changes.

`out/<set>/<device>/_strip.png` is the uncut canvas. It is not uploaded
anywhere — it is how you see whether the phones line up across the cuts.

**Every panel still has to survive being looked at alone.** The store shows one
at a time with a sliver of the next, and the first one is always seen on its
own. No panel may be only the middle of a phone.

**Text may not cross a panel edge.** A phone crossing one is the point; a
headline crossing one is a word chopped in half in the cut, and it is invisible
while you are looking at the uncut strip — which is exactly when the layout gets
adjusted. `strip.mjs` throws rather than warns, and names the `maxWidth` that
would fit.

Two more things worth knowing:

- **The screenshot goes under the frame.** The bezel is opaque and covers the
  capture's square corners, so nothing needs a rounded mask.
- **Rotation happens once, on the composed device.** Frame and screenshot
  together, so the bezel can never drift from its own screen. Angles stay under
  about ten degrees: past that a phone stops reading as a phone standing at an
  angle and starts reading as a picture somebody rotated.

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

## The owls

`@gryt/owl` renders SVG from pure functions with no DOM, so the wall in panel
five is real output from the seeds in `shots.config.mjs` rather than a picture
of some owls. Add seeds until there are at least `rows x columns` of them —
below that they repeat and `render.mjs` says so.

## Colours

Gryt's own, not a palette invented for a listing. `#2E2D5F` is the ground of
the logo and `#968FF8` is the app's accent. The logo's ground rather than the
app's near-black `#111318` is deliberate: on a shelf of dark-grey chat apps,
indigo is what reads from a thumbnail.
