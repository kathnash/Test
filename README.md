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

Nine looks are live. Four more — **Drift**, **Swirl**, **Glitch** and **Marble** — are fully
implemented but carry `hidden: true` in the `LOOKS` array, which keeps them out of the picker
without deleting any code. Removing that one word brings a look back.

Poster, Swirl and Glitch paint over the artwork on a 2D canvas; Blur, Punch, Dots, Fields, Ripple,
Ribbed, Marble, Lens and Cyanotype bend or remap it as a texture in a fragment shader (`fx.js`).

**A second picture** can be loaded with the *2nd image…* chip — image or video, same as the first;
the same button removes it. **Every live look has a two-image behaviour**, and none of them require
it: with one picture loaded they all work exactly as before.

| look | with a second picture |
|---|---|
| Poster | a wandering *cluster* of layer-two cells that bursts open on a transient |
| Blur | a feathered oval of layer two floating centre-frame, defocused by the same kernel |
| Punch | layer two shows through the cut holes |
| Dots | some of the dots are lifted straight out of layer two |
| Fields | some of the cutouts are layer two |
| Ripple | a *puddle* of layer two, spreading on the swell, its edge rippled by the water |
| Ribbed | the two ride a conveyor behind the glass, one panel per screen width, running left |
| Lens | some circles hold layer two, scattered by a per-circle hash |
| Cyanotype | a square inset of layer two, printed through the same burn and wash |

- **Drift** — calm ambient colour fields
- **Poster** — a flat ground of the artwork's dominant colour, over which cells appear as hard-edged
  blocks. **How many appear is the animation**, and *which cells can ever appear* is decided by the
  frame's own content: a clear sky with kites in it draws the kites and leaves the sky flat, while a
  busy cover fills in. Each cell keeps both its nearest palette colour and its true colour, blended
  by `POSTER_IMAGE` (0 = pure palette, 1 = untouched picture). Rows shear apart along different
  frequency bands.
- **Swirl** — each frame is fed back rotated and slightly enlarged, so colour spirals outward
- **Blur** — the artwork as a photograph taken well out of focus: highlights swollen into soft
  masses, heavy emulsion grain, milky lifted shadows. It never resolves — the music moves how far
  out of focus it is, not whether it is. Replaced Swirl in the picker.
- **Dots** — the photograph left alone under a little grain, with a field of flat coloured dots
  scattered over it that reshuffle to the music. Each dot keeps its own clock, offset by a per-cell
  seed, so they change one at a time rather than the whole field blinking together — that stagger is
  the difference between shuffling and strobing. A dot fades out, moves, and fades back in; one that
  teleports reads as a glitch.
- **Fields** — torn-paper collage: organic blob cutouts on a paper ground, each a window onto the
  photograph, some filled flat in the artwork's own colours. Outlines are three angular harmonics
  with drifting phases, which gives a smooth closed curve that never settles for a few instructions
  — an fbm around each rim would cost a dozen hashes per blob and this runs nine times per pixel.
  Without the flat-colour shapes the whole sheet reads as one picture behind a mask.
- **Punch** — a paper collage: one picture with a loose grid of hand-cut circular holes punched
  through it and a second picture showing through them. **The holes are a window onto one
  continuous photograph**, not a thumbnail repeated per circle — that is what makes it read as two
  sheets of paper rather than as a pattern. With only one source loaded the holes show the same
  picture closer in, which is what the reference collages do anyway.
- **Glitch** — the image is torn into horizontal slices and the colour channels split on beats
- **Ripple** — refraction through a moving water surface. A height field is built from summed
  sines plus noise, the image is offset by its gradient, and the colour channels are split
  slightly so the result disperses like water rather than blurring. Beats send rings outward.
- **Ribbed** — fluted glass. Each rib is a real cylindrical lens: it shows a narrow strip of what
  is behind it, magnified and **inverted**. The inversion is the tell — without it, something
  moving behind slides the wrong way and the result reads as stripes rather than glass. Clarity is
  deliberately uneven and drifts, so some of the image stays sharp while other parts dissolve, and
  *which* parts are sharp is itself the animation. The pane never moves: rib count and lens
  geometry are constants, and only the subject behind them drifts. The relief is kept light — at
  full strength the edge shading and speculars turn a pane into a row of tubes, and the lens
  geometry is what sells the glass anyway.
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
- **Cyanotype** — a contact print, running the actual darkroom process, with the music as the light
  source. Sound exposes the sheet: a dusty violet coating, the image burning in, the water wash where
  the Prussian blue arrives all at once, then the deepening as the pigment oxidises. Quiet reverses
  it, so the print sinks back toward violet in the gaps and develops again when the song returns.
  Exposure and edge softness follow the music on top of that, so the pale shapes bloom and their
  edges travel between crisp and dissolved. In the quiet, dappled light moves across the sheet.

### Two pictures for free

Compositing a second source could easily have doubled every look's texture bandwidth. It costs
nothing measurable — a same-process A/B across every look, one picture then two, came back between
**−5% and +4%**, which is inside the noise on this rasteriser:

| | Blur | Punch | Dots | Fields | Ripple | Ribbed | Lens | Cyanotype |
|---|---|---|---|---|---|---|---|---|
| 1 image | 64.3 | 89.6 | 112.6 | 115.2 | 97.7 | 105.5 | 90.0 | 89.8 |
| 2 images | 63.2 | 85.7 | 111.4 | 113.3 | 98.9 | 102.3 | 85.1 | 93.2 |

The reason is that `pick()` is a **branch, not a mix**. Written as
`mix(tex(a), texB(b), m)` every pixel samples both textures always. Written as a branch on `m`, a
pixel well inside either region samples one, and only the feathered boundary — a few percent of the
frame — pays for both. Same for Ribbed's conveyor, where the panel a point falls in selects the
picture, so the sixteen blur taps still cost sixteen fetches rather than thirty-two.

**Each picture needs its own cover-fit and its own tone statistics.** The cover-fit is obvious once
the two sources have different aspect ratios. The tone statistics are less so, and Cyanotype's inset
came out blank white until they were added: that look stretches luminance to the source's 8th/92nd
percentiles before thresholding, and a second image exposed differently from the first sits entirely
outside that range, so every pixel of it lands on one side of the threshold. Layer two now carries
its own `lumLo`/`lumHi`/`median`, blended in by the inset mask, and the inset is printed through the
same burn and wash as the rest of the sheet rather than composited on top of it.

Selection still comes from layer one everywhere — Poster's local-contrast ranking, the palette, the
swatches. A second picture changes what is *painted*, never what is *chosen*.

### What actually limits how many looks there can be

Worth being precise, because the intuition is wrong. **Runtime cost does not accumulate.** `uMode`
is a uniform, so every pixel in a frame takes the same branch and the GPU only executes the branch
for the look on screen. Adding a tenth look does not slow the other nine down. The evidence is in
the sweep itself: with all nine live looks compiled into one program, Blur still measures 62ms
against Fields' 120ms in the same run. If shader size were being paid per pixel they would converge,
and they do not.

Three things *do* accumulate, none of them close to binding:

| | now | limit |
|---|---|---|
| active uniforms | 23 | ≥224 on real mobile hardware |
| fragment shader source | 39.6 kB | compile+link is one-off at startup |
| texture units | 2 | ≥8 guaranteed |

So the ceiling is not structural, it is per-look: **sustained GPU load, which on a phone means heat
rather than dropped frames.** The lever that matters is the one the Blur work found — backing store
should follow the highest frequency a look can actually produce. Blur runs at 0.68 width and costs
half what it did; any future look that is soft by construction can do the same.

Numbers below are SwiftShader CPU raster, which is 10–30× slower than a phone GPU and drifts upward
across a long sweep as the host warms, so **only the ordering within a single run is meaningful.**

### Two layers, and what a hole is a window onto

The second source is deliberately thin — a bounded canvas and a media handle, refreshed per decoded
video frame like the first, and *only* while a shader look is on screen. Nothing else in the page
reads it. Keeping the palette, the swatches, the Poster grid and the tone statistics all derived
from layer one means adding a second picture cannot change how any existing look behaves, which is
the difference between a new capability and a regression surface.

The collage itself turns on one decision: **each hole is a window onto one continuous second
photograph**, positioned in frame space, not a copy of that photograph fitted into each circle. Fit
it per circle and you get a pattern of identical medallions; let the circles sample one image
underneath and you get two sheets of paper. Both are a few characters apart in the shader and they
are not remotely the same look.

Three details do the rest, all from the references rather than from the maths:

- **Nothing sits on a true grid.** Rows are shifted by a per-row amount, circles are jittered inside
  their cells, and radii vary per circle. A true grid reads as machine-made instantly.
- **A pale hairline at every cut.** A blade through paper exposes a bright edge of stock. It is most
  of what says *cut* rather than *masked*, and it wants to be thin — the first pass had it three
  times too bright and the holes read as glowing portholes.
- **Barely-there irregularity.** The first pass wobbled the radius by ±12% and the circles came out
  as potatoes. Hand-cut is still recognisably a circle; ±3% is the whole budget.

The two pictures drift against each other rather than the grid drifting, which is what you would
actually see through a hole, and it means the collage stays alive without the cut edges ever
appearing to wander. Only the radius breathes with the music — the grid count is constant, because
a count driven through `floor()` snaps the whole sheet to a new layout every time a band crosses a
threshold. That is the same jitter Lens and Ribbed both had.

### Blur is bokeh, not averaging

The reference photographs share one thing that a blur filter does not do: **bright shapes swell and
stay bright.** A lens does not average an out-of-focus highlight away — it spreads that light over a
disc, which is why defocused specular points read as glowing coins rather than as pale smudges. A
flat mean gives mush, and mush is the difference between a filter and a photograph.

So each sample is weighted by its own brightness before averaging, on the same golden-angle spiral
the Ribbed fix produced. Bright samples dominate their neighbourhood and swell; dark ones recede.
The exponent rises with level, so louder passages bloom harder.

Three other things carry it, all from the references rather than from the maths:

- **Milky lifted blacks.** Every reference sits its shadows well above zero. Without that lift a soft
  image just looks murky rather than filmic.
- **Heavy static grain.** Static, not reseeded per frame — the picture passes through an emulsion.
  Weighted toward the midtones, because real grain has little to bite on at either extreme.
- **It never resolves.** The music moves the focus depth (measured: 21% more surviving structure
  from silence to peak on a textured source) but the shallow end is still a heavy defocus. The moment
  it resolves it stops being this look and becomes the artwork with a filter on it.

**The backing store is per-look.** Blur has no detail above a few pixels by construction, so it does
not need the resolution a look that resamples sharply does. At 0.68 width — under half the pixels —
it went from **108ms to 51ms**, the most expensive shader look to the cheapest, and the only visible
consequence is that the grain lands coarser, which is closer to the references than the fine grain
was. The general form: **cost should follow the highest frequency a look can actually produce.**

### A ring of taps is not a blur

Ribbed's soft regions came out ropey — visibly stranded rather than smooth. The blur was eight taps
on two axis-aligned rings, which at the radii this look reaches (around 40px) is not a blur at all:
it is **eight sharp copies of the image at fixed offsets**, and neighbouring pixels put their copies
in the same eight directions, so the eye assembles them into strands.

Three changes, each fixing a different cause:

- **A golden-angle spiral instead of rings**, with `sqrt` spacing, so the samples cover the disc
  evenly rather than sitting on two circles with a hollow between them.
- **Weight falling off toward the rim**, so the sampled disc has a soft edge instead of a hard cut —
  a hard-edged kernel leaves a visible boundary wherever the blur radius changes.
- **The whole pattern rotated by a per-screen-pixel hash.** This is the one that kills the strands:
  aliasing only reads as structure when it lines up between neighbouring pixels. Rotated per pixel
  it becomes fine static grain, which this look already carries.

The general form: **under-sampling is not the problem, correlated under-sampling is.** Sixteen taps
still cannot properly filter a 40px radius, but decorrelated they read as grain rather than as rope.
Cost went from 64.0 to 67.2 ms/frame on CPU raster despite going 9 → 16 taps, because the sharp
regions early-out before sampling at all.

### Poster picks cells by local contrast

Selection used to be by **rank** — draw the top N% most distinctive cells, where distinctive meant
"far from the image's average colour". Rank fixed a real problem (an absolute threshold left a
gradient with one small subject empty at a level that filled a busy cover completely) and created a
worse one: **rank always draws a fixed fraction, whatever is in the frame.** Point it at a clear sky
with a few kites and the kites come first, then the next 20% of cells in line are all sky, and the
background fills with faintly-different blue squares. There is no level at which it stops, because
the fraction is the input.

Three passes to get this right, each killed by the next:

1. **Distance from the image mean, ranked.** The original. Fills any low-content frame.
2. **Distance from the ground colour, as a z-score, with an absolute floor.** Much better — the sky
   went flat and the kites stood alone. But a sky has a *gradient*, and its top and bottom are
   genuinely far from any single ground colour, so a band of pale blue blocks appeared along the
   bottom edge. No global colour can fix this; the frame does not have one background colour.
3. **Local contrast** — how far a cell sits from its own neighbourhood. What makes something read as
   a subject is that it differs from what is *around* it. A gradient matches its surroundings
   everywhere, however far its top is from its bottom; a kite matches nothing near it.

Local contrast then has its own trap, and it is the same trap as (2) one level down: **a mean is not
robust to the outliers it is being used to find.** Taking each cell's distance from its
neighbourhood *mean* let a single kite drag the mean of every neighbourhood it fell into, so the
sky cells around it scored high too and every kite came out wearing a five-cell halo of sky-coloured
blocks. Against a background this smooth there is no local variation for that contamination to hide
in. The measure is the **median** distance to the 24 neighbours: the kite cell sees 24 neighbours of
sky and scores high, the sky cell beside it sees 23 of sky and scores nothing. Insertion-sorted in
place, since this runs per decoded video frame — `buildPoster` costs 1.84ms.

Measured on a sky-with-kites frame, cells that can ever draw fell from 14.9% to 1.2%, and the screen
stays flat ground at every level including full. On ordinary artwork it is unchanged in character —
10.2% in silence, 18.6% at peak — because a busy frame has local contrast everywhere.

### Ripple was saturated, not fast

"Too frantic, too jumpy, too sensitive." Measured on ordinary music the depth envelope sat pinned
between **0.80 and 0.97** — the water was always at full depth, and every bass transient was a jolt
at the top of a range it had already run out of. It read as frantic because there was nothing left
for it to do but twitch.

The same `resp()` saturation as the Cyanotype development, and the same fix: its own gentler curve,
`pow(bass * (0.50 + gain * 0.26), 0.85)`, which spreads the depth across 0.09 → 0.81 over the bass
range. Four other things came down with it — the envelope from 0.18s/0.55s to 0.55s/1.30s, the
reactive share of the displacement roughly halved, dispersion off the twitchy high band cut from
0.55 to 0.30, and the base phase rate slowed.

**A ring on every beat is a barrage.** Rings fired on every detected onset, four alive at once, so
on anything with a fast beat the surface never settled between them — four overlapping ring trains
is most of what "frantic" meant. There is now a 1.15s floor on the gap, and the rings themselves are
gentler and slower (amplitude 0.8 → 0.42, spatial frequency 26 → 18). Over 20s at 150bpm: 49 beats
now launch 12 rings rather than 49.

Net, on the same clip: on-screen change per frame **mean 6.11 → 3.22, peak 6.85 → 3.61**, and the
worst per-frame step in the depth envelope 0.0384 → 0.0131.

### Cyanotype: the process is a state, not a cycle

The first version put the process on a clock — `cyanoCycle` advanced with the music and wrapped. It
was wrong for a reason worth keeping: **a clock will always eventually fade the print during a
chorus.** Nothing about elapsed time knows whether the song is loud right now, so the moment the
image chose to dissolve was uncorrelated with the music, and the look read as decorative rather than
reactive however smooth the fade was.

`cyanoDev` is now a *position in the process* that the music moves in both directions. Sound is
light, so it exposes the print toward a finished blue; quiet is the absence of light, so the print
slides back toward the raw violet sheet. Fading only ever happens when the music is quiet, because
quiet is the only thing that causes it.

Two terms drive it: instantaneous `light`, and `cyanoSustain`, a 6s memory of it, so a section that
stays loud pushes further than any single instant of it would while a stab in a quiet passage lifts
the print and lets go. The follower is asymmetric and slow on both sides — 2.6s up, 7.0s down —
because the *position* should follow the shape of the song, and beat-scale movement belongs to the
pulsing highlights, which are a separate mechanism. Measured against a scripted song arc:

| passage | `A.level` | settles at |
|---|---|---|
| silence | 0.00 | 0.06 — raw violet sheet |
| quiet intro | 0.22 | 0.31 — violet print, pre-wash |
| verse | 0.50 | 0.64 — washed, blue |
| chorus | 0.85 | 1.00 — finished, deep |
| breakdown | 0.05 | 0.28 — drifts back to violet |

**Don't drive a full-range state through `resp()`.** That curve saturates hard by design — its job is
to make quiet music move — and through it a quiet intro already read as half developed while an
ordinary verse pinned the print at finished, so it never moved again. The development gets its own
gentler curve, `pow(level * (0.55 + gain * 0.30), 0.80)`, which still honours the sensitivity setting
but keeps the range. Same lesson as the soft-knee fix, from the other side: a curve tuned for
sensitivity is not a curve tuned for range.

**Stage order is what makes the retreat smooth.** Running down unwinds depth, then the blue draining
back to violet, and only then the image fading off the paper. That ordering is load-bearing:
unwinding the exposure while the print is still blue drags the tone through the steep part of the
blue ramp and lurches — the earlier cyclical version hit a 33-unit jump in mean frame colour in a
fifth of a second doing exactly that. By the time exposure unwinds here the palette is the gentle
violet one, so no separate machinery is needed. The general form: **when a ramp drives something
through a non-linear map, the perceived rate is the map's slope, not the ramp's** — either linearise
the map or arrange for the ramp to move where the map is flat.

**Deepening needs the top half of the range and a colour, not just a gamma.** Sharing the range
evenly left the print fully blue by 0.6, and the last 40% of the scale changed nothing measurable —
a verse and a chorus landed on the same frame. `deepen` now spans 0.52–1.00 and interpolates the
palette's dark end from a fresh, greyer rinse to full Prussian, which moves measured contrast
77 → 83 → 92 across dev 0.60 → 1.00.

### Dappled light

Silence used to mean stillness. The quiet end of the process now carries light through moving
leaves — a sharpened fbm whose *sample coordinate* is swayed and drifted, so the patches rock and
travel like branches rather than the whole frame breathing in place. Travel is the part that reads:
amplitude alone is invisible at this subtlety.

It feeds the exposure threshold as well as the final brightness, which is what makes it look like
light falling on the sheet rather than a texture laid over the picture — where the light lands, the
paper exposes a little further.

It is gated by `1 - level`, so it fades out as the music takes over and never competes with the
pulsing highlights the finished print is built around. Measured: 1.66 mean pixel change over 3s in
silence against 0.76 at the same development with the music loud, while the pulsation at a finished
print runs 2.89 per 220ms — three orders of pace apart, which is the intended hierarchy.

The look button opens a picker; space steps through the live looks, skipping hidden ones.

### Cyanotype's two decisions

A photogram has **no inherent polarity** when the input is an arbitrary picture. What should stay
paper white is whatever object lay on the sheet, and an image does not say. The rule that always
produces the reference's character — deep blue field, luminous forms — is that the *ground* exposes
to blue and the subject stays pale, so polarity follows the image's median tone rather than being
fixed. A dark cover and a bright one then land in the same aesthetic instead of one coming out as
the negative of the other.

Luminance is also **stretched to the image's own percentile range** before thresholding. An
absolute threshold has almost no room on a dark image: its ground sits near zero, the soft
transition band is wider than the space beneath it, and the ground can never read as fully exposed
no matter where the threshold goes.

**Every look needs an idle, not just a reaction.** With a still image and silence, whatever is
driven purely by audio simply stops. Measured as mean pixel change over a second with the audio
frozen, Poster was rendering an identical frame forever (0.00) and Cyanotype and Ripple were close
to it. Each now carries a slow clock of its own — Poster's rows sway and its cells breathe across
the reveal threshold, Cyanotype's coating wash creeps and its exposure breathes, Ripple keeps a
visible base swell — so a still cover is alive before a note plays. Video sources hide this
entirely, which is why it only shows on stills.

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

### Full screen

iPhone Safari implements no Fullscreen API at all — only `<video>` elements can go fullscreen
there. iPad and desktop Safari do support it. The button feature-detects and, where there is no
API, points at Add to Home Screen instead: iOS launches that in standalone mode with no browser
chrome, which is the experience the button is really promising. Both pages carry the meta tags
that make that launch full-bleed, and the button removes itself when already running standalone.

Worth knowing if you touch this: the original code was
`(el.requestFullscreen || el.webkitRequestFullscreen).call(el)`, which on iPhone is
`undefined.call(...)` — so the button did not fail quietly, it threw on every tap.

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
- **Modulate what a field does, not what it is.** Scaling the individual terms *inside* the water
  height field by the audio level changes the shape of the surface as the music moves, so it morphs
  instead of flowing. The wave structure is constant; the level drives `amt`, the refraction
  strength, which scales the whole field uniformly and reads as depth rather than as warping.

## Video sources

Drop or pick a video instead of an image and it becomes the source. It is muted, looped, and played
inline, and the palette is re-derived a couple of times a second so the colours follow the footage.
Everything else — every look — works unchanged.

Two things keep a full-resolution phone clip from stuttering:

- **Everything reads from one bounded working copy** (`SRC`, capped at 512px), never from the media
  element. The source used to be touched four separate ways — the crushed copy every frame, the
  palette and the Poster grid on a timer with a `getImageData` readback each, and the WebGL texture
  upload every frame. On a 4K clip every one of those is enormous, and the palette and grid work ran
  whichever look was on screen, which is why changing look didn't help.
- **New frames are detected with `requestVideoFrameCallback`**, which fires once per decoded frame.
  Phone video is typically 30fps against a 60Hz display, so half the display frames show a picture
  that hasn't changed. `currentTime` is useless for spotting this — it advances on about 95% of
  display frames regardless. With rVFC the video path runs on roughly a tenth of frames instead of
  all of them. Where rVFC is missing the work simply runs every frame, as before.

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
- A **two-stage envelope follower** on each band (`ENV_ATTACK` / `ENV_RELEASE` / `ENV_GLIDE`).
  Dividing by the running deviation is what gives quiet music its range, but it also multiplies the
  FFT's own frame-to-frame noise by 1/sd — on ambient material, where the deviation is genuinely
  tiny, that turned into jitter. A deviation floor caps the gain; an asymmetric follower (fast
  attack, slow release) smooths what remains; and a second symmetric glide stage removes the
  velocity kink where the follower switches direction. One pole alone is continuous in value but
  not in slope, and that corner is what still read as a jolt. On a pad with realistic frame noise,
  jitter per frame is 0.0177 under peak-only and 0.0035 here, with usable range up from 0.141 to
  0.566.
- `beat` is a **followed** value, not a hard set. Slamming it to 1 on each onset put a step of ~0.96
  into a single frame, and anything sized by it — the Lens circles most visibly — popped. It now
  chases the sharp internal value, cutting the worst frame-to-frame step to 0.147. `beatFlash`
  stays instantaneous, because triggers want an edge.
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
