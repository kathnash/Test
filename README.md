# Sound reactive animation playground

Two pages that listen to audio and animate to it in real time. No build step, no dependencies,
no server.

- **`index.html`** — spectrum-driven visuals (Bloom / Particles / Ribbon)
- **`album.html`** — the playground: an image or video reworked by nine sound-reactive styles
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

In `album.html`: drop images or clips on the page, paste them, or open **Media** and add them there
— several at once is fine. **Space** cycles the look, **G** opens the style gallery, **X** shuffles
the media, **M** opens the library, `F` toggles fullscreen.

### A library, not two slots

Two pictures was the wrong shape for how this gets used. A DJ set is ten clips, not two, and what
you want mid-set is to reach for a different one without going back through a file picker. So the
library holds everything and two slots say which of it is on screen: the *Media* panel lists what is
loaded with a **1** and a **2** on each tile, and *Shuffle* re-draws both slots at random — never the
same clip twice, and trying for a different pair than the one already showing.

**Everything is scaled down on the way in**, which is the whole answer to whether a large upload
hurts. The working copy every look samples is capped at 512px on its long edge *already*, so a
6000px photograph is thrown away before it reaches a shader either way. Keeping the library copy at
1024 leaves that headroom to spare and costs about 2.8MB a picture decoded, where the original would
have cost 96MB — ten of those is the difference between 28MB and most of a gigabyte, which is the
difference between working on a phone and not.

**Only what is on screen decodes.** Videos not in either slot are paused, and their frame callbacks
throttled: ten paused clips are cheap, ten playing ones are not, and nothing off screen is being
looked at.

**A slot number is a toggle, not just an assignment.** Tapping the **1** on a tile already showing
as image one used to reassign slot one to itself — a no-op that gave no way to clear a slot without
picking something else to replace it. It now clears that slot if the tile already holds it, and sets
it otherwise, and the two slots are independent: clearing image one leaves whatever is in image two
exactly where it was. There is deliberately no fallback that promotes the remaining picture into the
empty slot — the canvas just keeps showing what it already had, and the freed slot is filled again
the ordinary way, by adding new media or tapping another tile.

**The file picker takes more than one file now.** Drag-and-drop and paste already looped over
every file handed to them; the OS picker dialog itself was missing the one HTML attribute
(`multiple`) that tells it to allow more than a single selection.

Eleven looks are live. Four more — **Drift**, **Swirl**, **Glitch** and **Marble** — are fully
implemented but carry `hidden: true` in the `LOOKS` array, which keeps them out of the picker
without deleting any code. Removing that one word brings a look back.

Poster, Sampler, Swirl and Glitch paint over the artwork on a 2D canvas; Blur, Punch, Dots, Fields,
Chomp, Ripple, Ribbed, Marble, Lens and Cyanotype bend or remap it as a texture in a fragment shader
(`fx.js`).

**Tone** — Cyanotype's chemistry and Fields' ground both take a tone from the *Tone* chip: Blue
(the original cyanotype), Green, Yellow or Red. One choice sets the whole ramp rather than exposing
shadows and highlights separately — the four printed tones follow a hue arc, not a straight line
from paper to deep, and two independent pickers would let that arc be broken in ways no darkroom
process produces. The chip only appears on the two looks that read it.

**A second picture** can be loaded with the *2nd image…* chip — image or video, same as the first;
the same button removes it. **Every live look has a two-image behaviour**, and none of them require
it: with one picture loaded they all work exactly as before.

| look | with a second picture |
|---|---|
| Poster | a wandering *cluster* of layer-two cells that bursts open on a transient |
| Sampler | nothing — the swatches read the picture that is on screen, so the second one arrives by shuffling |
| Blur | an upright oval of layer two floating centre-frame, defocused by the same kernel |
| Punch | layer two shows through the cut holes |
| Dots | every dot takes its colour from layer two; the invented hues are the no-second-picture default |
| Fields | some of the cutouts are layer two |
| Chomp | what the bites reveal, instead of the backlit sky |
| Ripple | ink dropped in water — absent when quiet, arriving as a droplet, spreading and dispersing with the swell |
| Ribbed | the two ride a conveyor behind the glass, one panel per screen width, running left |
| Lens | circles trade pictures on a music-driven shuffle, each on its own clock, crossfaded |
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
- **Chomp** — the media as a leaf, eaten through by the music: a union of a handful of wobbly,
  irregular blobs (Fields' construction, with the nearest-blob partition swapped for a smooth
  minimum, so bites merge into each other instead of staying separate windows), each with a browned
  rim where the tissue has gone. No second picture reveals a soft backlit sky; a second picture
  shows through instead.
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
- **Sampler** — the picture full-frame and completely still, with five colour swatches down the
  centre. Each swatch owns a circle drifting over the picture and wears whatever colour is under it,
  so the only thing that ever moves is where the colour is being taken from. Sound speeds the
  drifting and nothing else — and each circle answers a different band, so a bass line moves the
  bottom swatch while the top one keeps to its own pace.
- **Cyanotype** — a contact print, running the actual darkroom process, with the music as the light
  source. Sound exposes the sheet: a dusty violet coating, the image burning in, the water wash where
  the Prussian blue arrives all at once, then the deepening as the pigment oxidises. Quiet reverses
  it, so the print sinks back toward violet in the gaps and develops again when the song returns.
  Exposure and edge softness follow the music on top of that, so the pale shapes bloom and their
  edges travel between crisp and dissolved. In the quiet, dappled light moves across the sheet.

### A lens inverts, and a conveyor cannot

Ribbed's flute is a real cylindrical lens, and the inversion is what makes a subject drifting behind
a static pane read as glass: things slide backwards within each rib and jump between them. Put two
pictures on a conveyor behind that pane and the inversion turns into a fight — **the panels travel
one way while the content inside every rib travels the other**, and the eye reads the conflict long
before it reads the glass.

Reversing the belt does not fix it, because the panel seam and the rib content are both driven by
the same coordinate: flipping it mirrors both and the disagreement survives. The two are only
reconcilable by dropping the inversion, so the belt gets the uninverted mapping and the
single-image pane — which has no belt to disagree with — keeps it. Measured by cross-correlating
frames 2.5s apart, the frame now moves a clean −23px: one direction, leftward.

### An ink drop has to be able to leave

Ripple's second picture was a shape whose radius tracked the swell, which meant it was always there,
just larger or smaller. What it needed was to be **absent below a threshold** and to *disperse*
rather than shrink on the way out.

Absence is a floor: `ink = (swell − 0.12) / 0.72`, clamped, so quiet water is clean water. Dispersal
is the more interesting half. The plume is a domain warp — noise applied to the sample position
before its distance is measured, which is what grows fingers where modulating a radius by angle only
ever gives a lumpy circle. Giving the **warp a floor while the radius has none** is what makes it
wisp: as the drop shrinks, the noise stops being a perturbation of a disc and becomes most of the
shape, so it breaks up and disperses instead of contracting as a solid blob.

Measured as the fraction of frame that is the second picture: 0% at rest, 1.7% at a quarter level,
8%, 26%, 44% at peak.

### Three ways a grid loop can be wrong

Punch, Dots and Fields all step over a cell grid, and each one wanted a different neighbourhood.
Getting it wrong costs correctness in one direction and 9× the work in the other.

**Punch was clipping its own holes.** It tested only the cell a pixel fell in, so a circle that grew
past half a cell was cut off at the cell wall — and growing past half a cell is exactly what a pulse
does, so the holes were being cropped at their widest. This is the Marble bug again, and the fix is
the same: search a 3×3 neighbourhood and keep the nearest surface.

That fix then cost 9× the noise, because the hand-cut wobble was being evaluated for all nine
neighbours. **The wobble is under 3% of the radius** — far too small to change which circle is
nearest except in a band thinner than a pixel. So the search runs on the plain radius and the wobble
is applied once, to whichever circle won: 134ms → 99ms, same picture.

**Dots never needed a neighbourhood at all.** A dot's centre wanders at most 0.29 of a cell and its
radius tops out at 0.18, so it cannot reach the cell wall — the eight neighbours could never
contribute anything. Dropping to a single cell took it 131ms → 88ms *while adding* four texture
samples per dot for shape detection. Worth checking the arithmetic before reaching for the loop:
keep jitter plus radius under half a cell and one cell is exact.

### Dots find shapes by local contrast

"Distance from the artwork's dominant colour" was the obvious salience measure and it failed for the
same reason it failed in Poster: **a clear sky is a gradient**, so its top and bottom are genuinely
far from any single colour, and dots scattered evenly across it. Local contrast — the patch under
the dot against four patches a cell away — separates a kite from the sky it hangs in, because what
marks a subject is differing from its *surroundings*.

A dot that lands on background is dropped outright rather than dimmed. A translucent dot reads as a
mistake; an absent one reads as the field having moved on. So each reshuffle leaves the survivors
collected on the shapes, and they migrate as the shapes do.

### Cost follows the highest frequency a look can produce

Fields joined Blur on a reduced backing store — large flat forms whose only fine detail is grain, so
it does not need the resolution a look that resamples sharply does. At 0.80 width it went
**128ms → 82ms**, from the most expensive look to mid-range, with no visible change.

Punch is deliberately *not* on the list. Its cut edge is a pale hairline, and softening that is the
one thing that look cannot afford.

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

### Ripple was never actually rippling

All of the above was tuning, and it kept not being enough: "the distortion happens in a quick
moment and then it stops, and moves on to the next one." That is not a description of a badly tuned
ripple. It is a description of something that is not a ripple at all, and it was right — three
structural faults, none of them reachable by adjusting a constant.

**The rings did not travel.** A drop's envelope was `exp(-d * 2.4)` about its own centre, so the
whole concentric pattern existed everywhere from its first frame and then faded in place. Nothing
ever moved outward. Combined with `exp(-age * 2.2)`, which is ninety percent gone in a second, what
you saw was a brief shimmer at a point. A wavefront needs its envelope anchored to the *front* —
`exp(-((d - age*speed) * k)²)` — so the band travels and the water inside it goes quiet behind it.

**Sound scaled the whole displacement field.** Every reactive term went into `amt`, which multiplies
the entire gradient, so a hit moved every pixel of the frame at the same instant. That is a flinch
of the whole image, and no amount of timing makes a flinch read as a ripple. The music now *launches
rings*, which are local, travel, and outlive the sound that made them by seconds. `amt` carries only
a phrase-scale swell and a bar-scale breath, both far too slow to register as an event.

**Two rings in three were born off-screen.** Drop x was drawn from `0.15..1.35` in the shader's
aspect-corrected space, which suits a landscape frame — a portrait phone is only `0..0.56` wide, so
most rings were born outside the picture and arrived as a vague swell from off the edge. They are
plain uv now, scaled by the shader. Poster's swell and Cyanotype's developer read the same uniform
and had a hard-coded `/1.6` for the same reason; both are fixed.

Three things worth keeping from the retuning that followed:

- **Speed is set by the frame, not by taste.** A ring from the centre of a portrait phone reaches
  the near edge at 0.28 units and the far corner at 0.58. At 0.24 units/sec it is gone in two and a
  half seconds, which looks like stopping. At 0.11 it spends five or six seconds crossing.
- **Steepness is frequency times height, not height.** What gets displaced is the *gradient*, so a
  ring at 24 cycles and full amplitude was fifteen times steeper than the entire standing swell — a
  lens sweeping over the picture. Broad and shallow (15 cycles, a third the height) is both gentler
  and more like slow water. Raising the amplitude without dropping the frequency took mean on-screen
  motion from 8.1 to **21.8**, worse than where it started.
- **A ring is only legible against water calmer than itself.** The standing swell was some five
  times a ring's amplitude, so a ripple crossing it perturbed an already busy surface instead of
  being an event. Halving the background did more for both calm *and* clarity than anything done to
  the rings.

Net: mean on-screen motion **12.34 → 6.84** with its spread up **0.485 → 0.688** — a little under
half the movement, and much more of what remains arriving as events rather than as churn. A single
ring, measured against a frozen surface, now has its crest at r = 0.07, 0.11, 0.25, 0.29 at one, two,
three and four seconds, and is still legible at five.

**Then the ceiling went up to one ring a second, and two numbers had to move with it.**

*Total agitation is the ring count times the height of one.* Raising the rate from one every 1.7s to
one a second, and the slots from four to six to hold them, is half again as many rings alive at
once — leaving their height alone simply made the water half again as busy. Measured, mean motion
went **6.8 → 17.4**, worse than the frantic version this all started from. Scaling each ring's
height down by the ratio of the slot counts brings it back to **8.65**. The slot count and the
spacing are the same decision seen twice: the spacing sets how far back the oldest ring can be
before it is evicted, so one a second wants six slots the way one every 1.7s wanted four.

*Which beats qualify should be musical, not a metronome.* With a grid, the downbeat and the beat
halfway through the bar — the two you would actually feel. At 120bpm in four that is one a second on
its own, so the ceiling is a limit rather than a rate, and a slower tempo gives fewer. Without a
grid, any strong onset, with the ceiling doing the work. One detail worth the comment it carries in
the source: the gate is 0.95s, not 1.00s, because those two beats are *exactly* a second apart at
120bpm and a ceiling set to the interval it means to admit rejects half of them on rounding alone.

**Size and height are separate questions, and want separate evidence.** Height comes from level.
Size comes from what kind of sound it was — low against bright, so a kick drops a big stone and a
hat drops a pebble, and size then sets wavelength, speed, reach and lifetime together. Read from the
*instantaneous* spectrum, not from `A.bass` and `A.air`: those are envelope-followed with a 280ms
release, so the previous hi-hat is still half present when the kick lands and every hit measures as
the same mixture. Measured on the demo, the envelopes gave sizes spanning 0.65–0.85 where the raw
spectrum gives 0.61–1.00.

Note which way frequency moves with size: *down*. Steepness is frequency times height, so holding
those roughly equal across the range is what stops a small ring from being a sharper distortion
than a large one.

### It is a swell, not a droplet

All of the above optimised the wrong mechanism. "Quiet reacts too dramatically and loud doesn't
react enough… it's not a ripple from a water droplet, it's a swelling of the water… if a note is
held I want it to keep growing." Three separate faults, and the rings were the least of them.

**Rings were the wrong subject.** The reactivity had been deliberately moved *out* of the global
displacement and into travelling rings, because a hit applied globally reads as a flinch of the
whole frame. That reasoning holds for a *hit* and is exactly backwards for a *swell*: a swell is
the water itself rising, so it is supposed to be everywhere at once — it just has to move over
seconds instead of instants. The global term carries the effect again, and the rings are demoted to
supporting texture at a third of their previous height.

**The engine compresses; a look about dynamics has to re-expand.** Bands are measured relative to
their own recent behaviour precisely so quiet music still moves, and `resp()` lifts the bottom
further. Both are right for a look that should twitch on any material and both are fatal here: the
quiet end arrives already most of the way up. The swell instead tracks a slow floor and ceiling of
the level and asks where the music sits *between them*, then squares it. Quiet ends near nothing,
loud near everything, and the gap is the effect. Measured quiet-to-loud on-screen motion went from
under 2x to **6.29x**. The sensitivity control moves the exponent rather than multiplying the
result, so turning it up gives quiet material more room instead of clipping loud material.

**An envelope follower cannot express "held".** It reaches its target and stops, so two seconds of
a loud chord looked identical to the first instant of it. The swell adds an integrator alongside the
follower: it accumulates while the level is above a floor and bleeds away below it. A brief stab
peaks at **0.53**; the same loudness held for ten seconds climbs to **1.00** over about five, then
ebbs over five more. That difference is the whole of what "hold that note" asked for.

**A rise detector needs a band-pass, not a difference.** Surges fire on the music getting louder
rather than on a beat, which needs the *change* in level — but the level wobbles on every beat, so
comparing it against a slow average crosses the threshold four times a bar and puts the surges
straight back on the beat they were moved off. Smoothing the fast side first (0.55s against 1.9s)
leaves only changes that outlast a beat, which is what a crescendo is and what a snare is not. That
one change took mean on-screen motion from 10.91 to **4.18**.

**And a crescendo must not fire the whole way up.** The slow reference chases a big rise for
several seconds, so a single swell spawned five surges in a bunch. Setting the reference to the
level just reached means a long crescendo has to climb another step to earn the next one.

Net against where Ripple started: mean on-screen motion **12.34 → 4.18**, its spread **0.485 →
0.679**, and a dynamic range from quiet to loud of **6.29x**. Nothing in the look is driven by the
beat grid any more.

### Light is free; movement is not

With the swell right, the beats had gone missing — nothing in the look answered at beat rate at all.
Putting them back without undoing the calm came down to one distinction that generalises past this
look: **a highlight that brightens moves nothing.** Frantic was never about how *often* something
responded, it was about how much geometry moved when it did.

Two beat-rate responses were added and then traded against each other, measured by freezing the
scene and toggling the beat between 0 and 1:

| | mean motion | brightness lift on a beat |
|---|---|---|
| no beat response | 4.18 | — |
| tremble-weighted | 8.37 | 6.54 |
| glint-weighted | **7.21** | **10.58** |

Shifting weight from the surface tremble to the caustic glint bought *more* visible beat for *less*
movement, which is the whole lesson. The tremble that remains is deliberately high spatial frequency
and a twentieth of the swell's amplitude — it stirs surface texture and leaves large forms alone,
where the frantic versions were scaling the entire displacement field and lurching every big shape
in the picture at once.

**The glint had silently gone out, which is why brightening it did nothing at first.** It maps
height onto 0..1 as `h * 0.5 + 0.5` and then raises that to the seventh power — written when the
standing swell ran to about 1.0. Halving that field to make the surges legible left crests reaching
only 0.72, and 0.72<sup>7</sup> is a tenth of 1.0. Rescaling the map *and* opening the exponent from
7 to 4.5 was needed: at the seventh power the glint lived on perhaps a twentieth of the surface, so
making it brighter made almost nothing brighter.

**The beat term rides the swell rather than standing alone.** A beat that hits equally hard in a
quiet passage and a loud one is the same imbalance the swell was rebuilt to fix, arriving by the
back door. Measured lift is 5.3 levels when quiet and 10.6 when loud.

### The same thinking, translated to Fields

Fields is blobs forming a silhouette of the picture — clouds, land masses, things under a
microscope — and it should be *quaint and relaxing, watchable all day*, where Ripple is cool and a
little edgy. Same three ideas, different constants and a different place to put the light.

**The range expansion is a property of the music, not of a look**, so it is computed once and both
looks read it. Everything after that is per-look, because a swell of water and a field of blobs want
very different pacing from the same signal. Fields runs the same immediate-plus-integrator pair on
roughly triple the constants: it reaches full size over about six seconds and is still two-thirds
open four seconds after the music drops, where Ripple is nearly back down. "Watchable all day" is
mostly a statement about time.

Its sustain threshold is *lower* than Ripple's, though. Water can sit flat through an ordinary
passage; a field of blobs that only wakes up for the loud parts is inert rather than restful.

**Nothing geometric is on the beat any more.** The radius jumped on the squared downbeat and a
second term swept a wave across the field once per bar — between them the sheet lurched twice a bar.
A blob is a soft body and soft bodies do not accelerate. The size range came down with it, from
2.06x its resting size to 1.42x: size still answers the music, it just answers the way bread rises.

**The beat goes into a rim light**, which is Ripple's glint translated. A soft band just inside each
cutout brightens on the beat — light moves nothing, so it can answer every beat there is without
costing any stillness, and a bright edge is also what makes a shape read as a globule with a surface
rather than as a hole cut in paper. Lift measures 4.0 levels when quiet against 15.3 when loud
before trimming, settling near Ripple's numbers after.

Net: mean on-screen motion **3.86 → 2.12**, spread **0.480 → 0.539**, quiet-to-loud range **7.36x**.

One implementation note worth keeping: the shader is a JavaScript template literal, so a pair of
backticks inside a *comment* in the GLSL — quoting a variable name, in prose — terminates the string
and the rest of the shader is parsed as JavaScript. The error surfaces as `Unexpected identifier`
naming some GLSL variable, and then `FX is not defined`.

#### The response should travel, and the glow was wrong

Two corrections, one of them to a thing that had just been added.

**The rim light was a feature where it should have been a texture.** Ripple's glint translated
across the *mechanism* correctly and the *intent* not at all: it made the beat a main element of a
look whose subject is slow shape. Cut to about a fifth — enough to give an edge some thickness, not
enough to read as an effect. Measured lift on a beat went from 15.3 levels to **1.8**.

**Every shape answering at once is one gesture, however slowly it happens.** The swell now arrives
in a region that drifts across the field, so there is always a part opening and a part settling
while the rest carries on. Two things this needed that were not obvious:

- *The drift rate is the whole thing.* At a two-minute circuit the region is not slow, it is
  stationary — measured over half a minute, the busiest sixth of the frame never once changed. At
  around forty seconds it crosses in twenty or so, and the busiest region moves 14 times in 26
  samples across 3 of 6 regions. It is on `uTime` at a fixed rate, not a music-driven one, because
  multiplying time by a changing rate displaces the whole path the instant the rate changes.
- *Fewer shapes answering means each must answer further.* Keeping the old per-shape amount while
  only a third of the field participates took total motion from 2.12 to **0.63** — most of the
  reactivity simply disappeared. The focus term is correspondingly large, with a smaller share for
  everyone else so the rest of the sheet is not switched off.

**And nothing is ever completely still.** The blob centres drift, and each shape breathes, on
`uTime` rather than on the morph clock — so the field moves at the same gentle rate whether or not
anything is playing. Measured motion in silence is 0.55 against 0.79 with music: clouds do not stop
when the room goes quiet.

Net for Fields: motion **3.86 → 0.79**, quiet-to-loud range **4.37x**, frame cost down from 140ms to
122ms.

### Bars along the edges: what a texture does past the end of the picture

Fields grew vertical bars down the sides — one row of pixels stretched
sideways, which reads as TV static rather than as a picture. Every look that
displaces its sampling can produce this, and it comes from one line:

```glsl
return texture2D(uTex, clamp(uv, 0.001, 0.999)).rgb;
```

Clamping means every request past the edge returns the *same* outermost row of
pixels, so a single pixel becomes a slab. Measured against a test picture with
a magenta border and the same aspect as the frame — so cover-fit crops nothing
and the border really is the edge — **Fields turned 5.7% of the frame into
smear and Lens 18%**, with Lens' entire top row of circles solid border colour.

There are two causes and they want different fixes.

**Where the overflow is an accident, remove it.** Fields gave each cutout its
own view into the picture with `vz = 0.84 + hash * 0.34` and an offset of up to
0.15. Dividing by anything under one *widens* the coordinate range: at 0.84 the
frame edge asked for -0.095, and the offset took it to about -0.27. Nothing
wanted that. It now scales up rather than down (`1.16 + hash * 0.46`) and
offsets by exactly the room the scale leaves, less a reserve for the drift:

```glsl
float room = max(0.0, 0.5 - 0.5 / vz - 0.035);
```

An out-of-range sample is now impossible by construction, and the look loses
nothing — each shape still gets its own view, which is the entire point of the
offset. Magenta smear: **5.66% to zero.**

**Where the travel is the design, mirror it.** Lens drifts the whole image
behind its grid, Ribbed parallaxes it behind the glass, Blur reaches a radius
past every edge. All three are *supposed* to go beyond the picture, and cropping
them back to fit would have cost Lens about 1.5x zoom to keep its wander. So the
edge folds instead:

```glsl
vec2 edgeUV(vec2 p){
  vec2 q = mod(p, 2.0);          // GLSL mod is non-negative for +y
  return 1.0 - abs(1.0 - q);     // triangle wave, folded at both ends
}
```

What continues past the edge is more picture. A reflected sliver reads as
picture; a stretched row of pixels reads as a broken screen. Lens **17.94% to
2.13%**, Ribbed **7.46% to 1.00%**, Blur **3.24% to zero** — and what remains in
those numbers is the test picture's border being drawn *correctly*, since these
looks legitimately show the edge of the image.

Two notes on the mechanics. It lives inside `tex()`/`texB()` rather than at each
call site, because `softTex`'s sixteen-tap spiral goes through `tex()` and that
is exactly where a blur needs it — mirror is the standard edge rule for a blur
anyway, where clamp over-weights the edge pixel. And it is done in the shader
rather than with `MIRRORED_REPEAT`, which would be free in hardware but is not
available in WebGL1 for non-power-of-two textures, which these are. Cost on the
software rasterizer used for testing, where ALU is worst-case expensive: Blur
+12%, Ribbed +5%, Lens +4%, Fields +1.5%. On a GPU two extra ALU ops disappear
behind the texture fetch.

A measurement note: counting border-coloured pixels is only a defect measure for
looks that should not be showing the border. Sampler, Dots and Punch show the
picture's own edge by design and score non-zero both before and after; the
signal is the *change*, and the shape of what is left — a line rather than a
slab.

### The style gallery previews the real look, not a picture of it

A name is a poor description. "Cyanotype" and "Ribbed" tell you nothing about what *your* picture
will do in them, so the picker is a grid of live previews: the actual look, drawing the picture
that is on screen, in the state the music has it in at that moment.

Which means rendering ten looks that are not the current one, every one of which draws to the same
canvas the page is showing. Two things make that invisible:

- **The gallery is a full-screen panel over the canvas**, so the one frame in which a foreign look
  is drawn is behind an opaque sheet. There is nothing to see.
- **One preview per frame, not ten in a row.** Ten looks back to back is a visible stall on a
  phone; one a frame fills the grid in about a sixth of a second with no hitch, and the previews
  appearing one after another reads as loading rather than as freezing.

Only the looks in the picker are previewed, and that is load-bearing rather than tidy: Drift, Swirl
and Glitch are the three that run on the feedback buffers, so drawing one out of turn would leave
the *current* look's trail buffer full of someone else's frame. Everything in the picker draws from
scratch each frame, so there is no state to corrupt. No body-class change and no `FX.resize` are
needed either — a hidden canvas still renders, and `FX.render` re-sizes itself when handed a mode
it did not last draw.

**A one-frame render exposes anything that eases in.** Sampler's swatches start grey and ease toward
the colour under their circle over about a third of a second — invisible in use, but a preview *is*
that third of a second, so Sampler advertised itself with five grey rectangles. The first reading is
now taken whole and only later ones are smoothed. Anything whose look is an accumulated state has
this problem in previews; the fix belongs in the look, not in the gallery.

**A pending cell is held back, not shown.** An undrawn preview is filled with the artwork's dark
colour, which on a dark picture is indistinguishable from a real preview of a dark look. Pending
cells sit at 12% opacity and fade in when they have something in them, so waiting looks like
waiting rather than like a broken style.

And a measurement lesson, because it nearly cost an afternoon: the first test screenshotted the
gallery after a fixed 2.5 seconds and Cyanotype came back blank, which looked exactly like a bug in
that one look. It was not. Under SwiftShader a shader frame takes ~300ms against ~16ms on a real
GPU, so ten previews had not finished — and the pixel-statistics check that ran *after* the
screenshot disagreed with it, because by then they had. **The test was racing the thing it was
measuring.** Waiting on `thumbQueue.length === 0` rather than on a guessed interval makes it
deterministic, and all ten previews were correct all along.

### Chomp: a union of blobs, not a thresholded coastline

Chomp treats the media as a leaf and the music as something eating through it — organic holes that
reveal a soft backlit sky with no second picture, or the second picture with one. Built from a
photograph of caterpillar damage: a network of a few connected, irregular bites, not confetti and
not one smooth curtain.

**The first version was a single low-frequency sum of sines, thresholded** — the same construction
Ripple's ink field uses, for the same reason: an fbm sits wherever it happens to sit, and only a
field built to average zero lets one fixed threshold mean the same coverage on every picture. It
compiled, ran, and was wrong in kind. At any coverage worth looking at it produced one continuous
region sliding across the frame — a curtain, not bites — because a single scalar field thresholded
one way has no notion of "several separate things." A leaf eaten by a caterpillar is a handful of
distinct bites that occasionally run into each other, and that needed several shapes with their own
position and size from the start, not one field cut at a level.

**The fix is a union of wobbly blobs**, which is Fields' own blob construction with one change:
Fields picks the *nearest* blob per pixel (a hard partition, so its cutouts stay separate windows
by design), where Chomp takes the *smooth minimum* of every blob's distance at once, so two that
grow into each other fuse at a rounded waist instead of meeting at a seam. Six blobs on a jittered
3x2 grid (Fields' own cell-and-jitter placement), each with an irregular angular-harmonic outline,
its own slow breathing phase so six bites answering one passage do not rise and fall as a single
object, and a local boost near a strike so a hit opens a bite where it landed — the same
broad-swell-plus-localised-strike split every other reactive look here uses, because it already
answers "how is the passage going" and "did something happen right here" as two different questions that
want two different mechanisms.

**A rim band nearly as wide as the bites made every hole look drawn in marker.** The first pass set
the browned "dead tissue" edge to a band 0.05 units wide against blobs with a ~0.06 unit radius —
the rim was not a rim, it was most of the shape. Both the width (to 0.016) and the mix strength (to
0.55) came down to a fraction of that, and it reads as a thin edge now rather than an outline.

**The sky read as khaki, and the bug was the falloff coefficient, not the colours.** Isolated by
forcing the fragment colour to each intermediate value in turn — first the function's return, then
the gradient alone, then the glow alone — the gradient alone was correct blue at every sampled point
(measured `76,148,219` to `152,200,236` across the frame), and the glow alone, which should fall
away from the sun, was reading `160` to `251` out of 255 almost everywhere. `dot(d,d)` only reaches
about 1.3 at the far corner of a unit-scale frame; a coefficient of 0.9 barely dents an exponential
over that range, so even the corner farthest from the sun came back at glow 0.31 and the warm colour
was washing out the whole sky rather than sitting near one point in it. The fix was the exponent
(0.9 to 6.0), not the mix weight or the colours — a strong glow with the wrong radius still covers
everything, just more so.

Coverage answers `chompSwell`, built with the identical fast-in/slow-out/build-up shape as Fields'
envelope (a leaky store for a passage that stays up, a quick term for the instant, a stacking term
for a run of beats) — that shape already proved out as "answers a passage, not a beat," and there
was no reason to invent a second one. Frame cost measured 169ms on the software rasterizer used for
testing; given `MODE_SCALE` for the same reason as Fields, in the same 0.80 ratio, it came down to
109ms with no visible loss — the blobs are large, soft-edged shapes, exactly what survives a lower
internal resolution and a smoothing upscale.

### Sampler: the only thing that moves is where the colour is taken from

The picture fills the frame and does not move. Five rectangles sit down the centre and do not move
either. Each one owns a circle drifting over the picture, and wears whatever colour that circle is
over — so the composition is completely still and **the colour is the whole of the response**.

That is the point rather than a limitation. Sound changes the **speed of the sampling** and nothing
else: no scale, no opacity, no jump. A swatch crawling through a sky is one slow gradient; the same
swatch at seven times the rate picks out the whole picture. Silent to loud is **8 px/s to 48 px/s**
of circle travel, which shows up as roughly **2 to 250** levels of colour change per second.

**Each circle answers a different band, not the level.** Five circles following the level would
speed up and slow down together, which is one reaction drawn five times. Split by band — air, high,
the overall level, mid, bass, top to bottom — a bass line moves the bottom swatch while the top one
keeps drifting at its own pace. Each band gets its **own** slow floor and ceiling, expanded exactly
the way `musicDrive` expands the level, because the bands are already measured against their own
recent behaviour upstream: a shared floor would say nothing about whether the top end is loud *for
the top end*.

**The paths are integrated phases, never `time * rate`.** Written the other way, every loud passage
would begin by teleporting the swatches to a colour from somewhere else in the picture, because the
position would depend on the rate current now rather than on every rate it has had.

**Penning the circles into the margins cost the look its subject.** The first pass kept them either
side of the column so nothing could ever pass behind a rectangle. On a picture with a big even sky
the margins are the part with nothing in them, and three of five swatches came back the same blue.
Five swatches that agree are one swatch drawn five times. They roam the whole frame now and the
rings are drawn *over* the rectangles, at which point the occlusion problem stops existing.

**A swatch that vanishes is the mechanism working.** Measured against a blue sky the rectangle came
back `23,50,124` on a ground of `22,47,119` — invisible. A hairline at 24% white keeps the
composition on screen whatever the picture does, and disappears into it when it does not.

**The chip proportions come off the reference collage**, not from arithmetic: each is 8.9% of the
frame's height and 1.55 times as wide as it is tall, the gaps are three quarters of a chip, and the
column comes to about 71% of the height. The first pass had them at 3:1, twice as wide as the
reference, which turned a column of paint chips into a stack of bars. Height sets the size and width
only caps it — the way round that survives both orientations — and the consequence is that on a wide
frame the chips are a modest 9% of it, because the column's height is already spoken for.

Sampling reads a **96px cover-fit miniature** in the canvas's own aspect, so a screen position maps
straight to a pixel with no further transform. Whole-sheet, once per source change, rather than five
1x1 readbacks a frame: at that size the pixels are free and the call overhead is not. Small on
purpose as well — a circle a few percent of the frame across should report the colour of the *area*
it covers, not of the one pixel at its centre, and downscaling is the cheapest box filter there is.
Verified against an image of hard colour quadrants: every swatch reports the quadrant under its
circle to within one level.

### Lens: state the rate as the thing you can see

Circles trade pictures on a shuffle clock. Each re-rolls its choice once per unit of that clock on
its own offset, and only about half of those re-rolls land on the other picture — so what is
actually visible is `rate x circles x 0.487`, not the rate. Setting the rate directly gets both
parts wrong.

**It was far too fast**: one circle turning over every **0.4s**, where the intent was something you
notice rather than something you watch. Now one every **2.1s** at full loudness, and effectively
never when quiet — `musicDrive` rather than `resp()`, so the quiet end is genuinely near zero
instead of merely under a threshold.

**And it depended on the screen.** The grid is five rows by however many columns the aspect gives,
so a desktop carries about forty circles where a phone carries fourteen — the same setting shuffled
three times as often on a desktop. The rate is now expressed as visible swaps per second and divided
back out by the circle count, which is a number the page already knows.

A measurement note, because the first attempt was wrong in a way that looked plausible: counting
"cells that changed a lot" reported swaps four times faster than the clock could possibly produce
them. The circles also *pulse in size* with the music, which moves a great many pixels at their
edges regardless of which picture is inside. Classifying each cell by **which picture it is showing**
and counting the verdict flipping is the measurement that answers the question asked.

#### Fields: the build, and a cell size that was a ratio when it should have been a size

**The rim light is gone**, not dimmed. It had been reduced twice and was still wrong in kind rather
than degree: it put the sound onto an edge, which is the one part of a torn-paper shape that should
look cut once and left alone.

**Beats build.** Each one feeds a store that leaks away, so a run of beats stacks into a rise rather
than each being a separate nudge — which is what "build" means, and what a per-beat impulse cannot
express however it is shaped. Measured over a beaty passage the swell climbs 0.49 → 0.78 → 0.96
across nine seconds. *Held* notes build harder, and that falls out of the weighting rather than
needing its own machinery: a held note keeps the level up, which the sustain integrator measures,
while producing almost no onsets at all — so a beaty passage moves this mostly through the build
term and a sustained one mostly through the hold term, which is weighted nearly three times as
heavily. Rest to fully built changes **34% of the frame**.

**The cell count was a ratio where it needed to be a size.** At a fixed 2.1 columns, a cell is the
frame width over 2.1 *however wide the frame is* — so a phone got cells 0.265 across and a desktop
0.762, nearly three times the size. Two symptoms, one cause: the shapes looked far too large on a
desktop, and the paper tone had nowhere left to show. Measured tone visible on the frame, phone
against desktop: **42.7% / 13.6%** before, **43.0% / 46.7%** after. Growing the column count with the
aspect keeps a cell about the same absolute size on any screen.

The coverage metric here is worth distrusting slightly: it counts pixels near the tone colour, and
the default photograph has a blue background of its own, so some of what it calls paper is picture.
The direction is far too large to be an artefact, but the absolute percentages are not exact — the
frozen-time before/after difference is the trustworthy number.

#### Two reflections on one surface

Three reference photographs of water carrying two reflections at once, and all three share a
mechanism: **the surface decides which picture you see at each point.** Large flowing regions of
each, roughly half and half, with a pale warm seam where they meet. They differ only in how tightly
the threshold is set — one gives big lobes, one gives undulating bands, and one sets it so tight
that the second reflection survives as thin ribbons along the crests.

What was there instead was ink sitting *on* the water, and that is area-limited by construction: a
handful of sources can only cover a handful of patches, so asking for more coverage means more or
bigger drops until it stops looking like water and starts looking like spots. Thresholding the
surface gives whole-frame coverage for nothing, and gives boundaries that flow because they *are*
the water. It is also cheaper — with two pictures loaded the look now costs 143.8ms against 143.5ms
with one, where the drops cost 155.8ms.

Three things had to be right, and two of them were wrong in ways that measured as "almost no
coverage" while looking like a tuning problem:

- **A thresholded field wants a known middle.** Half coverage is the threshold at the middle of the
  field's distribution, and a sum of sines is centred on zero by construction where fbm is centred
  wherever it happens to be. On noise, the setting that should have given half the frame gave 13% of
  it and nothing at all below three quarters of a swell.
- **Frequencies are chosen against the frame, not in the abstract.** A "low" frequency of 2 sounds
  like large regions and in fact gives none: it completes a third of a cycle across the picture, so
  what is visible is one slice of one sine and its distribution over the frame has nothing to do
  with its distribution in general. About one cycle across the frame is a handful of regions, which
  is the scale the photographs have.
- **The intricacy comes from the water.** A seam decided by a smooth field is a smooth curve
  dividing the frame in two, where every reference has a convoluted boundary throwing off islands
  and peninsulas. Weighting the wave height heavily — the same field that displaces the picture — is
  what makes the two reflections band along the crests rather than merely abut.

Measured coverage against the swell: 0%, 0%, 0.1%, 3.9%, 19.2%, 40.6%, **51.9%**. Absent when quiet,
about half the frame at full swell.

#### "Did something start" is not "was it worth reacting to"

Shapes jumped through passages of long sustained notes, where nothing new was happening. The onset
detector was not at fault — fed a held note with vibrato, tremolo, bow noise and realistic analyser
wobble, it reports **zero** onsets. The fault was reacting to every onset it *did* report.

A real track under a held note still has a soft pulse ticking away, and measured against the demo's
beat track it produces **more** onsets, not fewer — 54 against 31 in sixteen seconds — each of them
weaker: median strength 3.38 against 4.09. So the discriminator is not whether something started but
how much of a thing it was, which is the onset's height above the local norm.

**A high-water mark, not an average.** The reference rises quickly toward strong hits and gives
ground slowly, so it sits up where a track's real beats are and everything softer falls beneath it.
An average sits in the middle of the distribution by definition and therefore passes about half of
whatever is playing — which is no discrimination at all, and measured exactly that way: an averaged
reference still let 4 strikes through the held passage where the high-water mark lets none.

| | onsets / 16s | Fields strikes |
|---|---|---|
| beat-driven | 30 | **11** |
| long held note | 37 | **0** |

#### Poster's printed surface, and how the first one failed

Poster is a screenprint: paper tooth over the whole sheet, ink that lies unevenly across a pull, and
the odd pinhole where it did not take. None of it touches which cells appear or how they move.

**It was oil paint on linen first, and that was wrong twice over.** Worth recording because both
failures are the kind that look fine in the code:

- *The weave sat at the sampling limit.* Measured across the finished ground it was a one-pixel
  light-or-dark line every two to three pixels — `108, 102, 108, 111, 108`. A periodic pattern that
  fine has nowhere to go: anything that resamples it (a HiDPI screen, browser zoom, a video encoder)
  beats it into a coarse visible grid, which is precisely the graph paper the code comment claimed
  to be avoiding. It was also built in CSS pixels and drawn through the DPR transform, so on a phone
  every thread was blown up two or three times and blurred as well.
- *The paint was dashes long enough to see individually.* Oriented strokes at ~20px read as scratches
  on the blocks, not as a surface under them. Impasto at arm's length is sub-pixel; anything you can
  point at is damage.

So two rules, which everything now obeys: **nothing periodic and nothing directional** — grain is
isotropic noise, and the only large-scale structure is far coarser than the pixel grid, so there is
no frequency for a rescale to beat against; and **built at device resolution**, drawn on the
identity transform so one tile pixel is one device pixel.

**Paper tooth is two scales, because one is what makes noise look digital.** Per-pixel white noise
is sand — every speck the same size, none related to its neighbours, which is a sensor and not a
surface. Paper has fibre in it and specks clump. The tooth is mostly a layer generated at a quarter
resolution and smoothed up, giving lumps three or four pixels across, with a fainter per-pixel layer
for the fine bite. Amplitude is about a third of the first attempt, which read as heavy grain over
the entire print.

**Ink lies unevenly, at the scale of a squeegee pass.** Twenty-two by thirteen cells of random grey
blown up across the frame, so the blobs are a few hundred pixels across — felt as an uneven pull,
not seen as a texture. It goes onto the blocks with `source-atop` and onto the ground separately, so
the gaps between blocks do not pick up the same blotches and give it away as one sheet laid over the
top. The paper tooth, by contrast, goes over *everything* at the end: one surface under ground and
ink alike is what makes it read as a single printed sheet.

**Edge jitter is drawn from a fixed table by cell index** — a jitter rolled per frame makes every
edge crawl. It is applied to the edges rather than the position, so a block sits exactly where the
animation puts it and only its cut is irregular.

**Bake anything you would otherwise upscale every frame.** Blowing 22x13 pixels up to a full frame
with high-quality smoothing is not cheap, and Poster was doing it twice a frame — once over the
ground, once over the blocks. That alone took the look from **16.7ms to 58.2ms** a frame. Baked to
a sheet once per resize it is two ordinary 1:1 draws and the cost went straight back to **16.7ms**,
identical to before any of this existed. The tooth tiles are free by comparison: twenty-four 256px
draws did not move the number at all.

Periodicity is gone by measurement, not by eye: autocorrelation of a ground row now decays smoothly
from 0.983 across lags one to eight, with no oscillation — a low-frequency field, where the weave
gave alternating sign at lag one and two.

#### A threshold on a decaying flag is a frame-rate test

`beatFlash` is set to 1 on an onset and then decayed by `dt * 5.5` inside the same update, so what
a frame actually reads *on the beat* is `1 - dt * 5.5`: **0.908 at 60fps, 0.890 at 50, 0.817 at 30.**
Testing it against 0.9 therefore passes only at a full 60fps and silently fails everywhere else.

Measured on Fields at 16fps: **0 strikes in twenty seconds** before, 11 after. Its only fast response
was switched off entirely on any device that could not hold 60fps — which is exactly the report,
"not really seeming synced to sound, way more than the other effects".

The flag only ever *increases* when a beat is detected, so any increase is an edge, and that is true
at any frame rate. Worth checking every threshold test against a decaying value for the same fault.

#### Rates that are really counts

Lens needed this and so did Dots: when N things each carry their own offset into a shared clock, the
visible rate is the phase advance **times N**, and setting the phase advance directly gets it wrong
twice — once in magnitude, once in how it scales with screen size.

Dots was turning over about **163 dots a second**. That is not shuffling, it is flickering, and no
change to *what* drove it could have read as anything else. Expressed as visible changes per second
and divided by the dot count it runs at about ten in a loud passage and one at rest — motion
**1.70 → 0.60** with its spread up from 0.348 to 0.535, and a quiet-to-loud ratio of **44.8x**.

Dots also gained a size envelope of its own, fast up and slow down, so a chill passage and a loud
one differ in more than how often something moves. Lens gained a term for how *full* the spectrum is
— low and high content present at once, which is roughly what several things playing together sounds
like, and the one signal that adds something the level does not already carry.

#### Water does not un-splash

The same asymmetry applies to both looks, and it is the clearest single idea in any of this: **an
impact is visible at once and then dissipates on its own schedule.** Rise and fall are not the same
question and should not share a constant.

- **Ripple's second reflection** is no longer coupled to the swell at all. Coverage against threshold
  is steep — a swell of 0.45 to 0.75 moves it from 4% of the frame to 41% — so every wobble in the
  swell became a large change in area, which is exactly why the franticness came back the moment a
  second picture was loaded. It is now a store that key moments push up and that only ever comes down
  slowly, over about seven seconds, to a floor the passage itself holds. Which moments count is
  already settled: the same band-passed rise that spawns a surge.
- **Fields** keeps its integrators but the falls are two to three times slower than the rises, and
  the strike envelope is asymmetric by a factor of twenty five — up in a tenth of a second, down over
  nearly three.

**A kick has to be followed, not taken.** Pushing the wash instantly is a step, and a step in a
*threshold* flips a whole region of the frame from one picture to the other inside one frame:
measured, the worst single-frame change went from 15 to 37. Following it over a fifth of a second
still reads as immediate and lands as an impact rather than as a cut — peak back to 19.8, with mean
motion down 13% and its spread up 49% against the version before.

**And a leaky integrator ties its rise rate to its resting level.** Fast in means high equilibrium,
so the only way to get a quick build was a ceiling four times over the top, and it spent whole
passages pinned at maximum with no dynamics left. Tapering the feed as the store fills separates the
two: it climbs at 0.35 a second, settles around 0.8, and still falls on the slow decay term alone.

#### Fields: every shape is a picture

The flat palette shapes are gone. They existed for a real reason, recorded here because it will come
up again: with a single source and every shape framing the same patch of it, the sheet reads as one
photograph behind a mask rather than as a collage. The fix is not flat colour but a different
**view** — each shape now takes its own offset into the picture and its own scale, so neighbours show
different parts and the sheet reads as cut from many prints.

**The obvious pixels were a `step()`.** Blob coverage was a hard in-or-out test with nothing between,
which is a staircase along every edge. It is a `smoothstep` over about two and a half pixels now,
and the width is a single division because the space is scaled so one pixel is `1/uRes.y` along both
axes.

**And one strike slot was not enough** once a strike was allowed to dissipate slowly: a new one has
to move the position, and moving it while the previous is still visible makes the surge teleport.
Two slots, used in turn, let the old one fade where it landed while the next arrives elsewhere.

#### Fields: two kinds of sound need two mechanisms

"I don't really see a reaction that fits the beat you hear." The swell and the build are both broad
and slow — between them they say how a *passage* is going and nothing at all about any particular
moment in it. That was the whole gap, and no amount of tuning either one closes it, because neither
is the kind of thing a hit is.

**A strike is the other half of the pair.** A strong moment lands in one place, rises over about a
quarter second and is spent inside two. It works *because* it is somewhere rather than everywhere: a
local surge can be large without the sheet moving as one body, which is what made every earlier
attempt at a beat response read as a lurch. Each lands away from the last — reflected across the
frame and jittered, so it is not a metronome bouncing between two corners. Measured, one strike
changes 9–12% of the frame and the change follows where it is aimed.

**Its position is passed in from the CPU rather than derived per pixel.** The value is read inside
the nine-neighbour loop, and anything that must be right per *shape* rather than per pixel costs nine
times what it looks like — deriving it from the drop array would have been six exponentials times
nine neighbours per pixel.

**Resting size and room to grow are different questions.** Raising the resting radius to make the
shapes larger took a full build to four fifths of a desktop frame, so the paper tone vanished at
exactly the loud moments it should be answering. Trimming the resting radius while raising the swell
term gives the same shapes more travel: rest-to-built coverage went from +1.6 to **+8.5** points on a
phone and +6.9 to **+17.1** on a desktop, with the two resting sizes now within a point of each other
(53.5% and 54.5%).

Net: motion **0.25 → 0.66** with spread **0.308 → 0.688** — two and a half times as much movement,
arriving far more as events than as drift, with the idle in silence untouched at 0.62.

#### Ripple's ink: shear is what makes a thread

The second picture arrived as one drop in the middle of the frame growing into a lobed blob. It is
now several, opening in different places and at different moments — each source takes its own share
of the swell, so the first is in almost as soon as there is any ink and the last only in a full one.
Dropping them all at one instant reads as a pattern; dropping them across a phrase reads as ink.

**A domain warp does not stretch anything, and that took two attempts to see.** At low frequency the
noise field barely changes across something the size of a drop, so the whole drop slides along
intact. At high frequency it only roughens the edge. What draws ink into threads is *shear*:
displacement along x that varies with y, dragging the near side of a shape past the far side, which
is what a comb does to marbling. The sources are also flattened 5:1 before anything drags them, so
what gets sheared is already a ribbon.

**And a ribbon of even thickness is a lozenge however much it is bent.** What makes ink look like
ink is running thick in places and almost breaking in others, so a length-wise pinch turns one
source into a strand and a couple of wisps. Two sines rather than noise, since it runs inside the
per-source loop.

Cost with a second picture loaded is 155.8ms against 150.8ms with one — the whole block sits behind
a uniform branch, so single-picture use pays nothing.

#### A highlight that brightens without dulling

"It sometimes dulls the colour impact of the image." Adding the same amount to all three channels
raises brightness and lowers saturation *together* — a red petal goes pale rather than bright. So
rather than only turning it down, the glint is tinted toward whatever it lands on (45% of the way,
since a real specular is whiter than its surface). Measured on a beat: brightness lift **8.42 →
6.71** levels while the saturation cost went **4.06 → 2.32** points. Twenty percent less bright,
forty-three percent less dulling.

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

### Saving a still and a clip

Both buttons capture the animation alone — the canvas, not the page, so no chip, label or menu
appears in either file. A still is a PNG; a clip is twenty five seconds of mp4 where the browser
offers it and webm where it does not. On a phone both go through `navigator.share`, because a blob
download there either opens in a tab or goes nowhere, while the share sheet can save to the camera
roll.

**A still cannot be read from the click handler.** The shader canvas is created without
`preserveDrawingBuffer`, so its pixels are gone the moment the frame is composited and anything
reading it from a click gets an empty image. Turning that flag on would make every shader look pay
for a second buffer on every frame to serve a button pressed once. So the click only raises a flag
and the render loop reads the canvas immediately after drawing, while the buffer is still there —
and for the same reason the read is `toDataURL`, not `toBlob`, which defers.

**The live resolution is a frame-rate decision, and a capture has a different one to make.** Both
canvases are deliberately capped for the live view: the 2D one at `devicePixelRatio` 2, the shader
one at 760px wide on phones with a further per-look reduction for Blur and Fields. A still is one
frame, so none of those caps buy anything — it renders at 2.5×, with the width cap and the per-look
reduction both waived, which is what makes every look save at the same size (975×1750 from a phone,
3600×2250 from a 1440×900 desktop). A clip pays its cost on all 750 of its frames, so it takes the
gentler 1.6× and keeps both caps.

Two things this arrangement has to get right. The resolution must be raised **before** the frame is
drawn and lowered after, so the still is armed on one pass of the render loop and read at the end of
the same one — the arm sits above the shader branch, the read below it. And a `MediaRecorder` fixes
its frame size when `captureStream` is called, so the clip's scale goes up before the stream is
taken, not after, and comes back down in `onstop`.

**Safari caps a canvas by total area, not by side length**, at around 16.7M pixels, and a drawing
buffer it refuses to allocate comes back blank rather than throwing. Both canvases therefore clamp
themselves to 11M pixels after scaling, which nothing short of a 5K display reaches.

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

### The beat grid, and why every beat is the wrong beat

`beat` fires on every onset there is — kick, snare, hat, plucked note, vocal entry. That is the
right signal for a shimmer and the wrong one for a movement. At 120bpm it fires every 250ms, and
anything sized by it is therefore always mid-response: the surge from one onset has not finished
before the next arrives. No amount of smoothing fixes that, because the problem is the rate, not
the shape. It is what read as frantic in Ripple, and as trembling rather than breathing in Fields.

Music is counted in bars, and the first beat of a bar carries the weight. `pulse` fires on that
one — roughly four times rarer, which is what gives a response room to complete and leaves calm
either side of it to make the response legible. `bar` runs 0..1 across the bar for anything that
should flow continuously in time rather than react in events.

Three questions, each depending on the one before, re-solved twice a second:

1. **How fast.** Autocorrelate the onset envelope; the lag that best matches is the beat period.
   Candidates are reinforced by their own multiples, or the tracker latches onto a subdivision —
   a hat on every eighth correlates as strongly at half the beat as at the beat, and without this
   we are back to something firing every quarter second.
2. **Where.** Fold the envelope onto one period; the phase carrying the most onset energy is
   where the beats are. Solved directly rather than by steering a phase-locked loop, so a tempo
   change costs one re-solve instead of a slow re-acquisition.
3. **Which one is strong.** Keep a running average of accent per position for bars of 2, 3 and 4;
   take the grouping whose average is most sharply peaked. Its peak is the downbeat.

**The two questions want different evidence.** Tempo runs on broadband flux, so it works on
material with no drums. Phase weights the low band 2.2x, because on anything with a kick the beat
*is* a low-frequency event — and a track with a note on every eighth has identical broadband onset
energy at every phase, so folding the broadband envelope gives a tie and the phase comes down to a
coin flip. Measured, that put the downbeat between the kicks as often as on them. With the low
band weighted it carries **1.43x** the kick energy of an ordinary beat.

**Accent is integrated over the front of each beat, not peaked over all of it.** A kick lands on
the beat; noise lands anywhere. A peak over the whole window scores every beat alike as soon as
the signal is at all twitchy — measured, it put the downbeat on the kick 1.03x as often as
chance, which is to say not at all. Where the energy falls within the beat is the entire
distinction.

**Confidence is not optional.** Autocorrelation always names a winner, and on smooth material the
winner is noise — on a synthetic ambient pad it reported 149bpm at half confidence, a metronome
invented out of nothing. Three gates, multiplied:

- How far the winning lag stands above the field of candidates.
- **Crest of the onset envelope.** Music with a pulse concentrates its onsets: most of the
  envelope sits near zero and the beats stand above it. Ambient spreads energy evenly. Largest
  bucket over average bucket measured 19.9 on the demo against 7.4 on the pad, which separates
  them cleanly.
- **How evenly the sampler is actually running** (below).

Below the threshold the grid is not used at all: `pulse` falls back to firing on unusually strong
onsets, no more than one every 1.2s, and `bar` drifts on a nominal cycle. Both looks keep their
continuous, level-scaled motion, so beatless music still moves — it just is not told a tempo that
is not there.

### Audio analysis does not belong on the render loop

The grid has its own `AnalyserNode` and its own 50Hz timer, and both halves matter.

**Its own timer**, because the render loop is not a clock. Every other value here is sampled once
per frame, which is fine for something a look reads once per frame. But tempo is measured by
correlating a signal against a delayed copy of itself, so sampling that signal at the frame rate
measures the frame rate too. On a look running at 6fps the tracker locked, confidently, to 151bpm
on a 120bpm track. A related version of the same bug: flux dumped into the first bucket of the
span a frame covered, rather than spread across all of them, leaves a run of empty buckets after
each full one — an impulse train at exactly the frame rate. Spreading leaves a slow frame rate
merely blurred, which costs precision but invents nothing.

A timer is only independent while the main thread is free to run it, and a long enough frame
blocks that too. So the sampler watches its own interval and feeds it into confidence: a device
that cannot sample the audio evenly falls back rather than locking to its own frame rate.

**Its own analyser**, because `smoothingTimeConstant` is applied per read — sharing one node and
reading it twice as often quietly halves the smoothing that every existing look depends on. The
grid's is also smoothed far less (0.35 against 0.84), since blurring is exactly wrong for finding
the moment something starts.

**Measured, on Ripple and Fields.** Motion during a downbeat against motion between downbeats went
from roughly parity to **2.6x**. Mean frame-to-frame motion fell 34% and 23%, while its spread rose
38% and 52% — less constant movement, arriving in larger and more distinct events, which is the
shape of the difference between frantic and synchronised.

## Extending it

`audio.js` exposes a single global `A`. A new visual is a function that reads `A.bass`, `A.mid`,
`A.high`, `A.air`, `A.level`, `A.beat`, `A.centroid`, `A.bpm`, and `A.freq` — plus an entry in
the `MODES` array in `index.html` or the `LOOKS` list in `album.html`. Nothing else changes.

For anything that should move *with* the music rather than twitch at it, prefer the grid:
`A.pulse` and `A.pulseFlash` on the downbeat, `A.bar` for continuous position through the bar,
with `A.tempo`, `A.group`, `A.beatPhase` and `A.lock` alongside. Ripple and Fields are wired to
these; every other look still runs on `A.beat`, and both signals are always available.

In `album.html`, `TINY_W` (currently 7) is the single knob for how abstract the result is. Raise
it and the cover becomes more legible; lower it and you get pure colour fields.

## Licence

© 2026. All rights reserved.

This repository is public so it can be served over GitHub Pages. Public is not open
source: no licence is granted to use, copy, modify, or redistribute this code. Add a
name or entity to the line above if you want the claim to be unambiguous.
