// 관람 지도: 손님이 지나간 칸만 잉크로 그려짐 (큰 지도 M, 구석 작은 지도)
import { W, H, S, getEdge, idx, inGrid, DX, DZ, passable } from './level.js';
import { floorLabel } from './util.js';

const LABEL = { elev: '엘리베이터', stair: '계단', lounge: '관람객 라운지', mouth: '「감정의 힘」', eyes: '「빛나는 시선」', guest: '게스트룸', foyer: '현관' };
const INK = '#3b2611', PAPER = '#e6d8b8', PAPER2 = '#d9c79f';

// 지금 칸과 곧게 보이는 칸(복도 따라 3칸), 들어선 방 전체를 기록
export function reveal(L, seen, px, pz) {
  const cx = Math.floor(px / S), cz = Math.floor(pz / S);
  if (!inGrid(cx, cz)) return false;
  let added = false;
  const mark = (c) => { if (!seen[c]) { seen[c] = 1; added = true; } };
  mark(idx(cx, cz));
  for (let d = 0; d < 4; d++) {
    let x = cx, z = cz;
    for (let k = 0; k < 3 && passable(L, x, z, d); k++) {
      x += DX[d]; z += DZ[d];
      if (!inGrid(x, z) || L.voidCell[idx(x, z)]) break;
      mark(idx(x, z));
      if (getEdge(L, x - DX[d], z - DZ[d], d) === 2) break; // 문 너머는 한 칸만
    }
  }
  const rid = L.roomId[idx(cx, cz)];
  if (rid >= 0) {
    const r = L.rooms[rid];
    for (let z = r.y; z < r.y + r.h; z++) for (let x = r.x; x < r.x + r.w; x++) mark(idx(x, z));
  }
  return added;
}

// 지도 한 장 그리기. view: {cx, cz, cells, cell(px), center(px,py), player?, round?}
export function drawMap(g, L, seen, view) {
  const { cell, ox, oy } = view;
  const X = (wx) => ox + (wx / S) * cell, Y = (wz) => oy + (wz / S) * cell;
  // 칸 바탕
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    const c = idx(cx, cz);
    if (!seen[c]) continue;
    const r = L.roomId[c];
    const k = r >= 0 ? L.rooms[r].kind : 'corridor';
    g.fillStyle = k === 'corridor' ? PAPER : k === 'exhibit' ? PAPER2 : '#d2bb8a';
    g.fillRect(X(cx * S) - 0.5, Y(cz * S) - 0.5, cell + 1, cell + 1);
  }
  // 벽과 문
  g.strokeStyle = INK; g.lineCap = 'round';
  const lw = Math.max(1.5, cell * 0.08);
  const line = (x1, z1, x2, z2, w = lw) => { g.lineWidth = w; g.beginPath(); g.moveTo(X(x1), Y(z1)); g.lineTo(X(x2), Y(z2)); g.stroke(); };
  for (let cz = 0; cz < H; cz++) for (let cx = 0; cx < W; cx++) {
    if (!seen[idx(cx, cz)]) continue;
    for (let d = 0; d < 4; d++) {
      let t = getEdge(L, cx, cz, d);
      if (t === 0) continue;
      if (t === 3 && L.hiddenOpen) t = 2;
      const x0 = cx * S, z0 = cz * S;
      const [ax, az, bx, bz] = d === 0 ? [x0, z0, x0 + S, z0] : d === 2 ? [x0, z0 + S, x0 + S, z0 + S] : d === 3 ? [x0, z0, x0, z0 + S] : [x0 + S, z0, x0 + S, z0 + S];
      if (t === 1 || t === 3) { line(ax, az, bx, bz); continue; }
      // 문: 가운데를 비움
      const gap = 0.22, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (az === bz) { line(ax, az, mx - S * gap, az); line(mx + S * gap, az, bx, bz); }
      else { line(ax, az, ax, mz - S * gap); line(ax, mz + S * gap, bx, bz); }
      if (t === 4) { // 비상문
        g.strokeStyle = '#2f7a3a';
        if (az === bz) line(mx - S * gap, az, mx + S * gap, az, lw * 1.6); else line(ax, mz - S * gap, ax, mz + S * gap, lw * 1.6);
        g.strokeStyle = INK;
        g.fillStyle = '#2f7a3a'; g.font = `700 ${Math.max(10, cell * 0.24)}px "Nanum Myeongjo", serif`; g.textAlign = 'center';
        g.fillText('비상문', X(mx), Y(mz) + (d === 0 ? cell * 0.42 : -cell * 0.2));
      }
    }
  }
  // 계단 표시
  if (L.stairs && view.labels) {
    const st = L.stairs;
    g.fillStyle = INK; g.font = `700 ${Math.max(10, cell * 0.3)}px "Nanum Myeongjo", serif`; g.textAlign = 'center';
    if (st.up && seen[idx(Math.floor(st.x0 / S) + 1, Math.floor(st.up.z0 / S))]) g.fillText(`▲ ${floorLabel(st.up.to)}`, X((st.x0 + st.x1) / 2), Y((st.up.z0 + st.up.z1) / 2) + cell * 0.1);
    if (st.down && seen[idx(Math.floor(st.x0 / S) + 1, Math.floor(st.down.z0 / S))]) g.fillText(`▼ ${floorLabel(st.down.to)}`, X((st.x0 + st.x1) / 2), Y((st.down.z0 + st.down.z1) / 2) + cell * 0.1);
  }
  // 방 이름
  if (view.labels) {
    g.fillStyle = INK; g.textAlign = 'center';
    for (const r of L.rooms) {
      const name = LABEL[r.kind];
      if (!name) continue;
      let any = false;
      for (let z = r.y; z < r.y + r.h && !any; z++) for (let x = r.x; x < r.x + r.w; x++) if (seen[idx(x, z)]) { any = true; break; }
      if (!any) continue;
      const fs = Math.max(10, Math.min(cell * 0.34, (r.w * cell) / (name.length * 0.9)));
      g.font = `800 ${fs}px "Nanum Myeongjo", serif`;
      g.fillText(name, ox + (r.x + r.w / 2) * cell, oy + (r.y + r.h / 2) * cell + (r.kind === 'stair' ? -cell * 0.05 : fs * 0.35));
    }
  }
  // 손님 위치 (화살표)
  if (view.player) {
    const p = view.player;
    const x = X(p.x), y = Y(p.z), sz = Math.max(6, cell * 0.28);
    g.save(); g.translate(x, y); g.rotate(-p.yaw);
    g.fillStyle = '#9a1c10';
    g.beginPath(); g.moveTo(0, -sz); g.lineTo(sz * 0.62, sz * 0.7); g.lineTo(0, sz * 0.35); g.lineTo(-sz * 0.62, sz * 0.7); g.closePath(); g.fill();
    g.restore();
  }
}
