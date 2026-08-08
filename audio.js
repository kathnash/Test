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
  // How far above the local norm the last detected onset stood. An onset
  // detector answers "did something start"; this answers "how much of a
  // thing", which is what separates a hit worth reacting to from the soft
  // pulse still ticking underneath a held note.
  beatStrength: 0,
  bpm: 0,
  ready: false, silentFor: 0,

  /* The beat grid. `beat` above fires on every onset there is — every kick,
     snare, hat and plucked note — which at 120bpm is something every quarter
     second. Anything driven by it moves constantly, and constant movement is
     what reads as frantic no matter how smooth each individual step is.

     Music is counted in bars, and the first beat of a bar is the one that
     carries the weight. These track that instead: the tempo, where the beats
     fall, how many of them make a bar, and which one is the strong one. */
  tempo: 0,               // bpm of the tracked pulse, 0 until locked
  lock: 0,                // 0..1 confidence in the grid below
  group: 4,               // beats per bar, as detected
  beatPhase: 0,           // 0..1 through the current beat
  bar: 0,                 // 0..1 through the current bar, wraps at the downbeat
  pulse: 0,               // followed envelope, fires on downbeats only
  pulseFlash: 0,          // instantaneous downbeat trigger
  gridFlash: 0,           // instantaneous, on every beat of the grid
  beatInBar: 0,           // 0 on the downbeat, up to group - 1

  _hist: [], _lastBeat: 0, _beatTimes: [],
  _peak: { bass:.01, mid:.01, high:.01, air:.01, level:.01 },
  _stat: { bass:{mu:0,sd:.02}, mid:{mu:0,sd:.02}, high:{mu:0,sd:.02},
           air:{mu:0,sd:.02}, level:{mu:0,sd:.02} },
  _prevSpec: null, _fluxHist: [], _beatRaw: 0,
  gridAnalyser: null, _sampler: null, _gridSpec: null, _prevGrid: null,
  _gridHz: 0, _gridT: 0, _gMu: 0, _gSd: 0.002, _sdt: 0.02,
  _floor: 0.002,          // learned noise floor, see update()
  _t: 0,                  // seconds since start, from dt rather than a clock
  // Onset envelope at a fixed 25ms rate, ten seconds of it. Fixed rate
  // matters: requestAnimationFrame is not a clock, and an autocorrelation
  // over frames measures the frame rate as much as it measures the music.
  _oe: new Float32Array(400), _oeLo: new Float32Array(400),
  _oeHead: 0, _oeFill: 0, _oeAcc: 0, _oeLoAcc: 0, _oeT: 0,
  _acX: null, _acS: null, _trackT: 0,
  _period: 0.5, _nextBeat: 0, _beatIdx: 0, _accent: 0,
  _slots: [new Float32Array(2), new Float32Array(3), new Float32Array(4)],
  _off: 0, _pulseRaw: 0, _sinceP: 0,
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

    /* The grid gets its own analyser and its own timer, and both halves of
       that matter.

       Its own timer, because the render loop is not a clock. Everything else
       here is sampled once per frame, which is fine for a value a look reads
       once per frame — but tempo is measured by correlating a signal against
       a delayed copy of itself, and sampling that signal at the frame rate
       measures the frame rate too. On a heavy look running at 6fps the
       tracker locked, confidently, to 151bpm on a 120bpm track. A timer runs
       at its own rate whether or not the GPU is keeping up.

       Its own analyser, because sharing one would change the smoothing that
       every existing look depends on: the smoothing constant is applied per
       read, so reading the same node twice as often quietly halves it. This
       one is also smoothed much less, since blurring is exactly wrong for
       finding the moment something starts. */
    this.gridAnalyser = this.ctx.createAnalyser();
    this.gridAnalyser.fftSize = 2048;
    this.gridAnalyser.smoothingTimeConstant = 0.35;
    this.gridAnalyser.minDecibels = -95;
    this.gridAnalyser.maxDecibels = -12;
    node.connect(this.gridAnalyser);
    this._gridSpec = new Uint8Array(this.gridAnalyser.frequencyBinCount);
    this._prevGrid = new Uint8Array(this.gridAnalyser.frequencyBinCount);
    this._gridHz = this.ctx.sampleRate / 2 / this.gridAnalyser.frequencyBinCount;
    this._gridT = performance.now() / 1000;
    this._sampler = setInterval(() => this._sampleOnset(), 20);

    this.ready = true;
  },

  /* What kind of sound is happening right now: 1 is all low, 0 all bright.

     Read straight off the grid analyser's spectrum rather than from the band
     envelopes, because those are far too slow to characterise a single hit —
     at a 280ms release the previous hi-hat is still half present when the
     kick lands, so every hit measures as roughly the same mixture. Measured
     on the demo, the envelopes gave a range of 0.65..0.85 where this gives
     the kicks and the hats genuinely different answers. */
  tone() {
    const f = this._gridSpec;
    if (!f || !this._gridHz) return 0.5;
    const at = hz => Math.max(1, Math.min(f.length - 1, Math.round(hz / this._gridHz)));
    let lo = 0, hi = 0;
    const l0 = at(30), l1 = at(180), h0 = at(2000), h1 = at(11000);
    for (let i = l0; i <= l1; i++) lo += f[i];
    for (let i = h0; i <= h1; i++) hi += f[i];
    lo /= (l1 - l0 + 1); hi /= (h1 - h0 + 1);
    return (lo + 1) / (lo + hi + 2);
  },

  // 50Hz, independent of how fast anything is being drawn.
  _sampleOnset() {
    if (!this.ready || !this.gridAnalyser) return;
    const now = performance.now() / 1000;
    // Clamped: a backgrounded tab throttles this to about 1Hz, and the grid
    // should resynchronise on return rather than integrate the whole gap.
    const dt = Math.min(0.2, Math.max(0.001, now - this._gridT));
    this._gridT = now;
    this._t += dt;
    // How evenly this is actually being called. A timer is only independent
    // of the render loop while the main thread is free to run it; a long
    // enough frame blocks it too, and then the envelope is sampled in bursts
    // and the tempo it implies is the frame rate's, not the music's. Feeding
    // this into confidence means a device that cannot sample the audio
    // properly falls back to the untimed pulse rather than locking to a
    // tempo that is not there.
    this._sdt += (dt - this._sdt) * 0.05;

    const f = this._gridSpec;
    this.gridAnalyser.getByteFrequencyData(f);
    const top = Math.floor(f.length * 0.75);
    // Two onset measures from one read. Broadband finds the tempo on any
    // material, drums or not. The low band finds where the kick is, which
    // broadband cannot: a track with a note on every eighth has the same
    // onset energy at every phase of the beat, so folding the broadband
    // envelope onto one period gives a tie and the phase comes down to a
    // coin flip — measured, that put the downbeat between the kicks rather
    // than on them about as often as not.
    const loEnd = Math.min(top, Math.ceil(200 / this._gridHz));
    let flux = 0, fluxLo = 0;
    for (let i = 2; i < top; i++) {
      const d = f[i] - this._prevGrid[i];
      if (d > 0) { flux += d; if (i < loEnd) fluxLo += d; }
    }
    flux /= (top * 255);
    fluxLo /= (Math.max(1, loEnd - 2) * 255);
    this._prevGrid.set(f);

    // Its own running mean and spread, so a beat can be ranked against how
    // eventful this track normally is rather than against an absolute number.
    const a = 1 - Math.exp(-dt / 1.2);
    this._gMu += (flux - this._gMu) * a;
    this._gSd += (Math.abs(flux - this._gMu) - this._gSd) * a;
    const z = this._gSd > 1e-9 ? (flux - this._gMu) / this._gSd : 0;

    const lo = Math.max(0, Math.floor(30 / this._gridHz));
    const hi = Math.min(f.length - 1, Math.ceil(150 / this._gridHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += f[i];

    this._grid(dt, flux, z, sum / ((hi - lo + 1) * 255), fluxLo);
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
    const rel = Math.min(1, Math.max(0, 0.5 + (raw - s.mu) / (3.3 * sd)));
    const v = rel * 0.64 + this._norm(key, raw) * 0.36;

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

  /* ===================================================================
     THE BEAT GRID

     Three questions, answered in order, each depending on the one before.

     1. How fast? Autocorrelate the onset envelope. The lag whose copy of the
        signal best matches the original is the beat period.
     2. Where? Fold the envelope onto one period and find the phase most
        onset energy lands on. That is where the beats are.
     3. Which one is the strong one? Score how hard each beat hit, keep a
        running average per position for bars of 2, 3 and 4, and take the
        grouping whose average is most sharply peaked. The peak is the
        downbeat.

     Kept honest by a confidence measure: on music with no steady pulse at
     all — much ambient, free-time playing, a spoken voice — there is no
     right answer to question 1, and inventing one would be worse than not
     answering. Below the threshold the grid is not used at all and `pulse`
     falls back to firing on unusually strong onsets, which is slow and
     meaningful even without a tempo.
     =================================================================== */
  OE_DT: 0.025,

  _grid(dt, flux, onsetZ, rawBass, fluxLo) {
    const N = this._oe.length;

    /* Accumulate flux into fixed-rate buckets, spread across every bucket the
       frame covered rather than dumped into the first of them.

       This matters more than it looks. Whenever the frame rate falls below
       the bucket rate — a heavy look on a throttling phone — dumping leaves a
       run of empty buckets after each full one, which is an impulse train at
       exactly the frame rate. Autocorrelation then finds the frame rate,
       cleanly and confidently, and reports it as the tempo. Measured on a
       look running at 6fps it locked to 145bpm on a 120bpm track. Spreading
       the same energy evenly leaves a slow frame rate merely blurred, which
       costs precision but invents nothing. */
    this._oeAcc += flux;
    this._oeLoAcc += fluxLo;
    this._oeT += dt;
    let steps = 0;
    while (this._oeT >= this.OE_DT) { this._oeT -= this.OE_DT; steps++; }
    if (steps > 0) {
      const share = this._oeAcc / steps, shareLo = this._oeLoAcc / steps;
      for (let i = 0; i < steps; i++) {
        this._oe[this._oeHead] = share;
        this._oeLo[this._oeHead] = shareLo;
        this._oeHead = (this._oeHead + 1) % N;
        this._oeFill = Math.min(N, this._oeFill + 1);
      }
      this._oeAcc = 0; this._oeLoAcc = 0;
    }

    /* How hard this beat hit. Weighted toward the low end, because what makes
       one beat of a bar feel like the strong one is usually the kick, with
       the broadband onset carried alongside so music with no drums at all
       still has something to rank.

       Integrated over the front of the beat rather than peaked over all of
       it. A kick lands on the beat; noise and off-beat material land
       anywhere, so a peak over the whole window scores every beat alike as
       soon as the signal is at all twitchy — measured, taking the peak put
       the downbeat on the kick only 1.03x as often as chance. Where the
       energy falls within the beat is the whole distinction. */
    if (this.beatPhase < 0.45) {
      this._accent += (rawBass + Math.max(0, onsetZ) * 0.10) * dt;
    }

    // Re-solved twice a second. Cheap enough at this rate to be irrelevant
    // (~40k multiply-adds), and the answer does not change faster than that.
    this._trackT += dt;
    if (this._trackT >= 0.5) { this._trackT = 0; this._solve(); }

    if (this.lock > 0.25 && this._period > 0.1) {
      // Only ever seeded when unset. Re-seeding whenever the next beat had
      // passed sounds like the same thing and is the exact opposite: a beat
      // being due is precisely the case the loop below exists to handle, and
      // pushing the time forward there means it never fires at all.
      if (this._nextBeat <= 0) this._nextBeat = this._t + this._period;
      // Backgrounded tabs stop calling this, so catch up quietly rather than
      // firing a minute's worth of beats into one frame.
      if (this._t - this._nextBeat > this._period * 4)
        this._nextBeat = this._t + this._period;
      while (this._t >= this._nextBeat) {
        this._nextBeat += this._period;
        this._onBeat();
      }
      this.beatPhase = 1 - Math.min(1, Math.max(0,
        (this._nextBeat - this._t) / this._period));
      const g = this.group;
      const pos = (((this._beatIdx - 1 - this._off) % g) + g) % g;
      this.bar = (pos + this.beatPhase) / g;
      this.tempo = Math.round(60 / this._period);
    } else {
      // No usable grid. Fire on onsets that stand out even by the standards
      // of a track with no pulse, no more than one every 1.2s, so whatever
      // is driven by this still moves in events rather than continuously.
      this._sinceP += dt;
      if (onsetZ > 2.4 && this.presence > 0.3 && this._sinceP > 1.2) {
        this._sinceP = 0; this._pulseRaw = 1; this.pulseFlash = 1;
      }
      // Something for the continuous drivers to follow. Not the music, but
      // slow enough to read as drift rather than as a wrong guess.
      this.bar = (this.bar + dt / 2.4) % 1;
      this.tempo = 0;
    }

    // Slower than `beat` on both counts: a downbeat is a bigger event and
    // there is four times as long before the next one, so it can afford to
    // land harder and take longer to let go without ever running into itself.
    this._pulseRaw = Math.max(0, this._pulseRaw - dt * 1.6);
    this.pulseFlash = Math.max(0, this.pulseFlash - dt * 4.0);
    this.gridFlash = Math.max(0, this.gridFlash - dt * 4.0);
    this.pulse += (this._pulseRaw - this.pulse) * (1 - Math.exp(-dt / 0.16));
  },

  _solve() {
    const N = this._oe.length;
    const M = Math.min(this._oeFill, N);
    if (M < 240) return;                        // needs ~6s of history

    const x = this._acX || (this._acX = new Float32Array(N));
    let mu = 0;
    for (let k = 0; k < M; k++) mu += this._oe[(this._oeHead - M + k + 2 * N) % N];
    mu /= M;
    let energy = 0, pos = 0, mx = 0;
    for (let k = 0; k < M; k++) {
      x[k] = this._oe[(this._oeHead - M + k + 2 * N) % N] - mu;
      energy += x[k] * x[k];
      const v = Math.max(0, x[k]);
      pos += v; if (v > mx) mx = v;
    }
    energy = Math.max(energy / M, 1e-12);

    /* Is there anything here that could be a beat at all? Autocorrelation
       will always name a winner, and on smooth material the winner is noise
       — measured on a synthetic ambient pad it reported 149bpm at half
       confidence, which is a metronome invented out of nothing.

       Onsets in music with a pulse are concentrated: most of the envelope is
       near zero and the beats stand well above it. Ambient spreads its
       energy evenly. The ratio of the largest bucket to the average one
       separates them cleanly — measured, 19.9 on the beat-driven demo
       against 7.4 on the pad. */
    const crest = mx / Math.max(1e-9, pos / M);
    const punch = Math.min(1, Math.max(0, (crest - 9.0) / 6.0));

    const LO = 10, HI = 120;                    // 0.25s .. 3.0s
    const s = this._acS || (this._acS = new Float32Array(HI + 1));
    for (let lag = LO; lag <= HI; lag++) {
      let a = 0;
      for (let k = lag; k < M; k++) a += x[k] * x[k - lag];
      s[lag] = a / ((M - lag) * energy);
    }

    /* Candidates are 60..170bpm, each reinforced by its own multiples. A
       hi-hat on every eighth note correlates just as strongly at half the
       beat as at the beat, so without this the tracker latches onto the
       subdivision and we are back to something firing every quarter second.
       A real beat has peaks at 2x and 3x its period; a subdivision does
       not. */
    const CL = 14, CH = 40;                     // 0.35s .. 1.00s
    let best = -1e9, bestLag = 20, mean = 0, mean2 = 0, n = 0;
    for (let lag = CL; lag <= CH; lag++) {
      let v = s[lag];
      if (lag * 2 <= HI) v += s[lag * 2] * 0.55;
      if (lag * 3 <= HI) v += s[lag * 3] * 0.30;
      mean += v; mean2 += v * v; n++;
      if (v > best) { best = v; bestLag = lag; }
    }
    mean /= n;
    const sd = Math.sqrt(Math.max(1e-12, mean2 / n - mean * mean));
    // How far the winner stands above the field. A track with a clear pulse
    // gives one tall peak; one without gives a flat row of near-ties, and
    // the winner of a tie is noise.
    const evenly = Math.min(1, Math.max(0, (0.075 - this._sdt) / 0.035));
    const conf = this.presence < 0.25 ? 0
               : Math.min(1, Math.max(0, ((best - mean) / sd - 0.9) / 2.2))
                 * evenly * punch;

    // Where the beats sit: fold the envelope onto one period and take the
    // phase carrying the most onset energy. Solving for phase directly like
    // this, rather than steering a phase-locked loop, means a tempo change
    // costs one re-solve instead of a slow re-acquisition.
    // Low band weighted heavily here, and not at all in the tempo search
    // above: the two questions want different evidence. Tempo wants every
    // onset there is, so it works on material with no drums. Phase wants
    // the one onset that is the beat, and on anything with a kick that is a
    // low-frequency event. Where there is no kick this is close to zero and
    // the broadband term decides, which is the right fallback.
    let muLo = 0;
    for (let k = 0; k < M; k++) muLo += this._oeLo[(this._oeHead - M + k + 2 * N) % N];
    muLo /= M;
    let bestJ = 0, bestV = -1;
    for (let j = 0; j < bestLag; j++) {
      let v = 0;
      for (let k = M - 1 - j; k >= 0; k -= bestLag) {
        v += Math.max(0, x[k])
           + Math.max(0, this._oeLo[(this._oeHead - M + k + 2 * N) % N] - muLo) * 2.2;
      }
      if (v > bestV) { bestV = v; bestJ = j; }
    }
    const period = bestLag * this.OE_DT;
    const tNext = this._t + (bestLag - bestJ) * this.OE_DT;

    if (conf > 0.25) {
      if (this.lock < 0.2) {
        // Nothing worth preserving — take the new answer whole.
        this._period = period; this._nextBeat = tNext;
      } else {
        this._period += (period - this._period) * 0.25;
        // Wrap the correction to the nearest beat before applying it, or a
        // grid that is one beat out gets dragged the long way round and
        // stutters every time it is re-solved.
        let err = tNext - this._nextBeat;
        err -= Math.round(err / this._period) * this._period;
        this._nextBeat += err * 0.30;
      }
    }
    this.lock += (conf - this.lock) * 0.35;
  },

  _onBeat() {
    const a = this._accent; this._accent = 0;
    const idx = this._beatIdx;

    /* The accent just collected belongs to the beat that opened the window,
       which is the previous one. Each position in the bar keeps a running
       average of how hard its beat tends to hit, updated only when that
       position comes round — about six bars of memory. */
    for (let gi = 0; gi < 3; gi++) {
      const G = gi + 2, sl = this._slots[gi];
      const j = (((idx - 1) % G) + G) % G;
      sl[j] += (a - sl[j]) * 0.16;
    }

    // Pick the grouping whose accents are most sharply peaked, biased toward
    // four: it is much the most common, and on a tie between 2 and 4 the
    // slower reading is the one that feels like a bar.
    let bestScore = -1, bestG = this.group, bestOff = this._off, hold = -1;
    for (let gi = 0; gi < 3; gi++) {
      const G = gi + 2, sl = this._slots[gi];
      let m = 0, mx = -1, at = 0;
      for (let j = 0; j < G; j++) { m += sl[j]; if (sl[j] > mx) { mx = sl[j]; at = j; } }
      m /= G;
      const sc = (mx - m) / Math.max(m, 1e-6) * (G === 4 ? 1.20 : G === 2 ? 1.0 : 0.80);
      if (G === this.group && at === this._off) hold = sc;
      if (sc > bestScore) { bestScore = sc; bestG = G; bestOff = at; }
    }
    // Sticky. Moving the downbeat is the most visible thing this can do —
    // one gap of the wrong length, right where a gap of the right length is
    // the entire point — so a near-tie keeps the answer it already had.
    if (hold < 0 || bestScore > hold * 1.25) { this.group = bestG; this._off = bestOff; }

    this.beatInBar = (((idx - bestOff) % bestG) + bestG) % bestG;
    this.gridFlash = 1;
    if (this.beatInBar === 0) { this._pulseRaw = 1; this.pulseFlash = 1; }
    this._beatIdx = idx + 1;
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

    /* Near-silence should read as still, not as amplified noise, because the
       relative measure would otherwise make room tone look like music. That
       used to be a pair of absolute constants, and two constants cannot know
       how loud a room is. A phone picking up ambient music from across a room
       lands squarely inside that fade: measured, presence sat at 0.31 on very
       quiet material and 0.80 on quiet ambient, and every band downstream was
       scaled to a third of its range. It was not that the engine could not
       see the music - it saw it and then turned it down.

       The floor is learned instead. It follows the signal down quickly and
       creeps up only while the signal is near it, so it settles on the
       quietest thing the room does and does not drift upward into sustained
       music. Presence is then how far above its own floor the signal sits,
       which is the same question in a quiet room and a loud one. */
    if (rawLvl < this._floor) {
      this._floor += (rawLvl - this._floor) * (1 - Math.exp(-dt / 0.8));
    } else if (rawLvl < this._floor * 3.0) {
      this._floor += (rawLvl - this._floor) * (1 - Math.exp(-dt / 20));
    }
    const target = Math.min(1, Math.max(0,
      (rawLvl - this._floor) / Math.max(0.0035, this._floor * 1.5)));
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
      this.beatStrength = (flux - fMean) / Math.max(fSd, 1e-9);
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
    if (this._sampler) clearInterval(this._sampler);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.ctx) this.ctx.close();
    Object.assign(this, {
      ctx:null, stream:null, osc:null, ready:false, presence:0, _floor:0.002,
      beat:0, beatFlash:0, beatStrength:0, bpm:0, _beatRaw:0, _hist:[], _beatTimes:[],
      _prevSpec:null, _fluxHist:[],
      tempo:0, lock:0, group:4, beatPhase:0, bar:0, pulse:0, pulseFlash:0,
      gridFlash:0, beatInBar:0,
      _t:0, _oe:new Float32Array(400), _oeLo:new Float32Array(400),
      _oeHead:0, _oeFill:0, _oeAcc:0, _oeLoAcc:0, _oeT:0,
      _trackT:0, _period:0.5, _nextBeat:0, _beatIdx:0, _accent:0, _off:0,
      _pulseRaw:0, _sinceP:0, gridAnalyser:null, _sampler:null,
      _gridSpec:null, _prevGrid:null, _gridT:0, _gMu:0, _gSd:0.002, _sdt:0.02,
      _slots:[new Float32Array(2), new Float32Array(3), new Float32Array(4)],
      _peak:{ bass:.01, mid:.01, high:.01, air:.01, level:.01 },
      _env:{ bass:0, mid:0, high:0, air:0, level:0 },
      _env2:{ bass:0, mid:0, high:0, air:0, level:0 },
      _stat:{ bass:{mu:0,sd:.02}, mid:{mu:0,sd:.02}, high:{mu:0,sd:.02},
              air:{mu:0,sd:.02}, level:{mu:0,sd:.02} }
    });
  }
};
