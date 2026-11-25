// src/webgl.js — Realistic WebGL2 Engine: Gerstner Ocean Pass, Multi-Biome Terrain, PCF Shadows & Bloom
(function (AF) {
  'use strict';

  const { Mat4, Vec3, clamp } = AF.Math;
  const Shaders = AF.Shaders;

  function compileShader(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source.trimStart());
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(`Shader compile error: ${log}\n${source.slice(0, 260)}`);
    }
    return sh;
  }

  function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program link error: ${log}`);
    }
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(prog, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { prog, uniforms };
  }

  function bindStaticMeshLayout(gl) {
    const stride = 13 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 36);
  }

  function createStaticMesh(gl, data) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    bindStaticMeshLayout(gl);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vbo, ibo, indexCount: data.indices.length };
  }

  class InstancedBatch {
    constructor(gl, mesh, maxInstances, hasExtra = true) {
      this.gl = gl;
      this.mesh = mesh;
      this.maxInstances = maxInstances;
      this.hasExtra = hasExtra;
      this.strideFloats = hasExtra ? 24 : 20;
      this.data = new Float32Array(maxInstances * this.strideFloats);
      this.count = 0;

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
      bindStaticMeshLayout(gl);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);

      this.instVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

      const iStride = this.strideFloats * 4;
      for (let col = 0; col < 4; col++) {
        const loc = 4 + col;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, iStride, col * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.enableVertexAttribArray(8);
      gl.vertexAttribPointer(8, 4, gl.FLOAT, false, iStride, 64);
      gl.vertexAttribDivisor(8, 1);

      if (hasExtra) {
        gl.enableVertexAttribArray(9);
        gl.vertexAttribPointer(9, 4, gl.FLOAT, false, iStride, 80);
        gl.vertexAttribDivisor(9, 1);
      }
      gl.bindVertexArray(null);
    }

    reset() {
      this.count = 0;
    }

    push(mat, r, g, b, a, ex = 0, ey = 1, ez = 0, ew = 0) {
      if (this.count >= this.maxInstances) return;
      const o = this.count * this.strideFloats;
      this.data.set(mat, o);
      this.data[o + 16] = r;
      this.data[o + 17] = g;
      this.data[o + 18] = b;
      this.data[o + 19] = a;
      if (this.hasExtra) {
        this.data[o + 20] = ex;
        this.data[o + 21] = ey;
        this.data[o + 22] = ez;
        this.data[o + 23] = ew;
      }
      this.count++;
    }

    uploadAndDraw() {
      if (this.count === 0) return;
      const gl = this.gl;
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.count * this.strideFloats));
      gl.drawElementsInstanced(gl.TRIANGLES, this.mesh.indexCount, gl.UNSIGNED_INT, 0, this.count);
      gl.bindVertexArray(null);
    }
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        powerPreference: 'high-performance'
      });
      if (!gl) {
        throw new Error('WebGL2 is required to run AETHERFALL.');
      }
      this.gl = gl;

      this.quality = 'high';
      this.width = 1;
      this.height = 1;
      this.shadowSize = 1024;

      this.progSky = createProgram(gl, Shaders.FULLSCREEN_VS, Shaders.SKY_FS);
      this.progShadow = createProgram(gl, Shaders.SHADOW_VS, Shaders.SHADOW_FS);
      this.progShadowInst = createProgram(gl, Shaders.SHADOW_INST_VS, Shaders.SHADOW_FS);
      this.progOcean = createProgram(gl, Shaders.OCEAN_VS, Shaders.OCEAN_FS);
      this.progLit = createProgram(gl, Shaders.LIT_VS, Shaders.LIT_FS);
      this.progLitInst = createProgram(gl, Shaders.LIT_INST_VS, Shaders.LIT_INST_FS);
      this.progVfxInst = createProgram(gl, Shaders.VFX_INST_VS, Shaders.VFX_INST_FS);
      this.progTrail = createProgram(gl, Shaders.TRAIL_VS, Shaders.TRAIL_FS);
      this.progBlur = createProgram(gl, Shaders.FULLSCREEN_VS, Shaders.BLUR_FS);
      this.progComposite = createProgram(gl, Shaders.FULLSCREEN_VS, Shaders.COMPOSITE_FS);

      this.emptyVao = gl.createVertexArray();

      const rawMeshes = AF.Meshes.buildAll();
      this.meshes = {};
      for (const [k, v] of Object.entries(rawMeshes)) {
        this.meshes[k] = createStaticMesh(gl, v);
      }

      this.litBatches = {
        scout: new InstancedBatch(gl, this.meshes.scout, 128, true),
        sentinel: new InstancedBatch(gl, this.meshes.sentinel, 64, true),
        shieldPlate: new InstancedBatch(gl, this.meshes.shieldPlate, 256, true),
        sniper: new InstancedBatch(gl, this.meshes.sniper, 64, true),
        pylon: new InstancedBatch(gl, this.meshes.pylon, 32, true),
        crystal: new InstancedBatch(gl, this.meshes.crystal, 160, true),
        pillar: new InstancedBatch(gl, this.meshes.pillar, 128, true),
        gateArch: new InstancedBatch(gl, this.meshes.gateArch, 32, true),
        rock: new InstancedBatch(gl, this.meshes.rock, 240, true),
        tree: new InstancedBatch(gl, this.meshes.tree, 320, true),
        palm: new InstancedBatch(gl, this.meshes.palm, 200, true),
        lighthouse: new InstancedBatch(gl, this.meshes.lighthouse, 8, true),
        gunboat: new InstancedBatch(gl, this.meshes.gunboat, 16, true),
        leviathanHead: new InstancedBatch(gl, this.meshes.leviathanHead, 4, true),
        leviathanSeg: new InstancedBatch(gl, this.meshes.leviathanSeg, 24, true),
        seagullWing: new InstancedBatch(gl, this.meshes.seagullWing, 96, true),
        manta: new InstancedBatch(gl, this.meshes.manta, 32, true),
        reed: new InstancedBatch(gl, this.meshes.reed, 640, true),
        shard: new InstancedBatch(gl, this.meshes.shard, 128, true),
        torus: new InstancedBatch(gl, this.meshes.torus, 64, true),
        box: new InstancedBatch(gl, this.meshes.box, 256, true),
        sphere: new InstancedBatch(gl, this.meshes.sphere, 128, true)
      };

      this.vfxBatches = {
        sphere: new InstancedBatch(gl, this.meshes.sphere, 1400, false),
        thrusterCone: new InstancedBatch(gl, this.meshes.thrusterCone, 64, false),
        spark: new InstancedBatch(gl, this.meshes.spark, 2200, false),
        box: new InstancedBatch(gl, this.meshes.box, 512, false),
        flatRing: new InstancedBatch(gl, this.meshes.flatRing, 180, false)
      };

      this.fresnelBatch = new InstancedBatch(gl, this.meshes.sphere, 96, false);

      this.maxTrailVerts = 4096;
      this.trailData = new Float32Array(this.maxTrailVerts * 7);
      this.trailVertCount = 0;
      this.trailVao = gl.createVertexArray();
      gl.bindVertexArray(this.trailVao);
      this.trailVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.trailData.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);

      this.shadowFbo = null;
      this.shadowTex = null;
      this.sceneFbo = null;
      this.sceneColorTex = null;
      this.sceneGlowTex = null;
      this.sceneDepthRb = null;
      this.bloomLevels = [];

      this.viewMat = Mat4.create();
      this.projMat = Mat4.create();
      this.viewProjMat = Mat4.create();
      this.invViewProjMat = Mat4.create();
      this.lightViewMat = Mat4.create();
      this.lightProjMat = Mat4.create();
      this.lightVPMat = Mat4.create();
      this.identityMat = Mat4.create();
      this._tmpNormalMat = Mat4.create();

      // Golden-hour maritime sun direction & default atmosphere state
      this.sunDir = Vec3.normalize(Vec3.create(), [0.54, 0.22, -0.81]);
      this.sunColor = new Float32Array([1.38, 1.02, 0.72]);
      this.fogColor = new Float32Array([0.78, 0.66, 0.60]);
      this.lightning = 0;
      this.atmo = {
        zenith: new Float32Array([0.08, 0.20, 0.46]),
        mid: new Float32Array([0.28, 0.44, 0.68]),
        horiz: new Float32Array([0.96, 0.70, 0.52]),
        raysColor: new Float32Array([1.0, 0.76, 0.48]),
        godRayStr: 0.48,
        aurora: 0.0,
        waveScale: 1.0,
        bioFoam: 0.0,
        storminess: 0.0
      };
      this.camRoll = 0;
      this.camPos = Vec3.create(0, 12, 24);
      this.camTarget = Vec3.create(0, 2, 0);
      this.upVec = Vec3.create(0, 1, 0);

      this.worldMesh = null;
      this.oceanMesh = null;
      this.worldDrawCalls = [];

      this.initShadowMap(1024);
      this.resize(true);
    }

    setQuality(mode) {
      if (this.quality === mode) return;
      this.quality = mode;
      const sz = mode === 'ultra' ? 2048 : 1024;
      if (sz !== this.shadowSize) {
        this.initShadowMap(sz);
      }
      this.resize(true);
    }

    setWorldMeshes(terrainData, oceanData) {
      const gl = this.gl;
      if (this.worldMesh) {
        gl.deleteVertexArray(this.worldMesh.vao);
        gl.deleteBuffer(this.worldMesh.vbo);
        gl.deleteBuffer(this.worldMesh.ibo);
      }
      if (this.oceanMesh) {
        gl.deleteVertexArray(this.oceanMesh.vao);
        gl.deleteBuffer(this.oceanMesh.vbo);
        gl.deleteBuffer(this.oceanMesh.ibo);
      }
      this.worldMesh = createStaticMesh(gl, terrainData);
      this.oceanMesh = createStaticMesh(gl, oceanData);
    }

    initShadowMap(size) {
      const gl = this.gl;
      this.shadowSize = size;
      if (this.shadowFbo) gl.deleteFramebuffer(this.shadowFbo);
      if (this.shadowTex) gl.deleteTexture(this.shadowTex);

      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.shadowFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    createColorTex(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    resize(force = false) {
      const dprCap = this.quality === 'ultra' ? 2.0 : this.quality === 'high' ? 1.5 : 1.0;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const cw = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
      const ch = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
      if (!force && cw === this.width && ch === this.height) return;

      this.width = cw;
      this.height = ch;
      this.canvas.width = cw;
      this.canvas.height = ch;

      const gl = this.gl;
      if (this.sceneFbo) gl.deleteFramebuffer(this.sceneFbo);
      if (this.sceneColorTex) gl.deleteTexture(this.sceneColorTex);
      if (this.sceneGlowTex) gl.deleteTexture(this.sceneGlowTex);
      if (this.sceneDepthRb) gl.deleteRenderbuffer(this.sceneDepthRb);
      for (const lvl of this.bloomLevels) {
        for (let i = 0; i < 2; i++) {
          gl.deleteFramebuffer(lvl.fbos[i]);
          gl.deleteTexture(lvl.texs[i]);
        }
      }
      this.bloomLevels.length = 0;

      this.sceneColorTex = this.createColorTex(cw, ch);
      this.sceneGlowTex = this.createColorTex(cw, ch);
      this.sceneDepthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.sceneDepthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, cw, ch);

      this.sceneFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneColorTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.sceneGlowTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.sceneDepthRb);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

      let bw = cw, bh = ch;
      for (let tier = 0; tier < 3; tier++) {
        bw = Math.max(2, Math.floor(bw / 2));
        bh = Math.max(2, Math.floor(bh / 2));
        const fbos = [];
        const texs = [];
        for (let i = 0; i < 2; i++) {
          const tx = this.createColorTex(bw, bh);
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
          gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
          texs.push(tx);
          fbos.push(fb);
        }
        this.bloomLevels.push({ w: bw, h: bh, fbos, texs });
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    beginFrame() {
      for (const b of Object.values(this.litBatches)) b.reset();
      for (const b of Object.values(this.vfxBatches)) b.reset();
      this.fresnelBatch.reset();
      this.worldDrawCalls.length = 0;
      this.trailVertCount = 0;
    }

    addHeroDraw(meshName, modelMat, tint = [1, 1, 1], emissive = 0, rimCol = [0.4, 0.88, 1.0], rimPow = 3.0, hitFlash = 0, castShadow = true) {
      this.worldDrawCalls.push({
        mesh: this.meshes[meshName],
        modelMat: new Float32Array(modelMat),
        tint,
        emissive,
        rimCol,
        rimPow,
        hitFlash,
        castShadow
      });
    }

    addTrailStrip(pts, r, g, b, maxAlpha = 0.85) {
      if (pts.length < 2 || this.trailVertCount + pts.length * 2 + 2 >= this.maxTrailVerts) return;
      const td = this.trailData;
      const pushVert = (x, y, z, cr, cg, cb, ca) => {
        const o = this.trailVertCount * 7;
        td[o] = x; td[o + 1] = y; td[o + 2] = z;
        td[o + 3] = cr; td[o + 4] = cg; td[o + 5] = cb; td[o + 6] = ca;
        this.trailVertCount++;
      };

      const cam = this.camPos;
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        const next = pts[Math.min(i + 1, pts.length - 1)];
        const prev = pts[Math.max(i - 1, 0)];
        let tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;

        const vx = cam[0] - cur.x, vy = cam[1] - cur.y, vz = cam[2] - cur.z;
        let sx = ty * vz - tz * vy;
        let sy = tz * vx - tx * vz;
        let sz = tx * vy - ty * vx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const hw = cur.w * cur.alpha;
        sx = (sx / sl) * hw;
        sy = (sy / sl) * hw;
        sz = (sz / sl) * hw;

        const a = cur.alpha * maxAlpha;
        if (i === 0 && this.trailVertCount > 0) {
          pushVert(cur.x + sx, cur.y + sy, cur.z + sz, r, g, b, 0);
        }
        pushVert(cur.x + sx, cur.y + sy, cur.z + sz, r, g, b, a);
        pushVert(cur.x - sx, cur.y - sy, cur.z - sz, r, g, b, a);
        if (i === pts.length - 1) {
          pushVert(cur.x - sx, cur.y - sy, cur.z - sz, r, g, b, 0);
        }
      }
    }

    render(time, fovRad, boostFactor, damageFlash, combatIntensity, shadowFocusPos) {
      this.resize(false);
      const gl = this.gl;
      const useShadows = this.quality !== 'fast';
      const useBloom = this.quality !== 'fast';

      const aspect = this.width / this.height;
      // Smooth dynamic camera horizon banking roll
      const cr = Math.cos(this.camRoll), sr = Math.sin(this.camRoll);
      const fwdCam = Vec3.normalize(Vec3.create(), [
        this.camTarget[0] - this.camPos[0],
        this.camTarget[1] - this.camPos[1],
        this.camTarget[2] - this.camPos[2]
      ]);
      const rightCam = Vec3.normalize(Vec3.create(), Vec3.cross(Vec3.create(), fwdCam, [0, 1, 0]));
      const tiltedUp = [
        this.upVec[0] * cr + rightCam[0] * sr,
        this.upVec[1] * cr + rightCam[1] * sr,
        this.upVec[2] * cr + rightCam[2] * sr
      ];
      Mat4.lookAt(this.viewMat, this.camPos, this.camTarget, tiltedUp);
      Mat4.perspective(this.projMat, fovRad, aspect, 0.25, 1600.0);
      Mat4.multiply(this.viewProjMat, this.projMat, this.viewMat);
      Mat4.invert(this.invViewProjMat, this.viewProjMat);

      // Sun screen position for volumetric sun shafts
      const sunFarX = this.camPos[0] + this.sunDir[0] * 600;
      const sunFarY = this.camPos[1] + this.sunDir[1] * 600;
      const sunFarZ = this.camPos[2] + this.sunDir[2] * 600;
      const vp = this.viewProjMat;
      const scx = vp[0] * sunFarX + vp[4] * sunFarY + vp[8] * sunFarZ + vp[12];
      const scy = vp[1] * sunFarX + vp[5] * sunFarY + vp[9] * sunFarZ + vp[13];
      const scw = vp[3] * sunFarX + vp[7] * sunFarY + vp[11] * sunFarZ + vp[15];
      let sunU = 0.5, sunV = 0.5, sunVisible = 0;
      if (scw > 0.1) {
        sunU = (scx / scw) * 0.5 + 0.5;
        sunV = (scy / scw) * 0.5 + 0.5;
        const offDist = Math.hypot(sunU - 0.5, sunV - 0.5);
        sunVisible = clamp(1.3 - offDist * 1.1, 0, 1);
      }

      const focus = shadowFocusPos || this.camTarget;
      const shadowHalf = 110;
      const snap = (shadowHalf * 2) / this.shadowSize;
      const fx = Math.round(focus[0] / snap) * snap;
      const fy = Math.round(focus[1] / snap) * snap;
      const fz = Math.round(focus[2] / snap) * snap;
      const lightEye = [
        fx + this.sunDir[0] * 160,
        fy + this.sunDir[1] * 160,
        fz + this.sunDir[2] * 160
      ];
      Mat4.lookAt(this.lightViewMat, lightEye, [fx, fy, fz], this.upVec);
      Mat4.ortho(this.lightProjMat, -shadowHalf, shadowHalf, -shadowHalf, shadowHalf, 10, 340);
      Mat4.multiply(this.lightVPMat, this.lightProjMat, this.lightViewMat);

      // 1. SHADOW PASS
      if (useShadows) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(2.5, 4.0);

        gl.useProgram(this.progShadow.prog);
        gl.uniformMatrix4fv(this.progShadow.uniforms.uLightVP, false, this.lightVPMat);

        if (this.worldMesh) {
          gl.uniformMatrix4fv(this.progShadow.uniforms.uModel, false, this.identityMat);
          gl.bindVertexArray(this.worldMesh.vao);
          gl.drawElements(gl.TRIANGLES, this.worldMesh.indexCount, gl.UNSIGNED_INT, 0);
        }

        for (const dc of this.worldDrawCalls) {
          if (!dc.castShadow) continue;
          gl.uniformMatrix4fv(this.progShadow.uniforms.uModel, false, dc.modelMat);
          gl.bindVertexArray(dc.mesh.vao);
          gl.drawElements(gl.TRIANGLES, dc.mesh.indexCount, gl.UNSIGNED_INT, 0);
        }

        gl.useProgram(this.progShadowInst.prog);
        gl.uniformMatrix4fv(this.progShadowInst.uniforms.uLightVP, false, this.lightVPMat);
        for (const [key, batch] of Object.entries(this.litBatches)) {
          if (key === 'reed') continue;
          batch.uploadAndDraw();
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
      }

      // 2. MAIN SCENE MRT PASS
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, this.width, this.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 2a. Atmospheric Sky Dome
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.progSky.prog);
      gl.uniformMatrix4fv(this.progSky.uniforms.uInvViewProj, false, this.invViewProjMat);
      gl.uniform3fv(this.progSky.uniforms.uCamPos, this.camPos);
      gl.uniform3fv(this.progSky.uniforms.uSunDir, this.sunDir);
      gl.uniform3fv(this.progSky.uniforms.uZenithCol, this.atmo.zenith);
      gl.uniform3fv(this.progSky.uniforms.uMidCol, this.atmo.mid);
      gl.uniform3fv(this.progSky.uniforms.uHorizCol, this.atmo.horiz);
      gl.uniform1f(this.progSky.uniforms.uTime, time);
      gl.uniform1f(this.progSky.uniforms.uIntensity, combatIntensity);
      gl.uniform1f(this.progSky.uniforms.uAuroraStr, this.atmo.aurora);
      gl.uniform1f(this.progSky.uniforms.uLightning, this.lightning);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2b. Opaque Multi-Biome Islands & PBR Entities
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);

      const bindCommonLit = (u) => {
        gl.uniformMatrix4fv(u.uViewProj, false, this.viewProjMat);
        gl.uniformMatrix4fv(u.uLightVP, false, this.lightVPMat);
        gl.uniform3fv(u.uCamPos, this.camPos);
        gl.uniform3fv(u.uSunDir, this.sunDir);
        gl.uniform3fv(u.uSunColor, this.sunColor);
        gl.uniform3fv(u.uFogColor, this.fogColor);
        gl.uniform3fv(u.uZenithCol, this.atmo.zenith);
        gl.uniform3fv(u.uMidCol, this.atmo.mid);
        gl.uniform3fv(u.uHorizCol, this.atmo.horiz);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uUseShadows, useShadows ? 1.0 : 0.0);
        gl.uniform1f(u.uAuroraStr, this.atmo.aurora);
        gl.uniform1f(u.uLightning, this.lightning);
        gl.uniform1i(u.uShadowMap, 0);
      };

      gl.useProgram(this.progLit.prog);
      bindCommonLit(this.progLit.uniforms);

      if (this.worldMesh) {
        const u = this.progLit.uniforms;
        gl.uniformMatrix4fv(u.uModel, false, this.identityMat);
        gl.uniformMatrix4fv(u.uNormalMat, false, this.identityMat);
        gl.uniform1f(u.uIsTerrain, 1.0);
        gl.uniform1f(u.uEmissive, 0.0);
        gl.uniform3f(u.uBaseTint, 1, 1, 1);
        gl.uniform3f(u.uRimColor, 0.98, 0.78, 0.56);
        gl.uniform1f(u.uRimPower, 4.2);
        gl.uniform1f(u.uHitFlash, 0.0);
        gl.bindVertexArray(this.worldMesh.vao);
        gl.drawElements(gl.TRIANGLES, this.worldMesh.indexCount, gl.UNSIGNED_INT, 0);
      }

      for (const dc of this.worldDrawCalls) {
        const u = this.progLit.uniforms;
        gl.uniformMatrix4fv(u.uModel, false, dc.modelMat);
        const nm = this._tmpNormalMat;
        if (Mat4.invert(nm, dc.modelMat)) {
          const t01 = nm[1], t02 = nm[2], t12 = nm[6];
          nm[1] = nm[4]; nm[2] = nm[8]; nm[4] = t01;
          nm[6] = nm[9]; nm[8] = t02; nm[9] = t12;
          nm[12] = nm[13] = nm[14] = 0; nm[3] = nm[7] = nm[11] = 0; nm[15] = 1;
        } else {
          Mat4.identity(nm);
        }
        gl.uniformMatrix4fv(u.uNormalMat, false, nm);
        gl.uniform1f(u.uIsTerrain, 0.0);
        gl.uniform1f(u.uEmissive, dc.emissive);
        gl.uniform3fv(u.uBaseTint, dc.tint);
        gl.uniform3fv(u.uRimColor, dc.rimCol);
        gl.uniform1f(u.uRimPower, dc.rimPow);
        gl.uniform1f(u.uHitFlash, dc.hitFlash);
        gl.bindVertexArray(dc.mesh.vao);
        gl.drawElements(gl.TRIANGLES, dc.mesh.indexCount, gl.UNSIGNED_INT, 0);
      }

      gl.useProgram(this.progLitInst.prog);
      bindCommonLit(this.progLitInst.uniforms);
      {
        const u = this.progLitInst.uniforms;
        gl.uniform1f(u.uIsTerrain, 0.0);
        gl.uniform1f(u.uEmissive, 0.0);
        gl.uniform3f(u.uBaseTint, 1, 1, 1);
        gl.uniform3f(u.uRimColor, 0.95, 0.78, 0.56);
        gl.uniform1f(u.uRimPower, 3.2);
        gl.uniform1f(u.uHitFlash, 0.0);
      }
      for (const batch of Object.values(this.litBatches)) {
        batch.uploadAndDraw();
      }

      // 2c. Gerstner Ocean Water Pass (blended smoothly at sandy shores, writes 0 occlusion in dst alpha!)
      if (this.oceanMesh) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(true);
        gl.disable(gl.CULL_FACE);

        gl.useProgram(this.progOcean.prog);
        const u = this.progOcean.uniforms;
        gl.uniformMatrix4fv(u.uViewProj, false, this.viewProjMat);
        gl.uniformMatrix4fv(u.uLightVP, false, this.lightVPMat);
        gl.uniform3fv(u.uCamPos, this.camPos);
        gl.uniform3fv(u.uSunDir, this.sunDir);
        gl.uniform3fv(u.uSunColor, this.sunColor);
        gl.uniform3fv(u.uFogColor, this.fogColor);
        gl.uniform3fv(u.uZenithCol, this.atmo.zenith);
        gl.uniform3fv(u.uMidCol, this.atmo.mid);
        gl.uniform3fv(u.uHorizCol, this.atmo.horiz);
        gl.uniform1f(u.uTime, time);
        gl.uniform1f(u.uWaveScale, this.atmo.waveScale);
        gl.uniform1f(u.uUseShadows, useShadows ? 1.0 : 0.0);
        gl.uniform1f(u.uIntensity, combatIntensity);
        gl.uniform1f(u.uAuroraStr, this.atmo.aurora);
        gl.uniform1f(u.uLightning, this.lightning);
        gl.uniform1f(u.uBioFoam, this.atmo.bioFoam);
        gl.uniform1i(u.uShadowMap, 0);

        gl.bindVertexArray(this.oceanMesh.vao);
        gl.drawElements(gl.TRIANGLES, this.oceanMesh.indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
      }

      // 2d. Translucent / Additive VFX Passes
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);

      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      gl.useProgram(this.progVfxInst.prog);
      gl.uniformMatrix4fv(this.progVfxInst.uniforms.uViewProj, false, this.viewProjMat);
      gl.uniform3fv(this.progVfxInst.uniforms.uCamPos, this.camPos);
      gl.uniform1f(this.progVfxInst.uniforms.uFresnelMode, 0.0);
      for (const batch of Object.values(this.vfxBatches)) {
        batch.uploadAndDraw();
      }

      if (this.trailVertCount > 3) {
        gl.useProgram(this.progTrail.prog);
        gl.uniformMatrix4fv(this.progTrail.uniforms.uViewProj, false, this.viewProjMat);
        gl.bindVertexArray(this.trailVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.trailData.subarray(0, this.trailVertCount * 7));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.trailVertCount);
        gl.bindVertexArray(null);
      }

      if (this.fresnelBatch.count > 0) {
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.useProgram(this.progVfxInst.prog);
        gl.uniformMatrix4fv(this.progVfxInst.uniforms.uViewProj, false, this.viewProjMat);
        gl.uniform3fv(this.progVfxInst.uniforms.uCamPos, this.camPos);
        gl.uniform1f(this.progVfxInst.uniforms.uFresnelMode, 1.0);
        this.fresnelBatch.uploadAndDraw();
      }

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);

      // 3. 3-TIER PYRAMID BLOOM
      const bloomTexs = [this.sceneGlowTex, this.sceneGlowTex, this.sceneGlowTex];
      if (useBloom && this.bloomLevels.length === 3) {
        gl.useProgram(this.progBlur.prog);
        gl.bindVertexArray(this.emptyVao);
        let srcTex = this.sceneGlowTex;
        for (let tier = 0; tier < 3; tier++) {
          const lvl = this.bloomLevels[tier];
          gl.viewport(0, 0, lvl.w, lvl.h);

          gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.fbos[0]);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.uniform1i(this.progBlur.uniforms.uTex, 0);
          gl.uniform2f(this.progBlur.uniforms.uTexelDir, 1.35 / lvl.w, 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.fbos[1]);
          gl.bindTexture(gl.TEXTURE_2D, lvl.texs[0]);
          gl.uniform2f(this.progBlur.uniforms.uTexelDir, 0, 1.35 / lvl.h);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          bloomTexs[tier] = lvl.texs[1];
          srcTex = lvl.texs[1];
        }
      }

      // 4. COMPOSITE PASS
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.progComposite.prog);
      gl.bindVertexArray(this.emptyVao);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneColorTex);
      gl.uniform1i(this.progComposite.uniforms.uSceneTex, 0);

      for (let tier = 0; tier < 3; tier++) {
        gl.activeTexture(gl.TEXTURE1 + tier);
        gl.bindTexture(gl.TEXTURE_2D, bloomTexs[tier]);
        gl.uniform1i(this.progComposite.uniforms[`uBloomTex${tier}`], 1 + tier);
      }

      gl.uniform1f(this.progComposite.uniforms.uBloomStrength, useBloom ? (this.quality === 'ultra' ? 0.88 : 0.76) : 0.0);
      gl.uniform1f(this.progComposite.uniforms.uBoostFactor, boostFactor);
      gl.uniform1f(this.progComposite.uniforms.uDamageFlash, damageFlash);
      gl.uniform1f(this.progComposite.uniforms.uTime, time);
      gl.uniform1f(this.progComposite.uniforms.uAspect, aspect);
      gl.uniform2f(this.progComposite.uniforms.uSunScreenPos, sunU, sunV);
      gl.uniform1f(this.progComposite.uniforms.uSunVisible, sunVisible);
      gl.uniform3fv(this.progComposite.uniforms.uRaysColor, this.atmo.raysColor);
      gl.uniform1f(this.progComposite.uniforms.uGodRayStr, this.atmo.godRayStr);
      gl.uniform1f(this.progComposite.uniforms.uRainAmount, this.atmo.storminess || 0.0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }
  }

  AF.Renderer = Renderer;
})(window.AF = window.AF || {});
