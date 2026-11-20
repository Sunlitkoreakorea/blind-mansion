// 게임 진행: 시간, 층 이동, 징수, 양초, 질문, 0층
import * as THREE from 'three';
import { generateLayout, buildFloor, center, cellAt, idx, W, H, S, ELEV, roomKind, zonesFor, bfs, stairFrame, computeSegs, DOOR_H } from './level.js';
import { Robot } from './robot.js';
import { Player, collide, los } from './player.js';
import { Sound } from './audio.js';
import { Splatter } from './splat.js';
import { UI, ELEV_FLOORS } from './ui.js';
import { PALETTE, glowTex } from './textures.js';
import { CFG, CARD_MAP, NOTES, SLOTS, ENDINGS, TOP, BOTTOM, START_FLOOR } from './data.js';
import { mulberry32, hashInt, floorLabel, succ, pred, clamp, shuffle, iga, angleDiff } from './util.js';

/* ── 렌더러 ── */
const canvas = document.getElementById('view');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  document.getElementById('nogl').hidden = false;
  throw e;
}
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
renderer.setPixelRatio(pixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0b07);
scene.fog = new THREE.FogExp2(0x0f0b07, 0.06);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 90);
camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight(0x9a7a4a, 0x1a120a, 0.5);
scene.add(hemi);
const POOL = [];
for (let i = 0; i < 7; i++) { const l = new THREE.PointLight(0xffb35a, 0, 13, 1.7); scene.add(l); POOL.push(l); }
const candleLight = new THREE.PointLight(0xffc070, 0, 9, 1.6);
scene.add(candleLight);
const SPOTS = [];
for (let i = 0; i < 2; i++) {
  const s = new THREE.SpotLight(0xffcf60, 0, 22, 0.42, 0.5, 1.4);
  scene.add(s, s.target);
  SPOTS.push(s);
}
const ripples = document.getElementById('ripples');
const rctx = ripples.getContext('2d');
const splat = new Splatter(document.getElementById('splat'));
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  ripples.width = innerWidth; ripples.height = innerHeight;
  splat.resize();
}
addEventListener('resize', resize);
resize();

const ui = new UI();
const sound = new Sound();
const player = new Player();
let G = null;
let attendant = null;

function freshState(mode) {
  return {
    state: 'title', mode, seed: (Math.random() * 2 ** 31) | 0, exitFloor: 0,
    gameMin: 0, realT: 0, visit: 0,
    floor: START_FLOOR, L: null, view: null, robots: [], zone: null, zoneCells: [], allCells: [],
    inv: { tools: 0, kits: 0 }, candles: [], lit: null,
    parts: [], range: { lo: BOTTOM, hi: TOP },
    taken: new Map(), searched: new Set(), hiddenOpened: new Set(),
    stats: { questions: 0 },
    grace: 0, hold: null, rest: false, noise: null, target: null,
    trans: null, col: null,
    lens: { t: 0, cd: 0 }, zoom: false, wasFree: true,
    zeroFrom: 1, screamCd: 0, eyeT: 0, timers: [],
    panelAnim: null, hadLock: false, panelLock: false,
  };
}

/* ── 로봇이 쓰는 세상 정보 ── */
const world = {
  get L() { return G.L; },
  group: null,
  collide: (x, z, r) => collide(G.L, x, z, r),
  los: (a, b, c, d) => los(G.L, a, b, c, d),
  zoneOf: (c) => (G.zone ? G.zone[c] : 0),
  zoneCells: (z) => (G.zoneCells[z] && G.zoneCells[z].length ? G.zoneCells[z] : G.allCells),
  anyCell: () => G.allCells[Math.floor(Math.random() * G.allCells.length)],
  forbid: (c) => robotForbidden(c),
  sound(kind, r) {
    const d = Math.hypot(r.pos.x - player.x, r.pos.z - player.z);
    if (d > 26) return;
    if (kind === 'creak') sound.creak(r.pos.x, r.pos.z, r.state === 'chase');
    else if (kind === 'tick') { const t = G.realT; if ((r._tickT || 0) < t) { r._tickT = t + 0.12; sound.tick(r.pos.x, r.pos.z); } }
  },
};
function robotForbidden(c) {
  const r = G.L.roomId[c];
  if (r < 0) return false;
  const k = G.L.rooms[r].kind;
  return k === 'lounge' || k === 'elev';
}
const isFree = () => G.gameMin < CFG.freeMin;

/* ── 층 불러오기 ── */
function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry && !o.geometry._shared) o.geometry.dispose(); });
}

function loadFloor(f, arrival) {
  if (G.view) {
    scene.remove(G.view.group);
    G.robots.forEach((r) => r.dispose());
    if (attendant) attendant.dispose();
    disposeGroup(G.view.group);
  }
  attendant = null;
  G.floor = f;
  G.L = generateLayout(f, G.seed, { exitFloor: G.exitFloor });
  if (G.hiddenOpened.has(f) || f === 0) { G.L.hiddenOpen = true; computeSegs(G.L); }
  if (!G.taken.has(f)) G.taken.set(f, new Set());
  G.view = buildFloor(G.L, G.taken.get(f));
  scene.add(G.view.group);
  world.group = G.view.group;
  if (G.view.hiddenPanel && G.L.hiddenOpen) G.view.hiddenPanel.position.y = DOOR_H * 1.5;

  const P = PALETTE[G.L.theme];
  scene.fog.color.setHex(P.fog);
  scene.background.setHex(P.fog);
  scene.fog.density = 0.055 + Math.min(0.03, G.L.depth * 0.0012);
  hemi.color.setHex(P.hemiSky);
  hemi.groundColor.setHex(P.hemiGround);
  hemi.intensity = G.L.theme === 'brass' ? 0.55 : 0.42 - Math.min(0.15, G.L.depth * 0.006);

  let a;
  if (arrival === 'start') a = G.L.start;
  else if (arrival === 'fromZero' && G.L.hidden) {
    const p = stairFrame(G.L.hidden);
    player.x = p.ox - p.nx * 1.4; player.z = p.oz - p.nz * 1.4;
    player.yaw = Math.atan2(p.nx, p.nz);
  } else a = G.L.arrive;
  if (a) {
    const c = center(a.cx, a.cz);
    player.x = c.x; player.z = c.z; player.yaw = a.yaw;
  }
  player.pitch = 0;
  spawnRobots(idx(cellAt(player.x, player.z).cx, cellAt(player.x, player.z).cz));
  if (f !== 0) {
    attendant = new Robot(world, idx(ELEV.cx, ELEV.cz), -1, 99);
    attendant.pos.set(ELEV.cx * S + 1.0, 0, ELEV.cz * S + 3.0);
    attendant.yaw = Math.PI * 0.75;
    attendant.bow = 1;
    for (const L of attendant.model.legs) { attendant.homeOf(L, L.foot); L.from.copy(L.foot); L.to.copy(L.foot); }
    attendant.syncModel(0.016);
  }
  ui.floorFlash(f);
}

function spawnRobots(arrCell) {
  G.robots = [];
  G.zone = null; G.zoneCells = [];
  const L = G.L;
  G.allCells = [];
  for (let c = 0; c < W * H; c++) if (!L.voidCell[c] && !robotForbidden(c)) G.allCells.push(c);
  if (G.floor === 0) return;
  const n = G.floor > 0 ? 2 : Math.min(5, 2 + Math.floor(-G.floor / 8));
  const rnd = mulberry32(hashInt(G.seed, G.floor + 300, G.visit++));
  const { dist } = bfs(L, arrCell);
  const cand = shuffle(G.allCells.filter((c) => dist[c] >= 4), rnd);
  const seeds = [];
  for (const c of cand) {
    if (seeds.length >= n) break;
    const ok = seeds.every((s) => Math.abs((s % W) - (c % W)) + Math.abs(((s / W) | 0) - ((c / W) | 0)) >= 4);
    if (ok) seeds.push(c);
  }
  while (seeds.length < n && cand.length) seeds.push(cand.pop());
  G.zone = zonesFor(L, seeds, robotForbidden);
  G.zoneCells = seeds.map((_, i) => G.allCells.filter((c) => G.zone[c] === i));
  seeds.forEach((c, i) => G.robots.push(new Robot(world, c, i, i)));
}

/* ── 시작 ── */
function loadSave() { try { return JSON.parse(localStorage.getItem('blind-mansion-v1') || '{}'); } catch { return {}; } }
function writeSave(o) { try { localStorage.setItem('blind-mansion-v1', JSON.stringify({ ...loadSave(), ...o })); } catch { /* 저장 못 해도 진행 */ } }

function startGame(mode) {
  sound.init();
  if (G && G.view) {
    scene.remove(G.view.group);
    G.robots.forEach((r) => r.dispose());
    if (attendant) attendant.dispose();
    disposeGroup(G.view.group);
    attendant = null;
  }
  prevFree = true;
  splat.clear();
  canvas.style.filter = '';
  G = freshState(mode);
  if (mode === 'random') {
    const r = Math.random();
    if (r < 0.25) G.exitFloor = 0;
    else { const list = ELEV_FLOORS.filter((f) => f !== START_FLOOR); G.exitFloor = list[Math.floor(Math.random() * list.length)]; }
  }
  ui.hideTitle();
  loadFloor(START_FLOOR, 'start');
  G.state = 'play';
  requestLock();
  setTimeout(() => ui.caption('…전시회장이다.', 3), 900);
}

/* ── 포인터 잠금, 일시정지 ── */
function requestLock() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* 잠금 못 해도 키보드로 진행 */ }
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) G && (G.hadLock = true);
  if (!locked && G && G.state === 'play' && G.hadLock && !G.panelLock) pauseGame();
});
canvas.addEventListener('click', () => { if (G && G.state === 'play' && !document.pointerLockElement) requestLock(); });
canvas.addEventListener('mousedown', (e) => { if (e.button === 2 && G) G.zoom = true; });
addEventListener('mouseup', (e) => { if (e.button === 2 && G) G.zoom = false; });
addEventListener('contextmenu', (e) => e.preventDefault());

function pauseGame() {
  G.state = 'paused';
  G.hold = null;
  ui.pause(true, () => { ui.pause(false); G.state = 'play'; requestLock(); });
}
function openPanelState() {
  G.state = 'panel';
  G.hold = null;
  G.panelLock = true;
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePanel() {
  ui.close();
  if (G.state === 'panel') G.state = 'play';
  G.panelLock = false;
  requestLock();
}

/* ── 키 ── */
player.bind((code, down, e) => {
  if (!G) return;
  if (G.state === 'panel') { if (down) { ui.key(code, e); if (['Space', 'Enter', 'Backspace'].includes(code)) e.preventDefault(); } return; }
  if (!down) { if (code === 'KeyE') G.hold = null; return; }
  if (G.state !== 'play') return;
  if (G.rest && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(code)) { G.rest = false; ui.caption('일어났다', 1.5); }
  if (code === 'KeyE') interact();
  else if (code === 'KeyF') toggleCandle();
  else if (code === 'KeyQ') useLens();
  else if (code === 'KeyR') repair();
  else if (code === 'Escape' && !document.pointerLockElement) pauseGame();
  if (code === 'Space') e.preventDefault();
});

/* ── 인공 부위 ── */
const part = (slot) => G.parts.find((p) => p.slot === slot);
function lensAlive() { return G.parts.some((p) => p.kind === 'eye' && p.life > 0); }
function earAlive() { return G.parts.some((p) => p.kind === 'ear' && p.life > 0); }
function armMul() { let m = 1; for (const p of G.parts) if (p.kind === 'arm') m *= p.life > 0 ? 1.6 : 2.6; return m; }
function playerMods() {
  const legs = G.parts.filter((p) => p.kind === 'leg');
  return { canRun: legs.length === 0, crawl: legs.some((p) => p.life <= 0), speedMul: legs.length ? 0.88 : 1 };
}
function applyPartEffects() {
  const st = (p) => (!p ? 'none' : p.life > 0 ? 'lens' : 'dead');
  ui.eyes(st(part('eyeL')), st(part('eyeR')));
  let cutoff = 18000, gain = 0.9, dead = 0;
  for (const p of G.parts) if (p.kind === 'ear') {
    if (p.life > 0) { cutoff = Math.min(cutoff, 5200); gain *= 0.85; } else { dead++; gain *= 0.55; }
  }
  if (dead) cutoff = Math.min(cutoff, dead > 1 ? 450 : 1100);
  sound.setEar(cutoff, gain);
}
function repair() {
  if (!G.parts.length) return;
  if (G.inv.tools <= 0) { ui.caption('정비 공구가 없다', 1.8); return; }
  if (G.parts.every((p) => p.life >= CFG.partLife - 0.5)) { ui.caption('아직 멀쩡하다', 1.5); return; }
  G.inv.tools--;
  G.parts.forEach((p) => (p.life = CFG.partLife));
  G.gameMin += 3 * armMul();
  sound.clank(player.x, player.z);
  ui.caption('인공 부위를 다시 조였다', 2);
  applyPartEffects();
}
function useLens() {
  if (!lensAlive()) return;
  if (G.lens.cd > 0) return;
  G.lens.t = 3; G.lens.cd = 20;
  sound.tone && sound.on && sound.tone(1600, 0.25, 0.05, 'sine', null, 2400);
}

/* ── 양초 ── */
function toggleCandle() {
  if (G.lit) { G.lit.lit = false; G.lit = null; ui.caption('양초를 껐다', 1.4); return; }
  const ready = G.candles.find((c) => G.gameMin >= c.hardenAt && c.wax > 0);
  if (!ready) {
    const soft = G.candles.find((c) => G.gameMin < c.hardenAt);
    if (soft) ui.caption(`아직 굳는 중이다 (${Math.ceil(soft.hardenAt - G.gameMin)}분)`, 2);
    return;
  }
  sound.light();
  if (ready.fx === 'heal') {
    removeCandle(ready);
    if (G.parts.length) { G.parts.forEach((p) => (p.life = CFG.partLife)); applyPartEffects(); ui.caption('촛불이 번지며 인공 부위가 다시 돌아간다', 2.5); }
    else ui.caption('촛불이 잠깐 따뜻하게 번지고 꺼졌다', 2.5);
    return;
  }
  ready.lit = true; G.lit = ready;
  ui.caption(ready.name, 2.2);
}
function removeCandle(c) {
  c.lit = false;
  G.candles = G.candles.filter((x) => x !== c);
  if (G.lit === c) G.lit = null;
}
function candleOut(c, msg) {
  removeCandle(c);
  ui.caption(msg || '양초가 다 탔다', 2);
}

/* ── 출구 범위 메모 ── */
function memoUpdate(q, yes) {
  const R = G.range, f = G.floor;
  if (q === 'up') { if (yes) R.lo = Math.max(R.lo, succ(f)); else R.hi = Math.min(R.hi, f); }
  if (q === 'down') { if (yes) R.hi = Math.min(R.hi, pred(f)); else R.lo = Math.max(R.lo, f); }
  if (q === 'here') {
    if (yes) { R.lo = f; R.hi = f; }
    else { if (R.lo === f) R.lo = succ(f); if (R.hi === f) R.hi = pred(f); }
  }
}
function memoText() {
  if (G.floor === 0 || G.knowZero) return '0층';
  const { lo, hi } = G.range;
  if (lo > hi) return '???';
  if (lo === hi) return floorLabel(lo);
  return `${floorLabel(lo)} ~ ${floorLabel(hi)}`;
}

/* ── 질문 ── */
function openAsk(r) {
  openPanelState();
  ui.ask((q) => {
    if (q === 'close') { closePanel(); return; }
    if (q === 'way') {
      ui.keypad((v) => { closePanel(); if (v !== null) askRobot(r, 'way', v); });
      return;
    }
    closePanel();
    askRobot(r, q);
  });
}
function later(sec, fn) { G.timers.push({ t: sec, fn }); }

function askRobot(r, q, v) {
  const lit = G.lit;
  if (!lit || !lit.canAsk) return;
  G.stats.questions++;
  lit.wax -= CFG.askCost;
  r.asked++;
  const risk = [0, 0, 0.12, 0.4, 0.75][Math.min(4, r.asked)] * (lit.honor ? 0.5 : 1);
  r.setState('answer');
  if (Math.random() < risk) {
    later(0.9, () => {
      r.broken = true;
      r.setState('chase');
      sound.screech(r.pos.x, r.pos.z);
      ui.caption('……기이이익', 2);
    });
    return;
  }
  const f = G.floor, e = G.exitFloor;
  let yes = false, guide = false, point = false;
  if (q === 'up') yes = e > f;
  else if (q === 'down') yes = e < f;
  else if (q === 'here') yes = e === f;
  else if (q === 'way') {
    if (v === 0) guide = f === 1 || f === -1;
    else if (v === f) yes = true;
    else if (ELEV_FLOORS.includes(v)) point = true;
  }
  if (yes || guide || point) r.nod = 1.4;
  later(1.5, () => {
    if (q === 'up' || q === 'down' || q === 'here') memoUpdate(q, yes);
    if (guide) { G.knowZero = true; ui.caption('끄덕.', 1.6); later(1.0, () => startGuide(r)); }
    else if (point) {
      ui.caption('끄덕.', 1.6);
      r.pointAt = center(ELEV.cx, ELEV.cz);
      r.setState('point');
    } else ui.caption(yes ? '끄덕.' : '……', 1.8);
  });
}
function startGuide(r) {
  const h = G.L.hidden;
  if (!h) return;
  r.guideCell = idx(h.cx, h.cz);
  const p = stairFrame(h);
  r.guideFace = { x: p.ox, z: p.oz };
  r.guideArrived = false;
  r.setState('guide');
  ui.caption('안내원이 앞장선다', 2);
}
function onGuideArrive() {
  if (G.L.hiddenOpen || G.panelAnim) return;
  sound.panelSlide();
  G.panelAnim = { t: 0 };
}

/* ── 징수 ── */
// 붙잡힘 → 요금 징수 도장 → 바늘 다리가 다가와 드릴과 톱니로 끼움 → 철컥 → 금전등록기 → 놓아줌
const COL_END = 4.4;
const _cv = new THREE.Vector3(), _ch = new THREE.Vector3(), _cq = new THREE.Quaternion(), _ce = new THREE.Euler(0, 0, 0, 'YXZ');
// 바늘 끝에서 반짝이는 빛 (어두워도 다가오는 게 보이도록)
const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xfff2dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
glint.visible = false;
scene.add(glint);
// 바늘 끝이 지나는 길: 손님 기준 (x 바깥쪽, y 위, -z 안내원 쪽), [처음, 끝]
const NEEDLE = {
  eye: [[0.38, 0.3, -1.1], [0.034, -0.012, -0.12]],
  ear: [[0.55, 0.24, -0.9], [0.15, 0.0, 0.03]],
  arm: [[0.55, 0.12, -0.95], [0.26, -0.44, -0.26]],
  leg: [[0.42, -0.25, -1.0], [0.15, -1.05, -0.22]],
};
function onCatch(r) {
  if (G.state !== 'play' || G.grace > 0) return;
  const lit = G.lit;
  if (lit && lit.fx === 'shield') {
    candleOut(lit, '양초가 대신 타 버렸다');
    G.grace = 4; r.setState('retreat'); sound.screech(r.pos.x, r.pos.z);
    return;
  }
  if (lit && lit.fx === 'stun') {
    candleOut(lit, '안내원이 그 자리에 멈췄다');
    G.grace = 2; r.setState('stun'); sound.clank(r.pos.x, r.pos.z);
    return;
  }
  G.state = 'collect';
  G.rest = false; G.hold = null; G.zoom = false;
  const slot = SLOTS[G.parts.length];
  const side = slot.slot.endsWith('L') ? -1 : 1;
  // 손님 몸의 해당 쪽에 가까운 앞다리가 뻗고, 반대쪽 앞다리는 치켜듦
  const legs = r.model.legs;
  const fy = Math.atan2(player.x - r.pos.x, player.z - r.pos.z);
  const pyaw = Math.atan2(r.pos.x - player.x, r.pos.z - player.z) + Math.PI; // 손님이 안내원을 볼 때의 yaw
  const lx = Math.cos(pyaw) * side, lz = -Math.sin(pyaw) * side;
  const onPlus = lx * Math.cos(fy) - lz * Math.sin(fy) > 0;
  const legA = onPlus ? legs[0] : legs[4], legB = onPlus ? legs[4] : legs[0];
  const org = { eye: [side < 0 ? 0.36 : 0.64, 0.46], ear: [side < 0 ? 0.07 : 0.93, 0.42], arm: [side < 0 ? 0.16 : 0.84, 0.8], leg: [side < 0 ? 0.34 : 0.66, 0.97] }[slot.kind];
  G.col = { t: 0, r, slot, side, org, legA, legB, bSide: onPlus ? -1 : 1, ev: new Set(), shake: 1.2, flash: 0.7, flashColor: '#ff1a0a', flick: 0, drop: 0, roll: 0, installed: false };
  splat.spray(0.5, 0.5, 7, 0.55);
  legA.reach = legA.foot.clone(); legB.reach = legB.foot.clone();
  ui.collectShow(isFree() ? '벌금 징수' : '요금 징수', `${slot.label} → ${slot.art}`, `징수 ${G.parts.length + 1} / ${SLOTS.length}`);
  r.setGlare(true);
  r.pose = 'collect';
  r.path = null;
  sound.grab();
  sound.screech(r.pos.x, r.pos.z);
  sound.setHeart(1);
}

function updateCollect(dt) {
  const c = G.col, r = c.r, kind = c.slot.kind, s = c.side;
  const t = (c.t += dt);
  const at = (tt, key, fn) => { if (t >= tt && !c.ev.has(key)) { c.ev.add(key); fn(); } };
  at(0.35, 'stamp', () => { sound.bell(); c.shake += 0.5; });
  at(0.9, 'insert', () => {
    sound.drill(2.0);
    if (kind === 'ear') { sound.tinnitus(3.4); sound.muffle(); }
    if (kind === 'leg') { sound.hiss(); c.shake += 0.7; }
    if (kind === 'arm') sound.clank(player.x, player.z);
  });
  for (let i = 0; i < 8; i++) at(1.3 + i * 0.2, 'r' + i, () => {
    sound.ratchet(); c.shake += 0.22; c.flash = Math.max(c.flash, 0.28); c.flashColor = '#ff1a0a'; c.flick = 0.3;
    if (i % 2 === 0 || i > 4) splat.spray(c.org[0], c.org[1], 3 + (i >> 1), 0.5 + i * 0.04);
  });
  if (kind === 'eye') at(2.45, 'focus', () => sound.focus());
  at(2.9, 'clunk', () => {
    sound.clunk(); c.shake += 1; c.flash = 0.9; c.flashColor = '#ff1a0a';
    splat.spray(c.org[0], c.org[1], 26, 1.25, 3);
    splat.spray(0.5, 0.5, 10, 0.8, 3);
    G.parts.push({ ...c.slot, short: c.slot.label, life: CFG.partLife });
    c.installed = true;
    applyPartEffects();
  });
  at(3.25, 'kaching', () => sound.kaching());
  at(3.7, 'release', () => { r.setGlare(false); r.pose = null; sound.setHeart(0.35); });

  // 안내원: 손님 쪽으로 돌아 몸을 낮춤, 너무 붙어 있으면 반 걸음 물러남
  const dx = player.x - r.pos.x, dz = player.z - r.pos.z, d = Math.hypot(dx, dz) || 1;
  r.yaw += clamp(angleDiff(Math.atan2(dx, dz), r.yaw), -dt * 6, dt * 6);
  if (d < 1.15) { const p = collide(G.L, r.pos.x - (dx / d) * dt * 1.5, r.pos.z - (dz / d) * dt * 1.5, 0.42); r.pos.x = p.x; r.pos.z = p.z; }
  const release = t >= 3.7;
  r.bow += clamp((release ? 0 : 0.5) - r.bow, -dt * 2.5, dt * 2.5);
  r.lookAt = { x: player.x, z: player.z };
  r.speed = 0; r.vel.set(0, 0, 0);

  // 바늘 끝 위치 (화면 흔들림과 무관하게 손님과 안내원 위치로만 정함)
  _ce.set(0, Math.atan2(dx, dz), 0); // 이 방향의 -z가 안내원 쪽
  _cq.setFromEuler(_ce);
  const k = clamp((t - 0.55) / 2.15, 0, 1);
  const e = k < 0.75 ? 0.55 * (k / 0.75) ** 1.4 : 0.55 + 0.45 * ((k - 0.75) / 0.25) ** 0.7;
  const [p0, p1] = NEEDLE[kind];
  const jig = t > 1.3 && t < 2.9 ? 0.006 : 0;
  if (!release) {
    _cv.set((p0[0] + (p1[0] - p0[0]) * e) * s + (Math.random() - 0.5) * jig, p0[1] + (p1[1] - p0[1]) * e + (Math.random() - 0.5) * jig, p0[2] + (p1[2] - p0[2]) * e);
    _cv.applyQuaternion(_cq);
    c.legA.reach.set(player.x + _cv.x, player.eye + _cv.y, player.z + _cv.z);
    _cv.set(c.bSide * 0.6, 2.7 + Math.sin(t * 3) * 0.08, 0.75);
    r.model.root.localToWorld(_cv);
    c.legB.reach.copy(_cv);
  } else {
    r.homeOf(c.legA, c.legA.reach); r.homeOf(c.legB, c.legB.reach);
  }
  r.syncModel(dt);
  SPOTS.forEach((sp) => sp.color.setHex(sp === r.light && !release ? 0xff4a2e : 0xffcf60));

  // 화면
  c.shake = Math.max(0, c.shake - dt * 2.4);
  c.flash = Math.max(0, c.flash - dt * 2.2);
  c.flick = Math.max(0, c.flick - dt * 3);
  const insert = t > 0.9 && t < 3.5;
  c.drop += ((kind === 'leg' && insert ? 0.55 : 0) - c.drop) * Math.min(1, dt * 7);
  const rollT = !insert ? 0 : kind === 'arm' ? s * 0.14 : kind === 'leg' ? s * 0.08 : kind === 'ear' ? Math.sin(t * 9) * 0.03 + s * 0.05 : 0;
  c.roll += (rollT - c.roll) * Math.min(1, dt * 6);
  const alpha = release ? clamp(1 - (t - 3.7) / 0.7, 0, 1) : 1;
  ui.collectFx({
    alpha,
    vig: clamp(t / 0.4, 0, 1) * (0.86 + 0.14 * Math.sin(t * 8.5)),
    flash: c.flash, flashColor: c.flashColor,
    stamp: clamp((t - 0.35) / 0.14, 0, 1),
    sub: clamp((t - 2.95) / 0.3, 0, 1), count: clamp((t - 3.25) / 0.3, 0, 1),
  });
  const blur = kind === 'ear' && insert ? 1.6 : 0;
  canvas.style.filter = alpha > 0 ? `saturate(${(1 - 0.45 * alpha).toFixed(3)}) contrast(${(1 + 0.18 * alpha).toFixed(3)}) brightness(${(1 + c.flick * 0.6).toFixed(3)})${blur ? ` blur(${blur}px)` : ''}` : '';
  if (t >= COL_END) finishCollect();
}

// visuals 뒤에 덮어씀: 안내원 머리(끼울 때는 바늘 끝)를 보게 하고 흔듦
function collectCamera(dt) {
  const c = G.col;
  if (!c) return;
  const t = c.t, kind = c.slot.kind;
  c.r.model.head.getWorldPosition(_ch);
  const insert = t > 0.9 && t < 3.5;
  const tip = c.legA.foot;
  const w = !insert ? 0 : kind === 'leg' ? 0.85 : kind === 'arm' ? 0.65 : kind === 'eye' ? 0.75 * clamp((t - 1.2) / 1.4, 0, 1) : 0;
  const ax = _ch.x + (tip.x - _ch.x) * w, ay = _ch.y + (tip.y - _ch.y) * w, az = _ch.z + (tip.z - _ch.z) * w;
  const dx = ax - player.x, dz = az - player.z, dy = ay - player.eye;
  const kk = Math.min(1, dt * (t < 0.5 ? 14 : 6));
  player.yaw += angleDiff(Math.atan2(-dx, -dz), player.yaw) * kk;
  player.pitch += (clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.3, 1.3) - player.pitch) * kk;
  const sh = c.shake * c.shake;
  const j = () => (Math.random() - 0.5) * 2;
  camera.position.set(player.x + j() * 0.02 * sh, player.eye - c.drop + j() * 0.02 * sh, player.z + j() * 0.02 * sh);
  camera.rotation.set(player.pitch + j() * 0.045 * sh, player.yaw + j() * 0.045 * sh, c.roll + j() * 0.03 * sh);
  glint.visible = t > 0.5 && t < 2.92;
  if (glint.visible) {
    glint.position.copy(tip);
    const dist = tip.distanceTo(camera.position);
    glint.scale.setScalar(0.07 * clamp(dist / 0.7, 0.12, 1) * (0.75 + 0.45 * Math.abs(Math.sin(t * 23))));
  }
  drawIris(c);
}

// 눈: 그쪽 절반을 조리개가 닫았다가 렌즈로 다시 열림
function drawIris(c) {
  if (c.slot.kind !== 'eye') return;
  const t = c.t;
  let open;
  if (t < 2.5 || t > 3.75) return;
  if (t < 2.9) open = 1 - (t - 2.5) / 0.4;
  else if (t < 3.05) open = 0;
  else { const u = (t - 3.05) / 0.7; open = 1 - (1 - u) ** 3; }
  const wd = ripples.width, ht = ripples.height;
  const x0 = c.side < 0 ? 0 : wd / 2;
  const cx = x0 + wd / 4, cy = ht / 2;
  const R = Math.hypot(wd / 4, ht / 2) * 1.08 * open;
  const n = 8, rot = open * 1.4;
  rctx.save();
  rctx.beginPath(); rctx.rect(x0, 0, wd / 2, ht); rctx.clip();
  rctx.beginPath();
  rctx.rect(x0, 0, wd / 2, ht);
  for (let i = 0; i <= n; i++) {
    const a = rot + (i / n) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    if (i) rctx.lineTo(x, y); else rctx.moveTo(x, y);
  }
  rctx.fillStyle = '#060403';
  rctx.fill('evenodd');
  rctx.strokeStyle = 'rgba(201,162,90,0.5)';
  rctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R, b = a + Math.PI / 2 + 0.45;
    rctx.beginPath(); rctx.moveTo(x, y); rctx.lineTo(x + Math.cos(b) * wd, y + Math.sin(b) * wd); rctx.stroke();
  }
  rctx.restore();
}

function finishCollect() {
  const c = G.col;
  G.col = null;
  ui.collectHide();
  canvas.style.filter = '';
  glint.visible = false;
  SPOTS.forEach((sp) => sp.color.setHex(0xffcf60));
  const r = c.r;
  r.setGlare(false);
  r.pose = null;
  for (const L of r.model.legs) if (L.reach) { L.reach = null; L.foot.y = 0; L.from.copy(L.foot); L.to.copy(L.foot); L.t = 1; }
  if (!c.installed) { G.parts.push({ ...c.slot, short: c.slot.label, life: CFG.partLife }); applyPartEffects(); }
  if (G.parts.length >= SLOTS.length) { endGame('exhibit'); return; }
  G.state = 'play';
  G.grace = 6;
  for (const rb of G.robots) if (['chase', 'alert', 'search'].includes(rb.state)) rb.setState('patrol');
  r.setState('retreat');
  const tip = { eye: '한쪽 눈이 흐리다 (Q 렌즈, 오른쪽 클릭 줌)', ear: '소리가 멀다', arm: '손이 굼떠졌다', leg: '더는 뛸 수 없다' }[c.slot.kind];
  ui.caption(tip, 3);
}

/* ── 규칙 위반 (무료 시간) ── */
function violation(kind) {
  if (!isFree()) return;
  for (const r of G.robots) {
    if (!['patrol', 'search', 'alert'].includes(r.state)) continue;
    const d = Math.hypot(r.pos.x - player.x, r.pos.z - player.z);
    const caught = kind === 'noise' ? d < 13 : (r.sees && d < 18);
    if (caught) {
      if (r.state !== 'alert') sound.screech(r.pos.x, r.pos.z);
      r.setState('alert');
      r.lastSeen = { x: player.x, z: player.z };
    }
  }
}

/* ── 살펴보기 ── */
const holdNeed = { bag: 0.9, cabinet: 1.3, case: 1.8 };
function findTarget() {
  const px = player.x, pz = player.z;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const c = cellAt(px, pz);
  if (G.floor !== 0 && c.cx === ELEV.cx && c.cz === ELEV.cz) return { id: 'elev', kind: 'elevator', prompt: 'E  층 말하기' };
  for (const r of G.robots) {
    if (r.state !== 'bow') continue;
    const dx = r.pos.x - px, dz = r.pos.z - pz, d = Math.hypot(dx, dz);
    if (d < 3.8 && (dx * fx + dz * fz) / d > 0.5) return { id: 'r' + r.id, kind: 'ask', robot: r, prompt: G.lit && G.lit.canAsk ? 'E  말을 건다' : '' };
  }
  const L = G.L, taken = G.taken.get(G.floor);
  let best = null, bs = -1;
  for (const it of L.items) {
    if (taken.has(it.id) && it.kind !== 'cabinet') continue;
    if (it.kind === 'cabinet' && G.searched.has(it.id)) continue;
    const dx = it.x - px, dz = it.z - pz, d = Math.hypot(dx, dz);
    const reach = it.kind === 'bed' ? 3.0 : it.kind === 'craft' || it.kind === 'fire' ? 2.4 : 2.0;
    if (d > reach) continue;
    const dot = d < 0.6 ? 1 : (dx * fx + dz * fz) / d;
    if (dot < 0.5) continue;
    if (!los(L, px, pz, it.x - dx / d * 0.5, it.z - dz / d * 0.5)) continue;
    const score = dot - d * 0.15;
    if (score > bs) { bs = score; best = it; }
  }
  if (best) {
    const P = {
      bag: 'E  가방을 뒤진다', cabinet: 'E  서랍을 연다', case: 'E  진열장을 연다', note: 'E  쪽지를 읽는다',
      craft: 'E  양초를 만든다', fire: G.rest ? 'E  일어난다' : 'E  벽난로 앞에 앉는다', bed: 'E  눕는다',
    }[best.kind];
    return { id: best.id, kind: best.kind, item: best, prompt: P };
  }
  if (L.exitDoor) {
    const p = stairFrame(L.exitDoor);
    const dx = p.ox - px, dz = p.oz - pz, d = Math.hypot(dx, dz);
    if (d < 2.4 && (dx * fx + dz * fz) / d > 0.4) return { id: 'exit', kind: 'exit', prompt: 'E  비상문을 연다' };
  }
  return null;
}

function interact() {
  const t = G.target;
  if (!t) return;
  if (holdNeed[t.kind]) { G.hold = { id: t.id, t: 0, need: holdNeed[t.kind] * armMul(), target: t }; return; }
  doAction(t);
}

function takeContent(it) {
  const c = it.content || {};
  const got = [];
  if (c.tool) { G.inv.tools++; got.push('정비 공구'); }
  if (c.kit) { G.inv.kits++; got.push('양초 키트'); }
  if (got.length) { sound.pickup(); ui.caption(`${got.join(', ')}를 챙겼다`, 2.2); }
  else ui.caption(it.kind === 'case' ? '쓸 만한 건 없다' : '아무것도 없다', 1.6);
  if (c.note) later(got.length ? 0.6 : 0.1, () => showNote(c.note));
}
function showNote(id) {
  const n = NOTES.find((x) => x.id === id);
  if (!n) return;
  sound.paper();
  openPanelState();
  ui.note(n, closePanel);
}

function doAction(t) {
  const it = t.item;
  const taken = G.taken.get(G.floor);
  switch (t.kind) {
    case 'elevator':
      openPanelState();
      ui.elevator(G.floor, (f) => {
        closePanel();
        if (f === G.floor) return;
        if (attendant) attendant.nod = 1.4;
        startTransition(f, 'elev', 'elev');
      }, closePanel);
      break;
    case 'ask':
      if (G.lit && G.lit.canAsk) openAsk(t.robot);
      break;
    case 'bag':
      taken.add(it.id);
      G.view.itemMeshes.get(it.id)?.removeFromParent();
      takeContent(it);
      break;
    case 'cabinet':
      G.searched.add(it.id);
      takeContent(it);
      break;
    case 'case':
      taken.add(it.id);
      G.view.itemMeshes.get(it.id)?.removeFromParent();
      sound.clank(it.x, it.z);
      takeContent(it);
      violation('theft');
      if (!isFree()) G.pendingNoise = { x: player.x, z: player.z, r: 9 };
      break;
    case 'note':
      taken.add(it.id);
      G.view.itemMeshes.get(it.id)?.removeFromParent();
      showNote(it.note);
      break;
    case 'craft':
      if (G.inv.kits <= 0) { ui.caption('양초 키트가 없다', 1.8); break; }
      openPanelState();
      ui.craft(Math.random, (cards, name) => {
        const c = CARD_MAP[cards[2]];
        const wax = CFG.waxBase + (cards[2] === '거짓' ? CFG.waxLieBonus : 0);
        G.inv.kits--;
        G.candles.push({ cards, name, fx: c.fx, canAsk: cards.includes('거짓'), honor: cards.includes('명예'), hardenAt: G.gameMin + CFG.hardenMin, waxMax: wax, wax, lit: false });
        G.gameMin += CFG.craftCost * armMul();
        closePanel();
        ui.caption('종이를 접어 품에 넣었다. 굳을 때까지 30분', 3);
      }, closePanel, true);
      break;
    case 'fire':
      G.rest = !G.rest;
      ui.caption(G.rest ? '불 앞에 앉았다. 시간이 빨리 흐른다' : '일어났다', 2);
      break;
    case 'bed':
      openPanelState();
      ui.confirm('침대가 몹시 푹신해 보인다.', '눕는다', '그만둔다', () => { closePanel(); endGame('guest'); }, closePanel);
      break;
    case 'exit':
      if (G.floor === 0 && G.exitFloor !== 0) { ui.caption('문이 열리지 않는다', 2); break; }
      endGame('escape');
      break;
  }
}

/* ── 층 이동 ── */
function startTransition(target, arrival, kind) {
  G.state = 'transition';
  G.trans = { phase: kind === 'elev' ? 'close' : 'fadeout', t: 0, target, arrival, kind };
  G.hold = null; G.rest = false;
  if (G.lit && kind === 'elev') { /* 양초는 계속 탐 */ }
  if (kind === 'elev') sound.doors();
}
function floorIndex(f) { return f > 0 ? f : f + 1; }
function updateTransition(dt) {
  const T = G.trans;
  T.t += dt;
  if (T.phase === 'close') {
    G.view.elevDoors?.set(1 - Math.min(1, T.t / 0.7));
    if (T.t >= 0.8) { T.phase = 'fadeout'; T.t = 0; }
  } else if (T.phase === 'fadeout') {
    ui.fade(Math.min(1, T.t / 0.45));
    if (T.t >= 0.5) {
      G.gameMin += T.kind === 'elev' ? 0.5 + 0.05 * Math.abs(floorIndex(T.target) - floorIndex(G.floor)) : 0.6;
      loadFloor(T.target, T.arrival);
      if (T.kind === 'elev') G.view.elevDoors?.set(0);
      T.phase = 'fadein'; T.t = 0;
    }
  } else if (T.phase === 'fadein') {
    ui.fade(1 - Math.min(1, T.t / 0.45));
    if (T.t >= 0.5) {
      if (T.kind === 'elev') { T.phase = 'open'; T.t = 0; sound.ding(); sound.doors(); }
      else G.state = 'play';
    }
  } else if (T.phase === 'open') {
    G.view.elevDoors?.set(Math.min(1, T.t / 0.7));
    if (T.t >= 0.8) G.state = 'play';
  }
}

function checkTriggers() {
  const L = G.L;
  if (L.hidden && L.hiddenOpen) {
    const p = stairFrame(L.hidden);
    const out = (player.x - p.ox) * p.nx + (player.z - p.oz) * p.nz;
    if (out > 1.3) {
      if (G.floor === 0) startTransition(G.zeroFrom, 'fromZero', 'stairs');
      else { G.zeroFrom = G.floor; startTransition(0, 'stairs', 'stairs'); }
    }
  }
}

/* ── 엔딩 ── */
function endGame(kind) {
  G.state = 'ending';
  if (document.pointerLockElement) document.exitPointerLock();
  if (kind === 'escape') writeSave({ cleared: true });
  const mm = Math.floor(G.gameMin);
  sound.setHeart(0); sound.setChoir(0);
  ui.fade(0);
  ui.ending(ENDINGS[kind], [
    ['관람 시간', `${Math.floor(mm / 60)}시간 ${mm % 60}분`],
    ['질문', `${G.stats.questions}번`],
    ['바뀐 부위', `${G.parts.length}곳`],
  ], () => location.reload());
}

/* ── 매 프레임 ── */
let hudT = 0, lightT = 0, prevFree = true;
function update(dt) {
  if (!G) return;
  G.realT += dt;
  ui.tick(dt);
  sound.update(dt);
  splat.update(dt);
  if (G.state === 'title' || G.state === 'ending' || G.state === 'paused' || G.state === 'panel') { hudTick(dt); return; }
  if (G.state === 'transition') { updateTransition(dt); visuals(dt); return; }
  if (G.state === 'collect') {
    updateCollect(dt);
    if (G.state === 'collect') { visuals(dt); collectCamera(dt); }
    return;
  }

  // 시간
  const lit = G.lit;
  let ts = CFG.timeScale;
  if (lit && lit.fx === 'dream') ts = 2;
  if (G.rest) ts = CFG.timeScale * CFG.restScale;
  const dMin = (dt * ts) / 60;
  G.gameMin += dMin;
  const free = isFree();
  if (prevFree && !free) {
    ui.caption('어디선가 태엽 감기는 소리가 났다', 3);
    G.robots.forEach((r) => sound.creak(r.pos.x, r.pos.z, true));
  }
  prevFree = free;
  for (const p of G.parts) {
    if (p.life <= 0) continue;
    p.life -= dMin * (lit && lit.fx === 'martyr' ? 3 : 1);
    if (p.life <= 0) {
      p.life = 0;
      ui.caption(`${p.label} ${p.art}${iga(p.art)} 멈췄다${G.inv.tools ? ' (R 수리)' : ''}`, 2.8);
      applyPartEffects();
    }
  }
  if (lit) { lit.wax -= dMin; if (lit.wax <= 0) candleOut(lit); }
  for (let i = G.timers.length - 1; i >= 0; i--) {
    G.timers[i].t -= dt;
    if (G.timers[i].t <= 0) { const fn = G.timers[i].fn; G.timers.splice(i, 1); fn(); }
  }
  if (G.state !== 'play') { visuals(dt); return; }

  // 플레이어
  const step = player.update(dt, G.L, { frozen: G.rest, ...playerMods() });
  if (step) sound.step(step === 'run', step === 'crawl');
  const pc = cellAt(player.x, player.z);
  const kind = roomKind(G.L, pc.cx, pc.cz);
  const silent = lit && lit.fx === 'silent';
  G.noise = G.pendingNoise || null;
  G.pendingNoise = null;
  if (player.running && !silent) {
    if (!free) G.noise = { x: player.x, z: player.z, r: 12 };
    if (free && (kind === 'exhibit' || kind === 'mouth' || kind === 'eyes')) violation('noise');
  }
  // 「감정의 힘」
  if (G.view.mouth) {
    const r = G.view.mouth.r;
    const d = Math.hypot(player.x - (r.x + r.w / 2) * S, player.z - (r.y + r.h / 2) * S);
    sound.setChoir(kind === 'mouth' ? 0.3 : 0.3 * clamp(1 - (d - 8) / 24, 0, 1));
    G.screamCd -= dt;
    if (G.view.mouth.scream > 0) G.view.mouth.scream -= dt;
    if (kind === 'mouth' && player.running && !silent && G.screamCd <= 0) {
      G.screamCd = 10;
      G.view.mouth.scream = 3;
      sound.scream();
      ui.caption('액자 속 입들이 일제히 비명을 지른다', 2.5);
      if (free) violation('noise');
      else for (const rb of G.robots) if (['patrol', 'search'].includes(rb.state)) { rb.lastSeen = { x: player.x, z: player.z }; rb.setState('search'); rb.searchT = 9; }
    }
  } else sound.setChoir(0);
  // 「빛나는 시선」: 안에 있는 동안 위치가 들킴
  if (kind === 'eyes' && !free && !(lit && (lit.canAsk || ['ignore', 'confuse', 'martyr'].includes(lit.fx)))) {
    G.eyeT -= dt;
    if (G.eyeT <= 0) {
      G.eyeT = 2.5;
      for (const rb of G.robots) if (['patrol', 'search'].includes(rb.state)) { rb.lastSeen = { x: player.x, z: player.z }; rb.setState('search'); rb.searchT = 8; }
    }
  }

  // 로봇
  const fx = lit ? lit.fx : null;
  const disguise = !!(lit && lit.canAsk);
  const safe = kind === 'lounge' || kind === 'elev';
  const ctx = {
    player: { x: player.x, z: player.z }, free, disguise, safe,
    ignore: disguise || fx === 'ignore' || fx === 'confuse' || fx === 'martyr',
    confuse: fx === 'confuse', slow: fx === 'slow', repel: fx === 'repel',
    grace: G.grace, noise: G.noise, onCatch, onGuideArrive,
  };
  let chase = 0;
  for (const r of G.robots) {
    r.update(dt, ctx);
    if (r.state === 'chase' || r.state === 'alert') chase = Math.max(chase, 1 - Math.hypot(r.pos.x - player.x, r.pos.z - player.z) / 24);
  }
  sound.setHeart(clamp(chase, 0, 1));
  if (G.state !== 'play') { visuals(dt); return; }

  // 렌즈
  G.lens.cd = Math.max(0, G.lens.cd - dt);
  G.lens.t = Math.max(0, G.lens.t - dt);
  const xray = G.lens.t > 0 || fx === 'xray';
  G.robots.forEach((r) => r.setXray(xray));

  // 살펴보기
  G.target = findTarget();
  if (G.hold) {
    if (!player.k('KeyE') || !G.target || G.target.id !== G.hold.id) G.hold = null;
    else {
      G.hold.t += dt;
      if (G.hold.t >= G.hold.need) { const t = G.hold.target; G.hold = null; doAction(t); }
    }
  }
  checkTriggers();
  G.grace = Math.max(0, G.grace - dt);
  visuals(dt);
  hudTick(dt);
}

function visuals(dt) {
  const v = G.view;
  const ctx = { px: player.x, py: player.eye, pz: player.z };
  for (const fn of v.anims) fn(G.realT, dt, ctx);
  // 숨은 문 판이 천장으로 올라감
  if (G.panelAnim) {
    G.panelAnim.t += dt;
    const k = Math.min(1, G.panelAnim.t / 1.8);
    if (v.hiddenPanel) v.hiddenPanel.position.y = DOOR_H / 2 + k * DOOR_H;
    if (k >= 1) {
      G.panelAnim = null;
      G.L.hiddenOpen = true;
      G.hiddenOpened.add(G.floor);
      computeSegs(G.L);
      if (v.stairLight) { v.anchors.push(v.stairLight); lightT = 0; }
      ui.caption('벽 너머로 계단이 나타났다', 2.5);
    }
  }
  if (attendant) {
    attendant.lookAt = { x: player.x, z: player.z, feet: true };
    attendant.syncModel(dt);
  }
  // 카메라
  const bob = player.moving ? Math.sin(G.realT * (player.running ? 13 : 8)) * (player.running ? 0.05 : 0.025) : 0;
  camera.position.set(player.x, player.eye + bob, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  const wantFov = G.zoom && lensAlive() ? 30 : 72;
  if (Math.abs(camera.fov - wantFov) > 0.2) { camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 8); camera.updateProjectionMatrix(); }
  sound.listener(player.x, player.eye, player.z, player.yaw);

  // 조명: 가까운 등만 켬
  lightT -= dt;
  if (lightT <= 0) {
    lightT = 0.25;
    const list = v.anchors.map((a) => ({ a, d: Math.hypot(a.x - player.x, a.z - player.z) * (a.fixed ? 0.6 : 1) })).sort((p, q) => p.d - q.d);
    POOL.forEach((l, i) => {
      const it = list[i];
      if (!it || it.d > 26) { l.intensity = 0; return; }
      l.position.set(it.a.x, it.a.y, it.a.z);
      l.color.setHex(it.a.color);
      l.userData.base = 7 * (it.a.power || 1) * (G.L.theme === 'bronze' ? 0.8 : 1);
    });
    const rs = G.robots.map((r) => ({ r, d: Math.hypot(r.pos.x - player.x, r.pos.z - player.z) })).sort((p, q) => p.d - q.d);
    G.robots.forEach((r) => (r.light = null));
    SPOTS.forEach((s, i) => {
      const it = rs[i];
      if (!it || it.d > 30) { s.intensity = 0; return; }
      it.r.light = s;
      s.intensity = 26;
    });
  }
  POOL.forEach((l, i) => { if (l.userData.base) l.intensity = l.userData.base * (0.92 + 0.08 * Math.sin(G.realT * 7 + i * 2.1)); });
  if (G.lit) {
    candleLight.intensity = 5 * (0.85 + 0.15 * Math.sin(G.realT * 17) * Math.sin(G.realT * 5.3));
    candleLight.position.set(player.x - Math.sin(player.yaw) * 0.5, player.eye + 0.4, player.z - Math.cos(player.yaw) * 0.5);
  } else candleLight.intensity = 0;
  drawRipples();
}

function drawRipples() {
  rctx.clearRect(0, 0, ripples.width, ripples.height);
  if (!G || G.state !== 'play' || !earAlive()) return;
  const cx = ripples.width / 2, cy = ripples.height / 2, R = Math.min(cx, cy) * 0.42;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
  for (const r of G.robots) {
    const dx = r.pos.x - player.x, dz = r.pos.z - player.z, d = Math.hypot(dx, dz);
    if (d > 24) continue;
    const th = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) - Math.PI / 2;
    const a = (1 - d / 24) * (r.speed > 0.2 ? 0.9 : 0.4);
    const pulse = 1 + 0.06 * Math.sin(G.realT * (r.speed > 3 ? 18 : 8));
    rctx.strokeStyle = `rgba(102,224,255,${a.toFixed(3)})`;
    rctx.lineWidth = 3 + (1 - d / 24) * 4;
    rctx.beginPath();
    rctx.arc(cx, cy, R * pulse, th - 0.22, th + 0.22);
    rctx.stroke();
  }
}

function hudTick(dt) {
  hudT -= dt;
  if (hudT > 0 || !G || !G.L) return;
  hudT = 0.1;
  ui.hud({
    gameMin: G.gameMin, floor: G.floor, memo: memoText(),
    tools: G.inv.tools, kits: G.inv.kits,
    candles: G.candles.map((c) => ({ name: c.name, lit: c.lit, ready: G.gameMin >= c.hardenAt, left: c.hardenAt - G.gameMin, wax: clamp(c.wax / c.waxMax, 0, 1) })),
    parts: G.parts,
    prompt: G.state === 'play' && G.target ? G.target.prompt : '',
    hold: G.hold ? G.hold.t / G.hold.need : 0,
    stamina: player.stamina / CFG.stamina,
    lens: lensAlive() && G.lens.cd > 0 ? 1 - G.lens.cd / 20 : null,
  });
}

/* ── 해상도 자동 조절 ── */
let perfAcc = 0, perfN = 0;
function adapt(dt) {
  perfAcc += dt; perfN++;
  if (perfAcc < 2) return;
  const avg = perfAcc / perfN;
  perfAcc = 0; perfN = 0;
  if (avg > 1 / 36 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); resize(); }
}

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  update(dt);
  if (G && G.L) renderer.render(scene, camera);
  // 창이 가려져 프레임이 느려진 건 성능 문제가 아니므로 무시
  if (G && G.state === 'play' && !document.hidden && raw < 0.1) adapt(raw);
  requestAnimationFrame(frame);
}

/* ── 시작 화면 ── */
G = freshState('story');
ui.title(!!loadSave().cleared, startGame);
requestAnimationFrame(frame);

// 시험용 손잡이 (콘솔에서 __bm)
window.__bm = {
  get G() { return G; }, player, ui, sound, scene, camera, renderer, splat,
  start: startGame,
  step(sec = 1, dt = 1 / 30) { for (let t = 0; t < sec; t += dt) update(dt); renderer.render(scene, camera); },
  render() { renderer.render(scene, camera); },
  tp(cx, cz, yaw) { const c = center(cx, cz); player.x = c.x; player.z = c.z; if (yaw !== undefined) player.yaw = yaw; },
  floor(f, arrival = 'elev') { loadFloor(f, arrival); },
  give(o = {}) { if (o.tools) G.inv.tools += o.tools; if (o.kits) G.inv.kits += o.kits; if (o.candle) { const cards = o.candle; const c = CARD_MAP[cards[2]]; G.candles.push({ cards, name: o.name || cards.join(''), fx: c.fx, canAsk: cards.includes('거짓'), honor: cards.includes('명예'), hardenAt: 0, waxMax: 40, wax: 40, lit: false }); } },
  ask: (r, q, v) => askRobot(r, q, v),
  act: () => G.target && doAction(G.target),
  catchMe: () => G.robots[0] && onCatch(G.robots[0]),
  toggleCandle,
};
