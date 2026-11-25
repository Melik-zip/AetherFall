// src/hangar.js — Playable Hydro-Jet Fleet Specifications & Unique Weapon Profiles
(function (AF) {
  'use strict';

  const SHIPS = {
    valkyrie: {
      id: 'valkyrie',
      name: 'VALKYRIE-IX',
      role: 'BALANCED SKIMMER',
      desc: 'Twin rapid-fire plasma cannons & 4x Homing Star-Missiles. Agile across waves and high cliffs.',
      hullMesh: 'playerHull',
      wingLMesh: 'playerWingL',
      wingRMesh: 'playerWingR',
      maxHp: 120,
      speedMult: 1.0,
      fireCd: 0.135,
      weaponType: 'pulse', // 'pulse' | 'arc' | 'rail'
      missileCount: 4,
      trailColor: [0.45, 0.94, 1.0],
      flameColor: [0.38, 0.94, 1.0],
      dashColor: [1.0, 0.85, 0.40],
      nozzles: [-0.48, 0.48],
      nozzleZ: -1.42
    },
    tempest: {
      id: 'tempest',
      name: 'TEMPEST-RX',
      role: 'LIGHTNING INTERCEPTOR',
      desc: 'Forward-swept speed demon firing chaining Arc-Lightning lances & rapid double-dash recharge.',
      hullMesh: 'tempestHull',
      wingLMesh: 'tempestWingL',
      wingRMesh: 'tempestWingR',
      maxHp: 95,
      speedMult: 1.22,
      fireCd: 0.175,
      weaponType: 'arc',
      missileCount: 3,
      trailColor: [0.55, 0.72, 1.0],
      flameColor: [0.48, 0.78, 1.0],
      dashColor: [0.72, 0.92, 1.0],
      nozzles: [-0.36, 0.36],
      nozzleZ: -1.48
    },
    titan: {
      id: 'titan',
      name: 'SOLARIS TITAN',
      role: 'HEAVY RAIL-GUNSHIP',
      desc: 'Armored twin-hull catamaran armed with high-impact Solar Rail-Slugs & 6x Missile salvo.',
      hullMesh: 'titanHull',
      wingLMesh: 'titanWingL',
      wingRMesh: 'titanWingR',
      maxHp: 165,
      speedMult: 0.90,
      fireCd: 0.28,
      weaponType: 'rail',
      missileCount: 6,
      trailColor: [1.0, 0.80, 0.38],
      flameColor: [1.0, 0.74, 0.30],
      dashColor: [1.0, 0.92, 0.55],
      nozzles: [-0.72, 0.72],
      nozzleZ: -1.35
    }
  };

  AF.SHIPS = SHIPS;
  AF.SHIP_ORDER = ['valkyrie', 'tempest', 'titan'];
})(window.AF = window.AF || {});
