# Resonate — sound-reactive visuals

Two pages that listen to audio and animate to it in real time. No build step, no dependencies,
no server.

- **`index.html`** — spectrum-driven visuals (Bloom / Particles / Ribbon)
- **`album.html`** — album artwork dissolved into drifting colour fields that breathe with the music
- **`audio.js`** — the analysis engine both pages share
- **`fx.js`** — the WebGL distortion looks used by `album.html`

Keep the four files together in one folder. Microphone access requires `https://` when hosted,
though opening the files directly from disk works for local testing.

## Try it

Open either page in a browser and pick a source:

- **Microphone** — play music out loud from anything (Spotify, Apple Music, a record player,
  a live band) and the page reacts to what it hears. Works on phone and desktop.
- **Capture audio from this device** — desktop Chrome/Edge only. Cleanest signal, no room noise.
  You must tick "share audio" in the picker or no audio track comes through.
- **Demo tone** — a built-in generated loop, so you can see the visuals without granting anything.

In `index.html`: three visual modes and four palettes. Space cycles mode, `C` cycles palette,
`F` toggles fullscreen. The HUD hides itself after a few seconds.

In `album.html`: drop any image on the page (or paste one, or use the Artwork… button) and it
becomes the source material. Space cycles the look, `F` toggles fullscreen.

Five looks are live. Three more — **Drift**, **Glitch** and **Marble** — are fully implemented but
carry `hidden: true` in the `LOOKS` array, which keeps them out of the picker without deleting any
code. Removing that one word brings a look back.

Poster, Swirl and Glitch paint over the artwork on a 2D canvas; Ripple, Ribbed, Marble and Lens
bend it as a texture in a fragment shader (`fx.js`).

- **Drift** — calm ambient colour fields
- **Poster** — a flat ground of the artwork's dominant colour, over which cells appear as hard-edged
  blocks. **How many appear is the animation**: about 5% of the most distinctive cells in
  near-silence, 28% at half level, 73% at peak. The curve is concave and stops short of full, so it
  holds the sparse state that reads best rather than filling at the first loud passage. Cells are
  chosen by *rank*, not by a fixed strength
  threshold — thresholding on the value left a gradient with one small subject empty at a level
  that filled a busy cover completely. Each cell keeps both its nearest palette colour and its true
  colour, blended by `POSTER_IMAGE` (0 = pure palette, 1 = untouched picture). Rows shear apart
  along different frequency bands.
- **Swirl** — each frame is fed back rotated and slightly enlarged, so colour spirals outward
- **Glitch** — the image is torn into horizontal slices and the colour channels split on beats
- **Ripple** — refraction through a moving water surface. A height field is built from summed
  sines plus noise, the image is offset by its gradient, and the colour channels are split
  slightly so the result disperses like water rather than blurring. Beats send rings outward.
- **Ribbed** — fluted glass. Each rib is a real cylindrical lens: it shows a narrow strip of what
  is behind it, magnified and **inverted**. The inversion is the tell — without it, something
  moving behind slides the wrong way and the result reads as stripes rather than glass. Clarity is
  deliberately uneven and drifts, so some of the image stays sharp while other parts dissolve, and
  *which* parts are sharp is itself the animation. The pane never moves: rib count and lens
  geometry are constants, and only the subject behind them drifts.
- **Marble** — irregular blobs on a field of the artwork's dominant colour, each ringed by a bled
  black outline, sizes and density varying across the canvas, with the artwork itself reading
  through both blobs and ground. Beats swell nearby blobs outward like spreading ink. Built from a
  signed-distance grid rather than flowing noise: the source reference is structured and printed,
  and free-form marbling reads nothing like it. Three details carry it — the black is an *outline
  around* each shape rather than the gaps between them, the ground is a colour rather than black,
  and the field is evaluated across a 3×3 neighbourhood so blobs can grow past their own cell and
  merge. Testing only the cell a pixel falls in clips every blob at the cell wall, which turns an
  organic field into a sliced grid the moment anything grows.
- **Lens** — a grid of large, near-touching circles on a dark ground, each holding a fisheye of the
  patch of image behind it, centred on that circle, in the artwork's own colours, under coarse
  static print grain. The whole image drifts behind the grid on a slow Lissajous that the music
  pushes; without it the circles pulsed while the picture inside sat still, and the look read as
  decoration rather than as reactive. A riso duotone was tried here and removed: it read as a filter laid over the
  image rather than as the image itself.

The look button opens a picker; space steps through the live looks, skipping hidden ones.

**Motion rate is almost independent of sustained loudness.** Music is loud continuously, so tying
speed to level produces constant fast movement that reads as unrelated to the sound — it drowns out
the part that is actually reacting. Idle drift is very slow; transients do the moving.

**Any layer that moves has to overscan.** A rotated or displaced layer no longer covers the region
it moved away from, and the ground colour showing through reads as a hole punched in the artwork
rather than as motion. Swirl scales its feedback by just enough to cover the frame's rotation;
Poster draws two extra cells beyond each edge.

### The shader layer

`fx.js` renders into its own canvas element stacked over the 2D one, and the two are shown or
hidden by look. It originally rendered offscreen and was blitted into the 2D canvas every frame,
which forced a GPU→CPU→GPU round trip per frame — expensive, hot, and the likely cause of stalls
when switching away from a shader look. Its backing store is capped at 760px on phones and 1180px
elsewhere; these are fragment-bound passes and nothing visible is gained by rendering them at full
retina density.

### Cost

A full-screen 60fps visualiser will warm a phone — the GPU and display are held at full power for
as long as it runs. That is inherent, not a defect, and the device throttles itself before
anything is at risk. What isn't inherent, and has been removed: the per-frame WebGL→2D blit, a
scratch canvas reallocated twice per frame in Glitch, a radial gradient rebuilt every frame for
the vignette, and grain tiled with ~30 `drawImage` calls per frame instead of one. Rendering also
stops entirely while the page is hidden.

If WebGL is unavailable the four shader looks are removed from the list at boot rather than left
in place to render a blank screen.

**Never quantise a parameter that defines the geometry.** Rib count and grid count were derived
from audio through `floor()`, so every time a band crossed a threshold the whole pane or grid
snapped to a new size — read as jitter, and made a fixed physical object look like it was moving.
Anything the eye treats as a static structure has to be a constant; drive what sits behind it
instead. Grain had the same problem in time: resampling on `floor(uTime * 12.0)` is a 12Hz strobe,
not grain.

Three more things worth knowing if you touch the shader:

- **Normalise a height field before raising it to a power.** The caustic term started as
  `pow(h*0.5+0.5, 6)` on an unnormalised `h` that reached 1.6 — `1.6^6` is 17, and whole regions
  blew out to flat white.
- **The gradient of a sum of sines runs to about 4**, so a refraction offset in the hundredths
  already bends the image hard. At the tenths it stops being refraction and turns to soup.
- **Integrate a rate; never multiply time by it.** Ripple's surface speed follows the music, and
  writing `uTime * rate(t)` displaces the entire waveform the instant the rate changes — the water
  jumped rather than speeding up. Phase is accumulated on the CPU (`phase += dt * rate`) and passed
  in as its own uniform.

## Video sources

Drop or pick a video instead of an image and it becomes the source. It is muted, looped, and
played inline, its crushed copy is re-read every frame, and the palette is re-derived a few times
a second so the colours follow the footage. Everything else — every look — works unchanged.

Object URLs are same-origin, so frames stay readable for colour sampling. Format support is the
browser's: MP4 and MOV are the safe choices, and Safari will not play WebM.

**Sensitivity** (low / mid / high) is a control rather than a fixed default, because the right
value depends on how loud the room is and how far the device is from the speaker. It uses a soft
knee — `1 - exp(-v * gain * 1.8)` — instead of clamping. A hard clamp pins every value at maximum
as soon as gain rises, which flattens the dynamics and makes higher sensitivity look *less* alive.

## The ambient album-art page

`album.html` takes a cover and abstracts it in two stages:

1. **The cover is crushed to a 7-pixel-wide image** and upscaled to fill the screen. Blurring a
   full-size cover just looks like a blurred cover; at 7px only the broad composition and colour
   placement survive, which is the part that reads as "that album."
2. **Five colours are sampled from the cover** and painted as drifting gradient blobs on top,
   each one tied to a different frequency band, so bass moves one blob and cymbals move another.

Two things that needed care:

- **Colour sampling is weighted by colourfulness**, not just frequency. A cover that's 70% grey
  background with small vivid accents returns the accents, not five greys.
- **Sampled colours get brightened into a vivid band** before painting, because averaged cover
  colours are almost always too dark to work as light. Hue is preserved, so it still feels like
  the album. Near-neutrals are exempt — saturating a grey invents a colour that was never on the
  cover.

The whole scene renders into a ~132px buffer that gets scaled up. That upscale *is* the
abstraction, and it costs a fraction of a real blur filter.

## Recognising what's playing

Not wired up — this is a deliberate seam, not an oversight. Anything that can produce a title,
artist, and image URL only has to call:

```js
setNowPlaying({ title, artist, artworkUrl })   // album.html
```

There are two real routes, with very different trade-offs.

**Spotify "currently playing" (OAuth).** `GET /v1/me/player/currently-playing` still works and
returns the album art URL directly — no audio leaves the device, art is exact, and it's free.
The catch is distribution: as of the February 2026 changes, a **new** app in development mode is
capped at **5 users**, who must be added by hand. Apps created before then were grandfathered at
25. Going past the cap needs a quota extension, which Spotify grants sparingly. Fine for personal
use; not something you can hand to a crowd. Also Spotify-only — it can't see Apple Music.

**Audio fingerprinting (ACR).** Record a few seconds of mic audio, send it to
[AudD](https://audd.io/) or [ACRCloud](https://www.acrcloud.com/music-recognition/), get back the
track and artwork. Source-agnostic — it works on Apple Music, a record player, a bar's PA. Costs
money (AudD starts around $5 per 1,000 lookups, 300 free), takes a few seconds, fails on live and
unreleased material, and **it does send audio to a third-party server**, which breaks the
"nothing leaves your device" property the rest of this has.

`A.getStream()` exposes the live capture so a recogniser can grab a snippet from the existing
stream rather than opening a second microphone.

## What is actually possible, per platform

The visuals are the easy part. The only hard question is **how you get at the audio**, and the
answer is entirely determined by OS sandboxing rules — not by how the tool is written.

| Target | Can it read audio from *another* app (Spotify / Apple Music)? | How |
|---|---|---|
| Desktop web (Chrome/Edge) | **Yes** | `getDisplayMedia` with system or tab audio. macOS needs Chrome 141+ and macOS 14.2+; Windows and ChromeOS have worked for years |
| Desktop web (Safari/Firefox) | No | The API exists but yields no audio track |
| Desktop native (Mac/Windows) | **Yes** | ScreenCaptureKit / Core Audio taps on macOS, WASAPI loopback on Windows |
| **iOS — any app or browser** | **No** | The sandbox has no route to another app's audio. This is a hard platform wall, not a gap to engineer around |
| Android native | Sometimes | `AudioPlaybackCapture` (Android 10+), but apps can opt out and music apps commonly do |
| **Microphone — everywhere** | **Yes** | Hears whatever the speakers play. The universal fallback |

**The practical consequence:** on a phone, the microphone is the only route that actually works.
It's also the one that needs no install and no permissions beyond mic access. That constraint
turns out to be a feature — it reacts to any sound in the room, not just this device.

### Two implementation details that matter more than they look

1. **Disable the browser's speech processing on the mic.** `echoCancellation`,
   `noiseSuppression`, and `autoGainControl` all default to on, and they are tuned for voice
   calls — they treat music as echo and actively cancel it. Left on, the visualizer barely
   twitches. All three are explicitly off in `audio.js`.

2. **Auto-gain the analysis, not the audio.** Each frequency band is normalised against a
   slowly-decaying running peak, so a quiet phone speaker and a loud PA land in a similar range
   without touching anything. The sensitivity control sits on top of this for the cases auto-gain
   can't reach — mainly a mic far from a quiet source.

### A route that no longer exists

Reading a track's tempo/beat grid from Spotify's API and animating to that instead of to live
audio **is not available.** Spotify deprecated `audio-features`, `audio-analysis`,
`recommendations`, and related endpoints on 27 November 2024. Only apps that already had
extended access before that date still work; anything new gets a 403, and as of 2026 there is
no replacement. Real-time analysis of the actual audio — what this does — is the durable
approach.

## How the analysis works

- `AnalyserNode` (2048-point FFT) over the incoming stream
- Energy split into bass / mid / high / air bands by real Hz ranges
- Each band measured **relative to its own recent behaviour** — how far above or below its running
  mean it sits, scaled by how much it normally varies — blended with the peak-normalised absolute
  level. Peak normalisation alone divides by a decaying maximum, so a band that stays roughly
  constant pins near 1.0 and stops moving: punchy tracks looked reactive and smooth ones looked
  like a random animation. Measured over 25s of synthetic signal, a sustained pad moved through a
  range of 0.096 under peak-only and 0.611 under the blend, while a kick pattern was unchanged.
- An **envelope follower** on each band: ~45ms attack so transients still land, ~220ms release so
  the result glides. Dividing by the running deviation is what gives quiet music its range, but it
  also multiplies the FFT's own frame-to-frame noise by 1/sd — on ambient material, where the
  deviation is genuinely tiny, that turned into jitter. A deviation floor caps the gain and the
  follower smooths what remains. Measured on a pad with realistic frame noise: jitter per frame
  0.0177 under peak-only, 0.0060 with the follower, while usable range went from 0.141 to 0.583.
- A presence gate so near-silence reads as still rather than as amplified room tone
- **Onsets from spectral flux** — the summed positive change across the whole spectrum — against a
  threshold that rides on the local mean plus a multiple of the local spread. Watching only low-band
  energy finds nothing in acoustic, vocal or ambient material, which is exactly the music that
  looked unreactive; flux fires on a plucked string or a vocal entry as readily as on a kick. On the
  built-in 120bpm demo the old detector reported 75bpm; this reports 120.
- Spectral centroid drives hue, so colour tracks the brightness of the music
- Canvas 2D with additive blending and a per-frame trail fade for the glow

All analysis is on-device. Nothing is uploaded, recorded, or persisted.

## Extending it

`audio.js` exposes a single global `A`. A new visual is a function that reads `A.bass`, `A.mid`,
`A.high`, `A.air`, `A.level`, `A.beat`, `A.centroid`, `A.bpm`, and `A.freq` — plus an entry in
the `MODES` array in `index.html` or the `LOOKS` list in `album.html`. Nothing else changes.

In `album.html`, `TINY_W` (currently 7) is the single knob for how abstract the result is. Raise
it and the cover becomes more legible; lower it and you get pure colour fields.

## Licence

© 2026. All rights reserved.

This repository is public so it can be served over GitHub Pages. Public is not open
source: no licence is granted to use, copy, modify, or redistribute this code. Add a
name or entity to the line above if you want the claim to be unambiguous.
