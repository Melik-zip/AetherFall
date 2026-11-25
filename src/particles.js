// src/particles.js — Pooled 3D Particles, Shockwaves, Wingtip Ribbon Trails & 2D Floating Text
(function (AF) {
  'use strict';

  const { Mat4, randRange, clamp } = AF.Math;

  class ParticleSystem {
    constructor(maxCount = 1200) {
      this.maxCount = maxCount;
      this.pool = [];
      for (let i = 0; i < maxCount; i++) {
        this.pool.push({
          x: 0, y: 0, z: 0,
          vx: 0, vy: 0, vz: 0,
          r: 1, g: 1, b: 1, a: 1,
          size: 0.3, endSize: 0.05,
          life: 0, maxLife: 1,
          gravity: 0, drag: 1,
          kind: 'orb' // 'orb' | 'spark' | 'ring' | 'beam'
        });
      }
      this.activeCount = 0;
      this._mat = Mat4.create();
      this._fwd = new Float32Array(3);
      this._pos = new Float32Array(3);
    }

    spawn(opts) {
      if (this.activeCount >= this.maxCount) return;
      const p = this.pool[this.activeCount++];
      p.x = opts.x || 0; p.y = opts.y || 0; p.z = opts.z || 0;
      p.vx = opts.vx || 0; p.vy = opts.vy || 0; p.vz = opts.vz || 0;
      p.r = opts.r !== undefined ? opts.r : 1;
      p.g = opts.g !== undefined ? opts.g : 0.8;
      p.b = opts.b !== undefined ? opts.b : 0.4;
      p.a = opts.a !== undefined ? opts.a : 1;
      p.size = opts.size !== undefined ? opts.size : 0.3;
      p.endSize = opts.endSize !== undefined ? opts.endSize : 0.02;
      p.life = opts.life !== undefined ? opts.life : 0.5;
      p.maxLife = p.life;
      p.gravity = opts.gravity !== undefined ? opts.gravity : 0;
      p.drag = opts.drag !== undefined ? opts.drag : 0.96;
      p.kind = opts.kind || 'orb';
    }

    burst(x, y, z, count, col, speed = 14, size = 0.35, life = 0.55, kind = 'spark', gravity = 9) {
      for (let i = 0; i < count; i++) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const sp = speed * (0.45 + Math.random() * 0.75);
        this.spawn({
          x, y, z,
          vx: Math.sin(phi) * Math.cos(theta) * sp,
          vy: Math.cos(phi) * sp * 0.85 + 2.5,
          vz: Math.sin(phi) * Math.sin(theta) * sp,
          r: col[0], g: col[1], b: col[2], a: 1.0,
          size: size * (0.7 + Math.random() * 0.6),
          endSize: 0.01,
          life: life * (0.7 + Math.random() * 0.6),
          gravity,
          drag: 0.94,
          kind
        });
      }
    }

    shockwave(x, y, z, col, startR = 0.8, endR = 10, life = 0.42) {
      this.spawn({
        x, y, z,
        r: col[0], g: col[1], b: col[2], a: 0.95,
        size: startR,
        endSize: endR,
        life,
        gravity: 0,
        drag: 1,
        kind: 'ring'
      });
    }

    update(dt) {
      let i = 0;
      while (i < this.activeCount) {
        const p = this.pool[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.activeCount--;
          // Swap with last active element (zero allocation)
          if (i < this.activeCount) {
            const tmp = this.pool[i];
            this.pool[i] = this.pool[this.activeCount];
            this.pool[this.activeCount] = tmp;
          }
          continue;
        }
        const dragMul = Math.pow(p.drag, dt * 60);
        p.vx *= dragMul;
        p.vy = p.vy * dragMul - p.gravity * dt;
        p.vz *= dragMul;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        i++;
      }
    }

    pushToRenderer(renderer) {
      const m = this._mat;
      const fwd = this._fwd;
      const pos = this._pos;

      for (let i = 0; i < this.activeCount; i++) {
        const p = this.pool[i];
        const t = 1 - clamp(p.life / p.maxLife, 0, 1);
        const s = p.size + (p.endSize - p.size) * t;
        const alpha = p.a * (1 - t * t);

        if (p.kind === 'ring') {
          Mat4.composeYXZ(m, p.x, p.y, p.z, 0, 0, 0, s, 1, s);
          renderer.vfxBatches.flatRing.push(m, p.r, p.g, p.b, alpha);
        } else if (p.kind === 'spark') {
          pos[0] = p.x; pos[1] = p.y; pos[2] = p.z;
          fwd[0] = p.vx; fwd[1] = p.vy; fwd[2] = p.vz;
          const speed = Math.hypot(p.vx, p.vy, p.vz);
          const stretch = Math.max(1.2, Math.min(4.5, speed * 0.14));
          Mat4.aimMatrix(m, pos, fwd, s * 0.55, s * 0.55, s * stretch, 0);
          renderer.vfxBatches.spark.push(m, p.r, p.g, p.b, alpha);
        } else {
          Mat4.composeYXZ(m, p.x, p.y, p.z, 0, 0, 0, s, s, s);
          renderer.vfxBatches.sphere.push(m, p.r, p.g, p.b, alpha);
        }
      }
    }
  }

  // Smooth 3D wingtip ribbon trail
  class RibbonTrail {
    constructor(maxPoints = 28, halfWidth = 0.18, maxAge = 0.36) {
      this.points = [];
      this.maxPoints = maxPoints;
      this.halfWidth = halfWidth;
      this.maxAge = maxAge;
    }

    clear() {
      this.points.length = 0;
    }

    push(x, y, z, widthScale = 1.0) {
      const pts = this.points;
      if (pts.length > 0) {
        const last = pts[pts.length - 1];
        const dSq = (x - last.x) ** 2 + (y - last.y) ** 2 + (z - last.z) ** 2;
        if (dSq < 0.08) return;
      }
      pts.push({ x, y, z, w: this.halfWidth * widthScale, age: 0, alpha: 1 });
      if (pts.length > this.maxPoints) {
        pts.shift();
      }
    }

    update(dt) {
      const pts = this.points;
      let write = 0;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        pt.age += dt;
        if (pt.age < this.maxAge) {
          pt.alpha = 1 - pt.age / this.maxAge;
          pts[write++] = pt;
        }
      }
      pts.length = write;
    }

    draw(renderer, r, g, b, maxAlpha = 0.72) {
      if (this.points.length >= 2) {
        renderer.addTrailStrip(this.points, r, g, b, maxAlpha);
      }
    }
  }

  // 2D Canvas Floating Numbers & Callouts
  class FloatingTextManager {
    constructor() {
      this.items = [];
    }

    spawn(x, y, z, text, color = '#ffffff', size = 16, life = 0.85) {
      if (this.items.length > 48) this.items.shift();
      this.items.push({
        x: x + randRange(-0.5, 0.5),
        y: y + randRange(0.2, 0.9),
        z: z + randRange(-0.5, 0.5),
        vy: 3.4,
        text,
        color,
        size,
        life,
        maxLife: life
      });
    }

    update(dt) {
      let w = 0;
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        it.life -= dt;
        if (it.life > 0) {
          it.y += it.vy * dt;
          it.vy *= 0.94;
          this.items[w++] = it;
        }
      }
      this.items.length = w;
    }

    render2D(ctx, viewProj, cssW, cssH) {
      const proj = new Float32Array(3);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const it of this.items) {
        const ok = AF.Math.Mat4.projectToScreen(proj, [it.x, it.y, it.z], viewProj, cssW, cssH);
        if (!ok) continue;
        const alpha = clamp(it.life / (it.maxLife * 0.45), 0, 1);
        ctx.globalAlpha = alpha;
        ctx.font = `800 ${it.size}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(8, 10, 22, 0.85)';
        ctx.fillText(it.text, proj[0] + 1.5, proj[1] + 1.5);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, proj[0], proj[1]);
      }
      ctx.globalAlpha = 1;
    }
  }

  AF.ParticleSystem = ParticleSystem;
  AF.RibbonTrail = RibbonTrail;
  AF.FloatingTextManager = FloatingTextManager;
})(window.AF = window.AF || {});
