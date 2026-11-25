// src/ui.js — Hangar Ship Picker, Weather Selector, Achievement Toasts & Run Summary UI
(function (AF) {
  'use strict';

  const { clamp } = AF.Math;

  class UIController {
    constructor(game) {
      this.game = game;
      this.shipIndex = 0;
      this.atmoOrder = ['sunset', 'noon', 'aurora', 'storm', 'auto'];
      this.atmoIndex = 0;
      this.toastTimer = 0;
      this.el = {
        hud: document.getElementById('hud'),
        hudSector: document.getElementById('hudSector'),
        hudObjective: document.getElementById('hudObjective'),
        hudTelemetry: document.getElementById('hudTelemetry'),
        bossBarWrap: document.getElementById('bossBarWrap'),
        bossName: document.getElementById('bossName'),
        bossFill: document.getElementById('bossFill'),
        hudScore: document.getElementById('hudScore'),
        hudFlow: document.getElementById('hudFlow'),
        hudFlowFill: document.getElementById('hudFlowFill'),
        hudShards: document.getElementById('hudShards'),
        hudFps: document.getElementById('hudFps'),
        hudRelics: document.getElementById('hudRelics'),
        callout: document.getElementById('calloutBanner'),
        raceDelta: document.getElementById('raceDelta'),
        achToast: document.getElementById('achievementToast'),
        achTitle: document.getElementById('achTitle'),
        achDesc: document.getElementById('achDesc'),
        hpFill: document.getElementById('hpFill'),
        hpText: document.getElementById('hpText'),
        enFill: document.getElementById('enFill'),
        enText: document.getElementById('enText'),
        novaFill: document.getElementById('novaFill'),
        novaText: document.getElementById('novaText'),
        aimHint: document.getElementById('aimHint'),
        titleOverlay: document.getElementById('titleOverlay'),
        relicOverlay: document.getElementById('relicOverlay'),
        relicCards: document.getElementById('relicCards'),
        pauseOverlay: document.getElementById('pauseOverlay'),
        endOverlay: document.getElementById('endOverlay'),
        endEyebrow: document.getElementById('endEyebrow'),
        endTitle: document.getElementById('endTitle'),
        endStats: document.getElementById('endStats'),
        continueEndlessBtn: document.getElementById('continueEndlessBtn'),
        bestExpedition: document.getElementById('bestExpedition'),
        bestEndless: document.getElementById('bestEndless'),
        bestRace: document.getElementById('bestRace'),
        qualitySelect: document.getElementById('qualitySelect'),
        pauseQuality: document.getElementById('pauseQuality'),
        volSlider: document.getElementById('volSlider'),
        pauseVol: document.getElementById('pauseVol'),
        shipName: document.getElementById('shipName'),
        shipRole: document.getElementById('shipRole'),
        shipDesc: document.getElementById('shipDesc'),
        atmoSelect: document.getElementById('atmoSelect'),
        pauseAtmo: document.getElementById('pauseAtmo'),
        sectorSelect: document.getElementById('sectorSelect')
      };

      this._bindHangarAndWeather();
      this.refreshBestScores();
      this.updateShipCard();
    }

    _bindHangarAndWeather() {
      document.getElementById('shipPrev').addEventListener('click', () => {
        this.shipIndex = (this.shipIndex + AF.SHIP_ORDER.length - 1) % AF.SHIP_ORDER.length;
        this.applySelectedShip();
      });
      document.getElementById('shipNext').addEventListener('click', () => {
        this.shipIndex = (this.shipIndex + 1) % AF.SHIP_ORDER.length;
        this.applySelectedShip();
      });

      const syncAtmo = (val) => {
        this.game.setAtmosphere(val);
        this.el.atmoSelect.value = val;
        this.el.pauseAtmo.value = val;
        this.atmoIndex = Math.max(0, this.atmoOrder.indexOf(val));
        if (this.game.comms && this.game.state !== 'title') {
          if (val === 'storm') this.game.comms.push('stormWarn');
          else if (val === 'aurora') this.game.comms.push('auroraSight');
        }
      };
      this.el.atmoSelect.addEventListener('change', (e) => syncAtmo(e.target.value));
      this.el.pauseAtmo.addEventListener('change', (e) => syncAtmo(e.target.value));
    }

    cycleAtmosphere() {
      this.atmoIndex = (this.atmoIndex + 1) % 4; // cycle Sunset -> Noon -> Aurora -> Storm
      const key = this.atmoOrder[this.atmoIndex];
      this.game.setAtmosphere(key);
      this.el.atmoSelect.value = key;
      this.el.pauseAtmo.value = key;
      const preset = AF.ATMOSPHERE_PRESETS[key];
      if (preset) this.game.sim.showCallout(`ATMOSPHERE: ${preset.name.toUpperCase()}`, 1.8);
      if (this.game.comms) {
        if (key === 'storm') this.game.comms.push('stormWarn');
        else if (key === 'aurora') this.game.comms.push('auroraSight');
      }
    }

    applySelectedShip() {
      const id = AF.SHIP_ORDER[this.shipIndex];
      this.game.sim.player.setShip(id);
      this.updateShipCard();
    }

    updateShipCard() {
      const id = AF.SHIP_ORDER[this.shipIndex];
      const spec = AF.SHIPS[id];
      this.el.shipName.textContent = spec.name;
      this.el.shipRole.textContent = spec.role;
      this.el.shipDesc.textContent = spec.desc;
    }

    showAchievement(title, desc) {
      this.el.achTitle.textContent = title;
      this.el.achDesc.textContent = desc;
      this.el.achToast.classList.remove('hidden');
      this.toastTimer = 3.4;
      this.game.sound.playUpgrade();
    }

    updateHUD(dt, fps) {
      if (this.toastTimer > 0) {
        this.toastTimer -= dt;
        if (this.toastTimer <= 0) this.el.achToast.classList.add('hidden');
      }

      const s = this.game.sim;
      const p = s.player;

      if (s.mode === 'zen') {
        this.el.hudSector.textContent = 'OCEAN FREE FLIGHT';
        this.el.hudObjective.textContent = `SHARDS COLLECTED: ${s.shardsCollected} / ${this.game.world.shards.length}`;
      } else if (s.mode === 'race') {
        this.el.hudSector.textContent = `RING RACE // ${s.runTime.toFixed(1)}s`;
        this.el.hudObjective.textContent = `CHECKPOINT ${s.raceIndex + 1} / ${this.game.world.rings.length}`;
      } else {
        this.el.hudSector.textContent = s.mode === 'expedition' ? `SECTOR ${s.sector} / ${s.maxSectors}` : `SURGE WAVE ${s.sector}`;
        if (s.boss) {
          this.el.hudObjective.textContent = `DEFEAT ${s.boss.name}`;
        } else if (s.pylons.length > 0) {
          this.el.hudObjective.textContent = `SHATTER ${s.pylons.length} RESONANCE PYLON${s.pylons.length > 1 ? 'S' : ''}`;
        } else {
          this.el.hudObjective.textContent = `CLEAR REMAINING HOSTILES (${s.enemies.length})`;
        }
      }

      const kmh = Math.round(Math.hypot(p.vel[0], p.vel[1], p.vel[2]) * 4.2);
      const alt = Math.max(0, p.pos[1]).toFixed(1);
      this.el.hudTelemetry.textContent = `${kmh} KM/H • ALT ${alt}M${p.hydroSkimming ? ' • HYDRO-SKIM' : ''}`;

      if (s.boss) {
        this.el.bossBarWrap.classList.remove('hidden');
        this.el.bossName.textContent = s.boss.name + (s.boss.phase === 2 ? ' // PHASE II' : '');
        this.el.bossFill.style.width = `${clamp((s.boss.hp / s.boss.maxHp) * 100, 0, 100)}%`;
      } else {
        this.el.bossBarWrap.classList.add('hidden');
      }

      this.el.hudScore.textContent = s.score.toLocaleString();
      this.el.hudFlow.textContent = `FLOW x${p.flow.toFixed(1)}`;
      this.el.hudFlowFill.style.width = `${clamp((p.flowTimer / 4.2) * 100, 0, 100)}%`;
      this.el.hudShards.textContent = `SHARDS: ${s.shardsCollected}`;
      this.el.hudFps.textContent = `${fps} FPS`;

      this.el.hpFill.style.width = `${clamp((p.hp / p.maxHp) * 100, 0, 100)}%`;
      this.el.hpText.textContent = `${Math.ceil(p.hp)}/${p.maxHp}`;
      this.el.enFill.style.width = `${clamp((p.energy / p.maxEnergy) * 100, 0, 100)}%`;
      this.el.enText.textContent = `${Math.floor(p.energy)}`;
      this.el.novaFill.style.width = `${clamp(p.nova, 0, 100)}%`;
      this.el.novaText.textContent = p.nova >= 100 ? 'READY!' : `${Math.floor(p.nova)}%`;

      const entries = Object.entries(p.relics);
      this.el.hudRelics.innerHTML = entries.map(([id, cnt]) => {
        const meta = AF.RELIC_POOL.find(r => r.id === id);
        if (!meta) return '';
        return `<span class="relic-pill" style="border-color:${meta.color};color:${meta.color}">${meta.name}${cnt > 1 ? ` x${cnt}` : ''}</span>`;
      }).join('');

      if (s.calloutTimer > 0) {
        this.el.callout.classList.remove('hidden');
        this.el.callout.textContent = s.calloutText;
      } else {
        this.el.callout.classList.add('hidden');
      }

      if (this.el.raceDelta) {
        const g = this.game.ghost;
        if (s.mode === 'race' && g && g.lastDelta !== null && g.lastDeltaTimer > 0) {
          const sign = g.lastDelta <= 0 ? '' : '+';
          this.el.raceDelta.textContent = `GHOST ${sign}${g.lastDelta.toFixed(2)}s`;
          this.el.raceDelta.classList.toggle('ahead', g.lastDelta <= 0);
          this.el.raceDelta.classList.toggle('behind', g.lastDelta > 0);
          this.el.raceDelta.classList.remove('hidden');
        } else {
          this.el.raceDelta.classList.add('hidden');
        }
      }
    }

    showRelicDraft(choices, onPick) {
      this.el.relicCards.innerHTML = '';
      choices.forEach((rel, idx) => {
        const count = this.game.sim.player.hasRelic(rel.id);
        const card = document.createElement('button');
        card.className = 'relic-card';
        card.innerHTML = `
          <span class="relic-tag" style="color:${rel.color}">${rel.tag} ${count > 0 ? `(RANK ${count + 1})` : ''}</span>
          <span class="relic-name">${rel.name}</span>
          <span class="relic-desc">${rel.desc}</span>
          <span class="relic-key">[${idx + 1}] SELECT RELIC</span>
        `;
        card.addEventListener('click', () => onPick(rel.id));
        this.el.relicCards.appendChild(card);
      });
      this.el.relicOverlay.classList.remove('hidden');
    }

    showEndScreen(isVictory) {
      const s = this.game.sim;
      this.el.hud.classList.add('hidden');
      this.el.endOverlay.classList.remove('hidden');

      let eyebrow = isVictory ? 'EXPEDITION COMPLETE' : 'SKIMMER SHIELDS SHATTERED';
      let title = isVictory ? 'OCEAN SKY VICTORY' : 'LOST OVER THE SEA';
      if (s.mode === 'race') {
        eyebrow = 'RING RACE COMPLETE';
        const medal = s.runTime < 45 ? 'GOLD MEDAL' : (s.runTime < 62 ? 'SILVER MEDAL' : 'BRONZE MEDAL');
        title = `${medal} — ${s.runTime.toFixed(2)}s`;
      }

      this.el.endEyebrow.textContent = eyebrow;
      this.el.endTitle.textContent = title;
      this.el.continueEndlessBtn.classList.toggle('hidden', !(isVictory && s.mode === 'expedition'));

      const acc = s.shotsFired > 0 ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
      const mins = Math.floor(s.runTime / 60);
      const secs = Math.floor(s.runTime % 60).toString().padStart(2, '0');

      let bestVal = 0;
      try {
        if (s.mode === 'race') {
          const prev = Number(localStorage.getItem('aetherfall_best_race') || '0');
          if (prev === 0 || s.runTime < prev) localStorage.setItem('aetherfall_best_race', s.runTime.toFixed(2));
          bestVal = Number(localStorage.getItem('aetherfall_best_race') || s.runTime.toFixed(2));
        } else {
          const key = s.mode === 'endless' ? 'aetherfall_best_endless' : 'aetherfall_best_expedition';
          bestVal = Number(localStorage.getItem(key) || '0');
          if (s.score > bestVal) {
            bestVal = s.score;
            localStorage.setItem(key, String(bestVal));
          }
        }
      } catch (_) {}

      const stats = [
        ['FINAL SCORE', s.score.toLocaleString()],
        [s.mode === 'race' ? 'BEST TIME' : 'BEST SCORE', s.mode === 'race' ? `${bestVal}s` : bestVal.toLocaleString()],
        ['SHIP', s.player.getShipSpec().name],
        ['FLIGHT TIME', `${mins}:${secs}`],
        ['HOSTILES DOWN', `${s.kills}`],
        ['ACCURACY', `${acc}%`],
        ['PEAK FLOW', `x${s.player.peakFlow.toFixed(1)}`],
        ['SHARDS FOUND', `${s.shardsCollected}`]
      ];
      this.el.endStats.innerHTML = stats.map(([k, v]) => `
        <div class="stat-box">
          <div class="s-k">${k}</div>
          <div class="s-v">${v}</div>
        </div>
      `).join('');
    }

    refreshBestScores() {
      try {
        const be = Number(localStorage.getItem('aetherfall_best_expedition') || '0');
        const bn = Number(localStorage.getItem('aetherfall_best_endless') || '0');
        const br = Number(localStorage.getItem('aetherfall_best_race') || '0');
        this.el.bestExpedition.textContent = be > 0 ? `BEST: ${be.toLocaleString()}` : 'BEST: --';
        this.el.bestEndless.textContent = bn > 0 ? `BEST: ${bn.toLocaleString()}` : 'BEST: --';
        this.el.bestRace.textContent = br > 0 ? `BEST: ${br.toFixed(1)}s` : '14 GATES';
      } catch (_) {}
    }
  }

  AF.UIController = UIController;
})(window.AF = window.AF || {});
