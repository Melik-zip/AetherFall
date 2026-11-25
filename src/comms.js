// src/comms.js — Tactical Radio Comms Feed & Narrative Callouts
(function (AF) {
  'use strict';

  const CALLSIGN_LINES = {
    sector1: { speaker: 'WING COMMAND // LYRA', text: 'Skimmers airborne. Shatter the Resonance Pylons and watch for Corsair gunboats in the straits.' },
    sector2: { speaker: 'WING COMMAND // LYRA', text: 'Heavy Aegis Sentinels & Phantom Lances detected. Use Barrel Rolls [Z/C] to evade rail locks.' },
    sector3: { speaker: 'SENSOR OPS // Kael', text: 'Massive energy spike over the central atoll — Obelisk Warden descending! Break its shield nodes first.' },
    sector4: { speaker: 'SONAR WATCH // Kael', text: 'Deep ocean seismic tremors! The Abyssal Leviathan is surfacing from the trench!' },
    sector5: { speaker: 'WING COMMAND // LYRA', text: 'Final barrier breached. Eclipse Seraph incoming — unleash Solar Nova when your core peaks!' },
    raceStart: { speaker: 'FLIGHT CONTROL', text: '14-Gate Archipelago Course armed. Skim the waves for bonus speed and chase your Ghost!' },
    zenStart: { speaker: 'EXPLORATION LOG', text: 'All weapons safed. Press [V] anytime to cycle Sunset, Noon, Aurora Twilight, or Tempest Storm.' },
    stormWarn: { speaker: 'METEO TELEMETRY', text: 'Squall front arriving — Gerstner swells rising. Watch for lightning and surf spray!' },
    auroraSight: { speaker: 'FLIGHT CONTROL', text: 'Solar wind hitting upper atmosphere — northern auroras and bioluminescent surf active.' }
  };

  class CommsFeed {
    constructor(sound) {
      this.sound = sound;
      this.elBox = document.getElementById('commsBox');
      this.elSpeaker = document.getElementById('commsSpeaker');
      this.elText = document.getElementById('commsText');
      this.timer = 0;
      this.queue = [];
    }

    push(keyOrSpeaker, customText = null, duration = 4.6) {
      const entry = customText
        ? { speaker: keyOrSpeaker, text: customText, duration }
        : (CALLSIGN_LINES[keyOrSpeaker] ? { ...CALLSIGN_LINES[keyOrSpeaker], duration } : null);
      if (!entry) return;
      if (this.timer > 0) {
        if (this.queue.length < 3) this.queue.push(entry);
        return;
      }
      this._show(entry);
    }

    _show(entry) {
      if (!this.elBox) return;
      this.elSpeaker.textContent = entry.speaker;
      this.elText.textContent = entry.text;
      this.elBox.classList.remove('hidden');
      this.timer = entry.duration;
      if (this.sound && this.sound.playRadioBeep) this.sound.playRadioBeep();
    }

    update(dt) {
      if (this.timer > 0) {
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.queue.length > 0) {
            this._show(this.queue.shift());
          } else if (this.elBox) {
            this.elBox.classList.add('hidden');
          }
        }
      }
    }

    clear() {
      this.queue.length = 0;
      this.timer = 0;
      if (this.elBox) this.elBox.classList.add('hidden');
    }
  }

  AF.CommsFeed = CommsFeed;
})(window.AF = window.AF || {});
