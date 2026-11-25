// src/weather_fx.js — 3D Volumetric Storm Rain Streaks & Ocean Surface Splash Droplets
(function (AF) {
  'use strict';

  const { Mat4, randRange } = AF.Math;

  class WeatherEffects {
    constructor(count = 260) {
      this.drops = [];
      for (let i = 0; i < count; i++) {
        this.drops.push({
          ox: randRange(-48, 48),
          oy: randRange(0, 42),
          oz: randRange(-48, 48),
          speed: randRange(48, 66)
        });
      }
      this._m = Mat4.create();
    }

    update(dt, storminess, camPos, particles, seaLevel = 0) {
      if (storminess < 0.25) return;
      for (const d of this.drops) {
        d.oy -= d.speed * dt;
        d.ox -= 8.0 * dt;
        if (d.oy < -2) {
          d.oy += 44;
          d.ox = randRange(-48, 48);
          d.oz = randRange(-48, 48);
          if (particles && Math.random() < 0.08 * storminess) {
            particles.spawn({
              x: camPos[0] + d.ox,
              y: seaLevel + 0.12,
              z: camPos[2] + d.oz,
              r: 0.72, g: 0.86, b: 1.0, a: 0.55,
              size: 0.12, endSize: 0.65, life: 0.22, kind: 'ring'
            });
          }
        }
      }
    }

    pushVisuals(renderer, storminess, camPos) {
      if (storminess < 0.25) return;
      const alpha = Math.min(0.45, (storminess - 0.25) * 0.6);
      const m = this._m;
      const dir = [-8, -56, 0];
      for (const d of this.drops) {
        const x = camPos[0] + d.ox;
        const y = Math.max(0.5, camPos[1] - 12 + d.oy);
        const z = camPos[2] + d.oz;
        Mat4.aimMatrix(m, [x, y, z], dir, 0.035, 0.035, 2.2, 0);
        renderer.vfxBatches.spark.push(m, 0.68, 0.84, 1.0, alpha);
      }
    }
  }

  AF.WeatherEffects = WeatherEffects;
})(window.AF = window.AF || {});
