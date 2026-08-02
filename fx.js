/* =====================================================================
   FX — WebGL distortion layer.

   The canvas-2D looks treat the artwork as something to paint *over*.
   These treat it as a texture to bend: refraction through water, a fluted
   glass pane, marbled ink, a grid of lenses. All four are per-pixel
   resamplings, which is a fragment shader's job — doing them with
   getImageData would cost tens of milliseconds a frame on a phone.

   Renders to its own offscreen canvas; album.html blits the result into
   the main 2D canvas so grain, vignette and the HUD keep working.
   ===================================================================== */
"use strict";

const FX = {
  canvas: null, gl: null, prog: null, tex: null, u: {}, ok: false,
  texAspect: 1, sized: [0, 0],

  MODES: { Ripple: 0, Ribbed: 1, Marble: 2, Lens: 3 },

  init() {
    if (this.ok) return true;
    this.canvas = document.createElement('canvas');
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
      uniform int   uMode;
      uniform float uBass, uMid, uHigh, uLevel, uBeat;
      uniform vec3  uPal[5];
      uniform vec4  uDrops[4];     // x, y, age(sec), active
      uniform float uHasTex;

      // ---- helpers -----------------------------------------------------
      vec3 palAt(int i){
        vec3 c = uPal[0];
        for (int k = 0; k < 5; k++) { if (k == i) c = uPal[k]; }
        return c;
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
        for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
        return v;
      }

      // Water surface height, normalised to roughly -1..1 so downstream
      // maths stays in a predictable range. Written once and sampled three
      // times for the gradient — duplicating the expression inline is how
      // the terms drift out of sync.
      float waterH(vec2 p, float t){
        float h  = sin(p.x * 7.0 + t * 1.10) * 0.50;
              h += sin(p.y * 5.3 - t * 0.85) * 0.45;
              h += sin((p.x + p.y) * 9.4 + t * 0.65) * 0.30;
              h += sin(p.x * 17.0 - t * 1.7) * 0.16;
              h += (fbm(p * 2.1 + t * 0.25) - 0.5) * 0.90;
        for (int i = 0; i < 4; i++){
          if (uDrops[i].w > 0.5){
            float d = distance(p, uDrops[i].xy);
            float age = uDrops[i].z;
            h += sin(d * 26.0 - age * 9.0) * exp(-d * 2.6) * exp(-age * 1.4) * 0.8;
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

      // Variable-radius blur. Six taps on a rosette is enough at the radii
      // used here and costs a fraction of a separable pass.
      vec3 softTex(vec2 uv, float r){
        if (r < 0.0008) return tex(uv);
        vec3 c = tex(uv);
        for (int i = 0; i < 6; i++){
          float a = float(i) * 1.0472;
          c += tex(uv + vec2(cos(a), sin(a)) * r);
        }
        return c / 7.0;
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
          float t = uTime * 0.38;
          vec2 p = uv * vec2(uRes.x / max(uRes.y,1.0), 1.0);

          float e  = 0.004;
          float h  = waterH(p, t);
          float hx = waterH(p + vec2(e, 0.0), t) - h;
          float hy = waterH(p + vec2(0.0, e), t) - h;
          vec2  grad = vec2(hx, hy) / e;

          // Small on purpose. The gradient of a sum of sines runs to ~4, so
          // an offset in the hundredths already bends the image hard; at the
          // tenths it stops being refraction and becomes soup.
          float amt = 0.0105 + uBass * 0.0260 + uBeat * 0.0150;
          vec2 off = grad * amt;

          // Chromatic dispersion keeps it reading as refraction, not blur.
          float disp = 1.0 + uHigh * 0.55;
          col.r = tex(coverUV(uv + off * (1.0 + 0.07 * disp))).r;
          col.g = tex(coverUV(uv + off)).g;
          col.b = tex(coverUV(uv + off * (1.0 - 0.07 * disp))).b;

          // Caustic glint along the crests. h must be clamped before the
          // power: unnormalised it exceeded 1 and blew whole regions white.
          float cr = clamp(h * 0.5 + 0.5, 0.0, 1.0);
          col += pow(cr, 7.0) * (0.10 + uLevel * 0.18);
        }

        // ================================================================
        // 1 — RIBBED GLASS. Each flute is a cylindrical lens showing a
        // compressed slice. Clarity is deliberately uneven and drifts, so
        // some of the image is sharp and some dissolves — the parts nearer
        // the glass versus further from it.
        // ================================================================
        else if (uMode == 1){
          float cols = 32.0 + floor(uMid * 8.0);
          float x    = uv.x * cols;
          float rib  = floor(x);
          float f    = fract(x) * 2.0 - 1.0;          // -1..1 across the flute

          // Compressing the sampled slice is what makes a flute read as
          // glass rather than as a stripe.
          float mag = 0.46 - uBass * 0.12;
          float sx  = (rib + 0.5) / cols + f * (0.5 / cols) * mag;

          float wob = sin(uv.y * 3.0 + uTime * 0.18) * 0.004 * (1.0 + uLevel);
          vec2 suv = coverUV(vec2(sx + wob, uv.y));

          // The clarity field drifts slowly and is nudged by transients, so
          // *which* parts are sharp is itself the animation.
          float clarity = fbm(vec2(uv.x * 1.6, uv.y * 2.2) + uTime * 0.045);
          // Tight smoothstep: sharp zones and dissolved zones with a fast
          // handover, rather than a uniform middling softness everywhere.
          clarity = smoothstep(0.36, 0.62, clarity + uBeat * 0.18);
          float blur = (1.0 - clarity) * (0.016 + uLevel * 0.010);

          col = softTex(suv, blur);

          // Edge shading on each flute gives the glass thickness.
          float edge = 1.0 - pow(abs(f), 2.6) * 0.62;
          col *= edge;
          // Two speculars per flute — a bright catch-light and a weaker
          // return off the far curve. This is most of what sells it as glass.
          col += pow(max(0.0, 1.0 - abs(f + 0.52) * 6.5), 2.2) * 0.30 * (0.35 + clarity);
          col += pow(max(0.0, 1.0 - abs(f - 0.30) * 9.0), 3.0) * 0.12 * (0.35 + clarity);
        }

        // ================================================================
        // 2 — MARBLE. Domain-warped noise quantised into flat bands and
        // mapped to the artwork's palette: big blobs, not fine veining.
        // Beats drop new "ink" that pushes the pattern outward from a point.
        // ================================================================
        else if (uMode == 2){
          float ar = uRes.x / max(uRes.y, 1.0);
          float rows = 9.0;
          float cols = max(3.0, floor(rows * ar * 0.62));
          vec2 gp   = uv * vec2(cols, rows);
          vec2 cell = floor(gp);
          vec2 f    = fract(gp) - 0.5;

          float swell = 0.0;
          for (int i = 0; i < 4; i++){
            if (uDrops[i].w > 0.5){
              float d = length(uv - vec2(uDrops[i].x / 1.6, uDrops[i].y));
              swell += exp(-d * 3.0) * exp(-uDrops[i].z * 1.1) * 0.34;
            }
          }

          float r1 = hash(cell), r2 = hash(cell + 13.1), r3 = hash(cell + 41.7);
          float ce = mix(uBass, uHigh, fract(r1 * 3.0));

          // Sizes vary hard and density drifts across the canvas, so the
          // field is crowded in places and open in others rather than an
          // even grid of near-identical shapes.
          float density = fbm(uv * vec2(ar, 1.0) * 1.4 + 3.0);
          vec2 hs = vec2(0.13 + r1 * 0.27, 0.15 + r2 * 0.34);
          hs *= 0.55 + density * 0.95;
          hs *= 1.0 + ce * 0.26 + uBeat * 0.20 + swell;
          if (r3 > 0.86) hs *= 0.25;              // occasional near-empty cell

          float rough = (fbm(uv * vec2(ar, 1.0) * 11.0 + uTime * 0.030) - 0.5) * 0.14
                      + (fbm(uv * vec2(ar, 1.0) * 26.0) - 0.5) * 0.045;
          float rad = 0.19;
          vec2  d2  = abs(f) - hs + rad;
          float sdf = length(max(d2, 0.0)) + min(max(d2.x, d2.y), 0.0) - rad + rough;

          // The ground is the artwork's dominant colour, not black — the
          // reference is a vivid blue field carrying the blobs. Black is an
          // outline that haloes each shape, which is what gives the printed,
          // ink-bled quality.
          vec3 ground = palAt(0) * (0.86 + fbm(uv * 5.0) * 0.22);
          int band = int(mod(cell.x * 2.0 + floor(cell.y * 0.5), 4.0)) + 1;
          vec3 ink = palAt(band);
          ink = mix(ink, ink * vec3(0.80, 0.82, 0.86), 0.35);
          ink *= 0.88 + fbm(uv * 9.0) * 0.24;

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
        else {
          float grid = 7.0 + floor(uHigh * 2.0);
          float ar   = uRes.x / max(uRes.y, 1.0);
          vec2  gv   = vec2(uv.x * ar, uv.y) * grid;
          vec2  cell = floor(gv);
          vec2  f    = fract(gv) * 2.0 - 1.0;

          float r = length(f);
          float band = mod(cell.x + cell.y, 5.0);
          float pulse = 0.94 + uBass * 0.09 + uBeat * 0.08
                      + sin(uTime * 0.5 + (cell.x + cell.y) * 0.7) * 0.03;

          if (r > pulse){
            col = vec3(0.035, 0.033, 0.045);
          } else {
            // Fisheye: compress toward the rim so the centre magnifies.
            float rr = pow(r / pulse, 1.85) * pulse;
            vec2 warped = (r > 0.0001) ? (f / r) * rr : f;
            vec2 centre = (cell + 0.5) / grid;
            centre.x /= ar;
            vec2 suv = centre + warped * (0.5 / grid) * vec2(1.0 / ar, 1.0)
                              * (2.6 + uBass * 0.55);
            col = tex(coverUV(suv));

            // Riso duotone: grey through the midtones, palette colour at
            // the extremes. Straight saturation boosting gave garish
            // circles; the reference is muted in the middle and vivid only
            // where the ink pools.
            float l = dot(col, vec3(0.299, 0.587, 0.114));
            float lp = l + (fbm(vUv * 6.0 + 11.0) - 0.5) * 0.22;
            vec3 duo = mix(palAt(int(band)), palAt(int(mod(band + 2.0, 5.0))),
                           smoothstep(0.22, 0.78, lp));
            col = mix(vec3(l * 0.92), duo, 0.62 + 0.38 * abs(l - 0.5) * 2.0);
            col *= 0.72 + 0.28 * pow(1.0 - r / pulse, 0.5);
            // Soft internal falloff so each circle reads as pooled ink
            // rather than a flat disc of colour.
            col *= 0.84 + 0.30 * (1.0 - smoothstep(0.0, 1.0, r / pulse));
          }

          // Litho grain, coarse and heavy — sampled below pixel resolution
          // so it clumps the way print grain does instead of shimmering.
          float gr = hash(floor(vUv * uRes / 1.7) + floor(uTime * 12.0) * 3.3);
          col += (gr - 0.5) * 0.20;
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

    for (const n of ['uTex','uRes','uTexAspect','uTime','uMode','uBass','uMid',
                     'uHigh','uLevel','uBeat','uPal','uDrops','uHasTex']) {
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

    this.ok = true;
    return true;
  },

  resize(w, h) {
    if (!this.ok) return;
    // Capped: these are full-screen per-pixel passes and a phone does not
    // need them at native retina resolution to look right.
    const maxW = 1280;
    const s = Math.min(1, maxW / Math.max(1, w));
    const cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
    if (this.sized[0] === cw && this.sized[1] === ch) return;
    this.canvas.width = cw; this.canvas.height = ch;
    this.sized = [cw, ch];
    this.gl.viewport(0, 0, cw, ch);
  },

  setSource(el, w, h) {
    if (!this.ok || !el || !w || !h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      this.texAspect = w / h;
      this.hasTex = 1;
    } catch (e) { this.hasTex = 0; }
  },

  render(p) {
    if (!this.ok) return null;
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.uniform1i(this.u.uTex, 0);
    gl.uniform2f(this.u.uRes, this.sized[0], this.sized[1]);
    gl.uniform1f(this.u.uTexAspect, this.texAspect);
    gl.uniform1f(this.u.uTime, p.time);
    gl.uniform1i(this.u.uMode, p.mode);
    gl.uniform1f(this.u.uBass, p.bass);
    gl.uniform1f(this.u.uMid, p.mid);
    gl.uniform1f(this.u.uHigh, p.high);
    gl.uniform1f(this.u.uLevel, p.level);
    gl.uniform1f(this.u.uBeat, p.beat);
    gl.uniform1f(this.u.uHasTex, this.hasTex);

    const pal = new Float32Array(15);
    for (let i = 0; i < 5; i++) {
      const c = p.palette[i % Math.max(1, p.palette.length)] || [120, 120, 140];
      pal[i*3] = c[0] / 255; pal[i*3+1] = c[1] / 255; pal[i*3+2] = c[2] / 255;
    }
    gl.uniform3fv(this.u.uPal, pal);

    const drops = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const d = p.drops[i];
      if (d) { drops[i*4] = d.x; drops[i*4+1] = d.y; drops[i*4+2] = d.age; drops[i*4+3] = 1; }
    }
    gl.uniform4fv(this.u.uDrops, drops);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.canvas;
  }
};
