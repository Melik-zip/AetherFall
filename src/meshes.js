// src/meshes.js — Smooth Lofted & Organic 3D Geometry Builders (Zero Blocky Boxes!)
// Vertex layout: pos(3), normal(3), color(3), mat(roughness, metallic, emissive, matType) => 13 floats
(function (AF) {
  'use strict';

  const { fbm2 } = AF.Math;
  const DEFAULT_MAT = [0.5, 0.15, 0.0, 0.0];

  // Smooth indexed vertex builder with automatic smooth vertex normal accumulation
  class SmoothMeshBuilder {
    constructor() {
      this.positions = [];
      this.normals = [];
      this.colors = [];
      this.mats = [];
      this.indices = [];
    }

    addVertex(x, y, z, col, mat = DEFAULT_MAT, nx = 0, ny = 0, nz = 0) {
      const idx = this.positions.length / 3;
      this.positions.push(x, y, z);
      this.normals.push(nx, ny, nz);
      this.colors.push(col[0], col[1], col[2]);
      this.mats.push(mat[0], mat[1], mat[2], mat[3]);
      return idx;
    }

    addTriIdx(a, b, c) {
      this.indices.push(a, b, c);
    }

    // Loft a smooth closed tube across a list of cross-section rings:
    // Each ring: { cx, cy, cz, rx, ry, fwd?: [fx,fy,fz], segs, col, mat, profileFn? }
    // Uses exact right-handed basis (Right x Up = Forward) so outward winding is guaranteed in any direction!
    addLoft(rings, closeFront = true, closeBack = true) {
      const segs = rings[0].segs || 16;
      const ringIdx = [];

      for (let r = 0; r < rings.length; r++) {
        const rg = rings[r];
        const row = [];

        // Determine forward tangent along loft direction
        let fx = 0, fy = 0, fz = 1;
        if (rg.fwd) {
          fx = rg.fwd[0]; fy = rg.fwd[1]; fz = rg.fwd[2];
        } else if (rings.length > 1) {
          const prev = rings[Math.max(0, r - 1)];
          const next = rings[Math.min(rings.length - 1, r + 1)];
          fx = next.cx - prev.cx; fy = next.cy - prev.cy; fz = next.cz - prev.cz;
        }
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl; fy /= fl; fz /= fl;

        // Right = normalize(cross(worldUp, fwd))
        let rx, ry, rz;
        if (Math.abs(fy) > 0.96) {
          rx = 1; ry = 0; rz = 0;
        } else {
          rx = fz; ry = 0; rz = -fx; // cross((0,1,0), fwd) = (fz, 0, -fx)
          const rl = Math.hypot(rx, rz) || 1;
          rx /= rl; rz /= rl;
        }
        // Up = cross(fwd, right)
        const ux = fy * rz - fz * ry;
        const uy = fz * rx - fx * rz;
        const uz = fx * ry - fy * rx;

        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          let lx = Math.cos(a) * rg.rx;
          let ly = Math.sin(a) * rg.ry;
          if (rg.profileFn) {
            const p = rg.profileFn(a, s, lx, ly);
            lx = p[0]; ly = p[1];
          }
          const wx = rg.cx + rx * lx + ux * ly;
          const wy = rg.cy + ry * lx + uy * ly;
          const wz = rg.cz + rz * lx + uz * ly;

          const c = typeof rg.col === 'function' ? rg.col(a, r) : rg.col;
          const m = typeof rg.mat === 'function' ? rg.mat(a, r) : (rg.mat || DEFAULT_MAT);
          row.push(this.addVertex(wx, wy, wz, c, m));
        }
        ringIdx.push(row);
      }

      for (let r = 0; r < rings.length - 1; r++) {
        const aRow = ringIdx[r];
        const bRow = ringIdx[r + 1];
        for (let s = 0; s < segs; s++) {
          const sn = (s + 1) % segs;
          this.addTriIdx(aRow[s], aRow[sn], bRow[s]);
          this.addTriIdx(aRow[sn], bRow[sn], bRow[s]);
        }
      }

      if (closeBack && rings[0].rx > 0.002) {
        const r0 = rings[0];
        const c0 = typeof r0.col === 'function' ? r0.col(0, 0) : r0.col;
        const m0 = typeof r0.mat === 'function' ? r0.mat(0, 0) : (r0.mat || DEFAULT_MAT);
        const center = this.addVertex(r0.cx, r0.cy, r0.cz, c0, m0);
        for (let s = 0; s < segs; s++) {
          const sn = (s + 1) % segs;
          this.addTriIdx(center, ringIdx[0][sn], ringIdx[0][s]);
        }
      }
      if (closeFront && rings[rings.length - 1].rx > 0.002) {
        const rl = rings[rings.length - 1];
        const cl = typeof rl.col === 'function' ? rl.col(0, rings.length - 1) : rl.col;
        const ml = typeof rl.mat === 'function' ? rl.mat(0, rings.length - 1) : (rl.mat || DEFAULT_MAT);
        const center = this.addVertex(rl.cx, rl.cy, rl.cz, cl, ml);
        const lastRow = ringIdx[rings.length - 1];
        for (let s = 0; s < segs; s++) {
          const sn = (s + 1) % segs;
          this.addTriIdx(center, lastRow[s], lastRow[sn]);
        }
      }
    }

    // Add curved tube along arbitrary 3D points
    addCurvedTube(points, radiusFn, segs = 12, colFn, matFn, closedLoop = false) {
      const rings = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const tx = next[0] - prev[0];
        const ty = next[1] - prev[1];
        const tz = next[2] - prev[2];
        const len = Math.hypot(tx, ty, tz) || 1;
        const r = radiusFn(i / Math.max(1, points.length - 1));
        rings.push({
          cx: p[0], cy: p[1], cz: p[2],
          rx: r, ry: r, fwd: [tx / len, ty / len, tz / len], segs,
          col: colFn(i / Math.max(1, points.length - 1)),
          mat: matFn(i / Math.max(1, points.length - 1))
        });
      }
      this.addLoft(rings, !closedLoop, !closedLoop);
    }

    // Organic noise-sculpted sphere (for boulders, tree canopies, natural rock clusters)
    addOrganicBlob(cx, cy, cz, rx, ry, rz, latBands, lonBands, noiseFreq, noiseAmp, seed, colFn, mat) {
      const startIdx = this.positions.length / 3;
      for (let lat = 0; lat <= latBands; lat++) {
        const theta = (lat * Math.PI) / latBands;
        const sinT = Math.sin(theta), cosT = Math.cos(theta);
        for (let lon = 0; lon <= lonBands; lon++) {
          const phi = (lon * 2 * Math.PI) / lonBands;
          const ux = Math.cos(phi) * sinT;
          const uy = cosT;
          const uz = Math.sin(phi) * sinT;
          const n = fbm2(ux * noiseFreq + seed, uz * noiseFreq + uy * noiseFreq * 0.7 - seed, 3);
          const disp = 1.0 + (n - 0.5) * 2.0 * noiseAmp;
          const vx = cx + ux * rx * disp;
          const vy = cy + uy * ry * disp;
          const vz = cz + uz * rz * disp;
          const col = colFn(uy, n);
          this.addVertex(vx, vy, vz, col, mat);
        }
      }
      for (let lat = 0; lat < latBands; lat++) {
        for (let lon = 0; lon < lonBands; lon++) {
          const first = startIdx + lat * (lonBands + 1) + lon;
          const second = first + lonBands + 1;
          this.addTriIdx(first, first + 1, second);
          this.addTriIdx(second, first + 1, second + 1);
        }
      }
    }

    computeSmoothNormals() {
      const pos = this.positions;
      const nrm = this.normals;
      const idx = this.indices;
      for (let i = 0; i < nrm.length; i++) nrm[i] = 0;

      for (let i = 0; i < idx.length; i += 3) {
        const i0 = idx[i] * 3, i1 = idx[i + 1] * 3, i2 = idx[i + 2] * 3;
        const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
        const abx = pos[i1] - ax, aby = pos[i1 + 1] - ay, abz = pos[i1 + 2] - az;
        const acx = pos[i2] - ax, acy = pos[i2 + 1] - ay, acz = pos[i2 + 2] - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        nrm[i0] += nx; nrm[i0 + 1] += ny; nrm[i0 + 2] += nz;
        nrm[i1] += nx; nrm[i1 + 1] += ny; nrm[i1 + 2] += nz;
        nrm[i2] += nx; nrm[i2 + 1] += ny; nrm[i2 + 2] += nz;
      }

      for (let i = 0; i < nrm.length; i += 3) {
        const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
        nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
      }
    }

    build(recomputeNormals = true) {
      if (recomputeNormals) this.computeSmoothNormals();
      const count = this.positions.length / 3;
      const verts = new Float32Array(count * 13);
      for (let i = 0; i < count; i++) {
        const p = i * 3, m = i * 4, o = i * 13;
        verts[o]     = this.positions[p];
        verts[o + 1] = this.positions[p + 1];
        verts[o + 2] = this.positions[p + 2];
        verts[o + 3] = this.normals[p];
        verts[o + 4] = this.normals[p + 1];
        verts[o + 5] = this.normals[p + 2];
        verts[o + 6] = this.colors[p];
        verts[o + 7] = this.colors[p + 1];
        verts[o + 8] = this.colors[p + 2];
        verts[o + 9]  = this.mats[m];
        verts[o + 10] = this.mats[m + 1];
        verts[o + 11] = this.mats[m + 2];
        verts[o + 12] = this.mats[m + 3];
      }
      return { vertices: verts, indices: new Uint32Array(this.indices) };
    }
  }

  // PBR Material Presets: [roughness, metallic, emissive, matType]
  const MAT = {
    pearlMetal: [0.22, 0.86, 0.0, 0.0],
    carbon:     [0.32, 0.72, 0.0, 0.0],
    gold:       [0.18, 0.94, 0.02, 0.0],
    glass:      [0.06, 0.92, 0.08, 0.0],
    ancient:    [0.65, 0.05, 0.0, 1.0],
    bark:       [0.85, 0.02, 0.0, 1.0],
    foliage:    [0.74, 0.02, 0.0, 2.0],
    rock:       [0.84, 0.04, 0.0, 1.0],
    glowCyan:   [0.16, 0.10, 1.15, 3.0],
    glowGold:   [0.18, 0.20, 1.10, 3.0],
    glowRed:    [0.18, 0.10, 1.25, 3.0],
    glowMag:    [0.18, 0.10, 1.25, 3.0]
  };

  function buildSphere(latBands = 16, lonBands = 24, col = [1, 1, 1], mat = MAT.glowCyan) {
    const sb = new SmoothMeshBuilder();
    sb.addOrganicBlob(0, 0, 0, 1, 1, 1, latBands, lonBands, 1, 0, 0, () => col, mat);
    return sb.build(true);
  }

  function buildTorus(majorR = 1.0, minorR = 0.08, segU = 44, segV = 12, colA = [0.26, 0.28, 0.34], colB = [0.35, 0.92, 1.0]) {
    const sb = new SmoothMeshBuilder();
    const startIdx = sb.positions.length / 3;
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      const isEnergy = (u % 4 === 0);
      const col = isEnergy ? colB : colA;
      const mat = isEnergy ? MAT.glowCyan : MAT.gold;
      for (let v = 0; v <= segV; v++) {
        const phi = (v / segV) * Math.PI * 2;
        const cosP = Math.cos(phi), sinP = Math.sin(phi);
        const r = majorR + minorR * cosP;
        sb.addVertex(r * cosT, r * sinT, minorR * sinP, col, mat, cosP * cosT, cosP * sinT, sinP);
      }
    }
    for (let u = 0; u < segU; u++) {
      for (let v = 0; v < segV; v++) {
        const a = startIdx + u * (segV + 1) + v;
        const b = a + segV + 1;
        sb.addTriIdx(a, b, a + 1);
        sb.addTriIdx(b, b + 1, a + 1);
      }
    }
    return sb.build(false);
  }

  function buildFlatRing(innerR = 0.84, outerR = 1.0, segs = 40, col = [1, 1, 1]) {
    const sb = new SmoothMeshBuilder();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      sb.addVertex(c * innerR, 0, s * innerR, col, MAT.glowCyan, 0, 1, 0);
      sb.addVertex(c * outerR, 0, s * outerR, col, MAT.glowCyan, 0, 1, 0);
    }
    for (let i = 0; i < segs; i++) {
      const k = i * 2;
      sb.addTriIdx(k, k + 2, k + 1);
      sb.addTriIdx(k + 1, k + 2, k + 3);
    }
    return sb.build(false);
  }

  // HERO CRAFT: Smooth Aerodynamic Valkyrie Hydro-Jet (100% lofted curved surfaces, zero boxy parts!)
  function buildPlayerHull() {
    const sb = new SmoothMeshBuilder();
    const pearl = [0.92, 0.94, 0.98];
    const carbon = [0.12, 0.14, 0.20];
    const visor = [0.06, 0.22, 0.38];
    const gold = [0.94, 0.74, 0.34];
    const cyan = [0.32, 0.94, 1.0];

    // Sculpted aerodynamic fuselage from tail (-1.35) to sleek needle nose (+2.15)
    const stations = [
      { z: -1.35, y: 0.08, rx: 0.34, ry: 0.18 },
      { z: -0.95, y: 0.10, rx: 0.54, ry: 0.28 },
      { z: -0.35, y: 0.12, rx: 0.60, ry: 0.34 },
      { z:  0.28, y: 0.10, rx: 0.48, ry: 0.30 },
      { z:  0.95, y: 0.05, rx: 0.28, ry: 0.18 },
      { z:  1.65, y: 0.01, rx: 0.12, ry: 0.08 },
      { z:  2.15, y: -0.02, rx: 0.02, ry: 0.02 }
    ];
    const fuselageRings = stations.map((st, idx) => ({
      cx: 0, cy: st.y, cz: st.z,
      rx: st.rx, ry: st.ry, segs: 18,
      profileFn: (a, s, lx, ly) => {
        // Flattened ventral belly + sleek upper spine ridge
        if (ly < 0) ly *= 0.62;
        if (idx >= 2 && idx <= 4 && ly > 0.12 && Math.abs(lx) < 0.24) ly += 0.14;
        return [lx, ly];
      },
      col: (a) => {
        const s = Math.sin(a);
        if (idx >= 2 && idx <= 4 && s > 0.55) return visor;
        return s < -0.15 ? carbon : pearl;
      },
      mat: (a) => {
        const s = Math.sin(a);
        if (idx >= 2 && idx <= 4 && s > 0.55) return MAT.glass;
        return s < -0.15 ? MAT.carbon : MAT.pearlMetal;
      }
    }));
    sb.addLoft(fuselageRings, true, true);

    // Twin smoothly contoured side engine nacelles + glowing afterburner rings
    for (const side of [-1, 1]) {
      const ox = side * 0.48;
      sb.addLoft([
        { cx: ox, cy: 0.04, cz: -1.42, rx: 0.14, ry: 0.13, segs: 14, col: cyan, mat: MAT.glowCyan },
        { cx: ox, cy: 0.04, cz: -1.25, rx: 0.20, ry: 0.18, segs: 14, col: gold, mat: MAT.gold },
        { cx: ox, cy: 0.04, cz: -0.60, rx: 0.24, ry: 0.20, segs: 14, col: carbon, mat: MAT.carbon },
        { cx: ox * 0.88, cy: 0.02, cz: 0.35, rx: 0.18, ry: 0.14, segs: 14, col: pearl, mat: MAT.pearlMetal },
        { cx: ox * 0.78, cy: 0.00, cz: 0.90, rx: 0.06, ry: 0.06, segs: 14, col: cyan, mat: MAT.glowCyan }
      ], true, true);
    }

    // Swept smooth dorsal tail fin
    const finPts = [
      [0, 0.34, -0.45],
      [0, 0.55, -0.82],
      [0, 0.68, -1.22]
    ];
    sb.addCurvedTube(
      finPts,
      (t) => 0.055 * (1 - t * 0.55),
      10,
      (t) => (t > 0.7 ? gold : carbon),
      (t) => (t > 0.7 ? MAT.gold : MAT.carbon),
      false
    );

    return sb.build(true);
  }

  // Smooth Airfoil Wing (zero flat boxes — true cambered swept airfoil!)
  function buildPlayerWing(side) {
    const sb = new SmoothMeshBuilder();
    const s = side;
    const pearl = [0.90, 0.93, 0.98];
    const carbon = [0.14, 0.16, 0.24];
    const gold = [0.95, 0.75, 0.32];
    const cyan = [0.32, 0.94, 1.0];

    const spanStations = [
      { x: s * 0.38, y: 0.06, zMid: -0.25, chord: 1.45, thick: 0.12 },
      { x: s * 0.95, y: 0.02, zMid: -0.58, chord: 1.08, thick: 0.09 },
      { x: s * 1.55, y: -0.02, zMid: -0.92, chord: 0.72, thick: 0.06 },
      { x: s * 2.02, y: 0.18, zMid: -1.16, chord: 0.38, thick: 0.035 }
    ];

    // Loft across span (14 points around airfoil section)
    const segs = 14;
    const rows = [];
    for (let i = 0; i < spanStations.length; i++) {
      const st = spanStations[i];
      const row = [];
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const cz = st.zMid + Math.cos(a) * (st.chord * 0.5);
        // Tapered trailing edge
        const cy = st.y + Math.sin(a) * st.thick * (0.65 + 0.35 * Math.cos(a));
        const isTip = i === spanStations.length - 1;
        const isTrailing = Math.cos(a) < -0.55;
        const col = isTip ? cyan : (isTrailing ? gold : (Math.sin(a) > 0 ? pearl : carbon));
        const mat = isTip ? MAT.glowCyan : (isTrailing ? MAT.gold : (Math.sin(a) > 0 ? MAT.pearlMetal : MAT.carbon));
        row.push(sb.addVertex(st.x, cy, cz, col, mat));
      }
      rows.push(row);
    }

    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      for (let k = 0; k < segs; k++) {
        const kn = (k + 1) % segs;
        if (s > 0) {
          sb.addTriIdx(a[k], b[k], a[kn]);
          sb.addTriIdx(a[kn], b[k], b[kn]);
        } else {
          sb.addTriIdx(a[k], a[kn], b[k]);
          sb.addTriIdx(a[kn], b[kn], b[k]);
        }
      }
    }
    const lastSt = spanStations[spanStations.length - 1];
    const tipC = sb.addVertex(lastSt.x + s * 0.08, lastSt.y + 0.08, lastSt.zMid, cyan, MAT.glowCyan);
    const lastRow = rows[rows.length - 1];
    for (let k = 0; k < segs; k++) {
      const kn = (k + 1) % segs;
      if (s > 0) sb.addTriIdx(tipC, lastRow[kn], lastRow[k]);
      else sb.addTriIdx(tipC, lastRow[k], lastRow[kn]);
    }

    return sb.build(true);
  }

  // Natural Sculpted Rock Boulder (smooth noise-deformed sphere, zero pyramid corners!)
  function buildRock() {
    const sb = new SmoothMeshBuilder();
    sb.addOrganicBlob(0, 0.35, 0, 1.35, 0.92, 1.18, 12, 16, 1.8, 0.32, 3.7,
      (uy, n) => uy > 0.2 ? [0.36, 0.34, 0.34] : [0.22, 0.21, 0.24],
      MAT.rock
    );
    return sb.build(true);
  }

  // Organic Lush Coastal Tree (curved branched trunk + multi-lobe organic leafy crown!)
  function buildTree() {
    const sb = new SmoothMeshBuilder();
    const barkA = [0.34, 0.23, 0.16];
    const barkB = [0.26, 0.18, 0.13];

    // Curved organic trunk
    sb.addCurvedTube(
      [[0, 0, 0], [0.12, 1.3, 0.08], [0.26, 2.7, -0.06], [0.18, 4.0, -0.14]],
      (t) => 0.44 * (1 - t * 0.58),
      10,
      () => barkA,
      () => MAT.bark,
      false
    );
    // Secondary branch
    sb.addCurvedTube(
      [[0.18, 2.5, -0.02], [-0.55, 3.3, 0.35], [-1.05, 3.9, 0.55]],
      (t) => 0.20 * (1 - t * 0.65),
      8,
      () => barkB,
      () => MAT.bark,
      false
    );

    const leafFn = (uy, n) => {
      const t = Math.max(0, Math.min(1, uy * 0.5 + 0.5));
      return [
        0.12 + 0.18 * t + n * 0.08,
        0.34 + 0.24 * t + n * 0.08,
        0.14 + 0.06 * t
      ];
    };
    // Lush organic multi-cluster canopy
    sb.addOrganicBlob(0.2, 4.5, -0.1, 2.1, 1.35, 1.95, 10, 14, 2.2, 0.28, 1.2, leafFn, MAT.foliage);
    sb.addOrganicBlob(-1.1, 4.1, 0.5, 1.45, 1.05, 1.35, 8, 12, 2.4, 0.28, 4.5, leafFn, MAT.foliage);
    sb.addOrganicBlob(1.2, 3.9, -0.4, 1.35, 0.95, 1.35, 8, 12, 2.4, 0.28, 7.8, leafFn, MAT.foliage);

    return sb.build(true);
  }

  // Lush Coastal Grass / Fern Clump (curved tapering blades)
  function buildReed() {
    const sb = new SmoothMeshBuilder();
    const baseCol = [0.14, 0.32, 0.15];
    const tipCol = [0.36, 0.58, 0.22];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.3;
      const ca = Math.cos(a), sa = Math.sin(a);
      sb.addCurvedTube(
        [[ca * 0.15, 0, sa * 0.15], [ca * 0.35, 0.65, sa * 0.35], [ca * 0.68, 1.18, sa * 0.68]],
        (t) => 0.11 * (1 - t * 0.85),
        6,
        (t) => [baseCol[0] + (tipCol[0] - baseCol[0]) * t, baseCol[1] + (tipCol[1] - baseCol[1]) * t, baseCol[2] + (tipCol[2] - baseCol[2]) * t],
        () => MAT.foliage,
        false
      );
    }
    return sb.build(true);
  }

  // Smooth Curved Ancient Stone Sanctuary Arch (parabolic rounded limestone arch — zero cubes!)
  function buildGateArch() {
    const sb = new SmoothMeshBuilder();
    const stone = [0.56, 0.52, 0.48];
    const gold = [0.85, 0.68, 0.36];
    const pts = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = t * Math.PI; // PI -> 0 arch across X, Y
      const x = -Math.cos(ang) * 7.5;
      const y = Math.sin(ang) * 14.5 - 0.5;
      pts.push([x, y, 0]);
    }
    sb.addCurvedTube(
      pts,
      (t) => 1.15 - Math.sin(t * Math.PI) * 0.22,
      14,
      (t) => (Math.abs(t - 0.5) < 0.08 ? gold : stone),
      (t) => (Math.abs(t - 0.5) < 0.08 ? MAT.gold : MAT.ancient),
      false
    );
    return sb.build(true);
  }

  // Fluted Smooth Sanctuary Column (weathered carved limestone + subtle gold capital, realistic stone!)
  function buildPillar() {
    const sb = new SmoothMeshBuilder();
    const stone = [0.62, 0.57, 0.50];
    const warm  = [0.54, 0.49, 0.43];
    const gold  = [0.82, 0.66, 0.36];
    sb.addLoft([
      { cx: 0, cy: 0.0, cz: 0, rx: 1.25, ry: 1.25, segs: 16, col: warm,  mat: MAT.ancient },
      { cx: 0, cy: 0.7, cz: 0, rx: 0.86, ry: 0.86, segs: 16, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 3.6, cz: 0, rx: 0.72, ry: 0.72, segs: 16, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 6.1, cz: 0, rx: 0.64, ry: 0.64, segs: 16, col: warm,  mat: MAT.ancient },
      { cx: 0, cy: 6.8, cz: 0, rx: 0.98, ry: 0.98, segs: 16, col: gold,  mat: MAT.gold }
    ], true, true);
    return sb.build(true);
  }

  // Manta Skimmer Drone (curved organic biomechanical wing!)
  function buildScout() {
    const sb = new SmoothMeshBuilder();
    const dark = [0.16, 0.14, 0.22];
    const rim  = [0.95, 0.26, 0.38];
    const gold = [0.92, 0.62, 0.28];
    sb.addLoft([
      { cx: 0, cy: 0, cz: -0.95, rx: 0.22, ry: 0.12, segs: 14, col: rim, mat: MAT.glowRed },
      { cx: 0, cy: 0.05, cz: -0.35, rx: 1.35, ry: 0.22, segs: 14, col: dark, mat: MAT.carbon },
      { cx: 0, cy: 0.08, cz: 0.35, rx: 0.78, ry: 0.26, segs: 14, col: gold, mat: MAT.gold },
      { cx: 0, cy: 0.02, cz: 1.25, rx: 0.12, ry: 0.08, segs: 14, col: rim, mat: MAT.glowRed }
    ], true, true);
    return sb.build(true);
  }

  // Aegis Sentinel (smooth metallic orb with glowing equator)
  function buildSentinel() {
    const sb = new SmoothMeshBuilder();
    sb.addOrganicBlob(0, 0, 0, 1.15, 1.15, 1.15, 14, 20, 1.0, 0.06, 2.0,
      (uy) => Math.abs(uy) < 0.22 ? [1.0, 0.48, 0.2] : [0.16, 0.18, 0.26],
      MAT.carbon
    );
    return sb.build(true);
  }

  // Curved Orbital Shield Arc
  function buildShieldPlate() {
    const sb = new SmoothMeshBuilder();
    sb.addCurvedTube(
      [[-0.55, -0.45, 0], [0, -0.55, 0.18], [0, 0.55, 0.18], [0.55, 0.45, 0]],
      () => 0.15,
      10,
      () => [0.95, 0.46, 0.22],
      () => MAT.gold,
      false
    );
    return sb.build(true);
  }

  // Phantom Lance Sniper (sleek curved needle hull)
  function buildSniper() {
    const sb = new SmoothMeshBuilder();
    const dark = [0.12, 0.11, 0.18];
    const mag  = [1.0, 0.28, 0.85];
    sb.addLoft([
      { cx: 0, cy: 0, cz: -1.1, rx: 0.18, ry: 0.16, segs: 14, col: dark, mat: MAT.carbon },
      { cx: 0, cy: 0, cz: -0.2, rx: 0.85, ry: 0.28, segs: 14, col: dark, mat: MAT.carbon },
      { cx: 0, cy: 0, cz: 0.9, rx: 0.35, ry: 0.20, segs: 14, col: mag, mat: MAT.glowMag },
      { cx: 0, cy: 0, cz: 1.9, rx: 0.06, ry: 0.06, segs: 14, col: mag, mat: MAT.glowMag }
    ], true, true);
    return sb.build(true);
  }

  // Corrupted Resonance Obelisk Spire (smooth tapered monolith + glowing core)
  function buildPylon() {
    const sb = new SmoothMeshBuilder();
    const stone = [0.24, 0.22, 0.28];
    const red   = [1.0, 0.25, 0.40];
    const gold  = [0.95, 0.68, 0.30];
    sb.addLoft([
      { cx: 0, cy: 0.0, cz: 0, rx: 2.3, ry: 2.3, pitch: -Math.PI / 2, segs: 16, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 1.4, cz: 0, rx: 1.4, ry: 1.4, pitch: -Math.PI / 2, segs: 16, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 5.5, cz: 0, rx: 0.65, ry: 0.65, pitch: -Math.PI / 2, segs: 16, col: gold, mat: MAT.gold },
      { cx: 0, cy: 8.2, cz: 0, rx: 0.10, ry: 0.10, pitch: -Math.PI / 2, segs: 16, col: red, mat: MAT.glowRed }
    ], true, true);
    return sb.build(true);
  }

  // Boss 1: Obelisk Warden Construct (sculpted curved floating war-idol)
  function buildBossWarden() {
    const sb = new SmoothMeshBuilder();
    const obs = [0.14, 0.12, 0.18];
    const gold = [0.96, 0.68, 0.28];
    const red = [1.0, 0.24, 0.38];
    sb.addLoft([
      { cx: 0, cy: -4.8, cz: 0, rx: 0.15, ry: 0.15, pitch: -Math.PI / 2, segs: 18, col: red, mat: MAT.glowRed },
      { cx: 0, cy: -1.8, cz: 0, rx: 2.1,  ry: 2.1,  pitch: -Math.PI / 2, segs: 18, col: obs, mat: MAT.carbon },
      { cx: 0, cy:  0.4, cz: 0, rx: 3.1,  ry: 3.1,  pitch: -Math.PI / 2, segs: 18, col: gold, mat: MAT.gold },
      { cx: 0, cy:  2.8, cz: 0, rx: 1.8,  ry: 1.8,  pitch: -Math.PI / 2, segs: 18, col: obs, mat: MAT.carbon },
      { cx: 0, cy:  5.2, cz: 0, rx: 0.2,  ry: 0.2,  pitch: -Math.PI / 2, segs: 18, col: red, mat: MAT.glowRed }
    ], true, true);
    return sb.build(true);
  }

  // Boss 2: Eclipse Seraph Celestial Leviathan (curved sweeping wings + smooth serpentine body)
  function buildBossSeraph() {
    const sb = new SmoothMeshBuilder();
    const obs = [0.14, 0.12, 0.22];
    const gold = [0.98, 0.76, 0.32];
    const core = [1.0, 0.26, 0.52];

    // Smooth central fuselage
    sb.addLoft([
      { cx: 0, cy: -3.2, cz: -1.4, rx: 0.18, ry: 0.18, pitch: -Math.PI / 2, segs: 16, col: core, mat: MAT.glowRed },
      { cx: 0, cy: 0.0, cz: 0.0, rx: 1.65, ry: 1.4, pitch: -Math.PI / 2, segs: 16, col: obs, mat: MAT.carbon },
      { cx: 0, cy: 2.4, cz: 0.8, rx: 1.15, ry: 1.0, pitch: -Math.PI / 2, segs: 16, col: gold, mat: MAT.gold },
      { cx: 0, cy: 4.2, cz: 1.4, rx: 0.22, ry: 0.22, pitch: -Math.PI / 2, segs: 16, col: core, mat: MAT.glowRed }
    ], true, true);

    // Sweeping organic winged arcs (3 pairs)
    for (const side of [-1, 1]) {
      for (let w = 0; w < 3; w++) {
        const yB = 1.6 - w * 1.2;
        const span = 6.8 - w * 1.1;
        sb.addCurvedTube(
          [
            [side * 1.1, yB, 0.2],
            [side * (span * 0.55), yB + 1.8 - w * 0.3, -0.6],
            [side * span, yB + 0.4 - w * 0.4, -1.8]
          ],
          (t) => 0.45 * (1 - t * 0.75),
          10,
          (t) => (t > 0.65 ? core : gold),
          (t) => (t > 0.65 ? MAT.glowRed : MAT.gold),
          false
        );
      }
    }
    return sb.build(true);
  }

  // Smooth faceted crystal cluster
  function buildCrystal() {
    const sb = new SmoothMeshBuilder();
    const base = [0.16, 0.52, 0.74];
    const tip  = [0.46, 0.94, 1.0];
    sb.addLoft([
      { cx: 0, cy: 0.0, cz: 0, rx: 0.7, ry: 0.7, pitch: -Math.PI / 2, segs: 6, col: base, mat: MAT.glass },
      { cx: 0, cy: 2.8, cz: 0, rx: 0.38, ry: 0.38, pitch: -Math.PI / 2, segs: 6, col: tip, mat: MAT.glowCyan },
      { cx: 0, cy: 4.2, cz: 0, rx: 0.02, ry: 0.02, pitch: -Math.PI / 2, segs: 6, col: [1, 1, 1], mat: MAT.glowCyan }
    ], true, true);
    return sb.build(true);
  }

  function buildShard() {
    const sb = new SmoothMeshBuilder();
    sb.addOrganicBlob(0, 0, 0, 0.55, 0.95, 0.55, 8, 12, 1, 0, 0, (uy) => uy > 0 ? [1.0, 0.92, 0.48] : [0.35, 0.94, 1.0], MAT.glowGold);
    return sb.build(true);
  }

  function buildSpark() {
    const sb = new SmoothMeshBuilder();
    sb.addLoft([
      { cx: 0, cy: 0, cz: -0.7, rx: 0.02, ry: 0.02, segs: 8, col: [1, 1, 1], mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz:  0.0, rx: 0.24, ry: 0.24, segs: 8, col: [1, 1, 1], mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz:  0.7, rx: 0.02, ry: 0.02, segs: 8, col: [1, 1, 1], mat: MAT.glowCyan }
    ], true, true);
    return sb.build(true);
  }

  // Smooth Cylinder/Capsule for Laser Beams & Engine Plumes (zero cube bars!)
  function buildUnitBeam() {
    const sb = new SmoothMeshBuilder();
    sb.addLoft([
      { cx: 0, cy: 0, cz: -0.5, rx: 0.5, ry: 0.5, segs: 12, col: [1, 1, 1], mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz:  0.5, rx: 0.5, ry: 0.5, segs: 12, col: [1, 1, 1], mat: MAT.glowCyan }
    ], true, true);
    return sb.build(true);
  }

  // Tempest-RX Interceptor (Sleek Crimson-Cobalt Forward-Swept Fighter)
  function buildTempestHull() {
    const sb = new SmoothMeshBuilder();
    const cobalt = [0.16, 0.24, 0.42];
    const silver = [0.85, 0.90, 0.96];
    const elec = [0.42, 0.85, 1.0];
    const visor = [0.06, 0.28, 0.52];
    sb.addLoft([
      { cx: 0, cy: 0.04, cz: -1.48, rx: 0.24, ry: 0.14, segs: 16, col: elec, mat: MAT.glowCyan },
      { cx: 0, cy: 0.06, cz: -0.90, rx: 0.44, ry: 0.22, segs: 16, col: cobalt, mat: MAT.carbon },
      { cx: 0, cy: 0.12, cz: -0.10, rx: 0.46, ry: 0.28, segs: 16, col: (a) => Math.sin(a) > 0.55 ? visor : silver, mat: (a) => Math.sin(a) > 0.55 ? MAT.glass : MAT.pearlMetal },
      { cx: 0, cy: 0.08, cz:  0.80, rx: 0.26, ry: 0.18, segs: 16, col: cobalt, mat: MAT.pearlMetal },
      { cx: 0, cy: 0.02, cz:  1.75, rx: 0.10, ry: 0.07, segs: 16, col: silver, mat: MAT.pearlMetal },
      { cx: 0, cy: 0.00, cz:  2.35, rx: 0.02, ry: 0.02, segs: 16, col: elec, mat: MAT.glowCyan }
    ], true, true);
    for (const s of [-1, 1]) {
      sb.addLoft([
        { cx: s * 0.36, cy: 0.02, cz: -1.48, rx: 0.12, ry: 0.12, segs: 12, col: elec, mat: MAT.glowCyan },
        { cx: s * 0.36, cy: 0.02, cz: -0.95, rx: 0.16, ry: 0.15, segs: 12, col: cobalt, mat: MAT.carbon },
        { cx: s * 0.30, cy: 0.02, cz:  0.35, rx: 0.10, ry: 0.08, segs: 12, col: silver, mat: MAT.pearlMetal }
      ], true, true);
    }
    return sb.build(true);
  }

  function buildTempestWing(side) {
    const sb = new SmoothMeshBuilder();
    const s = side;
    const cobalt = [0.18, 0.28, 0.48];
    const silver = [0.88, 0.92, 0.98];
    const elec = [0.42, 0.88, 1.0];
    // Forward-swept wing stations!
    const st = [
      { x: s * 0.34, y: 0.05, zMid: -0.55, chord: 1.35, thick: 0.10 },
      { x: s * 1.05, y: 0.08, zMid: -0.15, chord: 0.88, thick: 0.07 },
      { x: s * 1.85, y: 0.18, zMid:  0.35, chord: 0.48, thick: 0.04 }
    ];
    const segs = 14;
    const rows = [];
    for (let i = 0; i < st.length; i++) {
      const row = [];
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const cz = st[i].zMid + Math.cos(a) * (st[i].chord * 0.5);
        const cy = st[i].y + Math.sin(a) * st[i].thick * (0.65 + 0.35 * Math.cos(a));
        const col = i === 2 ? elec : (Math.sin(a) > 0 ? silver : cobalt);
        const mat = i === 2 ? MAT.glowCyan : (Math.sin(a) > 0 ? MAT.pearlMetal : MAT.carbon);
        row.push(sb.addVertex(st[i].x, cy, cz, col, mat));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < segs; k++) {
        const kn = (k + 1) % segs;
        if (s > 0) { sb.addTriIdx(rows[i][k], rows[i + 1][k], rows[i][kn]); sb.addTriIdx(rows[i][kn], rows[i + 1][k], rows[i + 1][kn]); }
        else       { sb.addTriIdx(rows[i][k], rows[i][kn], rows[i + 1][k]); sb.addTriIdx(rows[i][kn], rows[i + 1][kn], rows[i + 1][k]); }
      }
    }
    return sb.build(true);
  }

  // Solaris Titan Heavy Catamaran Gunship (Obsidian + Gold twin-boom + Rail Cannon)
  function buildTitanHull() {
    const sb = new SmoothMeshBuilder();
    const obs = [0.13, 0.12, 0.18];
    const gold = [0.96, 0.74, 0.30];
    const visor = [0.22, 0.12, 0.08];
    // Central Armored Core + Long Rail Cannon Barrel
    sb.addLoft([
      { cx: 0, cy: 0.15, cz: -1.2, rx: 0.45, ry: 0.28, segs: 16, col: obs, mat: MAT.carbon },
      { cx: 0, cy: 0.22, cz:  0.0, rx: 0.62, ry: 0.36, segs: 16, col: (a) => Math.sin(a) > 0.5 ? visor : obs, mat: (a) => Math.sin(a) > 0.5 ? MAT.glass : MAT.carbon },
      { cx: 0, cy: 0.16, cz:  1.1, rx: 0.32, ry: 0.22, segs: 16, col: gold, mat: MAT.gold },
      { cx: 0, cy: 0.14, cz:  2.45, rx: 0.10, ry: 0.10, segs: 12, col: gold, mat: MAT.glowGold }
    ], true, true);
    // Twin Heavy Catamaran Pontoons
    for (const s of [-1, 1]) {
      sb.addLoft([
        { cx: s * 0.72, cy: 0.02, cz: -1.35, rx: 0.20, ry: 0.18, segs: 14, col: gold, mat: MAT.glowGold },
        { cx: s * 0.72, cy: 0.04, cz: -0.45, rx: 0.28, ry: 0.24, segs: 14, col: obs, mat: MAT.carbon },
        { cx: s * 0.72, cy: 0.04, cz:  0.85, rx: 0.24, ry: 0.20, segs: 14, col: gold, mat: MAT.gold },
        { cx: s * 0.72, cy: 0.00, cz:  1.65, rx: 0.05, ry: 0.05, segs: 14, col: obs, mat: MAT.carbon }
      ], true, true);
    }
    return sb.build(true);
  }

  function buildTitanWing(side) {
    const sb = new SmoothMeshBuilder();
    const s = side;
    const obs = [0.14, 0.13, 0.20];
    const gold = [0.96, 0.76, 0.32];
    const st = [
      { x: s * 0.72, y: 0.08, zMid: -0.25, chord: 1.55, thick: 0.14 },
      { x: s * 1.45, y: 0.02, zMid: -0.55, chord: 1.25, thick: 0.10 },
      { x: s * 2.15, y: -0.10, zMid: -0.85, chord: 0.75, thick: 0.06 }
    ];
    const segs = 14;
    const rows = [];
    for (let i = 0; i < st.length; i++) {
      const row = [];
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const cz = st[i].zMid + Math.cos(a) * (st[i].chord * 0.5);
        const cy = st[i].y + Math.sin(a) * st[i].thick;
        const col = i === 2 ? gold : obs;
        const mat = i === 2 ? MAT.glowGold : MAT.carbon;
        row.push(sb.addVertex(st[i].x, cy, cz, col, mat));
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < segs; k++) {
        const kn = (k + 1) % segs;
        if (s > 0) { sb.addTriIdx(rows[i][k], rows[i + 1][k], rows[i][kn]); sb.addTriIdx(rows[i][kn], rows[i + 1][k], rows[i + 1][kn]); }
        else       { sb.addTriIdx(rows[i][k], rows[i][kn], rows[i + 1][k]); sb.addTriIdx(rows[i][kn], rows[i + 1][kn], rows[i + 1][k]); }
      }
    }
    return sb.build(true);
  }

  // Coastal Coconut Palm Tree (slender curved trunk + 7 arching frond blades!)
  function buildPalm() {
    const sb = new SmoothMeshBuilder();
    const trunkCol = [0.42, 0.30, 0.20];
    const frondBase = [0.16, 0.42, 0.16];
    const frondTip  = [0.34, 0.58, 0.20];

    // Graceful leaning curved trunk
    sb.addCurvedTube(
      [[0, 0, 0], [0.22, 1.8, 0.12], [0.58, 3.8, 0.28], [0.95, 5.6, 0.35]],
      (t) => 0.28 * (1 - t * 0.52),
      10,
      () => trunkCol,
      () => MAT.bark,
      false
    );
    // 7 arching palm fronds radiating from crown (0.95, 5.6, 0.35)
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      sb.addCurvedTube(
        [
          [0.95, 5.6, 0.35],
          [0.95 + ca * 1.15, 6.15, 0.35 + sa * 1.15],
          [0.95 + ca * 2.35, 5.75, 0.35 + sa * 2.35],
          [0.95 + ca * 3.15, 4.75, 0.35 + sa * 3.15]
        ],
        (t) => 0.22 * Math.sin(t * Math.PI * 0.85 + 0.15),
        6,
        (t) => [frondBase[0] + (frondTip[0] - frondBase[0]) * t, frondBase[1] + (frondTip[1] - frondBase[1]) * t, frondBase[2] + (frondTip[2] - frondBase[2]) * t],
        () => MAT.foliage,
        false
      );
    }
    return sb.build(true);
  }

  // Ancient Tapered Coastal Beacon Lighthouse
  function buildLighthouse() {
    const sb = new SmoothMeshBuilder();
    const stone = [0.76, 0.72, 0.66];
    const trim  = [0.24, 0.22, 0.28];
    const beacon = [1.0, 0.88, 0.48];
    sb.addLoft([
      { cx: 0, cy: 0.0, cz: 0, rx: 3.4, ry: 3.4, segs: 18, col: trim, mat: MAT.ancient },
      { cx: 0, cy: 2.0, cz: 0, rx: 2.5, ry: 2.5, segs: 18, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 9.0, cz: 0, rx: 1.75, ry: 1.75, segs: 18, col: stone, mat: MAT.ancient },
      { cx: 0, cy: 13.5, cz: 0, rx: 1.45, ry: 1.45, segs: 18, col: trim, mat: MAT.gold },
      { cx: 0, cy: 15.6, cz: 0, rx: 1.20, ry: 1.20, segs: 18, col: beacon, mat: MAT.glowGold },
      { cx: 0, cy: 17.5, cz: 0, rx: 1.65, ry: 1.65, segs: 18, col: trim, mat: MAT.gold },
      { cx: 0, cy: 19.2, cz: 0, rx: 0.15, ry: 0.15, segs: 18, col: trim, mat: MAT.gold }
    ], true, true);
    return sb.build(true);
  }

  // Flapping Seagull Wing Half (articulated from origin outward along +X)
  function buildSeagullWing() {
    const sb = new SmoothMeshBuilder();
    const white = [0.96, 0.97, 1.0];
    const tip = [0.28, 0.30, 0.36];
    sb.addCurvedTube(
      [[0, 0, 0], [0.55, 0.08, -0.05], [1.15, 0.02, -0.25]],
      (t) => 0.14 * (1 - t * 0.72),
      6,
      (t) => (t > 0.75 ? tip : white),
      () => MAT.pearlMetal,
      false
    );
    return sb.build(true);
  }

  // Graceful Swimming Oceanic Manta Ray
  function buildManta() {
    const sb = new SmoothMeshBuilder();
    const top = [0.12, 0.32, 0.48];
    const wing = [0.22, 0.72, 0.88];
    sb.addLoft([
      { cx: 0, cy: 0, cz: -2.2, rx: 0.04, ry: 0.04, segs: 12, col: wing, mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz: -0.7, rx: 0.35, ry: 0.10, segs: 12, col: top, mat: MAT.pearlMetal },
      { cx: 0, cy: 0.05, cz: 0.2, rx: 1.85, ry: 0.16, segs: 14, col: wing, mat: MAT.pearlMetal },
      { cx: 0, cy: 0.04, cz: 0.9, rx: 0.85, ry: 0.14, segs: 12, col: top, mat: MAT.pearlMetal },
      { cx: 0, cy: 0, cz: 1.35, rx: 0.18, ry: 0.06, segs: 12, col: wing, mat: MAT.pearlMetal }
    ], true, true);
    return sb.build(true);
  }

  // Armored Enemy Corsair Gunboat (Sleek Curved Hydrofoil Patrol Boat!)
  function buildGunboat() {
    const sb = new SmoothMeshBuilder();
    const hull = [0.16, 0.15, 0.22];
    const deck = [0.28, 0.26, 0.34];
    const red  = [1.0, 0.28, 0.38];
    const gold = [0.92, 0.62, 0.28];
    sb.addLoft([
      { cx: 0, cy: 0.35, cz: -3.2, rx: 0.95, ry: 0.52, segs: 16, col: hull, mat: MAT.carbon },
      { cx: 0, cy: 0.45, cz: -1.4, rx: 1.55, ry: 0.75, segs: 16, col: deck, mat: MAT.carbon },
      { cx: 0, cy: 0.50, cz:  0.8, rx: 1.35, ry: 0.72, segs: 16, col: deck, mat: MAT.carbon },
      { cx: 0, cy: 0.62, cz:  2.8, rx: 0.58, ry: 0.48, segs: 16, col: hull, mat: MAT.gold },
      { cx: 0, cy: 0.72, cz:  3.8, rx: 0.10, ry: 0.12, segs: 12, col: red,  mat: MAT.glowRed }
    ], true, true);
    // Curved Armored Bridge Dome & Dorsal Plasma Turret
    sb.addOrganicBlob(0, 1.35, -0.3, 0.85, 0.62, 1.15, 8, 12, 1.2, 0.08, 1.0, () => gold, MAT.gold);
    sb.addCurvedTube([[0, 1.55, 0.4], [0, 1.75, 1.9]], (t) => 0.16 * (1 - t * 0.3), 10, () => red, () => MAT.glowRed, false);
    return sb.build(true);
  }

  // Boss 3: Abyssal Sea Leviathan Head (Draconic Sea Serpent Crest!)
  function buildLeviathanHead() {
    const sb = new SmoothMeshBuilder();
    const obs  = [0.10, 0.14, 0.24];
    const teal = [0.16, 0.72, 0.88];
    const gold = [0.98, 0.74, 0.32];
    const eye  = [1.0, 0.22, 0.42];
    sb.addLoft([
      { cx: 0, cy: 0.0, cz: -2.2, rx: 2.2, ry: 1.8, segs: 16, col: obs, mat: MAT.carbon },
      { cx: 0, cy: 0.2, cz: -0.2, rx: 2.6, ry: 2.1, segs: 16, col: teal, mat: MAT.pearlMetal },
      { cx: 0, cy: 0.1, cz:  2.2, rx: 1.7, ry: 1.4, segs: 16, col: gold, mat: MAT.gold },
      { cx: 0, cy: -0.1, cz: 4.2, rx: 0.75, ry: 0.65, segs: 14, col: obs, mat: MAT.carbon },
      { cx: 0, cy: -0.2, cz: 5.2, rx: 0.16, ry: 0.16, segs: 12, col: eye, mat: MAT.glowRed }
    ], true, true);
    // Twin Sweeping Sea-Serpent Horns + Glowing Eye Cores
    for (const s of [-1, 1]) {
      sb.addCurvedTube(
        [[s * 1.4, 1.2, 0.2], [s * 2.6, 2.4, -1.6], [s * 3.1, 2.9, -3.6]],
        (t) => 0.45 * (1 - t * 0.78),
        10,
        (t) => (t > 0.6 ? eye : gold),
        (t) => (t > 0.6 ? MAT.glowRed : MAT.gold),
        false
      );
      sb.addOrganicBlob(s * 1.35, 0.85, 1.65, 0.36, 0.28, 0.48, 8, 10, 1, 0, 0, () => eye, MAT.glowRed);
    }
    return sb.build(true);
  }

  // Abyssal Sea Leviathan Body Segment (armored dorsal crest + bioluminescent lateral fins)
  function buildLeviathanSeg() {
    const sb = new SmoothMeshBuilder();
    const obs  = [0.10, 0.14, 0.24];
    const teal = [0.18, 0.78, 0.92];
    const gold = [0.95, 0.72, 0.30];
    sb.addLoft([
      { cx: 0, cy: 0, cz: -2.0, rx: 1.85, ry: 1.65, segs: 16, col: obs, mat: MAT.carbon },
      { cx: 0, cy: 0.1, cz: 0.0, rx: 2.25, ry: 1.95, segs: 16, col: teal, mat: MAT.pearlMetal },
      { cx: 0, cy: 0, cz: 2.0, rx: 1.85, ry: 1.65, segs: 16, col: obs, mat: MAT.carbon }
    ], true, true);
    sb.addCurvedTube([[0, 1.5, -1.2], [0, 3.2, -0.4], [0, 1.8, 1.1]], (t) => 0.36 * Math.sin(t * Math.PI * 0.8 + 0.2), 8, () => gold, () => MAT.glowCyan, false);
    return sb.build(true);
  }

  // Smooth Tapered Jet Afterburner Plume Cone
  function buildThrusterCone() {
    const sb = new SmoothMeshBuilder();
    sb.addLoft([
      { cx: 0, cy: 0, cz: -1.4, rx: 0.01, ry: 0.01, segs: 14, col: [1, 1, 1], mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz: -0.5, rx: 0.22, ry: 0.20, segs: 14, col: [1, 1, 1], mat: MAT.glowCyan },
      { cx: 0, cy: 0, cz:  0.0, rx: 0.34, ry: 0.30, segs: 14, col: [1, 1, 1], mat: MAT.glowCyan }
    ], true, true);
    return sb.build(true);
  }

  AF.Meshes = {
    buildAll() {
      return {
        playerHull: buildPlayerHull(),
        playerWingL: buildPlayerWing(-1),
        playerWingR: buildPlayerWing(1),
        tempestHull: buildTempestHull(),
        tempestWingL: buildTempestWing(-1),
        tempestWingR: buildTempestWing(1),
        titanHull: buildTitanHull(),
        titanWingL: buildTitanWing(-1),
        titanWingR: buildTitanWing(1),
        scout: buildScout(),
        sentinel: buildSentinel(),
        shieldPlate: buildShieldPlate(),
        sniper: buildSniper(),
        pylon: buildPylon(),
        bossWarden: buildBossWarden(),
        bossSeraph: buildBossSeraph(),
        gunboat: buildGunboat(),
        leviathanHead: buildLeviathanHead(),
        leviathanSeg: buildLeviathanSeg(),
        crystal: buildCrystal(),
        shard: buildShard(),
        pillar: buildPillar(),
        gateArch: buildGateArch(),
        rock: buildRock(),
        tree: buildTree(),
        palm: buildPalm(),
        lighthouse: buildLighthouse(),
        seagullWing: buildSeagullWing(),
        manta: buildManta(),
        reed: buildReed(),
        box: buildUnitBeam(),
        thrusterCone: buildThrusterCone(),
        spark: buildSpark(),
        sphere: buildSphere(14, 20, [1, 1, 1]),
        torus: buildTorus(1.0, 0.075, 44, 12),
        flatRing: buildFlatRing(0.84, 1.0, 40, [1, 1, 1])
      };
    }
  };
})(window.AF = window.AF || {});
