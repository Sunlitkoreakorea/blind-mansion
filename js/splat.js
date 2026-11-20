// 화면(렌즈)에 튀는 빨간 얼룩: 뿌려진 뒤 잠깐 남아 흘러내리다 옅어짐
const COLORS = ['#7a0000', '#8f0605', '#a10d08', '#6a0302'];

function blob(r, dir, color, rnd) {
  const size = Math.ceil(r * 5.4);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2;
  g.fillStyle = color;
  // 울퉁불퉁한 덩어리
  g.beginPath();
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const along = Math.cos(a - dir);
    const rr = r * (0.72 + rnd() * 0.32) * (1 + Math.max(0, along) * 0.35);
    const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  // 튀어 나간 방향으로 길쭉한 줄기와 작은 방울
  const streaks = 3 + Math.floor(rnd() * 4);
  for (let k = 0; k < streaks; k++) {
    const a = dir + (rnd() - 0.5) * 1.1;
    const len = r * (1.1 + rnd() * 1.4);
    const w = r * (0.1 + rnd() * 0.16);
    g.save();
    g.translate(c, c);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -w);
    g.quadraticCurveTo(len * 0.7, -w * 0.6, len, 0);
    g.quadraticCurveTo(len * 0.7, w * 0.6, 0, w);
    g.fill();
    g.beginPath();
    g.arc(len + w * 1.6, 0, w * 0.9, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  const drops = 6 + Math.floor(rnd() * 10);
  for (let k = 0; k < drops; k++) {
    const a = dir + (rnd() - 0.5) * 2.2;
    const d = r * (1.1 + rnd() * 1.4);
    g.beginPath();
    g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, r * (0.04 + rnd() * 0.14), 0, Math.PI * 2);
    g.fill();
  }
  // 젖은 윤기
  g.globalCompositeOperation = 'source-atop';
  const hl = g.createRadialGradient(c - r * 0.3, c - r * 0.35, 0, c - r * 0.3, c - r * 0.35, r * 0.7);
  hl.addColorStop(0, 'rgba(255,140,120,0.35)');
  hl.addColorStop(1, 'rgba(255,140,120,0)');
  g.fillStyle = hl;
  g.fillRect(0, 0, size, size);
  const dk = g.createRadialGradient(c, c, r * 0.2, c, c, r * 2.4);
  dk.addColorStop(0, 'rgba(0,0,0,0)');
  dk.addColorStop(1, 'rgba(20,0,0,0.45)');
  g.fillStyle = dk;
  g.fillRect(0, 0, size, size);
  return cv;
}

export class Splatter {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.list = [];
    this.drips = [];
    this.dirty = false;
    this.seed = 1;
  }
  rnd() { this.seed = (this.seed * 16807) % 2147483647; return (this.seed - 1) / 2147483646; }
  resize() { this.cv.width = innerWidth; this.cv.height = innerHeight; this.dirty = true; }

  // ox, oy: 화면 비율(0~1) 기준 튀어 나오는 자리 / n: 개수 / power: 크기
  spray(ox, oy, n, power = 1, hold = 2.5) {
    const W = this.cv.width, H = this.cv.height, S = Math.min(W, H);
    this.seed = (Math.random() * 2147483646 + 1) | 0;
    for (let i = 0; i < n; i++) {
      const dir = Math.random() * Math.PI * 2;
      const dist = Math.random() ** 0.6 * S * 0.42 * power;
      const x = ox * W + Math.cos(dir) * dist, y = oy * H + Math.sin(dir) * dist * 0.8;
      const r = S * (0.012 + Math.random() * 0.035) * power * (1.2 - (dist / (S * 0.5 * power)) * 0.6);
      if (r < 2) continue;
      const img = blob(r, dir, COLORS[Math.floor(Math.random() * COLORS.length)], () => this.rnd());
      const s = { img, x, y, t: 0, hold: hold + Math.random() * 1.2, fade: 3 + Math.random() * 2, a: 0.85 + Math.random() * 0.15, pop: 0 };
      this.list.push(s);
      if (r > S * 0.02 && Math.random() < 0.6) {
        this.drips.push({ s, x: x + (Math.random() - 0.5) * r * 0.8, y: y + r * 0.5, len: 0, max: r * (2 + Math.random() * 7), w: r * (0.14 + Math.random() * 0.14), v: 8 + Math.random() * 26, delay: 0.2 + Math.random() * 0.8 });
      }
    }
    if (this.list.length > 160) this.list.splice(0, this.list.length - 160);
    this.dirty = true;
  }

  clear() { this.list.length = 0; this.drips.length = 0; this.dirty = true; }

  update(dt) {
    if (!this.list.length && !this.dirty) return;
    const g = this.g;
    g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.dirty = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.t += dt;
      s.pop = Math.min(1, s.pop + dt * 14);
      const alpha = s.a * (s.t < s.hold ? 1 : Math.max(0, 1 - (s.t - s.hold) / s.fade));
      if (alpha <= 0) { this.list.splice(i, 1); continue; }
      const k = 0.6 + 0.4 * s.pop;
      const w = s.img.width * k;
      g.globalAlpha = alpha;
      g.drawImage(s.img, s.x - w / 2, s.y - w / 2, w, w);
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      if (!this.list.includes(d.s)) { this.drips.splice(i, 1); continue; }
      if (d.delay > 0) d.delay -= dt;
      else if (d.len < d.max) d.len = Math.min(d.max, d.len + d.v * dt * (1 - d.len / d.max * 0.7));
      if (d.len <= 0) continue;
      const s = d.s;
      g.globalAlpha = s.a * (s.t < s.hold ? 1 : Math.max(0, 1 - (s.t - s.hold) / s.fade));
      g.strokeStyle = '#7d0303';
      g.fillStyle = '#7d0303';
      g.lineCap = 'round';
      g.lineWidth = d.w;
      g.beginPath();
      g.moveTo(d.x, d.y);
      g.lineTo(d.x, d.y + d.len);
      g.stroke();
      g.beginPath();
      g.arc(d.x, d.y + d.len, d.w * 0.85, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
}
