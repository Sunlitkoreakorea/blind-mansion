// 소리는 전부 Web Audio로 즉석에서 만든다 (파일 없음)
// - 방향: 모든 위치 소리는 HRTF 패너 (앞뒤, 위아래까지 들림. 이어폰이면 더 또렷함)
// - 벽: 손님과 소리 사이가 벽으로 막히면 먹먹하고 작게
// - 공간: 합성한 잔향 두 개(넓은 홀, 작은 방)를 지금 있는 곳에 따라 섞음
// - 따라다니는 소리: 안내원마다 태엽 째깍, 톱니 웅웅, 가스등 쉭, 바늘 다리 따각
const ROOM_WET = {
  corridor: [0.34, 0], exhibit: [0.46, 0], mouth: [0.55, 0], eyes: [0.5, 0], stair: [0.72, 0],
  lounge: [0.05, 0.3], elev: [0.02, 0.38], guest: [0.04, 0.32], foyer: [0.5, 0],
};

export class Sound {
  constructor() { this.ctx = null; this.on = false; this.occlude = null; this.ambient = []; this.nextFar = 6; this.breathT = 0; this.breathLevel = 0; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.ear = ctx.createBiquadFilter(); this.ear.type = 'lowpass'; this.ear.frequency.value = 18000;
    this.master.connect(this.ear).connect(this.comp);
    // 잡음 재료
    const mk = (sec, fn) => { const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); fn(d, len); return b; };
    this.noise = mk(2, (d, n) => { for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; });
    this.brown = mk(4, (d, n) => { let v = 0; for (let i = 0; i < n; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; } });
    // 잔향
    this.hallRev = ctx.createConvolver(); this.hallRev.buffer = this.impulse(3.6, 2.4, 0.55);
    this.roomRev = ctx.createConvolver(); this.roomRev.buffer = this.impulse(1.1, 3.2, 0.9);
    this.sendHall = ctx.createGain(); this.sendHall.gain.value = 0.34;
    this.sendRoom = ctx.createGain(); this.sendRoom.gain.value = 0;
    const revOut = ctx.createGain(); revOut.gain.value = 0.9;
    this.sendHall.connect(this.hallRev).connect(revOut);
    this.sendRoom.connect(this.roomRev).connect(revOut);
    revOut.connect(this.master);
    // 모든 소리가 지나는 길: 바로 듣는 소리 + 잔향으로 보내는 소리
    this.bus = ctx.createGain();
    this.bus.connect(this.master); this.bus.connect(this.sendHall); this.bus.connect(this.sendRoom);
    // 저택에 깔린 바람 소리와 낮은 웅웅거림
    const wind = ctx.createBufferSource(); wind.buffer = this.brown; wind.loop = true;
    const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 380;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    wind.connect(wlp).connect(this.windGain).connect(this.bus); wind.start();
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07; const wlg = ctx.createGain(); wlg.gain.value = 160; wl.connect(wlg).connect(wlp.frequency); wl.start();
    this.amb = ctx.createGain(); this.amb.gain.value = 0.022;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    for (const f of [41, 41.6, 61.8]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(this.amb).connect(this.master);
    // 추격 심장 소리 (머릿속 소리라 잔향 없이)
    this.heart = ctx.createGain(); this.heart.gain.value = 1; this.heart.connect(this.master); this.heartT = 0;
    // 합창 (감정의 힘): 목소리를 세 자리에 나눠 홀 안이 둘러싸이게. 목소리 → 자리별 세기 → 패너
    this.choirPans = [0, 1, 2].map(() => { const p = this.makePanner(10, 1.0); p.connect(this.bus); return p; });
    this.choirGainNodes = this.choirPans.map((p) => { const g = ctx.createGain(); g.gain.value = 0; g.connect(p); return g; });
    this.voices = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 110 * [1, 1.19, 1.5, 1.68, 2, 2.38][i];
      o.start();
      this.voices.push({ o, base: o.frequency.value, ph: Math.random() * 6 });
    }
    this.on = true;
    this.rewireChoir();
  }

  // 목소리 i → 두 포먼트 필터 → 자리 i%3 세기
  rewireChoir() {
    const ctx = this.ctx;
    const formants = [[700, 1220], [400, 2000], [600, 1000], [300, 870], [500, 1700]];
    this.voices.forEach((v, i) => {
      const [f1, f2] = formants[i % formants.length];
      const g = ctx.createGain(); g.gain.value = 0.07;
      const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = f1; b1.Q.value = 6;
      const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = f2; b2.Q.value = 8;
      v.o.connect(b1).connect(g); v.o.connect(b2).connect(g);
      g.connect(this.choirGainNodes[i % 3]);
    });
  }

  // 합성 잔향: 점점 어두워지며 사그라드는 잡음 + 초기 반사
  impulse(sec, decay, damp) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const a = Math.max(0.04, 1 - damp * t * 1.3);
        lp += a * ((Math.random() * 2 - 1) - lp);
        d[i] = i < rate * 0.008 ? 0 : lp * Math.pow(1 - t, decay);
      }
      for (const [ms, g] of [[19, 0.5], [31, 0.35], [47, 0.3], [71, 0.22], [97, 0.16]]) {
        const k = Math.floor(rate * (ms + ch * 3) / 1000);
        if (k < len) d[k] += g * (ch ? -1 : 1);
      }
    }
    return buf;
  }

  t() { return this.ctx.currentTime; }

  makePanner(ref = 3, roll = 1.15) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 100;
    return p;
  }
  setPos(p, x, y, z, smooth) {
    if (p.positionX) {
      if (smooth) { const t = this.t(); p.positionX.setTargetAtTime(x, t, 0.04); p.positionY.setTargetAtTime(y, t, 0.04); p.positionZ.setTargetAtTime(z, t, 0.04); }
      else { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
    } else p.setPosition(x, y, z);
  }

  burst(dur, freq, q, gain, dest, type = 'bandpass', when = 0) {
    const ctx = this.ctx, t = this.t() + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest || this.bus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  tone(freq, dur, gain, type = 'sine', dest, slideTo, when = 0) {
    const ctx = this.ctx, t = this.t() + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest || this.bus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // 한 번 울리고 사라지는 위치 소리. 벽에 가리면 먹먹하게
  panner(x, z, y = 1.8, life = 3) {
    const ctx = this.ctx;
    const p = this.makePanner();
    this.setPos(p, x, y, z);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    const g = ctx.createGain();
    const hid = this.occlude ? this.occlude(x, z) : false;
    f.frequency.value = hid ? 750 : 20000; g.gain.value = hid ? 0.5 : 1;
    p.connect(f).connect(g).connect(this.bus);
    setTimeout(() => { p.disconnect(); f.disconnect(); g.disconnect(); }, life * 1000);
    return p;
  }

  listener(x, y, z, yaw) {
    if (!this.on) return;
    const L = this.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      const t = this.t();
      L.positionX.setTargetAtTime(x, t, 0.02); L.positionY.setTargetAtTime(y, t, 0.02); L.positionZ.setTargetAtTime(z, t, 0.02);
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    this.lx = x; this.lz = z;
  }

  // 지금 있는 공간에 맞춰 잔향 섞기
  setRoom(kind) {
    if (!this.on || kind === this.room) return;
    this.room = kind;
    const [h, r] = ROOM_WET[kind] || ROOM_WET.corridor;
    const t = this.t();
    this.sendHall.gain.setTargetAtTime(h, t, 0.6);
    this.sendRoom.gain.setTargetAtTime(r, t, 0.6);
  }

  // 귀를 바꿔 끼면 소리가 먹먹해짐
  setEar(cutoff, gain) {
    if (!this.on) return;
    this.ear.frequency.setTargetAtTime(cutoff, this.t(), 0.3);
    this.master.gain.setTargetAtTime(gain, this.t(), 0.3);
  }

  /* ── 손님 발소리와 숨소리 ── */
  step(run, crawl, surf = 'marble') {
    if (!this.on) return;
    const v = 0.9 + Math.random() * 0.2, g = run ? 1 : 0.55;
    if (crawl) {
      this.burst(0.22, 1400, 0.7, 0.05, null, 'bandpass');
      this.burst(0.08, 220, 1, 0.08, null, 'lowpass', 0.05);
      return;
    }
    if (surf === 'rug') {
      this.burst(0.1, 650 * v, 0.8, 0.13 * g, null, 'lowpass');
      this.burst(0.06, 140, 1, 0.14 * g, null, 'lowpass');
      return;
    }
    if (surf === 'wood') {
      this.burst(0.07, 520 * v, 2.2, 0.2 * g, null, 'bandpass');
      this.tone(170 * v, 0.14, 0.09 * g, 'triangle', null, 115);
      this.burst(0.05, 150, 1, 0.16 * g, null, 'lowpass');
      if (Math.random() < 0.12) this.creakWood();
      return;
    }
    // 대리석: 뒤꿈치(딱+쿵) 다음 앞꿈치(톡)
    this.burst(0.02, 3800 * v, 0.9, 0.28 * g, null, 'highpass');
    this.burst(0.05, 1150 * v, 1.3, 0.12 * g, null, 'bandpass');
    this.burst(0.07, 160, 1, 0.13 * g, null, 'lowpass');
    this.burst(0.015, 4800 * v, 1, 0.12 * g, null, 'highpass', run ? 0.035 : 0.055);
  }
  creakWood(dest) {
    const f0 = 280 + Math.random() * 180;
    this.tone(f0, 0.35, 0.025, 'sawtooth', dest, f0 * 1.3);
    this.burst(0.3, f0 * 2, 9, 0.04, dest);
  }
  // 숨: 0이면 조용, 1이면 헐떡임
  setBreath(level) { this.breathLevel = level; }
  breathe(level) {
    const inh = 0.32 - level * 0.08, exh = 0.42 - level * 0.1;
    this.burst(inh, 1700, 0.9, 0.022 + level * 0.05, this.master, 'bandpass');
    this.burst(exh, 950, 0.8, 0.03 + level * 0.065, this.master, 'bandpass', inh + 0.05);
  }

  /* ── 따라다니는 소리 (안내원, 벽난로, 시계) ── */
  emitter(ref = 3) {
    const ctx = this.ctx;
    const e = { input: ctx.createGain(), filt: ctx.createBiquadFilter(), pan: this.makePanner(ref), out: ctx.createGain(), nodes: [], hid: false };
    e.filt.type = 'lowpass'; e.filt.frequency.value = 20000;
    e.input.connect(e.filt).connect(e.pan).connect(e.out).connect(this.bus);
    return e;
  }
  moveEmitter(e, x, y, z) {
    if (!e) return;
    this.setPos(e.pan, x, y, z, true);
    e.x = x; e.z = z;
    const hid = this.occlude ? this.occlude(x, z) : false;
    if (hid !== e.hid) {
      e.hid = hid;
      const t = this.t();
      e.filt.frequency.setTargetAtTime(hid ? 700 : 20000, t, 0.08);
      e.out.gain.setTargetAtTime(hid ? 0.5 : 1, t, 0.08);
    }
  }
  dropEmitter(e) {
    if (!e || !this.on) return;
    e.out.gain.setTargetAtTime(0, this.t(), 0.05);
    setTimeout(() => {
      for (const n of e.nodes) { try { n.stop && n.stop(); } catch { /* 이미 멈춤 */ } try { n.disconnect(); } catch { /* */ } }
      try { e.out.disconnect(); } catch { /* */ }
    }, 400);
  }
  loopInto(e, buffer, type, freq, q, gain) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(f).connect(g).connect(e.input);
    s.start(this.t(), Math.random() * 2);
    e.nodes.push(s, f, g);
    return g;
  }
  // 안내원 몸에서 나는 소리
  robotEmitter() {
    if (!this.on) return null;
    const ctx = this.ctx, e = this.emitter(3.2);
    e.kind = 'robot'; e.nextTick = this.t() + Math.random() * 0.3; e.tock = false;
    e.hum = ctx.createGain(); e.hum.gain.value = 0.03;
    const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 260;
    for (const f of [55, 82.4]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (0.98 + Math.random() * 0.04); o.connect(hlp); o.start(); e.nodes.push(o); }
    hlp.connect(e.hum).connect(e.input); e.nodes.push(hlp, e.hum);
    e.hissG = this.loopInto(e, this.noise, 'highpass', 4800, 0.7, 0.01); // 가스등
    return e;
  }
  robotUpdate(e, x, y, z, speed, hunting) {
    if (!e || !this.on) return;
    this.moveEmitter(e, x, y, z);
    const t = this.t();
    e.hum.gain.setTargetAtTime(0.025 + Math.min(1, speed / 5) * 0.07 + (hunting ? 0.03 : 0), t, 0.2);
    if (t >= e.nextTick) { // 태엽 째깍째깍
      e.tock = !e.tock;
      this.burst(0.025, e.tock ? 3200 : 4300, 6, hunting ? 0.11 : 0.07, e.input);
      this.tone(e.tock ? 1650 : 2150, 0.04, 0.025, 'square', e.input);
      e.nextTick = t + (hunting ? 0.13 : 0.24);
    }
  }
  // 바늘 다리 하나가 대리석에 닿는 소리
  tap(e) {
    if (!this.on) return;
    const d = !e ? this.bus : e.input || e; // 따라다니는 소리 또는 일회용 패너
    const f = 4600 + Math.random() * 1400;
    this.burst(0.03, f, 9, 0.2, d);
    this.tone(f * 0.68, 0.07, 0.035, 'triangle', d);
    this.tone(f * 1.07, 0.05, 0.02, 'sine', d);
  }
  // 관절이 삐걱이는 소리
  creakAt(e, angry) {
    if (!this.on) return;
    const d = !e ? this.bus : e.input || e; // 따라다니는 소리 또는 일회용 패너
    const t = this.t(), f0 = 520 + Math.random() * 420;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 18;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.linearRampToValueAtTime(f0 * (0.6 + Math.random() * 0.8), t + 0.45);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(angry ? 0.5 : 0.3, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    s.connect(bp).connect(g).connect(d); s.start(t, Math.random()); s.stop(t + 0.6);
    this.tone(f0 * 0.5, 0.4, angry ? 0.05 : 0.03, 'sawtooth', d, f0 * 0.42);
  }
  // 층마다 깔리는 소리: 어딘가의 괘종시계, 라운지 벽난로
  clearAmbient() { for (const e of this.ambient) this.dropEmitter(e); this.ambient = []; }
  addClock(x, z) {
    if (!this.on) return;
    const e = this.emitter(2.2); e.kind = 'clock'; e.nextTick = this.t() + Math.random(); e.tock = false;
    this.moveEmitter(e, x, 2.2, z); this.ambient.push(e);
  }
  addFire(x, z) {
    if (!this.on) return;
    const e = this.emitter(2.5); e.kind = 'fire'; e.nextPop = this.t();
    this.loopInto(e, this.brown, 'lowpass', 520, 0.7, 0.16);
    this.loopInto(e, this.noise, 'bandpass', 2600, 0.6, 0.012);
    this.moveEmitter(e, x, 0.8, z); this.ambient.push(e);
  }
  setChoirSpots(spots) { // [[x,y,z] x3]
    if (!this.on) return;
    spots.forEach((p, i) => this.setPos(this.choirPans[i], p[0], p[1], p[2]));
  }

  setHeart(level) { this.heartLevel = level; }
  update(dt) {
    if (!this.on) return;
    const t = this.t();
    const lv = this.heartLevel || 0;
    this.heartT -= dt;
    if (lv > 0.05 && this.heartT <= 0) {
      this.heartT = 0.95 - lv * 0.45;
      this.tone(58, 0.18, 0.3 * lv, 'sine', this.heart);
      this.tone(52, 0.2, 0.22 * lv, 'sine', this.heart, null, 0.17);
    }
    for (const v of this.voices) {
      v.ph += dt * 0.7;
      v.o.frequency.setTargetAtTime(v.base * (1 + 0.03 * Math.sin(v.ph)) * (this.screaming > 0 ? 1.9 : 1), t, 0.1);
    }
    if (this.screaming > 0) this.screaming -= dt;
    // 숨
    if (this.breathLevel > 0.08) {
      this.breathT -= dt;
      if (this.breathT <= 0) { this.breathe(this.breathLevel); this.breathT = 1.25 - this.breathLevel * 0.55; }
    }
    // 벽난로 장작, 괘종시계
    for (const e of this.ambient) {
      if (e.kind === 'clock' && t >= e.nextTick) {
        e.tock = !e.tock;
        this.burst(0.05, e.tock ? 1500 : 1900, 5, 0.2, e.input);
        this.tone(e.tock ? 640 : 780, 0.12, 0.05, 'triangle', e.input);
        e.nextTick += 1.0;
        if (e.nextTick < t) e.nextTick = t + 1.0;
      } else if (e.kind === 'fire' && t >= e.nextPop) {
        this.burst(0.03 + Math.random() * 0.04, 1800 + Math.random() * 3000, 2, 0.12 + Math.random() * 0.2, e.input, 'bandpass');
        e.nextPop = t + 0.05 + Math.random() * 0.5;
      }
    }
    // 멀리서 들리는 소리: 손님 둘레 아무 방향에서 가끔
    this.nextFar -= dt;
    if (this.nextFar <= 0 && this.lx !== undefined) {
      this.nextFar = 5 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 22;
      const x = this.lx + Math.cos(a) * d, z = this.lz + Math.sin(a) * d;
      const p = this.panner(x, z, 1 + Math.random() * 5, 4);
      const k = Math.random();
      if (k < 0.4) this.creakWood(p);
      else if (k < 0.65) { for (let i = 0; i < 4; i++) this.burst(0.03, 4800, 9, 0.12, p, 'bandpass', i * (0.14 + Math.random() * 0.05)); } // 먼 안내원 다리
      else if (k < 0.85) { this.burst(0.4, 300, 0.8, 0.12, p, 'lowpass'); this.tone(90, 0.5, 0.05, 'sine', p, 60); } // 문 닫히는 둔탁한 소리
      else { for (let i = 0; i < 3; i++) this.tone(523, 2.2, 0.03, 'sine', p, null, i * 1.1); } // 먼 시계 종
    }
  }

  setChoir(vol) {
    if (!this.on) return;
    const t = this.t();
    this.choirGainNodes.forEach((g) => g.gain.setTargetAtTime(vol, t, 0.4));
  }
  scream() {
    if (!this.on) return;
    this.screaming = 3;
    const t = this.t();
    this.choirGainNodes.forEach((g) => g.gain.setTargetAtTime(1.1, t, 0.05));
    this.choirPans.forEach((p) => this.burst(1.6, 1800, 0.6, 0.18, p));
  }

  ding() { if (!this.on) return; this.tone(988, 1.2, 0.12); this.tone(1318, 1.4, 0.08, 'sine', null, null, 0.18); }
  doors() {
    if (!this.on) return;
    this.burst(0.9, 420, 0.8, 0.1, null, 'lowpass');
    this.burst(0.06, 2200, 3, 0.14, null, 'bandpass', 0.85);
    this.tone(70, 0.9, 0.05, 'sawtooth', null, 55);
  }
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
    bp.connect(out).connect(this.bus);
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
    o.connect(g).connect(this.comp); o.start(t); o.stop(t + dur + 0.05);
  }
  // 소리가 잠깐 물속처럼 먹먹해짐 (setEar로 되돌림)
  muffle() {
    if (!this.on) return;
    this.ear.frequency.setTargetAtTime(320, this.t(), 0.15);
  }
  hiss() { if (!this.on) return; this.burst(0.7, 6000, 0.6, 0.12, null, 'highpass'); this.burst(0.3, 120, 1, 0.3, null, 'lowpass'); }
  focus() { if (!this.on) return; for (let i = 0; i < 3; i++) this.tone(1300 + i * 260, 0.07, 0.05, 'sine', null, 1700 + i * 300, i * 0.09); }

  // 옛 이름들 (위치 소리)
  creak(x, z, angry) { if (!this.on) return; this.creakAt(this.panner(x, z, 2.2), angry); }
  tick(x, z) { if (!this.on) return; this.tap(null); }
  screech(x, z) { if (!this.on) return; const p = this.panner(x, z, 2.4); this.tone(1400, 1.0, 0.3, 'sawtooth', p, 500); this.tone(2100, 0.8, 0.1, 'square', p, 900); this.burst(0.8, 2400, 3, 0.12, p); }
  clank(x, z) { if (!this.on) return; const p = this.panner(x, z, 1.2); this.burst(0.15, 1800, 6, 0.25, p); this.tone(220, 0.25, 0.08, 'triangle', p); }
  light() { if (!this.on) return; this.burst(0.05, 3000, 1, 0.12, null, 'highpass'); this.burst(0.5, 800, 0.7, 0.12, null, 'lowpass', 0.04); this.tone(330, 0.6, 0.03, 'sine', null, 660); }
  pickup() { if (!this.on) return; this.burst(0.12, 2400, 2, 0.08); this.burst(0.18, 600, 1, 0.08, null, 'lowpass', 0.05); this.tone(660, 0.15, 0.04, 'triangle'); }
  paper() { if (!this.on) return; this.burst(0.25, 3500, 0.8, 0.07, null, 'highpass'); this.burst(0.15, 2200, 1, 0.05, null, 'bandpass', 0.12); }
  panelSlide() { if (!this.on) return; this.burst(1.6, 220, 0.6, 0.22, null, 'lowpass'); this.burst(1.6, 1400, 1.5, 0.03, null, 'bandpass'); this.tone(55, 1.6, 0.1, 'sawtooth', null, 40); }
}
