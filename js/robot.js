// 안내원: 거미 같은 몸통, 바늘 다리 여덟, 머리에 가스등 여덟
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { center, cellAt, idx, findPath, W, S } from './level.js';
import { angleDiff, clamp } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const L1 = 1.3, L2 = 2.6;   // 걷는 다리: 짧은 넓적다리 + 긴 바늘 정강이 → 무릎이 머리보다 높이 솟음
const F1 = 1.15, F2 = 1.6;  // 앞다리 한 쌍: 더듬거나 치켜드는 팔
const LEG_ANG = [0.45, 1.05, 2.05, 2.7, -0.45, -1.05, -2.05, -2.7]; // 앞(+z 로컬) 기준 각도
const GROUP = [0, 1, 0, 1, 1, 0, 1, 0];

let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    metal: new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x6a5a40 }),
    glass: new THREE.MeshPhongMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.22, shininess: 140, specular: 0xffffff, depthWrite: false }),
    fluid: new THREE.MeshPhongMaterial({ color: 0x6a0000, emissive: 0x2a0000, shininess: 90, specular: 0x804040 }),
    core: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffd060 }),
    lampRed: new THREE.MeshBasicMaterial({ color: 0xff3a24 }),
    xray: new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }),
  };
  return MAT;
}

/* ── 모양 만드는 도구 ── */
const COL = { iron: 0x2a251e, iron2: 0x3d352b, plate: 0x1c1915, brass: 0xa07a36, brassDk: 0x6e5226, steel: 0x9a9890, steelDk: 0x55524c, rubber: 0x151311, stain: 0x5a0705, stain2: 0x2e0302 };
const _c = new THREE.Color();
// 색을 꼭짓점에 칠함 (재질 하나로 여러 금속을 그리기 위해)
function paint(geo, col) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, n = pos.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _c.setHex(typeof col === 'function' ? col(pos.getX(i), pos.getY(i), pos.getZ(i)) : col);
    arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function put(list, geo, col, p, r, s) {
  const g = geo.clone();
  if (s) g.scale(s[0], s[1], s[2]);
  if (r && r.isQuaternion) g.applyQuaternion(r);
  else if (r) { g.rotateX(r[0]); g.rotateY(r[1]); g.rotateZ(r[2]); }
  if (p) g.translate(p[0], p[1], p[2]);
  list.push(paint(g, col));
}
function merged(list) { const g = mergeGeometries(list); g._shared = true; return g; }
const sph = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const tor = (R, t, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(R, t, rs, ts, arc);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
function gearGeo(r, teeth, depth, thick, hole = 0, sharp = false) {
  const s = new THREE.Shape();
  const n = teeth * 4;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, q = i % 4;
    const rr = sharp ? (q === 1 ? r : r - depth) : (q === 1 || q === 2 ? r : r - depth);
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  if (hole) { const h = new THREE.Path(); h.absarc(0, 0, hole, 0, Math.PI * 2, true); s.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -thick / 2);
  return g;
}
// 굵기가 줄어드는 관 (송곳니, 더듬이, 호스)
function taper(points, r0, r1, seg = 14, rad = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const fr = curve.computeFrenetFrames(seg, false);
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, p = curve.getPointAt(t), r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2, N = fr.normals[i], B = fr.binormals[i];
      pos.push(p.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), p.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), p.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// 관의 위치(0~1)에 따라 색이 바뀌게: 시작점에서 거리로 근사
function byDist(origin, len, stops) {
  return (x, y, z) => {
    const t = Math.hypot(x - origin[0], y - origin[1], z - origin[2]) / len;
    for (const [lim, col] of stops) if (t <= lim) return col;
    return stops[stops.length - 1][1];
  };
}

/* ── 공용 모양 (한 번만 만들어 모든 안내원이 나눠 씀) ── */
const ABD = { y: -0.18, z: -0.2, len: 1.05, tilt: 0.35 };
let GEO = null, GEO_LEG = null;
function abdR(u) { return 0.36 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04 + 0.03)), 0.62) * (0.92 + 0.08 * Math.pow(Math.abs(Math.sin(u * Math.PI * 6)), 0.35)); }
function geos() {
  if (GEO) return GEO;
  const abdM = new THREE.Matrix4().compose(new THREE.Vector3(0, ABD.y, ABD.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - ABD.tilt, 0, 0)), new THREE.Vector3(1, 1, 1));
  const abdP = (y, zr) => new THREE.Vector3(0, y, zr).applyMatrix4(abdM); // 배 안쪽 좌표 → 몸통 좌표

  /* 몸통 */
  const body = [];
  const tho = [[0, -0.36], [0.14, -0.34], [0.24, -0.27], [0.3, -0.16], [0.32, -0.04], [0.315, 0.06], [0.29, 0.16], [0.24, 0.25], [0.16, 0.32], [0.07, 0.36], [0, 0.37]].map(([r, y]) => new THREE.Vector2(r, y));
  put(body, new THREE.LatheGeometry(tho, 18), COL.iron, null, null, [1, 1, 0.86]);
  // 겹친 철판 테두리와 리벳
  for (const [y, R] of [[-0.17, 0.302], [0.0, 0.318], [0.17, 0.284]]) {
    put(body, tor(R, 0.016, 5, 28), COL.brass, [0, y, 0], [Math.PI / 2, 0, 0], [1, 0.86, 1]);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      put(body, sph(0.013, 5, 4), COL.brassDk, [Math.cos(a) * (R + 0.012), y + 0.022, Math.sin(a) * (R + 0.012) * 0.86]);
    }
  }
  // 가슴: 앞쪽을 감싼 갈비뼈 철창과 가운데 뼈대
  const thoR = (y) => { for (let i = 1; i < tho.length; i++) if (tho[i].y >= y) { const a = tho[i - 1], b = tho[i], k = (y - a.y) / (b.y - a.y); return a.x + (b.x - a.x) * k; } return 0; };
  for (const y of [0.22, 0.12, 0.02, -0.08, -0.18, -0.27]) {
    const R = thoR(y) + 0.026, arc = 2.0;
    put(body, tor(R, 0.011, 4, 14, arc), COL.brassDk, [0, y, 0], [Math.PI / 2, arc / 2 - Math.PI / 2, 0], [1, 0.86, 1]);
  }
  put(body, taper([[0, 0.3, 0.2], [0, 0.12, 0.3], [0, -0.08, 0.31], [0, -0.28, 0.24]], 0.02, 0.014, 12, 6), COL.brass);
  // 다리 관절 받침
  const LEG_ANG0 = [0.45, 1.05, 2.05, 2.7, -0.45, -1.05, -2.05, -2.7];
  for (const a of LEG_ANG0) {
    put(body, sph(0.062, 10, 8), COL.brass, [Math.sin(a) * 0.29, -0.08, Math.cos(a) * 0.24]);
    put(body, tor(0.06, 0.012, 5, 14), COL.brassDk, [Math.sin(a) * 0.27, -0.08, Math.cos(a) * 0.225], [0, a, 0]);
  }
  // 배: 마디진 철갑
  const prof = [];
  for (let i = 0; i <= 48; i++) { const u = i / 48; prof.push(new THREE.Vector2(abdR(u), u * ABD.len)); }
  const abd = [];
  put(abd, new THREE.LatheGeometry(prof, 18), COL.iron, null, null, [1, 1, 0.82]);
  for (let k = 1; k <= 5; k++) {
    const u = k / 6, R = abdR(u) * 0.97 + 0.012;
    put(abd, tor(R, 0.014, 5, 28), COL.brass, [0, u * ABD.len, 0], [Math.PI / 2, 0, 0], [1, 0.82, 1]);
  }
  // 등에 난 짧은 가시 줄
  for (let k = 0; k < 7; k++) {
    const u = 0.12 + k * 0.11, zr = abdR(u) * 0.82;
    put(abd, cone(0.022, 0.12, 5), COL.iron2, [0, u * ABD.len, zr + 0.04], [Math.PI / 2 - 0.5, 0, 0]);
  }
  // 꽁무니 배기관
  for (const [x, z] of [[0.05, 0.03], [-0.05, 0.03], [0, -0.04]]) put(abd, cyl(0.022, 0.026, 0.12, 8), COL.brassDk, [x, ABD.len + 0.02, z]);
  // 유리 돔 받침과 태엽 열쇠 구멍
  const domeU = 0.42, keyU = 0.76;
  put(abd, tor(0.155, 0.018, 6, 24), COL.brass, [0, domeU * ABD.len, abdR(domeU) * 0.82 - 0.02]);
  put(abd, cyl(0.045, 0.05, 0.05, 10), COL.brass, [0, keyU * ABD.len, abdR(keyU) * 0.82], [Math.PI / 2, 0, 0]);
  for (const g of abd) { g.applyMatrix4(abdM); body.push(g); }
  // 머리에서 몸통으로 들어가는 고무 호스
  for (const s of [1, -1]) {
    put(body, taper([[s * 0.09, 0.42, 0.02], [s * 0.2, 0.34, -0.12], [s * 0.23, 0.1, -0.26], [s * 0.16, -0.1, -0.38]], 0.018, 0.016, 16, 6), COL.rubber);
    for (let k = 0; k < 4; k++) put(body, tor(0.021, 0.006, 4, 10), COL.brassDk, [s * (0.15 + k * 0.025), 0.39 - k * 0.07, -0.05 - k * 0.06], [0.6, s * 0.9, 0]);
  }
  const domeC = abdP(domeU * ABD.len, abdR(domeU) * 0.82 - 0.02);
  const keyC = abdP(keyU * ABD.len, abdR(keyU) * 0.82 + 0.02);
  const abdQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 - ABD.tilt, 0, 0));
  // 돔 안쪽이 위(+z)를 보도록: 배 좌표의 +z가 몸통에서 위쪽
  const domeGlass = new THREE.SphereGeometry(0.15, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGlass.rotateX(Math.PI / 2);
  domeGlass._shared = true;

  /* 톱니 (돔 안에서 돈다) */
  const g1 = merged([paint(gearGeo(0.085, 12, 0.018, 0.018, 0.02), COL.brass), paint(cyl(0.012, 0.012, 0.05, 6).rotateX(Math.PI / 2), COL.steelDk)]);
  const g2 = merged([paint(gearGeo(0.055, 8, 0.016, 0.016, 0.012), COL.brassDk)]);
  const g3 = merged([paint(gearGeo(0.045, 8, 0.014, 0.014), COL.brass)]);

  /* 태엽 열쇠: 축은 +z */
  const key = [];
  put(key, cyl(0.018, 0.018, 0.16, 8), COL.brass, [0, 0, 0.08], [Math.PI / 2, 0, 0]);
  put(key, sph(0.03, 8, 6), COL.brass, [0, 0, 0.17]);
  for (const s of [1, -1]) put(key, tor(0.07, 0.017, 6, 18), COL.brass, [s * 0.078, 0, 0.25], [Math.PI / 2, 0, 0]);
  put(key, new THREE.BoxGeometry(0.06, 0.02, 0.06), COL.brassDk, [0, 0, 0.21]);
  const keyG = merged(key);

  /* 머리 */
  const head = [];
  const HR = [0.23, 0.17, 0.22];
  put(head, sph(0.5, 20, 14), COL.iron, null, null, [HR[0] * 2, HR[1] * 2, HR[2] * 2]);
  for (const s of [1, -1]) put(head, cyl(0.016, 0.012, 0.14, 6), COL.brass, [s * 0.08, 0.128, 0.138], [0, 0, Math.PI / 2 + s * 0.32]); // 성난 눈썹
  put(head, tor(0.225, 0.016, 5, 28), COL.brassDk, [0, -0.04, 0], [Math.PI / 2, 0, 0], [1, 0.96, 1]);
  for (let k = 0; k < 5; k++) { const z = 0.07 - k * 0.06; put(head, cone(0.02, 0.1 - k * 0.01, 5), COL.iron2, [0, HR[1] * Math.sqrt(Math.max(0, 1 - (z / HR[2]) ** 2)) - 0.005, z], [-0.55 - k * 0.12, 0, 0]); } // 정수리 가시
  // 입가 쇠창살
  for (let k = 0; k < 4; k++) { const y = -0.06 - k * 0.025, f = Math.sqrt(1 - (y / HR[1]) ** 2); put(head, cyl(0.007, 0.007, HR[0] * 1.5 * f, 5), COL.brassDk, [0, y, HR[2] * f + 0.008], [0, 0, Math.PI / 2]); }
  // 거미 눈 배치의 가스등: 큰 눈 둘, 옆 눈 둘, 위 작은 눈 넷
  const EYES = [[0.055, 0.0, 0.046], [-0.055, 0.0, 0.046], [0.135, 0.025, 0.033], [-0.135, 0.025, 0.033], [0.042, 0.092, 0.024], [-0.042, 0.092, 0.024], [0.112, 0.098, 0.02], [-0.112, 0.098, 0.02]];
  const glass = [], cores = [], haloPts = [];
  for (const [x, y, r] of EYES) {
    const z = HR[2] * Math.sqrt(Math.max(0.05, 1 - (x / HR[0]) ** 2 - (y / HR[1]) ** 2));
    const n = new THREE.Vector3(x / HR[0] ** 2, y / HR[1] ** 2, z / HR[2] ** 2).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const c = new THREE.Vector3(x, y, z).addScaledVector(n, r * 0.35);
    put(head, cyl(r * 1.25, r * 1.1, r * 0.8, 12).rotateX(Math.PI / 2), COL.brassDk, [c.x - n.x * r * 0.3, c.y - n.y * r * 0.3, c.z - n.z * r * 0.3], q);
    put(head, tor(r * 1.05, r * 0.14, 4, 12), COL.brass, [c.x + n.x * r * 0.25, c.y + n.y * r * 0.25, c.z + n.z * r * 0.25], q);
    for (const a of [0, Math.PI / 2]) put(head, tor(r * 0.98, r * 0.07, 3, 10, Math.PI).rotateX(Math.PI / 2).rotateZ(a), COL.brassDk, [c.x, c.y, c.z], q); // 등 철망
    const gl = sph(r * 0.95, 10, 8); gl.translate(c.x, c.y, c.z); glass.push(paint(gl, 0xffffff));
    const co = sph(r * 0.5, 8, 6); co.translate(c.x, c.y, c.z); cores.push(paint(co, 0xffffff));
    haloPts.push(c.x + n.x * r * 0.6, c.y + n.y * r * 0.6, c.z + n.z * r * 0.6);
  }
  // 더듬이 다리(촉지) 한 쌍
  for (const s of [1, -1]) {
    put(head, taper([[s * 0.12, -0.08, 0.12], [s * 0.2, -0.17, 0.24], [s * 0.18, -0.3, 0.33], [s * 0.13, -0.4, 0.36]], 0.024, 0.008, 12, 6), byDist([s * 0.12, -0.08, 0.12], 0.42, [[0.35, COL.iron2], [0.6, COL.brass], [1.2, COL.steelDk]]));
    put(head, sph(0.026, 8, 6), COL.brass, [s * 0.2, -0.18, 0.245]);
  }
  // 송곳니: 회전축은 머리 아래 (z축으로 벌어짐)
  const fang = (s) => merged([
    paint(taper([[0, 0, 0], [s * 0.03, -0.1, 0.07], [s * 0.0, -0.22, 0.09], [-s * 0.04, -0.3, 0.05]], 0.032, 0.002, 16, 7), byDist([0, 0, 0], 0.36, [[0.25, COL.brass], [0.62, COL.iron2], [0.8, COL.stain], [2, COL.stain2]])),
    paint(sph(0.04, 8, 6), COL.brassDk),
  ]);

  /* 수술 팔: 주사기 (축 +z) */
  const syr = [], syrGlass = [], syrFluid = [];
  put(syr, cyl(0.013, 0.013, 0.26, 6), COL.brassDk, [0, 0, 0.13], [Math.PI / 2, 0, 0]);
  put(syr, sph(0.03, 8, 6), COL.brass);
  put(syr, tor(0.04, 0.008, 4, 12), COL.brass, [0, 0, 0.27]);
  put(syr, tor(0.04, 0.008, 4, 12), COL.brass, [0, 0, 0.47]);
  put(syr, cyl(0.006, 0.006, 0.12, 5), COL.steel, [0, 0, 0.2], [Math.PI / 2, 0, 0]);
  put(syr, cyl(0.03, 0.03, 0.01, 10), COL.brass, [0, 0, 0.26], [Math.PI / 2, 0, 0]);
  put(syr, cyl(0.004, 0.016, 0.04, 8), COL.brass, [0, 0, 0.49], [Math.PI / 2, 0, 0]);
  put(syr, cyl(0.0012, 0.0035, 0.16, 5), (x, y, z) => (z > 0.6 ? COL.stain : COL.steel), [0, 0, 0.59], [Math.PI / 2, 0, 0]);
  syrGlass.push(paint(cyl(0.036, 0.036, 0.2, 12).rotateX(Math.PI / 2).translate(0, 0, 0.37), 0xffffff));
  syrFluid.push(paint(cyl(0.03, 0.03, 0.15, 10).rotateX(Math.PI / 2).translate(0, 0, 0.395), 0xffffff));
  /* 수술 팔: 원형 톱 (축 x) */
  const saw = [];
  put(saw, cyl(0.013, 0.013, 0.24, 6), COL.brassDk, [0, 0, 0.12], [Math.PI / 2, 0, 0]);
  put(saw, sph(0.03, 8, 6), COL.brass);
  const sawDisc = merged([
    paint(gearGeo(0.085, 22, 0.018, 0.006, 0.0, true).rotateY(Math.PI / 2), (x, y, z) => (Math.hypot(y, z) > 0.07 && y < 0.02 ? COL.stain : COL.steel)),
    paint(cyl(0.02, 0.02, 0.03, 8).rotateZ(Math.PI / 2), COL.brass),
  ]);

  GEO_LEG = (l1, l2) => {
  /* 다리 위 마디 (y축 0→l1, z쪽이 윗면) */
  const up = [];
  const U = l1 / 1.25;
  put(up, cyl(0.026, 0.046, l1, 6), COL.iron, [0, l1 / 2, 0]);
  put(up, sph(0.06, 10, 8), COL.brass);
  for (const y of [0.1, 0.62, 1.17]) put(up, cyl(0.054, 0.054, 0.05, 8), COL.brass, [0, y * U, 0]);
  put(up, cyl(0.019, 0.019, 0.5 * U, 8), COL.brass, [0, 0.38 * U, 0.07]);           // 유압 실린더
  put(up, cyl(0.009, 0.009, 0.5 * U, 6), COL.steel, [0, 0.84 * U, 0.07]);           // 피스톤 막대
  for (const y of [0.14, 1.08]) put(up, new THREE.BoxGeometry(0.022, 0.03, 0.075), COL.brassDk, [0, y * U, 0.037]);
  for (let k = 0; k < 7; k++) put(up, cone(0.01, 0.1, 4), COL.iron2, [0, (0.25 + k * 0.15) * U, -0.04], [-0.9, 0, 0]); // 다리 가시
  for (let k = 0; k < 8; k++) put(up, sph(0.008, 4, 3), COL.brassDk, [k % 2 ? 0.03 : -0.03, (0.2 + k * 0.12) * U, 0.012]);
  /* 다리 아래 마디 (무릎 0 → 바늘 끝 l2) */
  const lo = [];
  put(lo, gearGeo(0.075, 10, 0.016, 0.034, 0.0), COL.brass, null, [0, Math.PI / 2, 0]); // 무릎 톱니 (축 x)
  put(lo, cyl(0.026, 0.026, 0.09, 10), COL.steelDk, null, [0, 0, Math.PI / 2]);
  const V = l2 / 1.55;
  const tib = [[0, 0.02], [0.034, 0.05], [0.037, 0.12], [0.029, 0.145], [0.033, 0.2], [0.03, 0.5], [0.024, 0.85], [0.018, 1.1], [0.0225, 1.115], [0.0225, 1.17], [0.012, 1.19], [0.009, 1.3], [0.006, 1.42], [0.0025, 1.52], [0, 1.55]].map(([r, y]) => new THREE.Vector2(r * (y < 0.2 ? 1 : 1.12), y < 0.2 ? y : y * V));
  put(lo, new THREE.LatheGeometry(tib, 8), (x, y) => (y > 1.105 * V && y < 1.18 * V ? COL.brass : y > 1.42 * V ? COL.stain2 : y > 1.3 * V ? COL.stain : y < 0.16 ? COL.steelDk : COL.steel));
  for (let k = 0; k < 3; k++) put(lo, cone(0.006, 0.05, 4), k === 2 ? COL.stain : COL.steel, [0, (1.24 + k * 0.08) * V, 0.009], [Math.PI - 0.6, 0, 0]); // 미늘
  for (let k = 0; k < 4; k++) put(lo, sph(0.008, 4, 3), COL.brassDk, [0, 0.2 + k * 0.07, 0.033]);
  return { up: merged(up), lo: merged(lo) };
  };

  GEO = {
    body: merged(body), domeGlass, domeC, keyC, abdQ, g1, g2, g3, key: keyG,
    head: merged(head), glass: merged(glass), cores: merged(cores), halo: (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(haloPts, 3)); g._shared = true; return g; })(), fangL: fang(1), fangR: fang(-1),
    syr: merged(syr), syrGlass: merged(syrGlass), syrFluid: merged(syrFluid), saw: merged(saw), sawDisc,
    legB: GEO_LEG(L1, L2), legF: GEO_LEG(F1, F2),
  };
  return GEO;
}

let HALO = null;
function haloTex() {
  if (HALO) return HALO;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  HALO = new THREE.CanvasTexture(c);
  return HALO;
}
const G_SPH = new THREE.SphereGeometry(0.5, 16, 12);
G_SPH._shared = true;

export function buildRobotModel(parent, scale = 1) {
  const M = mats(), Q = geos();
  const mesh = (g, m) => new THREE.Mesh(g, m);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(mesh(Q.body, M.metal));
  const dome = mesh(Q.domeGlass, M.glass);
  dome.position.copy(Q.domeC); dome.quaternion.copy(Q.abdQ);
  body.add(dome);
  // 돔 안 톱니와 불빛
  const gears = new THREE.Group();
  gears.position.copy(Q.domeC); gears.quaternion.copy(Q.abdQ);
  body.add(gears);
  const gA = mesh(Q.g1, M.metal); gA.position.set(0.02, 0, 0.03);
  const gB = mesh(Q.g2, M.metal); gB.position.set(-0.112, 0.02, 0.05);
  const gC = mesh(Q.g3, M.metal); gC.position.set(0.06, -0.105, 0.065);
  const glow = mesh(sph(0.05, 8, 6), M.core); glow.position.set(0, 0, 0.0);
  gears.add(gA, gB, gC, glow);
  // 태엽 열쇠
  const keyP = new THREE.Group();
  keyP.position.copy(Q.keyC); keyP.quaternion.copy(Q.abdQ);
  const key = mesh(Q.key, M.metal);
  keyP.add(key); body.add(keyP);
  // 수술 팔 둘 (가슴 아래)
  const syr = new THREE.Group(); syr.position.set(0.13, -0.26, 0.2);
  syr.add(mesh(Q.syr, M.metal), mesh(Q.syrFluid, M.fluid), mesh(Q.syrGlass, M.glass));
  const sawArm = new THREE.Group(); sawArm.position.set(-0.13, -0.26, 0.2);
  const disc = mesh(Q.sawDisc, M.metal); disc.position.set(0, 0, 0.26);
  sawArm.add(mesh(Q.saw, M.metal), disc);
  body.add(syr, sawArm);

  const head = new THREE.Group();
  head.position.set(0, 0.48, 0.12);
  body.add(head);
  head.add(mesh(Q.head, M.metal));
  head.add(mesh(Q.glass, M.glass));
  const core = mesh(Q.cores, M.lamp);
  head.add(core);
  const halo = new THREE.Points(Q.halo, new THREE.PointsMaterial({ map: haloTex(), color: 0xffb040, size: 0.2, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
  head.add(halo);
  const fangL = new THREE.Group(); fangL.position.set(0.065, -0.11, 0.162); fangL.add(mesh(Q.fangL, M.metal));
  const fangR = new THREE.Group(); fangR.position.set(-0.065, -0.11, 0.162); fangR.add(mesh(Q.fangR, M.metal));
  head.add(fangL, fangR);
  const lampTarget = new THREE.Object3D();
  lampTarget.position.set(0, -1.2, 3);
  head.add(lampTarget);
  // 엑스레이로 비칠 때 쓰는 겉모습
  const xr = new THREE.Group();
  for (const [p, s] of [[[0, 0, 0], [0.66, 0.8, 0.58]], [[0, -0.38, -0.72], [0.74, 0.62, 1.1]], [[0, 0.48, 0.12], [0.48, 0.36, 0.46]]]) {
    const m = new THREE.Mesh(G_SPH, M.xray); m.position.set(...p); m.scale.set(...s); m.renderOrder = 999; xr.add(m);
  }
  xr.visible = false;
  body.add(xr);

  const legs = [];
  for (let i = 0; i < 8; i++) {
    const a = LEG_ANG[i];
    const front = i === 0 || i === 4;
    const lg = front ? Q.legF : Q.legB;
    const up = mesh(lg.up, M.metal), lo = mesh(lg.lo, M.metal);
    parent.add(up, lo);
    legs.push({ a, up, lo, front, side: a > 0 ? 1 : -1, l1: front ? F1 : L1, l2: front ? F2 : L2, hipLocal: new THREE.Vector3(Math.sin(a) * 0.28, -0.08, Math.cos(a) * 0.22), foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, group: GROUP[i] });
  }
  root.scale.setScalar(scale);
  parent.add(root);
  return { root, body, head, core, halo, lamps: [core], legs, lampTarget, xr, scale, gears: [gA, gB, gC], glow, key, fangL, fangR, syr, sawArm, disc };
}

const _h = new THREE.Vector3(), _f = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _k = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Vector3();

const _n = new THREE.Vector3(), _ly = new THREE.Vector3(), _lz = new THREE.Vector3(), _lx = new THREE.Vector3(), _m4 = new THREE.Matrix4();
function placeLeg(mesh, a, b, geoLen, sc) {
  _ly.subVectors(b, a);
  const len = _ly.length() || 1e-4;
  _ly.divideScalar(len);
  _lz.crossVectors(_n, _ly).normalize();
  _lx.crossVectors(_ly, _lz);
  _m4.makeBasis(_lx, _ly, _lz);
  mesh.quaternion.setFromRotationMatrix(_m4);
  mesh.position.copy(a);
  mesh.scale.set(sc, len / geoLen, sc);
}

export class Robot {
  constructor(world, cell, zone, id) {
    this.world = world;
    this.id = id;
    this.zone = zone;
    const c = center(cell % W, (cell / W) | 0);
    this.pos = new THREE.Vector3(c.x, 0, c.z);
    this.yaw = Math.random() * Math.PI * 2;
    this.model = buildRobotModel(world.group, 1);
    this.state = 'patrol';
    this.path = null; this.pi = 0;
    this.wait = Math.random() * 2;
    this.speed = 0;
    this.lastSeen = null;
    this.lostT = 0;
    this.seeTick = Math.random() * 0.15;
    this.sees = false;
    this.bow = 0;            // 0 서 있음 ~ 1 웅크려 인사
    this.nod = 0;            // 끄덕임 애니메이션 시간
    this.asked = 0;
    this.broken = false;     // 사칭이 들통남
    this.stateT = 0;
    this.creakT = 2 + Math.random() * 4;
    this.headYaw = 0; this.headPitch = 0;
    this.lookAt = null;
    this.walkPhase = 0;
    this.light = null;
    this.vel = new THREE.Vector3();
    for (const L of this.model.legs) {
      this.homeOf(L, _f);
      L.foot.copy(_f); L.from.copy(_f); L.to.copy(_f);
    }
    this.syncModel(0);
  }

  get cell() { const c = cellAt(this.pos.x, this.pos.z); return idx(c.cx, c.cz); }

  homeOf(L, out) {
    const tuck = this.bow;
    const r = 1.75 * (1 - tuck * 0.1);
    const a = this.yaw + L.a;
    out.set(this.pos.x + Math.sin(a) * r, 0, this.pos.z + Math.cos(a) * r);
    return out;
  }

  setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; this.path = null; } }

  goTo(cell, forbid) {
    const p = findPath(this.world.L, this.cell, cell, forbid);
    this.path = p; this.pi = 0;
    return !!p;
  }

  // 길 따라 걷기. 목적지에 닿으면 true
  follow(dt, speed) {
    let tx, tz;
    if (this.path && this.pi < this.path.length) {
      const c = this.path[this.pi];
      const p = center(c % W, (c / W) | 0);
      tx = p.x; tz = p.z;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 0.35) { this.pi++; return this.pi >= this.path.length; }
    } else return true;
    this.steer(dt, tx, tz, speed);
    return false;
  }

  steer(dt, tx, tz, speed) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const want = Math.atan2(dx, dz);
    const diff = angleDiff(want, this.yaw);
    this.yaw += clamp(diff, -dt * 5, dt * 5);
    const mv = Math.min(d, speed * dt) * (Math.abs(diff) > 1.4 ? 0.3 : 1);
    const nx = this.pos.x + (dx / d) * mv, nz = this.pos.z + (dz / d) * mv;
    const r = this.world.collide(nx, nz, 0.42);
    this.vel.set((r.x - this.pos.x) / dt, 0, (r.z - this.pos.z) / dt);
    this.pos.x = r.x; this.pos.z = r.z;
    this.speed = mv / dt;
  }

  canSee(px, pz) {
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 17) return false;
    const a = Math.abs(angleDiff(Math.atan2(dx, dz), this.yaw + this.headYaw));
    if (a > 0.85 && d > 2.2) return false;
    return this.world.los(this.pos.x, this.pos.z, px, pz);
  }

  inZone(cell) { return this.world.zoneOf(cell) === this.zone; }

  update(dt, ctx) {
    this.stateT += dt;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    if (this.state !== 'patrol' && !(this.state === 'chase' || this.state === 'alert')) this.headYaw *= 0.9;
    if ((this.state === 'chase' || this.state === 'alert') && this.sees) this.headYaw *= 0.8;
    const P = ctx.player;
    const dist = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    this.seeTick -= dt;
    if (this.seeTick <= 0) { this.seeTick = 0.15; this.sees = !ctx.confuse && !ctx.safe && this.canSee(P.x, P.z); }
    const hostile = !ctx.ignore || this.broken;
    const slow = ctx.slow ? 0.5 : 1;
    const deep = Math.min(1, this.world.L.depth / 25);
    const forbid = this.world.forbid;

    // 사칭 양초 앞에서는 웅크려 인사
    const wantBow = ctx.disguise && !this.broken && dist < 4.6 && (this.sees || dist < 2.5) && !['guide', 'answer', 'point', 'stun', 'retreat'].includes(this.state);
    if (wantBow && this.state !== 'bow') this.setState('bow');

    switch (this.state) {
      case 'bow': {
        this.lookAt = { x: P.x, z: P.z, feet: true };
        const want = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
        this.yaw += clamp(angleDiff(want, this.yaw), -dt * 3, dt * 3);
        if (!ctx.disguise || this.broken || dist > 6) this.setState('patrol');
        break;
      }
      case 'answer': {
        this.lookAt = { x: P.x, z: P.z, feet: true };
        if (this.stateT > 2.2) this.setState(ctx.disguise ? 'bow' : 'patrol');
        break;
      }
      case 'point': { // 엘리베이터 쪽을 비춤
        if (this.pointAt) {
          const want = Math.atan2(this.pointAt.x - this.pos.x, this.pointAt.z - this.pos.z);
          this.yaw += clamp(angleDiff(want, this.yaw), -dt * 2, dt * 2);
          this.lookAt = { x: this.pointAt.x, z: this.pointAt.z };
        }
        if (this.stateT > 3) this.setState(ctx.disguise ? 'bow' : 'patrol');
        break;
      }
      case 'guide': {
        if (!ctx.disguise && !this.guideArrived) { this.broken = true; this.setState('chase'); break; }
        if (!this.path && !this.guideArrived) this.goTo(this.guideCell, null);
        if (!this.guideArrived) {
          if (dist > 7) { this.lookAt = { x: P.x, z: P.z }; break; } // 손님이 따라올 때까지 기다림
          this.lookAt = null;
          if (this.follow(dt, 2.3)) {
            const f = this.guideFace;
            this.steer(dt, f.x, f.z, 0.01);
            if (this.stateT > 0.3 && Math.abs(angleDiff(Math.atan2(f.x - this.pos.x, f.z - this.pos.z), this.yaw)) < 0.2) { this.guideArrived = true; ctx.onGuideArrive(this); this.stateT = 0; }
          }
        } else {
          this.lookAt = { x: P.x, z: P.z, feet: true };
          this.bowTarget = 1;
        }
        break;
      }
      case 'stun': {
        if (this.stateT > 12) this.setState('patrol');
        break;
      }
      case 'retreat': {
        if (!this.path) {
          const cells = this.world.zoneCells(this.zone);
          let best = cells[0], bd = -1;
          for (let k = 0; k < 6; k++) {
            const c = cells[Math.floor(Math.random() * cells.length)];
            const p = center(c % W, (c / W) | 0);
            const d = Math.hypot(p.x - P.x, p.z - P.z);
            if (d > bd) { bd = d; best = c; }
          }
          this.goTo(best, forbid);
        }
        this.follow(dt, 2.0);
        if (this.stateT > 15) this.setState('patrol');
        break;
      }
      case 'chase':
      case 'alert': {
        const sp = (this.state === 'chase' ? 4.35 + deep * 0.6 : 3.7) * slow;
        if (!hostile) { this.setState('patrol'); break; }
        if (ctx.repel && dist < 6) { this.setState('flee'); break; }
        if (this.sees) {
          this.lastSeen = { x: P.x, z: P.z };
          this.lostT = 0;
          if (dist < 7) { this.steer(dt, P.x, P.z, sp); this.path = null; }
          else {
            if (!this.path || this.stateT % 0.6 < dt) { const c = cellAt(P.x, P.z); this.goTo(idx(c.cx, c.cz), forbid); }
            if (this.follow(dt, sp)) this.path = null;
          }
        } else {
          this.lostT += dt;
          if (this.lastSeen) {
            const d2 = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
            if (d2 > 0.6) {
              const c = cellAt(this.lastSeen.x, this.lastSeen.z), lc = idx(c.cx, c.cz);
              if (this.cell === lc) { this.path = null; this.steer(dt, this.lastSeen.x, this.lastSeen.z, sp * 0.9); }
              else {
                if (!this.path && !this.goTo(lc, forbid)) this.lastSeen = null;
                if (this.path && this.follow(dt, sp * 0.9)) this.path = null;
              }
            } else this.headYaw = Math.sin(this.stateT * 2) * 1.1; // 마지막으로 본 자리에서 두리번
          }
          if (this.lostT > 8) { this.setState('search'); this.searchT = 5; }
        }
        this.lookAt = this.sees ? { x: P.x, z: P.z } : null;
        if (dist < 1.25 && hostile && ctx.grace <= 0 && !ctx.safe) ctx.onCatch(this);
        break;
      }
      case 'flee': {
        if (!ctx.repel || dist > 8) { this.setState('patrol'); break; }
        const ax = this.pos.x - P.x, az = this.pos.z - P.z, d = Math.hypot(ax, az) || 1;
        this.steer(dt, this.pos.x + (ax / d) * 3, this.pos.z + (az / d) * 3, 2.6);
        break;
      }
      case 'search': {
        this.searchT = (this.searchT || 5) - dt;
        if (!this.path) {
          const cells = this.world.zoneCells(this.zone);
          const c = this.lastSeen ? cellAt(this.lastSeen.x, this.lastSeen.z) : null;
          const near = c ? cells.filter((k) => Math.abs((k % W) - c.cx) + Math.abs(((k / W) | 0) - c.cz) <= 2) : cells;
          const list = near.length ? near : cells;
          this.goTo(list[Math.floor(Math.random() * list.length)], forbid);
        }
        if (this.follow(dt, 2.3 * slow)) this.path = null;
        if (hostile && !ctx.free && this.sees) this.setState('chase');
        if (this.searchT <= 0) this.setState('patrol');
        break;
      }
      default: { // patrol
        if (hostile && !ctx.free && this.sees && ctx.grace <= 0) { this.setState('chase'); break; }
        if (this.wait > 0) {
          this.wait -= dt;
          this.headYaw = Math.sin(this.stateT * 0.8 + this.id) * 0.9;
          break;
        }
        if (!this.path) {
          const cells = this.world.zoneCells(this.zone);
          let pick = cells[Math.floor(Math.random() * cells.length)];
          if (ctx.confuse) pick = this.world.anyCell();
          if (!this.goTo(pick, forbid)) { this.wait = 1; break; }
        }
        if (this.follow(dt, 1.45 * slow)) { this.path = null; this.wait = 1 + Math.random() * 2.5; }
        break;
      }
    }
    // 소리를 들으면 찾아감 (사냥 시간)
    if (hostile && !ctx.free && ctx.noise && ['patrol', 'search'].includes(this.state)) {
      const n = ctx.noise;
      if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < n.r) { this.lastSeen = { x: n.x, z: n.z }; this.setState('search'); this.searchT = 7; }
    }

    // 인사 자세 보간
    const bowWant = this.state === 'bow' || this.state === 'answer' || (this.state === 'guide' && this.guideArrived) ? 1 : 0;
    this.bow += clamp(bowWant - this.bow, -dt * 2.2, dt * 2.2);
    if (this.nod > 0) this.nod = Math.max(0, this.nod - dt);

    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = (this.state === 'chase' ? 1.2 : 3) + Math.random() * 3;
      this.world.sound('creak', this);
    }
    this.syncModel(dt);
  }

  syncModel(dt) {
    const m = this.model;
    const b = this.bow;
    m.root.position.set(this.pos.x, 0, this.pos.z);
    m.root.rotation.y = this.yaw;
    const bob = this.speed > 0.1 ? Math.sin(this.walkPhase * 2) * 0.04 : 0;
    m.body.position.y = 2.0 - b * 1.05 + bob;
    m.body.rotation.x = b * 0.25;
    // 머리 방향
    let hy = this.headYaw, hp = 0;
    if (this.lookAt) {
      const dx = this.lookAt.x - this.pos.x, dz = this.lookAt.z - this.pos.z;
      hy = clamp(angleDiff(Math.atan2(dx, dz), this.yaw), -1.3, 1.3);
      const d = Math.hypot(dx, dz);
      hp = this.lookAt.feet ? Math.atan2(m.body.position.y + 0.4, Math.max(0.5, d)) : 0.1;
    } else if (this.state !== 'patrol' || this.wait <= 0) hy *= 0.9;
    if (this.nod > 0) hp += Math.max(0, Math.sin((1.4 - this.nod) * Math.PI * 2 / 0.7)) * 0.55;
    this.headYawCur = (this.headYawCur || 0) + clamp(hy - (this.headYawCur || 0), -dt * 4, dt * 4);
    this.headPitchCur = (this.headPitchCur || 0) + clamp(hp - (this.headPitchCur || 0), -dt * 5, dt * 5);
    // 가끔 머리를 홱 꺾음 (쫓을 때 더 자주)
    const hunting = this.state === 'chase' || this.state === 'alert';
    const col = this.pose === 'collect';
    this.twT = (this.twT ?? 2 + Math.random() * 4) - dt;
    if (this.twT <= 0) {
      this.twT = (hunting || col ? 0.5 : 2.5) + Math.random() * (hunting || col ? 1.2 : 5);
      this.tw = 0.14 + Math.random() * 0.1;
      this.twRoll = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3);
      this.twYaw = (Math.random() - 0.5) * 0.5;
    }
    if (this.tw > 0) this.tw -= dt;
    const twOn = this.tw > 0;
    this.rollCur = (this.rollCur || 0) + ((twOn ? this.twRoll : 0) - (this.rollCur || 0)) * Math.min(1, dt * 28);
    m.head.rotation.set(this.headPitchCur, this.headYawCur + (twOn ? this.twYaw : 0), this.rollCur);
    // 태엽, 톱니, 송곳니, 수술 팔
    this.animT = (this.animT || 0) + dt;
    const at = this.animT;
    const spin = col ? 9 : hunting ? 5 : 1.2;
    m.key.rotation.z += dt * spin * 0.8;
    m.gears[0].rotation.z += dt * spin;
    m.gears[1].rotation.z -= dt * spin * 1.55;
    m.gears[2].rotation.z -= dt * spin * 1.9;
    m.glow.scale.setScalar(0.85 + 0.25 * Math.abs(Math.sin(at * (hunting || col ? 9 : 2.5))));
    const fo = col ? 0.55 + 0.1 * Math.sin(at * 20) : hunting ? 0.18 + 0.22 * Math.abs(Math.sin(at * 11)) : 0.05 + 0.04 * Math.sin(at * 1.7 + this.id);
    this.fang = (this.fang || 0) + (fo - (this.fang || 0)) * Math.min(1, dt * 12);
    m.fangL.rotation.z = this.fang; m.fangR.rotation.z = -this.fang;
    m.disc.rotation.x += dt * (col ? 45 : hunting ? 16 : 0.8);
    const armOut = col ? 1 : hunting ? 0.35 : 0;
    this.arm = (this.arm || 0) + (armOut - (this.arm || 0)) * Math.min(1, dt * 5);
    m.syr.rotation.x = 1.25 - this.arm * 1.05 + Math.sin(at * 2.3 + this.id) * 0.05;
    m.sawArm.rotation.x = 1.3 - this.arm * 0.95 + Math.sin(at * 1.9 + this.id * 2) * 0.05;
    m.root.updateMatrixWorld(true);

    // 다리: 두 무리가 번갈아 디딤
    this.walkPhase += dt * (this.speed * 2.2 + 0.001);
    const fast = this.speed > 3;
    const stepDur = fast ? 0.11 : 0.18;
    const moving = m.legs.some((L) => L.t < 1);
    const activeGroup = this._g || 0;
    let groupBusy = false;
    for (const L of m.legs) {
      this.homeOf(L, _f);
      _f.addScaledVector(this.vel, fast ? 0.18 : 0.28);
      if (L.reach) { L.foot.lerp(L.reach, Math.min(1, dt * 12)); continue; } // 징수할 때 뻗는 다리
      if (L.front) { // 앞다리: 순찰 중엔 앞을 더듬고, 쫓을 때는 치켜들고, 인사할 땐 바닥에 내림
        const sd = L.side;
        let lx, ly, lz;
        if (b > 0.5) { lx = sd * 0.62; ly = 0.12; lz = 1.25; }
        else if (this.state === 'stun') { lx = sd * 0.95; ly = 0.25; lz = 0.85; }
        else if (hunting) { lx = sd * (0.5 + 0.06 * Math.sin(at * 9 + sd)); ly = 2.75 + 0.14 * Math.sin(at * 8.3 + sd * 2); lz = 1.0 + 0.18 * Math.sin(at * 6.1 + sd); }
        else { lx = sd * 0.5 + Math.sin(at * 1.25 + sd * 1.7) * 0.32; ly = 0.9 + 0.22 * Math.sin(at * 2.2 + sd); lz = 1.45 + 0.12 * Math.sin(at * 1.7); }
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        _o.set(this.pos.x + lx * cy + lz * sy, ly, this.pos.z - lx * sy + lz * cy);
        L.foot.lerp(_o, Math.min(1, dt * (hunting ? 9 : 4)));
        continue;
      }
      if (L.t < 1) {
        L.t = Math.min(1, L.t + dt / stepDur);
        L.to.copy(_f);
        L.foot.lerpVectors(L.from, L.to, L.t);
        L.foot.y = Math.sin(L.t * Math.PI) * (0.35 + b * 0.1);
        if (L.t >= 1) { L.foot.y = 0; if (Math.random() < 0.35) this.world.sound('tick', this); }
        if (L.group === activeGroup) groupBusy = true;
      } else if (L.group === activeGroup) {
        const far = Math.hypot(L.foot.x - _f.x, L.foot.z - _f.z);
        if (far > (b > 0.1 ? 0.12 : 0.5)) { L.from.copy(L.foot); L.t = 0; groupBusy = true; }
      }
    }
    if (!groupBusy && !moving) this._g = 1 - activeGroup;
    else if (!groupBusy) this._g = 1 - activeGroup;

    const sc = m.scale;
    for (const L of m.legs) {
      _h.copy(L.hipLocal);
      m.body.localToWorld(_h);
      // 웅크릴 때는 다리를 몸 가까이 접음
      _f.copy(L.foot);
      _d.subVectors(_f, _h);
      let d = _d.length();
      const l1 = L.l1 * sc, l2 = L.l2 * sc;
      const maxL = l1 + l2 - 0.02, minL = Math.abs(l2 - l1) + 0.02;
      if (d > maxL) { _d.multiplyScalar(maxL / d); _f.copy(_h).add(_d); d = maxL; }
      else if (d < minL) { _d.multiplyScalar(minL / Math.max(d, 1e-4)); _f.copy(_h).add(_d); d = minL; }
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      const hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      _d.normalize();
      // 무릎은 위와 바깥쪽
      _o.set(_f.x - this.pos.x, 0, _f.z - this.pos.z).normalize();
      _p.copy(UP).multiplyScalar(1).addScaledVector(_o, 0.5);
      _p.addScaledVector(_d, -_p.dot(_d)).normalize();
      _k.copy(_h).addScaledVector(_d, a).addScaledVector(_p, hgt);
      _n.crossVectors(_d, _p);
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0); else _n.normalize();
      placeLeg(L.up, _h, _k, L.l1, sc);
      placeLeg(L.lo, _k, _f, L.l2, sc);
    }
    if (this.light) {
      m.head.getWorldPosition(this.light.position);
      m.lampTarget.getWorldPosition(this.light.target.position);
      this.light.target.updateMatrixWorld();
    }
  }

  setXray(on) { this.model.xr.visible = on; }
  setGlare(on) { const M = mats(); this.model.core.material = on ? M.lampRed : M.lamp; this.model.halo.material.color.setHex(on ? 0xff2a14 : 0xffb040); this.model.halo.material.size = on ? 0.32 : 0.2; }

  dispose() {
    const m = this.model;
    m.root.removeFromParent();
    m.halo.material.dispose();
    for (const L of m.legs) { L.up.removeFromParent(); L.lo.removeFromParent(); }
  }
}
