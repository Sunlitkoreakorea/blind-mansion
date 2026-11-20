// 소리는 전부 Web Audio로 즉석에서 만든다 (파일 없음)
export class Sound {
  constructor() { this.ctx = null; this.on = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.ear = ctx.createBiquadFilter(); this.ear.type = 'lowpass'; this.ear.frequency.value = 18000;
    this.master.connect(this.ear).connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 바닥에 깔리는 낮은 웅웅거림
    this.amb = ctx.createGain(); this.amb.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    for (const f of [41, 41.6, 61.8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(this.amb).connect(this.master);
    // 추격 심장 소리
    this.heart = ctx.createGain(); this.heart.gain.value = 0;
    this.heart.connect(this.master);
    this.heartT = 0;
    // 합창 (감정의 힘)
    this.choir = ctx.createGain(); this.choir.gain.value = 0;
    this.choir.connect(this.master);
    this.voices = [];
    const formants = [[700, 1220], [400, 2000], [600, 1000], [300, 870], [500, 1700]];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 110 * [1, 1.19, 1.5, 1.68, 2, 2.38][i];
      const g = ctx.createGain(); g.gain.value = 0.07;
      const [f1, f2] = formants[i % formants.length];
      const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 6;
      const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 8;
      o.connect(b1).connect(g); o.connect(b2).connect(g); g.connect(this.choir);
      o.start();
      this.voices.push({ o, base: o.frequency.value, ph: Math.random() * 6 });
    }
    this.on = true;
  }

  t() { return this.ctx.currentTime; }

  burst(dur, freq, q, gain, dest, type = 'bandpass', when = 0) {
    const ctx = this.ctx, t = this.t() + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest || this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain, type = 'sine', dest, slideTo, when = 0) {
    const ctx = this.ctx, t = this.t() + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  panner(x, z) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = 2.5; p.rolloffFactor = 1.3; p.maxDistance = 60;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = 2; p.positionZ.value = z; } else p.setPosition(x, 2, z);
    p.connect(this.master);
    setTimeout(() => p.disconnect(), 3000);
    return p;
  }

  listener(x, y, z, yaw) {
    if (!this.on) return;
    const L = this.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  // 귀를 바꿔 끼면 소리가 먹먹해짐
  setEar(cutoff, gain) {
    if (!this.on) return;
    this.ear.frequency.setTargetAtTime(cutoff, this.t(), 0.3);
    this.master.gain.setTargetAtTime(gain, this.t(), 0.3);
  }

  step(run, crawl) {
    if (!this.on) return;
    if (crawl) { this.burst(0.12, 300, 1, 0.05, null, 'lowpass'); return; }
    this.burst(0.07, run ? 1400 : 900, 1.2, run ? 0.16 : 0.07);
    this.burst(0.05, 180, 1, run ? 0.12 : 0.05, null, 'lowpass');
  }

  creak(x, z, angry) {
    if (!this.on) return;
    const p = this.panner(x, z);
    const f0 = 600 + Math.random() * 500;
    this.tone(f0, 0.5, angry ? 0.16 : 0.09, 'sawtooth', p, f0 * 0.55);
    this.tone(f0 * 1.51, 0.4, 0.04, 'square', p, f0 * 0.7);
    this.burst(0.3, 2500, 4, 0.05, p);
  }

  tick(x, z) {
    if (!this.on) return;
    const p = this.panner(x, z);
    this.burst(0.03, 4200, 3, 0.09, p, 'highpass');
  }

  setHeart(level) { this.heartLevel = level; }
  update(dt) {
    if (!this.on) return;
    const lv = this.heartLevel || 0;
    this.heartT -= dt;
    if (lv > 0.05 && this.heartT <= 0) {
      this.heartT = 0.95 - lv * 0.45;
      this.tone(58, 0.18, 0.3 * lv, 'sine');
      this.tone(52, 0.2, 0.22 * lv, 'sine', null, null, 0.17);
    }
    for (const v of this.voices) {
      v.ph += dt * 0.7;
      v.o.frequency.setTargetAtTime(v.base * (1 + 0.03 * Math.sin(v.ph)) * (this.screaming > 0 ? 1.9 : 1), this.t(), 0.1);
    }
    if (this.screaming > 0) this.screaming -= dt;
  }

  setChoir(vol) { if (this.on) this.choir.gain.setTargetAtTime(vol, this.t(), 0.4); }
  scream() {
    if (!this.on) return;
    this.screaming = 3;
    this.choir.gain.setTargetAtTime(0.9, this.t(), 0.05);
    this.burst(1.6, 1800, 0.6, 0.3);
  }

  ding() { if (!this.on) return; this.tone(988, 1.2, 0.12); this.tone(1318, 1.4, 0.08, 'sine', null, null, 0.18); }
  doors() { if (!this.on) return; this.burst(0.8, 500, 0.8, 0.05, null, 'lowpass'); }
  whirr() {
    if (!this.on) return;
    this.tone(90, 1.8, 0.2, 'sawtooth', null, 900);
    this.tone(60, 2.2, 0.15, 'square', null, 240);
    this.burst(0.25, 3000, 2, 0.3, null, 'bandpass', 1.6);
    this.tone(40, 0.6, 0.4, 'sine', null, 30, 1.65);
  }
  /* ── 징수 장면 ── */
  // 붙잡힘: 둔탁한 충격 + 쇳소리
  grab() {
    if (!this.on) return;
    this.tone(78, 0.5, 0.7, 'sine', null, 32);
    this.burst(0.35, 260, 0.7, 0.5, null, 'lowpass');
    for (const [f, g, d] of [[412, 0.12, 1.3], [1137, 0.07, 1.0], [1873, 0.05, 0.8], [2641, 0.035, 0.6]]) this.tone(f, d, g, 'triangle', null, f * 0.985);
    this.tone(1500, 0.9, 0.18, 'sawtooth', null, 380, 0.05);
  }
  // 놋쇠 종 한 번 (요금 징수)
  bell(f = 392, gain = 0.16) {
    if (!this.on) return;
    for (const [m, g, d] of [[0.5, 0.6, 3.2], [1, 1, 2.6], [1.19, 0.5, 2.0], [1.5, 0.35, 1.6], [2, 0.4, 1.4], [2.74, 0.22, 1.0], [3.76, 0.12, 0.7]]) this.tone(f * m, d, gain * g, 'sine');
    this.burst(0.05, 3800, 2, 0.12);
  }
  // 드릴: 음이 점점 올라감
  drill(dur) {
    if (!this.on) return;
    const ctx = this.ctx, t = this.t();
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.16, t + 0.25);
    out.gain.setValueAtTime(0.16, t + dur - 0.08); out.gain.linearRampToValueAtTime(0, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    bp.connect(out).connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 23;
    const lg = ctx.createGain(); lg.gain.value = 18;
    lfo.connect(lg);
    for (const [type, mul] of [['sawtooth', 1], ['square', 2.01]]) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(110 * mul, t); o.frequency.exponentialRampToValueAtTime(980 * mul, t + dur);
      lg.connect(o.frequency);
      o.connect(bp); o.start(t); o.stop(t + dur + 0.05);
    }
    lfo.start(t); lfo.stop(t + dur + 0.05);
    this.burst(dur, 5200, 0.8, 0.03, null, 'highpass');
  }
  // 톱니가 한 칸 물리는 소리
  ratchet() {
    if (!this.on) return;
    this.burst(0.025, 4200, 4, 0.22, null, 'highpass');
    this.tone(1900, 0.05, 0.05, 'square', null, 1500);
    this.burst(0.06, 420, 2, 0.16, null, 'lowpass');
  }
  // 다 끼워짐: 철컥
  clunk() {
    if (!this.on) return;
    this.tone(64, 0.4, 0.6, 'sine', null, 40);
    this.burst(0.05, 2600, 3, 0.4);
    this.burst(0.3, 600, 1, 0.3, null, 'lowpass');
    this.tone(880, 0.35, 0.06, 'triangle', null, 860, 0.02);
  }
  // 금전등록기: 땡 + 서랍 덜컹
  kaching() {
    if (!this.on) return;
    this.burst(0.18, 1500, 1.2, 0.18, null, 'bandpass');
    this.burst(0.08, 300, 1, 0.25, null, 'lowpass', 0.05);
    for (const [f, w] of [[2093, 0.12], [2637, 0.12]]) {
      this.tone(f, 1.6, 0.1, 'sine', null, null, w);
      this.tone(f * 2.76, 0.6, 0.025, 'sine', null, null, w);
    }
  }
  // 이명: 귀 필터를 거치지 않고 바로 울림
  tinnitus(dur) {
    if (!this.on) return;
    const ctx = this.ctx, t = this.t();
    const o = ctx.createOscillator(); o.frequency.value = 5600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  // 소리가 잠깐 물속처럼 먹먹해짐 (setEar로 되돌림)
  muffle() {
    if (!this.on) return;
    this.ear.frequency.setTargetAtTime(320, this.t(), 0.15);
  }
  hiss() { if (!this.on) return; this.burst(0.7, 6000, 0.6, 0.12, null, 'highpass'); this.burst(0.3, 120, 1, 0.3, null, 'lowpass'); }
  focus() { if (!this.on) return; for (let i = 0; i < 3; i++) this.tone(1300 + i * 260, 0.07, 0.05, 'sine', null, 1700 + i * 300, i * 0.09); }

  screech(x, z) { if (!this.on) return; const p = this.panner(x, z); this.tone(1400, 1.0, 0.3, 'sawtooth', p, 500); this.tone(2100, 0.8, 0.1, 'square', p, 900); }
  clank(x, z) { if (!this.on) return; const p = this.panner(x, z); this.burst(0.15, 1800, 6, 0.25, p); this.tone(220, 0.25, 0.08, 'triangle', p); }
  light() { if (!this.on) return; this.burst(0.5, 800, 0.7, 0.12, null, 'lowpass'); this.tone(330, 0.6, 0.03, 'sine', null, 660); }
  pickup() { if (!this.on) return; this.burst(0.12, 2400, 2, 0.08); this.tone(660, 0.15, 0.04, 'triangle'); }
  paper() { if (!this.on) return; this.burst(0.25, 3500, 0.8, 0.07, null, 'highpass'); }
  panelSlide() { if (!this.on) return; this.burst(1.6, 220, 0.6, 0.18, null, 'lowpass'); this.tone(55, 1.6, 0.1, 'sawtooth', null, 40); }
}
