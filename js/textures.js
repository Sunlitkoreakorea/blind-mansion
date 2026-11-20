// 캔버스로 그리는 질감들 (테마별로 한 번만 만들고 재사용)
import * as THREE from 'three';
import { mulberry32 } from './util.js';

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function toTex(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

export const PALETTE = {
  brass: { paper: '#5c4520', motif: '#7d6230', motif2: '#463315', wood: '#2a1c10', woodHi: '#4a331d', rail: '#b88d3e', floorA: '#d8ccb4', floorB: '#3b2f22', vein: 'rgba(90,70,50,0.35)', ceil: '#1d150d', fog: 0x0f0b07, hemiSky: 0x9a7a4a, hemiGround: 0x1a120a, lamp: 0xffb35a },
  bronze: { paper: '#22332c', motif: '#3c5a4c', motif2: '#16231e', wood: '#14100c', woodHi: '#2b2a20', rail: '#7d8a5a', floorA: '#4d5a4f', floorB: '#121614', vein: 'rgba(160,190,170,0.18)', ceil: '#0b100e', fog: 0x060a09, hemiSky: 0x4f6e62, hemiGround: 0x070a08, lamp: 0x9fe0b8 },
};

// 벽지: 위는 무늬 벽지, 아래는 나무 징두리 (캔버스 위쪽 = 벽 위쪽)
export function wallTex(theme) {
  return cached('wall-' + theme, () => {
    const P = PALETTE[theme];
    // 벽 높이 8.4m에 맞춘 세로로 긴 벽지 (징두리 1.56m는 그대로)
    const HT = 1024;
    const [c, g] = canvas(256, HT);
    const railY = HT - 190;
    g.fillStyle = P.paper; g.fillRect(0, 0, 256, railY);
    // 무늬
    if (theme === 'brass') {
      for (let row = 0; row < 13; row++) {
        for (let col = 0; col < 3; col++) {
          const x = col * 128 + (row % 2 ? 64 : 0), y = row * 62 + 24;
          g.fillStyle = P.motif;
          g.beginPath(); g.ellipse(x, y, 20, 30, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = P.paper;
          g.beginPath(); g.ellipse(x, y, 11, 19, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = P.motif;
          g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x + 7, y - 30); g.lineTo(x, y - 22); g.lineTo(x - 7, y - 30); g.fill();
          g.beginPath(); g.arc(x - 26, y + 6, 5, 0, Math.PI * 2); g.arc(x + 26, y + 6, 5, 0, Math.PI * 2); g.fill();
        }
      }
    } else {
      // 지하: 더 전위적인 기하 무늬
      g.strokeStyle = P.motif; g.lineWidth = 3;
      for (let i = -4; i < 10; i++) {
        g.beginPath(); g.moveTo(i * 40, 0); g.lineTo(i * 40 + 140, railY); g.stroke();
      }
      g.fillStyle = P.motif2;
      for (let i = 0; i < 9; i++) {
        const x = (i * 71) % 256, y = (i * 113) % railY;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 22, y + 40); g.lineTo(x - 22, y + 40); g.fill();
      }
      g.strokeStyle = P.motif; g.lineWidth = 2;
      for (let k = 0; k < 2; k++) for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(128, 160 + k * 400 + i * 30, 30 + i * 18, 0, Math.PI * 2); g.stroke(); }
    }
    // 위쪽 몰딩
    g.fillStyle = P.motif2; g.fillRect(0, 0, 256, 14);
    g.fillStyle = P.rail; g.fillRect(0, 14, 256, 3);
    // 가운데 레일
    g.fillStyle = P.rail; g.fillRect(0, railY - 4, 256, 8);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, railY + 4, 256, 3);
    // 징두리 판
    g.fillStyle = P.wood; g.fillRect(0, railY + 7, 256, HT - railY - 7);
    for (let i = 0; i < 2; i++) {
      const x = 14 + i * 128;
      g.fillStyle = P.woodHi; g.fillRect(x, railY + 26, 100, 112);
      g.fillStyle = P.wood; g.fillRect(x + 6, railY + 32, 88, 100);
    }
    g.fillStyle = '#0a0705'; g.fillRect(0, HT - 22, 256, 22);
    // 얼룩
    const r = mulberry32(theme.length * 77);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.06})`;
      g.beginPath(); g.arc(r() * 256, r() * HT, 6 + r() * 30, 0, Math.PI * 2); g.fill();
    }
    const t = toTex(c);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

// 접힌 관람 지도 (라운지 탁자 위)
export function mapPaperTex() {
  return cached('mapPaper', () => {
    const [c, g] = canvas(256, 190);
    g.fillStyle = '#e2d2ad'; g.fillRect(0, 0, 256, 190);
    g.strokeStyle = '#4a3118'; g.lineWidth = 3;
    g.strokeRect(14, 14, 228, 162);
    g.lineWidth = 2;
    for (const [x, y, w, h] of [[30, 30, 60, 40], [100, 30, 50, 70], [160, 40, 66, 30], [30, 90, 40, 60], [80, 110, 90, 40], [180, 90, 46, 60]]) g.strokeRect(x, y, w, h);
    g.fillStyle = 'rgba(80,50,20,0.25)'; g.fillRect(126, 0, 4, 190); g.fillRect(0, 93, 256, 4);
    g.fillStyle = '#4a3118'; g.font = '700 18px serif'; g.textAlign = 'center'; g.fillText('관람 지도', 128, 186);
    return toTex(c);
  });
}

// 대리석 바닥 (2m 정사각, 1m 타일 4장)
export function marbleTex(theme) {
  return cached('marble-' + theme, () => {
    const P = PALETTE[theme];
    const [c, g] = canvas(512, 512);
    const r = mulberry32(theme === 'brass' ? 11 : 23);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? P.floorB : P.floorA;
      g.fillRect(i * 256, j * 256, 256, 256);
      g.strokeStyle = P.vein; g.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        let x = i * 256 + r() * 256, y = j * 256;
        g.moveTo(x, y);
        for (let s = 0; s < 8; s++) { x += (r() - 0.5) * 60; y += 32; g.lineTo(x, y); }
        g.stroke();
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    g.strokeRect(0, 0, 256, 256); g.strokeRect(256, 256, 256, 256); g.strokeRect(256, 0, 256, 256); g.strokeRect(0, 256, 256, 256);
    return toTex(c, { repeat: true });
  });
}

export function ceilTex(theme) {
  return cached('ceil-' + theme, () => {
    const P = PALETTE[theme];
    const [c, g] = canvas(256, 256);
    g.fillStyle = P.ceil; g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,220,160,0.05)';
    g.fillRect(20, 20, 216, 216);
    g.fillStyle = P.ceil; g.fillRect(36, 36, 184, 184);
    g.strokeStyle = 'rgba(255,220,160,0.08)'; g.lineWidth = 4;
    g.beginPath(); g.arc(128, 128, 50, 0, Math.PI * 2); g.stroke();
    return toTex(c, { repeat: true });
  });
}

// 어두운 그림
export function paintingTex(seed, theme) {
  return cached(`paint-${theme}-${seed}`, () => {
    const r = mulberry32(seed * 131 + 7);
    const [c, g] = canvas(192, 256);
    const hue = theme === 'brass' ? 20 + r() * 30 : 120 + r() * 60;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, `hsl(${hue},30%,${8 + r() * 10}%)`);
    grd.addColorStop(1, `hsl(${hue + 20},25%,${3 + r() * 6}%)`);
    g.fillStyle = grd; g.fillRect(0, 0, 192, 256);
    const kind = Math.floor(r() * 4);
    if (kind === 0) { // 초상 실루엣, 얼굴 자리는 비어 있음
      g.fillStyle = `hsl(${hue},20%,4%)`;
      g.beginPath(); g.ellipse(96, 100, 40, 52, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(36, 150, 120, 120);
      g.fillStyle = `hsl(${hue},25%,70%)`;
      g.beginPath(); g.arc(80, 96, 4, 0, Math.PI * 2); g.arc(112, 96, 4, 0, Math.PI * 2); g.fill();
    } else if (kind === 1) { // 눈 하나
      g.fillStyle = `hsl(${hue},15%,75%)`;
      g.beginPath(); g.ellipse(96, 128, 60, 26, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${hue + 180},40%,25%)`;
      g.beginPath(); g.arc(96, 128, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.arc(96, 128, 9, 0, Math.PI * 2); g.fill();
    } else if (kind === 2) { // 풍경, 지평선 아래 손들
      g.fillStyle = `hsl(${hue},20%,14%)`; g.fillRect(0, 170, 192, 86);
      g.strokeStyle = `hsl(${hue},20%,40%)`; g.lineWidth = 3;
      for (let i = 0; i < 7; i++) { const x = 20 + i * 26; g.beginPath(); g.moveTo(x, 256); g.lineTo(x + (r() - 0.5) * 20, 175 - r() * 40); g.stroke(); }
    } else { // 겹친 동그라미
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = `hsla(${hue + i * 8},40%,${30 + r() * 30}%,0.6)`; g.lineWidth = 2;
        g.beginPath(); g.arc(96 + (r() - 0.5) * 60, 128 + (r() - 0.5) * 80, 10 + r() * 50, 0, Math.PI * 2); g.stroke();
      }
    }
    // 낡은 니스 느낌
    g.fillStyle = 'rgba(80,50,10,0.18)'; g.fillRect(0, 0, 192, 256);
    return toTex(c);
  });
}

export function eyeTex() {
  return cached('eye', () => {
    const [c, g] = canvas(128, 64);
    g.fillStyle = '#f2ead8'; g.fillRect(0, 0, 128, 64);
    // SphereGeometry에서 u=0.25가 +z 방향(lookAt 정면)
    const cx = 32, cy = 32;
    g.strokeStyle = 'rgba(160,40,30,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(64 + Math.random() * 64, Math.random() * 64); g.lineTo(cx + 18, cy + (Math.random() - 0.5) * 20); g.stroke(); }
    const grd = g.createRadialGradient(cx, cy, 2, cx, cy, 16);
    grd.addColorStop(0, '#111'); grd.addColorStop(0.35, '#111');
    grd.addColorStop(0.4, '#3d6b7d'); grd.addColorStop(1, '#a9c9a0');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    return toTex(c);
  });
}

// 원판용 눈: 흰자 동그라미 + 홍채 (바깥은 투명)
export function eyeDiscTex() {
  return cached('eyedisc', () => {
    const [c, g] = canvas(64, 64);
    const sc = g.createRadialGradient(30, 28, 4, 32, 32, 30);
    sc.addColorStop(0, '#fbf4e4'); sc.addColorStop(0.8, '#e6dac0'); sc.addColorStop(1, '#a8967a');
    g.fillStyle = sc; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(170,40,30,0.4)'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) { const a = i * 0.8; g.beginPath(); g.moveTo(32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29); g.lineTo(32 + Math.cos(a + 0.3) * 16, 32 + Math.sin(a + 0.3) * 16); g.stroke(); }
    const ir = g.createRadialGradient(32, 32, 3, 32, 32, 13);
    ir.addColorStop(0, '#0a0a0a'); ir.addColorStop(0.42, '#0a0a0a'); ir.addColorStop(0.48, '#2f5d70'); ir.addColorStop(1, '#9cc49a');
    g.fillStyle = ir; g.beginPath(); g.arc(32, 32, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(27, 27, 2.5, 0, Math.PI * 2); g.fill();
    return toTex(c);
  });
}

export function mouthTex() {
  return cached('mouth', () => {
    const [c, g] = canvas(128, 96);
    g.fillStyle = '#1b0d0b'; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#5a1f1a';
    g.beginPath(); g.ellipse(64, 48, 52, 32, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#080303';
    g.beginPath(); g.ellipse(64, 50, 40, 20, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9cfb8';
    for (let i = 0; i < 7; i++) g.fillRect(30 + i * 10, 31, 8, 8);
    for (let i = 0; i < 6; i++) g.fillRect(35 + i * 10, 61, 8, 7);
    g.fillStyle = '#7a2c2a'; g.beginPath(); g.ellipse(64, 60, 18, 6, 0, 0, Math.PI * 2); g.fill();
    return toTex(c);
  });
}

// 엘리베이터 버튼판: 1과 B1 사이에 뜯겨 나간 자리
export function elevPanelTex(top, bottom) {
  return cached(`panel-${top}-${bottom}`, () => {
    const labels = [];
    for (let f = top; f >= 1; f--) labels.push(String(f));
    labels.push('');
    for (let f = 1; f <= -bottom; f++) labels.push('B' + f);
    const cols = 3, rows = Math.ceil(labels.length / cols);
    const [c, g] = canvas(256, 64 + rows * 46);
    g.fillStyle = '#3a2a12'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#b88d3e'; g.lineWidth = 6; g.strokeRect(6, 6, c.width - 12, c.height - 12);
    g.font = 'bold 18px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    labels.forEach((l, i) => {
      const x = 50 + (i % cols) * 78, y = 44 + Math.floor(i / cols) * 46;
      if (l === '') {
        g.fillStyle = '#120c05'; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(200,160,90,0.35)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x - 10, y - 8); g.lineTo(x + 6, y + 9); g.moveTo(x + 9, y - 10); g.lineTo(x - 4, y + 4); g.stroke();
        return;
      }
      g.fillStyle = '#c9a25a'; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b1d0a'; g.fillText(l, x, y + 1);
    });
    return toTex(c);
  });
}

export function plaqueTex(lines, key) {
  return cached('plaque-' + key, () => {
    const [c, g] = canvas(512, 160);
    const grd = g.createLinearGradient(0, 0, 0, 160);
    grd.addColorStop(0, '#c7a25c'); grd.addColorStop(1, '#7c5a24');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#3a2a12'; g.lineWidth = 6; g.strokeRect(10, 10, 492, 140);
    g.fillStyle = '#2a1c0a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 40px "Nanum Myeongjo", serif';
    lines.forEach((l, i) => g.fillText(l, 256, 80 + (i - (lines.length - 1) / 2) * 50));
    return toTex(c);
  });
}

// 읽을 수 없는 낯선 글자 명판
export function glyphTex(seed) {
  return cached('glyph-' + seed, () => {
    const r = mulberry32(seed);
    const [c, g] = canvas(512, 128);
    g.fillStyle = '#2a1c0a'; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#d6b066'; g.lineWidth = 4;
    g.strokeRect(8, 8, 496, 112);
    g.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 50;
      g.beginPath();
      g.moveTo(x, 40 + r() * 20);
      for (let k = 0; k < 4; k++) g.lineTo(x + (r() - 0.5) * 36, 30 + r() * 70);
      g.stroke();
      g.beginPath(); g.arc(x + (r() - 0.5) * 20, 64, 4 + r() * 6, 0, Math.PI * 2); g.stroke();
    }
    return toTex(c);
  });
}

export function exitSignTex() {
  return cached('exitsign', () => {
    const [c, g] = canvas(256, 96);
    g.fillStyle = '#0d3a1c'; g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#7dff9a';
    // 달리는 사람
    g.beginPath(); g.arc(60, 26, 9, 0, Math.PI * 2); g.fill();
    g.lineWidth = 7; g.strokeStyle = '#7dff9a'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(58, 38); g.lineTo(50, 62); g.lineTo(36, 80); g.moveTo(50, 62); g.lineTo(68, 78); g.moveTo(56, 44); g.lineTo(74, 54); g.moveTo(56, 44); g.lineTo(40, 50); g.stroke();
    // 문
    g.strokeRect(92, 18, 40, 64);
    g.beginPath(); g.moveTo(150, 48); g.lineTo(230, 48); g.moveTo(205, 30); g.lineTo(230, 48); g.lineTo(205, 66); g.stroke();
    return toTex(c);
  });
}

export function noteTex() {
  return cached('note', () => {
    const [c, g] = canvas(128, 160);
    g.fillStyle = '#e6dcc2'; g.fillRect(0, 0, 128, 160);
    g.strokeStyle = 'rgba(40,30,20,0.6)'; g.lineWidth = 2;
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(14, 24 + i * 14); g.lineTo(100 + Math.random() * 14, 24 + i * 14 + (Math.random() - 0.5) * 3); g.stroke(); }
    return toTex(c);
  });
}

export function glowTex() {
  return cached('glow', () => {
    const [c, g] = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return toTex(c);
  });
}

export function flameTex() {
  return cached('flame', () => {
    const [c, g] = canvas(64, 128);
    const grd = g.createRadialGradient(32, 90, 2, 32, 80, 50);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(62, 80, 32, 124); g.quadraticCurveTo(2, 80, 32, 4); g.fill();
    return toTex(c);
  });
}

export function rugTex(theme) {
  return cached('rug-' + theme, () => {
    const [c, g] = canvas(256, 256);
    const base = theme === 'brass' ? '#4a1414' : '#14302a';
    const line = theme === 'brass' ? '#a07a34' : '#5f8a70';
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = line; g.lineWidth = 6; g.strokeRect(14, 14, 228, 228);
    g.lineWidth = 2; g.strokeRect(30, 30, 196, 196);
    g.beginPath(); g.moveTo(128, 50); g.lineTo(206, 128); g.lineTo(128, 206); g.lineTo(50, 128); g.closePath(); g.stroke();
    return toTex(c);
  });
}
