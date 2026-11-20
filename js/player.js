// 1인칭 이동과 충돌
import { WALL_T } from './level.js';
import { CFG } from './data.js';
import { clamp, segHit } from './util.js';

export function collide(L, x, z, r) {
  const R = r + WALL_T / 2;
  for (let it = 0; it < 2; it++) {
    for (const s of L.segs) {
      const minX = Math.min(s.x1, s.x2) - R, maxX = Math.max(s.x1, s.x2) + R;
      const minZ = Math.min(s.z1, s.z2) - R, maxZ = Math.max(s.z1, s.z2) + R;
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
      const ex = s.x2 - s.x1, ez = s.z2 - s.z1;
      const l2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - s.x1) * ex + (z - s.z1) * ez) / l2, 0, 1);
      const qx = s.x1 + ex * t, qz = s.z1 + ez * t;
      const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
      if (d < R) {
        if (d < 1e-6) { x += ez ? R : 0; z += ex ? R : 0; }
        else { x = qx + (dx / d) * R; z = qz + (dz / d) * R; }
      }
    }
    for (const b of L.boxes) {
      const qx = clamp(x, b.minX, b.maxX), qz = clamp(z, b.minZ, b.maxZ);
      const dx = x - qx, dz = z - qz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) { x = qx + (dx / d) * r; z = qz + (dz / d) * r; continue; }
      // 상자 안쪽: 가장 가까운 면으로 밀어냄
      const pushes = [[b.minX - r - x, 0], [b.maxX + r - x, 0], [0, b.minZ - r - z], [0, b.maxZ + r - z]];
      pushes.sort((a, c) => Math.abs(a[0] + a[1]) - Math.abs(c[0] + c[1]));
      x += pushes[0][0]; z += pushes[0][1];
    }
  }
  return { x, z };
}

export function los(L, x1, z1, x2, z2) {
  for (const s of L.segs) if (segHit(x1, z1, x2, z2, s.x1, s.z1, s.x2, s.z2)) return false;
  return true;
}

export class Player {
  constructor() {
    this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.eye = 1.65; this.stamina = CFG.stamina;
    this.running = false; this.crawling = false; this.moving = false;
    this.stepT = 0; this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.sens = 0.0022;
  }

  bind(onKey) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat && this.keys.has(e.code)) return;
      this.keys.add(e.code);
      onKey(e.code, true, e);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); onKey(e.code, false, e); });
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
  }

  k(...codes) { return codes.some((c) => this.keys.has(c)); }

  // 반환: 발소리가 났으면 'walk' | 'run' | 'crawl'
  update(dt, L, mod) {
    this.yaw -= this.mouseDX * this.sens;
    this.pitch = clamp(this.pitch - this.mouseDY * this.sens, -1.3, 1.3);
    this.mouseDX = 0; this.mouseDY = 0;
    if (this.k('ArrowLeft')) this.yaw += dt * 2.2;
    if (this.k('ArrowRight')) this.yaw -= dt * 2.2;
    if (mod.frozen) { this.moving = false; this.running = false; return null; }

    let f = 0, s = 0;
    if (this.k('KeyW', 'ArrowUp')) f += 1;
    if (this.k('KeyS', 'ArrowDown')) f -= 1;
    if (this.k('KeyD')) s += 1;
    if (this.k('KeyA')) s -= 1;
    const len = Math.hypot(f, s);
    this.moving = len > 0;
    this.crawling = mod.crawl;
    const wantRun = this.k('ShiftLeft', 'ShiftRight') && this.moving && f > 0 && mod.canRun && !mod.crawl;
    if (wantRun && this.stamina > 0) { this.running = true; this.stamina = Math.max(0, this.stamina - dt); }
    else { this.running = false; this.stamina = Math.min(CFG.stamina, this.stamina + dt * (this.moving ? 0.45 : 0.8)); }
    if (this.stamina <= 0) this.running = false;
    let speed = mod.crawl ? CFG.crawl : this.running ? CFG.run : CFG.walk;
    speed *= mod.speedMul;
    const targetEye = mod.crawl ? 0.55 : 1.65;
    this.eye += clamp(targetEye - this.eye, -dt * 2, dt * 2);
    if (!this.moving) return null;
    f /= len; s /= len;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const nx = this.x + (fx * f + rx * s) * speed * dt;
    const nz = this.z + (fz * f + rz * s) * speed * dt;
    const r = collide(L, nx, nz, 0.32);
    this.x = r.x; this.z = r.z;
    this.stepT -= dt * speed;
    if (this.stepT <= 0) {
      this.stepT = mod.crawl ? 0.7 : 1.45;
      return mod.crawl ? 'crawl' : this.running ? 'run' : 'walk';
    }
    return null;
  }
}
