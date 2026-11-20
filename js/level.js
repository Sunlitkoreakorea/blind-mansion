// 층 배치 만들기 + 3D로 그리기
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { mulberry32, hashInt, shuffle } from './util.js';
import * as TX from './textures.js';
import { NOTES, TOP, BOTTOM, START_FLOOR } from './data.js';

export const S = 4, W = 13, H = 13, WALL_H = 4.6, WALL_T = 0.24, DOOR_W = 1.8, DOOR_H = 3.1;
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
    hidden: null, hiddenOpen: false, exitDoor: null, start: null, arrive: null,
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

  // 0층으로 가는 숨은 문 (1층 서쪽 벽, 지하 1층 동쪽 벽)
  if (floor === 1) { L.hidden = { cx: 0, cz: 4, dir: 3 }; setEdge(L, 0, 4, 3, 3); }
  if (floor === -1) { L.hidden = { cx: W - 1, cz: 4, dir: 1 }; setEdge(L, W - 1, 4, 1, 3); }
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
  L.decor.push({ type: 'statue', x: 21.2, z: 21.5, rot: Math.PI / 2 }, { type: 'statue', x: 30.8, z: 21.5, rot: -Math.PI / 2 });
  L.boxes.push(box(21.2, 21.5, 0.9, 0.9, 0), box(30.8, 21.5, 0.9, 0.9, 0));
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
  const wallSpot = (cx, cz, off = S / 2 - 0.5, spread = 1.4) => {
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
    return { x: p.x + (rnd() < 0.5 ? -1 : 1) * (1.05 + rnd() * 0.3), z: p.z + (rnd() < 0.5 ? -1 : 1) * (1.05 + rnd() * 0.3), rot: rnd() * Math.PI * 2 };
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
      const s = wallSpot(cx, cz, S / 2 - 0.75, 1.2);
      if (!s) continue;
      addItem({ kind: 'case', ...s, content: roll(0.3, 0.15), art: Math.floor(rnd() * 4) });
      L.boxes.push(box(s.x, s.z, 0.85, 0.85, s.rot));
      cases--;
    }
    for (let cz = r.y; cz < r.y + r.h; cz++) for (let cx = r.x; cx < r.x + r.w; cx++) {
      for (let d = 0; d < 4; d++) {
        if (getEdge(L, cx, cz, d) !== 1 || rnd() > 0.55) continue;
        const c = center(cx, cz), off = S / 2 - WALL_T / 2 - 0.04;
        const x = d === 1 ? c.x + off : d === 3 ? c.x - off : c.x;
        const z = d === 0 ? c.z - off : d === 2 ? c.z + off : c.z;
        L.decor.push({ type: 'painting', x, z, rot: ROT[d], seed: Math.floor(rnd() * 6) });
      }
    }
    const mx = (r.x + r.w / 2) * S + (r.w % 2 ? 0.95 : 0), mz = (r.y + r.h / 2) * S + (r.h % 2 ? 0.95 : 0);
    L.decor.push({ type: 'sculpture', x: mx, z: mz, rot: rnd() * 6, seed: Math.floor(rnd() * 4) });
    L.decor.push({ type: 'rug', x: (r.x + r.w / 2) * S, z: (r.y + r.h / 2) * S, w: r.w * S - 1.6, d: r.h * S - 1.6 });
    L.boxes.push(box(mx, mz, 0.8, 0.8, 0));
  }

  // 복도 벽등
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const k = roomKind(L, cx, cz);
    if (k !== 'corridor' && k !== 'exhibit') continue;
    for (let d = 0; d < 4; d++) {
      if (getEdge(L, cx, cz, d) !== 1 || rnd() > (k === 'corridor' ? 0.2 : 0.12)) continue;
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
      const s = wallSpot(cx, cz, S / 2 - 0.45, 1.6);
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
    addItem({ kind: 'craft', x: 12, z: 38, rot: 0 });
    L.boxes.push(box(12, 38, 1.8, 1.1, 0));
    addItem({ kind: 'fire', x: 4.45, z: 38, rot: Math.PI / 2 });
    L.boxes.push(box(4.45, 38, 2.2, 0.9, Math.PI / 2));
    addItem({ kind: 'note', x: 11.35, z: 37.75, y: 0.86, rot: 0.3, note: 'n2' });
    addItem({ kind: 'note', x: 12.7, z: 38.25, y: 0.86, rot: -0.5, note: 'n8' });
    L.decor.push({ type: 'sofa', x: 7.2, z: 34.6, rot: Math.PI / 2 + 0.4 }, { type: 'sofa', x: 7.2, z: 41.4, rot: Math.PI / 2 - 0.4 }, { type: 'sofa', x: 16.5, z: 38, rot: -Math.PI / 2 });
    L.boxes.push(box(7.2, 34.6, 2, 0.9, Math.PI / 2), box(7.2, 41.4, 2, 0.9, Math.PI / 2), box(16.5, 38, 2, 0.9, -Math.PI / 2));
    L.decor.push({ type: 'rug', x: 12, z: 38, w: 13, d: 9 });
  }
  if (L.floor === 3) {
    addItem({ kind: 'case', x: 26, z: 15, rot: 0, content: { tool: 1, kit: 1 }, art: 3 });
    L.boxes.push(box(26, 15, 0.85, 0.85, 0));
  }
  if (L.floor === 5) {
    addItem({ kind: 'bed', x: 40, z: 12, rot: Math.PI });
    L.boxes.push(box(40, 12, 1.6, 2.2, Math.PI));
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
  L.segs = segs;
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
  const fl = new THREE.PlaneGeometry(W * S, H * S);
  scaleUV(fl, (W * S) / 2, (H * S) / 2);
  const floorMesh = new THREE.Mesh(fl, M.floor);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set((W * S) / 2, 0, (H * S) / 2);
  group.add(floorMesh);
  const cl = new THREE.PlaneGeometry(W * S, H * S);
  scaleUV(cl, (W * S) / 4, (H * S) / 4);
  const ceilMesh = new THREE.Mesh(cl, M.ceil);
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set((W * S) / 2, WALL_H, (H * S) / 2);
  group.add(ceilMesh);

  // 꾸밈
  for (const d of L.decor) {
    if (d.type === 'painting') {
      const w = 1.25, h = 1.6, y = 2.45;
      batch.add(M.paint[d.seed], G_PLANE, d, 0, y, 0.035, w, h, 1);
      batch.add(M.gold, G_BOX, d, 0, y + h / 2 + 0.06, 0.02, w + 0.24, 0.12, 0.08);
      batch.add(M.gold, G_BOX, d, 0, y - h / 2 - 0.06, 0.02, w + 0.24, 0.12, 0.08);
      batch.add(M.gold, G_BOX, d, -w / 2 - 0.06, y, 0.02, 0.12, h, 0.08);
      batch.add(M.gold, G_BOX, d, w / 2 + 0.06, y, 0.02, 0.12, h, 0.08);
      if (L.theme === 'bronze') batch.add(M.gold, G_BOX, d, 0.3, y - h / 2 - 0.42, 0.02, 0.4, 0.14, 0.04, 0, 0, 0.12);
      else batch.add(M.gold, G_BOX, d, 0, y - h / 2 - 0.4, 0.02, 0.36, 0.13, 0.04);
    } else if (d.type === 'sconce') {
      batch.add(M.gold, G_BOX, d, 0, 2.7, 0.06, 0.12, 0.34, 0.06);
      batch.add(M.gold, G_BOX, d, 0, 2.58, 0.2, 0.05, 0.05, 0.3);
      batch.add(M.globe, G_SPH, d, 0, 2.78, 0.34, 0.2, 0.26, 0.2);
      const c = Math.cos(d.rot), s = Math.sin(d.rot);
      view.anchors.push({ x: d.x + 0.5 * s, y: 2.8, z: d.z + 0.5 * c, color: P.lamp, power: 1 });
    } else if (d.type === 'sculpture') {
      batch.add(M.stone, G_BOX, d, 0, 0.5, 0, 0.7, 1.0, 0.7);
      batch.add(M.gold, G_BOX, d, 0, 1.02, 0, 0.78, 0.05, 0.78);
      const kinds = [new THREE.TorusKnotGeometry(0.22, 0.07, 60, 8), new THREE.IcosahedronGeometry(0.3, 0), new THREE.TorusGeometry(0.25, 0.06, 8, 24), new THREE.OctahedronGeometry(0.32, 0)];
      const g = kinds[d.seed % kinds.length];
      batch.add(M.sculpt, g, d, 0, 1.45, 0, 1, 1.3, 1, 0.4, 0, 0.3);
      kinds.forEach((k) => k.dispose());
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
    pl.position.set(ex + S - 0.6, 1.75, ez - WALL_T / 2 - 0.015);
    pl.rotation.y = Math.PI;
    group.add(pl);
    // 층 표시
    const fl = new THREE.Mesh(G_PLANE, new THREE.MeshBasicMaterial({ map: TX.plaqueTex([L.floor > 0 ? `${L.floor}` : `B${-L.floor}`], 'f' + L.floor) }));
    fl.scale.set(0.5, 0.16, 1);
    fl.position.set(mx, DOOR_H + 0.42, ez - WALL_T / 2 - 0.015);
    fl.rotation.y = Math.PI;
    group.add(fl);
    view.anchors.push({ x: mx, y: 3.6, z: ez + S / 2, color: 0xffd28a, power: 0.8, fixed: true });
  }

  const rooms = (k) => L.rooms.filter((r) => r.kind === k);
  // 「감정의 힘」: 벽 가득한 액자 속 입
  for (const r of rooms('mouth')) {
    const spots = hallWallSpots(L, r, 0.95, [1.3, 2.3, 3.3]);
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
    for (let k = 0; k < 11; k++) {
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
    view.anchors.push({ x: hx, y: 4, z: hz, color: 0xc08a5a, power: 1.2, fixed: true });
    for (const [ax, az] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) view.anchors.push({ x: hx + ax, y: 3.2, z: hz + az, color: 0xd07a5a, power: 0.9, fixed: true });
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
    for (let y = 0.4; y < WALL_H - 0.2; y += 0.27) {
      const off = (Math.round(y / 0.27) % 2) * 0.2;
      for (let x = x0 + 0.25 + off; x < x1 - 0.2; x += 0.4) pair(x, y, z0 + 0.06, 1, 0);
      for (let z = z0 + 0.25 + off; z < z1 - 0.2; z += 0.4) { pair(x0 + 0.06, y, z, 0, 1); pair(x1 - 0.06, y, z, 0, 1); }
    }
    const eyeGeo = new THREE.PlaneGeometry(0.17, 0.17);
    const eyes = new THREE.InstancedMesh(eyeGeo, new THREE.MeshBasicMaterial({ map: TX.eyeDiscTex(), alphaTest: 0.5 }), pts.length);
    const dummy = new THREE.Object3D();
    const target = new THREE.Vector3();
    let acc = 1;
    view.eyes = { r, mesh: eyes };
    view.anims.push((t, dt, ctx) => {
      acc += dt;
      if (acc < 0.07) return;
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
    view.anchors.push({ x: (r.x + r.w / 2) * S, y: 3.5, z: (r.y + r.h / 2) * S, color: 0x8fa8ff, power: 0.7, fixed: true });
  }

  // 게스트룸 등불
  for (const r of rooms('guest')) {
    view.anchors.push({ x: (r.x + r.w / 2) * S + 1.2, y: 1.6, z: (r.y + r.h / 2) * S - 1.2, color: 0xffc47a, power: 1.0, fixed: true });
  }
  // 라운지: 천장등 + 소파 옆 스탠드
  for (const r of rooms('lounge')) {
    view.anchors.push({ x: (r.x + r.w / 2) * S, y: 4.0, z: (r.y + r.h / 2) * S, color: 0xffcf90, power: 1.0, fixed: true });
    const shade = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const [x, z] of [[5.6, 32.9], [5.6, 43.1], [18.2, 35.2], [18.2, 40.8]]) {
      const b = { x, z, rot: 0 };
      batch.add(M.gold, G_CYL, b, 0, 0.75, 0, 0.05, 1.5, 0.05);
      batch.add(M.gold, G_CYL, b, 0, 0.03, 0, 0.36, 0.06, 0.36);
      batch.add(shade, new THREE.CylinderGeometry(0.14, 0.26, 0.32, 12, 1, true), b, 0, 1.62, 0);
      view.anchors.push({ x, y: 1.55, z, color: 0xffc78a, power: 0.9, fixed: true });
    }
  }
  // 0층 현관
  if (L.floor === 0) {
    view.anchors.push({ x: 26, y: 4.0, z: 22, color: 0xffe2b0, power: 1.4, fixed: true });
    const ch = { x: 26, z: 22, rot: 0 };
    batch.add(M.gold, G_CYL, ch, 0, 4.2, 0, 0.05, 0.8, 0.05);
    batch.add(M.gold, new THREE.TorusGeometry(0.6, 0.04, 6, 24), ch, 0, 3.8, 0, 1, 1, 1, Math.PI / 2);
    for (let k = 0; k < 8; k++) batch.add(M.globe, G_SPH, ch, Math.cos(k * 0.785) * 0.6, 3.9, Math.sin(k * 0.785) * 0.6, 0.1, 0.14, 0.1);
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
      m.scale.set(1.8, 0.45, 1);
      m.position.set(x, DOOR_H + 0.75, z);
      m.rotation.y = ROT[d] + Math.PI;
      view.group.add(m);
    }
  }
}
