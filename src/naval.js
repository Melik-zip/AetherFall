// src/naval.js — Ocean Patrol Gunboats & Sea-Wake Physics
(function (AF) {
  'use strict';

  const { damp, dampAngle, randRange, Mat4 } = AF.Math;

  class NavalDirector {
    constructor(world, particles) {
      this.world = world;
      this.particles = particles;
      this.boats = [];
      this._m = Mat4.create();
    }

    clear() {
      this.boats.length = 0;
    }

    spawnPatrolSquad(sector) {
      this.clear();
      const spots = [
        { x: 38, z: -48 },
        { x: -46, z: -42 },
        { x: 54, z: 48 },
        { x: -48, z: 54 }
      ];
      const count = Math.min(4, 1 + Math.ceil(sector * 0.7));
      for (let i = 0; i < count; i++) {
        const sp = spots[(i + sector) % spots.length];
        this.boats.push({
          x: sp.x,
          y: 0.1,
          z: sp.z,
          cx: sp.x,
          cz: sp.z,
          angle: i * 1.5,
          radius: randRange(16, 26),
          yaw: 0,
          hp: 165 + sector * 45,
          maxHp: 165 + sector * 45,
          hitFlash: 0,
          fireCd: randRange(1.8, 3.2),
          wakeTimer: 0
        });
      }
    }

    update(dt, time, sim) {
      const p = sim.player;
      for (let i = this.boats.length - 1; i >= 0; i--) {
        const b = this.boats[i];
        b.hitFlash = Math.max(0, b.hitFlash - dt * 5);
        b.angle += 0.28 * dt;

        // Orbit gently in deep water channel; avoid shallow sandbanks
        const nextX = b.cx + Math.cos(b.angle) * b.radius;
        const nextZ = b.cz + Math.sin(b.angle) * b.radius;
        const g = this.world.getGroundAt(nextX, nextZ);
        if (g.height < -0.6) {
          const dx = nextX - b.x;
          const dz = nextZ - b.z;
          b.x = damp(b.x, nextX, 3.5, dt);
          b.z = damp(b.z, nextZ, 3.5, dt);
          if (Math.hypot(dx, dz) > 0.01) {
            b.yaw = dampAngle(b.yaw, Math.atan2(dx, dz), 4.5, dt);
          }
        }
        // Bob smoothly on Gerstner ocean surface
        b.y = Math.sin(time * 1.7 + b.x * 0.12) * 0.35 + 0.1;

        // White frothy stern wake behind gunboat
        b.wakeTimer -= dt;
        if (b.wakeTimer <= 0) {
          b.wakeTimer = 0.08;
          const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
          this.particles.spawn({
            x: b.x - sy * 3.4 + randRange(-0.5, 0.5),
            y: 0.18,
            z: b.z - cy * 3.4 + randRange(-0.5, 0.5),
            vx: -sy * 2.5, vy: randRange(0.8, 2.0), vz: -cy * 2.5,
            r: 0.90, g: 0.96, b: 1.0, a: 0.72,
            size: 0.42, endSize: 0.05, life: 0.55, gravity: 5, kind: 'spark'
          });
        }

        // Fire anti-air mortar bolts at player
        b.fireCd -= dt;
        const dxp = p.pos[0] - b.x, dyp = p.pos[1] - b.y, dzp = p.pos[2] - b.z;
        const dist = Math.hypot(dxp, dyp, dzp);
        if (b.fireCd <= 0 && dist < 115) {
          b.fireCd = Math.max(1.8, 3.4 - sim.sector * 0.25);
          sim._spawnEnemyBolt(b.x, b.y + 1.8, b.z, dxp / dist, (dyp + 2) / dist, dzp / dist, 32, 11 + sim.sector, [1.0, 0.45, 0.22]);
        }
      }
    }

    pushVisuals(renderer, time) {
      const m = this._m;
      for (const b of this.boats) {
        const pitch = Math.sin(time * 1.8 + b.x * 0.1) * 0.07;
        const roll = Math.cos(time * 1.5 + b.z * 0.1) * 0.06;
        Mat4.composeYXZ(m, b.x, b.y, b.z, b.yaw, pitch, roll, 1.1, 1.1, 1.1);
        renderer.litBatches.gunboat.push(m, 1, 1, 1, 0.12, b.hitFlash, 1.2);
      }
    }
  }

  AF.NavalDirector = NavalDirector;
})(window.AF = window.AF || {});
