// 공용 도우미
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInt(...ns) {
  let h = 2166136261 >>> 0;
  for (const n of ns) {
    h ^= (n | 0);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

export function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 층 이름: 7층 … 1층, 0층, B1 … B25
export function floorLabel(f) {
  if (f === 0) return '0층';
  return f > 0 ? `${f}층` : `B${-f}`;
}

// 엘리베이터 숫자판 기준(0층 없음)으로 한 칸 위/아래
export const succ = (f) => (f === -1 ? 1 : f + 1);
export const pred = (f) => (f === 1 ? -1 : f - 1);

// 받침 있는지 보고 조사 붙이기
export function hasBatchim(w) {
  const c = w.charCodeAt(w.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return false;
  return (c - 0xac00) % 28 !== 0;
}
export const eul = (w) => (hasBatchim(w) ? '을' : '를');
export const iga = (w) => (hasBatchim(w) ? '이' : '가');

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 선분과 선분이 만나는지 (시야, 상호작용 가림 판정)
export function segHit(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = bx - ax, r2 = bz - az, s1 = dx - cx, s2 = dz - cz;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * s2 - (cz - az) * s1) / den;
  const u = ((cx - ax) * r2 - (cz - az) * r1) / den;
  return t > 0.0001 && t < 0.9999 && u >= 0 && u <= 1;
}
