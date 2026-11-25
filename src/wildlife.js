// src/wildlife.js — Living World Simulation: Circling Seabirds & Leaping Bioluminescent Manta Rays
(function (AF) {
  'use strict';

  const { Mat4, randRange } = AF.Math;

  class WildlifeManager {
    constructor(world) {
      this.world = world;
      this.birds = [];
      this.mantas = [];
      this._m = Mat4.create();

      // Spawn 3 circling flocks of coastal gulls over key islands & arches
      const flockCenters = [
        { x: -14, y: 19, z: -22, r: 28, count: 8 },
        { x: 0,   y: 26, z: -90, r: 34, count: 7 },
        { x: 100, y: 20, z: -10, r: 30, count: 6 }
      ];
      for (const fc of flockCenters) {
        for (let i = 0; i < fc.count; i++) {
          this.birds.push({
            cx: fc.x + randRange(-8, 8),
            cy: fc.y + randRange(-3, 5),
            cz: fc.z + randRange(-8, 8),
            radius: fc.r + randRange(-6, 8),
            angle: (i / fc.count) * Math.PI * 2 + randRange(0, 0.4),
            speed: randRange(0.28, 0.42),
            flapPhase: randRange(0, 6.28),
            flapSpeed: randRange(7.5, 10.5),
            scale: randRange(0.55, 0.85)
          });
        }
      }

      // Spawn 10 ocean manta rays swimming through the lagoon & straits (breaching periodically!)
      const mantaSpots = [
        { x: 18, z: 12 }, { x: 42, z: -18 }, { x: -35, z: 28 },
        { x: 58, z: -48 }, { x: -58, z: -45 }, { x: 16, z: 58 },
        { x: -18, z: 54 }, { x: 75, z: 38 }, { x: -75, z: -18 },
        { x: 0, z: -64 }
      ];
      for (let i = 0; i < mantaSpots.length; i++) {
        this.mantas.push({
          cx: mantaSpots[i].x,
          cz: mantaSpots[i].z,
          radius: randRange(12, 22),
          angle: i * 1.1,
          speed: randRange(0.35, 0.55),
          breachTimer: randRange(2.0, 9.0),
          y: -0.6,
          vy: 0,
          breaching: false,
          scale: randRange(0.95, 1.45)
        });
      }
    }

    update(dt, particles) {
      for (const b of this.birds) {
        b.angle += b.speed * dt;
        b.flapPhase += b.flapSpeed * dt;
      }

      for (const mt of this.mantas) {
        mt.angle += mt.speed * dt;
        const x = mt.cx + Math.cos(mt.angle) * mt.radius;
        const z = mt.cz + Math.sin(mt.angle) * mt.radius;
        const ground = this.world.getGroundAt(x, z);
        const deepEnough = ground.height < -1.5;

        if (!mt.breaching) {
          mt.breachTimer -= dt;
          mt.y = -0.55 + Math.sin(mt.angle * 3) * 0.2;
          if (mt.breachTimer <= 0 && deepEnough) {
            mt.breaching = true;
            mt.vy = randRange(7.5, 10.5);
            mt.y = -0.3;
            if (particles) {
              particles.shockwave(x, 0.15, z, [0.85, 0.96, 1.0], 0.5, 3.8, 0.45);
            }
          }
        } else {
          mt.vy -= 14.5 * dt;
          mt.y += mt.vy * dt;
          if (mt.y <= -0.55) {
            mt.y = -0.55;
            mt.vy = 0;
            mt.breaching = false;
            mt.breachTimer = randRange(5.0, 12.0);
            if (particles) {
              particles.burst(x, 0.25, z, 8, [0.85, 0.96, 1.0], 6, 0.18, 0.35, 'spark', 10);
              particles.shockwave(x, 0.15, z, [0.85, 0.96, 1.0], 0.4, 3.2, 0.4);
            }
          }
        }
      }
    }

    pushVisuals(renderer, time, bioGlow = 0) {
      const m = this._m;

      // Render flapping birds (body + two articulated flapping wings)
      for (const b of this.birds) {
        const bx = b.cx + Math.cos(b.angle) * b.radius;
        const bz = b.cz + Math.sin(b.angle) * b.radius;
        const by = b.cy + Math.sin(b.flapPhase * 0.5) * 0.35;
        // Tangent heading along orbit (-sin, cos)
        const yaw = Math.atan2(-Math.sin(b.angle), Math.cos(b.angle));
        const flap = Math.sin(b.flapPhase) * 0.58;

        // Body
        Mat4.composeYXZ(m, bx, by, bz, yaw, 0, 0.15, b.scale * 0.35, b.scale * 0.35, b.scale * 0.85);
        renderer.litBatches.sphere.push(m, 0.95, 0.96, 0.98, 0.0);

        // Left & Right flapping wings
        Mat4.composeYXZ(m, bx, by + 0.05, bz, yaw, 0, flap, b.scale, b.scale, b.scale);
        renderer.litBatches.seagullWing.push(m, 0.95, 0.96, 0.98, 0.0);
        Mat4.composeYXZ(m, bx, by + 0.05, bz, yaw + Math.PI, 0, flap, b.scale, b.scale, b.scale);
        renderer.litBatches.seagullWing.push(m, 0.95, 0.96, 0.98, 0.0);
      }

      // Render swimming/leaping ocean manta rays
      for (const mt of this.mantas) {
        const mx = mt.cx + Math.cos(mt.angle) * mt.radius;
        const mz = mt.cz + Math.sin(mt.angle) * mt.radius;
        const yaw = Math.atan2(-Math.sin(mt.angle), Math.cos(mt.angle));
        const pitch = mt.breaching ? -Math.atan2(mt.vy, 10) : 0.0;
        const glow = 0.08 + bioGlow * 0.72;
        Mat4.composeYXZ(m, mx, mt.y, mz, yaw, pitch, Math.sin(time * 2 + mt.angle) * 0.15, mt.scale, mt.scale, mt.scale);
        renderer.litBatches.manta.push(m, 0.25, 0.72, 0.95, glow);
      }
    }
  }

  AF.WildlifeManager = WildlifeManager;
})(window.AF = window.AF || {});
