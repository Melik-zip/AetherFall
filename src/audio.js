// src/audio.js — Procedural Web Audio Synthesizer & Adaptive Soundtrack for AETHERFALL
(function (AF) {
  'use strict';

  const { clamp } = AF.Math;

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.thrusterGain = null;
      this.thrusterFilter = null;

      this.enabled = true;
      this.volume = 0.65;
      this.musicVolume = 0.45;
      this.initialized = false;

      // Adaptive music state
      this.stepIndex = 0;
      this.nextNoteTime = 0;
      this.intensity = 0; // 0..1 based on combat & Flow multiplier

      // Cmaj9 -> Am9 -> Fmaj9 -> G6 progression (frequencies in Hz)
      this.chords = [
        [130.81, 196.00, 246.94, 293.66, 329.63], // Cmaj9
        [110.00, 164.81, 246.94, 261.63, 329.63], // Am9
        [87.31,  130.81, 174.61, 220.00, 261.63], // Fmaj9
        [98.00,  146.83, 196.00, 246.94, 329.63]  // G6
      ];
    }

    init() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;

      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.master);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.master);

      // Continuous filtered noise thruster hum
      const bufSize = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.96 * b0 + 0.04 * white;
        data[i] = b0 * 2.5;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      this.thrusterFilter = this.ctx.createBiquadFilter();
      this.thrusterFilter.type = 'bandpass';
      this.thrusterFilter.frequency.value = 180;
      this.thrusterFilter.Q.value = 1.4;

      this.thrusterGain = this.ctx.createGain();
      this.thrusterGain.gain.value = 0.0;

      src.connect(this.thrusterFilter);
      this.thrusterFilter.connect(this.thrusterGain);
      this.thrusterGain.connect(this.sfxGain);
      src.start();

      // Gentle ambient ocean surf wash (LFO-swept lowpass noise)
      const surfSrc = this.ctx.createBufferSource();
      surfSrc.buffer = noiseBuf;
      surfSrc.loop = true;
      const surfFilter = this.ctx.createBiquadFilter();
      surfFilter.type = 'lowpass';
      surfFilter.frequency.value = 320;
      const surfGain = this.ctx.createGain();
      surfGain.gain.value = 0.032;
      const surfLfo = this.ctx.createOscillator();
      surfLfo.frequency.value = 0.16;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 180;
      surfLfo.connect(lfoGain);
      lfoGain.connect(surfFilter.frequency);
      surfSrc.connect(surfFilter);
      surfFilter.connect(surfGain);
      surfGain.connect(this.master);
      surfSrc.start();
      surfLfo.start();
      this.surfGain = surfGain;

      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.initialized = true;
    }

    setVolume(v) {
      this.volume = clamp(v, 0, 1);
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.04);
      }
    }

    setMusicVolume(v) {
      this.musicVolume = clamp(v, 0, 1);
      if (this.musicGain && this.ctx) {
        this.musicGain.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
      }
    }

    update(dt, speedNorm, boosting, combatIntensity) {
      if (!this.initialized || !this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;

      // Update continuous hover thruster sound
      const targetFreq = 130 + speedNorm * 260 + (boosting ? 320 : 0);
      const targetGain = clamp(0.02 + speedNorm * 0.09 + (boosting ? 0.09 : 0), 0, 0.22);
      this.thrusterFilter.frequency.setTargetAtTime(targetFreq, now, 0.06);
      this.thrusterGain.gain.setTargetAtTime(targetGain, now, 0.06);

      // Update adaptive generative synth soundtrack (~124 BPM sixteenth/eighth grid)
      this.intensity = clamp(combatIntensity, 0, 1);
      const stepDur = 0.24; // 8th note at 125 BPM
      while (this.nextNoteTime < now + 0.14) {
        this._scheduleMusicStep(this.nextNoteTime, this.stepIndex);
        this.nextNoteTime += stepDur;
        this.stepIndex = (this.stepIndex + 1) % 64;
      }
    }

    _scheduleMusicStep(t, step) {
      const chordIdx = Math.floor(step / 16) % this.chords.length;
      const chord = this.chords[chordIdx];

      // Lush warm pad every bar (16 steps)
      if (step % 16 === 0) {
        for (let i = 0; i < 3; i++) {
          const osc = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const f = this.ctx.createBiquadFilter();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(chord[i], t);
          f.type = 'lowpass';
          f.frequency.setValueAtTime(520 + this.intensity * 700, t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.055, t + 0.6);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 3.85);
          osc.connect(f);
          f.connect(g);
          g.connect(this.musicGain);
          osc.start(t);
          osc.stop(t + 3.9);
        }
      }

      // Driving pulse bass on intensity > 0.12
      if (this.intensity > 0.12 && (step % 2 === 0)) {
        const accent = (step % 4 === 0) ? 1.0 : 0.6;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(chord[0] * 0.5, t);
        f.type = 'lowpass';
        f.frequency.setValueAtTime(220 + this.intensity * 620 * accent, t);
        f.frequency.exponentialRampToValueAtTime(110, t + 0.2);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.065 * this.intensity * accent, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(f);
        f.connect(g);
        g.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + 0.23);
      }

      // Shimmering pentatonic sky arpeggio
      if (step % 2 === 1 || this.intensity > 0.45) {
        const noteIdx = (step * 3 + chordIdx) % chord.length;
        const freq = chord[noteIdx] * (step % 8 === 7 ? 2 : 1);
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.032 + this.intensity * 0.03, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
        osc.connect(g);
        g.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + 0.38);
      }
    }

    playShoot(pitchMul = 1.0) {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(760 * pitchMul, t);
      osc.frequency.exponentialRampToValueAtTime(210 * pitchMul, t + 0.09);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.1);
    }

    playMissile() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, t);
      osc.frequency.exponentialRampToValueAtTime(920, t + 0.18);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.23);
    }

    playDash() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(65, t + 0.22);
      g.gain.setValueAtTime(0.24, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.25);
    }

    playPerfectDodge() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      [523.25, 659.25, 987.77, 1318.5].forEach((f, i) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, t + i * 0.025);
        g.gain.setValueAtTime(0.09, t + i * 0.025);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.42 + i * 0.04);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(t + i * 0.025);
        osc.stop(t + 0.5);
      });
    }

    playHit(isKill = false) {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isKill ? 980 : 1280, t);
      osc.frequency.exponentialRampToValueAtTime(isKill ? 320 : 620, t + 0.065);
      g.gain.setValueAtTime(isKill ? 0.14 : 0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.08);
    }

    playExplosion(scale = 1.0) {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140 / Math.max(0.7, scale * 0.6), t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 0.35 * scale);
      g.gain.setValueAtTime(clamp(0.2 * scale, 0.1, 0.35), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.38 * scale);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.42 * scale);
    }

    playRingBoost() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      [440, 554.37, 659.25, 880].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + idx * 0.035);
        g.gain.setValueAtTime(0.09, t + idx * 0.035);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.34 + idx * 0.035);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(t + idx * 0.035);
        osc.stop(t + 0.42);
      });
    }

    playDamage() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(155, t);
      osc.frequency.exponentialRampToValueAtTime(48, t + 0.22);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.25);
    }

    playNova() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      [110, 220, 329.63, 440, 659.25].forEach((f) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.65);
        g.gain.setValueAtTime(0.09, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(t);
        osc.stop(t + 0.75);
      });
    }

    playBossWarn() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      [73.42, 110.0, 146.83].forEach((f) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.11, t + 0.22);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(t);
        osc.stop(t + 1.35);
      });
    }

    playUpgrade() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, t + idx * 0.06);
        g.gain.setValueAtTime(0.11, t + idx * 0.06);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45 + idx * 0.06);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(t + idx * 0.06);
        osc.stop(t + 0.55);
      });
    }

    playArc() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1480, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.11);
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.13);
    }

    playRailgun() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, t);
      osc.frequency.exponentialRampToValueAtTime(68, t + 0.28);
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.32);
    }

    playBarrelRoll() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(680, t + 0.18);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.24);
    }

    playThunder() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(75, t);
      osc.frequency.exponentialRampToValueAtTime(28, t + 1.4);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.24, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 1.55);
    }

    playRadioBeep() {
      if (!this.initialized || !this.ctx) return;
      const t = this.ctx.currentTime;
      const freqs = [1320, 1760];
      freqs.forEach((f, idx) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const st = t + idx * 0.055;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, st);
        g.gain.setValueAtTime(0.06, st);
        g.gain.exponentialRampToValueAtTime(0.001, st + 0.065);
        osc.connect(g);
        g.connect(this.sfxGain);
        osc.start(st);
        osc.stop(st + 0.07);
      });
    }
  }

  AF.SoundEngine = SoundEngine;
})(window.AF = window.AF || {});
