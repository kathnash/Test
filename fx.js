/* =====================================================================
   FX — WebGL distortion layer.

   The canvas-2D looks treat the artwork as something to paint *over*.
   These treat it as a texture to bend: refraction through water, a fluted
   glass pane, marbled ink, a grid of lenses. All four are per-pixel
   resamplings, which is a fragment shader's job — doing them with
   getImageData would cost tens of milliseconds a frame on a phone.

   Renders into its own canvas element stacked over the 2D one, and the two
   are shown or hidden by look. It used to render offscreen and get blitted
   into the 2D canvas every frame, which forced a GPU->CPU->GPU round trip
   per frame: expensive, hot, and the likely cause of stalls when switching
   away from a shader look. Grain and vignette for these looks live in the
   shader instead.
   ===================================================================== */
"use strict";

const FX = {
  canvas: null, gl: null, prog: null, tex: null, texB: null, u: {}, ok: false,
  texAspect: 1, texBAspect: 1, hasTexB: 0, sized: [0, 0],
  mode: 0, cssW: 0, cssH: 0, captureScale: 1, captureFull: false,

  // Blur is a deep defocus: by construction it carries no detail above a few
  // pixels, so it does not need the backing store a look that resamples the
  // image sharply does. Two thirds the width is under half the pixels, and
  // the only visible consequence is that the emulsion grain lands coarser —
  // which is closer to the references than the fine grain was.
  // Fields is the same shape of problem as Blur: large flat forms whose only
  // fine detail is grain, so it does not need a look-that-resamples-sharply
  // backing store either. Punch is deliberately absent — its cut edge is a
  // hairline and softening that is the one thing that look cannot afford.
  MODE_SCALE: { 5: 0.68, 8: 0.80 },

  MODES: { Ripple: 0, Ribbed: 1, Marble: 2, Lens: 3, Cyanotype: 4, Blur: 5, Punch: 6, Dots: 7, Fields: 8 },

  init(canvasEl) {
    if (this.ok) return true;
    this.canvas = canvasEl || document.createElement('canvas');
    const gl = this.canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false
    });
    if (!gl) return false;
    this.gl = gl;

    const vs = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const fs = `
      precision mediump float;
      varying vec2 vUv;

      uniform sampler2D uTex;
      uniform vec2  uRes;
      uniform float uTexAspect;
      uniform float uTime;
      uniform float uPhase;   // integrated, not uTime * rate
      uniform float uSwell;   // slow envelope for refraction depth
      uniform float uLumLo, uLumHi;  // source's 8th/92nd luminance percentiles
      uniform float uMedNorm;        // its median within that range
      uniform float uDev;            // 0..1 cyanotype development, driven by the music
      uniform int   uMode;
      uniform float uBass, uMid, uHigh, uLevel, uBeat;
      // The bar, not the beat. uPulse fires once per bar on the downbeat;
      // uBar runs 0..1 across the bar and wraps on it, so anything that
      // wants to flow with the music rather than react to it has a
      // continuous, tempo-locked ramp to ride.
      uniform float uPulse, uBar;
      uniform vec3  uPal[5];
      uniform vec4  uDrops[6];     // x, y (uv), age(sec), size (0 = empty)
      uniform float uDropAmp[6];   // height, which is a separate question
      uniform float uHasTex;
      // Second picture, for the looks that composite two sources.
      uniform float uShuffle;  // integrated, not uTime * rate
      // The second picture's own tone statistics. Thresholding it against the
      // first picture's range clips it flat whenever the two are exposed
      // differently, which is most of the time.
      uniform float uLumLoB, uLumHiB, uMedNormB;
      uniform float uMorph;    // integrated, not uTime * rate
      uniform float uLensShuf; // integrated, and zero while it is quiet
      uniform float uFocus;    // Blur's own envelope, quicker than the swell
      // Cyanotype's four printed tones and its three unwashed coating tones,
      // plus Fields' ground. Passed rather than derived from a single colour
      // because the blue palette follows a hue arc, not a straight line from
      // paper to deep — mixing two endpoints does not reproduce it.
      uniform vec3 uTPaper, uTLight, uTMid, uTDeep;
      uniform vec3 uCPale, uCMid, uCDeep;
      uniform vec3 uFieldBg;
      uniform sampler2D uTexB;
      uniform float uTexBAspect;
      uniform float uHasTexB;

      // ---- helpers -----------------------------------------------------
      vec3 palAt(int i){
        vec3 c = uPal[0];
        for (int k = 0; k < 5; k++) { if (k == i) c = uPal[k]; }
        return c;
      }

      // Saturated hue from a scalar. Cheaper than a full HSV conversion and
      // this only ever needs full-saturation colours.
      vec3 hue2rgb(float h){
        vec3 p = abs(fract(h + vec3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0);
        return clamp(p - 1.0, 0.0, 1.0);
      }

      float hash(vec2 p){
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        // Three octaves, not five. At these scales the top two are below a
        // pixel of visible difference and this runs per-pixel, full screen.
        for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
        return v;
      }

      // Water surface height, normalised to roughly -1..1 so downstream
      // maths stays in a predictable range. Written once and sampled three
      // times for the gradient — duplicating the expression inline is how
      // the terms drift out of sync.
      /* The still surface: a slow swell, deliberately long in both space and
         time. The fastest term used to run at 1.7 and the finest at 17 cycles
         across the frame, which together read as chop rather than as a swell
         — small fast detail is what makes water look agitated. */
      /* Halved, and that is what makes the rings readable. A ring is only
         legible against water calmer than itself: at full height the standing
         swell was some five times the amplitude of a ring, so a ripple
         crossing it was a small perturbation of an already busy surface
         rather than an event. Quieting the background does more for both
         calm and clarity than any change to the rings themselves. */
      float waterH(vec2 p, float t, float aspect){
        /* Swelling water has longer waves, not merely deeper ones. Stretching
           the whole field as the swell rises is what separates this from the
           picture simply being distorted harder — the undulations grow, which
           is what a swell looks like. Also the calmer reading: a longer wave
           at the same height is a gentler slope, so the extra displacement
           above arrives spread out rather than as sharper bending. */
        // Applied to a copy, not to p itself: the surges below are positioned
        // in p, and stretching the space they are measured in would slide
        // every one of them sideways whenever the swell moved.
        vec2 q = p / (1.0 + uSwell * 0.34);
        float h  = sin(q.x * 5.4 + t * 0.62) * 0.28;
              h += sin(q.y * 4.1 - t * 0.48) * 0.25;
              h += sin((q.x + q.y) * 7.0 + t * 0.37) * 0.16;
              h += sin(q.x * 11.0 - t * 0.55) * 0.06;
              h += (fbm(q * 1.7 + t * 0.14) - 0.5) * 0.50;

        /* A fine tremble on the beat, the way a surface answers a speaker
           under it. Beat-rate motion is what made this frantic before, but
           what was frantic about it was the *scale*: the beat was scaling the
           whole displacement field, so every large feature in the picture
           lurched at once. This is the opposite — high spatial frequency and
           a tenth of the amplitude, so it stirs the surface texture and
           leaves the large forms to the swell. Cross-hatched rather than a
           single direction, which reads as a surface shivering rather than as
           a wave crossing. On uTime, not the swell's phase, because it should
           shiver at its own rate rather than at the pace of the water. */
        h += sin(q.x * 19.0 + uTime * 2.3) * sin(q.y * 16.0 - uTime * 1.9)
           * uBeat * 0.028;

        /* And the rings. Each is a wavefront that travels: the crest sits at
           a radius that grows with age, and the envelope travels with it.

           This is the whole difference between a ripple and a flicker. The
           envelope used to be exp(-d) about the drop's centre, so the entire
           concentric pattern existed everywhere from the first frame and then
           faded in place — nothing ever moved outward, and since it was gone
           inside a second, what you saw was a brief shimmer at a point rather
           than a ring crossing the water. Anchoring the envelope to the front
           instead is what makes it spread.

           Slow on purpose, and the speed is set by the frame rather than by
           taste. A portrait phone is only about 0.56 units wide in this
           space, so a ring from the middle reaches the near edge at 0.28 and
           the far corner at 0.58 — at 0.24 units a second it was gone in two
           and a half, which looks exactly like a disturbance that happens and
           then stops. At 0.11 it spends five or six seconds crossing, which
           is the pace this is supposed to have. */
        /* Size and height are two separate questions, so each ring carries
           two numbers. Height comes from how loud the sound was. Size comes
           from what kind of sound it was: a bass hit drops a big stone and
           makes a broad, fast, far-reaching ring, while something bright
           makes a small tight one that does not travel and is gone quickly.
           That is roughly what water does, and it is the one place here where
           the character of a sound rather than its loudness changes the
           picture.

           Note that frequency falls as size rises. What is displaced is the
           gradient, so a ring's steepness is its frequency times its height —
           holding those roughly equal across the range is what keeps a small
           ring from being a sharper distortion than a large one. */
        for (int i = 0; i < 6; i++){
          if (uDrops[i].w > 0.01){
            float size = uDrops[i].w;
            vec2 c = vec2(uDrops[i].x * aspect, uDrops[i].y);
            float d = distance(p, c);
            float age = uDrops[i].z;
            // Bigger waves travel faster, but not by as much as the physics would
            // suggest: speed is also how long a ring stays in frame, and at 0.155
            // a large one was across a portrait phone in under four seconds.
            float front = age * (0.065 + size * 0.055);
            // Squared explicitly. pow() of a negative base is undefined in
            // GLSL, and d - front is negative everywhere inside the ring.
            float u = (d - front) * (5.4 - size * 2.0);
            float band = exp(-u * u);
            // Energy spread around a growing circumference, then a fade that
            // is quicker for the small ones so they free their slot sooner.
            /* Scaled down against the four-slot version by about a third,
               which is the ratio of the slot counts. Total agitation is
               roughly the ring count times the height of one, so raising the
               ceiling from one every 1.7s to one a second - half again as
               many rings alive - has to come out of the height of each or the
               water is simply half again as busy. Measured, leaving the
               height alone took mean motion from 6.8 to 17.4. */
            float amp = uDropAmp[i] * (0.15 + size * 0.21)
                      / (1.0 + front * 2.0) * exp(-age * (0.36 - size * 0.15));
            // cos, not sin: it puts the crest on the wavefront itself, and at
            // the moment of the drop a single peak at the point of impact
            // rather than a node there.
            h += cos((d - front) * (23.0 - size * 9.0)) * band * amp
               * smoothstep(0.0, 0.40, age);
          }
        }
        return h / 2.2;
      }

      // Cover-fit: crop the axis that would otherwise letterbox.
      vec2 coverUV(vec2 uv){
        float ca = uRes.x / max(uRes.y, 1.0);
        vec2 s = (ca > uTexAspect) ? vec2(1.0, uTexAspect / ca)
                                   : vec2(ca / uTexAspect, 1.0);
        return (uv - 0.5) * s + 0.5;
      }
      vec3 tex(vec2 uv){
        if (uHasTex < 0.5) return vec3(0.10, 0.10, 0.13);
        return texture2D(uTex, clamp(uv, 0.001, 0.999)).rgb;
      }

      // Same pair for the second picture. It gets its own cover-fit because
      // the two sources rarely share an aspect ratio, and fitting the second
      // one with the first one's numbers stretches it.
      vec2 coverUVB(vec2 uv){
        float ca = uRes.x / max(uRes.y, 1.0);
        vec2 s = (ca > uTexBAspect) ? vec2(1.0, uTexBAspect / ca)
                                    : vec2(ca / uTexBAspect, 1.0);
        return (uv - 0.5) * s + 0.5;
      }
      vec3 texB(vec2 uv){
        return texture2D(uTexB, clamp(uv, 0.001, 0.999)).rgb;
      }

      // Choose between the two pictures. Written as a branch rather than an
      // unconditional mix so a pixel well inside either region costs one
      // texture fetch, not two — only the feathered boundary pays for both.
      // Each picture gets its own cover-fit, so a portrait and a landscape
      // source both sit correctly.
      vec3 pick(vec2 uv, float m){
        if (m <= 0.002) return tex(coverUV(uv));
        if (m >= 0.998) return texB(coverUVB(uv));
        return mix(tex(coverUV(uv)), texB(coverUVB(uv)), m);
      }

      // Conveyor sampler: the two pictures sit side by side on an endless
      // belt, one panel per screen width. Which panel a point falls in picks
      // the picture, so one fetch covers it.
      vec3 beltTex(vec2 p){
        vec2 q = vec2(fract(p.x), p.y);
        if (mod(floor(p.x), 2.0) < 0.5) return tex(coverUV(q));
        return texB(coverUVB(q));
      }

      // Variable-radius blur, sampled on a golden-angle spiral.
      //
      // This used to be eight taps on two axis-aligned rings, which is not a
      // blur at all — it is eight sharp copies of the image at fixed offsets,
      // and at the radii this look reaches (about 40px) the eye reads those
      // copies as strands. That is where the ropey texture came from.
      //
      // Three things make it smooth. The spiral covers the disc evenly rather
      // than leaving it hollow, with sqrt spacing so samples do not pile up in
      // the middle. The weight falls off toward the rim, so the disc has a
      // soft edge instead of a hard cut. And the whole pattern is rotated by a
      // per-screen-pixel hash, which turns whatever aliasing survives into
      // fine static grain — a texture this look already has — instead of into
      // structure that lines up across neighbouring pixels.
      vec3 softTex(vec2 uv, float r){
        if (r < 0.0008) return tex(uv);
        float a0 = hash(floor(vUv * uRes)) * 6.2831853;
        vec3 c = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 16; i++){
          float fi = float(i) + 0.5;
          float rr = sqrt(fi / 16.0);
          float a  = fi * 2.39996323 + a0;      // golden angle
          float w  = 1.0 - rr * 0.55;
          c += tex(uv + vec2(cos(a), sin(a)) * rr * r) * w;
          wsum += w;
        }
        return c / wsum;
      }

      // Same spiral as softTex, reading the belt. Duplicated rather than
      // parameterised because GLSL ES 1.0 has no function pointers, and the
      // branch not taken costs nothing at runtime.
      vec3 softBelt(vec2 p, float r){
        if (r < 0.0008) return beltTex(p);
        float a0 = hash(floor(vUv * uRes)) * 6.2831853;
        vec3 c = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 16; i++){
          float fi = float(i) + 0.5;
          float rr = sqrt(fi / 16.0);
          float a  = fi * 2.39996323 + a0;
          float w  = 1.0 - rr * 0.55;
          c += beltTex(p + vec2(cos(a), sin(a)) * rr * r) * w;
          wsum += w;
        }
        return c / wsum;
      }

      void main(){
        vec2 uv = vUv;
        vec3 col = vec3(0.0);

        // ================================================================
        // 0 — RIPPLE. Refraction through a moving water surface: build a
        // height field, offset by its gradient, and split the channels
        // slightly so colour disperses instead of blurring.
        // ================================================================
        if (uMode == 0){
          // Phase is integrated on the CPU. Writing uTime * rate(t) means that
          // every change in rate instantly displaces the whole waveform — the
          // surface jumps rather than speeding up.
          float t = uPhase;
          vec2 p = uv * vec2(uRes.x / max(uRes.y,1.0), 1.0);

          float ar0 = uRes.x / max(uRes.y, 1.0);
          float e  = 0.004;
          float h  = waterH(p, t, ar0);
          float hx = waterH(p + vec2(e, 0.0), t, ar0) - h;
          float hy = waterH(p + vec2(0.0, e), t, ar0) - h;
          vec2  grad = vec2(hx, hy) / e;

          // Small on purpose. The gradient of a sum of sines runs to ~4, so
          // an offset in the hundredths already bends the image hard; at the
          // tenths it stops being refraction and becomes soup.
          //
          // Driven by a dedicated slow envelope rather than by bass and beat
          // directly. This scales the whole displacement field at once, so a
          // fast rise moves every pixel of the image simultaneously — which
          // reads as a snap however smooth the underlying band is. Depth of
          // water should swell, not switch.
          /* The swell is the effect, so it gets the range. This scales the
             whole displacement field, which was the reason a *hit* could not
             live here — a hit moves every pixel at one instant and reads as a
             flinch. A swell is the one thing that should be here: it is the
             water itself rising, it is supposed to be everywhere at once, and
             it moves over seconds rather than instants.

             Nearly five to one from quiet to loud, where it used to be less
             than two. That ratio is the whole answer to a quiet passage
             reacting as hard as a loud one — the previous base was so high
             that silence already had most of the distortion of a chorus. */
          float amt = 0.0068 + uSwell * 0.0275;
          vec2 off = grad * amt;

          // A puddle of the second picture, spreading with the music. Its
          // radius rides the same slow envelope the water depth does, so it
          // swells rather than flickering with the band, and its edge is
          // displaced by the surface height — so it reads as something lying
          // in the water rather than a shape laid over it.
          float pud = 0.0;
          if (uHasTexB > 0.5) {
            /* Marbling, not a puddle. It was one drop in the middle of the
               frame growing into a lobed blob; this is several, arriving in
               different places and at different moments, drawn out into
               threads by a shared flow.

               What makes it stringy is shear, not warp. An isotropic noise
               warp at low frequency simply *moves* a blob — the field barely
               changes across something the size of a drop, so the whole drop
               slides intact — and at high frequency it only roughens the
               edge. Neither stretches anything. Displacement along x that
               varies with y does: it drags the near side of a shape past the
               far side, which is exactly how a comb pulls marbling into
               threads. The sources are flattened to start with, so what gets
               dragged is already a ribbon.

               The sources are staggered against the ink so they do not all
               open together: the first is in almost as soon as there is any,
               the last only in a full swell. That is the "different spots at
               different times" — dropping four points at one instant reads as
               a pattern, and dropping them across a phrase reads as ink. */
            float ar2 = uRes.x / max(uRes.y, 1.0);
            vec2 P = vec2(uv.x * ar2, uv.y);
            float ink = clamp((uSwell - 0.10) / 0.74, 0.0, 1.0);

            // Two scales of shear along x, both varying with y, plus a much
            // smaller one across so the threads are not perfectly horizontal.
            float sh = (fbm(vec2(P.y * 6.5, uTime * 0.021)) - 0.5)
                         * (0.16 + ink * 0.52)
                     + (fbm(vec2(P.y * 15.0 + 7.0, uTime * 0.017)) - 0.5)
                         * (0.05 + ink * 0.17);
            float sv = (fbm(vec2(P.x * 5.0 + 31.0, uTime * 0.019)) - 0.5)
                         * (0.04 + ink * 0.10);
            vec2 Q = P + vec2(sh, sv);

            for (int i = 0; i < 4; i++) {
              float fi = float(i);
              vec2 seed = vec2(fi * 3.7 + 1.0, fi * 1.9 + 5.0);
              // Its own share of the swell, so they come in one after another.
              float li = clamp((ink - fi * 0.155) / 0.50, 0.0, 1.0);
              vec2 c = vec2(ar2 * (0.20 + 0.60 * hash(seed))
                              + sin(uTime * 0.034 + fi * 2.1) * ar2 * 0.06,
                            0.18 + 0.64 * hash(seed + 9.0)
                              + cos(uTime * 0.028 + fi * 1.7) * 0.06);
              // Flattened hard, so a source is a ribbon before anything drags
              // it and a thread after.
              vec2 d = Q - c;
              d.y *= 5.2;
              /* Pinched along its length. A ribbon of even thickness reads as
                 a lozenge however much it is bent — what makes ink look like
                 ink is that it runs thick in places and almost breaks in
                 others, so one source becomes a strand and a couple of
                 wisps. Two sines rather than noise: this is inside the source
                 loop, so it runs four times a pixel. */
              float pinch = 0.58 + 0.52 * sin(Q.x * 12.0 + fi * 2.7 + uTime * 0.05)
                                        * sin(Q.y * 7.5 - fi * 1.9);
              float rad = (0.058 + hash(seed + 4.0) * 0.055)
                        * (0.30 + li * 1.50) * pinch;
              // Union, so overlapping sources merge into one body of ink the
              // way they do on water, rather than cross-fading into a haze.
              pud = max(pud, li <= 0.001 ? 0.0
                   : 1.0 - smoothstep(rad * 0.80, rad, length(d) + h * 0.014));
            }
          }

          // Chromatic dispersion keeps it reading as refraction, not blur.
          float disp = 1.0 + uHigh * 0.30;
          col.r = pick(uv + off * (1.0 + 0.07 * disp), pud).r;
          col.g = pick(uv + off, pud).g;
          col.b = pick(uv + off * (1.0 - 0.07 * disp), pud).b;

          // Caustic glint along the crests. h must be clamped before the
          // power: unnormalised it exceeded 1 and blew whole regions white.
          /* Rescaled, and it had to be. This maps the height onto 0..1 for
             the power below, and it was written when the standing swell ran
             to about 1.0 — halving that field to make the surges legible left
             the crests reaching only 0.72, and 0.72 to the seventh is a tenth
             of 1.0. The glint had quietly gone out, which is why adding the
             beat to it changed nothing. */
          float cr = clamp(h * 1.15 + 0.5, 0.0, 1.0);
          /* The glint is where the beat lives. It rides pow(cr, 7.0), so it
             only exists on the crests — a sparkle running along the tops of
             the waves rather than a change to the whole frame.

             This is the one place beat-rate response is free. Nothing moves
             when a highlight brightens, so it costs none of the calm the
             swell just bought; the earlier versions were frantic because the
             beat was moving geometry. On uBeat rather than the grid's pulse,
             so it answers every beat there is and cannot be off. */
          /* Exponent down from 7 as well as the beat term up. At the
             seventh power the glint existed on perhaps a twentieth of the
             surface, so making it brighter made almost nothing brighter;
             opening it out is what turns a sparkle on a few crest tips into
             light running along the tops of the waves.

             The beat term rides the swell rather than standing alone, so a
             beat in a quiet passage is a small catch of light and the same
             beat in a loud one is the water flashing. A beat that hits just
             as hard either way is the same imbalance the swell was rebuilt to
             fix, arriving by the back door. */
          /* Tinted toward whatever it is falling on, rather than added flat.
             Adding the same amount to all three channels raises brightness
             and lowers saturation together, which is why a strong glint was
             dulling the colour of the picture underneath — a red petal went
             pale rather than bright. Carrying part of the local hue means the
             highlight can stay as strong while taking much less colour out.
             Part, not all: a real specular is whiter than what it lands on.
             The amount itself comes down only slightly — the tint is doing
             most of the work, so the glint keeps nearly all its impact while
             taking half as much colour out of the picture. */
          float glint = pow(cr, 4.5) * (0.048 + uLevel * 0.070 + uSwell * 0.19
                                        + uBeat * (0.42 + uSwell * 0.88));
          float pk = max(col.r, max(col.g, col.b));
          col += glint * mix(vec3(1.0), col / max(pk, 0.04), 0.45);
        }

        // ================================================================
        // 1 — RIBBED GLASS. Each flute is a cylindrical lens showing a
        // compressed slice. Clarity is deliberately uneven and drifts, so
        // some of the image is sharp and some dissolves — the parts nearer
        // the glass versus further from it.
        // ================================================================
        else if (uMode == 1){
          // Fixed. Driving the rib count from audio through a floor() makes the
          // whole pane snap to a new position every time the band crosses a
          // threshold — the glass appeared to jitter. The pane is a physical
          // object; only what is behind it should move.
          float cols = 34.0;
          float x    = uv.x * cols;
          float rib  = floor(x);
          float f    = fract(x) * 2.0 - 1.0;          // -1..1 across the flute

          // Compressing the sampled slice is what makes a flute read as
          // glass rather than as a stripe.
          // A convex flute is a real lens: it shows a narrow strip of what is
          // behind it, magnified and INVERTED. The inversion is what makes an
          // object moving behind appear to slide backwards within each rib and
          // jump between them — without it you get stripes, not glass.
          float lensF = sin(f * 1.5707963);        // cylindrical, not linear
          float mag   = 0.38;               // lens geometry is fixed too
          // The flute inverts what it shows, and that inversion is what makes
          // a subject drifting behind a static pane read as glass. On the
          // conveyor it fights the belt: the panels travel one way while the
          // content inside every rib travels the other, and the eye reads the
          // conflict long before it reads the glass. The belt gets the
          // uninverted mapping so the two run together; the single-image pane
          // keeps the inversion, where there is no belt to disagree with.
          float inv = uHasTexB > 0.5 ? 1.0 : -1.0;
          float sx  = (rib + 0.5) / cols + inv * lensF * (0.5 / cols) * mag;

          // The subject behind the glass drifts and sways instead: a slow
          // parallax that the music pushes, so depth changes without the pane
          // ever appearing to shift.
          vec2 par = vec2(sin(uTime * 0.105) * 0.020 + sin(uTime * 0.041) * 0.013,
                          cos(uTime * 0.082) * 0.016 + cos(uTime * 0.031) * 0.011)
                   * (0.85 + uLevel * 1.5);
          float wob = sin(uv.y * 3.0 + uTime * 0.18) * 0.003 * (0.4 + uLevel);
          vec2 suv = coverUV(vec2(sx + wob + par.x, uv.y + par.y));

          // The clarity field drifts slowly and is nudged by transients, so
          // *which* parts are sharp is itself the animation.
          // A drifting noise field plus a slow sweeping band, so the region
          // in focus travels across the pane instead of only shimmering in
          // place — that travel is the animation.
          float clarity = fbm(vec2(uv.x * 1.6, uv.y * 2.2) + uTime * 0.055);
          clarity += 0.30 * sin(uv.y * 2.3 - uTime * 0.17 + uv.x * 0.8);
          clarity += uBeat * 0.22 + uMid * 0.18;
          // Tighter still: near-binary between sharp and dissolved, which is
          // what makes depth read rather than a uniform middling softness.
          clarity = smoothstep(0.40, 0.60, clarity);
          float blur = (1.0 - clarity) * (0.034 + uLevel * 0.022);

          // With a second picture loaded the pane looks onto a conveyor:
          // the two pictures ride side by side, one screen-width per panel,
          // running steadily left and cycling forever. The rate is constant,
          // so multiplying time by it is safe — the displacement problem
          // only arises when a rate changes.
          if (uHasTexB > 0.5) {
            col = softBelt(vec2(sx + wob + par.x + uTime * 0.045, uv.y + par.y), blur);
          } else {
            col = softTex(suv, blur);
          }

          // Edge shading on each flute gives the glass thickness. Kept light:
          // the relief is the least interesting thing here, and at full
          // strength it turned a pane into a row of tubes. The lens geometry
          // above is what carries the glass — how the image slides and
          // inverts within each flute — and that is untouched.
          float edge = 1.0 - pow(abs(f), 2.6) * 0.34;
          col *= edge;
          // Two speculars per flute — a bright catch-light and a weaker
          // return off the far curve.
          col += pow(max(0.0, 1.0 - abs(f + 0.52) * 6.5), 2.2) * 0.17 * (0.35 + clarity);
          col += pow(max(0.0, 1.0 - abs(f - 0.30) * 9.0), 3.0) * 0.07 * (0.35 + clarity);
        }

        // ================================================================
        // 2 — MARBLE. Domain-warped noise quantised into flat bands and
        // mapped to the artwork's palette: big blobs, not fine veining.
        // Beats drop new "ink" that pushes the pattern outward from a point.
        // ================================================================
        else if (uMode == 2){
          float ar = uRes.x / max(uRes.y, 1.0);
          float rows = 8.0;
          float cols = max(3.0, floor(rows * ar * 0.62));
          vec2 gp   = uv * vec2(cols, rows);
          vec2 base = floor(gp);

          float density = fbm(uv * vec2(ar, 1.0) * 1.4 + 3.0);
          float swell = 0.0;
          for (int i = 0; i < 6; i++){
            if (uDrops[i].w > 0.01){
              float d = length(uv - uDrops[i].xy);
              swell += exp(-d * 3.0) * exp(-uDrops[i].z * 1.1) * 0.40;
            }
          }
          float rough = (fbm(uv * vec2(ar, 1.0) * 11.0 + uTime * 0.030) - 0.5) * 0.14
                      + (fbm(uv * vec2(ar, 1.0) * 26.0) - 0.5) * 0.045;
          float rad = 0.19;

          // Evaluate the nine surrounding cells and keep the nearest surface.
          // Testing only the cell a pixel falls in clips every blob at the
          // cell wall, so a growing blob gets sliced flat instead of swelling
          // past its neighbours — and two blobs can never merge.
          float best = 1e9;
          vec2  bestCell = base;
          for (int j = -1; j <= 1; j++){
            for (int i = -1; i <= 1; i++){
              vec2 nc = base + vec2(float(i), float(j));
              float r1 = hash(nc), r2 = hash(nc + 13.1), r3 = hash(nc + 41.7);
              vec2 hs = vec2(0.15 + r1 * 0.28, 0.17 + r2 * 0.34);
              hs *= 0.60 + density * 0.95;
              hs *= 1.0 + mix(uBass, uHigh, fract(r1 * 3.0)) * 0.26 + uBeat * 0.20 + swell;
              if (r3 > 0.88) hs *= 0.25;
              vec2 fl = gp - (nc + 0.5);
              vec2 d2 = abs(fl) - hs + rad;
              float sd = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - rad;
              if (sd < best) { best = sd; bestCell = nc; }
            }
          }
          float sdf = best + rough;

          // The artwork reads through both the blobs and the field, posterised
          // so it still prints flat rather than turning photographic.
          vec3 imgc = tex(coverUV(uv));
          imgc = floor(imgc * 5.0 + 0.5) / 5.0;

          int band = int(mod(bestCell.x * 2.0 + floor(bestCell.y * 0.5), 4.0)) + 1;
          vec3 ink = mix(palAt(band), imgc, 0.55);
          ink *= 0.90 + fbm(uv * 9.0) * 0.20;
          vec3 ground = mix(palAt(0), imgc * 0.92, 0.42);

          float inHalo = smoothstep(0.150, 0.015, sdf);
          float inBlob = smoothstep(0.020, -0.018, sdf);
          col = mix(ground, vec3(0.022, 0.020, 0.028), inHalo);
          col = mix(col, ink, inBlob);
          col *= 0.88 + uLevel * 0.24;
        }

        // ================================================================
        // 3 — LENS GRID. A field of circles on a dark ground, each holding
        // a fisheye view of the slice of image behind it. Grain and a pulled
        // -back saturation give it the litho feel.
        // ================================================================
        else if (uMode == 3) {
          float grid = 5.0;                 // fixed: a floor() here snapped the
                                            // whole grid to a new size on transients
          float ar   = uRes.x / max(uRes.y, 1.0);
          vec2  gv   = vec2(uv.x * ar, uv.y) * grid;
          vec2  cell = floor(gv);
          vec2  f    = fract(gv) * 2.0 - 1.0;

          float r = length(f);
          float band = mod(cell.x + cell.y, 5.0);
          // A narrow travel on purpose. The grid stays put; only how far each
          // circle opens within its cell moves, and a wide range made them
          // collide at the top of it.
          float pulse = 0.94 + uBass * 0.105 + uBeat * 0.070
                      + sin(uTime * 0.5 + (cell.x + cell.y) * 0.7) * 0.022;

          if (r > pulse){
            col = vec3(0.035, 0.033, 0.045);
          } else {
            // Fisheye centred on this circle. At the previous 2.6x zoom each
            // circle sampled nearly three cells' worth, so neighbours showed
            // heavily overlapping content and the bulge read as one lens over
            // the whole page rather than one lens per circle. At ~1.15x each
            // circle covers its own patch and its own centre magnifies.
            float rr = pow(r / pulse, 2.15) * pulse;
            vec2 warped = (r > 0.0001) ? (f / r) * rr : f;
            // The whole image drifts behind the grid on a slow Lissajous —
            // a screensaver wander — pushed a little harder by the music.
            // Without it the circles pulse but the picture inside is static,
            // and the look reads as decoration rather than as reactive.
            vec2 drift = vec2(sin(uTime * 0.061) * 0.5 + sin(uTime * 0.023) * 0.5,
                              cos(uTime * 0.047) * 0.5 + cos(uTime * 0.019) * 0.5)
                       * (0.085 + uLevel * 0.090);
            vec2 centre = (cell + 0.5) / grid + drift;
            centre.x /= ar;
            vec2 suv = centre + warped * (0.5 / grid) * vec2(1.0 / ar, 1.0)
                              * (1.15 + uBass * 0.18);
            // Which circles hold the second picture is reshuffled by the
            // music rather than fixed for the session. Each circle runs the
            // shuffle clock on its own offset, so a loud passage trades a
            // scattering of them rather than flipping the grid at once, and
            // the last fifth of each step crossfades so nothing pops.
            //
            // Its own clock, not the one Dots uses. That one carries a small
            // constant term, which is right for a field of dots and wrong
            // here: spread across thirty circles on thirty different offsets,
            // a rate that slow still meant one circle changing every second
            // or so in silence. This clock stops dead when the music does.
            float selB = 0.0;
            if (uHasTexB > 0.5) {
              float sp = uLensShuf + hash(cell + 5.5) * 9.0;
              float k0 = step(hash(cell + floor(sp) * 2.7), 0.42);
              float k1 = step(hash(cell + (floor(sp) + 1.0) * 2.7), 0.42);
              selB = mix(k0, k1, smoothstep(0.80, 1.0, fract(sp)));
            }
            col = pick(suv, selB);

            // The artwork's own colours, lifted slightly rather than remapped
            // through a duotone — the duotone read as a filter over the image
            // instead of the image itself.
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(l), col, 1.16);
            col *= 0.88 + 0.12 * pow(1.0 - r / pulse, 0.5);
            // Soft internal falloff so each circle reads as pooled ink
            // rather than a flat disc of colour.
            col *= 0.94 + 0.20 * (1.0 - smoothstep(0.0, 1.0, r / pulse));
          }

          // Litho grain, coarse and heavy — sampled below pixel resolution so
          // it clumps the way print grain does. Static: it used to resample on
          // floor(uTime * 12.0), which is a 12Hz strobe, not grain.
          float gr = hash(floor(vUv * uRes / 1.7));
          col += (gr - 0.5) * 0.20;
        }

        // ================================================================
        // 4 — CYANOTYPE. Runs the actual process, but the music is the light
        // source and the position in the process is a *state*, not a clock:
        // sound exposes the print toward a finished blue, and in the quiet it
        // slides back toward the raw violet sheet. The whole arc — coated
        // paper, exposure, the water wash where the blue arrives, the
        // deepening as it oxidises — is reachable in either direction.
        // ================================================================
        else if (uMode == 4) {
          float proc = uDev;

          // The stages are ordered so that running *down* unwinds them in the
          // order that stays smooth: depth first, then the blue draining back
          // to violet, and only then the image fading off the paper. Coming
          // down, unwinding the exposure while the print is still blue would
          // drag the tone through the steep part of the blue ramp and lurch;
          // by the time exposure unwinds here, the palette is the gentle
          // violet one. Every edge is a smoothstep, so the direction can
          // reverse anywhere without a corner.
          // Deepening gets the whole top half of the range. When it shared the
          // range evenly the print was fully blue by 0.6 and the last 40% of
          // the scale changed nothing measurable — a verse and a chorus landed
          // on the same frame.
          float expose = smoothstep(0.02, 0.28, proc);
          float wash   = smoothstep(0.30, 0.56, proc);
          float deepen = smoothstep(0.52, 1.00, proc);

          vec2 drift = vec2(sin(uTime * 0.041) * 0.6 + sin(uTime * 0.017) * 0.4,
                            cos(uTime * 0.033) * 0.6 + cos(uTime * 0.013) * 0.4) * 0.030;
          // A square inset of the second picture. It is fed in before the
          // exposure rather than composited after, so it goes through the
          // same burn, wash and deepening as everything else — printed on
          // the same sheet rather than pasted onto it.
          float ins = 0.0;
          if (uHasTexB > 0.5) {
            float ar3 = uRes.x / max(uRes.y, 1.0);
            vec2 q = vec2(uv.x * ar3, uv.y) - vec2(ar3 * 0.5, 0.5)
                   + vec2(sin(uTime * 0.021) * 0.013, cos(uTime * 0.017) * 0.011);
            float halfW = 0.150 + uSwell * 0.030;
            ins = 1.0 - smoothstep(halfW - 0.005, halfW + 0.005,
                                   max(abs(q.x), abs(q.y)));
          }
          vec3 src = pick(uv + drift, ins);
          float lum = dot(src, vec3(0.299, 0.587, 0.114));
          // Stretched against whichever picture this pixel came from. The
          // inset was coming out blank white until this: a second image with
          // a different exposure sits entirely outside the first one's
          // percentile range, so every pixel of it lands on one side of the
          // threshold.
          float loB = mix(uLumLo, uLumLoB, ins);
          float hiB = mix(uLumHi, uLumHiB, ins);
          lum = clamp((lum - loB) / max(0.04, hiB - loB), 0.0, 1.0);

          vec2 cp = uv * vec2(uRes.x / max(uRes.y,1.0), 1.0) * 2.2;
          float coat = fbm(cp + vec2(uTime * 0.020, uTime * -0.014) + 4.0);
          lum += (coat - 0.5) * 0.15;

          // Dappled light: sun through leaves moving across the sheet. This is
          // what the print has to look at when the music goes quiet, so it is
          // scaled by how quiet things are and disappears under the pulsing
          // once the music takes over — otherwise it would compete with it.
          //
          // The sway is applied to the *sample coordinate*, not to the result,
          // so the pattern rocks like a branch instead of the whole frame
          // sliding. Two incommensurate periods keep it from reading as a loop.
          // Travel is what makes this read as movement — amplitude alone just
          // makes the frame breathe in place. The patches drift steadily
          // across the sheet and the sway rocks them on top of that.
          float calm = 1.0 - clamp(uLevel * 1.15, 0.0, 1.0);
          float sway = sin(uTime * 0.129) * 0.6 + sin(uTime * 0.071 + 1.7) * 0.4;
          vec2 lp = uv * vec2(uRes.x / max(uRes.y,1.0), 1.0) * 1.7;
          lp += vec2(uTime * 0.017 + sway * 0.150, uTime * 0.006 + sin(uTime * 0.047) * 0.075);
          lp += vec2(sin(lp.y * 2.9 + uTime * 0.16),
                     cos(lp.x * 2.3 - uTime * 0.11)) * 0.09 * (0.6 + sway * 0.4);
          // Sharpened into patches with soft edges. Raw fbm is a haze; leaf
          // shadow has a shape.
          float dapple = smoothstep(0.36, 0.70, fbm(lp + 31.0)) - 0.5;

          // Light falling on the paper is light exposing it, so the dapple
          // moves the exposure threshold as well as tinting the result. That
          // is what makes it read as light on the sheet rather than a texture
          // laid over the picture.
          float medB = mix(uMedNorm, uMedNormB, ins);
          float pol = medB > 0.5 ? 1.0 : -1.0;

          // Developer spreading from each transient.
          float dev = 0.0;
          for (int i = 0; i < 6; i++){
            if (uDrops[i].w > 0.01){
              float d = distance(uv, uDrops[i].xy);
              float age = uDrops[i].z;
              dev += exp(-abs(d - age * 0.26) * 6.5) * exp(-age * 1.15);
            }
          }

          float contact = fbm(uv * 3.4 + vec2(uTime * 0.038, uTime * 0.022) + 17.0);
          float soft = mix(0.04, 0.26, contact) * (0.60 + uMid * 0.55 + uSwell * 0.35);
          soft *= 1.0 + dev * 0.75;

          float breath = sin(uTime * 0.085) * 0.022 + sin(uTime * 0.034) * 0.014;
          float bloom = uSwell * 0.13 + uBeat * 0.05 + breath + dev * 0.09;
          float expoT = medB + pol * (bloom - soft - 0.06);

          // Where the light falls, the sheet exposes a little further. Small:
          // this is a shadow moving over a print, not a second image.
          expoT -= pol * dapple * 0.105 * calm;

          float s0 = smoothstep(expoT - soft, expoT + soft, lum);
          float v = pol > 0.0 ? s0 : 1.0 - s0;

          // The image burns in rather than being there from the start, and
          // keeps gaining depth after the wash as the pigment oxidises.
          v = clamp(v * expose, 0.0, 1.0);
          v = pow(v, mix(1.0, 0.74, deepen));

          // Coated and exposed but not yet rinsed: dusty violet, and low in
          // contrast, because the Prussian blue has not formed yet.
          vec3 uP = uCPale;
          vec3 uM = uCMid;
          vec3 uD = uCDeep;
          vec3 unwashed = v < 0.5 ? mix(uP, uM, v / 0.5) : mix(uM, uD, (v - 0.5) / 0.5);

          // Rinsed: the unexposed sensitiser washes off to bare paper and the
          // blue arrives all at once. A freshly rinsed print is a lighter,
          // greyer blue; oxidising drives it to full Prussian. Carrying the
          // deepening in the palette's dark end, rather than in gamma alone,
          // is what makes the difference between a verse and a chorus visible
          // — gamma on its own moved the mean frame colour by about a unit.
          // A freshly rinsed print is lighter and greyer; oxidising drives it
          // to full strength. The undeepened end is the tone lifted toward
          // the paper, so a new tone needs only its four printed colours.
          vec3 wP = uTPaper;
          vec3 wL = mix(mix(uTLight, uTPaper, 0.20), uTLight, deepen);
          vec3 wB = mix(mix(uTMid,   uTPaper, 0.26), uTMid,   deepen);
          vec3 wD = mix(mix(uTDeep,  uTPaper, 0.22), uTDeep,  deepen);
          vec3 washed;
          if (v < 0.34)      washed = mix(wP, wL, v / 0.34);
          else if (v < 0.72) washed = mix(wL, wB, (v - 0.34) / 0.38);
          else               washed = mix(wB, wD, (v - 0.72) / 0.28);

          col = mix(unwashed, washed, wash);

          // A wet sheen at the moment the water is running over it. Zero at
          // both ends of the wash, so it needs no separate handling at the wrap.
          float wet = wash * (1.0 - wash) * 4.0;
          col *= 1.0 + wet * 0.07;

          // The same light, now as brightness on the sheet. Applied after the
          // palette so it lifts and shades the print itself rather than
          // pushing tones to a different blue.
          col *= 1.0 + dapple * 0.23 * calm;

          // Paper fibre. Static, and heaviest where the pigment sits.
          float fib = hash(floor(vUv * uRes / 1.35));
          col += (fib - 0.5) * (0.055 + v * 0.11);
          float fib2 = fbm(vUv * uRes / 26.0);
          col *= 0.955 + fib2 * 0.09;

          float halo = 1.0 - abs(v - 0.34) * 3.4;
          col += max(0.0, halo) * 0.05 * wash;
        }

        // ================================================================
        // 5 — BLUR. The artwork as a photograph taken well out of focus:
        // highlights swollen into soft masses, heavy emulsion grain, milky
        // lifted shadows. Never resolves — the music moves how far out of
        // focus it is, not whether it is.
        // ================================================================
        else if (uMode == 5) {
          // Slow parallax, so a still image is alive before a note plays.
          vec2 par = vec2(sin(uTime * 0.037) * 0.016 + sin(uTime * 0.017) * 0.010,
                          cos(uTime * 0.029) * 0.014 + cos(uTime * 0.013) * 0.009);

          // Depth of field breathes, across a three-to-one range on its own
          // envelope rather than the two-to-one it had on the water swell.
          // That swell is tuned for depth of water and rises over half a
          // second, which is right for Ripple and too slow here: a defocus
          // that lags the music by that much reads as unrelated to it. The
          // shallow end is still a heavy defocus, because the moment this
          // look resolves it stops being this and starts being the artwork
          // with a filter on it.
          float r = 0.068 - uFocus * 0.046 + uBeat * 0.006;

          // The disc is slightly elliptical and its axis turns slowly, so the
          // bokeh smears along a direction that drifts instead of staying
          // round — the streaking a long exposure leaves on water.
          float ang = uTime * 0.031;
          vec2 dirA = vec2(cos(ang), sin(ang));
          vec2 dirB = vec2(-dirA.y, dirA.x);
          float ecc = 1.0 + 0.5 * (0.5 + 0.5 * sin(uTime * 0.043));

          // Bokeh, not blur, and this is the whole look. A lens does not
          // average an out-of-focus highlight away — it spreads that light
          // over a disc that stays bright, which is why defocused specular
          // points read as glowing coins rather than as pale smudges.
          // Weighting each sample by its own brightness before averaging
          // reproduces that: bright shapes swell and hold their intensity,
          // dark ones recede. A flat mean gives mush, and mush is what
          // separates a blur filter from a photograph.
          // A feathered oval of the second picture floating in the middle,
          // defocused by the same kernel as everything else. The feather is
          // wide on purpose: this is a hole in an out-of-focus photograph, so
          // a crisp boundary would be the only sharp edge in the frame.
          float ov = 0.0;
          if (uHasTexB > 0.5) {
            float ar5 = uRes.x / max(uRes.y, 1.0);
            // Both radii are in units of screen height, so the oval is the
            // same object on every display - which measured 25% of the width
            // on a desktop and 82% of it on a phone. Narrow frames get it
            // smaller, clamped so a desktop is untouched.
            float ovScale = min(1.0, 0.68 + ar5 * 0.19);
            // The float is scaled with it and much smaller than it was. At
            // the old amplitude the centre wandered by ten pixels or so,
            // which reads as off-centre rather than as drift once the shape
            // is wide enough to nearly touch both edges.
            vec2 q = vec2(uv.x * ar5, uv.y) - vec2(ar5 * 0.5, 0.5)
                   + vec2(sin(uTime * 0.023) * 0.007,
                          cos(uTime * 0.019) * 0.006) * ovScale;
            q /= vec2(0.205, 0.300) * ovScale * (1.0 + uFocus * 0.22);
            // A defined edge with only a suggestion of feather, so it reads as
            // a cut aperture rather than as a soft glow bleeding into the
            // defocus behind it.
            ov = 1.0 - smoothstep(0.955, 1.0, length(q));
          }

          float a0 = hash(floor(vUv * uRes)) * 6.2831853;
          float pw = 2.2 + uLevel * 2.8;      // louder blooms harder
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 18; i++){
            float fi = float(i) + 0.5;
            float rr = sqrt(fi / 18.0);
            float a  = fi * 2.39996323 + a0;
            vec2 o = (dirA * (cos(a) * ecc) + dirB * (sin(a) / ecc)) * rr * r;
            vec3 sm = pick(uv + o + par, ov);
            float lm = dot(sm, vec3(0.299, 0.587, 0.114));
            float w = (0.16 + pow(lm, pw) * 2.6) * (1.0 - rr * 0.35);
            acc += sm * w;
            wsum += w;
          }
          col = acc / max(wsum, 0.0001);

          // Milky shadows. Every one of the references sits its blacks well
          // above zero — that lift is most of what reads as film rather than
          // as a dimmed screen, and without it a soft image just looks murky.
          col = col * 0.85 + 0.088;

          // Slightly desaturated and a touch warm, for the dusty palette.
          float g = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(g), col, 0.78);
          col *= vec3(1.045, 1.005, 0.945);

          // Emulsion grain. Static — the picture passes through it, so it
          // does not reseed per frame, which would sizzle. Heaviest through
          // the midtones, the way real grain is: it has little to bite on at
          // either extreme.
          float gr = hash(floor(vUv * uRes));
          float mid = 1.0 - abs(g - 0.5) * 1.6;
          col += (gr - 0.5) * 0.155 * max(0.32, mid);

          // The whole sheet lifts a little on a transient, the way a
          // defocused photograph blooms when more light reaches it.
          col *= 1.0 + uBeat * 0.11;

          vec2 vc = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
          col *= 1.0 - dot(vc, vc) * (0.15 - uFocus * 0.04);
        }

        // ================================================================
        // 6 — PUNCH. A paper collage: one picture with a loose grid of
        // hand-cut circular holes punched through it, and a second picture
        // showing through them. The holes are a window onto one continuous
        // photograph, not a per-circle thumbnail — that is what makes it
        // read as two sheets of paper rather than as a pattern.
        // ================================================================
        else if (uMode == 6) {
          float aspect = uRes.x / max(uRes.y, 1.0);

          // The two pictures drift against each other. The holes stay where
          // they are and the picture behind them slides, which is what you
          // would actually see through a hole, and it means the collage is
          // alive without the cut edges ever appearing to wander.
          vec2 par = vec2(sin(uTime * 0.043) * 0.030 + sin(uTime * 0.019) * 0.018,
                          cos(uTime * 0.034) * 0.024 + cos(uTime * 0.015) * 0.014)
                   * (0.55 + uLevel * 0.9);

          vec3 base = tex(coverUV(uv));
          // With one source loaded the holes show the same picture closer in
          // and offset, which is what the references do anyway — the second
          // photograph is usually more of the same subject, seen nearer. So
          // the look works before a second image is chosen and gets better
          // once it is.
          vec3 inner = uHasTexB > 0.5
                     ? texB(coverUVB((uv - 0.5) * 0.88 + 0.5 + par))
                     : tex(coverUV((uv - 0.5) * 0.46 + 0.5 + vec2(0.06, -0.04) + par));

          // Square-ish grid units, so circles stay circles on any screen.
          vec2 gp = vec2(uv.x * aspect, uv.y);
          // Three across in portrait, as in both references. A fixed column
          // count leaves a landscape window with barely six holes in it,
          // because the rows are what fall away as the frame gets shorter —
          // so the count opens up with the aspect. Continuous in aspect, and
          // aspect only changes on a resize, so there is no quantised
          // geometry riding a live signal here.
          float cell = aspect / (3.0 + smoothstep(0.75, 1.60, aspect) * 1.6);

          // Only the radius breathes with the music, never the grid: a count
          // driven through floor() snaps the whole sheet to a new layout every
          // time a band crosses a threshold, which is the jitter Lens and
          // Ribbed both had.
          float grow = 0.90 + uSwell * 0.17 + uBeat * 0.05;

          // Nearest hole across a 3x3 neighbourhood. Testing only the cell a
          // pixel falls in clips every circle at the cell wall the moment it
          // grows past half a cell — which is exactly what a pulse does, so
          // the holes were being cropped at their widest. The row shift is a
          // property of each candidate cell rather than of the pixel, so
          // neighbours in other rows keep their own offset.
          // The search runs on the plain radius and the hand-cut wobble is
          // applied once, to whichever circle won. The wobble is under 3% of
          // the radius, far too little to change which circle is nearest
          // except in a band thinner than a pixel — so evaluating an fbm for
          // all nine neighbours bought nothing and cost 9x the noise.
          vec2 cid = floor(gp / cell);
          float bestSd = 1e9, bestRad = 0.0;
          vec2 bestId = cid, bestD = vec2(0.0);
          for (int dy = -1; dy <= 1; dy++){
            for (int dx = -1; dx <= 1; dx++){
              vec2 id = cid + vec2(float(dx), float(dy));
              // Rows shifted, circles jittered within their cell. Nothing in a
              // hand-cut collage sits on a true grid, and a true grid is
              // instantly readable as machine-made.
              vec2 c = (id + 0.5) * cell
                     + vec2((hash(vec2(id.y, 3.7)) - 0.5) * 0.30 * cell, 0.0)
                     + (vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5) * cell * 0.20;
              vec2 d = gp - c;
              float rad = cell * (0.375 + hash(id + 4.4) * 0.055) * grow;
              float sd = length(d) - rad;
              if (sd < bestSd) { bestSd = sd; bestRad = rad; bestId = id; bestD = d; }
            }
          }
          // Scissors do not cut true. Indexed by cell as well as angle, so no
          // two holes share an outline.
          float bang = atan(bestD.y, bestD.x);
          bestSd -= (fbm(vec2(cos(bang), sin(bang)) * 1.15 + bestId * 11.0) - 0.5)
                    * 0.028 * cell * grow;

          float aa = cell * 0.008;
          float inside = 1.0 - smoothstep(-aa, aa, bestSd);
          col = mix(base, inner, inside);

          // The cut edge. A blade through paper leaves a pale hairline of
          // exposed stock, and both references have it on every circle — it
          // is most of what says "cut" rather than "masked".
          float rim = 1.0 - smoothstep(0.0, cell * 0.009, abs(bestSd));
          col += rim * 0.17 * (0.55 + hash(bestId + 9.2) * 0.7);

          // A soft drop shadow just inside the hole, from the thickness of
          // the top sheet.
          float sh = smoothstep(0.0, -cell * 0.045, bestSd);
          col *= 1.0 - (1.0 - sh) * inside * 0.13;

          // Print grain over the whole thing, so the two sheets read as one
          // photographed object rather than as two layers in a compositor.
          float gr = hash(floor(vUv * uRes / 1.4));
          col += (gr - 0.5) * 0.055;
        }

        // ================================================================
        // 7 — DOTS. The picture left alone under a little grain, with a
        // field of flat coloured dots scattered over it that reshuffle to
        // the music. Nothing else moves — the stillness of the photograph
        // is what makes the dots read as laid on top of it.
        // ================================================================
        else if (uMode == 7) {
          col = tex(coverUV(uv));

          float aspect = uRes.x / max(uRes.y, 1.0);
          vec2 gp = vec2(uv.x * aspect, uv.y);
          float cell = aspect / 13.0;
          vec2 base = floor(gp / cell);
          float aa = cell * 0.020;

          // One cell, not a 3x3 neighbourhood. A dot's centre wanders at most
          // 0.29 of a cell and its radius tops out at 0.18, so it can never
          // reach the cell wall — which means the eight neighbours could
          // never contribute and testing them was nine times the work for
          // nothing. Keep the jitter and radius under half a cell between
          // them and this stays exact.
          //
          // Each dot keeps its own clock, offset by a per-cell seed, so they
          // change one at a time rather than the whole field blinking
          // together — that stagger is the difference between shuffling and
          // strobing. Phase is integrated on the CPU: multiplying uTime by a
          // rate would jump every dot to a new step the instant the music
          // changed.
          {
            {
              vec2 id = base;
              float seed = hash(id * 1.7 + 0.5);
              float t = uShuffle + seed * 13.0;
              float stp = floor(t), fr = fract(t);

              vec2 j = vec2(hash(id + stp * 1.7), hash(id + stp * 3.1)) - 0.5;
              vec2 c = (id + 0.5) * cell + j * cell * 0.58;

              // Fade out, move, fade back in. A dot that teleports reads as a
              // glitch; a dot that dissolves and reappears reads as a shuffle.
              float a = smoothstep(0.0, 0.16, fr) * (1.0 - smoothstep(0.84, 1.0, fr));

              // The dots pop on the beat as well as reshuffling on it, so the
              // reaction is visible in the frames between one shuffle and the
              // next rather than only at the moment a dot moves.
              float rr = cell * (0.115 + hash(id + 2.2) * 0.055) * (0.84 + uBeat * 0.46);
              float d = length(gp - c);
              float m = (1.0 - smoothstep(rr - aa, rr + aa, d)) * a;
              vec2 dotUv = vec2(c.x / aspect, c.y);

              // Dots are small and most pixels are covered by none of the
              // nine, so the sampling only runs where one lands — which is
              // what makes the salience test below affordable at all.
              if (m > 0.002) {
                // Shape detection. Local contrast, not distance from a global
                // colour: a clear sky is a gradient, so its top and bottom are
                // genuinely far from any single colour and a global measure
                // scattered dots evenly across it. What marks a subject is
                // differing from its surroundings, so this compares the patch
                // under the dot with four patches a cell away.
                //
                // A dot that lands on background is dropped outright rather
                // than dimmed — a translucent dot reads as a mistake, an
                // absent one reads as the field having moved on. So each
                // reshuffle leaves the survivors collected on the shapes, and
                // they migrate as the shapes do.
                vec3 under = tex(coverUV(dotUv));
                float step1 = cell / aspect;
                float con = 0.0;
                con = max(con, length(under - tex(coverUV(dotUv + vec2( step1, 0.0)))));
                con = max(con, length(under - tex(coverUV(dotUv + vec2(-step1, 0.0)))));
                con = max(con, length(under - tex(coverUV(dotUv + vec2(0.0,  cell)))));
                con = max(con, length(under - tex(coverUV(dotUv + vec2(0.0, -cell)))));
                float keep = 0.12 + 0.88 * smoothstep(0.085, 0.30, con);
                if (hash(id + stp * 7.7) > keep) m = 0.0;
              }
              if (m > 0.002) {
                float hs = hash(id + stp * 5.3);
                float v  = hash(id + stp * 8.9);
                vec3 dc = hue2rgb(hs);
                dc = mix(dc, vec3(1.0), 0.10 + v * 0.22);        // not all full chroma
                dc = mix(dc, vec3(0.055), step(v, 0.11));         // a few near-black
                dc = mix(dc, vec3(0.95), step(0.11, v) * step(v, 0.20));
                // With a second picture loaded every dot is lifted out of it —
                // one flat sample each, so they stay dots. The invented
                // colours are what this look does when there is nothing else
                // to take colour from, not something to mix into a picture.
                if (uHasTexB > 0.5) dc = texB(coverUVB(dotUv));
                col = mix(col, dc, m);
              }
            }
          }

          float gr = hash(floor(vUv * uRes / 1.25));
          col += (gr - 0.5) * 0.062;
        }

        // ================================================================
        // 8 — FIELDS. Torn-paper collage: organic blob cutouts on a paper
        // ground, each one a window onto the photograph, some filled flat
        // in the artwork's own colours. The outlines morph slowly, so the
        // shapes look cut by hand and never settle.
        // ================================================================
        else {
          vec3 paper = uFieldBg;
          col = paper;

          float aspect = uRes.x / max(uRes.y, 1.0);
          vec2 gp = vec2(uv.x * aspect, uv.y);
          /* Wide, short cells: every shape in the reference is a horizontal
             band, far wider than it is tall.

             The column count grows with the frame, which it did not before.
             At a fixed 2.1 columns the cell is as wide as the frame divided
             by 2.1 however wide the frame is — so a desktop got shapes nearly
             three times the size of a phone's, filling the sheet and leaving
             almost none of the paper tone showing. Growing the count keeps a
             cell about the same absolute size on any screen: 0.267 on a
             phone against 0.295 on a desktop, where it used to be 0.265
             against 0.762. */
          float cols = 2.1 + max(0.0, aspect - 0.56) * 3.2;
          vec2 cell = vec2(aspect / cols, 1.0 / 5.2);
          vec2 base = floor(gp / cell);

          // The photograph inside the cutouts drifts, and only drifts. It used
          // to jolt on the downbeat, which is the single most conspicuous
          // quick movement in this look and the opposite of watchable.
          vec2 par = vec2(sin(uTime * 0.031) * 0.020, cos(uTime * 0.024) * 0.015)
                   * (0.7 + uSwell * 0.9);

          /* Where the sheet is answering at the moment. The swell used to lift
             every shape at once, which is one gesture however slowly it
             happens; this makes it arrive somewhere and move on, so there is
             always a part of the field opening and a part settling while the
             rest carries on with its own drift.

             On uTime at a fixed rate, not on a rate that varies with the
             music: multiplying time by a changing rate displaces the whole
             path the instant the rate changes, so the region would jump
             across the frame rather than travel. Two incommensurate sines,
             so it wanders instead of repeating a circuit.

             The rates matter more than they look. At 0.047 the region took
             over two minutes to come round, which is not slow, it is
             stationary — measured over half a minute the busiest part of the
             frame never once changed. Around forty seconds a circuit it
             crosses the frame in twenty or so, which is a drift you can
             follow without ever catching it hurrying. */
          vec2 focus = vec2(aspect * (0.5 + 0.44 * sin(uTime * 0.163)),
                            0.5 + 0.42 * sin(uTime * 0.112 + 1.9));
          // Sized to the frame, so the region is about a third of it either
          // way up rather than a fixed patch that is most of a phone and a
          // corner of a desktop.
          float reach = 0.07 + aspect * 0.075;

          // Nearest blob wins, so overlapping shapes resolve to one surface
          // instead of blending into each other. Evaluated over a 3x3
          // neighbourhood: testing only the cell a pixel falls in clips every
          // shape at the cell wall, which is what turned Marble into a sliced
          // grid the moment anything grew.
          float bestIn = 0.0;
          vec2  bestId = base;
          float bestD = 1e9;
          for (int dy = -1; dy <= 1; dy++){
            for (int dx = -1; dx <= 1; dx++){
              vec2 id = base + vec2(float(dx), float(dy));
              vec2 c = (id + 0.5) * cell
                     + (vec2(hash(id + 0.7), hash(id + 4.9)) - 0.5) * cell * vec2(0.55, 0.45);
              /* Bands drift at their own pace, on uTime rather than on the
                 morph clock — so they are always moving, at the same speed,
                 whether or not anything is playing. Clouds do not stop when
                 the room goes quiet, and this look is supposed to be worth
                 watching before a note is played. */
              c.x += sin(uTime * (0.085 + hash(id + 8.1) * 0.060) + hash(id) * 6.3)
                   * cell.x * 0.15;
              c.y += sin(uTime * (0.060 + hash(id + 2.7) * 0.045) + hash(id + 5.1) * 6.3)
                   * cell.y * 0.11;

              vec2 d = gp - c;
              // Flattened, because these are lying-down shapes.
              vec2 e = vec2(d.x, d.y * 2.15);
              float ang = atan(e.y, e.x);
              float len = length(e);

              // Three angular harmonics with drifting phases. A sum of sines
              // gives a smooth closed outline for a few instructions, where an
              // fbm around the rim costs a dozen hashes per blob and this runs
              // nine times per pixel.
              float s1 = hash(id + 1.1) * 6.28, s2 = hash(id + 2.3) * 6.28,
                    s3 = hash(id + 3.5) * 6.28;
              // Morph runs on an integrated phase, so the music can speed the
              // outlines up without displacing them — multiplying uTime by a
              // rate would jump every shape to a different silhouette the
              // instant the rate changed.
              float w = sin(ang * 2.0 + s1 + uMorph * 1.00) * 0.17
                      + sin(ang * 3.0 - s2 - uMorph * 0.71) * 0.11
                      + sin(ang * 5.0 + s3 + uMorph * 0.51) * 0.055;

              /* Two clocks, both slow, neither with any connection to the
                 beat. "own" is how strongly this blob answers the swell at
                 all, so the sheet opens in loose sequence rather than as one
                 object; "breathe" is its own inflation, on its own phase, so
                 the field is always gently alive the way a colony under a
                 lens is. Both run on the morph clock, which is now slow
                 enough that you notice a shape has changed rather than
                 catching it changing.

                 What was here before: the radius jumped on uPulse squared,
                 and a second term swept a wave across the field once per bar.
                 Between them the sheet lurched twice a bar, which is the
                 "too much of a jump" — a blob is a soft body, and soft bodies
                 do not accelerate. Everything geometric is on the swell now,
                 and the swell cannot move quickly.

                 The range is smaller too: this used to run to 2.06x its
                 resting size, and now reaches 1.42x. Size still answers the
                 music, it just answers it the way bread rises. */
              float own = 0.5 + 0.5 * sin(uMorph * 0.62 + hash(id + 3.3) * 6.28);
              // Always breathing, on its own clock and its own phase, whether
              // or not there is any music. This is the floor of movement that
              // makes the field never quite still.
              float breathe = 0.5 + 0.5 * sin(uTime * 0.070 + hash(id + 7.7) * 6.28);
              // How much of the swell reaches this shape: mostly a question of
              // how near it is to the travelling region, with a little for
              // everyone so the rest of the sheet is not simply switched off.
              vec2 fd = c - focus;
              float near = exp(-dot(fd, fd) / reach);
              float rad = cell.x * (0.355 + hash(id + 5.7) * 0.155) * (1.0 + w)
                        // The focus term is large because it is the only one
                        // that applies to most of the field at any moment: with
                        // a third of the shapes answering instead of all of
                        // them, each has to answer further for the sheet to
                        // move at all. Measured, keeping the old per-shape
                        // amount took total motion from 2.12 to 0.63.
                        * (0.80 + uSwell * (0.12 + near * 0.50 + own * 0.14)
                           + breathe * (0.045 + uSwell * 0.10));
              float sd = len - rad;                 // <0 inside
              if (sd < bestD) { bestD = sd; bestId = id; bestIn = step(sd, 0.0); }
            }
          }

          if (bestIn > 0.5) {
            float kind = hash(bestId + 6.6);
            vec3 shot = pick(uv + par,
                             uHasTexB > 0.5 ? step(hash(bestId + 2.9), 0.40) : 0.0);
            // A few shapes are flat colour rather than photograph — the
            // reference alternates them, and without the flat ones the whole
            // sheet reads as one picture behind a mask.
            vec3 flat3 = palAt(int(mod(hash(bestId + 9.4) * 5.0, 5.0)));
            flat3 = mix(flat3, paper, 0.30);
            float lm = dot(flat3, vec3(0.299, 0.587, 0.114));
            flat3 = mix(vec3(lm), flat3, 0.62);
            col = mix(shot, flat3, step(kind, 0.30));
            // Just inside the cut, a hint of the paper's thickness.
            col *= 1.0 - smoothstep(-cell.x * 0.030, 0.0, bestD) * 0.12;

            // A rim light lived here, and it is gone. Translating Ripple's
            // glint across was wrong twice over: it made a feature of
            // something that should not be one, and it put the sound onto an
            // edge, which is the one part of a torn-paper shape that should
            // look like it was cut once and left alone.
          }

          float gr = hash(floor(vUv * uRes / 1.3));
          col += (gr - 0.5) * 0.045;
        }

        col = clamp(col, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('FX shader:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return false;

    const prog = gl.createProgram();
    gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('FX link:', gl.getProgramInfoLog(prog));
      return false;
    }
    this.prog = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    for (const n of ['uTex','uRes','uTexAspect','uTime','uPhase','uSwell','uLumLo','uLumHi','uMedNorm','uLumLoB','uLumHiB','uMedNormB','uDev','uShuffle','uMorph','uLensShuf','uFocus','uTPaper','uTLight','uTMid','uTDeep','uCPale','uCMid','uCDeep','uFieldBg','uMode','uTexB','uTexBAspect','uHasTexB','uBass','uMid',
                     'uHigh','uLevel','uBeat','uPulse','uBar','uPal','uDrops','uDropAmp','uHasTex']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // Non-power-of-two sources require CLAMP_TO_EDGE and no mipmaps.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([26, 26, 33, 255]));
    this.hasTex = 0;

    this.texB = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                  new Uint8Array([26, 26, 33, 255]));
    this.hasTexB = 0;

    this.canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.ok = false;
    }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.ok = false; this.sized = [0, 0];
      this.init(this.canvas);
      if (this.pendingSource) this.setSource(this.pendingSource, this.pendingW, this.pendingH);
      if (this.pendingB) this.setSourceB(this.pendingB, this.pendingBW, this.pendingBH);
    }, false);

    this.ok = true;
    return true;
  },

  resize(w, h) {
    if (!this.ok) return;
    this.cssW = w; this.cssH = h;
    this._applySize();
  },

  // Split out because the backing store depends on the look as well as on the
  // window, so it has to be recomputed when the mode changes and not only
  // when the window does. It early-outs on an unchanged size, so the common
  // case still costs nothing.
  // Downloads render larger than the live view, so the cap below lifts for
  // as long as a capture is running and drops straight back after. `full`
  // additionally waives both the width cap and the per-look reduction. Both
  // exist to hold a frame rate, and a still is one frame with no frame rate
  // to hold; waiving them is what makes every look, shader or not, save at
  // the same size. A clip is still paid for on every one of its frames, so it
  // keeps them.
  setCaptureScale(k, full) {
    this.captureScale = k; this.captureFull = !!full; this._applySize();
  },

  _applySize() {
    const w = this.cssW, h = this.cssH;
    if (!this.ok || !w || !h) return;
    // Capped: these are full-screen per-pixel passes and a phone does not
    // need them at native retina resolution to look right.
    const maxW = w <= 820 ? 760 : 1180;
    let s = this.captureFull
          ? this.captureScale
          : Math.min(1, maxW / Math.max(1, w))
            * (this.MODE_SCALE[this.mode] || 1) * this.captureScale;
    // Safari caps a canvas by total area rather than by side, and a drawing
    // buffer it refuses to allocate comes back blank rather than throwing.
    const area = w * h * s * s;
    if (area > 11e6) s *= Math.sqrt(11e6 / area);
    const cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
    if (this.sized[0] === cw && this.sized[1] === ch) return;
    this.canvas.width = cw; this.canvas.height = ch;
    this.sized = [cw, ch];
    this.gl.viewport(0, 0, cw, ch);
  },

  setSource(el, w, h) {
    if (!el || !w || !h) return;
    this.pendingSource = el; this.pendingW = w; this.pendingH = h;
    if (!this.ok) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      this.texAspect = w / h;
      this.hasTex = 1;
    } catch (e) { this.hasTex = 0; }
  },

  setSourceB(el, w, h) {
    // Clearing is handled before the ok check: a layer removed while the
    // context is lost must stay removed, or it comes back on restore.
    if (!el) { this.pendingB = null; this.hasTexB = 0; return; }
    if (!this.ok || !w || !h) return;
    this.pendingB = el; this.pendingBW = w; this.pendingBH = h;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      this.texBAspect = w / h;
      this.hasTexB = 1;
    } catch (e) { this.hasTexB = 0; }
  },

  render(p) {
    if (!this.ok) return null;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    if (p.mode !== this.mode) { this.mode = p.mode; this._applySize(); }

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uTexB, 1);
    gl.uniform1f(this.u.uTexBAspect, this.texBAspect);
    gl.uniform1f(this.u.uHasTexB, this.hasTexB);
    gl.uniform2f(this.u.uRes, this.sized[0], this.sized[1]);
    gl.uniform1f(this.u.uTexAspect, this.texAspect);
    gl.uniform1f(this.u.uTime, p.time);
    gl.uniform1f(this.u.uPhase, p.phase);
    gl.uniform1f(this.u.uSwell, p.swell);
    gl.uniform1f(this.u.uLumLo, p.lumLo);
    gl.uniform1f(this.u.uLumHi, p.lumHi);
    gl.uniform1f(this.u.uMedNorm, p.medianNorm);
    gl.uniform1f(this.u.uDev, p.dev);
    gl.uniform1f(this.u.uShuffle, p.shuffle);
    gl.uniform1f(this.u.uMorph, p.morph);
    gl.uniform1f(this.u.uLensShuf, p.lensShuffle);
    gl.uniform1f(this.u.uFocus, p.focus);
    const T = p.tone;
    gl.uniform3fv(this.u.uTPaper, T.paper);
    gl.uniform3fv(this.u.uTLight, T.light);
    gl.uniform3fv(this.u.uTMid,   T.mid);
    gl.uniform3fv(this.u.uTDeep,  T.deep);
    gl.uniform3fv(this.u.uCPale,  T.coatPale);
    gl.uniform3fv(this.u.uCMid,   T.coatMid);
    gl.uniform3fv(this.u.uCDeep,  T.coatDeep);
    gl.uniform3fv(this.u.uFieldBg, T.bg);
    gl.uniform1f(this.u.uLumLoB, p.lumLoB);
    gl.uniform1f(this.u.uLumHiB, p.lumHiB);
    gl.uniform1f(this.u.uMedNormB, p.medianNormB);
    gl.uniform1i(this.u.uMode, p.mode);
    gl.uniform1f(this.u.uBass, p.bass);
    gl.uniform1f(this.u.uMid, p.mid);
    gl.uniform1f(this.u.uHigh, p.high);
    gl.uniform1f(this.u.uLevel, p.level);
    gl.uniform1f(this.u.uBeat, p.beat);
    gl.uniform1f(this.u.uPulse, p.pulse || 0);
    gl.uniform1f(this.u.uBar, p.bar || 0);
    gl.uniform1f(this.u.uHasTex, this.hasTex);

    const pal = new Float32Array(15);
    for (let i = 0; i < 5; i++) {
      const c = p.palette[i % Math.max(1, p.palette.length)] || [120, 120, 140];
      pal[i*3] = c[0] / 255; pal[i*3+1] = c[1] / 255; pal[i*3+2] = c[2] / 255;
    }
    gl.uniform3fv(this.u.uPal, pal);

    const drops = this._dropBuf || (this._dropBuf = new Float32Array(24));
    const damp = this._dropAmp || (this._dropAmp = new Float32Array(6));
    drops.fill(0);
    for (let i = 0; i < 6; i++) {
      const d = p.drops[i];
      damp[i] = d ? (d.a == null ? 1 : d.a) : 0;
      if (d) { drops[i*4] = d.x; drops[i*4+1] = d.y; drops[i*4+2] = d.age;
               drops[i*4+3] = d.s == null ? 1 : d.s; }
    }
    gl.uniform4fv(this.u.uDrops, drops);
    gl.uniform1fv(this.u.uDropAmp, damp);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
};
