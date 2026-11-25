// src/codex.js — Interactive Pilot Codex, Encyclopedia & Achievement Registry
(function (AF) {
  'use strict';

  const CODEX_DATA = {
    fleet: [
      {
        title: 'VALKYRIE-IX',
        sub: 'BALANCED HYDRO-SKIMMER • 120 SHIELD',
        body: 'Twin rapid-fire plasma repeaters, swept cambered airfoils, and 4-target Homing Star-Missile pods. Tuned for nimble dogfights and wave-skimming.'
      },
      {
        title: 'TEMPEST-RX',
        sub: 'LIGHTNING INTERCEPTOR • 95 SHIELD • +22% SPEED',
        body: 'Forward-swept aerodynamic interceptor firing instantaneous Arc-Lightning lances that jump across nearby foes.'
      },
      {
        title: 'SOLARIS TITAN',
        sub: 'HEAVY CATAMARAN GUNSHIP • 165 SHIELD',
        body: 'Obsidian twin-hull cruiser armed with high-velocity Solar Rail-Slugs and 6-missile salvos.'
      }
    ],
    hostiles: [
      {
        title: 'MANTA DRONE & AEGIS SENTINEL',
        sub: 'AERIAL INTERCEPTORS',
        body: 'Biomechanical winged scouts and armored spherical sentinels protected by rotating orbital shield arcs.'
      },
      {
        title: 'CORSAIR PATROL GUNBOAT',
        sub: 'SURFACE NAVAL CORVETTE',
        body: 'Hydrofoil patrol craft navigating ocean channels on the waves while firing high-angle anti-air plasma arcs.'
      },
      {
        title: 'OBELISK WARDEN',
        sub: 'SECTOR 3 TITAN',
        body: 'Floating citadel idol guarded by 4 orbiting shield nodes. Shatter its shield cores before unloading into its central reactor.'
      },
      {
        title: 'ABYSSAL LEVIATHAN',
        sub: 'SECTOR 4 SEA TITAN',
        body: 'Colossal multi-segmented sea dragon weaving through ocean straits, diving beneath the surf and breaching in towering geysers.'
      },
      {
        title: 'ECLIPSE SERAPH',
        sub: 'SECTOR 5 FINAL TITAN',
        body: 'Six-winged celestial construct unleashing sweeping laser constellations and escalating into Solar Overdrive at 55% HP.'
      }
    ],
    world: [
      {
        title: 'GERSTNER OCEAN & BIOMES',
        sub: 'CUSTOM GLSL 300 ES PIPELINE',
        body: '4-wave animated ocean with depth-based turquoise scattering, real-time sky/aurora Fresnel reflections, shoreline foam, sandy beaches, lush emerald slopes, waterfalls, and stratified rock.'
      },
      {
        title: 'DYNAMIC CLIMATES [KEY V]',
        sub: 'SUNSET • NOON • AURORA • TEMPEST',
        body: 'Seamless real-time interpolation across Golden Sunset, Emerald Noon, starlit Aurora Twilight (with bioluminescent surf), and Tempest Surge (3D rain, lens droplets, and lightning).'
      }
    ],
    achievements: [
      { id: 'waverider', title: 'WAVE RIDER', desc: 'Hydro-skim across ocean swells for 5 seconds.' },
      { id: 'acrobat', title: 'SKY ACROBAT', desc: 'Perform 3 evasive Barrel Rolls [Z/C] in one flight.' },
      { id: 'phantom', title: 'PHANTOM ACE', desc: 'Trigger a Phantom Dodge right before an enemy hit.' },
      { id: 'flow5', title: 'RING MASTER', desc: 'Reach a x5.0 Flow combat & boost multiplier.' },
      { id: 'slayer', title: 'TITAN SLAYER', desc: 'Defeat any colossal Boss Titan.' }
    ]
  };

  class CodexModal {
    constructor() {
      this.overlay = document.getElementById('codexOverlay');
      this.bodyEl = document.getElementById('codexBody');
      this.tabs = document.querySelectorAll('.codex-tab');
      this.activeTab = 'fleet';
      this._bind();
    }

    _bind() {
      const openBtn = document.getElementById('openCodexBtn');
      const pauseOpenBtn = document.getElementById('pauseCodexBtn');
      const closeBtn = document.getElementById('closeCodexBtn');
      if (openBtn) openBtn.addEventListener('click', () => this.open());
      if (pauseOpenBtn) pauseOpenBtn.addEventListener('click', () => this.open());
      if (closeBtn) closeBtn.addEventListener('click', () => this.close());
      this.tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.activeTab = btn.dataset.tab;
          this.tabs.forEach(b => b.classList.toggle('active', b === btn));
          this.render();
        });
      });
    }

    open() {
      this.render();
      if (this.overlay) this.overlay.classList.remove('hidden');
    }

    close() {
      if (this.overlay) this.overlay.classList.add('hidden');
    }

    render() {
      if (!this.bodyEl) return;
      if (this.activeTab === 'achievements') {
        let unlocked = {};
        try { unlocked = JSON.parse(localStorage.getItem('aetherfall_achievements') || '{}'); } catch (_) {}
        this.bodyEl.innerHTML = CODEX_DATA.achievements.map(a => {
          const ok = !!unlocked[a.id];
          return `
            <div class="codex-item ${ok ? 'unlocked' : 'locked'}">
              <div class="cx-head">
                <span class="cx-title">${a.title}</span>
                <span class="cx-badge">${ok ? 'UNLOCKED' : 'LOCKED'}</span>
              </div>
              <p class="cx-body">${a.desc}</p>
            </div>
          `;
        }).join('');
        return;
      }

      const items = CODEX_DATA[this.activeTab] || [];
      this.bodyEl.innerHTML = items.map(it => `
        <div class="codex-item">
          <div class="cx-title">${it.title}</div>
          <div class="cx-sub">${it.sub}</div>
          <p class="cx-body">${it.body}</p>
        </div>
      `).join('');
    }
  }

  AF.CodexModal = CodexModal;
})(window.AF = window.AF || {});
