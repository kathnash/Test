/* =====================================================================
   Shared audio engine.
   Loaded by index.html and album.html as a classic <script> (not a module,
   so it still works when the pages are opened directly from disk).

   Everything downstream reads from the global `A`: level, bass/mid/high/air,
   beat pulses, spectral centroid, BPM, and the raw spectrum array.
   ===================================================================== */
"use strict";

const A = {
  ctx: null, analyser: null, stream: null, osc: null,
  freq: null, wave: null, binHz: 0,
  bass: 0, mid: 0, high: 0, air: 0, level: 0,
  centroid: 0.5,          // 0..1, "brightness" of the sound
  beat: 0,                // decays 1 -> 0 after each detected onset
  beatFlash: 0,
  bpm: 0,
  ready: false, silentFor: 0,

  _hist: [], _lastBeat: 0, _beatTimes: [],
  _peak: { bass:.01, mid:.01, high:.01, air:.01, level:.01 },
  _stat: { bass:{mu:0,sd:.02}, mid:{mu:0,sd:.02}, high:{mu:0,sd:.02},
           air:{mu:0,sd:.02}, level:{mu:0,sd:.02} },
  _prevSpec: null, _fluxHist: [], _beatRaw: 0,
  // Envelope shaping. Attack keeps transients legible, release stops the
  // fall from flickering, and the second glide stage removes the velocity
  // kink where the follower switches between the two.
  SD_FLOOR: 0.012,
  ENV_ATTACK: 0.035, ENV_RELEASE: 0.28, ENV_GLIDE: 0.09,
  _env: { bass:0, mid:0, high:0, air:0, level:0 },
  _env2: { bass:0, mid:0, high:0, air:0, level:0 },
  presence: 0,

  async start(kind) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.84;
    this.analyser.minDecibels = -95;
    this.analyser.maxDecibels = -12;

    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.frequencyBinCount);
    this.binHz = this.ctx.sampleRate / 2 / this.analyser.frequencyBinCount;

    let node;
    if (kind === 'mic') {
      // These three flags matter enormously. Browsers default to speech
      // processing, which actively fights music: it treats the song as
      // "echo" and cancels it out. Turning them off is what makes a
      // microphone usable as a music input.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });
      node = this.ctx.createMediaStreamSource(this.stream);

    } else if (kind === 'tab') {
      // video:true is required — Chrome will not hand over audio for an
      // audio-only display capture request.
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1, height: 1, frameRate: 1 },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude'
      });
      if (this.stream.getAudioTracks().length === 0) {
        this.stream.getTracks().forEach(t => t.stop());
        throw new Error('NO_AUDIO_TRACK');
      }
      this.stream.getVideoTracks().forEach(t => t.stop()); // drop pixels, keep sound
      node = this.ctx.createMediaStreamSource(this.stream);

    } else {
      node = this._demoSource();
    }

    node.connect(this.analyser);
    this.ready = true;
  },

  // Keeps a live handle on the mic/tab stream so a recogniser can record a
  // snippet from the same capture rather than opening a second one.
  getStream() { return this.stream; },

  // A small self-contained musical phrase so the visuals can be judged
  // without granting any permissions.
  _demoSource() {
    const out = this.ctx.createGain();
    out.gain.value = 0.9;
    const bus = this.ctx.createGain();
    bus.connect(out);

    const scale = [0, 3, 5, 7, 10, 12, 15];
    const root = 110;
    let step = 0;
    const tick = () => {
      if (!this.ctx || this.ctx.state === 'closed') return;
      const t = this.ctx.currentTime;

      if (step % 4 === 0) {                       // kick
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        g.gain.setValueAtTime(1.0, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.connect(g).connect(bus); o.start(t); o.stop(t + 0.32);
      }
      if (step % 2 === 1) {                       // hat
        const buf = this.ctx.createBuffer(1, 2048, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = this.ctx.createBufferSource(); s.buffer = buf;
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        const g = this.ctx.createGain(); g.gain.value = 0.22;
        s.connect(hp).connect(g).connect(bus); s.start(t);
      }
      const n = scale[(step * 3) % scale.length] + (step % 8 < 4 ? 0 : 5);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = root * Math.pow(2, n / 12) * 2;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      o.connect(lp).connect(g).connect(bus); o.start(t); o.stop(t + 0.45);

      step++;
      this.osc = setTimeout(tick, 250);           // 120bpm, eighth notes
    };
    tick();
    return out;
  },

  _band(loHz, hiHz) {
    const lo = Math.max(0, Math.floor(loHz / this.binHz));
    const hi = Math.min(this.freq.length - 1, Math.ceil(hiHz / this.binHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.freq[i];
    return sum / ((hi - lo + 1) * 255);
  },

  /* Peak normalisation alone has a serious failure mode: it divides by a
     decaying maximum, so a band that stays roughly constant sits pinned near
     1.0 and never moves. Punchy tracks look reactive; smooth or ambient ones
     look like a random animation with music happening nearby.

     So each band is also measured against its OWN recent behaviour — how far
     above or below its running mean it currently sits, scaled by how much it
     normally varies. A quiet track with small fluctuations has a small
     deviation, so those small fluctuations still fill the range. The two
     measures are blended: relative for reactivity, absolute so loud passages
     still read as louder. */
  _react(key, raw, dt) {
    const s = this._stat[key];
    const a = 1 - Math.exp(-dt / 1.6);          // ~1.6s adaptation
    s.mu += (raw - s.mu) * a;
    s.sd += (Math.abs(raw - s.mu) - s.sd) * a;

    // The floor matters more than it looks. Dividing by the deviation is what
    // gives quiet music its range, but it also multiplies the FFT's own
    // frame-to-frame noise by 1/sd — so on ambient material, where sd is
    // genuinely tiny, the output turned to jitter. The floor caps that gain.
    const sd = Math.max(s.sd, this.SD_FLOOR);
    const rel = Math.min(1, Math.max(0, 0.5 + (raw - s.mu) / (4.0 * sd)));
    const v = rel * 0.58 + this._norm(key, raw) * 0.42;

    // Envelope follower: rise quickly so transients still land, fall slowly so
    // the result glides instead of flickering. A symmetric smoother would have
    // to be slow in both directions and would blunt every hit.
    const e = this._env, e2 = this._env2;
    const tau = v > e[key] ? this.ENV_ATTACK : this.ENV_RELEASE;
    e[key] += (v - e[key]) * (1 - Math.exp(-dt / tau));
    e2[key] += (e[key] - e2[key]) * (1 - Math.exp(-dt / this.ENV_GLIDE));
    return e2[key];
  },

  // Auto-gain: track a slowly-decaying peak per band and normalise against
  // it. This is why quiet phone speakers and loud PA systems both look
  // right without the user touching a sensitivity slider.
  _norm(key, raw) {
    const p = this._peak;
    p[key] = Math.max(raw, p[key] * 0.9985);
    if (p[key] < 0.008) p[key] = 0.008;
    return Math.min(1, raw / p[key]);
  },

  update(dt) {
    if (!this.ready) return;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);

    const rawBass = this._band(30, 150);
    const rawMid  = this._band(150, 1200);
    const rawHigh = this._band(1200, 5000);
    const rawAir  = this._band(5000, 14000);
    const rawLvl  = (rawBass + rawMid + rawHigh + rawAir) / 4;

    // Near-silence should read as still, not as amplified noise: the
    // relative measure would otherwise make room tone look like music.
    const target = Math.min(1, Math.max(0, (rawLvl - 0.004) / 0.020));
    this.presence += (target - this.presence) * (1 - Math.exp(-dt / 0.35));

    this.bass  = this._react('bass',  rawBass, dt) * this.presence;
    this.mid   = this._react('mid',   rawMid,  dt) * this.presence;
    this.high  = this._react('high',  rawHigh, dt) * this.presence;
    this.air   = this._react('air',   rawAir,  dt) * this.presence;
    this.level = this._react('level', rawLvl,  dt) * this.presence;

    this.silentFor = rawLvl < 0.004 ? this.silentFor + dt : 0;

    // Spectral centroid — the "centre of mass" of the spectrum. Bright,
    // cymbal-heavy passages push it up; bassy passages pull it down.
    let num = 0, den = 0;
    for (let i = 0; i < this.freq.length; i++) { num += i * this.freq[i]; den += this.freq[i]; }
    const c = den > 0 ? (num / den) / this.freq.length : 0.25;
    this.centroid += (Math.min(1, c * 3.2) - this.centroid) * 0.06;

    /* Onsets from spectral flux — the summed positive change across the
       whole spectrum — rather than from low-band energy. Watching only the
       bass finds nothing in acoustic, vocal or ambient material, which is
       precisely the music that looked unreactive. Flux fires on a plucked
       string or a vocal entry as readily as on a kick. */
    let flux = 0;
    const top = Math.floor(this.freq.length * 0.75);
    if (this._prevSpec) {
      for (let i = 2; i < top; i++) {
        const d = this.freq[i] - this._prevSpec[i];
        if (d > 0) flux += d;
      }
      flux /= (top * 255);
    }
    if (!this._prevSpec) this._prevSpec = new Uint8Array(this.freq.length);
    this._prevSpec.set(this.freq);

    this._fluxHist.push(flux);
    if (this._fluxHist.length > 45) this._fluxHist.shift();
    const fMean = this._fluxHist.reduce((a, b) => a + b, 0) / this._fluxHist.length;
    let fVar = 0;
    for (const v of this._fluxHist) fVar += (v - fMean) * (v - fMean);
    const fSd = Math.sqrt(fVar / Math.max(1, this._fluxHist.length));

    // Threshold rides on the local mean plus a multiple of the local spread,
    // so it adapts to both a dense mix and a sparse one.
    const thresh = fMean + Math.max(fSd * 1.5, 0.0016);
    const now = performance.now();
    if (flux > thresh && this.presence > 0.25 && now - this._lastBeat > 150) {
      this._lastBeat = now;
      this._beatRaw = 1;      // sharp, for triggers
      this.beatFlash = 1;
      this._beatTimes.push(now);
      if (this._beatTimes.length > 12) this._beatTimes.shift();
      if (this._beatTimes.length > 4) {
        const gaps = [];
        for (let i = 1; i < this._beatTimes.length; i++) gaps.push(this._beatTimes[i] - this._beatTimes[i-1]);
        gaps.sort((a, b) => a - b);
        const med = gaps[gaps.length >> 1];
        if (med > 250 && med < 1400) this.bpm = Math.round(60000 / med);
      }
    }
    // beatFlash stays sharp — things like ink drops and colour flips want an
    // instantaneous trigger. `beat` is used as a continuous amount, and
    // slamming it to 1 put a hard step into anything sized by it (the Lens
    // circles most visibly), so it chases the sharp value instead.
    this._beatRaw  = Math.max(0, this._beatRaw  - dt * 2.6);
    this.beatFlash = Math.max(0, this.beatFlash - dt * 5.5);
    this.beat += (this._beatRaw - this.beat) * (1 - Math.exp(-dt / 0.10));
  },

  stop() {
    if (this.osc) clearTimeout(this.osc);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close();
    Object.assign(this, {
      ctx:null, stream:null, osc:null, ready:false, presence:0,
      beat:0, beatFlash:0, bpm:0, _beatRaw:0, _hist:[], _beatTimes:[],
      _prevSpec:null, _fluxHist:[],
      _peak:{ bass:.01, mid:.01, high:.01, air:.01, level:.01 },
      _env:{ bass:0, mid:0, high:0, air:0, level:0 },
      _env2:{ bass:0, mid:0, high:0, air:0, level:0 },
      _stat:{ bass:{mu:0,sd:.02}, mid:{mu:0,sd:.02}, high:{mu:0,sd:.02},
              air:{mu:0,sd:.02}, level:{mu:0,sd:.02} }
    });
  }
};
