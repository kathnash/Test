# Resonate — sound-reactive visuals

Two pages that listen to audio and animate to it in real time. No build step, no dependencies,
no server.

- **`index.html`** — spectrum-driven visuals (Bloom / Particles / Ribbon)
- **`album.html`** — album artwork dissolved into drifting colour fields that breathe with the music
- **`audio.js`** — the analysis engine both pages share

Keep the three files together in one folder. Microphone access requires `https://` when hosted,
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
   slowly-decaying running peak, so a quiet phone speaker and a loud PA both drive the visuals
   properly with no sensitivity slider to fiddle with.

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
- Onset detection on the low band against a rolling local average, with a refractory window,
  plus a median-of-gaps BPM estimate
- Spectral centroid drives hue, so colour tracks the brightness of the music
- Canvas 2D with additive blending and a per-frame trail fade for the glow

All analysis is on-device. Nothing is uploaded, recorded, or persisted.

## Extending it

`audio.js` exposes a single global `A`. A new visual is a function that reads `A.bass`, `A.mid`,
`A.high`, `A.air`, `A.level`, `A.beat`, `A.centroid`, `A.bpm`, and `A.freq` — plus an entry in
the `MODES` array in `index.html` or the `LOOKS` list in `album.html`. Nothing else changes.

In `album.html`, `TINY_W` (currently 7) is the single knob for how abstract the result is. Raise
it and the cover becomes more legible; lower it and you get pure colour fields.
