// src/atmosphere.js — Dynamic Time-of-Day, Weather Presets, Lightning & Atmospheric Interpolation
(function (AF) {
  'use strict';

  const { lerp, clamp, Vec3 } = AF.Math;

  const PRESETS = {
    sunset: {
      id: 'sunset',
      name: 'Golden Sunset',
      desc: 'Warm twilight sun casting long shadows and amber glitter across turquoise swells.',
      sunDir: [0.54, 0.22, -0.81],
      sunColor: [1.38, 1.00, 0.70],
      fogColor: [0.78, 0.65, 0.58],
      zenith: [0.08, 0.20, 0.46],
      mid: [0.28, 0.44, 0.68],
      horiz: [0.96, 0.70, 0.52],
      raysColor: [1.0, 0.76, 0.48],
      godRayStr: 0.48,
      aurora: 0.0,
      waveScale: 1.0,
      bioFoam: 0.0,
      storminess: 0.0
    },
    noon: {
      id: 'noon',
      name: 'Emerald Noon',
      desc: 'High tropical sun illuminating crystal-clear aquamarine reefs and lush emerald peaks.',
      sunDir: [0.35, 0.68, -0.64],
      sunColor: [1.36, 1.32, 1.22],
      fogColor: [0.68, 0.84, 0.94],
      zenith: [0.08, 0.34, 0.78],
      mid: [0.26, 0.62, 0.92],
      horiz: [0.72, 0.89, 0.96],
      raysColor: [1.0, 0.96, 0.86],
      godRayStr: 0.34,
      aurora: 0.0,
      waveScale: 0.85,
      bioFoam: 0.0,
      storminess: 0.0
    },
    aurora: {
      id: 'aurora',
      name: 'Aurora Twilight',
      desc: 'Starlit indigo sky with dancing northern auroras reflected in bioluminescent surf.',
      sunDir: [-0.42, 0.26, -0.87],
      sunColor: [0.68, 0.82, 1.15],
      fogColor: [0.10, 0.16, 0.30],
      zenith: [0.015, 0.03, 0.09],
      mid: [0.04, 0.10, 0.24],
      horiz: [0.12, 0.24, 0.40],
      raysColor: [0.42, 0.92, 0.88],
      godRayStr: 0.32,
      aurora: 1.0,
      waveScale: 1.05,
      bioFoam: 1.0,
      storminess: 0.0
    },
    storm: {
      id: 'storm',
      name: 'Tempest Surge',
      desc: 'Rolling oceanic swells beneath thunderheads pierced by lightning flashes.',
      sunDir: [0.48, 0.30, -0.82],
      sunColor: [0.85, 0.78, 0.84],
      fogColor: [0.24, 0.28, 0.36],
      zenith: [0.05, 0.07, 0.14],
      mid: [0.14, 0.18, 0.28],
      horiz: [0.36, 0.38, 0.46],
      raysColor: [0.76, 0.82, 0.96],
      godRayStr: 0.26,
      aurora: 0.15,
      waveScale: 1.85,
      bioFoam: 0.25,
      storminess: 1.0
    }
  };

  class AtmosphereController {
    constructor() {
      this.mode = 'sunset'; // 'auto' | 'sunset' | 'noon' | 'aurora' | 'storm'
      this.targetPreset = PRESETS.sunset;
      this.current = this._clonePreset(PRESETS.sunset);
      this.lightning = 0;
      this.nextLightningCd = 4.5;
    }

    _clonePreset(p) {
      return {
        sunDir: Vec3.normalize(Vec3.create(), p.sunDir),
        sunColor: new Float32Array(p.sunColor),
        fogColor: new Float32Array(p.fogColor),
        zenith: new Float32Array(p.zenith),
        mid: new Float32Array(p.mid),
        horiz: new Float32Array(p.horiz),
        raysColor: new Float32Array(p.raysColor),
        godRayStr: p.godRayStr,
        aurora: p.aurora,
        waveScale: p.waveScale,
        bioFoam: p.bioFoam,
        storminess: p.storminess
      };
    }

    setPreset(key, immediate = false) {
      this.mode = key;
      const p = PRESETS[key] || PRESETS.sunset;
      this.targetPreset = p;
      if (immediate) {
        this.current = this._clonePreset(p);
      }
    }

    syncForSector(sector) {
      if (this.mode !== 'auto') return;
      const order = ['noon', 'sunset', 'storm', 'aurora', 'aurora'];
      const key = order[(sector - 1) % order.length];
      this.targetPreset = PRESETS[key];
    }

    update(dt, sound) {
      const t = 1 - Math.exp(-dt * 1.4);
      const c = this.current;
      const trg = this.targetPreset;

      for (let i = 0; i < 3; i++) {
        c.sunDir[i] = lerp(c.sunDir[i], trg.sunDir[i], t);
        c.sunColor[i] = lerp(c.sunColor[i], trg.sunColor[i], t);
        c.fogColor[i] = lerp(c.fogColor[i], trg.fogColor[i], t);
        c.zenith[i] = lerp(c.zenith[i], trg.zenith[i], t);
        c.mid[i] = lerp(c.mid[i], trg.mid[i], t);
        c.horiz[i] = lerp(c.horiz[i], trg.horiz[i], t);
        c.raysColor[i] = lerp(c.raysColor[i], trg.raysColor[i], t);
      }
      Vec3.normalize(c.sunDir, c.sunDir);
      c.godRayStr = lerp(c.godRayStr, trg.godRayStr, t);
      c.aurora = lerp(c.aurora, trg.aurora, t);
      c.waveScale = lerp(c.waveScale, trg.waveScale, t);
      c.bioFoam = lerp(c.bioFoam, trg.bioFoam, t);
      c.storminess = lerp(c.storminess, trg.storminess, t);

      // Storm lightning & thunder
      this.lightning = Math.max(0, this.lightning - dt * 4.2);
      if (c.storminess > 0.45) {
        this.nextLightningCd -= dt;
        if (this.nextLightningCd <= 0) {
          this.nextLightningCd = 4.5 + Math.random() * 6.5;
          this.lightning = 1.0;
          if (sound && sound.playThunder) sound.playThunder();
        }
      }
    }

    applyToRenderer(renderer) {
      const c = this.current;
      Vec3.copy(renderer.sunDir, c.sunDir);
      renderer.sunColor.set(c.sunColor);
      renderer.fogColor.set(c.fogColor);
      renderer.atmo = c;
      renderer.lightning = this.lightning;
    }
  }

  AF.ATMOSPHERE_PRESETS = PRESETS;
  AF.AtmosphereController = AtmosphereController;
})(window.AF = window.AF || {});
