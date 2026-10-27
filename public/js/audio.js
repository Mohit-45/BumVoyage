const MUTE_KEY = 'bumvoyage.muted';
const MASTER_GAIN = 0.85;
const MAX_VOICES = 12;
// A sound asked for while the context is still waking up plays if it wakes within this long, otherwise it is dropped
const WAKE_MS = 300;

const VARIANTS = [
  { name: 'toot', f0: [150, 100], dur: 0.34, sput: 0, noise: 0.16, jitter: 0.05, wobble: 0.04, weight: 3, minPower: 0, maxPower: 0.7 },
  { name: 'squeak', f0: [340, 215], dur: 0.46, sput: 0, noise: 0.08, jitter: 0.03, wobble: 0.1, whistle: true, weight: 2, minPower: 0, maxPower: 0.6 },
  { name: 'trumpet', f0: [120, 170, 92], dur: 0.7, sput: 7, noise: 0.14, jitter: 0.08, wobble: 0.05, weight: 2, minPower: 0.2, maxPower: 1 },
  { name: 'wet', f0: [112, 62], dur: 0.82, sput: 26, noise: 0.34, jitter: 0.25, wobble: 0.15, pop: true, weight: 3, minPower: 0.25, maxPower: 1 },
  { name: 'rumble', f0: [72, 42], dur: 1.05, sput: 14, noise: 0.3, jitter: 0.18, wobble: 0.1, weight: 3, minPower: 0.5, maxPower: 1 },
  { name: 'ripper', f0: [98, 56], dur: 0.62, sput: 40, noise: 0.4, jitter: 0.3, wobble: 0.2, weight: 2, minPower: 0.35, maxPower: 1 },
];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function pathValue(points, u) {
  if (points.length === 1) return points[0];
  const f = u * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(f));
  const t = f - i;
  return points[i] * (1 - t) + points[i + 1] * t;
}

function renderFart(ctx, variant, power) {
  const sr = ctx.sampleRate;
  const dur = variant.dur * (0.55 + 0.95 * power) * (0.9 + Math.random() * 0.25);
  const n = Math.max(1, Math.floor(sr * dur));
  const buffer = ctx.createBuffer(1, n, sr);
  const data = buffer.getChannelData(0);
  const pitchScale = 1.12 - 0.28 * power + (Math.random() - 0.5) * 0.08;
  const phaseA = Math.random() * 6.28;
  const phaseB = Math.random() * 6.28;
  let phase = 0;
  let cycleAmp = 1;
  let width = 0.35;
  let drift = 0;
  let gateNoise = 0;
  let noiseLp = 0;
  let whistlePhase = 0;
  const gateCut = variant.sput > 0 ? Math.min(0.5, variant.sput / sr * 6.28) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / n;
    drift += (Math.random() - 0.5) * 0.0025;
    drift *= 0.9994;
    const wobble = 1 + variant.wobble * Math.sin(6.28 * 5.3 * t + phaseA) + variant.wobble * 0.5 * Math.sin(6.28 * 11.7 * t + phaseB);
    const f0 = pathValue(variant.f0, u) * pitchScale * wobble * (1 + drift * variant.jitter * 8);
    phase += f0 / sr;
    if (phase >= 1) {
      phase -= 1;
      cycleAmp = 0.5 + 0.5 * Math.random();
      width = 0.22 + 0.25 * Math.random();
    }
    const pulse = phase < width ? Math.sin((Math.PI * phase) / width) ** 2 : -0.14 * Math.sin((Math.PI * (phase - width)) / (1 - width));
    let gate = 1;
    if (gateCut > 0) {
      gateNoise += (Math.random() * 2 - 1 - gateNoise) * gateCut;
      gate = smoothstep(-0.18, 0.3, gateNoise * 3.2);
    }
    noiseLp += (Math.random() * 2 - 1 - noiseLp) * 0.16;
    const attack = Math.min(1, t / 0.012);
    const release = u < 0.68 ? 1 : (1 - (u - 0.68) / 0.32) ** 1.6;
    const body = pulse * cycleAmp * (1 - variant.noise) + noiseLp * variant.noise * 1.4;
    let s = body * attack * release * gate;
    if (variant.whistle) {
      whistlePhase += (1150 - 350 * u + Math.sin(t * 38) * 40) / sr;
      s += Math.sin(6.28 * whistlePhase) * 0.18 * attack * release;
    }
    if (variant.pop && u > 0.9) {
      s += (Math.random() * 2 - 1) * 0.5 * (1 - (u - 0.9) / 0.1) * smoothstep(0.9, 0.92, u);
    }
    data[i] = Math.tanh(s * 1.9) * 0.9;
  }
  return buffer;
}

// Four players tooting at once add up past full scale. This leaves everything under 0.7 untouched and bends
// louder peaks smoothly towards 0.98, so a pile of toots rounds off instead of hard clipping. A compressor
// would also change the level and attack of the quiet beeps and thuds, so it is not used here.
function softLimiter(ctx) {
  const knee = 0.7;
  const ceiling = 0.98;
  const reach = 2;
  const n = 4097;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // The shaper sees the mix at 1/reach, so sums up to +-2 are shaped and only beyond that held at the ceiling
    const x = ((i / (n - 1)) * 2 - 1) * reach;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee)));
  }
  const input = ctx.createGain();
  input.gain.value = 1 / reach;
  const output = ctx.createWaveShaper();
  output.curve = curve;
  input.connect(output);
  return { input, output };
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.cache = new Map();
    this.clips = [];
    this.voices = [];
    this.waiting = [];
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  // Browsers start audio only from a real gesture. iOS Safari counts touchend, click and keydown but not a
  // touch pointerdown, and it can interrupt the context again later (a call, Siri), so these stay bound for good.
  bindUnlock() {
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.resume();
    });
  }

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      const limiter = softLimiter(this.ctx);
      this.master.connect(limiter.input);
      limiter.output.connect(this.ctx.destination);
      this.ctx.onstatechange = () => this.wake();
      this.noise = this.makeNoise();
      this.loadSamples();
    }
    this.resume();
  }

  // Retried on every gesture until the context reports 'running'. That includes 'interrupted', which is not 'suspended'.
  resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      // Playing one silent sample inside the gesture is what unlocks older iOS
      const silence = ctx.createBufferSource();
      silence.buffer = ctx.createBuffer(1, 1, 22050);
      silence.connect(ctx.destination);
      silence.start(0);
      const pending = ctx.resume();
      if (pending && pending.then) pending.then(() => this.wake(), () => {});
    } catch {
      /* the next gesture tries again */
    }
  }

  // The context is running: play what was asked for while it woke up, minus anything that has gone stale
  wake() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const jobs = this.waiting.splice(0);
    const now = performance.now();
    for (const job of jobs) if (now - job.at < WAKE_MS) job.play();
  }

  async loadSamples() {
    try {
      const res = await fetch('audio/manifest.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const manifest = await res.json();
      const decoded = new Map();
      const clips = [];
      for (const clip of manifest.clips ?? []) {
        if (!decoded.has(clip.file)) {
          try {
            const audio = await fetch(`audio/${encodeURIComponent(clip.file)}`);
            decoded.set(clip.file, audio.ok ? await this.ctx.decodeAudioData(await audio.arrayBuffer()) : null);
          } catch {
            decoded.set(clip.file, null);
          }
        }
        const source = decoded.get(clip.file);
        if (!source) continue;
        const buffer = this.extract(source, clip.start ?? 0, clip.end ?? source.duration);
        if (buffer) clips.push({ buffer, weight: clip.weight ?? 1, duration: buffer.duration });
      }
      this.clips = clips;
    } catch {
      this.clips = [];
    }
  }

  extract(source, start, end) {
    const rate = source.sampleRate;
    const from = Math.max(0, Math.floor(start * rate));
    const to = Math.min(source.length, Math.floor(end * rate));
    const length = to - from;
    if (length < rate * 0.05) return null;
    const out = this.ctx.createBuffer(1, length, rate);
    const data = out.getChannelData(0);
    const channels = source.numberOfChannels;
    let peak = 0;
    for (let c = 0; c < channels; c++) {
      const src = source.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] += src[from + i] / channels;
    }
    for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
    const gain = peak > 0 ? 0.92 / peak : 1;
    const fade = Math.floor(rate * 0.008);
    for (let i = 0; i < length; i++) {
      let g = gain;
      if (i < fade) g *= i / fade;
      if (length - i < fade) g *= (length - i) / fade;
      data[i] *= g;
    }
    return out;
  }

  pickClip(power) {
    const wanted = power < 0.38 ? [0, 0.42] : power < 0.72 ? [0.38, 0.8] : [0.7, 9];
    let pool = this.clips.filter((c) => c.duration >= wanted[0] && c.duration <= wanted[1]);
    if (pool.length === 0) pool = this.clips;
    const total = pool.reduce((sum, c) => sum + c.weight, 0);
    let roll = Math.random() * total;
    for (const clip of pool) {
      if (roll < clip.weight) return clip;
      roll -= clip.weight;
    }
    return pool[0];
  }

  makeNoise() {
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_GAIN;
  }

  // Sounds scheduled on a context that is not running would all start together when it resumes, so they are
  // dropped instead. A caller that passes `again` gets one short chance if the context is waking up right now.
  ready(again) {
    if (!this.ctx || this.muted) return false;
    if (this.ctx.state === 'running') return true;
    if (again) {
      const now = performance.now();
      this.waiting = this.waiting.filter((job) => now - job.at < WAKE_MS).slice(-3);
      this.waiting.push({ at: now, play: again });
    }
    return false;
  }

  // Every started source is a voice. Past the cap the oldest one is faded out, so mashing TOOT cannot pile up.
  track(src, out) {
    const voice = { src, out };
    this.voices.push(voice);
    src.onended = () => {
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
    };
    while (this.voices.length > MAX_VOICES) {
      const old = this.voices.shift();
      const t = this.ctx.currentTime;
      try {
        old.out.gain.cancelScheduledValues(t);
        old.out.gain.setTargetAtTime(0, t, 0.01);
        old.src.stop(t + 0.06);
      } catch {
        /* already stopped */
      }
    }
  }

  envelope(peak, attack, length, src) {
    const t0 = this.ctx.currentTime;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    gain.connect(this.master);
    this.track(src, gain);
    return gain;
  }

  fartBuffer(power) {
    const bucket = power < 0.34 ? 0 : power < 0.7 ? 1 : 2;
    const mid = [0.2, 0.52, 0.9][bucket];
    const candidates = VARIANTS.filter((v) => mid >= v.minPower && mid <= v.maxPower);
    const total = candidates.reduce((sum, v) => sum + v.weight, 0);
    let roll = Math.random() * total;
    let variant = candidates[0];
    for (const v of candidates) {
      if (roll < v.weight) {
        variant = v;
        break;
      }
      roll -= v.weight;
    }
    const key = `${variant.name}:${bucket}`;
    const pool = this.cache.get(key) ?? [];
    if (pool.length < 3) {
      const fresh = renderFart(this.ctx, variant, mid);
      pool.push(fresh);
      this.cache.set(key, pool);
      return fresh;
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  toot(power, volume = 1) {
    if (!this.ready(() => this.toot(power, volume))) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    const real = this.clips.length > 0;
    src.buffer = real ? this.pickClip(power).buffer : this.fartBuffer(power);
    src.playbackRate.value = real ? 1.2 - 0.34 * power + (Math.random() - 0.5) * 0.08 : 0.97 + Math.random() * 0.06;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = real ? 3600 : 1100 + power * 700;
    low.Q.value = 0.8;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 220 + Math.random() * 80;
    body.gain.value = real ? 4 : 7;
    body.Q.value = 1.0;
    const gain = ctx.createGain();
    gain.gain.value = (0.55 + 0.45 * power) * volume;
    src.connect(body).connect(low).connect(gain).connect(this.master);
    src.start(t0);
    this.track(src, gain);
  }

  fizzle() {
    if (!this.ready(() => this.fizzle())) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    hiss.connect(filter).connect(this.envelope(0.1, 0.01, 0.22, hiss));
    hiss.start(t0);
    hiss.stop(t0 + 0.25);
  }

  yelp() {
    if (!this.ready(() => this.yelp())) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(880, t0 + 0.09);
    osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.28);
    osc.connect(this.envelope(0.22, 0.01, 0.3, osc));
    osc.start(t0);
    osc.stop(t0 + 0.32);
  }

  thud(strength = 1) {
    if (!this.ready(() => this.thud(strength))) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.16);
    osc.connect(this.envelope(0.45 * strength, 0.005, 0.2, osc));
    osc.start(t0);
    osc.stop(t0 + 0.22);
  }

  ouch() {
    if (!this.ready(() => this.ouch())) return;
    this.thud(0.7);
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.22);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    osc.connect(filter).connect(this.envelope(0.2, 0.005, 0.26, osc));
    osc.start(t0);
    osc.stop(t0 + 0.28);
  }

  splash(strength = 1, length = 0.5) {
    if (!this.ready(() => this.splash(strength, length))) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t0);
    filter.frequency.exponentialRampToValueAtTime(400, t0 + length);
    src.connect(filter).connect(this.envelope(0.3 * strength, 0.02, length, src));
    src.start(t0);
    src.stop(t0 + length + 0.05);
  }

  plunge() {
    this.splash(1.4, 1.1);
    this.thud(1);
  }

  whoosh() {
    if (!this.ready(() => this.whoosh())) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t0);
    filter.frequency.exponentialRampToValueAtTime(1800, t0 + 0.5);
    src.connect(filter).connect(this.envelope(0.25, 0.1, 0.7, src));
    src.start(t0);
    src.stop(t0 + 0.75);
  }

  sunk() {
    if (!this.ready(() => this.sunk())) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.9);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    osc.connect(filter).connect(this.envelope(0.25, 0.02, 0.95, osc));
    osc.start(t0);
    osc.stop(t0 + 1);
    this.splash(1, 0.9);
  }

  beep(freq, length = 0.14, peak = 0.22) {
    if (!this.ready(() => this.beep(freq, length, peak))) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(this.envelope(peak, 0.008, length, osc));
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  }

  checkpoint() {
    this.beep(660, 0.12);
    setTimeout(() => this.beep(880, 0.18), 110);
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, 0.25), i * 120));
  }

  countdown(go) {
    this.beep(go ? 880 : 440, go ? 0.4 : 0.14, 0.25);
  }
}
