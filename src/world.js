// src/world.js — Continuous Multi-Biome Oceanic Archipelago, Seabed, Beaches, Mountains, Waterfalls & Foliage
(function (AF) {
  'use strict';

  const { clamp, lerp, smoothstep, fbm2, hash2, Mat4 } = AF.Math;

  class World {
    constructor() {
      this.seaLevel = 0.0;

      // Sculpted volcanic & emerald islands rising naturally out of the ocean seabed
      this.islands = [
        { id: 'citadel', cx: -14,  cz: -22,  rx: 56, rz: 52, peak: 11.5, shape: 'atoll' },
        { id: 'north',   cx: 0,    cz: -135, rx: 52, rz: 46, peak: 34.0, shape: 'spire' },
        { id: 'east',    cx: 122,  cz: 14,   rx: 48, rz: 52, peak: 22.0, shape: 'ridge' },
        { id: 'west',    cx: -124, cz: 18,   rx: 50, rz: 48, peak: 25.0, shape: 'crater' },
        { id: 'south',   cx: 4,    cz: 128,  rx: 46, rz: 42, peak: 16.5, shape: 'harbor' },
        { id: 'isleNE',  cx: 84,   cz: -92,  rx: 28, rz: 26, peak: 15.0, shape: 'rock' },
        { id: 'isleNW',  cx: -86,  cz: -90,  rx: 27, rz: 29, peak: 17.5, shape: 'rock' },
        { id: 'farN1',   cx: 185,  cz: -185, rx: 56, rz: 50, peak: 42.0, shape: 'spire' },
        { id: 'farN2',   cx: -195, cz: -175, rx: 58, rz: 48, peak: 46.0, shape: 'spire' },
        { id: 'farE',    cx: 230,  cz: 95,   rx: 50, rz: 46, peak: 32.0, shape: 'spire' },
        { id: 'farW',    cx: -235, cz: 105,  rx: 52, rz: 50, peak: 35.0, shape: 'spire' }
      ];

      // Sky Boost Rings weaving over turquoise bays, stone arches & mountain waterfalls
      this.rings = [
        { x: 0,   y: 8.5,  z: -62,  yaw: 0,     pitch: 0.08,  r: 5.8, cooldown: 0 },
        { x: 0,   y: 16.0, z: -98,  yaw: 0,     pitch: 0.04,  r: 5.8, cooldown: 0 },
        { x: 48,  y: 14.0, z: -112, yaw: -0.78, pitch: 0.05,  r: 5.4, cooldown: 0 },
        { x: 96,  y: 11.5, z: -44,  yaw: -0.45, pitch: -0.06, r: 5.4, cooldown: 0 },
        { x: 122, y: 20.0, z: 14,   yaw: 0.2,   pitch: -0.25, r: 5.8, cooldown: 0 },
        { x: 64,  y: 6.5,  z: 4,    yaw: Math.PI / 2, pitch: 0.04, r: 5.2, cooldown: 0 },
        { x: -64, y: 6.5,  z: 4,    yaw: Math.PI / 2, pitch: -0.04, r: 5.2, cooldown: 0 },
        { x: -124,y: 18.0, z: 18,   yaw: 0,     pitch: 0.0,   r: 5.6, cooldown: 0 },
        { x: -92, y: 12.0, z: -42,  yaw: 0.45,  pitch: -0.06, r: 5.4, cooldown: 0 },
        { x: -48, y: 14.0, z: -112, yaw: 0.78,  pitch: 0.05,  r: 5.4, cooldown: 0 },
        { x: 0,   y: 6.8,  z: 68,   yaw: 0,     pitch: 0.04,  r: 5.4, cooldown: 0 },
        { x: 64,  y: 9.5,  z: 76,   yaw: 0.78,  pitch: 0.08,  r: 5.4, cooldown: 0 },
        { x: -64, y: 9.5,  z: 76,   yaw: -0.78, pitch: 0.08,  r: 5.4, cooldown: 0 },
        { x: 0,   y: 22.0, z: -10,  yaw: 0.35,  pitch: 0.0,   r: 6.5, cooldown: 0 }
      ];

      this.updrafts = [
        { x: 122, y: 1.5, z: 14,  r: 11.0, force: 34, topY: 38 },
        { x: 56,  y: 0.2, z: -64, r: 9.5,  force: 32, topY: 32 },
        { x: -56, y: 0.2, z: -64, r: 9.5,  force: 32, topY: 32 },
        { x: 4,   y: 1.5, z: 128, r: 9.5,  force: 30, topY: 32 }
      ];

      // Natural cliff waterfalls cascading straight into the turquoise ocean!
      this.waterfalls = [
        { x: 18,   y: 18.0, z: -112, w: 6.5, drop: 19.0, dirX: 0.45, dirZ: 0.89 },
        { x: -18,  y: 18.0, z: -112, w: 6.5, drop: 19.0, dirX: -0.45, dirZ: 0.89 },
        { x: -104, y: 14.5, z: 18,   w: 7.0, drop: 15.5, dirX: 0.98, dirZ: -0.15 }
      ];

      this.pillars = [];
      this.gateArches = [];
      this.rocks = [];
      this.trees = [];
      this.palms = [];
      this.lighthouses = [];
      this.reeds = [];
      this.crystals = [];
      this.shards = [];

      this.pylonAnchors = [
        { x: 0,    z: -135 },
        { x: 122,  z: 14 },
        { x: -124, z: 18 },
        { x: 4,    z: 128 },
        { x: 84,   z: -92 },
        { x: -86,  z: -90 },
        { x: 32,   z: -32 },
        { x: -32,  z: 12 }
      ];

      const terrainMesh = this._buildTerrainMesh();
      const oceanMesh = this._buildOceanMesh();
      this.terrainData = terrainMesh;
      this.oceanData = oceanMesh;
      this._populateNatureAndRuins();
    }

    // Continuous worldwide heightfield (mountains, lush plateaus, sandy beaches & ocean seabed)
    sampleElevation(x, z) {
      let h = -11.5; // deep oceanic seabed floor
      const ridgeNoise = fbm2(x * 0.018 + 3.1, z * 0.018 - 4.7, 4);
      const detailNoise = fbm2(x * 0.065 - 8.2, z * 0.065 + 5.4, 3);

      for (let i = 0; i < this.islands.length; i++) {
        const isl = this.islands[i];
        const dx = (x - isl.cx) / isl.rx;
        const dz = (z - isl.cz) / isl.rz;
        const d2 = dx * dx + dz * dz;
        if (d2 > 2.8) continue;

        const d = Math.sqrt(d2);
        // Gentle natural coastline falloff creating wide sandy beaches sloping into turquoise water
        const coastWarp = (ridgeNoise - 0.5) * 0.38 + (detailNoise - 0.5) * 0.14;
        const dw = Math.max(0, d + coastWarp);
        const falloff = Math.exp(-dw * dw * 1.55);

        let localH = -11.5 + (isl.peak + 11.5) * falloff;
        if (isl.shape === 'atoll') {
          const angle = Math.atan2(dz, dx);
          const southCut = smoothstep(0.25, 1.25, angle) * smoothstep(2.8, 1.7, angle) * smoothstep(0.15, 0.85, d);
          localH -= southCut * 4.2;
          if (d < 0.55) {
            localH = lerp(localH, 4.4 + (detailNoise - 0.5) * 1.2, 0.5);
          }
        } else if (isl.shape === 'spire') {
          // Dramatic ridged alpine mountain peak
          const crag = Math.abs(ridgeNoise - 0.5) * 18.0 * falloff;
          localH += crag;
        } else if (isl.shape === 'crater') {
          // Caldera lagoon inside island
          const rim = smoothstep(0.15, 0.52, d) * (1 - smoothstep(0.55, 1.1, d)) * 12.0;
          localH = -10.5 + (isl.peak + 10.5) * falloff + rim - Math.exp(-d * d * 10.0) * 10.0;
        }

        if (localH > h) h = localH;
      }

      // Gentle seabed sandbank ripples
      if (h < 1.2) {
        h += (detailNoise - 0.5) * 1.3;
      }
      return h;
    }

    getGroundAt(x, z) {
      const h = this.sampleElevation(x, z);
      const eps = 0.8;
      const hx1 = this.sampleElevation(x + eps, z);
      const hx0 = this.sampleElevation(x - eps, z);
      const hz1 = this.sampleElevation(x, z + eps);
      const hz0 = this.sampleElevation(x, z - eps);
      const dx = (hx1 - hx0) / (2 * eps);
      const dz = (hz1 - hz0) / (2 * eps);
      const len = Math.hypot(dx, 1, dz);
      return {
        height: h,
        nx: -dx / len,
        ny: 1 / len,
        nz: -dz / len,
        overWater: h < this.seaLevel
      };
    }

    findNearestSafePoint(x, z) {
      return { x: 0, y: 12, z: -10 };
    }

    _buildTerrainMesh() {
      // High-resolution continuous 208x208 terrain mesh covering [-310, +310]
      const N = 208;
      const half = 310;
      const step = (half * 2) / N;
      const verts = new Float32Array((N + 1) * (N + 1) * 13);
      const indices = new Uint32Array(N * N * 6);

      let vo = 0;
      for (let gz = 0; gz <= N; gz++) {
        const z = -half + gz * step;
        for (let gx = 0; gx <= N; gx++) {
          const x = -half + gx * step;
          const g = this.getGroundAt(x, z);
          verts[vo++] = x;
          verts[vo++] = g.height;
          verts[vo++] = z;
          verts[vo++] = g.nx;
          verts[vo++] = g.ny;
          verts[vo++] = g.nz;
          // Base white vertex color (biomes computed smoothly in TERRAIN fragment shader!)
          verts[vo++] = 1.0;
          verts[vo++] = 1.0;
          verts[vo++] = 1.0;
          // mat: roughness=0.82, metallic=0.02, emissive=0, matType=0 (terrain)
          verts[vo++] = 0.82;
          verts[vo++] = 0.02;
          verts[vo++] = 0.0;
          verts[vo++] = 0.0;
        }
      }

      let io = 0;
      const stride = N + 1;
      for (let gz = 0; gz < N; gz++) {
        for (let gx = 0; gx < N; gx++) {
          const a = gz * stride + gx;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          // CCW outward (+Y)
          indices[io++] = a; indices[io++] = c; indices[io++] = b;
          indices[io++] = b; indices[io++] = c; indices[io++] = d;
        }
      }

      // Append smooth waterfall curtains into terrain/world mesh!
      const wfVerts = [];
      const wfIdx = [];
      const baseV = verts.length / 13;
      const pushWfQuad = (a, b, c, d) => {
        const base = baseV + wfVerts.length / 13;
        const pts = [a, b, c, d];
        for (const p of pts) {
          wfVerts.push(p[0], p[1], p[2], 0, 0.3, 0.95, 0.7, 0.92, 1.0, 0.14, 0.2, 0.45, 4.0);
        }
        wfIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      for (const wf of this.waterfalls) {
        const px = -wf.dirZ * (wf.w * 0.5);
        const pz = wf.dirX * (wf.w * 0.5);
        const segs = 6;
        let prevL = null, prevR = null;
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          const out = Math.sqrt(t) * 5.2;
          const cy = wf.y - t * t * wf.drop;
          const hw = 1.0 + t * 0.25;
          const L = [wf.x + px * hw + wf.dirX * out, cy, wf.z + pz * hw + wf.dirZ * out];
          const R = [wf.x - px * hw + wf.dirX * out, cy, wf.z - pz * hw + wf.dirZ * out];
          if (prevL) {
            pushWfQuad(prevL, L, R, prevR);
            pushWfQuad(prevR, R, L, prevL);
          }
          prevL = L; prevR = R;
        }
      }

      const finalVerts = new Float32Array(verts.length + wfVerts.length);
      finalVerts.set(verts, 0);
      finalVerts.set(wfVerts, verts.length);

      const finalIdx = new Uint32Array(indices.length + wfIdx.length);
      finalIdx.set(indices, 0);
      finalIdx.set(wfIdx, indices.length);

      return { vertices: finalVerts, indices: finalIdx };
    }

    _buildOceanMesh() {
      // Non-linear stretched ocean grid: dense near islands, extending smoothly to 1100m horizon!
      const N = 164;
      const verts = new Float32Array((N + 1) * (N + 1) * 13);
      const indices = new Uint32Array(N * N * 6);

      const mapCoord = (u) => {
        // u in [-1, 1] -> dense in center, wide at edges
        return u * (220 + 880 * u * u);
      };

      let vo = 0;
      for (let gz = 0; gz <= N; gz++) {
        const uz = (gz / N) * 2 - 1;
        const z = mapCoord(uz);
        for (let gx = 0; gx <= N; gx++) {
          const ux = (gx / N) * 2 - 1;
          const x = mapCoord(ux);
          const seabedY = (Math.abs(x) < 305 && Math.abs(z) < 305) ? this.sampleElevation(x, z) : -12.0;

          verts[vo++] = x;
          verts[vo++] = 0.0;
          verts[vo++] = z;
          verts[vo++] = 0.0; verts[vo++] = 1.0; verts[vo++] = 0.0;
          verts[vo++] = 1.0; verts[vo++] = 1.0; verts[vo++] = 1.0;
          verts[vo++] = seabedY; // aMat.x = seabed elevation for shoreline foam & turquoise depth!
          verts[vo++] = 0.0; verts[vo++] = 0.0; verts[vo++] = 0.0;
        }
      }

      let io = 0;
      const stride = N + 1;
      for (let gz = 0; gz < N; gz++) {
        for (let gx = 0; gx < N; gx++) {
          const a = gz * stride + gx;
          const b = a + 1;
          const c = a + stride;
          const d = c + 1;
          indices[io++] = a; indices[io++] = c; indices[io++] = b;
          indices[io++] = b; indices[io++] = c; indices[io++] = d;
        }
      }

      return { vertices: verts, indices: indices };
    }

    _populateNatureAndRuins() {
      // Smooth curved Sanctuary Stone Arches spanning turquoise bays & straits
      const archSpecs = [
        { x: 24,  z: -32,  yaw: 0.42,           scale: 1.35 },
        { x: 0,   z: -74,  yaw: 0,              scale: 1.25 },
        { x: 64,  z: 4,    yaw: Math.PI * 0.5,  scale: 1.15 },
        { x: -64, z: 4,    yaw: Math.PI * 0.5,  scale: 1.15 },
        { x: 0,   z: 68,   yaw: 0,              scale: 1.15 }
      ];
      for (const ar of archSpecs) {
        this.gateArches.push({ x: ar.x, y: -1.8, z: ar.z, yaw: ar.yaw, scale: ar.scale });
      }

      // Sculpted Sanctuary Pillars flanking central plateau
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        const px = -14 + Math.cos(a) * 24;
        const pz = -22 + Math.sin(a) * 22;
        const g = this.getGroundAt(px, pz);
        if (g.height > 2.2) {
          this.pillars.push({ x: px, y: g.height - 0.3, z: pz, scale: 1.0, r: 1.25 });
        }
      }

      // Organic Trees, Coastal Boulders & Grass Clumps placed organically on islands!
      for (let idx = 0; idx < this.islands.length; idx++) {
        const isl = this.islands[idx];
        const treeCount = idx === 0 ? 28 : (idx < 5 ? 24 : 10);
        for (let t = 0; t < treeCount; t++) {
          const a = hash2(idx * 23 + t, 3) * Math.PI * 2;
          const rFrac = 0.16 + hash2(t, idx * 11) * 0.62;
          const tx = isl.cx + Math.cos(a) * isl.rx * rFrac;
          const tz = isl.cz + Math.sin(a) * isl.rz * rFrac;
          if (idx === 0 && Math.abs(tx) < 10 && tz > -4 && tz < 32) continue; // Keep title spawn lane clear
          const g = this.getGroundAt(tx, tz);
          if (g.height > 2.4 && g.height < 18.0 && g.ny > 0.78) {
            this.trees.push({
              x: tx, y: g.height - 0.25, z: tz,
              yaw: hash2(t * 7, idx) * 6.28,
              scale: 0.85 + hash2(idx, t * 5) * 0.75
            });
          }
        }

        // Coconut palm trees along warm golden sandy beaches!
        const palmCount = idx < 5 ? 20 : 8;
        for (let p = 0; p < palmCount; p++) {
          const a = hash2(idx * 37 + p, 11) * Math.PI * 2;
          const rFrac = 0.42 + hash2(p * 7, idx) * 0.48;
          const px = isl.cx + Math.cos(a) * isl.rx * rFrac;
          const pz = isl.cz + Math.sin(a) * isl.rz * rFrac;
          if (idx === 0 && Math.abs(px - 32) < 12 && pz > 10) continue;
          const g = this.getGroundAt(px, pz);
          if (g.height > 0.35 && g.height < 4.5 && g.ny > 0.68) {
            this.palms.push({
              x: px, y: g.height - 0.2, z: pz,
              yaw: a + hash2(p, idx * 3),
              scale: 0.90 + hash2(idx, p * 9) * 0.60
            });
          }
        }

        // Natural coastal boulders embedded firmly on gentle beaches & terraces
        const rockCount = idx < 5 ? 16 : 6;
        for (let k = 0; k < rockCount; k++) {
          const a = hash2(idx * 41 + k, 7) * Math.PI * 2;
          const rFrac = 0.45 + hash2(k * 5, idx) * 0.50;
          const rx = isl.cx + Math.cos(a) * isl.rx * rFrac;
          const rz = isl.cz + Math.sin(a) * isl.rz * rFrac;
          const g = this.getGroundAt(rx, rz);
          if (g.height > -0.4 && g.height < 12.0 && g.ny > 0.72) {
            const sc = 1.0 + hash2(idx, k * 13) * 1.6;
            this.rocks.push({
              x: rx, y: g.height - 0.42 * sc, z: rz,
              yaw: hash2(k, idx * 9) * 6.28,
              scale: sc
            });
          }
        }

        // Grass tufts on meadows
        const grassCount = idx < 5 ? 65 : 20;
        for (let r = 0; r < grassCount; r++) {
          const a = hash2(idx * 53 + r, 2) * Math.PI * 2;
          const rFrac = 0.14 + hash2(r * 3, idx) * 0.68;
          const gx = isl.cx + Math.cos(a) * isl.rx * rFrac;
          const gz = isl.cz + Math.sin(a) * isl.rz * rFrac;
          const g = this.getGroundAt(gx, gz);
          if (g.height > 2.2 && g.height < 17.5 && g.ny > 0.80) {
            this.reeds.push({
              x: gx, y: g.height - 0.15, z: gz,
              yaw: hash2(r, idx) * 6.28,
              scale: 0.75 + hash2(r * 9, idx) * 0.65,
              phase: hash2(r, idx * 5) * 6.28
            });
          }
        }
      }

      // Ancient coastal lighthouse on South Harbor headland
      const lhG = this.getGroundAt(14, 118);
      this.lighthouses.push({ x: 14, y: Math.max(lhG.height, 2.0) - 0.3, z: 118, scale: 1.0 });

      this.respawnShards();
    }

    respawnShards() {
      this.shards.length = 0;
      for (const ring of this.rings) {
        this.shards.push({
          x: ring.x, y: ring.y, z: ring.z,
          collected: false, bobOffset: Math.random() * 6.28
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const px = Math.cos(a) * 32;
        const pz = -10 + Math.sin(a) * 32;
        const g = this.getGroundAt(px, pz);
        this.shards.push({
          x: px, y: Math.max(3.5, g.height + 2.8), z: pz,
          collected: false, bobOffset: i * 1.1
        });
      }
    }

    pushVisuals(renderer, time) {
      const m = Mat4.create();

      // Monumental Curved Stone Arches
      for (const ga of this.gateArches) {
        Mat4.composeYXZ(m, ga.x, ga.y, ga.z, ga.yaw, 0, 0, ga.scale, ga.scale, ga.scale);
        renderer.litBatches.gateArch.push(m, 1, 1, 1, 0.0);
      }

      // Fluted Columns
      for (const p of this.pillars) {
        Mat4.composeYXZ(m, p.x, p.y, p.z, 0, 0, 0, p.scale, p.scale, p.scale);
        renderer.litBatches.pillar.push(m, 1, 1, 1, 0.02);
      }

      // Organic Coastal Boulders
      for (const rk of this.rocks) {
        Mat4.composeYXZ(m, rk.x, rk.y, rk.z, rk.yaw, 0, 0, rk.scale, rk.scale * 0.82, rk.scale);
        renderer.litBatches.rock.push(m, 1, 1, 1, 0.0);
      }

      // Lush Organic Trees & Beach Palms (subtle wind sway!)
      for (const tr of this.trees) {
        const sway = Math.sin(time * 1.4 + tr.x * 0.08) * 0.025;
        Mat4.composeYXZ(m, tr.x, tr.y, tr.z, tr.yaw, sway, sway * 0.5, tr.scale, tr.scale, tr.scale);
        renderer.litBatches.tree.push(m, 1, 1, 1, 0.0);
      }
      for (const pm of this.palms) {
        const sway = Math.sin(time * 1.8 + pm.x * 0.1) * 0.04;
        Mat4.composeYXZ(m, pm.x, pm.y, pm.z, pm.yaw, sway, sway * 0.6, pm.scale, pm.scale, pm.scale);
        renderer.litBatches.palm.push(m, 1, 1, 1, 0.0);
      }
      for (const lh of this.lighthouses) {
        Mat4.composeYXZ(m, lh.x, lh.y, lh.z, time * 0.5, 0, 0, lh.scale, lh.scale, lh.scale);
        renderer.litBatches.lighthouse.push(m, 1, 1, 1, 0.15);
      }

      // Swaying Meadow Grass Tufts
      for (const rd of this.reeds) {
        const swayX = Math.sin(time * 2.2 + rd.phase) * 0.09;
        const swayZ = Math.cos(time * 1.8 + rd.phase) * 0.06;
        Mat4.composeYXZ(m, rd.x, rd.y, rd.z, rd.yaw, swayX, swayZ, rd.scale, rd.scale, rd.scale);
        renderer.litBatches.reed.push(m, 1, 1, 1, 0.0);
      }

      // Boost Sky Rings
      for (const ring of this.rings) {
        const active = ring.cooldown <= 0;
        const glow = active ? (0.75 + 0.2 * Math.sin(time * 3.5 + ring.x)) : 0.12;
        Mat4.composeYXZ(m, ring.x, ring.y, ring.z, ring.yaw, ring.pitch, time * 0.55, ring.r, ring.r, ring.r);
        renderer.litBatches.torus.push(m, active ? 0.45 : 0.3, active ? 0.95 : 0.4, active ? 1.0 : 0.5, glow);
      }

      // Collectible Shards
      for (const s of this.shards) {
        if (s.collected) continue;
        const y = s.y + Math.sin(time * 2.6 + s.bobOffset) * 0.45;
        Mat4.composeYXZ(m, s.x, y, s.z, time * 1.9 + s.bobOffset, 0.15, 0, 0.95, 0.95, 0.95);
        renderer.litBatches.shard.push(m, 1.0, 0.95, 0.72, 0.85);
      }

      // Updraft Wind Rings
      for (const u of this.updrafts) {
        for (let k = 0; k < 3; k++) {
          const phase = ((time * 0.75 + k / 3) % 1);
          const uy = u.y + phase * (u.topY - u.y);
          const sc = u.r * (0.65 + 0.35 * (1 - phase));
          const alpha = Math.sin(phase * Math.PI) * 0.36;
          Mat4.composeYXZ(m, u.x, uy, u.z, time * 1.5 + k, 0, 0, sc, 1, sc);
          renderer.vfxBatches.flatRing.push(m, 0.65, 0.95, 1.0, alpha);
        }
      }

      // Waterfall Ocean Splash Foam Rings
      for (const wf of this.waterfalls) {
        const phase = (time * 0.95 + wf.x * 0.1) % 1;
        const sc = wf.w * (0.8 + phase * 1.3);
        const mx = wf.x + wf.dirX * 5;
        const mz = wf.z + wf.dirZ * 5;
        Mat4.composeYXZ(m, mx, 0.25 + phase * 0.8, mz, time, 0, 0, sc, 1, sc);
        renderer.vfxBatches.flatRing.push(m, 0.92, 0.98, 1.0, Math.sin(phase * Math.PI) * 0.55);
      }
    }
  }

  AF.World = World;
})(window.AF = window.AF || {});
