// 층 배치 만들기 + 3D로 그리기
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry32, hashInt, shuffle, floorLabel, succ, pred } from './util.js';
import * as TX from './textures.js';
import { NOTES, TOP, BOTTOM, START_FLOOR } from './data.js';

export const S = 8, W = 13, H = 13, WALL_H = 8.4, WALL_T = 0.3, DOOR_W = 3.2, DOOR_H = 5.0;
const K = S / 4; // 처음 설계(4m 칸) 대비 배율
// 계단실: 동쪽 2x3칸. 북쪽 줄은 올라가는 계단, 남쪽 줄은 내려가는 계단, 가운데 줄은 층계참
export const STAIR = { cx: 11, cz: 8, w: 2, h: 3 };
export const RISE = 4.2;
export const ELEV = { cx: 6, cz: 12 };
export const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
export const idx = (cx, cz) => cz * W + cx;
export const inGrid = (cx, cz) => cx >= 0 && cz >= 0 && cx < W && cz < H;
export const center = (cx, cz) => ({ x: cx * S + S / 2, z: cz * S + S / 2 });
export const cellAt = (x, z) => ({ cx: Math.floor(x / S), cz: Math.floor(z / S) });
const ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // 벽 방향별로 방 안쪽을 보게 하는 회전

function edgeRef(L, cx, cz, dir) {
  if (dir === 0) return { a: L.hw, i: cz * W + cx };
  if (dir === 2) return { a: L.hw, i: (cz + 1) * W + cx };
  if (dir === 3) return { a: L.vw, i: cz * (W + 1) + cx };
  return { a: L.vw, i: cz * (W + 1) + cx + 1 };
}
export function getEdge(L, cx, cz, dir) { const e = edgeRef(L, cx, cz, dir); return e.a[e.i]; }
function setEdge(L, cx, cz, dir, t) { const e = edgeRef(L, cx, cz, dir); e.a[e.i] = t; }
export function passable(L, cx, cz, dir) {
  const t = getEdge(L, cx, cz, dir);
  return t === 0 || t === 2;
}
export function roomKind(L, cx, cz) {
  if (!inGrid(cx, cz)) return null;
  const r = L.roomId[idx(cx, cz)];
  return r >= 0 ? L.rooms[r].kind : 'corridor';
}

/* ───────────── 배치 생성 ───────────── */
export function generateLayout(floor, seed, opt = {}) {
  const rnd = mulberry32(hashInt(seed, floor + 5000));
  const L = {
    floor, seed, theme: floor >= 0 ? 'brass' : 'bronze', depth: Math.max(0, -floor),
    hw: new Uint8Array(W * (H + 1)).fill(1),
    vw: new Uint8Array((W + 1) * H).fill(1),
    roomId: new Int16Array(W * H).fill(-1),
    voidCell: new Uint8Array(W * H),
    rooms: [], items: [], decor: [], boxes: [], segs: [],
    hidden: null, hiddenOpen: false, exitDoor: null, start: null, arrive: null, stairs: null,
  };
  if (floor === 0) { buildZero(L, opt); computeSegs(L); return L; }

  const par = new Int32Array(W * H).map((_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };

  addRoom(L, ELEV.cx, ELEV.cz, 1, 1, 'elev', true);
  if (floor === -1) addRoom(L, 1, 8, 4, 3, 'lounge', true);
  if (floor === 2) addRoom(L, 4, 3, 5, 4, 'mouth', true);
  if (floor === 3) addRoom(L, 4, 2, 5, 4, 'eyes', true);
  if (floor === 5) addRoom(L, 9, 2, 2, 2, 'guest', true);
  addRoom(L, STAIR.cx, STAIR.cz, STAIR.w, STAIR.h, 'stair', true);
  let want = 5 + Math.floor(rnd() * 3), tries = 0;
  while (want > 0 && tries++ < 90) {
    const w = 2 + Math.floor(rnd() * 2), h = 2 + Math.floor(rnd() * 2);
    const x = Math.floor(rnd() * (W - w + 1)), y = Math.floor(rnd() * (H - 1 - h + 1));
    if (ELEV.cx >= x && ELEV.cx < x + w && ELEV.cz - 1 >= y && ELEV.cz - 1 < y + h) continue;
    if (addRoom(L, x, y, w, h, 'exhibit', false) >= 0) want--;
  }
  for (const r of L.rooms) {
    const first = idx(r.x, r.y);
    for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) union(first, idx(cx, cz));
  }
  const door = (cx, cz, dir) => {
    setEdge(L, cx, cz, dir, 2);
    const a = idx(cx, cz), b = idx(cx + DX[dir], cz + DZ[dir]);
    union(a, b);
    for (const c of [a, b]) if (L.roomId[c] >= 0) L.rooms[L.roomId[c]].doors++;
  };
  door(ELEV.cx, ELEV.cz, 0);
  if (floor === -1) door(4, 9, 1);
  if (floor === 2) { door(6, 6, 2); door(6, 3, 0); }
  if (floor === 3) door(6, 5, 2);
  if (floor === 5) door(9, 3, 2);
  door(STAIR.cx, STAIR.cz + 1, 3);

  // 크루스칼로 미로 + 방 연결
  const edges = [];
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    if (cx < W - 1) edges.push([cx, cz, 1]);
    if (cz < H - 1) edges.push([cx, cz, 2]);
  }
  shuffle(edges, rnd);
  const leftovers = [];
  for (const capped of [true, false]) {
    for (const e of edges) {
      const [cx, cz, dir] = e;
      const a = idx(cx, cz), b = idx(cx + DX[dir], cz + DZ[dir]);
      const ra = L.roomId[a], rb = L.roomId[b];
      if (ra >= 0 && ra === rb) continue;
      if ((ra >= 0 && L.rooms[ra].locked) || (rb >= 0 && L.rooms[rb].locked)) continue;
      if (getEdge(L, cx, cz, dir) !== 1) continue;
      if (find(a) === find(b)) { if (!capped) leftovers.push(e); continue; }
      if (capped && ((ra >= 0 && L.rooms[ra].doors >= 3) || (rb >= 0 && L.rooms[rb].doors >= 3))) continue;
      setEdge(L, cx, cz, dir, ra >= 0 || rb >= 0 ? 2 : 0);
      union(a, b);
      if (ra >= 0) L.rooms[ra].doors++;
      if (rb >= 0) L.rooms[rb].doors++;
    }
  }
  // 고리를 몇 개 뚫어 추격 중에 돌아 나갈 길을 만든다
  for (const [cx, cz, dir] of leftovers) {
    if (getEdge(L, cx, cz, dir) !== 1) continue;
    const ra = L.roomId[idx(cx, cz)], rb = L.roomId[idx(cx + DX[dir], cz + DZ[dir])];
    if (ra < 0 && rb < 0) { if (rnd() < 0.17) setEdge(L, cx, cz, dir, 0); continue; }
    const r = ra >= 0 ? L.rooms[ra] : null, q = rb >= 0 ? L.rooms[rb] : null;
    if ((r && r.locked) || (q && q.locked)) continue;
    if ((r && r.doors < 2) || (q && q.doors < 2)) {
      if (rnd() < 0.6) { setEdge(L, cx, cz, dir, 2); if (r) r.doors++; if (q) q.doors++; }
    }
  }

  // 0층으로 가는 숨은 문: 1층과 지하 1층 계단실 층계참 안쪽 벽
  if (floor === 1 || floor === -1) { L.hidden = { cx: W - 1, cz: STAIR.cz + 1, dir: 1 }; setEdge(L, W - 1, STAIR.cz + 1, 1, 3); }
  // 계단: 맨 위층엔 올라가는 계단, 맨 아래층엔 내려가는 계단이 없음
  {
    const x0 = STAIR.cx * S + 3, x1 = W * S - 2.5;
    const zN = STAIR.cz * S, zS = (STAIR.cz + STAIR.h) * S;
    L.stairs = {
      x0, x1,
      up: floor < TOP ? { z0: zN + 0.45, z1: zN + 4.45, to: succ(floor) } : null,
      down: floor > BOTTOM ? { z0: zS - 4.45, z1: zS - 0.45, to: pred(floor) } : null,
    };
  }
  if (opt.exitFloor === floor) {
    const cx = 2 + Math.floor(rnd() * 9);
    L.exitDoor = { cx, cz: 0, dir: 0 };
    setEdge(L, cx, 0, 0, 4);
  }
  L.arrive = { cx: ELEV.cx, cz: ELEV.cz, yaw: 0 };

  placeStuff(L, rnd, opt);
  computeSegs(L);
  return L;
}

function addRoom(L, x, y, w, h, kind, locked) {
  for (let cz = y; cz < y + h; cz++) for (let cx = x; cx < x + w; cx++) {
    if (!inGrid(cx, cz) || L.roomId[idx(cx, cz)] >= 0) return -1;
  }
  const id = L.rooms.length;
  L.rooms.push({ id, x, y, w, h, kind, locked, doors: 0 });
  for (let cz = y; cz < y + h; cz++) for (let cx = x; cx < x + w; cx++) {
    L.roomId[idx(cx, cz)] = id;
    if (cx < x + w - 1) setEdge(L, cx, cz, 1, 0);
    if (cz < y + h - 1) setEdge(L, cx, cz, 2, 0);
  }
  return id;
}

// 0층: 비상문이 있는 현관 하나
function buildZero(L, opt) {
  L.voidCell.fill(1);
  addRoom(L, 5, 4, 3, 3, 'foyer', true);
  for (const [cx, cz] of [[5, 4], [6, 4], [7, 4], [5, 5], [6, 5], [7, 5], [5, 6], [6, 6], [7, 6], [6, 7], [6, 8]]) L.voidCell[idx(cx, cz)] = 0;
  setEdge(L, 6, 6, 2, 2);
  setEdge(L, 6, 7, 2, 0);
  L.hidden = { cx: 6, cz: 8, dir: 2 };
  setEdge(L, 6, 8, 2, 3);
  L.hiddenOpen = true;
  L.exitDoor = { cx: 6, cz: 4, dir: 0 };
  setEdge(L, 6, 4, 0, 4);
  L.arrive = { cx: 6, cz: 8, yaw: 0 };
  const sx1 = 5 * S + 1.6, sx2 = 8 * S - 1.6, sz = 5 * S + 3;
  L.decor.push({ type: 'statue', x: sx1, z: sz, rot: Math.PI / 2 }, { type: 'statue', x: sx2, z: sz, rot: -Math.PI / 2 });
  L.boxes.push(box(sx1, sz, 1.2, 1.2, 0), box(sx2, sz, 1.2, 1.2, 0));
}

function box(x, z, w, d, rot) {
  const sw = Math.abs(Math.sin(rot)) > 0.5;
  const hw = (sw ? d : w) / 2, hd = (sw ? w : d) / 2;
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd };
}

/* 그래프 도우미 */
export function neighbors(L, c, forbid) {
  const cx = c % W, cz = (c / W) | 0, out = [];
  for (let d = 0; d < 4; d++) {
    const nx = cx + DX[d], nz = cz + DZ[d];
    if (!inGrid(nx, nz) || !passable(L, cx, cz, d)) continue;
    const n = idx(nx, nz);
    if (L.voidCell[n] || (forbid && forbid(n))) continue;
    out.push(n);
  }
  return out;
}
export function bfs(L, from, forbid) {
  const dist = new Int16Array(W * H).fill(-1), prev = new Int16Array(W * H).fill(-1);
  const q = [from]; dist[from] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (const n of neighbors(L, c, forbid)) if (dist[n] < 0) { dist[n] = dist[c] + 1; prev[n] = c; q.push(n); }
  }
  return { dist, prev };
}
export function findPath(L, from, to, forbid) {
  if (from === to) return [];
  const { dist, prev } = bfs(L, from, forbid);
  if (dist[to] < 0) return null;
  const path = [];
  for (let c = to; c !== from; c = prev[c]) path.push(c);
  return path.reverse();
}
export function zonesFor(L, seeds, forbid) {
  const zone = new Int8Array(W * H).fill(-1);
  const q = [];
  seeds.forEach((s, i) => { zone[s] = i; q.push(s); });
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    for (const n of neighbors(L, c, forbid)) if (zone[n] < 0) { zone[n] = zone[c]; q.push(n); }
  }
  return zone;
}

/* 물건 놓기 */
function placeStuff(L, rnd, opt) {
  let nid = 0;
  const used = new Set();
  const addItem = (o) => { o.id = `${L.floor}:${nid++}`; L.items.push(o); return o; };
  const roll = (pt, pk) => { const v = rnd(); return v < pt ? { tool: 1 } : v < pt + pk ? { kit: 1 } : {}; };
  const wallSpot = (cx, cz, off = S / 2 - 0.5, spread = 1.4 * K) => {
    for (const d of shuffle([0, 1, 2, 3], rnd)) {
      if (getEdge(L, cx, cz, d) !== 1) continue;
      const key = `${cx},${cz},${d}`;
      if (used.has(key)) continue;
      used.add(key);
      const c = center(cx, cz), a = (rnd() - 0.5) * spread;
      const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x + a;
      const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z + a;
      return { x, z, rot: ROT[d], d };
    }
    return null;
  };
  const freeCells = [];
  for (let c = 0; c < W * H; c++) {
    const r = L.roomId[c];
    const k = r >= 0 ? L.rooms[r].kind : 'corridor';
    if (k === 'corridor' || k === 'exhibit') freeCells.push(c);
  }
  const cornerSpot = (c) => {
    const p = center(c % W, (c / W) | 0);
    const o = () => (rnd() < 0.5 ? -1 : 1) * (S / 2 - 1.0 - rnd() * 0.8);
    return { x: p.x + o(), z: p.z + o(), rot: rnd() * Math.PI * 2 };
  };

  // 전시실: 진열장, 그림, 조각
  for (const r of L.rooms) {
    if (r.kind !== 'exhibit') continue;
    const cells = [];
    for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) cells.push([cx, cz]);
    shuffle(cells, rnd);
    let cases = 1 + (rnd() < 0.6 ? 1 : 0);
    for (const [cx, cz] of cells) {
      if (cases <= 0) break;
      const s = wallSpot(cx, cz, S / 2 - 0.75, 1.2 * K);
      if (!s) continue;
      addItem({ kind: 'case', ...s, content: roll(0.3, 0.15), art: Math.floor(rnd() * 4) });
      L.boxes.push(box(s.x, s.z, 0.85, 0.85, s.rot));
      cases--;
    }
    for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) {
      for (let d = 0; d < 4; d++) {
        if (getEdge(L, cx, cz, d) !== 1 || rnd() > 0.55) continue;
        const c = center(cx, cz), off = S / 2 - WALL_T / 2 - 0.04;
        for (const a of [-S / 4, S / 4]) {
          if (rnd() < 0.25) continue;
          const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x + a;
          const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z + a;
          L.decor.push({ type: 'painting', x, z, rot: ROT[d], seed: Math.floor(rnd() * 6) });
        }
      }
    }
    const mx = (r.x + r.w / 2) * S + (r.w % 2 ? 0.95 : 0), mz = (r.y + r.h / 2) * S + (r.h % 2 ? 0.95 : 0);
    L.decor.push({ type: 'sculpture', x: mx, z: mz, rot: rnd() * 6, seed: Math.floor(rnd() * 4) });
    L.decor.push({ type: 'rug', x: (r.x + r.w / 2) * S, z: (r.y + r.h / 2) * S, w: r.w * S - 3.2, d: r.h * S - 3.2 });
    L.boxes.push(box(mx, mz, 1.3, 1.3, 0));
    L.decor.push({ type: 'chandelier', x: (r.x + r.w / 2) * S, z: (r.y + r.h / 2) * S });
    // 칸마다 받침대 위 전시물, 가끔 긴 의자
    for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) {
      const c = center(cx, cz);
      if (Math.hypot(c.x - mx, c.z - mz) < S * 0.6) continue;
      const v = rnd();
      if (v < 0.5) {
        const x = c.x + (rnd() - 0.5) * 1.2, z = c.z + (rnd() - 0.5) * 1.2;
        L.decor.push({ type: 'pedestal', x, z, rot: rnd() * 6, seed: Math.floor(rnd() * 4) });
        L.boxes.push(box(x, z, 0.8, 0.8, 0));
      } else if (v < 0.72) {
        const rot = rnd() < 0.5 ? 0 : Math.PI / 2;
        L.decor.push({ type: 'bench', x: c.x, z: c.z, rot });
        L.boxes.push(box(c.x, c.z, 1.9, 0.6, rot));
      }
    }
  }

  // 복도 벽등
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const k = roomKind(L, cx, cz);
    if (k !== 'corridor' && k !== 'exhibit') continue;
    for (let d = 0; d < 4; d++) {
      if (getEdge(L, cx, cz, d) !== 1 || rnd() > (k === 'corridor' ? 0.32 : 0.16)) continue;
      const c = center(cx, cz), off = S / 2 - WALL_T / 2 - 0.02;
      const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x;
      const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z;
      L.decor.push({ type: 'sconce', x, z, rot: ROT[d] });
    }
  }

  // 가방, 장
  const nCont = 2 + Math.floor(rnd() * 2);
  const cellsShuffled = shuffle(freeCells.slice(), rnd);
  let made = 0;
  for (const c of cellsShuffled) {
    if (made >= nCont) break;
    const cx = c % W, cz = (c / W) | 0;
    if (rnd() < 0.5) {
      const s = wallSpot(cx, cz, S / 2 - 0.45, 1.6 * K);
      if (!s) continue;
      addItem({ kind: 'cabinet', ...s, content: roll(0.35, 0.15) });
      L.boxes.push(box(s.x, s.z, 1.15, 0.5, s.rot));
    } else {
      addItem({ kind: 'bag', ...cornerSpot(c), content: roll(0.35, 0.15) });
    }
    made++;
  }

  // 시작 층: 시작 자리와 키트 가방
  if (L.floor === START_FLOOR) {
    const ex = L.rooms.filter((r) => r.kind === 'exhibit');
    const far = (r) => Math.abs(r.x + r.w / 2 - ELEV.cx) + Math.abs(r.y + r.h / 2 - ELEV.cz);
    ex.sort((a, b) => far(b) - far(a));
    const r = ex[0];
    const sc = r ? [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)] : [2, 2];
    L.start = { cx: sc[0], cz: sc[1], yaw: rnd() * Math.PI * 2 };
    const { dist } = bfs(L, idx(sc[0], sc[1]));
    let best = null;
    for (const c of freeCells) if (dist[c] >= 2 && dist[c] <= 4) { best = c; if (rnd() < 0.3) break; }
    if (best == null) best = freeCells.find((c) => dist[c] >= 1) ?? idx(sc[0], sc[1]);
    addItem({ kind: 'bag', ...cornerSpot(best), content: { kit: 1, note: 'n1' }, starter: true });
    // 빈 관람 지도: 시작 자리에서 5~9칸 떨어진 곳의 가방
    const mc = freeCells.filter((c) => dist[c] >= 5 && dist[c] <= 9 && c !== best);
    const mcell = mc.length ? mc[Math.floor(rnd() * mc.length)] : freeCells[Math.floor(rnd() * freeCells.length)];
    addItem({ kind: 'bag', ...cornerSpot(mcell), content: { map: 1 } });
  }

  // 쪽지
  for (const n of NOTES.filter((n) => n.floor === L.floor && n.id !== 'n1')) {
    if (L.floor === -1) continue; // 라운지 탁자 위에 따로 놓음
    const c = cellsShuffled[(made++) % cellsShuffled.length];
    const s = cornerSpot(c);
    addItem({ kind: 'note', ...s, note: n.id });
  }

  // 특별 공간
  if (L.floor === -1) {
    // 라운지: 탁자, 벽난로, 소파
    const fx = 1 * S + 0.45 + WALL_T / 2, fz = 9.5 * S;
    L.lounge = { fx, fz };
    addItem({ kind: 'craft', x: fx + 7.55, z: fz, rot: 0 });
    L.boxes.push(box(fx + 7.55, fz, 1.8, 1.1, 0));
    addItem({ kind: 'fire', x: fx, z: fz, rot: Math.PI / 2 });
    L.boxes.push(box(fx, fz, 2.2, 0.9, Math.PI / 2));
    addItem({ kind: 'note', x: fx + 6.9, z: fz - 0.25, y: 0.86, rot: 0.3, note: 'n2' });
    addItem({ kind: 'note', x: fx + 8.25, z: fz + 0.25, y: 0.86, rot: -0.5, note: 'n8' });
    addItem({ kind: 'map', x: fx + 7.7, z: fz - 0.3, y: 0.86, rot: 0.15 });
    L.decor.push({ type: 'sofa', x: fx + 2.75, z: fz - 3.4, rot: Math.PI / 2 + 0.4 }, { type: 'sofa', x: fx + 2.75, z: fz + 3.4, rot: Math.PI / 2 - 0.4 }, { type: 'sofa', x: fx + 12.05, z: fz, rot: -Math.PI / 2 });
    L.boxes.push(box(fx + 2.75, fz - 3.4, 2, 0.9, Math.PI / 2), box(fx + 2.75, fz + 3.4, 2, 0.9, Math.PI / 2), box(fx + 12.05, fz, 2, 0.9, -Math.PI / 2));
    L.decor.push({ type: 'rug', x: fx + 7.55, z: fz, w: 15, d: 11 });
    L.decor.push({ type: 'chandelier', x: fx + 7.55, z: fz }, { type: 'chandelier', x: 4 * S, z: 8.8 * S });
  }
  if (L.floor === 3) {
    addItem({ kind: 'case', x: 6.5 * S, z: 3.75 * S, rot: 0, content: { tool: 1, kit: 1 }, art: 3 });
    L.boxes.push(box(6.5 * S, 3.75 * S, 0.85, 0.85, 0));
  }
  if (L.floor === 5) {
    addItem({ kind: 'bed', x: 10 * S, z: 3 * S, rot: Math.PI });
    L.boxes.push(box(10 * S, 3 * S, 1.6, 2.2, Math.PI));
  }
}

/* 충돌용 선분 */
export function computeSegs(L) {
  const segs = [];
  const isVoid = (cx, cz) => !inGrid(cx, cz) || L.voidCell[idx(cx, cz)] === 1;
  const push = (t, x1, z1, x2, z2) => {
    if (t === 1) { segs.push({ x1, z1, x2, z2 }); return; }
    const g = DOOR_W / 2, mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    if (z1 === z2) { segs.push({ x1, z1, x2: mx - g, z2 }, { x1: mx + g, z1, x2, z2 }); }
    else { segs.push({ x1, z1, x2, z2: mz - g }, { x1, z1: mz + g, x2, z2 }); }
    if (t === 3 && !L.hiddenOpen) segs.push(z1 === z2 ? { x1: mx - g, z1, x2: mx + g, z2, kind: 'hidden' } : { x1, z1: mz - g, x2, z2: mz + g, kind: 'hidden' });
    if (t === 4) segs.push(z1 === z2 ? { x1: mx - g, z1, x2: mx + g, z2, kind: 'exit' } : { x1, z1: mz - g, x2, z2: mz + g, kind: 'exit' });
  };
  for (let cz = 0; cz <= H; cz++) for (let cx = 0; cx < W; cx++) {
    const t = L.hw[cz * W + cx];
    if (t === 0 || (isVoid(cx, cz - 1) && isVoid(cx, cz))) continue;
    push(t, cx * S, cz * S, cx * S + S, cz * S);
  }
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx <= W; cx++) {
    const t = L.vw[cz * (W + 1) + cx];
    if (t === 0 || (isVoid(cx - 1, cz) && isVoid(cx, cz))) continue;
    push(t, cx * S, cz * S, cx * S, cz * S + S);
  }
  // 숨은 문이 열렸으면 계단 통로 벽
  if (L.hidden && L.hiddenOpen) {
    const p = stairFrame(L.hidden);
    const g = DOOR_W / 2;
    const a = (u, v) => ({ x: p.ox + p.ax * u + p.nx * v, z: p.oz + p.az * u + p.nz * v });
    const s1 = a(-g, 0), s2 = a(-g, 6), s3 = a(g, 0), s4 = a(g, 6);
    segs.push({ x1: s1.x, z1: s1.z, x2: s2.x, z2: s2.z }, { x1: s3.x, z1: s3.z, x2: s4.x, z2: s4.z }, { x1: s2.x, z1: s2.z, x2: s4.x, z2: s4.z });
  }
  if (L.stairs) {
    const st = L.stairs;
    if (st.up) segs.push({ x1: st.x0, z1: st.up.z1, x2: st.x1, z2: st.up.z1 }, { x1: st.x1 + 0.4, z1: st.up.z0, x2: st.x1 + 0.4, z2: st.up.z1 });
    if (st.down) segs.push({ x1: st.x0, z1: st.down.z0, x2: st.x1, z2: st.down.z0 }, { x1: st.x1 + 0.4, z1: st.down.z0, x2: st.x1 + 0.4, z2: st.down.z1 });
  }
  L.segs = segs;
}

// 계단 위에 서 있으면 발밑 높이 (올라가는 계단 +, 내려가는 계단 -)
export function floorY(L, x, z) {
  const st = L && L.stairs;
  if (!st || x < st.x0) return 0;
  const t = Math.min(1, (x - st.x0) / (st.x1 - st.x0));
  if (st.up && z >= st.up.z0 && z <= st.up.z1) return t * RISE;
  if (st.down && z >= st.down.z0 && z <= st.down.z1) return -t * RISE;
  return 0;
}

// 숨은 문 위치: 문 가운데(ox,oz), 벽을 따라가는 방향(ax,az), 바깥으로 나가는 방향(nx,nz)
export function stairFrame(h) {
  const c = center(h.cx, h.cz);
  const nx = DX[h.dir], nz = DZ[h.dir];
  return { ox: c.x + nx * S / 2, oz: c.z + nz * S / 2, nx, nz, ax: -nz, az: nx };
}

/* ───────────── 그리기 ───────────── */
const MATS = {};
function mats(theme) {
  if (MATS[theme]) return MATS[theme];
  const P = TX.PALETTE[theme];
  const brass = theme === 'brass';
  MATS[theme] = {
    wall: new THREE.MeshLambertMaterial({ map: TX.wallTex(theme) }),
    floor: new THREE.MeshPhongMaterial({ map: TX.marbleTex(theme), shininess: 60, specular: 0x2a2620 }),
    ceil: new THREE.MeshLambertMaterial({ map: TX.ceilTex(theme) }),
    gold: new THREE.MeshPhongMaterial({ color: brass ? 0xa98236 : 0x6f7d52, shininess: 70, specular: 0x6a5530 }),
    wood: new THREE.MeshLambertMaterial({ color: brass ? 0x2b1a0e : 0x1a1610 }),
    woodLight: new THREE.MeshLambertMaterial({ color: brass ? 0x4a2e17 : 0x2c2a20 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x0b0806 }),
    velvet: new THREE.MeshLambertMaterial({ color: brass ? 0x3e1012 : 0x10302a }),
    glass: new THREE.MeshPhongMaterial({ color: 0x9fc4c4, transparent: true, opacity: 0.16, shininess: 120, specular: 0xffffff, depthWrite: false }),
    stone: new THREE.MeshLambertMaterial({ color: brass ? 0x3d362d : 0x283230 }),
    globe: new THREE.MeshBasicMaterial({ color: P.lamp }),
    paper: new THREE.MeshLambertMaterial({ map: TX.noteTex(), side: THREE.DoubleSide }),
    black: new THREE.MeshLambertMaterial({ color: 0x040404 }),
    pale: new THREE.MeshLambertMaterial({ color: 0x8a8070 }),
    leather: new THREE.MeshLambertMaterial({ color: 0x3a2412 }),
    rug: new THREE.MeshLambertMaterial({ map: TX.rugTex(theme) }),
    linen: new THREE.MeshLambertMaterial({ color: 0xd8d0bc }),
    paint: Array.from({ length: 6 }, (_, i) => new THREE.MeshLambertMaterial({ map: TX.paintingTex(i, theme) })),
    sculpt: new THREE.MeshPhongMaterial({ color: brass ? 0x8c6a2c : 0x4d6a5a, shininess: 90, specular: 0x887744 }),
    exitGlow: new THREE.MeshBasicMaterial({ color: 0xfff3dc }),
    stairDark: new THREE.MeshLambertMaterial({ color: 0x15110c }),
    mapPaper: new THREE.MeshLambertMaterial({ map: TX.mapPaperTex(), side: THREE.DoubleSide }),
  };
  return MATS[theme];
}

const G_BOX = new THREE.BoxGeometry(1, 1, 1);
const G_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const G_SPH = new THREE.SphereGeometry(0.5, 14, 10);
const G_PLANE = new THREE.PlaneGeometry(1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// 같은 재질끼리 하나로 합쳐서 그리기 호출 줄이기
class Batch {
  constructor() { this.map = new Map(); }
  add(mat, geo, base, lx, ly, lz, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const c = Math.cos(base.rot || 0), s = Math.sin(base.rot || 0);
    _v.set(base.x + lx * c + lz * s, (base.y || 0) + ly, base.z - lx * s + lz * c);
    _e.set(rx, (base.rot || 0) + ry, rz);
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    _m.compose(_v, _q, _s);
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(_m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(g);
  }
  flush(group) {
    for (const [mat, list] of this.map) {
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.map.clear();
  }
}

// 월드 좌표로 UV를 매기는 상자 (벽지가 이어 보이게)
class WallGeo {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    const o = this.p.length / 3;
    for (const v of [a, b, c, d]) this.p.push(v[0], v[1], v[2]);
    for (let k = 0; k < 4; k++) this.n.push(n[0], n[1], n[2]);
    this.u.push(...ua, ...ub, ...uc, ...ud);
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  box(x0, y0, z0, x1, y1, z1) {
    const V = (y) => y / WALL_H;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0 / 2, V(y0)], [x1 / 2, V(y0)], [x1 / 2, V(y1)], [x0 / 2, V(y1)]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [-x1 / 2, V(y0)], [-x0 / 2, V(y0)], [-x0 / 2, V(y1)], [-x1 / 2, V(y1)]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [-z1 / 2, V(y0)], [-z0 / 2, V(y0)], [-z0 / 2, V(y1)], [-z1 / 2, V(y1)]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0 / 2, V(y0)], [z1 / 2, V(y0)], [z1 / 2, V(y1)], [z0 / 2, V(y1)]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 / 2, 0.66], [x1 / 2, 0.66], [x1 / 2, 0.66], [x0 / 2, 0.66]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    return g;
  }
}

export function buildFloor(L, taken) {
  const M = mats(L.theme);
  const P = TX.PALETTE[L.theme];
  const group = new THREE.Group();
  const view = { group, anchors: [], anims: [], itemMeshes: new Map(), elevDoors: null, hiddenPanel: null, eyes: null };
  const batch = new Batch();
  const walls = new WallGeo();
  const T = WALL_T / 2;
  const isVoid = (cx, cz) => !inGrid(cx, cz) || L.voidCell[idx(cx, cz)] === 1;

  const doorway = (t, x1, z1, x2, z2, hor) => {
    const g = DOOR_W / 2;
    if (hor) {
      const mx = (x1 + x2) / 2, z = z1;
      walls.box(x1 - T, 0, z - T, mx - g, WALL_H, z + T);
      walls.box(mx + g, 0, z - T, x2 + T, WALL_H, z + T);
      walls.box(mx - g, DOOR_H, z - T, mx + g, WALL_H, z + T);
      const base = { x: mx, z, rot: 0 };
      batch.add(M.gold, G_BOX, base, -g - 0.06, DOOR_H / 2, 0, 0.14, DOOR_H, WALL_T + 0.1);
      batch.add(M.gold, G_BOX, base, g + 0.06, DOOR_H / 2, 0, 0.14, DOOR_H, WALL_T + 0.1);
      batch.add(M.gold, G_BOX, base, 0, DOOR_H + 0.07, 0, DOOR_W + 0.26, 0.14, WALL_T + 0.1);
    } else {
      const mz = (z1 + z2) / 2, x = x1;
      walls.box(x - T, 0, z1 - T, x + T, WALL_H, mz - g);
      walls.box(x - T, 0, mz + g, x + T, WALL_H, z2 + T);
      walls.box(x - T, DOOR_H, mz - g, x + T, WALL_H, mz + g);
      const base = { x, z: mz, rot: Math.PI / 2 };
      batch.add(M.gold, G_BOX, base, -g - 0.06, DOOR_H / 2, 0, 0.14, DOOR_H, WALL_T + 0.1);
      batch.add(M.gold, G_BOX, base, g + 0.06, DOOR_H / 2, 0, 0.14, DOOR_H, WALL_T + 0.1);
      batch.add(M.gold, G_BOX, base, 0, DOOR_H + 0.07, 0, DOOR_W + 0.26, 0.14, WALL_T + 0.1);
    }
  };
  for (let cz = 0; cz <= H; cz++) for (let cx = 0; cx < W; cx++) {
    const t = L.hw[cz * W + cx];
    if (t === 0 || (isVoid(cx, cz - 1) && isVoid(cx, cz))) continue;
    const x1 = cx * S, x2 = x1 + S, z = cz * S;
    if (t === 1) walls.box(x1 - T, 0, z - T, x2 + T, WALL_H, z + T);
    else doorway(t, x1, z, x2, z, true);
  }
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx <= W; cx++) {
    const t = L.vw[cz * (W + 1) + cx];
    if (t === 0 || (isVoid(cx - 1, cz) && isVoid(cx, cz))) continue;
    const z1 = cz * S, z2 = z1 + S, x = cx * S;
    if (t === 1) walls.box(x - T, 0, z1 - T, x + T, WALL_H, z2 + T);
    else doorway(t, x, z1, x, z2, false);
  }
  const wallMesh = new THREE.Mesh(walls.build(), M.wall);
  wallMesh.matrixAutoUpdate = false;
  group.add(wallMesh);

  // 바닥, 천장
  const st = L.stairs;
  const rects = st && st.down
    ? [[0, 0, W * S, st.down.z0], [0, st.down.z0, st.x0, st.down.z1], [st.x1 + 0.4, st.down.z0, W * S, st.down.z1], [0, st.down.z1, W * S, H * S]]
    : [[0, 0, W * S, H * S]];
  for (const [ax, az, bx, bz] of rects) {
    const fl = new THREE.PlaneGeometry(bx - ax, bz - az);
    const uv = fl.attributes.uv, pos = fl.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + (ax + bx) / 2) / 2, (-pos.getY(i) + (az + bz) / 2) / 2);
    const fm = new THREE.Mesh(fl, M.floor);
    fm.rotation.x = -Math.PI / 2;
    fm.position.set((ax + bx) / 2, 0, (az + bz) / 2);
    group.add(fm);
  }
  const cl = new THREE.PlaneGeometry(W * S, H * S);
  scaleUV(cl, (W * S) / 4, (H * S) / 4);
  const ceilMesh = new THREE.Mesh(cl, M.ceil);
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set((W * S) / 2, WALL_H, (H * S) / 2);
  group.add(ceilMesh);

  // 꾸밈
  for (const d of L.decor) {
    if (d.type === 'painting') {
      const w = 2.0, h = 2.6, y = 3.4;
      batch.add(M.paint[d.seed], G_PLANE, d, 0, y, 0.035, w, h, 1);
      batch.add(M.gold, G_BOX, d, 0, y + h / 2 + 0.06, 0.02, w + 0.24, 0.12, 0.08);
      batch.add(M.gold, G_BOX, d, 0, y - h / 2 - 0.06, 0.02, w + 0.24, 0.12, 0.08);
      batch.add(M.gold, G_BOX, d, -w / 2 - 0.06, y, 0.02, 0.12, h, 0.08);
      batch.add(M.gold, G_BOX, d, w / 2 + 0.06, y, 0.02, 0.12, h, 0.08);
      if (L.theme === 'bronze') batch.add(M.gold, G_BOX, d, 0.3, y - h / 2 - 0.42, 0.02, 0.4, 0.14, 0.04, 0, 0, 0.12);
      else batch.add(M.gold, G_BOX, d, 0, y - h / 2 - 0.4, 0.02, 0.36, 0.13, 0.04);
    } else if (d.type === 'sconce') {
      batch.add(M.gold, G_BOX, d, 0, 3.6, 0.06, 0.14, 0.44, 0.06);
      batch.add(M.gold, G_BOX, d, 0, 3.45, 0.24, 0.06, 0.06, 0.38);
      batch.add(M.globe, G_SPH, d, 0, 3.7, 0.42, 0.26, 0.34, 0.26);
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      view.anchors.push({ x: d.x + 0.6 * s, y: 3.7, z: d.z + 0.6 * c, color: P.lamp, power: 1 });
    } else if (d.type === 'sculpture' || d.type === 'pedestal') {
      const big = d.type === 'sculpture';
      const pw = big ? 1.2 : 0.7, ph = big ? 1.3 : 1.0, ks = big ? 2.4 : 1;
      batch.add(M.stone, G_BOX, d, 0, ph / 2, 0, pw, ph, pw);
      batch.add(M.gold, G_BOX, d, 0, ph + 0.02, 0, pw + 0.08, 0.05, pw + 0.08);
      const kinds = [new THREE.TorusKnotGeometry(0.22, 0.07, 60, 8), new THREE.IcosahedronGeometry(0.3, 0), new THREE.TorusGeometry(0.25, 0.06, 8, 24), new THREE.OctahedronGeometry(0.32, 0)];
      const g = kinds[d.seed % kinds.length];
      batch.add(M.sculpt, g, d, 0, ph + 0.45 * ks, 0, ks, 1.3 * ks, ks, 0.4, 0, 0.3);
      kinds.forEach((k) => k.dispose());
      if (big) for (let k = 0; k < 6; k++) { // 둘레 줄 기둥
        const a = (k / 6) * Math.PI * 2;
        batch.add(M.gold, G_CYL, d, Math.cos(a) * 1.6, 0.5, Math.sin(a) * 1.6, 0.06, 1.0, 0.06);
        batch.add(M.gold, G_SPH, d, Math.cos(a) * 1.6, 1.02, Math.sin(a) * 1.6, 0.1, 0.1, 0.1);
        const b = a + Math.PI / 6;
        batch.add(M.velvet, G_CYL, d, Math.cos(b) * 1.39, 0.86, Math.sin(b) * 1.39, 0.03, 1.6, 0.03, 0, Math.PI / 2 - b, Math.PI / 2);
      }
    } else if (d.type === 'bench') {
      batch.add(M.velvet, G_BOX, d, 0, 0.46, 0, 1.8, 0.14, 0.5);
      batch.add(M.wood, G_BOX, d, 0, 0.36, 0, 1.84, 0.06, 0.54);
      for (const [a, b] of [[-0.8, -0.2], [0.8, -0.2], [-0.8, 0.2], [0.8, 0.2]]) batch.add(M.gold, G_CYL, d, a, 0.17, b, 0.05, 0.34, 0.05);
    } else if (d.type === 'chandelier') {
      const cy = WALL_H - 1.9;
      batch.add(M.gold, G_CYL, d, 0, (WALL_H + cy) / 2 + 0.4, 0, 0.05, WALL_H - cy - 0.8, 0.05);
      batch.add(M.gold, new THREE.TorusGeometry(1.2, 0.05, 6, 28), d, 0, cy, 0, 1, 1, 1, Math.PI / 2);
      batch.add(M.gold, new THREE.TorusGeometry(0.6, 0.04, 6, 20), d, 0, cy + 0.45, 0, 1, 1, 1, Math.PI / 2);
      for (let k = 0; k < 12; k++) batch.add(M.globe, G_SPH, d, Math.cos(k * 0.5236) * 1.2, cy + 0.12, Math.sin(k * 0.5236) * 1.2, 0.12, 0.17, 0.12);
      for (let k = 0; k < 6; k++) batch.add(M.globe, G_SPH, d, Math.cos(k * 1.047) * 0.6, cy + 0.55, Math.sin(k * 1.047) * 0.6, 0.1, 0.14, 0.1);
      view.anchors.push({ x: d.x, y: cy - 0.3, z: d.z, color: P.lamp, power: 1.6 });
    } else if (d.type === 'rug') {
      batch.add(M.rug, G_PLANE, { x: d.x, z: d.z, rot: 0 }, 0, 0.012, 0, d.w, d.d, 1, -Math.PI / 2);
    } else if (d.type === 'sofa') {
      batch.add(M.velvet, G_BOX, d, 0, 0.3, 0, 2, 0.45, 0.85);
      batch.add(M.velvet, G_BOX, d, 0, 0.75, -0.36, 2, 0.6, 0.18);
      batch.add(M.velvet, G_BOX, d, -0.95, 0.5, 0, 0.16, 0.45, 0.85);
      batch.add(M.velvet, G_BOX, d, 0.95, 0.5, 0, 0.16, 0.45, 0.85);
      batch.add(M.gold, G_BOX, d, 0, 0.06, 0, 2.02, 0.08, 0.87);
    } else if (d.type === 'statue') {
      batch.add(M.stone, G_BOX, d, 0, 0.6, 0, 0.8, 1.2, 0.8);
      batch.add(M.pale, G_CYL, d, 0, 1.75, 0, 0.42, 1.1, 0.42);
      batch.add(M.pale, G_SPH, d, 0, 2.5, 0, 0.36, 0.42, 0.36);
    }
  }

  // 물건
  for (const it of L.items) {
    const gone = taken && taken.has(it.id);
    if (it.kind === 'bag') {
      if (gone) continue;
      const m = new THREE.Group();
      const b = new THREE.Mesh(G_BOX, M.leather); b.scale.set(0.56, 0.34, 0.3); b.position.y = 0.17; m.add(b);
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 6, 16, Math.PI), M.gold); h.position.y = 0.34; m.add(h);
      m.position.set(it.x, 0, it.z); m.rotation.y = it.rot;
      group.add(m); view.itemMeshes.set(it.id, m);
    } else if (it.kind === 'cabinet') {
      batch.add(M.wood, G_BOX, it, 0, 0.85, 0, 1.15, 1.7, 0.48);
      for (let k = 0; k < 3; k++) {
        batch.add(M.woodLight, G_BOX, it, 0, 0.35 + k * 0.48, 0.245, 1.0, 0.38, 0.02);
        batch.add(M.gold, G_BOX, it, 0, 0.35 + k * 0.48, 0.27, 0.16, 0.04, 0.03);
      }
      batch.add(M.gold, G_BOX, it, 0, 1.72, 0, 1.2, 0.05, 0.52);
    } else if (it.kind === 'case') {
      batch.add(M.wood, G_BOX, it, 0, 0.45, 0, 0.8, 0.9, 0.8);
      batch.add(M.gold, G_BOX, it, 0, 0.92, 0, 0.84, 0.05, 0.84);
      batch.add(M.glass, G_BOX, it, 0, 1.3, 0, 0.72, 0.72, 0.72);
      batch.add(M.gold, G_BOX, it, 0, 1.67, 0, 0.76, 0.03, 0.76);
      if (!gone) {
        const geos = [new THREE.TorusGeometry(0.14, 0.05, 8, 18), new THREE.SphereGeometry(0.16, 16, 12), new THREE.ConeGeometry(0.13, 0.36, 7), new THREE.DodecahedronGeometry(0.17, 0)];
        const mat = it.art === 1 ? new THREE.MeshBasicMaterial({ map: TX.eyeTex() }) : M.sculpt;
        const o = new THREE.Mesh(geos[it.art % 4], mat);
        o.position.set(it.x, 1.24, it.z);
        o.rotation.set(0.3, it.rot + 1.2, 0.2);
        group.add(o); view.itemMeshes.set(it.id, o);
        geos.forEach((g, i) => { if (i !== it.art % 4) g.dispose(); });
      }
    } else if (it.kind === 'map') {
      if (gone) continue;
      const m = new THREE.Mesh(G_PLANE, M.mapPaper);
      m.scale.set(0.46, 0.34, 1);
      m.rotation.set(-Math.PI / 2, 0, it.rot);
      m.position.set(it.x, (it.y || 0) + 0.014, it.z);
      group.add(m); view.itemMeshes.set(it.id, m);
    } else if (it.kind === 'note') {
      if (gone) continue;
      const m = new THREE.Mesh(G_PLANE, M.paper);
      m.scale.set(0.24, 0.3, 1);
      m.rotation.set(-Math.PI / 2, 0, it.rot);
      m.position.set(it.x, (it.y || 0) + 0.012, it.z);
      group.add(m); view.itemMeshes.set(it.id, m);
    } else if (it.kind === 'craft') {
      batch.add(M.woodLight, G_BOX, it, 0, 0.8, 0, 1.8, 0.08, 1.1);
      for (const [a, b] of [[-0.8, -0.45], [0.8, -0.45], [-0.8, 0.45], [0.8, 0.45]]) batch.add(M.wood, G_CYL, it, a, 0.4, b, 0.08, 0.8, 0.08);
      batch.add(M.paper, G_PLANE, it, 0.1, 0.845, 0, 0.42, 0.3, 1, -Math.PI / 2);
      for (let k = 0; k < 5; k++) batch.add(new THREE.MeshLambertMaterial({ color: [0xb23a3a, 0x3a6ab2, 0xd9b02a, 0x4a9a52, 0x8a4ab2][k] }), G_CYL, it, -0.5 + k * 0.07, 0.85, 0.32, 0.03, 0.18, 0.03, Math.PI / 2, 0, 0);
    } else if (it.kind === 'fire') {
      batch.add(M.stone, G_BOX, it, 0, 0.75, 0, 2.2, 1.5, 0.7);
      batch.add(M.black, G_BOX, it, 0, 0.55, 0.12, 1.2, 0.9, 0.5);
      batch.add(M.gold, G_BOX, it, 0, 1.55, 0.05, 2.4, 0.1, 0.85);
      const fire = new THREE.Group();
      const fmat = new THREE.SpriteMaterial({ map: TX.flameTex(), color: 0x5fe0b0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const flames = [];
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Sprite(fmat);
        sp.position.set(-0.4 + k * 0.2, 0.45, 0.42);
        sp.scale.set(0.32, 0.6, 1);
        fire.add(sp); flames.push(sp);
      }
      fire.position.set(it.x, 0, it.z); fire.rotation.y = it.rot;
      group.add(fire);
      const c = Math.cos(it.rot), s = Math.sin(it.rot);
      view.anchors.push({ x: it.x + 1.1 * s, y: 1.0, z: it.z + 1.1 * c, color: 0x6fe8b8, power: 2.4, fixed: true });
      view.anims.push((t) => flames.forEach((f, k) => { f.scale.y = 0.5 + 0.18 * Math.sin(t * 9 + k * 1.7); f.material.opacity = 0.75 + 0.2 * Math.sin(t * 13 + k); }));
    } else if (it.kind === 'bed') {
      batch.add(M.wood, G_BOX, it, 0, 0.3, 0, 1.6, 0.4, 2.2);
      batch.add(M.linen, G_BOX, it, 0, 0.6, 0.05, 1.5, 0.22, 2.05);
      batch.add(M.linen, G_BOX, it, -0.35, 0.78, -0.75, 0.55, 0.14, 0.35);
      batch.add(M.linen, G_BOX, it, 0.35, 0.78, -0.75, 0.55, 0.14, 0.35);
      batch.add(M.wood, G_BOX, it, 0, 0.9, -1.1, 1.7, 1.4, 0.1);
      batch.add(M.velvet, G_BOX, it, 0, 0.73, 0.5, 1.52, 0.04, 1.0);
    }
  }

  buildSpecials(L, view, batch, M, P);
  buildStairs(L, view, batch, M);
  batch.flush(group);
  return view;
}

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

function buildSpecials(L, view, batch, M, P) {
  const group = view.group;
  // 엘리베이터
  if (L.floor !== 0) {
    const ex = ELEV.cx * S, ez = ELEV.cz * S;
    const mx = ex + S / 2;
    const doorMat = new THREE.MeshPhongMaterial({ color: 0xa07a34, shininess: 90, specular: 0x886633 });
    const dl = new THREE.Mesh(G_BOX, doorMat), dr = new THREE.Mesh(G_BOX, doorMat);
    for (const d of [dl, dr]) { d.scale.set(DOOR_W / 2, DOOR_H, 0.06); group.add(d); }
    view.elevDoors = {
      set(open) {
        const o = open * (DOOR_W / 2 - 0.05);
        dl.position.set(mx - DOOR_W / 4 - o, DOOR_H / 2, ez);
        dr.position.set(mx + DOOR_W / 4 + o, DOOR_H / 2, ez);
      },
    };
    view.elevDoors.set(1);
    // 안쪽 버튼판
    const panel = new THREE.Mesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.elevPanelTex(TOP, BOTTOM) }));
    const tex = panel.material.map.image;
    panel.scale.set(0.56, 0.56 * (tex.height / tex.width), 1);
    panel.position.set(ex + S - WALL_T / 2 - 0.02, 1.5, ez + S / 2 + 0.5);
    panel.rotation.y = -Math.PI / 2;
    group.add(panel);
    // 바깥 안내판
    const pl = new THREE.Mesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.plaqueTex(['관람객 라운지', '지하 1층'], 'lounge') }));
    pl.scale.set(0.8, 0.25, 1);
    pl.scale.set(1.2, 0.375, 1);
    pl.position.set(mx + DOOR_W / 2 + 1.3, 2.0, ez - WALL_T / 2 - 0.015);
    pl.rotation.y = Math.PI;
    group.add(pl);
    // 층 표시
    const fl = new THREE.Mesh(G_PLANE, new THREE.MeshBasicMaterial({ map: TX.plaqueTex([L.floor > 0 ? `${L.floor}` : `B${-L.floor}`], 'f' + L.floor) }));
    fl.scale.set(0.8, 0.26, 1);
    fl.position.set(mx, DOOR_H + 0.55, ez - WALL_T / 2 - 0.015);
    fl.rotation.y = Math.PI;
    group.add(fl);
    view.anchors.push({ x: mx, y: 5.0, z: ez + S / 2, color: 0xffd28a, power: 1.0, fixed: true });
  }

  const rooms = (k) => L.rooms.filter((r) => r.kind === k);
  // 「감정의 힘」: 벽 가득한 액자 속 입
  for (const r of rooms('mouth')) {
    const spots = hallWallSpots(L, r, 0.95, [1.3, 2.3, 3.3, 4.3, 5.3, 6.3, 7.2]);
    const frames = new THREE.InstancedMesh(G_BOX, M.gold, spots.length);
    const mouths = new THREE.InstancedMesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.mouthTex() }), spots.length);
    const dummy = new THREE.Object3D();
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.rot, 0); dummy.scale.set(0.74, 0.56, 0.06); dummy.updateMatrix();
      frames.setMatrixAt(i, dummy.matrix);
    });
    group.add(frames, mouths);
    const phases = spots.map(() => Math.random() * 6.28);
    const speeds = spots.map(() => 2 + Math.random() * 4);
    view.mouth = { r, spots, scream: 0 };
    view.anims.push((t, dt) => {
      const sc = view.mouth.scream;
      spots.forEach((s, i) => {
        const open = sc > 0 ? 1 + 0.06 * Math.sin(t * 30 + i) : 0.62 + 0.38 * Math.abs(Math.sin(t * speeds[i] + phases[i]));
        const c = Math.cos(s.rot), sn = Math.sin(s.rot);
        dummy.position.set(s.x + sn * 0.035, s.y, s.z + c * 0.035);
        dummy.rotation.set(0, s.rot, 0);
        dummy.scale.set(0.62, 0.46 * open, 1);
        dummy.updateMatrix();
        mouths.setMatrixAt(i, dummy.matrix);
      });
      mouths.instanceMatrix.needsUpdate = true;
    });
    // 바닥에서 꿈틀대는 것들 (여러 번 징수당한 관람객)
    const rnd = mulberry32(L.seed + 99);
    const bodies = [];
    for (let k = 0; k < 22; k++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), M.pale);
      b.rotation.z = Math.PI / 2; b.position.y = 0.22; g.add(b);
      for (const sx of [-0.06, 0.06]) {
        const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10), M.black);
        btn.rotation.x = Math.PI / 2; btn.position.set(0.62, 0.3, sx); btn.rotation.z = Math.PI / 2;
        g.add(btn);
      }
      g.position.set((r.x + 0.6 + rnd() * (r.w - 1.2)) * S, 0, (r.y + 0.6 + rnd() * (r.h - 1.2)) * S);
      g.rotation.y = rnd() * 6.28;
      group.add(g); bodies.push({ g, ph: rnd() * 6 });
    }
    view.anims.push((t) => bodies.forEach((o) => { o.g.children[0].scale.set(1 + 0.08 * Math.sin(t * 2 + o.ph), 1, 1); o.g.rotation.z = 0.05 * Math.sin(t * 1.3 + o.ph); }));
    signAbove(L, r, view, batch, M, 31);
    const hx = (r.x + r.w / 2) * S, hz = (r.y + r.h / 2) * S;
    view.anchors.push({ x: hx, y: 6, z: hz, color: 0xc08a5a, power: 1.4, fixed: true });
    for (const [ax, az] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) view.anchors.push({ x: hx + ax * K, y: 4.2, z: hz + az * K, color: 0xd07a5a, power: 1.0, fixed: true });
  }

  // 「빛나는 시선」: 세 벽을 덮은 눈
  for (const r of rooms('eyes')) {
    const lining = new THREE.MeshLambertMaterial({ color: 0x030303 });
    const x0 = r.x * S + WALL_T / 2 + 0.02, x1 = (r.x + r.w) * S - WALL_T / 2 - 0.02;
    const z0 = r.y * S + WALL_T / 2 + 0.02, z1 = (r.y + r.h) * S - WALL_T / 2 - 0.02;
    const addLine = (x, z, w, rot) => { const m = new THREE.Mesh(G_PLANE, lining); m.scale.set(w, WALL_H, 1); m.position.set(x, WALL_H / 2, z); m.rotation.y = rot; group.add(m); };
    addLine((x0 + x1) / 2, z0, x1 - x0, 0);
    addLine(x0, (z0 + z1) / 2, z1 - z0, Math.PI / 2);
    addLine(x1, (z0 + z1) / 2, z1 - z0, -Math.PI / 2);
    // 두 개씩 짝지어 박힌 눈 (항상 손님 쪽을 보는 원판)
    const pts = [];
    const rr = mulberry32(L.seed + 7);
    const pair = (x, y, z, ax, az) => {
      const s = 0.75 + rr() * 0.5, gap = 0.085 * s, jx = (rr() - 0.5) * 0.12, jy = (rr() - 0.5) * 0.12;
      pts.push([x + ax * (jx - gap), y + jy, z + az * (jx - gap), s], [x + ax * (jx + gap), y + jy, z + az * (jx + gap), s]);
    };
    for (let y = 0.4; y < 6.2; y += 0.32) {
      const off = (Math.round(y / 0.32) % 2) * 0.25;
      for (let x = x0 + 0.25 + off; x < x1 - 0.2; x += 0.5) pair(x, y, z0 + 0.06, 1, 0);
      for (let z = z0 + 0.25 + off; z < z1 - 0.2; z += 0.5) { pair(x0 + 0.06, y, z, 0, 1); pair(x1 - 0.06, y, z, 0, 1); }
    }
    const eyeGeo = new THREE.PlaneGeometry(0.17, 0.17);
    const eyes = new THREE.InstancedMesh(eyeGeo, new THREE.MeshBasicMaterial({ map: TX.eyeDiscTex(), alphaTest: 0.5 }), pts.length);
    const dummy = new THREE.Object3D();
    const target = new THREE.Vector3();
    let acc = 1;
    view.eyes = { r, mesh: eyes };
    view.anims.push((t, dt, ctx) => {
      acc += dt;
      if (acc < 0.1) return;
      acc = 0;
      target.set(ctx.px, ctx.py, ctx.pz);
      pts.forEach((p, i) => {
        dummy.position.set(p[0], p[1], p[2]);
        dummy.lookAt(target);
        dummy.scale.setScalar(p[3]);
        dummy.updateMatrix();
        eyes.setMatrixAt(i, dummy.matrix);
      });
      eyes.instanceMatrix.needsUpdate = true;
    });
    group.add(eyes);
    signAbove(L, r, view, batch, M, 47);
    view.anchors.push({ x: (r.x + r.w / 2) * S, y: 5.5, z: (r.y + r.h / 2) * S, color: 0x8fa8ff, power: 1.0, fixed: true });
  }

  // 게스트룸 등불
  for (const r of rooms('guest')) {
    view.anchors.push({ x: (r.x + r.w / 2) * S + 1.2, y: 1.6, z: (r.y + r.h / 2) * S - 1.2, color: 0xffc47a, power: 1.0, fixed: true });
  }
  // 라운지: 천장등 + 소파 옆 스탠드
  for (const r of rooms('lounge')) {
    const { fx, fz } = L.lounge;
    const shade = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const [x, z] of [[fx + 1.15, fz - 5.1], [fx + 1.15, fz + 5.1], [fx + 13.75, fz - 2.8], [fx + 13.75, fz + 2.8]]) {
      const b = { x, z, rot: 0 };
      batch.add(M.gold, G_CYL, b, 0, 0.75, 0, 0.05, 1.5, 0.05);
      batch.add(M.gold, G_CYL, b, 0, 0.03, 0, 0.36, 0.06, 0.36);
      batch.add(shade, new THREE.CylinderGeometry(0.14, 0.26, 0.32, 12, 1, true), b, 0, 1.62, 0);
      view.anchors.push({ x, y: 1.55, z, color: 0xffc78a, power: 0.9, fixed: true });
    }
  }
  // 0층 현관
  if (L.floor === 0) {
    const chx = 6.5 * S, chz = 5.5 * S, cy = WALL_H - 1.9;
    view.anchors.push({ x: chx, y: cy - 0.3, z: chz, color: 0xffe2b0, power: 1.8, fixed: true });
    const ch = { x: chx, z: chz, rot: 0 };
    batch.add(M.gold, G_CYL, ch, 0, (WALL_H + cy) / 2, 0, 0.05, WALL_H - cy, 0.05);
    batch.add(M.gold, new THREE.TorusGeometry(1.2, 0.05, 6, 28), ch, 0, cy, 0, 1, 1, 1, Math.PI / 2);
    for (let k = 0; k < 12; k++) batch.add(M.globe, G_SPH, ch, Math.cos(k * 0.5236) * 1.2, cy + 0.12, Math.sin(k * 0.5236) * 1.2, 0.12, 0.17, 0.12);
  }

  // 숨은 문 + 계단 통로
  if (L.hidden) {
    const p = stairFrame(L.hidden);
    const rot = Math.atan2(p.nx, p.nz); // 로컬 +z가 바깥쪽
    const base = { x: p.ox, z: p.oz, rot };
    const g = DOOR_W / 2;
    // 통로: 바닥 계단, 양옆 벽, 천장
    const down = L.floor === 1 || (L.floor === 0 && false);
    for (let k = 0; k < 10; k++) {
      const y = down ? -0.25 * k : 0.25 * k;
      batch.add(M.stairDark, G_BOX, base, 0, y - 0.12 + (down ? 0 : 0.12), 0.5 + k * 0.55, DOOR_W, 0.24, 0.55);
    }
    batch.add(M.stairDark, G_BOX, base, -g - 0.06, 1.2, 3, 0.12, 6, 6);
    batch.add(M.stairDark, G_BOX, base, g + 0.06, 1.2, 3, 0.12, 6, 6);
    batch.add(M.stairDark, G_BOX, base, 0, DOOR_H + (down ? 0 : 2.5), 3, DOOR_W + 0.3, 0.12, 6);
    batch.add(M.dark, G_BOX, base, 0, 1, 6.05, DOOR_W + 0.3, 6, 0.1);
    view.stairLight = { x: p.ox + p.nx * 3.5, y: 1.6, z: p.oz + p.nz * 3.5, color: 0xffd9a0, power: 0.8, fixed: true };
    if (L.hiddenOpen) view.anchors.push(view.stairLight);
    if (L.floor !== 0) {
      // 벽과 똑같이 생긴 판
      const pm = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.02, DOOR_H, WALL_T * 0.9), M.wall);
      pm.position.set(p.ox, DOOR_H / 2, p.oz);
      pm.rotation.y = rot;
      // 벽지 무늬가 판에도 이어지게 UV 조정
      const uv = pm.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (DOOR_W / 2), uv.getY(i) * (DOOR_H / WALL_H));
      group.add(pm);
      view.hiddenPanel = pm;
      if (L.hiddenOpen) pm.position.y = DOOR_H * 1.5;
    }
  }

  // 비상문
  if (L.exitDoor) {
    const p = stairFrame(L.exitDoor);
    const rot = Math.atan2(p.nx, p.nz);
    const base = { x: p.ox, z: p.oz, rot };
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x2c1a0c });
    batch.add(doorMat, G_BOX, base, -DOOR_W / 4, DOOR_H / 2, 0, DOOR_W / 2 - 0.02, DOOR_H, 0.1);
    batch.add(doorMat, G_BOX, base, DOOR_W / 4, DOOR_H / 2, 0, DOOR_W / 2 - 0.02, DOOR_H, 0.1);
    batch.add(M.gold, G_BOX, base, -0.12, 1.2, -0.08, 0.04, 0.3, 0.04);
    batch.add(M.gold, G_BOX, base, 0.12, 1.2, -0.08, 0.04, 0.3, 0.04);
    batch.add(M.exitGlow, G_BOX, base, 0, DOOR_H / 2, 0.06, DOOR_W, DOOR_H, 0.02);
    const sign = new THREE.Mesh(G_PLANE, new THREE.MeshBasicMaterial({ map: TX.exitSignTex() }));
    sign.scale.set(0.9, 0.34, 1);
    sign.position.set(p.ox - p.nx * (WALL_T / 2 + 0.02), DOOR_H + 0.55, p.oz - p.nz * (WALL_T / 2 + 0.02));
    sign.rotation.y = rot + Math.PI;
    group.add(sign);
    view.anchors.push({ x: p.ox - p.nx * 1.2, y: 2.8, z: p.oz - p.nz * 1.2, color: 0xffe6c4, power: 1.1, fixed: true });
    // 문틈 빛
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.glowTex(), color: 0xfff1d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    glow.scale.set(3, 4, 1);
    glow.position.set(p.ox - p.nx * 0.1, 1.6, p.oz - p.nz * 0.1);
    group.add(glow);
  }
}

// 계단실: 올라가는 계단(북쪽), 내려가는 계단(남쪽), 층 표지
function buildStairs(L, view, batch, M) {
  const st = L.stairs;
  if (!st) return;
  const n = 20, run = (st.x1 - st.x0) / n, rise = RISE / n;
  const wallX = W * S - WALL_T / 2;
  const sign = (text, key, x, y, z, rot) => {
    const m = new THREE.Mesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.plaqueTex([text], key) }));
    m.scale.set(1.5, 0.47, 1); m.position.set(x, y, z); m.rotation.y = rot; view.group.add(m);
  };
  const rail = (z, yAt, out) => { // 난간: 기둥 + 손잡이
    for (let k = 0; k <= 10; k++) {
      const x = st.x0 + (st.x1 - st.x0) * (k / 10), y = yAt(x);
      batch.add(M.gold, G_CYL, { x, z, rot: 0 }, 0, y + 0.5, 0, 0.06, 1.0, 0.06);
    }
    const a = Math.atan2(yAt(st.x1) - yAt(st.x0), st.x1 - st.x0), len = Math.hypot(st.x1 - st.x0, yAt(st.x1) - yAt(st.x0));
    batch.add(M.gold, G_BOX, { x: (st.x0 + st.x1) / 2, z, rot: 0 }, 0, (yAt(st.x0) + yAt(st.x1)) / 2 + 1.02, 0, len, 0.08, 0.1, 0, 0, a);
    if (out) batch.add(M.wood, G_BOX, { x: (st.x0 + st.x1) / 2, z, rot: 0 }, 0, (yAt(st.x0) + yAt(st.x1)) / 2 - (out > 0 ? 0 : 0.2), 0, len, 0.3, 0.08, 0, 0, a);
  };
  if (st.up) {
    const zc = (st.up.z0 + st.up.z1) / 2, wd = st.up.z1 - st.up.z0;
    for (let k = 0; k < n; k++) {
      const x = st.x0 + (k + 0.5) * run, top = (k + 1) * rise;
      batch.add(M.woodLight, G_BOX, { x, z: zc, rot: 0 }, 0, top / 2, 0, run, top, wd);
      batch.add(M.gold, G_BOX, { x: x - run / 2 + 0.03, z: zc, rot: 0 }, 0, top - 0.01, 0, 0.06, 0.03, wd);
    }
    batch.add(M.woodLight, G_BOX, { x: (st.x1 + wallX) / 2, z: zc, rot: 0 }, 0, RISE / 2, 0, wallX - st.x1, RISE, wd); // 층계참
    batch.add(M.black, G_PLANE, { x: wallX - 0.01, z: zc, rot: -Math.PI / 2 }, 0, RISE + 1.8, 0, wd, 3.6, 1); // 위로 이어지는 어둠
    rail(st.up.z1, (x) => Math.min(1, (x - st.x0) / (st.x1 - st.x0)) * RISE, 1);
    sign(`▲ ${floorLabel(st.up.to)}`, 'up' + st.up.to, st.x0 + 1.2, 2.6, st.up.z0 - 0.44 + WALL_T / 2 + 0.02, 0);
    view.anchors.push({ x: (st.x0 + st.x1) / 2, y: RISE + 1.6, z: zc, color: 0xffcf8a, power: 0.9, fixed: true });
  }
  if (st.down) {
    const zc = (st.down.z0 + st.down.z1) / 2, wd = st.down.z1 - st.down.z0;
    const bottom = -RISE - 0.6;
    for (let k = 0; k < n; k++) {
      const x = st.x0 + (k + 0.5) * run, top = -(k + 1) * rise;
      batch.add(M.woodLight, G_BOX, { x, z: zc, rot: 0 }, 0, (top + bottom) / 2, 0, run, top - bottom, wd);
      batch.add(M.gold, G_BOX, { x: x - run / 2 + 0.03, z: zc, rot: 0 }, 0, top - 0.01, 0, 0.06, 0.03, wd);
    }
    // 구덩이 벽 (바닥 아래)
    const pit = (x, z, w, d) => batch.add(M.stairDark, G_BOX, { x, z, rot: 0 }, 0, bottom / 2, 0, w, -bottom, d);
    pit((st.x0 + st.x1 + 0.4) / 2, st.down.z0 - 0.05, st.x1 + 0.4 - st.x0, 0.1);
    pit((st.x0 + st.x1 + 0.4) / 2, st.down.z1 + 0.05, st.x1 + 0.4 - st.x0, 0.1);
    pit(st.x0 - 0.05, zc, 0.1, wd);
    batch.add(M.black, G_PLANE, { x: st.x1 + 0.39, z: zc, rot: -Math.PI / 2 }, 0, bottom / 2, 0, wd, -bottom, 1); // 아래로 이어지는 어둠
    rail(st.down.z0, () => 0, 0);
    sign(`▼ ${floorLabel(st.down.to)}`, 'dn' + st.down.to, st.x0 + 1.2, 2.6, st.down.z1 + 0.44 - WALL_T / 2 - 0.02, Math.PI);
    view.anchors.push({ x: (st.x0 + st.x1) / 2, y: 1.2, z: zc, color: 0xffcf8a, power: 0.8, fixed: true });
  }
  // 층계참 등불, 계단실 입구 표지
  view.anchors.push({ x: STAIR.cx * S + S, y: 5.5, z: (STAIR.cz + 1.5) * S, color: 0xffd9a0, power: 1.2, fixed: true });
  const ex = STAIR.cx * S - WALL_T / 2 - 0.02, ez = (STAIR.cz + 1.5) * S;
  const pl = new THREE.Mesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.plaqueTex(['계단'], 'stairs') }));
  pl.scale.set(1.6, 0.5, 1); pl.position.set(ex, DOOR_H + 0.8, ez); pl.rotation.y = -Math.PI / 2; view.group.add(pl);
}

// 큰 홀 안쪽 벽면을 따라 액자 자리 계산
function hallWallSpots(L, r, step, ys) {
  const out = [];
  for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) {
    for (let d = 0; d < 4; d++) {
      const t = getEdge(L, cx, cz, d);
      const nx = cx + DX[d], nz = cz + DZ[d];
      const inside = inGrid(nx, nz) && L.roomId[idx(nx, nz)] === r.id;
      if (inside) continue;
      const c = center(cx, cz), off = S / 2 - WALL_T / 2 - 0.04;
      for (let a = -S / 2 + step / 2 + 0.05; a < S / 2 - 0.05; a += step) {
        if (t === 2 && Math.abs(a) < DOOR_W / 2 + 0.25) continue;
        for (const y of ys) {
          if (t === 2 && y < DOOR_H + 0.3 && Math.abs(a) < DOOR_W / 2 + 0.25) continue;
          const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x + a;
          const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z + a;
          out.push({ x, y, z, rot: ROT[d] });
        }
      }
    }
  }
  return out;
}

// 홀 문 위의 읽을 수 없는 명판
function signAbove(L, r, view, batch, M, seed) {
  for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) {
    for (let d = 0; d < 4; d++) {
      if (getEdge(L, cx, cz, d) !== 2) continue;
      const nx = cx + DX[d], nz = cz + DZ[d];
      if (inGrid(nx, nz) && L.roomId[idx(nx, nz)] === r.id) continue;
      const c = center(cx, cz), off = S / 2 + WALL_T / 2 + 0.02;
      const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x;
      const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z;
      const m = new THREE.Mesh(G_PLANE, new THREE.MeshLambertMaterial({ map: TX.glyphTex(seed) }));
      m.scale.set(2.6, 0.65, 1);
      m.position.set(x, DOOR_H + 0.95, z);
      m.rotation.y = ROT[d] + Math.PI;
      view.group.add(m);
    }
  }
}
