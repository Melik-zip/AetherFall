// src/ghost.js — Ring Race Ghost Recorder, Playback Interpolator & Split-Time Delta
(function (AF) {
  'use strict';

  const { lerp, Mat4 } = AF.Math;
  const STORAGE_KEY = 'aetherfall_race_ghost_v1';

  class GhostRecorder {
    constructor() {
      this.recording = [];
      this.bestGhost = null;
      this.sampleTimer = 0;
      this.gateSplits = [];
      this.bestSplits = [];
      this.lastDelta = null;
      this.lastDeltaTimer = 0;
      this._m = Mat4.create();
      this._loadBest();
    }

    _loadBest() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.frames) && parsed.frames.length > 2) {
            this.bestGhost = parsed;
            this.bestSplits = parsed.splits || [];
          }
        }
      } catch (_) {}
    }

    resetRun() {
      this.recording.length = 0;
      this.gateSplits.length = 0;
      this.sampleTimer = 0;
      this.lastDelta = null;
      this.lastDeltaTimer = 0;
    }

    recordGateSplit(timeSec, gateIdx) {
      this.gateSplits[gateIdx] = timeSec;
      if (this.bestSplits[gateIdx] !== undefined) {
        this.lastDelta = timeSec - this.bestSplits[gateIdx];
        this.lastDeltaTimer = 2.4;
      }
    }

    finishRun(totalTime, shipId) {
      if (!this.bestGhost || totalTime < this.bestGhost.time) {
        const payload = {
          time: Number(totalTime.toFixed(2)),
          shipId,
          splits: this.gateSplits.slice(),
          frames: this.recording.slice()
        };
        this.bestGhost = payload;
        this.bestSplits = payload.splits;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch (_) {}
        return true; // New Record!
      }
      return false;
    }

    update(dt, runTime, player) {
      if (this.lastDeltaTimer > 0) this.lastDeltaTimer -= dt;
      this.sampleTimer -= dt;
      if (this.sampleTimer <= 0) {
        this.sampleTimer = 0.1; // 10 Hz compact ghost sampling
        if (this.recording.length < 1800) {
          this.recording.push([
            Number(runTime.toFixed(2)),
            Number(player.pos[0].toFixed(2)),
            Number(player.pos[1].toFixed(2)),
            Number(player.pos[2].toFixed(2)),
            Number(player.shipYaw.toFixed(3)),
            Number(player.shipPitch.toFixed(3)),
            Number(player.bankRoll.toFixed(3))
          ]);
        }
      }
    }

    sampleAt(t) {
      if (!this.bestGhost || this.bestGhost.frames.length < 2) return null;
      const frames = this.bestGhost.frames;
      if (t <= frames[0][0]) return frames[0];
      if (t >= frames[frames.length - 1][0]) return frames[frames.length - 1];
      let lo = 0, hi = frames.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid][0] <= t) lo = mid;
        else hi = mid;
      }
      const a = frames[lo], b = frames[hi];
      const f = (t - a[0]) / Math.max(0.001, b[0] - a[0]);
      return [
        t,
        lerp(a[1], b[1], f),
        lerp(a[2], b[2], f),
        lerp(a[3], b[3], f),
        lerp(a[4], b[4], f),
        lerp(a[5], b[5], f),
        lerp(a[6], b[6], f)
      ];
    }

    pushGhostVisual(renderer, runTime) {
      const sample = this.sampleAt(runTime);
      if (!sample) return;
      const spec = AF.SHIPS[this.bestGhost.shipId] || AF.SHIPS.valkyrie;
      Mat4.composeYXZ(this._m, sample[1], sample[2], sample[3], sample[4], sample[5], sample[6], 1, 1, 1);
      renderer.addHeroDraw(spec.hullMesh, this._m, [0.45, 0.92, 1.0], 0.45, [0.55, 0.95, 1.0], 1.8, 0.2, false);
      renderer.addHeroDraw(spec.wingLMesh, this._m, [0.45, 0.92, 1.0], 0.45, [0.55, 0.95, 1.0], 1.8, 0.2, false);
      renderer.addHeroDraw(spec.wingRMesh, this._m, [0.45, 0.92, 1.0], 0.45, [0.55, 0.95, 1.0], 1.8, 0.2, false);
      Mat4.composeYXZ(this._m, sample[1], sample[2], sample[3], 0, 0, 0, 1.8, 1.3, 2.2);
      renderer.fresnelBatch.push(this._m, 0.45, 0.94, 1.0, 0.35);
    }
  }

  AF.GhostRecorder = GhostRecorder;
})(window.AF = window.AF || {});
