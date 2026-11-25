// src/game.js — Main Game Loop, Camera Rig, Atmosphere & Wildlife Integration, Tactical Radar
(function (AF) {
  'use strict';

  const { clamp, damp, wrapAngle, Vec3, Mat4 } = AF.Math;

  class Game {
    constructor() {
      this.glCanvas = document.getElementById('glCanvas');
      this.hudCanvas = document.getElementById('hudCanvas');
      this.hudCtx = this.hudCanvas.getContext('2d');

      this.renderer = new AF.Renderer(this.glCanvas);
      this.world = new AF.World();
      this.renderer.setWorldMeshes(this.world.terrainData, this.world.oceanData);

      this.sound = new AF.SoundEngine();
      this.particles = new AF.ParticleSystem(1200);
      this.floatingText = new AF.FloatingTextManager();
      this.atmosphere = new AF.AtmosphereController();
      this.wildlife = new AF.WildlifeManager(this.world);
      this.weatherFx = new AF.WeatherEffects(260);
      this.comms = new AF.CommsFeed(this.sound);
      this.codex = new AF.CodexModal();
      this.ghost = new AF.GhostRecorder();
      this.sim = new AF.Simulation(this.world, this.particles, this.floatingText, this.sound);
      this.sim.comms = this.comms;
      this.sim.ghost = this.ghost;
      this.uiCtrl = new AF.UIController(this);
      this.ui = this.uiCtrl.el;

      this.sim.onAchievement = (t, d) => this.uiCtrl.showAchievement(t, d);
      this.sim.onSectorChange = (sec) => {
        this.atmosphere.syncForSector(sec);
        if (this.atmosphere.mode === 'auto' && this.atmosphere.targetPreset) {
          if (this.atmosphere.targetPreset.id === 'storm') this.comms.push('stormWarn');
          else if (this.atmosphere.targetPreset.id === 'aurora') this.comms.push('auroraSight');
        }
      };

      this.state = 'title'; // 'title' | 'playing' | 'paused' | 'relic' | 'ended'
      this.time = 0;
      this.lastTs = 0;
      this.accumulator = 0;
      this.fixedDt = 1 / 60;

      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.fpsDisplay = 60;

      this.camPos = Vec3.create(26.8, 8.0, 45.2);
      this.camTarget = Vec3.create(30.8, 4.2, 2.0);
      this.camFov = 60 * AF.Math.DEG2RAD;
      this.camFwd = Vec3.create(0, 0, -1);
      this.camRight = Vec3.create(1, 0, 0);

      this.keys = Object.create(null);
      this.input = {
        moveX: 0,
        moveZ: 0,
        jumpPressed: false,
        jumpHeld: false,
        dashPressed: false,
        rollPressed: false,
        fireHeld: false,
        missilePressed: false,
        novaPressed: false
      };
      this.pointerLocked = false;
      this.draggingLook = false;
      this.lastMouseX = 0;
      this.lastMouseY = 0;
      this.currentRelicChoices = [];

      this._bindEvents();
      requestAnimationFrame((ts) => this._loop(ts));
    }

    setAtmosphere(presetKey) {
      this.atmosphere.setPreset(presetKey === 'auto' ? 'auto' : presetKey, this.state === 'title');
      if (presetKey === 'auto') {
        this.atmosphere.syncForSector(this.sim.sector);
      }
    }

    _bindEvents() {
      document.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          this.sound.init();
          this.startMode(btn.dataset.mode);
        });
      });

      const syncQuality = (val) => {
        this.renderer.setQuality(val);
        this.ui.qualitySelect.value = val;
        this.ui.pauseQuality.value = val;
      };
      this.ui.qualitySelect.addEventListener('change', (e) => syncQuality(e.target.value));
      this.ui.pauseQuality.addEventListener('change', (e) => syncQuality(e.target.value));

      const syncVolume = (val) => {
        const v = Number(val) / 100;
        this.sound.setVolume(v);
        this.ui.volSlider.value = val;
        this.ui.pauseVol.value = val;
      };
      this.ui.volSlider.addEventListener('input', (e) => syncVolume(e.target.value));
      this.ui.pauseVol.addEventListener('input', (e) => syncVolume(e.target.value));

      document.getElementById('resumeBtn').addEventListener('click', () => this.resumeGame());
      document.getElementById('quitBtn').addEventListener('click', () => this.returnToTitle());
      document.getElementById('retryBtn').addEventListener('click', () => this.startMode(this.sim.mode));
      document.getElementById('endTitleBtn').addEventListener('click', () => this.returnToTitle());
      this.ui.continueEndlessBtn.addEventListener('click', () => {
        this.sim.mode = 'endless';
        this.sim.victory = false;
        this.sim.awaitingRelic = false;
        this.ui.endOverlay.classList.add('hidden');
        this.ui.hud.classList.remove('hidden');
        this.state = 'playing';
        this.sim._setupSector(this.sim.sector + 1);
      });

      window.addEventListener('keydown', (e) => {
        this.keys[e.code] = true;
        if (this.state === 'playing') {
          if (e.code === 'Space') {
            e.preventDefault();
            if (!e.repeat) this.input.jumpPressed = true;
            this.input.jumpHeld = true;
          } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            if (!e.repeat) this.input.dashPressed = true;
          } else if (e.code === 'KeyZ' || e.code === 'KeyC') {
            if (!e.repeat) this.input.rollPressed = true;
          } else if (e.code === 'KeyV') {
            if (!e.repeat) this.uiCtrl.cycleAtmosphere();
          } else if (e.code === 'KeyE') {
            if (!e.repeat) this.input.missilePressed = true;
          } else if (e.code === 'KeyQ' || e.code === 'KeyF') {
            if (!e.repeat) this.input.novaPressed = true;
          } else if (e.code === 'KeyJ' || e.code === 'Enter') {
            this.input.fireHeld = true;
          } else if (e.code === 'KeyP' || e.code === 'Tab' || (e.code === 'Escape' && !this.pointerLocked)) {
            e.preventDefault();
            this.pauseGame();
          }
        } else if (this.state === 'paused') {
          if (e.code === 'Escape' && this.codex.overlay && !this.codex.overlay.classList.contains('hidden')) {
            this.codex.close();
          } else if (e.code === 'KeyK') {
            if (this.codex.overlay && this.codex.overlay.classList.contains('hidden')) this.codex.open();
            else this.codex.close();
          } else if (e.code === 'KeyP' || e.code === 'Escape') {
            this.resumeGame();
          }
        } else if (this.state === 'title') {
          if (e.code === 'KeyK') {
            if (this.codex.overlay && this.codex.overlay.classList.contains('hidden')) this.codex.open();
            else this.codex.close();
          } else if (e.code === 'Escape' && this.codex.overlay && !this.codex.overlay.classList.contains('hidden')) {
            this.codex.close();
          }
        } else if (this.state === 'relic') {
          if (e.code === 'Digit1' && this.currentRelicChoices[0]) this._pickRelic(this.currentRelicChoices[0].id);
          if (e.code === 'Digit2' && this.currentRelicChoices[1]) this._pickRelic(this.currentRelicChoices[1].id);
          if (e.code === 'Digit3' && this.currentRelicChoices[2]) this._pickRelic(this.currentRelicChoices[2].id);
        }
      });

      window.addEventListener('keyup', (e) => {
        this.keys[e.code] = false;
        if (e.code === 'Space') this.input.jumpHeld = false;
        if (e.code === 'KeyJ' || e.code === 'Enter') this.input.fireHeld = false;
      });

      this.glCanvas.addEventListener('mousedown', (e) => {
        if (this.state !== 'playing') return;
        this.sound.init();
        if (!this.pointerLocked && this.glCanvas.requestPointerLock) {
          try {
            const res = this.glCanvas.requestPointerLock();
            if (res && typeof res.catch === 'function') res.catch(() => {});
          } catch (_) {}
        }
        if (e.button === 0) {
          this.input.fireHeld = true;
          this.draggingLook = true;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
        } else if (e.button === 2) {
          this.input.missilePressed = true;
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
          this.input.fireHeld = false;
          this.draggingLook = false;
        }
      });

      this.glCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

      document.addEventListener('pointerlockchange', () => {
        this.pointerLocked = document.pointerLockElement === this.glCanvas;
        this.ui.aimHint.style.opacity = this.pointerLocked ? '0.25' : '0.9';
      });

      window.addEventListener('mousemove', (e) => {
        if (this.state !== 'playing') return;
        const p = this.sim.player;
        if (this.pointerLocked) {
          p.aimYaw = wrapAngle(p.aimYaw + e.movementX * 0.0024);
          p.aimPitch = clamp(p.aimPitch - e.movementY * 0.0020, -0.78, 0.78);
        } else if (this.draggingLook) {
          const dx = e.clientX - this.lastMouseX;
          const dy = e.clientY - this.lastMouseY;
          this.lastMouseX = e.clientX;
          this.lastMouseY = e.clientY;
          p.aimYaw = wrapAngle(p.aimYaw + dx * 0.004);
          p.aimPitch = clamp(p.aimPitch - dy * 0.0035, -0.78, 0.78);
        }
      });
    }

    startMode(mode) {
      this.sound.init();
      this.codex.close();
      const startSec = this.ui.sectorSelect ? (Number(this.ui.sectorSelect.value) || 1) : 1;
      this.sim.startRun(mode, startSec);
      this.state = 'playing';
      this.ui.titleOverlay.classList.add('hidden');
      this.ui.pauseOverlay.classList.add('hidden');
      this.ui.relicOverlay.classList.add('hidden');
      this.ui.endOverlay.classList.add('hidden');
      this.ui.hud.classList.remove('hidden');

      const p = this.sim.player;
      this.camPos[0] = p.pos[0];
      this.camPos[1] = p.pos[1] + 2.8;
      this.camPos[2] = p.pos[2] + 9.5;
      this.camTarget[0] = p.pos[0];
      this.camTarget[1] = p.pos[1] + 1.4;
      this.camTarget[2] = p.pos[2] - 12;

      if (this.glCanvas.requestPointerLock) {
        try {
          const res = this.glCanvas.requestPointerLock();
          if (res && typeof res.catch === 'function') res.catch(() => {});
        } catch (_) {}
      }
    }

    pauseGame() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.input.fireHeld = false;
      this.ui.pauseOverlay.classList.remove('hidden');
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    }

    resumeGame() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.ui.pauseOverlay.classList.add('hidden');
    }

    returnToTitle() {
      this.state = 'title';
      this.input.fireHeld = false;
      this.sim.startRun('expedition');
      this.ui.hud.classList.add('hidden');
      this.ui.pauseOverlay.classList.add('hidden');
      this.ui.relicOverlay.classList.add('hidden');
      this.ui.endOverlay.classList.add('hidden');
      this.ui.titleOverlay.classList.remove('hidden');
      this.uiCtrl.refreshBestScores();
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
    }

    _openRelicDraft() {
      this.state = 'relic';
      this.input.fireHeld = false;
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
      this.currentRelicChoices = this.sim.getRelicChoices();
      this.uiCtrl.showRelicDraft(this.currentRelicChoices, (id) => this._pickRelic(id));
    }

    _pickRelic(id) {
      if (this.state !== 'relic') return;
      this.ui.relicOverlay.classList.add('hidden');
      this.state = 'playing';
      this.sim.applyRelicChoice(id);
    }

    _showEndScreen(isVictory) {
      this.state = 'ended';
      this.input.fireHeld = false;
      if (document.pointerLockElement && document.exitPointerLock) {
        document.exitPointerLock();
      }
      this.uiCtrl.showEndScreen(isVictory);
    }

    _pollKeyboardMovement(dt) {
      const k = this.keys;
      this.input.moveX = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
      this.input.moveZ = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);

      const p = this.sim.player;
      const turnSpd = 2.2;
      if (k.ArrowLeft) p.aimYaw = wrapAngle(p.aimYaw - turnSpd * dt);
      if (k.ArrowRight) p.aimYaw = wrapAngle(p.aimYaw + turnSpd * dt);
      if (k.ArrowUp) p.aimPitch = clamp(p.aimPitch + 1.5 * dt, -0.78, 0.78);
      if (k.ArrowDown) p.aimPitch = clamp(p.aimPitch - 1.5 * dt, -0.78, 0.78);
      if (!this.pointerLocked && !this.draggingLook && this.input.moveX !== 0) {
        p.aimYaw = wrapAngle(p.aimYaw + this.input.moveX * 0.85 * dt);
      }
    }

    _updateCamera(dt) {
      if (this.state === 'title') {
        const p = this.sim.player.pos;
        const sway = Math.sin(this.time * 0.28) * 1.1;
        this.camPos[0] = p[0] - 5.2 + sway * 0.5;
        this.camPos[1] = p[1] + 4.4 + Math.cos(this.time * 0.35) * 0.35;
        this.camPos[2] = p[2] + 9.2;
        this.camTarget[0] = p[0] - 1.2;
        this.camTarget[1] = p[1] + 0.6;
        this.camTarget[2] = p[2] - 34;
        this.camFov = damp(this.camFov, 58 * AF.Math.DEG2RAD, 6, dt);
        this.renderer.camRoll = damp(this.renderer.camRoll, 0.02 * Math.sin(this.time * 0.4), 5, dt);
        return;
      }

      const p = this.sim.player;
      const fwd = p.getForwardDir(this.camFwd);
      Vec3.cross(this.camRight, fwd, [0, 1, 0]);
      Vec3.normalize(this.camRight, this.camRight);

      const boostExtra = (p.dashTimer > 0 ? 2.1 : 0) + (p.ringBoostTimer > 0 ? 1.5 : 0);
      const camDist = 9.2 + boostExtra;
      const desiredX = p.pos[0] - fwd[0] * camDist + this.camRight[0] * 0.65;
      let desiredY = p.pos[1] - fwd[1] * camDist + 2.5;
      const desiredZ = p.pos[2] - fwd[2] * camDist + this.camRight[2] * 0.65;

      const cg = this.world.getGroundAt(desiredX, desiredZ);
      const camFloor = Math.max(cg.height, this.world.seaLevel);
      if (desiredY < camFloor + 1.55) {
        desiredY = camFloor + 1.55;
      }

      this.camPos[0] = damp(this.camPos[0], desiredX, 16, dt);
      this.camPos[1] = damp(this.camPos[1], desiredY, 14, dt);
      this.camPos[2] = damp(this.camPos[2], desiredZ, 16, dt);

      if (this.sim.screenShake > 0.01) {
        const sh = this.sim.screenShake * 0.55;
        this.camPos[0] += (Math.random() - 0.5) * sh;
        this.camPos[1] += (Math.random() - 0.5) * sh;
      }

      const tgtX = p.pos[0] + fwd[0] * 18;
      const tgtY = p.pos[1] + fwd[1] * 18 + 1.2;
      const tgtZ = p.pos[2] + fwd[2] * 18;
      this.camTarget[0] = damp(this.camTarget[0], tgtX, 20, dt);
      this.camTarget[1] = damp(this.camTarget[1], tgtY, 20, dt);
      this.camTarget[2] = damp(this.camTarget[2], tgtZ, 20, dt);

      const speed = Math.hypot(p.vel[0], p.vel[2]);
      const targetFovDeg = 63 + clamp((speed - 24) * 0.35, 0, 14) + (p.dashTimer > 0 ? 5 : 0);
      this.camFov = damp(this.camFov, targetFovDeg * AF.Math.DEG2RAD, 8, dt);
      this.renderer.camRoll = damp(this.renderer.camRoll, -p.bankRoll * 0.16, 7, dt);
    }

    _drawHudOverlay2D() {
      const canvas = this.hudCanvas;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== Math.floor(cw * dpr) || canvas.height !== Math.floor(ch * dpr)) {
        canvas.width = Math.max(1, Math.floor(cw * dpr));
        canvas.height = Math.max(1, Math.floor(ch * dpr));
      }
      const ctx = this.hudCtx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      if (this.state !== 'playing') return;

      const vp = this.renderer.viewProjMat;
      const proj = new Float32Array(3);
      const p = this.sim.player;

      const cx = cw * 0.5;
      const cy = ch * 0.5;
      const spread = 10 + (p.dashTimer > 0 ? 8 : 0) + (this.input.fireHeld ? 4 : 0);
      ctx.strokeStyle = p.nova >= 100 ? 'rgba(255, 224, 102, 0.9)' : 'rgba(92, 242, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, spread, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();

      for (const e of this.sim.enemies) {
        if (e.hp >= e.maxHp) continue;
        if (Mat4.projectToScreen(proj, [e.x, e.y + 2.2, e.z], vp, cw, ch)) {
          const bw = 42, bh = 5;
          ctx.fillStyle = 'rgba(10, 12, 24, 0.8)';
          ctx.fillRect(proj[0] - bw / 2, proj[1], bw, bh);
          ctx.fillStyle = '#ff5678';
          ctx.fillRect(proj[0] - bw / 2, proj[1], bw * clamp(e.hp / e.maxHp, 0, 1), bh);
        }
      }
      for (const b of this.sim.naval.boats) {
        if (b.hp >= b.maxHp) continue;
        if (Mat4.projectToScreen(proj, [b.x, b.y + 3.0, b.z], vp, cw, ch)) {
          const bw = 48, bh = 5;
          ctx.fillStyle = 'rgba(10, 12, 24, 0.8)';
          ctx.fillRect(proj[0] - bw / 2, proj[1], bw, bh);
          ctx.fillStyle = '#ff9f43';
          ctx.fillRect(proj[0] - bw / 2, proj[1], bw * clamp(b.hp / b.maxHp, 0, 1), bh);
        }
      }

      if (this.sim.mode !== 'zen' && this.sim.mode !== 'race') {
        const locked = this.sim.getLockedTargets(4);
        ctx.strokeStyle = '#ffcf5c';
        ctx.lineWidth = 2;
        for (const t of locked) {
          const ty = (t.hp !== undefined && t.radius === undefined) ? t.y + 3.5 : t.y;
          if (Mat4.projectToScreen(proj, [t.x, ty, t.z], vp, cw, ch)) {
            ctx.save();
            ctx.translate(proj[0], proj[1]);
            ctx.rotate(this.time * 2.5);
            ctx.strokeRect(-14, -14, 28, 28);
            ctx.restore();
          }
        }
      }

      const markObj = (x, y, z, color, label) => {
        const onScreen = Mat4.projectToScreen(proj, [x, y, z], vp, cw, ch);
        const dist = Math.round(Math.hypot(x - p.pos[0], y - p.pos[1], z - p.pos[2]));
        if (onScreen && proj[0] > 30 && proj[0] < cw - 30 && proj[1] > 30 && proj[1] < ch - 30) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(proj[0], proj[1] - 10);
          ctx.lineTo(proj[0] + 8, proj[1]);
          ctx.lineTo(proj[0], proj[1] + 10);
          ctx.lineTo(proj[0] - 8, proj[1]);
          ctx.closePath();
          ctx.stroke();
          ctx.font = '700 11px "Segoe UI", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(`${label} ${dist}m`, proj[0], proj[1] - 16);
        } else {
          const dx = x - this.camPos[0];
          const dy = y - this.camPos[1];
          const dz = z - this.camPos[2];
          const sx = dx * this.camRight[0] + dz * this.camRight[2];
          const sz = dx * this.camFwd[0] + dy * this.camFwd[1] + dz * this.camFwd[2];
          const dirX = sx;
          const dirY = sz < 0 ? Math.abs(dy) + 25 : -dy;
          const mag = Math.hypot(dirX, dirY) || 1;
          const ux = dirX / mag, uy = dirY / mag;
          const ex = clamp(cx + ux * (cw * 0.43), 36, cw - 36);
          const ey = clamp(cy + uy * (ch * 0.41), 66, ch - 66);
          const ang = Math.atan2(uy, ux);
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(9, 0);
          ctx.lineTo(-6, -6);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-6, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          ctx.font = '700 10px "Segoe UI", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.fillText(`${dist}m`, ex, ey - 13);
        }
      };

      for (const py of this.sim.pylons) {
        markObj(py.x, py.y + 7.2, py.z, '#ff5678', 'PYLON');
      }
      if (this.sim.boss) {
        markObj(this.sim.boss.x, this.sim.boss.y + 4.0, this.sim.boss.z, '#ffcf5c', 'BOSS');
      }
      if (this.sim.mode === 'race' && this.sim.raceIndex < this.world.rings.length) {
        const ring = this.world.rings[this.sim.raceIndex];
        markObj(ring.x, ring.y, ring.z, '#ffcf5c', `GATE ${this.sim.raceIndex + 1}`);
      }

      this.floatingText.render2D(ctx, vp, cw, ch);

      // Tactical Mini-Radar
      const radR = 52;
      const rx = cw - 76;
      const ry = ch - 118;
      ctx.save();
      ctx.beginPath();
      ctx.arc(rx, ry, radR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 12, 24, 0.68)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(92, 242, 255, 0.35)';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.moveTo(rx - radR, ry); ctx.lineTo(rx + radR, ry);
      ctx.moveTo(rx, ry - radR); ctx.lineTo(rx, ry + radR);
      ctx.stroke();

      const range = 180;
      const yawCos = Math.cos(-p.aimYaw);
      const yawSin = Math.sin(-p.aimYaw);
      const plotDot = (wx, wz, col, sz) => {
        const dx = wx - p.pos[0], dz = wz - p.pos[2];
        const lx = dx * yawCos - dz * yawSin;
        const lz = dx * yawSin + dz * yawCos;
        const px = rx + clamp(lx / range, -0.92, 0.92) * radR;
        const py = ry + clamp(lz / range, -0.92, 0.92) * radR;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.fill();
      };

      for (let ri = 0; ri < this.world.rings.length; ri++) {
        const r = this.world.rings[ri];
        if (this.sim.mode === 'race') {
          if (ri === this.sim.raceIndex) plotDot(r.x, r.z, '#ffcf5c', 4.2);
        } else if (r.cooldown <= 0) {
          plotDot(r.x, r.z, 'rgba(92, 242, 255, 0.6)', 2);
        }
      }
      for (const e of this.sim.enemies) plotDot(e.x, e.z, '#ff6b6b', 2.8);
      for (const b of this.sim.naval.boats) plotDot(b.x, b.z, '#ff9f43', 3.4);
      for (const py of this.sim.pylons) plotDot(py.x, py.z, '#ff3d68', 4.2);
      if (this.sim.boss) plotDot(this.sim.boss.x, this.sim.boss.z, '#ffcf5c', 5.2);
      if (this.sim.mode === 'race') {
        const gs = this.ghost.sampleAt(this.sim.runTime);
        if (gs) plotDot(gs[1], gs[3], '#5cf2ff', 3.8);
      }

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(rx, ry - 5);
      ctx.lineTo(rx + 4, ry + 4);
      ctx.lineTo(rx - 4, ry + 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _loop(ts) {
      if (!this.lastTs) this.lastTs = ts;
      const rawDt = Math.min((ts - this.lastTs) * 0.001, 0.05);
      this.lastTs = ts;
      this.time += rawDt;

      this.fpsFrames++;
      this.fpsTime += rawDt;
      if (this.fpsTime >= 0.5) {
        this.fpsDisplay = Math.round(this.fpsFrames / this.fpsTime);
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }

      this.atmosphere.update(rawDt, this.sound);
      this.atmosphere.applyToRenderer(this.renderer);
      this.wildlife.update(rawDt, this.particles);
      this.weatherFx.update(rawDt, this.atmosphere.current.storminess, this.camPos, this.particles, this.world.seaLevel);
      this.comms.update(rawDt);

      if (this.state === 'playing') {
        this._pollKeyboardMovement(rawDt);
        this.accumulator += rawDt;
        while (this.accumulator >= this.fixedDt) {
          this.sim.update(this.fixedDt, this.input, this.camFwd, this.camRight);
          this.accumulator -= this.fixedDt;
        }

        if (this.sim.gameOver) {
          this._showEndScreen(false);
        } else if (this.sim.victory) {
          this._showEndScreen(true);
        } else if (this.sim.awaitingRelic) {
          this._openRelicDraft();
        }
      }

      this._updateCamera(rawDt);

      const p = this.sim.player;
      const speedNorm = clamp(Math.hypot(p.vel[0], p.vel[2]) / 45, 0, 1);
      const combatInt = this.state === 'playing' && this.sim.mode !== 'zen' && this.sim.mode !== 'race'
        ? clamp((p.flow - 1) * 0.18 + (this.sim.boss ? 0.45 : 0.2), 0, 1)
        : 0.05;
      this.sound.update(rawDt, this.state === 'playing' ? speedNorm : 0.05, p.dashTimer > 0 || p.ringBoostTimer > 0, combatInt);

      if (Math.random() < 0.45) {
        const px = p.pos[0] + (Math.random() - 0.5) * 90;
        const pz = p.pos[2] - 12 - Math.random() * 75;
        const py = 2.0 + Math.random() * 18;
        if (Math.hypot(px - this.camPos[0], pz - this.camPos[2]) > 14) {
          this.particles.spawn({
            x: px, y: py, z: pz,
            vx: (Math.random() - 0.5) * 0.9,
            vy: 0.4 + Math.random() * 0.8,
            vz: (Math.random() - 0.5) * 0.9,
            r: 1.0, g: 0.84, b: 0.48, a: 0.68,
            size: 0.055, endSize: 0.01, life: 2.4, gravity: 0, drag: 0.99, kind: 'orb'
          });
        }
      }
      if (this.state === 'title') {
        this.particles.update(rawDt);
      }

      this.renderer.beginFrame();
      Vec3.copy(this.renderer.camPos, this.camPos);
      Vec3.copy(this.renderer.camTarget, this.camTarget);
      this.world.pushVisuals(this.renderer, this.time);
      this.wildlife.pushVisuals(this.renderer, this.time, this.atmosphere.current.bioFoam);
      this.weatherFx.pushVisuals(this.renderer, this.atmosphere.current.storminess, this.camPos);
      this.sim.renderEntities(this.renderer, this.time);

      const boostFactor = clamp(
        (p.dashTimer > 0 ? 0.9 : 0) + (p.ringBoostTimer > 0 ? 0.55 : 0) + clamp((speedNorm - 0.72) * 1.4, 0, 0.5),
        0, 1
      );
      this.renderer.render(this.time, this.camFov, boostFactor, this.sim.damageFlash, combatInt, p.pos);

      if (this.state === 'playing') {
        this.uiCtrl.updateHUD(rawDt, this.fpsDisplay);
      }
      this._drawHudOverlay2D();

      requestAnimationFrame((t) => this._loop(t));
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    try {
      window.gameApp = new Game();
    } catch (err) {
      console.error(err);
      document.body.innerHTML = `
        <div style="padding:40px;color:#fff;font-family:sans-serif;text-align:center;">
          <h2>WebGL2 Initialization Failed</h2>
          <p style="color:#9eb3d4;margin-top:10px;">${err.message}</p>
        </div>`;
    }
  });
})(window.AF = window.AF || {});
